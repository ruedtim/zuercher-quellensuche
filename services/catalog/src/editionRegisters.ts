/**
 * Register einer Edition (QZH: person/person.xml, place/place.xml und die Ergänzungen
 * person-additions.xml, place-additions.xml): Normnamen der Personen (GND oder eigener
 * Schlüssel), Ortsnamen mit Koordinaten. Die Stücke verweisen mit `persName/@ref` bzw.
 * `placeName/@ref` darauf; ohne Eintrag gilt die Form im Text.
 *
 * Personen: `@ref` ist «GND_<Nummer>», ein eigener Schlüssel («QZH_087_252») oder schon der
 * Normname («Kriesi, Jörg», «Donatus»). Den Normnamen einer GND-Person führen die Ergänzungen
 * («Bullinger, Heinrich»), sonst die GND selbst (Vorzugsname, `gndRecords`, vom Aufbau einmal
 * geholt) – aber nur, wenn er mit einer Schreibung der Edition ein Wort teilt (sonst ist der
 * GND-Verweis der Edition falsch: «durch Nebukadnezar» trägt die GND von Joachim Neander).
 * Erst ohne beides nimmt das Register die erste Schreibung aus person.xml – die ist oft
 * flektiert oder ein Amt («dechan» für Rudolf Gwalther). Gleicher Vorzugsname für zwei
 * GND-Personen ⇒ Lebensdaten dahinter («Ulrich Zwingli (1556–1601)», der Enkel). Angezeigt wird
 * «Vorname Nachname» – so filtern auch die anderen Reiter (entityKey.ts).
 *
 * Orte: `@ref` ist «LOC_<Breite>_<Länge>» oder schon der Name («Mähren», «Knonau»; die gleich
 * lautenden Einträge in place.xml sind teils Fehlgriffe: «Mähren» mit der Form «land»). Name
 * aus den Ergänzungen (heutige Form: «Aarau» für «Arauw»), sonst der Name des Verweises, sonst
 * die heutige Schreibung unter den Formen aus `place/@n`, wenn ein Ortsverzeichnis sie kennt
 * und sie der ersten ähnelt («Kyburg» statt «Kyburch»; die Liste nennt teils Nachbarorte:
 * «Bůchenegg, Egg»), sonst die erste Form.
 *
 * Die übrigen Schreibungen eines Eintrags gelten nicht für alle Stücke: person.xml und
 * place.xml sammeln jede Form, die je mit dem Verweis ausgezeichnet wurde, Fehlgriffe
 * eingeschlossen («Heinrich Schnider» unter Hans Schnyder, «Regenstorff» unter Regensberg).
 *
 * Pur, unit-getestet in editionRegisters.test.ts.
 */

import { XMLParser } from "fast-xml-parser";
import { placeKey } from "../../../apps/web/src/lib/entityKey.ts";
import { editDistance, isPlaceSpelling, sharesNameWord } from "../../../apps/web/src/lib/nameSpelling.ts";

// Geteilt mit der Volltextsuche der Ratsmanuale (apps/web/src/lib/rmNames.ts).
export { isPlaceSpelling, sharesNameWord };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ["person", "place", "persName", "placeName"].includes(name),
});

type Obj = Record<string, unknown>;

const text = (v: unknown): string => {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (v && typeof v === "object" && "#text" in (v as Obj)) return text((v as Obj)["#text"]);
  return "";
};
const attr = (v: unknown, name: string): string => (v && typeof v === "object" ? text((v as Obj)[name]) : "");

function deep(o: unknown, key: string): unknown[] {
  const out: unknown[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x as Obj)) {
        if (k === key) (Array.isArray(v) ? v : [v]).forEach((e) => out.push(e));
        else walk(v);
      }
    }
  };
  walk(o);
  return out;
}

const NORM_RE = /^([^,]+),\s*([^,]+)$/;

/** Spannen in Zusätzen mit Halbgeviertstrich wie gndLifeDates («(1554-1621)» → «(1554–1621)»). */
const enDashSpans = (s: string) => s.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");

/** «Nachname, Vorname» → «Vorname Nachname»; Zusätze in Klammern ans Ende, Spannen darin mit
 *  Halbgeviertstrich («Kambli, Hans (1554-1621)» → «Hans Kambli (1554–1621)»); andere Formen
 *  unverändert. */
export function displayName(norm: string): string {
  const extras = (norm.match(/\([^()]*\)/g) ?? []).map(enDashSpans);
  const core = norm.replace(/\s*\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
  const m = NORM_RE.exec(core);
  if (m) return [`${m[2].trim()} ${m[1].trim()}`, ...extras].join(" ");
  // Vorname nur in Klammern («Hedinger, (Hans?)»): wie bisher umgestellt.
  const whole = NORM_RE.exec(norm.trim());
  return whole ? `${whole[2].trim()} ${whole[1].trim()}` : norm.replace(/\s+/g, " ").trim();
}

/** Verweis als Name mit Lebensjahren («Bullinger, Heinrich (1504-1575)») → Name ohne Jahre
 *  («Heinrich Bullinger») und Jahre wie gndLifeDates («1504–1575»); sonst null. */
export function datedNameRef(ref: string): { name: string; dates: string } | null {
  const m = /^(.*\S)\s*\((\d{1,4})\s*[-–]\s*(\d{1,4})\)$/.exec(ref.trim());
  return m && !/[()]/.test(m[1]) ? { name: displayName(m[1]), dates: `${m[2]}–${m[3]}` } : null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);

/** Herkunfts- und Familienteil eines Beinamens («von Flüe», «vom Luchs»): gehört zum Namen. */
const PARTICLE_RE = /^(?:von|vom|zu|zum|zur|de|di|da|van)\s/i;

/** Vorzugsname einer Person aus der GND (lobid-gnd, JSON-LD) als Anzeige: «Gwalther,
 *  Rudolf» → «Rudolf Gwalther», «Cham, Bernhard von» → «Bernhard von Cham»; Einzelnamen mit
 *  Beinamen: Herkunft zum Namen («Nikolaus von Flüe (Heiliger)», «Hans von
 *  Habsburg-Laufenburg»), sonst wie die GND mit Komma («Paulus, Apostel, Heiliger») – in
 *  Klammern hiesse der Name für die Vergleichsschlüssel nur «Paulus»; Familien und
 *  Körperschaften → null. */
export function gndDisplayName(record: unknown): string | null {
  const e = (record as { preferredNameEntityForThePerson?: Record<string, unknown> } | null)?.preferredNameEntityForThePerson;
  if (!e || typeof e !== "object") return null;
  const part = (k: string) => strings(e[k]).join(" ").trim();
  const surname = part("surname");
  if (surname) return [part("forename"), part("prefix"), surname].filter(Boolean).join(" ");
  const personal = part("personalName");
  if (!personal) return null;
  const rest = strings(e.nameAddition).flatMap((a) => a.split(/,\s*/)).filter(Boolean);
  let base = [personal, part("counting")].filter(Boolean).join(" ");
  if (rest.length > 0 && PARTICLE_RE.test(rest[0])) base += ` ${rest.shift()}`;
  if (rest.length === 0) return base;
  return base.split(/\s+/).length >= 2 ? `${base} (${rest.join(", ")})` : `${base}, ${rest.join(", ")}`;
}

/** Lebensjahre aus der GND («1556–1601», «–1024»), ohne Angaben null. */
export function gndLifeDates(record: unknown): string | null {
  const year = (k: string) => /^-?\d{1,4}/.exec(strings((record as Obj | null)?.[k])[0] ?? "")?.[0] ?? "";
  const b = year("dateOfBirth");
  const d = year("dateOfDeath");
  return b || d ? `${b}–${d}` : null;
}

/** Was der Aufbau von einer GND-Person braucht (Cache editions-gnd-cache.json). */
export interface GndRecord {
  /** Anzeige (gndDisplayName), null bei Familien und Körperschaften. */
  name: string | null;
  /** Vorzugs- und Variantennamen der GND (für die Plausibilität). */
  names: string[];
  /** Lebensjahre (gndLifeDates). */
  dates: string | null;
}

export function gndRecordOf(record: unknown): GndRecord {
  const r = (record ?? {}) as Obj;
  return {
    name: gndDisplayName(record),
    names: [...strings([r.preferredName]), ...strings(r.variantName)],
    dates: gndLifeDates(record),
  };
}

/** Heutige Schreibung unter den Formen eines Ortes: die erste, wenn das Ortsverzeichnis sie
 *  kennt, sonst die ähnlichste bekannte (Vergleichsschlüssel höchstens 2 Zeichen und ein
 *  Drittel auseinander), sonst null. */
export function modernSpelling(forms: readonly string[], known: ReadonlySet<string>): string | null {
  const first = forms[0];
  if (!first) return null;
  if (known.has(first)) return first;
  const k0 = placeKey(first);
  if (!k0) return null;
  let best: { form: string; d: number } | null = null;
  for (const f of forms.slice(1)) {
    const k = placeKey(f);
    if (!known.has(f) || !k) continue;
    const d = editDistance(k0, k);
    if (d <= 2 && d <= Math.floor(Math.max(k0.length, k.length) / 3) && (!best || d < best.d)) best = { form: f, d };
  }
  return best?.form ?? null;
}

/** Formen aus `place/@n` (kommagetrennt): Teile, die zusammen einen `placeName` ergeben,
 *  bleiben eine Form («Töss, Kloster», «Zürich, Brunngasse 8»). */
export function placeFormsOf(n: string, placeNames: readonly string[]): string[] {
  const whole = new Set(placeNames);
  const parts = n.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let j = parts.length;
    while (j > i + 1 && !whole.has(parts.slice(i, j).join(", "))) j--;
    out.push(parts.slice(i, j).join(", "));
    i = j;
  }
  return [...new Set([...out, ...placeNames])];
}

export interface ResolvedPerson {
  /** Anzeige «Vorname Nachname» (Facette, Filter über personKey). */
  name: string;
  /** GND-Nummer ohne Präfix. */
  gnd: string | null;
}

export interface ResolvedPlace {
  name: string;
  lat: number | null;
  lon: number | null;
}

export interface GndReport {
  /** [GND, erste Schreibung, Name aus der GND] */
  used: Array<[string, string, string]>;
  /** Verweise, deren GND-Name keiner Schreibung der Edition ähnelt (Fehlgriff der Edition?). */
  rejected: Array<[string, string, string]>;
  /** Verweise mit Lebensjahren, die als Name stehen: [Verweis, Name, GND oder null, ähnliche
   *  GND-Personen (gleicher Name, ein Lebensjahr gleich) zum Prüfen]. */
  dated: Array<[string, string, string | null, string[]]>;
}

export interface ResolvedOrg {
  /** Name im Register; ohne Eintrag die Form im Text. */
  name: string;
}

export interface EditionRegisters {
  person(form: string, ref: string | null): ResolvedPerson;
  place(form: string, ref: string | null): ResolvedPlace;
  /** Organisation (QZH: kein Register, die Form im Text; Rechtsquellen: `org…`). */
  org(form: string, ref: string | null): ResolvedOrg;
  /** Erklärung eines Schlagworts der Edition (Rechtsquellen: Taxonomie), sonst null. */
  keywordGloss(term: string, ref: string | null): string | null;
  /** Orte, deren Name nicht die erste Form ist (modernSpelling), als [erste Form, Name] – für den Bericht. */
  modernizedPlaces(): Array<[string, string]>;
  /** GND-Namen statt der ersten Schreibung – für den Bericht. */
  gndReport(): GndReport;
}

export interface RegisterInput {
  person?: string;
  personAdditions?: string;
  place?: string;
  placeAdditions?: string;
  /** GND-Nummer → Vorzugsname, Varianten und Lebensjahre (gndRecordOf), für Personen ohne Ergänzung. */
  gndRecords?: ReadonlyMap<string, GndRecord>;
  /** Heutige Ortsnamen (Ortsverzeichnis), unter denen modernSpelling wählt. */
  knownPlaces?: ReadonlySet<string>;
}

const GND_RE = /^GND_([0-9X-]+)$/i;
const LOC_RE = /^LOC_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/;

/** Koordinaten aus «LOC_47.36966_8.54145». */
export function coordsOf(ref: string | null): { lat: number; lon: number } | null {
  const m = LOC_RE.exec(ref ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Verweis, der selbst ein Name ist («Kriesi, Jörg», «Mähren»), kein Schlüssel (GND_, QZH_, LOC_, Koordinaten). */
export function isNameRef(ref: string): boolean {
  return /\p{L}/u.test(ref) && !/^(?:_?LOC_?-?\d|QZH_\d|GND_)/i.test(ref);
}

const splitForms = (s: string) => s.split(/,\s*/).map((f) => f.trim()).filter(Boolean);
const uniq = (xs: Iterable<string>) => [...new Set(xs)];

export function buildRegisters(xml: RegisterInput): EditionRegisters {
  // person.xml: je Eintrag die Schreibungen der Stücke («Hainrich Bullingern, Heinrich Bullinger»).
  const personForms = new Map<string, string[]>();
  const personNorm = new Map<string, string>();
  if (xml.person) {
    for (const p of deep(parser.parse(xml.person), "person")) {
      const id = attr(p, "id");
      const forms = deep(p, "persName").flatMap((n) => splitForms(text(n)));
      if (id && forms.length > 0) personForms.set(id, uniq([...(personForms.get(id) ?? []), ...forms]));
    }
  }
  if (xml.personAdditions) {
    for (const n of deep(parser.parse(xml.personAdditions), "persName")) {
      const ref = attr(n, "ref");
      const name = text(n);
      if (ref && name) personNorm.set(ref, name);
    }
  }
  const placeForms = new Map<string, string[]>();
  const placeNorm = new Map<string, string>();
  const placeGeo = new Map<string, { lat: number; lon: number }>();
  if (xml.place) {
    for (const p of deep(parser.parse(xml.place), "place")) {
      const id = attr(p, "id");
      const forms = placeFormsOf(attr(p, "n"), deep(p, "placeName").map(text).filter(Boolean));
      if (id && forms.length > 0) placeForms.set(id, forms);
      const geo = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/.exec(deep(p, "geo").map(text).find(Boolean) ?? "");
      if (id && geo) placeGeo.set(id, { lat: Number(geo[1]), lon: Number(geo[2]) });
    }
  }
  if (xml.placeAdditions) {
    for (const n of deep(parser.parse(xml.placeAdditions), "placeName")) {
      const ref = attr(n, "ref");
      const name = text(n);
      if (ref && name) placeNorm.set(ref, name);
    }
  }

  // GND-Namen: nur plausible (ein Wort gemeinsam mit den Schreibungen der Edition); gleicher
  // Name zweier GND-Personen ⇒ Lebensjahre an den Namen aus der GND.
  const gndName = new Map<string, string>();
  const report: GndReport = { used: [], rejected: [], dated: [] };
  for (const [gnd, rec] of xml.gndRecords ?? []) {
    const ref = `GND_${gnd}`;
    if (personNorm.has(ref) || !rec.name) continue;
    const forms = personForms.get(ref) ?? [];
    if (sharesNameWord([rec.name, ...rec.names], forms)) gndName.set(gnd, rec.name);
    else report.rejected.push([gnd, forms[0] ?? "", rec.name]);
  }
  const owners = new Map<string, Set<string>>();
  const own = (name: string, gnd: string) => owners.set(name, (owners.get(name) ?? new Set()).add(gnd));
  for (const [ref, norm] of personNorm) {
    const gnd = GND_RE.exec(ref)?.[1];
    if (gnd) own(displayName(norm), gnd);
  }
  for (const [gnd, name] of gndName) own(name, gnd);
  // Name ohne Lebensjahre → GND-Personen dieses Namens, für Verweise wie «Bullinger, Heinrich (1504-1575)».
  const gndByName = new Map(owners);
  for (const [gnd, name] of gndName) {
    const dates = xml.gndRecords?.get(gnd)?.dates;
    if ((owners.get(name)?.size ?? 0) > 1 && dates) gndName.set(gnd, `${name} (${dates})`);
  }
  for (const [gnd, name] of gndName) report.used.push([gnd, personForms.get(`GND_${gnd}`)?.[0] ?? "", name]);
  report.used.sort((a, b) => a[2].localeCompare(b[2], "de"));
  report.rejected.sort((a, b) => a[2].localeCompare(b[2], "de"));

  const gndOf = (ref: string | null) => GND_RE.exec(ref ?? "")?.[1] ?? null;
  // Verweis mit Lebensjahren: dieselbe Person wie die GND-Person gleichen Namens mit denselben
  // Jahren (nur eindeutig) – sonst stünde der Reformator unter «Heinrich Bullinger» und
  // «Heinrich Bullinger (1504–1575)». Ähnliche (ein Jahr gleich) nur in den Bericht.
  const datedRefs = new Map<string, { gnd: string | null; similar: string[] }>();
  const datedGnd = (ref: string) => {
    let hit = datedRefs.get(ref);
    if (hit) return hit;
    const d = datedNameRef(ref);
    const same: string[] = [];
    const similar: string[] = [];
    for (const g of d ? (gndByName.get(d.name) ?? []) : []) {
      const dates = xml.gndRecords?.get(g)?.dates;
      if (dates === d!.dates) same.push(g);
      else if (dates && dates.split("–").some((y, i) => y !== "" && y === d!.dates.split("–")[i])) similar.push(`${g} (${dates})`);
    }
    hit = { gnd: same.length === 1 ? same[0] : null, similar };
    if (d) datedRefs.set(ref, hit);
    return hit;
  };
  const placeName = (ref: string): string | undefined => {
    const norm = placeNorm.get(ref);
    if (norm) return norm;
    if (isNameRef(ref)) return ref;
    const forms = placeForms.get(ref) ?? [];
    return (xml.knownPlaces ? modernSpelling(forms, xml.knownPlaces) : null) ?? forms[0];
  };
  const person = (form: string, ref: string | null): ResolvedPerson => {
    if (!ref) return { name: form, gnd: null };
    const gnd = gndOf(ref);
    const norm = personNorm.get(ref);
    if (norm) return { name: displayName(norm), gnd };
    if (gnd) return { name: gndName.get(gnd) ?? personForms.get(ref)?.[0] ?? form, gnd };
    if (isNameRef(ref)) {
      const same = datedGnd(ref).gnd;
      return same ? person(form, `GND_${same}`) : { name: displayName(ref), gnd: null };
    }
    return { name: personForms.get(ref)?.[0] ?? form, gnd: null };
  };
  return {
    person,
    place(form, ref) {
      const geo = (ref ? placeGeo.get(ref) : undefined) ?? coordsOf(ref);
      return { name: (ref ? placeName(ref) : undefined) || form, lat: geo?.lat ?? null, lon: geo?.lon ?? null };
    },
    org: (form) => ({ name: form }),
    keywordGloss: () => null,
    modernizedPlaces() {
      const out: Array<[string, string]> = [];
      for (const [ref, forms] of placeForms) {
        const name = placeName(ref);
        if (!placeNorm.has(ref) && !isNameRef(ref) && name && name !== forms[0]) out.push([forms[0], name]);
      }
      return out.sort((a, b) => a[0].localeCompare(b[0], "de"));
    },
    gndReport() {
      report.dated = [...datedRefs].map(([ref, { gnd, similar }]): [string, string, string | null, string[]] => [
        ref,
        person("", ref).name,
        gnd,
        similar,
      ]);
      report.dated.sort((a, b) => a[0].localeCompare(b[0], "de"));
      return report;
    },
  };
}
