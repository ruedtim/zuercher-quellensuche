/**
 * Segmentierung eines Protokoll-PDF (roher pdftotext-Text) in Traktanden.
 *
 * Strategie (empirisch über 1995–2026 validiert):
 *  1. Seitenanker: gedruckte Seitenzahl = erste Bare-Integer-Zeile jeder
 *     `\f`-Seite, steigend (Carry-forward für Seiten ohne Nummernzeile).
 *  2. TOC nur für die Item-Liste: Top-Level-Zeilen `N. Titel` ab
 *     „Verhandlungsgegenstände" als aufsteigende Folge 1..K (Unter-Bullets und
 *     erneutes „1." = Body-Beginn ignorieren). Liefert Nummer + Titel + KR-Nr.
 *  3. Body-Anker: jede Überschrift `N. Titel` im Body suchen (ab dem 2. Vorkommen
 *     der Item-1-Überschrift) und dazwischen schneiden.
 *  4. Confidence-Gating: nur wenn ALLE Items in aufsteigender Reihenfolge mit
 *     monotonen Seitenzahlen gematcht werden; sonst Fallback (ok=false).
 */

import { cleanToParagraphs } from "./pdftext.ts";

export interface TocItem {
  nr: number;
  title: string;
  krNr: string | null;
}

export interface Traktandum {
  nr: number;
  title: string;
  krNr: string | null;
  startPage: number;
  endPage: number;
  paragraphs: string[];
}

export interface SegmentResult {
  ok: boolean;
  reason?: string;
  /** Anzahl TOC-Items (auch im Fallback hilfreich fürs Reporting). */
  tocCount: number;
  items: Traktandum[];
}

interface PageMark {
  offset: number;
  page: number;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»"„".,;:()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `\f`-Seiten → Offset + gedruckte Seitenzahl (Carry-forward). */
export function parsePageSeq(text: string): PageMark[] {
  const pages = text.split("\f");
  const out: PageMark[] = [];
  let pos = 0;
  let last = 0;
  for (const p of pages) {
    let page: number | null = null;
    for (const l of p.split("\n")) {
      const s = l.trim();
      if (s) {
        if (/^\d{1,5}$/.test(s)) page = Number.parseInt(s, 10);
        break;
      }
    }
    if (page === null) page = last + 1;
    last = page;
    out.push({ offset: pos, page });
    pos += p.length + 1; // +1 für das entfernte `\f`
  }
  return out;
}

function pageOf(offset: number, seq: PageMark[]): number {
  let page = seq.length ? seq[0].page : 0;
  for (const m of seq) {
    if (m.offset <= offset) page = m.page;
    else break;
  }
  return page;
}

const KRNR_RE = /KR-Nrn?\.\s*\d+[a-z]?\/\d{4}(?:\s+und\s+\d+[a-z]?\/\d{4})?/i;
const TOC_ITEM_LINE = /^\s*(\d+)\s*\.\s+(\S.*)$/;

const MONTH_RE =
  /^(Januar|Februar|M[äa]rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/i;

interface TocBlock {
  nr: number;
  lines: string[];
}

/**
 * Sammelt Top-Level-Item-Blöcke aus dem TOC.
 * - strict: streng konsekutiv ab der Startnummer (modern: 1,2,3…).
 * - lenient: jede noch nicht gesehene Nummer ist ein Item (alt: 1,9,67,10…);
 *   Abbruch sobald eine Nummer wiederkehrt (= Body wiederholt die Agenda).
 * Datumszeilen („16. Dezember 2002") werden nie als Item gewertet.
 */
function collectBlocks(lines: string[], lenient: boolean): TocBlock[] {
  const blocks: TocBlock[] = [];
  const seen = new Set<number>();
  let startNr: number | null = null;
  let expect = 0;
  let cur: TocBlock | null = null;
  for (const line of lines) {
    const mi = TOC_ITEM_LINE.exec(line);
    if (mi && !MONTH_RE.test(mi[2])) {
      const nr = Number.parseInt(mi[1], 10);
      const isNext = lenient ? !seen.has(nr) : nr === expect;
      const isRestart = lenient ? seen.has(nr) : startNr !== null && nr <= startNr;
      if (cur === null) {
        cur = { nr, lines: [line] };
        startNr = nr;
        expect = nr + 1;
        seen.add(nr);
        continue;
      }
      if (isNext) {
        blocks.push(cur);
        cur = { nr, lines: [line] };
        expect = nr + 1;
        seen.add(nr);
        continue;
      }
      if (isRestart) break; // Body-Beginn
      // sonst: Ausreisser-Nummer → als Block-Inhalt behandeln
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function finalizeBlock(b: TocBlock): TocItem {
  // Titel = Item-Zeile + Fortsetzungszeilen bis zum Seiten-/Sub-Marker.
  const acc: string[] = [];
  for (const l of b.lines) {
    const t = l.trim();
    if (/^[–•·\-*]/.test(t) || /^KR-Nrn?\./i.test(t)) break; // Sub-Inhalt beginnt
    // Seitenzahl bzw. Vorlage-Nr auf eigener Zeile (häufig 1990er: rechtsbündige
    // „Seite N" / „3443" landen bei pdftotext auf einer eigenen Zeile) → Titelende.
    if (/^(Seite\s+)?\d{1,6}$/.test(t)) break;
    // Seiten-Marker inline: Punktführung (≥2 Punkte), „Seite N" oder eine
    // kollabierte Einzel-Punkt-Führung mit Seitenzahl am Zeilenende („… . 5").
    const cut = l.search(/\.{2,}|\s+Seite\s+\d+|\s\.+\s*\d{1,5}\s*$/);
    if (cut >= 0) {
      acc.push(l.slice(0, cut));
      break;
    }
    acc.push(l);
  }
  const title = acc.join(" ").replace(/^\s*\d+\s*\.\s*/, "").replace(/\s+/g, " ").trim();
  const kr = KRNR_RE.exec(b.lines.join(" "));
  return { nr: b.nr, title, krNr: kr ? kr[0].replace(/\s+/g, " ") : null };
}

/** Top-Level-Traktanden aus dem Inhaltsverzeichnis (Nummer + Titel + KR-Nr). */
export function parseTocItems(text: string): TocItem[] {
  const m = /Verhandlungsgegenst[äa]nde/.exec(text);
  if (!m) return [];
  const lines = text.slice(m.index + m[0].length).split("\n");
  // Erst streng konsekutiv; reicht das nicht (nicht-konsekutive Alt-Nummerierung
  // oder nur ein Item gefunden), lenient nachversuchen.
  let blocks = collectBlocks(lines, false);
  if (blocks.length < 2) {
    const lenient = collectBlocks(lines, true);
    if (lenient.length > blocks.length) blocks = lenient;
  }
  return blocks.map(finalizeBlock);
}

function titleMatches(headingLine: string, title: string): boolean {
  const cand = normalize(headingLine.replace(/^\s*\d+\s*\.\s*/, ""));
  const tw = normalize(title).split(" ").filter(Boolean);
  if (tw.length === 0) return true;
  if (cand.startsWith(tw[0])) return true;
  if (tw.length >= 2 && cand.includes(tw.slice(0, 2).join(" "))) return true;
  return false;
}

interface Boundary {
  item: TocItem;
  headStart: number;
  contentStart: number;
  startPage: number;
}

/** Body-Überschriften der Items finden (ab 2. Vorkommen der Item-1-Überschrift). */
function findBoundaries(text: string, items: TocItem[], seq: PageMark[]): Boundary[] | null {
  // Multiline `^`: matcht an jedem Zeilenanfang ≥ lastIndex (so kann der
  // Per-Item-Suchlauf auch an der Item-1-Zeile selbst anker­n). Nach „N." sind
  // Whitespaces inkl. Zeilenumbrüchen erlaubt – manchmal trennt pdftotext die
  // Nummer vom Titel auf zwei Zeilen („14.\n\nVerschiedenes").
  const headRe = (nr: number) =>
    new RegExp("^[ \\t]*" + nr + "[ \\t]*\\.[ \\t\\r\\n]*[^\\n]*", "gm");

  // Body-Start: zweites Vorkommen der Item-1-Überschrift (1. = TOC, 2. = Body).
  const occ: number[] = [];
  {
    const re = headRe(items[0].nr);
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) {
      if (titleMatches(mm[0], items[0].title)) occ.push(mm.index);
    }
  }
  if (occ.length < 2) return null;

  let cursor = occ[1];
  const bounds: Boundary[] = [];
  let misses = 0;
  for (const item of items) {
    const re = headRe(item.nr);
    re.lastIndex = cursor;
    let mm: RegExpExecArray | null;
    let hit: Boundary | null = null;
    while ((mm = re.exec(text))) {
      if (titleMatches(mm[0], item.title)) {
        hit = {
          item,
          headStart: mm.index,
          contentStart: mm.index + mm[0].length,
          startPage: pageOf(mm.index, seq),
        };
        break;
      }
    }
    if (!hit) {
      // Toleranz: ein nicht gefundenes Item (z. B. zurückgezogen/umbenannt)
      // überspringen – sein Text fällt in das vorige Traktandum. Mehr als eines
      // → Fallback auf Ganz-Sitzung.
      if (++misses > 1) return null;
      continue;
    }
    bounds.push(hit);
    cursor = hit.contentStart;
  }
  if (bounds.length < 2) return null;

  // Strikt aufsteigende Offsets + monotone Seitenzahlen.
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i].headStart <= bounds[i - 1].headStart) return null;
    if (bounds[i].startPage < bounds[i - 1].startPage) return null;
  }
  return bounds;
}

export function segmentProtocol(rawText: string): SegmentResult {
  const seq = parsePageSeq(rawText);
  const items = parseTocItems(rawText);
  if (items.length < 2) return { ok: false, reason: "toc<2", tocCount: items.length, items: [] };

  const bounds = findBoundaries(rawText, items, seq);
  if (!bounds) return { ok: false, reason: "unmatched-or-nonmono", tocCount: items.length, items: [] };

  const lastPage = seq.length ? seq[seq.length - 1].page : bounds[bounds.length - 1].startPage;
  const out: Traktandum[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    const end = i + 1 < bounds.length ? bounds[i + 1].headStart : rawText.length;
    const slice = rawText.slice(b.contentStart, end);
    const startPage = b.startPage;
    const endPage = i + 1 < bounds.length ? Math.max(startPage, bounds[i + 1].startPage - 1) : Math.max(startPage, lastPage);
    out.push({
      nr: b.item.nr,
      title: b.item.title || `Traktandum ${b.item.nr}`,
      krNr: b.item.krNr,
      startPage,
      endPage,
      paragraphs: cleanToParagraphs(slice),
    });
  }
  return { ok: true, tocCount: items.length, items: out };
}
