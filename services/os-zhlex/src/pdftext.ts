/**
 * Text aus einem OS-Erlass-PDF via `pdftotext` (poppler) extrahieren und in
 * lesbare Absätze überführen. Übernommen aus `services/rrb-zhweb/src/pdftext.ts`
 * (generisches `cleanToParagraphs`, keine serienspezifischen Heuristiken).
 *
 * pdftotext (plain) liefert hart umbrochene Zeilen, Leerzeilen zwischen Blöcken
 * und Seitenzahlen als eigene Zeilen. Wir bauen daraus Absätze:
 *   - Leerzeile oder reine Seitenzahl  → Absatzgrenze
 *   - Aufzählungszeichen (Bullet/Gedankenstrich) → neuer Absatz
 *   - sonst: weiche Umbrüche zusammenfügen (mit De-Hyphenierung)
 * Zusätzlich: gesperrt gesetzte Wörter ("B e s c h l u s s") zusammenziehen.
 *
 * Bewusst heuristisch (v1, ein Dokument pro Erlass-Publikation). Für Volltext-
 * suche + Lesbarkeit ausreichend; Tabellen werden zu Fließtext geglättet.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function isParagraphStart(line: string): boolean {
  return /^[•–—]/.test(line);
}

/**
 * C0/C1-Steuerzeichen (ausser Tab/Newline/CR) durch Leerzeichen ersetzen. Manche
 * PDFs liefern z. B. STX (Code 2) als Wort-Trenner ("Auszug<STX>aus<STX>dem"),
 * was sonst Wörter verklebt und Lesbarkeit kaputtmacht.
 */
function scrubControls(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const keep = c === 9 || c === 10 || c === 13; // Tab, Newline, CR behalten
    out += !keep && (c < 32 || (c >= 127 && c <= 159)) ? " " : s[i];
  }
  return out;
}

/** Gesperrt gesetzte Wörter ("B e s c h l u s s") zusammenziehen. */
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

/** Roher pdftotext-Output (mit Form-Feeds `\f` als Seitengrenzen). */
export async function runPdftotext(pdfPath: string): Promise<string> {
  const { stdout } = await execFileAsync("pdftotext", ["-enc", "UTF-8", pdfPath, "-"], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout;
}

/**
 * Wandelt rohen pdftotext-Output in lesbare Absätze. Leeres Array, wenn kein
 * Text vorhanden (gescanntes PDF ohne Textebene).
 */
export function cleanToParagraphs(raw: string): string[] {
  // Form-Feeds zu Zeilenumbrüchen, dann Steuerzeichen säubern (Reihenfolge wichtig:
  // \f würde sonst von scrubControls zu Space statt Absatzgrenze).
  const lines = scrubControls(raw.replace(/\f/g, "\n")).split("\n");
  const paras: string[] = [];
  let cur = "";

  const pushCur = () => {
    const norm = collapseLetterSpacing(cur.replace(/\s+/g, " ").trim());
    if (norm) paras.push(norm);
    cur = "";
  };

  for (const rawLine of lines) {
    // Punktführungen (Inhaltsverzeichnisse) entfernen.
    const line = rawLine.replace(/\.{2,}/g, " ");
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
    if (/^Seite\s+\d+$/.test(trimmed)) continue;

    if (isParagraphStart(trimmed) && cur.trim()) pushCur();

    cur = cur === "" ? trimmed : joinLines(cur, trimmed);
  }
  pushCur();

  return paras;
}

/** Komfort: PDF → Absätze in einem Schritt. */
export async function extractParagraphs(pdfPath: string): Promise<string[]> {
  return cleanToParagraphs(await runPdftotext(pdfPath));
}
