/**
 * Personen, Orte und Organisationen aus dem Titelschema des Archivkatalogs.
 *
 * Ausdrücklich gewählte Heuristik (Entscheid Tim 2026-10-28, «NER +
 * Titelschema»): Die Erschliessung folgt festen Mustern, die das NER-Modell
 * für Fliesstext nur teilweise trifft:
 *
 * - Personendossier: «Nachname, Vorname (geb. 1904), Beruf, von Ort, in Ort»,
 *   auch mit Lebensjahren «(1858-1938)», «geborene X», Nachname in
 *   Grossbuchstaben (Polizei-/Gerichtsregister) und vorangestelltem Kontext
 *   («Ausschreibungsgrund: …», «Hinterlassenschaft des …»), Gegenpartei
 *   «…, gegen Nachname, Vorname».
 * - Ehedatenbank (E III, TAI): «Nachname, Vorname, Ort, getraut mit Nachname,
 *   Vorname, Ort».
 * - Patentschriften (PAT): «Nachname, Vorname, Ort: Titel» bzw. «Firma, Ort: Titel».
 * - Firmen (Handelsregister u. ä.): «WEBEREI TÖSSTAL AG, Bauma».
 *
 * Personendossiers brauchen ein Indiz. Stark: Lebensjahre oder «geborene».
 * Schwach (Ort «von/in …», Ort in Klammern) oder keines (Titel nur «Nachname,
 * Vorname»): dann müssen alle Vornamen im Lexikon `givenNames` stehen – sonst
 * würden «Akten, Protokolle» oder «Zürichsee, Horgen» zu Personen. Ebenso eine
 * zweite Person «…, und Maria Muster»: ohne Lexikon wurde «…, und Bezirksrat
 * Hinwil, in Hinwil» zur Person und «bezirksrat» über 21 Dossiers zum Vornamen.
 * build.ts gewinnt das Lexikon in einem ersten Durchlauf aus Ehedatenbank, stark
 * belegten Dossiers und KRDB (`GivenNameLexicon`, ohne Anreden, Titel, Ämter,
 * Partikeln und Verwandtschaftswörter). Gelesen wird die erste Titelzeile;
 * Folgezeilen («SVP, Kantonsrat 1975-1978») wertet krdbAssign.ts aus.
 * Pur, unit-getestet in titleSchema.test.ts (erfundene Namen).
 */

import { isPersonPrefix } from "../../../apps/web/src/lib/entityKey.ts";

export interface TitlePerson {
  last: string;
  first: string;
  born?: number;
  died?: number;
  /** «geborene X». */
  birthName?: string;
}

export interface TitleEntities {
  schema: "person" | "ehe" | "patent" | "firm" | null;
  persons: TitlePerson[];
  places: string[];
  organizations: string[];
}

export interface TitleSchemaOptions {
  /** Vornamen in Kleinschreibung (`givenNameToken`), die ohne starkes Indiz genügen. */
  givenNames?: ReadonlySet<string>;
}

const NONE: TitleEntities = { schema: null, persons: [], places: [], organizations: [] };

const PARTICLE = "(?:von|vom|van|de|di|da|del|du|la|le|zu|zum|zur)";
const WORD = "\\p{Lu}[\\p{L}'’\\-]*";
const LAST = `(?:${PARTICLE}\\s+)?${WORD}(?:\\s+${PARTICLE}\\s+${WORD})?`;
const FIRST = `${WORD}\\.?(?:\\s+${WORD}\\.?)*`;
const HEAD = new RegExp(`^(${LAST}),\\s+(${FIRST})(.*)$`, "u");
const LAST_ONLY = new RegExp(`^${LAST}$`, "u");
const FIRST_ONLY = new RegExp(`^${FIRST}$`, "u");

/** Ortsname: Wort(e) mit Grossbuchstaben, Zusätze «am/an/bei …», Kantonskürzel. */
const PLACE = `(?:St\\.\\s+)?${WORD}(?:\\s+(?:am|an|bei|ob|im)\\s+${WORD}|\\s+a\\.\\s*[AR]\\.)?(?:\\s+[A-Z]{2}\\b)?`;
const PLACE_ONLY = new RegExp(`^${PLACE}$`, "u");
const PLACE_AFTER = new RegExp(`(?:^|[,;]|\\s)(?:von\\s+und\\s+in|von|in|aus)\\s+(${PLACE}(?:\\s+und\\s+${PLACE})*)`, "gu");
const PLACE_IN_PARENS = new RegExp(`^\\s*\\((${PLACE})\\)`, "u");
/** «(geb. 1904)», «(gest. 1932)», «(1858-1938)». */
const LIFE = /\((?:geb\.\s*(\d{4})|gest\.\s*(\d{4})|(\d{4})\s*[-–]\s*(\d{4}))\)/;
const BIRTH_NAME = new RegExp(`geb(?:orene|\\.)\\s+(${WORD})`, "u");
/** Verwandtschaft vor dem Namen der zweiten Person («…, und Gattin Hertha Muster»). */
const RELATIVE = "(?:Ehefrau|Ehemann|Gattin|Gatte|Gemahlin|Gemahl|Sohn|Tochter|Bruder|Schwester|Mutter|Vater)";
/** Weitere Personen: «…, und Maria Muster» bzw. «…, und/gegen Muster, Jakob». */
const AND_PERSON = new RegExp(`,\\s+und\\s+(?:${RELATIVE}\\s+)?(${WORD})\\s+(${WORD})(?=[,;\\s]|$)`, "gu");
const AGAINST_PERSON = new RegExp(`(?:,\\s+|\\s)(?:gegen|und)\\s+(${LAST}),\\s+(${FIRST})`, "gu");
const COMPANY = /\b(?:AG|SA|GmbH|Co\.?|Cie\.?|KG|Gesellschaft|Genossenschaft|Verein|Werke?|Fabrik|Firma|Stiftung|Anstalt|Söhne|Gebrüder|Gebr\.)(?![\p{L}])|&/u;
/** Nomen, die als «Vorname» auf ein Firmen- oder Sachtitelschema deuten. */
const NOUN_SUFFIX = /(?:ung|heit|keit|schaft|erei|tum|ismus|werk|wesen|amt|anstalt|fabrik|verband)$/i;
const ACADEMIC = /^(?:Dr|Prof|Ing|Dipl|lic|PD)\b/i;

/** Vornamens-Token für das Lexikon: Kleinschreibung, Abkürzungspunkt weg. */
export function givenNameToken(t: string): string {
  return t.toLowerCase().replace(/\.$/, "");
}

/** Wörter an der Stelle eines Vornamens, die keine sind: Namenspartikeln («und De Bin,
 *  Ida»), Verwandtschaft («und Ehefrau Eva …»). Anreden, Titel und Ämter («Frau», «Dr.»,
 *  «Bezirksrat») erkennt `isPersonPrefix` (entityKey.ts, die Wörter, die personKey überspringt). */
const NOT_GIVEN = new Set([
  "von", "vom", "van", "de", "di", "da", "del", "du", "la", "le", "zu", "zum", "zur", "und",
  "ehefrau", "ehemann", "gattin", "gatte", "gemahlin", "gemahl", "sohn", "söhne", "tochter", "töchter",
  "bruder", "schwester", "mutter", "vater", "kind", "kinder", "eltern", "geschwister", "witwer",
]);

/** Lexikon-Token eines Vornamens oder null. Klammern und Anführungszeichen am Rand fallen weg
 *  (KRDB-Vornamen wie «Konrad "Kuno"», «Hans (Peter Paul)»); keine Initialen, keine Tokens mit
 *  anderen Satzzeichen oder Ziffern, keine Partikeln, Verwandtschafts-, Anrede- oder Amtswörter. */
export function lexiconToken(tok: string): string | null {
  const t = tok.replace(/^[(\["'„“”«»‹›]+|[)\]"'„“”«»‹›,;:]+$/gu, "");
  if (!/^\p{L}[\p{L}'’-]*\.?$/u.test(t) || /^\p{L}\.?$/u.test(t)) return null;
  const g = givenNameToken(t);
  return NOT_GIVEN.has(g) || isPersonPrefix(g) ? null : g;
}

/** Vornamen-Lexikon des Aufbaus (build.ts, erster Durchlauf): Vornamen der Ehedatenbank und
 *  der stark belegten Personendossiers ab `min` Belegen, KRDB-Vornamen immer. */
export class GivenNameLexicon {
  private readonly counts = new Map<string, number>();
  private readonly krdb = new Set<string>();

  addTitlePerson(first: string): void {
    for (const tok of first.split(/\s+/)) {
      const g = lexiconToken(tok);
      if (g) this.counts.set(g, (this.counts.get(g) ?? 0) + 1);
    }
  }

  /** Abkürzungen («Joh.») nur aus Titeln, wo sie belegt sind. */
  addKrdb(first: string): void {
    for (const tok of first.split(/\s+/)) {
      const g = tok.endsWith(".") ? null : lexiconToken(tok);
      if (g) this.krdb.add(g);
    }
  }

  build(min: number): Set<string> {
    const out = new Set([...this.counts].filter(([, n]) => n >= min).map(([t]) => t));
    for (const t of this.krdb) out.add(t);
    return out;
  }
}

/** Alle Vornamen der Folge stehen im Lexikon. Initialen und Anreden, Titel oder Ämter
 *  («Frau», «Dr.», «Pfarrer») zählen nicht; mindestens ein Vorname muss bleiben, sonst
 *  wäre «Bezirksrat Zürich» eine Person. «St.» zählt mit («St. Johann» ist ein Ort). */
export function inLexicon(seq: string, lex: ReadonlySet<string>): boolean {
  const tokens = seq.split(/\s+/).filter((t) => t && !/^\p{Lu}\.$/u.test(t) && !(isPersonPrefix(t) && !/^(?:St|Sankt)\.?$/u.test(t)));
  return tokens.length > 0 && tokens.every((t) => lex.has(givenNameToken(t)));
}

const LOWER_WORDS = new Set(["der", "die", "das", "des", "dem", "den", "und", "für", "zur", "zum", "von", "vom", "am", "an", "im", "in", "auf", "bei", "mit", "einer", "eines", "ein", "eine", "aus", "zu"]);
const LEGAL_FORMS: Record<string, string> = { ag: "AG", sa: "SA", kg: "KG", gmbh: "GmbH", co: "Co", cie: "Cie" };

/** Grossgeschriebene Wörter lesbar machen: «BROBECK» → «Brobeck», «MÜLLER-HUBER» →
 *  «Müller-Huber», «KRANKENKASSE DER KIRCHGEMEINDE» → «Krankenkasse der Kirchgemeinde»,
 *  Rechtsformen bleiben gross. Gemischt geschriebene Wörter bleiben unverändert. */
function nameCase(s: string): string {
  return s.replace(/[\p{L}'’\-]+/gu, (w, offset: number) => {
    if (w !== w.toUpperCase() || !/\p{Lu}{2}/u.test(w)) return w;
    const lower = w.toLowerCase();
    if (LEGAL_FORMS[lower]) return LEGAL_FORMS[lower];
    if (offset > 0 && LOWER_WORDS.has(lower)) return lower;
    return lower.replace(/(^|[\-'’])(\p{L})/gu, (_: string, sep: string, c: string) => sep + c.toUpperCase());
  });
}

function knownGiven(first: string, opts: TitleSchemaOptions): boolean {
  return !!opts.givenNames && inLexicon(first, opts.givenNames);
}

/** «Frau», «Dr.», «Prof.» an der Stelle des Vornamens (so weit liess sie das Lexikon bis 2026-11
 *  zu, weil sie darin standen). Nicht «Herr», «Witwe» und Ämter: «Johans, Herr von Musterberg,
 *  …» und «Hans von Musterwil, Ritter, Burgermeister, …» beginnen Urkunden-Regesten. */
const TITLE_WORD = /^(?:Dr|Prof|Frau)\.?$/u;

/** Nur Anrede oder Titel an der Stelle des Vornamens («Muster, Dr. med., in Horgen, gegen …»,
 *  «Muster, Frau, in Uster»): eine Person ohne Vornamen. Wie ein Lexikon-Vorname nur mit
 *  Lexikon, also nicht in `needsNer` (die NER-Auswahl bleibt gleich). */
function titlesOnly(first: string, opts: TitleSchemaOptions): boolean {
  return !!opts.givenNames && first.split(/\s+/).every((t) => TITLE_WORD.test(t));
}

function plausibleFirst(first: string): boolean {
  const tokens = first.split(/\s+/);
  return tokens.length <= 4 && tokens.every((t) => t.length <= 15 && !NOUN_SUFFIX.test(t));
}

function placesIn(rest: string): string[] {
  const out: string[] = [];
  for (const m of rest.matchAll(PLACE_AFTER)) {
    for (const p of m[1].split(/\s+und\s+/)) out.push(p.trim());
  }
  const paren = PLACE_IN_PARENS.exec(rest);
  if (paren && !/\d/.test(paren[1])) out.push(paren[1].trim());
  return out;
}

/** «Nachname, Vorname[, Ort …]» ohne Indizprüfung (Ehedatenbank, Patente). */
function simplePerson(part: string): { person: TitlePerson; extra: string[] } | null {
  const bits = part
    .split(/\s*,\s*/)
    .map((b) => b.trim())
    .filter((b) => b && !ACADEMIC.test(b));
  if (bits.length < 2) return null;
  const [last, first, ...extra] = bits;
  if (!LAST_ONLY.test(last) || !FIRST_ONLY.test(first) || !plausibleFirst(first)) return null;
  return { person: { last: nameCase(last), first }, extra };
}

function parseEhe(line: string): TitleEntities | null {
  const m = /^(.+?),?\s+getraut mit\s+(.+)$/.exec(line);
  if (!m) return null;
  const out: TitleEntities = { schema: "ehe", persons: [], places: [], organizations: [] };
  for (const side of [m[1], m[2]]) {
    const p = simplePerson(side);
    if (!p) continue;
    out.persons.push(p.person);
    out.places.push(...p.extra.filter((e) => PLACE_ONLY.test(e)));
  }
  return out.persons.length > 0 ? out : null;
}

function parsePatent(line: string): TitleEntities | null {
  const colon = line.indexOf(": ");
  if (colon < 0) return null;
  const out: TitleEntities = { schema: "patent", persons: [], places: [], organizations: [] };
  for (const applicant of line.slice(0, colon).split(/,\s+und\s+/)) {
    const bits = applicant.split(/\s*,\s*/).filter((b) => b && !ACADEMIC.test(b));
    const p = !COMPANY.test(applicant) && bits.length <= 3 ? simplePerson(applicant) : null;
    if (p) {
      out.persons.push(p.person);
      out.places.push(...p.extra.filter((e) => PLACE_ONLY.test(e)));
    } else if (bits.length >= 2 && PLACE_ONLY.test(bits[bits.length - 1])) {
      out.organizations.push(bits.slice(0, -1).join(", "));
      out.places.push(bits[bits.length - 1]);
    } else if (bits.length > 0) {
      out.organizations.push(bits.join(", "));
    }
  }
  return out.persons.length + out.organizations.length > 0 ? out : null;
}

/** Mehr Wörter hat kein Firmenname mit Rechtsform; längere Köpfe sind Sätze
 *  («… danken für die Errichtung der Wäckerling-Stiftung durch …»). */
const FIRM_MAX_WORDS = 8;

function parseFirm(line: string): TitleEntities | null {
  // Ein Komma nach Ergänzungsstrich trennt nicht («FUHRHALTER-, PFERDE- UND …»).
  const [head, ...rest] = line.split(/(?<!-)\s*,\s*/);
  const caps = /^[\p{Lu}0-9 .,&\-'’]+$/u.test(head) && (head.match(/\p{Lu}{2,}/gu) ?? []).length >= 2;
  // Über das Firmenwort nur kurze Köpfe ohne Doppelpunkt: «Wettingen AG: Teil der Limmat»
  // ist ein Plan im Aargau, «Wiesenstrasse 24: … der Firma X» eine Bauakte.
  const named = COMPANY.test(head) && rest.length > 0 && !head.includes(":") && head.split(/\s+/).length <= FIRM_MAX_WORDS;
  if (!caps && !named) return null;
  if (head.length < 4) return null;
  const places = placesIn(", " + rest.join(", "));
  const last = rest[rest.length - 1];
  if (places.length === 0 && last && PLACE_ONLY.test(last)) places.push(last);
  return { schema: "firm", persons: [], places, organizations: [nameCase(head)] };
}

function parsePersonDossier(line: string, opts: TitleSchemaOptions): TitleEntities | null {
  // Kontext vor dem Namen: «Ausschreibungsgrund: SPIRIG, …», «Hinterlassenschaft des REIMANN, …».
  let s = line.replace(/^[^:]{2,60}:\s+(?=\p{Lu})/u, "");
  s = s.replace(/^\p{Lu}[\p{Ll}.]*(?:\s+\p{Ll}[\p{L}.]*)+\s(?=\p{Lu}{3}[\p{Lu}\-]*,\s)/u, "");
  const m = HEAD.exec(s);
  if (!m) return null;
  const [, rawLast, first, rest] = m;
  if (COMPANY.test(`${rawLast}, ${first}`) || !plausibleFirst(first)) return null;
  const life = LIFE.exec(rest);
  const birthName = BIRTH_NAME.exec(rest);
  const places = placesIn(rest);
  const strong = !!life || !!birthName;
  const bare = rest.trim() === "";
  if (!strong && !((places.length > 0 || bare) && (knownGiven(first, opts) || titlesOnly(first, opts)))) return null;
  const person: TitlePerson = { last: nameCase(rawLast), first };
  if (life) {
    const born = life[1] ?? life[3];
    const died = life[2] ?? life[4];
    if (born) person.born = Number(born);
    if (died) person.died = Number(died);
  }
  if (birthName) person.birthName = nameCase(birthName[1]);
  const persons = [person];
  // Ohne Lexikon (erster Durchlauf) keine zweite Person: «…, und Bezirksrat Hinwil».
  for (const m of rest.matchAll(AND_PERSON)) {
    if (plausibleFirst(m[1]) && knownGiven(m[1], opts)) persons.push({ first: m[1], last: nameCase(m[2]) });
  }
  for (const m of rest.matchAll(AGAINST_PERSON)) {
    if (plausibleFirst(m[2])) persons.push({ last: nameCase(m[1]), first: m[2] });
  }
  return { schema: "person", persons, places, organizations: [] };
}

export function parseTitleEntities(title: string, signature: string, opts: TitleSchemaOptions = {}): TitleEntities {
  const line = (title.split("\n")[0] ?? "").trim();
  if (!line) return NONE;
  if (/^PAT\b/.test(signature)) return parsePatent(line) ?? NONE;
  return parseEhe(line) ?? parsePersonDossier(line, opts) ?? parseFirm(line) ?? NONE;
}

/** Anzeigeform «Vorname Nachname». */
export function personDisplay(p: TitlePerson): string {
  return `${p.first} ${p.last}`;
}
