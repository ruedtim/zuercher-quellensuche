/**
 * Entstehungszeitraum des Katalogs («Entstehungszeitraum», `date_text`) → Jahre, für die
 * Ehedaten auch → Tage (parseCatalogDays).
 *
 * Die Angaben folgen einer kleinen Grammatik (Stichprobe 2026-10: 82 Muster):
 * Bausteine TT.MM.JJJJ, MM.JJJJ, JJJJ oder «N. Jh.», je wahlweise mit «ca.»,
 * verbunden mit « - » oder «zwischen … und …», dazu «bis/vor/nach/ab …» und
 * «s. d. (sine dato)». «ca.» weitet nicht aus; ein Jahrhundert reicht von
 * (N-1)·100+1 bis N·100. Pur, unit-getestet in dates.test.ts.
 */

export interface YearRange {
  from: number;
  to: number;
}

const ATOM = /^(?:ca\.\s*)?(?:(\d{1,2})\.\s*Jh\.|(?:\d{1,2}\.){0,2}(\d{3,4}))$/;

function atom(s: string): YearRange | null {
  const m = ATOM.exec(s.trim());
  if (!m) return null;
  if (m[1]) {
    const n = Number(m[1]);
    return { from: (n - 1) * 100 + 1, to: n * 100 };
  }
  const y = Number(m[2]);
  return { from: y, to: y };
}

function span(a: YearRange | null, b: YearRange | null): YearRange | null {
  if (!a || !b) return null;
  const from = Math.min(a.from, b.from);
  const to = Math.max(a.to, b.to);
  return { from, to };
}

export function parseCatalogDate(text: string | null | undefined): YearRange | null {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const between = /^zwischen (.+) und (.+)$/.exec(s);
  if (between) return span(atom(between[1]), atom(between[2]));
  const bound = /^(?:bis|vor|nach|ab) (.+)$/.exec(s);
  if (bound) return atom(bound[1]);
  const parts = s.split(" - ");
  if (parts.length === 2) return span(atom(parts[0]), atom(parts[1]));
  return parts.length === 1 ? atom(s) : null;
}

/** Tage eines Entstehungszeitraums als ISO-Daten (JJJJ-MM-TT), beide Grenzen eingeschlossen. */
export interface DayRange {
  from: string;
  to: string;
}

const DAY_ATOM = /^(?:ca\.\s*)?(?:(?:(\d{1,2})\.)?(\d{1,2})\.)?(\d{3,4})$/;

interface Day {
  y: number;
  m: number;
  d: number;
}

const iso = (t: Day) => `${String(t.y).padStart(4, "0")}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
/** Letzter Tag des Monats, gregorianisch gerechnet wie die ISO-Spalten der Ehedatenbank
 *  (Februar 1700: 28 Tage). */
function lastDay(y: number, m: number): number {
  if (m !== 2) return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
}
const nextDay = (t: Day): Day =>
  t.d < lastDay(t.y, t.m) ? { ...t, d: t.d + 1 } : t.m < 12 ? { y: t.y, m: t.m + 1, d: 1 } : { y: t.y + 1, m: 1, d: 1 };
const prevDay = (t: Day): Day =>
  t.d > 1 ? { ...t, d: t.d - 1 } : t.m > 1 ? { y: t.y, m: t.m - 1, d: lastDay(t.y, t.m - 1) } : { y: t.y - 1, m: 12, d: 31 };

/** Erster und letzter Tag eines Bausteins; null, wenn es den Tag nicht gibt. Den 29. Februar
 *  gibt es in jedem vierten Jahr: Bis 1700 datierte Zürich julianisch (1700 stünde sonst nicht). */
function dayAtom(s: string): { first: Day; last: Day } | null {
  const m = DAY_ATOM.exec(s.trim());
  if (!m) return null;
  const y = Number(m[3]);
  if (!m[2]) return { first: { y, m: 1, d: 1 }, last: { y, m: 12, d: 31 } };
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (!m[1]) return { first: { y, m: mo, d: 1 }, last: { y, m: mo, d: lastDay(y, mo) } };
  const d = Number(m[1]);
  if (d < 1 || (d > lastDay(y, mo) && !(mo === 2 && d === 29 && y % 4 === 0))) return null;
  return { first: { y, m: mo, d }, last: { y, m: mo, d } };
}

/**
 * Entstehungszeitraum → erster und letzter Tag: «23.07.1553», «07.1577» (ganzer Monat),
 * «1632» (ganzes Jahr), Spannen « - » und «zwischen A und B», alles wahlweise mit «ca.».
 * «zwischen» schliesst die Grenzen aus (A + 1 bis B − 1 Tag), so führt die Ehedatenbank die
 * Daten (Zenodo, `Datum_Von`/`Datum_Bis`). Die Tage stehen wie im Kirchenbuch, ohne
 * Umrechnung in den gregorianischen Kalender. null für Jahrhunderte, «bis/vor/nach/ab» und
 * Unlesbares.
 */
export function parseCatalogDays(text: string | null | undefined): DayRange | null {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const between = /^zwischen (.+) und (.+)$/.exec(s);
  const parts = between ? [between[1], between[2]] : s.split(" - ");
  if (parts.length > 2) return null;
  const [a, b = a] = parts.map(dayAtom);
  if (!a || !b) return null;
  let from = iso(a.first);
  let to = iso(b.last);
  if (between) {
    const inner = { from: iso(nextDay(a.last)), to: iso(prevDay(b.first)) };
    if (inner.from <= inner.to) ({ from, to } = inner);
  }
  return to < from ? null : { from, to };
}
