/**
 * Text aus einem Protokoll-PDF via `pdftotext` (poppler) extrahieren und in
 * lesbare Absätze überführen.
 *
 * pdftotext (plain) liefert hart umbrochene Zeilen, Leerzeilen zwischen Blöcken,
 * Seitenzahlen als eigene Zeilen und (im Inhaltsverzeichnis) Punktführungen.
 * Wir bauen daraus Absätze:
 *   - Leerzeile oder reine Seitenzahl  → Absatzgrenze
 *   - Aufzählungszeichen (•, –, —)     → neuer Absatz
 *   - Sprecher-/Rollenzeile ("Name (Partei, Ort):", "Ratspräsidentin X:") → neuer Absatz
 *   - sonst: weiche Umbrüche zusammenfügen (mit De-Hyphenierung)
 * Zusätzlich: gesperrt gesetzte Namen ("H e g e t s c h w e i l e r") zusammenziehen.
 *
 * Bewusst heuristisch (v1, ein Dokument pro Sitzung). Für Volltextsuche +
 * Lesbarkeit ausreichend; Feinschliff (Traktanden-Split, Seiten-Anker) folgt.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Sprecher-/Rollenzeile am Absatzanfang. */
const SPEAKER_RE =
  /^(?:[\p{Lu}][\p{L}.\-’' ]{1,40}\([^)]{1,60}\)\s*:|(?:Ratspr|Vizepr|Alterspr|Pr|Regierungspr|Regierungsr|Staatsschreiber|Protokollf|Stimmenz)\p{L}*\b[^:\n]{0,60}:)/u;

/**
 * Metadaten-Kopf eines Traktandums endet mit der/den KR-Nr(n). Danach (vor
 * grossgeschriebenem Inhalt / Anführung / Zahl) wird ein Absatz umgebrochen,
 * damit der eigentliche Wortlaut nicht am Kopf-Echo klebt.
 */
const KRNR_SPLIT_RE =
  /(KR-Nrn?\.\s*\d{1,4}[a-z]?\/\d{4}(?:\s+und\s+\d{1,4}[a-z]?\/\d{4})?)\s+(?=[«"„0-9\p{Lu}])/gu;

function splitAfterKrNr(s: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of s.matchAll(KRNR_SPLIT_RE)) {
    const cutAt = (m.index ?? 0) + m[1].length; // direkt nach der KR-Nr trennen
    out.push(s.slice(last, cutAt));
    last = cutAt;
  }
  out.push(s.slice(last));
  return out.map((x) => x.trim()).filter(Boolean);
}

function isParagraphStart(line: string): boolean {
  if (/^[•–—]/.test(line)) return true;
  return SPEAKER_RE.test(line);
}

/** Gesperrt gesetzte Namen ("H e g e t s c h w e i l e r") zusammenziehen. */
function collapseLetterSpacing(s: string): string {
  const tokens = s.split(" ");
  const out: string[] = [];
  let run: string[] = [];
  const isSingleLetter = (t: string) => t.length === 1 && /\p{L}/u.test(t);
  const flush = () => {
    if (run.length >= 3) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    if (isSingleLetter(t)) run.push(t);
    else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(" ");
}

/** Zwei Zeilen innerhalb eines Absatzes zusammenfügen (De-Hyphenierung). */
function joinLines(prev: string, next: string): string {
  if (/[\p{L}]-$/u.test(prev)) {
    const base = prev.slice(0, -1);
    // Trennstrich vor Kleinbuchstaben → Wort zusammenziehen; vor Grossbuchstaben
    // (Kompositum) → Bindestrich behalten, aber ohne Leerzeichen.
    return /^[\p{Ll}]/u.test(next) ? base + next : base + "-" + next;
  }
  return prev + " " + next;
}

/**
 * Roher pdftotext-Output (mit Form-Feeds `\f` als Seitengrenzen). Für die
 * Segmentierung gebraucht, die auf gedruckten Seitenzahlen + Body-Überschriften
 * arbeitet.
 */
export async function runPdftotext(pdfPath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-enc", "UTF-8", pdfPath, "-"],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
  );
  return stdout;
}

/**
 * Wandelt einen rohen pdftotext-Block (ganzes PDF oder ein Traktandum-Slice) in
 * lesbare Absätze. Leeres Array, wenn kein Text vorhanden (gescanntes PDF).
 */
export function cleanToParagraphs(raw: string): string[] {
  const lines = raw.replace(/\f/g, "\n").split("\n");
  const paras: string[] = [];
  let cur = "";

  const pushCur = () => {
    const norm = collapseLetterSpacing(cur.replace(/\s+/g, " ").trim());
    // Geschäfts-Kopf vom Inhalt trennen: nach der/den KR-Nr(n) umbrechen.
    if (norm) for (const p of splitAfterKrNr(norm)) paras.push(p);
    cur = "";
  };

  for (const raw of lines) {
    // Punktführungen aus dem Inhaltsverzeichnis entfernen.
    const line = raw.replace(/\.{2,}/g, " ");
    const trimmed = line.trim();

    if (trimmed === "") {
      pushCur();
      continue;
    }
    if (/^\d{1,4}$/.test(trimmed)) {
      // Reine Seitenzahl → Absatzgrenze, Zeile verwerfen.
      pushCur();
      continue;
    }
    if (/^Seite\s+\d+$/.test(trimmed)) continue; // TOC-Rest "Seite N"

    if (isParagraphStart(trimmed) && cur.trim()) pushCur();

    cur = cur === "" ? trimmed : joinLines(cur, trimmed);
  }
  pushCur();

  return paras;
}

/** Komfort: PDF → Absätze in einem Schritt (Ganz-Sitzungs-Fallback). */
export async function extractParagraphs(pdfPath: string): Promise<string[]> {
  return cleanToParagraphs(await runPdftotext(pdfPath));
}
