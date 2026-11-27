/**
 * Querverweise auf Editionen des Staatsarchivs: welche Stücke der QZH (Quellen zur
 * Zürcher Geschichte, GitHub stazh/qzh-data) und der Zürcher Rechtsquellen (SSRQ ZH,
 * StAZH-Kopie stazh/erqzh-data) eine Verzeichnungseinheit des Archivkatalogs edieren
 * (Katalog-ID der Vorlage im TEI) bzw. einem Eintrag eines Ratsmanuals der Plattform
 * entsprechen (Band, Seite, Datum, bei Gleichstand der Text).
 *
 * Ratsmanuale: Ein ediertes Stück ist ein Eintrag innerhalb einer Sitzung und kann
 * mitten in einer Sitzung stehen, die eine Seite früher beginnt. Anders als bei den
 * Sitzungs-Subdossiers des Katalogs (rmSessions.ts, Anfangsseite) zählen darum alle
 * Sitzungen, deren Seiten die Seite des Eintrags abdecken; das Datum der Edition
 * schliesst abweichende aus, bleiben mehrere, entscheidet der Text (Anteil der Wörter
 * des edierten Texts, die im HTR-Text der Sitzung vorkommen) oder es gibt keinen Verweis.
 * Kalender: Edition und Plattform geben das Datum der Quelle wieder (bis 1700 alter Stil).
 *
 * Pur, unit-getestet in editionLinks.test.ts; Einlesen und Abrufen in editionLinksRun.ts.
 */

export type EditionKey = "qzh" | "ssrq";

export const QZH_BASE = "https://qzh.sources-online.org";
export const SSRQ_BASE = "https://rechtsquellen.sources-online.org";

/** Datum der Vorlage als Spanne ganzer Tage (ISO); `from === to` = genauer Tag. */
export interface DateRange {
  from: string;
  to: string;
}

/** Ein Text der Edition: ein QZH-Stück bzw. ein Text eines SSRQ-Stücks (Grundtext,
 *  Dateiname ohne Zusatz oder mit `_1`; weitere Überlieferungen `_2`, `_3` …). */
export interface EditionText {
  edition: EditionKey;
  /** Dateiname ohne .xml: «QZH_401», «SSRQ_ZH_NF_II_3_047_2». */
  id: string;
  /** Zitierform des Stücks: «QZH_401», «SSRQ ZH NF II/3 Nr. 47». */
  label: string;
  /** Seite des Stücks in der Edition. */
  url: string;
  /** Weitere Überlieferung: das Stück beschreibt diese Vorlage nur, ediert ist es aus einer anderen. */
  witness: boolean;
  /** Katalog-IDs der Vorlage (`msIdentifier/idno/@source`, nur Links auf den Online-Katalog
   *  des Staatsarchivs, stazhCatalogIdOf). */
  catalogIds: number[];
  /** Vorlage in einem anderen Archiv: Link der Edition auf dessen scopeQuery-Katalog. Dessen
   *  IDs sind keine des Staatsarchivs ⇒ kein Verweis, nur im Bericht gezählt. */
  otherArchives: OtherArchiveLink[];
  /** Signatur der Vorlage, wie die Edition sie schreibt. */
  signature: string;
  title: string;
  date: DateRange | null;
}

// ── TEI ─────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text eines XML-Ausschnitts: Tags weg, Entitäten aufgelöst, Leerraum vereinheitlicht. */
export function plainText(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function sourceDescOf(xml: string): string {
  return /<sourceDesc\b[^>]*>([\s\S]*?)<\/sourceDesc>/.exec(xml)?.[1] ?? "";
}

// ── Kataloge ────────────────────────────────────────────────────────────────

/**
 * Hosts des Online-Archivkatalogs des Staatsarchivs (scopeQuery; der Permalink heisst seit
 * 2026-10 archivkatalog.ji.zh.ch). Nur Links dorthin geben Katalog-IDs: Die Rechtsquellen
 * verweisen bei Vorlagen anderer Archive auf deren scopeQuery-Kataloge – gleich gebaut
 * (detail.aspx?ID=…), aber mit eigenen IDs (Stadtarchiv Zürich 528718 ist im Staatsarchiv
 * ein Regierungsratsbeschluss von 1833).
 */
export const STAZH_CATALOG_HOSTS: ReadonlySet<string> = new Set(["suche.staatsarchiv.djiktzh.ch", "archivkatalog.ji.zh.ch"]);

/** Andere Archive mit scopeQuery-Katalog, auf die die Editionen verweisen (Host → Name im Bericht). */
export const OTHER_CATALOG_ARCHIVES: Readonly<Record<string, string>> = {
  "amsquery.stadt-zuerich.ch": "Stadtarchiv Zürich",
  "scope.stiftsarchiv.sg.ch": "Stiftsarchiv St. Gallen",
};

/** Link auf einen scopeQuery-Katalog: Host (klein, ohne Port), ID der Einheit dort, Link. */
export interface ScopeLink {
  host: string;
  id: number;
  href: string;
}

/** Vorlage in einem anderen Archiv: Name des Archivs (unbekannt: der Host) und Link. */
export interface OtherArchiveLink extends ScopeLink {
  archive: string;
}

const SCOPE_LINK = /\bhttps?:\/\/([a-z0-9.-]+)(?::\d+)?\/(?:[^\s"<>?#]*\/)?detail\.aspx\?id=(\d{1,9})\b/gi;

/** Links auf scopeQuery-Kataloge in einem Wert, auch mitten im Text («StAZH C II 3, Nr. 1 / https://…»). */
export function scopeLinksOf(value: string): ScopeLink[] {
  return [...value.matchAll(SCOPE_LINK)].map((m) => ({ host: m[1].toLowerCase(), id: Number(m[2]), href: m[0] }));
}

/** Katalog-ID des Staatsarchivs aus einem Link auf seinen Online-Archivkatalog (http oder
 *  https, `ID` oder `id`); Links auf die Kataloge anderer Archive und sonstige Werte ⇒ null. */
export function stazhCatalogIdOf(value: string): number | null {
  return scopeLinksOf(value).find((l) => STAZH_CATALOG_HOSTS.has(l.host))?.id ?? null;
}

/** Vorlage des ersten `msDesc`: Signatur, Katalog-IDs, Vorlagen in anderen Archiven, Titel (`head`). */
function witnessOf(sourceDesc: string): { signature: string; catalogIds: number[]; otherArchives: OtherArchiveLink[]; title: string } {
  const ms = /<msDesc\b[^>]*>([\s\S]*?)<\/msDesc>/.exec(sourceDesc)?.[1] ?? "";
  const ident = /<msIdentifier\b[^>]*>([\s\S]*?)<\/msIdentifier>/.exec(ms)?.[1] ?? "";
  const catalogIds = new Set<number>();
  const otherArchives: OtherArchiveLink[] = [];
  const signatures: string[] = [];
  for (const m of ident.matchAll(/<idno\b([^>]*)>([\s\S]*?)<\/idno>/g)) {
    const source = /\bsource="([^"]*)"/.exec(m[1])?.[1];
    for (const link of source ? scopeLinksOf(decodeEntities(source)) : []) {
      if (STAZH_CATALOG_HOSTS.has(link.host)) catalogIds.add(link.id);
      else if (!otherArchives.some((o) => o.host === link.host && o.id === link.id)) {
        otherArchives.push({ ...link, archive: OTHER_CATALOG_ARCHIVES[link.host] ?? link.host });
      }
    }
    const text = plainText(m[2]);
    if (text) signatures.push(text);
  }
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/.exec(ms.replace(/<msIdentifier\b[\s\S]*?<\/msIdentifier>/, ""))?.[1] ?? "";
  return { signature: signatures.join("; "), catalogIds: [...catalogIds], otherArchives, title: plainText(head) };
}

/** «1583-09-21» → genauer Tag; «1588-07» → Monat; «1588» → Jahr; sonst null. */
function isoSpan(value: string): DateRange | null {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  if (d) return { from: `${y}-${mo}-${d}`, to: `${y}-${mo}-${d}` };
  if (mo) {
    const last = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
    return { from: `${y}-${mo}-01`, to: `${y}-${mo}-${String(last).padStart(2, "0")}` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Entstehungsdatum der Vorlage: `origDate` in `history/origin`, sonst das erste im
 *  `msDesc`; `when` bzw. `from`/`to`, `notBefore`/`notAfter`. */
export function origDateOf(sourceDesc: string): DateRange | null {
  const origin = /<origin\b[^>]*>([\s\S]*?)<\/origin>/.exec(sourceDesc)?.[1] ?? "";
  const tag = /<origDate\b([^>]*)>/.exec(origin)?.[1] ?? /<origDate\b([^>]*)>/.exec(sourceDesc)?.[1];
  if (tag == null) return null;
  const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const when = attr("when");
  if (when) return isoSpan(when);
  const from = attr("from") ?? attr("notBefore");
  const to = attr("to") ?? attr("notAfter");
  const a = from ? isoSpan(from) : null;
  const b = to ? isoSpan(to) : null;
  if (!a && !b) return null;
  return { from: (a ?? b)!.from, to: (b ?? a)!.to };
}

// ── QZH und SSRQ ────────────────────────────────────────────────────────────

/** QZH-Stück (quellenstuecke/QZH_nnn.xml); die ID ist der Dateiname. */
export function parseQzhText(id: string, xml: string): EditionText | null {
  if (!/^QZH_\d+$/.test(id)) return null;
  const sd = sourceDescOf(xml);
  return {
    edition: "qzh",
    id,
    label: id,
    url: `${QZH_BASE}/quellenstuecke/${id}`,
    witness: false,
    ...witnessOf(sd),
    date: origDateOf(sd),
  };
}

const SSRQ_ID = /^SSRQ_(ZH_(?:NF|AF)_[IVX]+(?:_\d{1,2}){0,2})_(\d{3})(?:_(\d{1,2}))?$/;

/** «SSRQ_ZH_NF_II_3_047_2» → Band «ZH_NF_II_3», Nr. 47, Text 2. Einleitungen, Vorworte
 *  und Bandangaben (volinfo, «…_000a_Vorwort») sind keine Stücke ⇒ null. */
export function ssrqParts(id: string): { volume: string; nr: number; part: number | null } | null {
  const m = SSRQ_ID.exec(id);
  if (!m || Number(m[2]) === 0) return null;
  return { volume: m[1], nr: Number(m[2]), part: m[3] ? Number(m[3]) : null };
}

/** Zitierform wie die Querverweise der Edition, ohne Komma: «SSRQ ZH NF II/3 Nr. 47»,
 *  «SSRQ ZH NF I/1/3 Nr. 2». Die Texte eines Stücks (`_1`, `_2`) teilen sie. */
export function ssrqLabel(volume: string, nr: number): string {
  const [canton, ...rest] = volume.split("_");
  const [series, ...vol] = rest;
  return `SSRQ ${canton} ${series} ${vol.join("/")} Nr. ${nr}`;
}

/** Text eines SSRQ-Stücks; die Seite der Edition zeigt das ganze Stück
 *  (…/ZH_NF_II_3/SSRQ_ZH_NF_II_3_047) mit allen Überlieferungen. */
export function parseSsrqText(id: string, xml: string): EditionText | null {
  const parts = ssrqParts(id);
  if (!parts) return null;
  const sd = sourceDescOf(xml);
  const nr3 = String(parts.nr).padStart(3, "0");
  return {
    edition: "ssrq",
    id,
    label: ssrqLabel(parts.volume, parts.nr),
    url: `${SSRQ_BASE}/${parts.volume}/SSRQ_${parts.volume}_${nr3}`,
    witness: parts.part != null && parts.part > 1,
    ...witnessOf(sd),
    date: origDateOf(sd),
  };
}

// ── Ratsmanuale ─────────────────────────────────────────────────────────────

/** Stelle in einem Band: Seiten, Folios (Position 2n−1 für recto, 2n für verso) oder
 *  Aufnahmen (Bildnummern ungezählter Teile, nur auf Seiten der Plattform). */
export type RmUnit = "page" | "folio" | "image";

/** Stelle eines edierten Eintrags: «StAZH B II 204, S. 24-25 (Manual des Stadtschreibers)»,
 *  «B II 74, 2. Teil, S. 21», «B II 353, fol. 30v-31r», «B II 4, Teil II, fol. 19v, Eintrag 1». */
export interface RmRef {
  /** Bandnummer wie in den Plattform-IDs, ohne führende Nullen («204», «555a»). */
  band: string;
  unit: Exclude<RmUnit, "image">;
  from: number;
  to: number;
  /** Teil eines Bandes mit eigener Zählung (B II 74: «2. Teil»); die Plattform kennt ihn nicht. */
  part: number | null;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };

function folioPos(n: string, side: string): number {
  return Number(n) * 2 - (side === "r" ? 1 : 0);
}

const RM_REF =
  /\bB II (\d+)\s?([a-z])?(?![\d.])(?:,\s*(?:(\d)\.\s*Teil|Teil\s+(IV|I{1,3})))?,\s*(?:S\.\s*(\d+)(?:\s*(f)\.|\s*[-–]\s*(\d+))?|fol\.\s*(\d+)\s*([rv])(?:\s*[-–]\s*(\d+)?\s*([rv]))?)/;

/** Ratsmanual-Stelle aus der Signatur der Vorlage (erste Nennung von «B II»), sonst null. */
export function parseRmSignature(signature: string): RmRef | null {
  const m = RM_REF.exec(signature);
  if (!m) return null;
  const [, num, letter, partNum, partRoman, pFrom, pF, pTo, fFrom, fSide, fToNum, fToSide] = m;
  const band = `${Number(num)}${letter ?? ""}`;
  const part = partNum ? Number(partNum) : partRoman ? ROMAN[partRoman] : null;
  if (pFrom) {
    const from = Number(pFrom);
    const to = pTo ? Number(pTo) : pF ? from + 1 : from;
    return to < from ? null : { band, unit: "page", from, to, part };
  }
  const from = folioPos(fFrom, fSide);
  const to = fToSide ? folioPos(fToNum ?? fFrom, fToSide) : from;
  return to < from ? null : { band, unit: "folio", from, to, part };
}

/** Sitzung der Plattform mit ihrer Stelle im Band. */
export interface RmSessionSpan {
  id: string;
  band: string;
  date: string | null;
  unit: RmUnit;
  from: number;
  to: number;
}

const RM_IDENT =
  /^StAZH B II (\d+)\s?([a-z])?, (?:S\. (\d+)(?:\s*[–-]\s*(\d+))?|fol\. (\d+)([rv])(?:\s*[–-]\s*(\d+)([rv]))?|Aufn\. (\d+)(?:\s*[–-]\s*(\d+))?)\s*$/;

/** `stazhIdent` bzw. TEI-`<ident>` einer Sitzung: «StAZH B II 204, S. 24–25»,
 *  «StAZH B II 353, fol. 16r–17r», «StAZH B II 74, Aufn. 3–4», «StAZH B II 555 a, S. 3». */
export function parseRmIdent(id: string, ident: string, date: string | null): RmSessionSpan | null {
  const m = RM_IDENT.exec(ident.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const [, num, letter, pFrom, pTo, fFrom, fSide, fTo, fToSide, aFrom, aTo] = m;
  const base = { id, band: `${Number(num)}${letter ?? ""}`, date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
  if (pFrom) return { ...base, unit: "page", from: Number(pFrom), to: Number(pTo ?? pFrom) };
  if (fFrom) return { ...base, unit: "folio", from: folioPos(fFrom, fSide), to: fToSide ? folioPos(fTo, fToSide) : folioPos(fFrom, fSide) };
  return { ...base, unit: "image", from: Number(aFrom), to: Number(aTo ?? aFrom) };
}

export type RmVia = "seite+datum" | "seite" | "datum";
export type RmEntryMatch = { id: string; via: RmVia } | { ambiguous: string[] } | null;

const exactDay = (d: DateRange | null) => (d && d.from === d.to ? d.from : null);

/**
 * Sitzung eines edierten Eintrags im Band: zuerst die Sitzungen, deren Stelle die des
 * Eintrags überschneidet (gleiche Zählung) und deren Datum nicht widerspricht – eine
 * davon gewinnt, bei mehreren die mit demselben Tag. Ohne Überschneidung (Bildnummern,
 * abweichende Zählung) das Datum allein, wenn es im Band eindeutig ist. Mehrere ⇒
 * `ambiguous` (entscheidet der Text oder niemand), keine ⇒ null.
 */
export function matchRmEntry(ref: RmRef, date: DateRange | null, sessions: readonly RmSessionSpan[]): RmEntryMatch {
  const day = exactDay(date);
  const agrees = (s: RmSessionSpan) => !date || !s.date || (s.date >= date.from && s.date <= date.to);
  const cover = sessions.filter((s) => coversRef(s, ref) && agrees(s));
  if (cover.length === 1) return { id: cover[0].id, via: day && cover[0].date === day ? "seite+datum" : "seite" };
  if (cover.length > 1) {
    const same = day ? cover.filter((s) => s.date === day) : [];
    if (same.length === 1) return { id: same[0].id, via: "seite+datum" };
    return { ambiguous: (same.length > 1 ? same : cover).map((s) => s.id) };
  }
  if (!day) return null;
  const sameDay = sessions.filter((s) => s.date === day);
  if (sameDay.length === 1) return { id: sameDay[0].id, via: "datum" };
  return sameDay.length > 1 ? { ambiguous: sameDay.map((s) => s.id) } : null;
}

// ── Textvergleich ───────────────────────────────────────────────────────────

/** Edierter Text: `<text>` ohne Anmerkungen, Lesarten, Streichungen und Kommentar (`back`). */
export function editionBodyText(xml: string): string {
  const text = /<text\b[^>]*>([\s\S]*)<\/text>/.exec(xml.replace(/<teiHeader\b[\s\S]*?<\/teiHeader>/, ""))?.[1] ?? "";
  return teiReadingText(
    text
      .replace(/<back\b[\s\S]*?<\/back>/g, " ")
      .replace(/<note\b[^>]*\/>/g, " ")
      .replace(/<note\b[\s\S]*?<\/note>/g, " ")
      .replace(/<rdg\b[\s\S]*?<\/rdg>/g, " ")
      .replace(/<del\b[\s\S]*?<\/del>/g, " "),
  );
}

/** Text einer Sitzung (RM-TEI): `<text>` wie gelesen. */
export function rmBodyText(xml: string): string {
  const text = /<text\b[^>]*>([\s\S]*)<\/text>/.exec(xml.replace(/<teiHeader\b[\s\S]*?<\/teiHeader>/, ""))?.[1] ?? "";
  return teiReadingText(text);
}

/** Zeilenumbruch im Wort (`<lb break="no"/>`, Trennstrich am Zeilenende) ohne Lücke. */
function teiReadingText(xml: string): string {
  return plainText(xml.replace(/[-¬]?\s*<lb\b[^>]*\bbreak="no"[^>]*\/>\s*/g, "").replace(/\u00ad/g, ""));
}

/**
 * Vergleichswörter in Textfolge: Diakritika weg (übergeschriebenes e, Kringel), ſ/ß, u/v,
 * i/j/y und Doppelbuchstaben vereinheitlicht, nur Wörter ab 5 Buchstaben – die HTR der
 * Plattform und die Edition schreiben dieselbe Vorlage verschieden genau ab.
 */
export function compareSequence(text: string): string[] {
  const norm = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ſ/g, "s")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/v/g, "u")
    .replace(/[jy]/g, "i")
    .replace(/th/g, "t")
    .replace(/dt/g, "t")
    .replace(/ck/g, "k")
    .replace(/tz/g, "z")
    .replace(/([a-z])\1+/g, "$1");
  return norm.split(/[^a-z]+/).filter((w) => w.length >= 5);
}

export function compareWords(text: string): Set<string> {
  return new Set(compareSequence(text));
}

/** Anteil der Wörter des edierten Texts, die im Text der Sitzung vorkommen (0–1). */
export function containment(edition: ReadonlySet<string>, session: ReadonlySet<string>): number {
  if (edition.size === 0) return 0;
  let hit = 0;
  for (const w of edition) if (session.has(w)) hit++;
  return hit / edition.size;
}

/** Ausschnitt für den Textvergleich (Vergleichswörter) und Schrittweite. */
export const TEXT_WINDOW = 40;
const TEXT_WINDOW_STEP = 10;

/**
 * Wie viel des edierten Texts die Sitzung teilt: der ganze Text oder der beste Ausschnitt
 * von TEXT_WINDOW Wörtern, je nachdem, was höher ist. Ein QZH-Stück enthält neben dem
 * Ratsmanual-Eintrag teils weitere Texte (Missive, Abschriften), die in der Sitzung fehlen.
 */
export function textScore(edition: readonly string[], session: ReadonlySet<string>): number {
  let best = containment(new Set(edition), session);
  for (let i = 0; i + TEXT_WINDOW < edition.length + TEXT_WINDOW_STEP; i += TEXT_WINDOW_STEP) {
    const window = new Set(edition.slice(i, i + TEXT_WINDOW));
    if (window.size >= TEXT_MIN_WORDS) best = Math.max(best, containment(window, session));
  }
  return best;
}

/** Ab so vielen Vergleichswörtern trägt der Textvergleich. */
export const TEXT_MIN_WORDS = 12;
/**
 * Je weniger Stelle und Datum belegen, desto mehr Text muss die Sitzung teilen: nach
 * Stelle und Datum TEXT_CONFIRM_MIN; an der Stelle, aber mit anderem Datum
 * TEXT_PICK_MIN_AT_PLACE; auf einer Nachbarseite oder nur am selben Tag TEXT_PICK_MIN –
 * beide nur mit TEXT_PICK_MARGIN Abstand zur zweitbesten Sitzung des Prüfkreises.
 * Verrauschte HTR: richtige Sitzungen teilen von Hand geprüft 40–48 % (QZH_164, 200, 206),
 * falsche im Prüfkreis bis ~33 %.
 */
export const TEXT_CONFIRM_MIN = 0.3;
export const TEXT_PICK_MIN_AT_PLACE = 0.4;
export const TEXT_PICK_MIN = 0.5;
export const TEXT_PICK_MARGIN = 0.2;
/** Seiten (bzw. Folio-Positionen) um die Stelle, deren Sitzungen der Text mitprüft. */
export const PAGE_SLACK = 2;

/**
 * Sitzungen, deren Text der Vergleich prüft: um die Stelle (± PAGE_SLACK, gleiche
 * Zählung) und am selben Tag, unabhängig vom Datum. Die Plattform trennt und datiert die
 * Sitzungen aus der HTR, ihre Daten weichen teils um Tage ab (B II 824, S. 66–68: 7. statt
 * 10.2.1739; B II 703: «23 ten augusti» als «2. Augusti» gelesen).
 */
export function textPool(ref: RmRef, date: DateRange | null, sessions: readonly RmSessionSpan[]): RmSessionSpan[] {
  const day = exactDay(date);
  return sessions.filter(
    (s) => (s.unit === ref.unit && s.from <= ref.to + PAGE_SLACK && ref.from - PAGE_SLACK <= s.to) || (day != null && s.date === day),
  );
}

/** Textanteil einer Sitzung des Prüfkreises; `atPlace`: sie deckt die Stelle des Eintrags ab. */
export interface TextScore {
  id: string;
  score: number;
  atPlace: boolean;
}

/** Deckt die Sitzung die Stelle des Eintrags ab (gleiche Zählung)? */
export function coversRef(s: RmSessionSpan, ref: RmRef): boolean {
  return s.unit === ref.unit && s.from <= ref.to && ref.from <= s.to;
}

/** Die Sitzung, die klar am meisten Text teilt (Mindestanteil je Lage und Abstand), sonst null. */
export function pickByText(scores: readonly TextScore[]): TextScore | null {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const [best, second] = sorted;
  if (!best || best.score < (best.atPlace ? TEXT_PICK_MIN_AT_PLACE : TEXT_PICK_MIN)) return null;
  if (second && best.score - second.score < TEXT_PICK_MARGIN) return null;
  return best;
}

export type RmDecision =
  | { id: string; via: RmVia | "text"; score: number | null }
  | {
      rejected: "keine Sitzung" | "mehrdeutig" | "Text weicht ab" | "nur Datum";
      candidates: string[];
      scores: TextScore[];
    };

/**
 * Übernehmen oder nicht. Mit genug edierten Wörtern (TEXT_MIN_WORDS) entscheidet der
 * Text: Die Sitzung nach Stelle und Datum gilt, wenn sie TEXT_CONFIRM_MIN teilt und keine
 * andere aus dem Prüfkreis (textPool) klar mehr; sonst die Sitzung, die klar am meisten
 * teilt (`text`), oder keine. Ohne Text (weitere Überlieferungen der Rechtsquellen
 * beschreiben die Vorlage nur) genügt die eindeutige Stelle, das Datum allein nicht.
 */
export function decideRmMatch(match: RmEntryMatch, editionWords: number, scores: readonly TextScore[]): RmDecision {
  const candidates = match ? ("ambiguous" in match ? match.ambiguous : [match.id]) : [];
  const strict = match && "id" in match ? match : null;
  if (editionWords < TEXT_MIN_WORDS) {
    if (strict && strict.via !== "datum") return { id: strict.id, via: strict.via, score: null };
    return { rejected: strict ? "nur Datum" : match ? "mehrdeutig" : "keine Sitzung", candidates, scores: [] };
  }
  const clear = pickByText(scores);
  if (strict) {
    const own = scores.find((s) => s.id === strict.id)?.score ?? 0;
    // Das Datum allein (Stelle passt nicht) braucht so viel Text wie eine Wahl nach Text.
    const need = strict.via === "datum" ? TEXT_PICK_MIN : TEXT_CONFIRM_MIN;
    if (own >= need && (!clear || clear.id === strict.id)) return { id: strict.id, via: strict.via, score: own };
  }
  if (clear) return { id: clear.id, via: "text", score: clear.score };
  return { rejected: strict ? "Text weicht ab" : match ? "mehrdeutig" : "keine Sitzung", candidates, scores: [...scores] };
}

// ── Ergebnis ────────────────────────────────────────────────────────────────

/** Eintrag der Web-Liste je Text. Titel nur, wo die Seite ihn braucht: bei Ratsmanual-
 *  Verweisen (welcher Eintrag der Sitzung ediert ist) und wenn eine Verzeichnungseinheit
 *  mehrere Stücke hat (sie zu unterscheiden); sonst trägt die Katalogseite ihren eigenen. */
export interface EditionLinkText {
  edition: EditionKey;
  label: string;
  url: string;
  witness?: true;
  title?: string;
}

export interface EditionSourceMeta {
  repo: string;
  branch: string;
  commit: string;
  /** Gelesene Texte (Stücke bzw. Texte von Stücken). */
  texts: number;
}

export interface EditionLinksFile {
  meta: {
    built: string;
    /** Prüfsumme über texts/catalog/rm: unverändert ⇒ Datei bleibt stehen. */
    hash: string;
    editions: Record<EditionKey, EditionSourceMeta>;
    counts: { texts: number; catalogIds: number; rmDocs: number };
  };
  texts: Record<string, EditionLinkText>;
  /** Katalog-ID → Text-IDs. */
  catalog: Record<string, string[]>;
  /** RM-Dokument-ID → Text-IDs. */
  rm: Record<string, string[]>;
}

const natural = new Intl.Collator("de", { numeric: true }).compare;

/** Liste für die Web-App: Texte mit Katalog-ID oder Ratsmanual-Eintrag, sortiert. */
export function buildEditionLinks(
  texts: readonly EditionText[],
  rmByText: ReadonlyMap<string, string>,
): Pick<EditionLinksFile, "texts" | "catalog" | "rm"> {
  const catalog = new Map<number, string[]>();
  const rm = new Map<string, string[]>();
  const used = new Map<string, EditionLinkText>();
  const perId = new Map<number, number>();
  for (const t of texts) for (const c of t.catalogIds) perId.set(c, (perId.get(c) ?? 0) + 1);
  for (const t of [...texts].sort((a, b) => natural(a.id, b.id))) {
    const rmId = rmByText.get(t.id);
    if (t.catalogIds.length === 0 && !rmId) continue;
    const entry: EditionLinkText = { edition: t.edition, label: t.label, url: t.url };
    if (t.witness) entry.witness = true;
    const shared = t.catalogIds.some((c) => (perId.get(c) ?? 0) > 1);
    if ((rmId || shared) && t.title) entry.title = t.title;
    used.set(t.id, entry);
    for (const c of t.catalogIds) catalog.set(c, [...(catalog.get(c) ?? []), t.id]);
    if (rmId) rm.set(rmId, [...(rm.get(rmId) ?? []), t.id]);
  }
  return {
    texts: Object.fromEntries(used),
    catalog: Object.fromEntries([...catalog].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v])),
    rm: Object.fromEntries([...rm].sort((a, b) => natural(a[0], b[0]))),
  };
}

/** Berichtszeile zu den Vorlagen in anderen Archiven (Texte mit Link auf einen fremden
 *  scopeQuery-Katalog): «96 Vorlagen in anderen Archiven (Stadtarchiv Zürich 93, …), nicht verlinkt». */
export function otherArchivesLine(texts: readonly EditionText[]): string {
  const foreign = texts.filter((t) => t.otherArchives.length > 0);
  if (foreign.length === 0) return "keine Vorlagen in anderen Archiven";
  const byArchive = new Map<string, number>();
  for (const t of foreign) for (const a of new Set(t.otherArchives.map((o) => o.archive))) byArchive.set(a, (byArchive.get(a) ?? 0) + 1);
  if (foreign.length === 1) return `1 Vorlage in einem anderen Archiv (${[...byArchive.keys()].join(", ")}), nicht verlinkt`;
  const parts = [...byArchive].sort((a, b) => b[1] - a[1] || natural(a[0], b[0])).map(([a, n]) => `${a} ${n}`);
  return `${foreign.length} Vorlagen in anderen Archiven (${parts.join(", ")}), nicht verlinkt`;
}

/** JSON mit einem Eintrag pro Zeile (lesbare Diffs), Schlüssel in fester Reihenfolge. */
export function serializeEditionLinks(file: EditionLinksFile): string {
  const block = (obj: Record<string, unknown>) => {
    const lines = Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return lines.length ? `{\n${lines.join(",\n")}\n  }` : "{}";
  };
  return [
    "{",
    `  "meta": ${JSON.stringify(file.meta)},`,
    `  "texts": ${block(file.texts)},`,
    `  "catalog": ${block(file.catalog)},`,
    `  "rm": ${block(file.rm)}`,
    "}",
    "",
  ].join("\n");
}
