/**
 * Entitäten einer Katalogeinheit zusammenführen: Titelschema, Erschliessungsregeln
 * (ruleEntities.ts), NER-Spans (services/ner-xml/ner_text.py) und Ortsregister der
 * Urkundenregesten. Gleiche Schlüssel (apps/web/src/lib/entityKey.ts) gelten als eine
 * Entität; die erste Form gewinnt (Titelschema vor Regeln vor NER vor Register).
 *
 * Die NER-Spans laufen vorher durch einen Nachfilter (Evaluation 2026-11-09, 300 von Hand
 * beurteilte Einheiten): Sachgebiete, Versicherungszweige, Altäre und «Kernen» fallen weg,
 * Ortskürzel werden ausgeschrieben («Affoltern a. A.»), und gebeugte Formen («Bezirksrats
 * Andelfingen», «Medizinischen Fakultät») bekommen ihre Grundform – aber nur, wenn deren
 * Schlüssel in derselben Einheit (Titelschema, Regeln, Register) oder anderswo im Aufbau
 * vorkommt (`KeyCounts`, build.ts). Die Spans speichern nur den Text; ein neuer NER-Lauf
 * ist dafür nicht nötig.
 */

import { createHash } from "node:crypto";
import { orgKey, personKey, placeKey } from "../../../apps/web/src/lib/entityKey.ts";
import { normalizePlaceAbbr } from "./gazetteer.ts";
import { fieldText } from "./links.ts";
import type { RuleEntities } from "./ruleEntities.ts";
import { personDisplay, type TitleEntities } from "./titleSchema.ts";
import type { CatalogRecord } from "./types.ts";

export type NerLabel = "PER" | "LOC" | "ORG";

/** Zeile von ner_text.py: `ents` = [[Label, Text], …]; null = NER scheiterte. */
export interface NerSpans {
  id: number;
  hash: string;
  ents: Array<[NerLabel, string]> | null;
}

export interface EntitySet {
  persons: string[];
  places: string[];
  organizations: string[];
  personKeys: string[];
  placeKeys: string[];
  orgKeys: string[];
}

type Kind = "person" | "place" | "org";

/** Häufigkeit der Schlüssel im ganzen Aufbau je Art: in wie vielen Einheiten ein Schlüssel
 *  vorkommt (Titelschema, Regeln, NER und Register; build.ts, zweiter Durchlauf). */
export type KeyCounts = Record<Kind, Map<string, number>>;

/** Was der Nachfilter mit den NER-Spans getan hat (Aufbau-Report). */
export interface NerFilterStats {
  /** Stoppliste: Sachgebiet, Versicherungszweig, Altar, «Kernen». */
  stopped: number;
  /** Ortskürzel ausgeschrieben. */
  abbr: number;
  /** Grundform statt gebeugter Form. */
  base: number;
  /** «LABEL Form → Grundform» → Anzahl. */
  pairs: Map<string, number>;
}

/** Höchstens so viele Formen je Typ (Urkunden-Regesten nennen teils Dutzende). */
const MAX_PER_KIND = 25;
const NER_MAX_CHARS = 1500;

const KIND: Record<NerLabel, Kind> = { PER: "person", LOC: "place", ORG: "org" };
const KEY_OF: Record<Kind, (form: string) => string | null> = { person: personKey, place: placeKey, org: orgKey };

/** Text für die NER: Titel, Regest, «Inhalt und Form» (ohne Dublette), gekürzt. */
export function nerText(rec: CatalogRecord): string {
  const title = (rec.title ?? "").trim();
  const regest = fieldText(rec, "regest");
  const inhalt = fieldText(rec, "inhalt_und_form");
  const parts = [title, regest, inhalt && inhalt !== regest ? inhalt : undefined].filter((p): p is string => !!p);
  return parts.join("\n").slice(0, NER_MAX_CHARS);
}

export function textHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** «Ort, Name, Rolle; Ort; …» (Ortsregister der Urkundenregesten) → Orte. */
export function registerPlaces(rec: CatalogRecord): string[] {
  const reg = fieldText(rec, "ortsregister_urstazh");
  if (!reg) return [];
  return reg
    .split(";")
    .map((e) => (e.split(",")[0] ?? "").replace(/\.\s*$/, "").trim())
    .filter((p) => p.length >= 2);
}

/** «Nachname, Vorname» → «Vorname Nachname» für die Anzeige. */
function personForm(form: string): string {
  const m = /^\s*([^,]+),\s*([^,]+?)\s*$/.exec(form);
  return (m ? `${m[2]} ${m[1]}` : form).replace(/\s+/g, " ").trim();
}

export function newKeyCounts(): KeyCounts {
  return { person: new Map(), place: new Map(), org: new Map() };
}

/** Schlüssel einer Einheit zählen (je Schlüssel einmal). */
export function addKeyCounts(counts: KeyCounts, e: EntitySet): void {
  const add = (map: Map<string, number>, keys: string[]) => {
    for (const k of keys) map.set(k, (map.get(k) ?? 0) + 1);
  };
  add(counts.person, e.personKeys);
  add(counts.place, e.placeKeys);
  add(counts.org, e.orgKeys);
}

// --- Nachfilter der NER-Spans --------------------------------------------------------

/** Sachgebiet oder Versicherungszweig als einziges Wort («Notariatswesen», «Gerichtswesens»,
 *  «Unfallversicherung»), auch «Markt- und Hausierwesen». */
const STOP_ORG = /^(?:\p{L}+-,?\s+(?:und|oder)\s+)?\p{L}+(?:wesens?|versicherung)$/u;
/** Altäre in Urkunden-Regesten («Sankt-Blasius-Altars», «Marienaltar»). */
const ALTAR = /alt(?:ar|ars|äre|ären)(?!\p{L})/iu;

/** Kein Name, auch wenn die NER es dafür hält: Sachgebiete und Versicherungszweige als
 *  Organisation, Altäre, «Kernen» (Getreide) als Ort. */
export function nerStopped(label: NerLabel, text: string): boolean {
  const t = text.trim();
  return ALTAR.test(t) || (label === "LOC" && t === "Kernen") || (label === "ORG" && STOP_ORG.test(t));
}

/** Gebeugt ist nur der Kopf vor dem ersten Funktionswort («Kirchenrats der …», «Hermanns von …»). */
const FUNCTION_WORDS = new Set([
  "der", "die", "das", "des", "dem", "den", "von", "vom", "zu", "zum", "zur", "für", "und", "oder",
  "in", "im", "am", "an", "auf", "bei", "ob", "unter", "ab", "mit", "aus", "nach", "über", "gegen",
]);
/** Höchstens so viele Wörter des Kopfs und Kandidaten je Form. */
const HEAD_MAX = 4;
const CANDIDATES_MAX = 256;
/** «Statthalteramtes des Bezirks Affoltern» → «Statthalteramtes Affoltern» (Form der Regeln). */
const ORG_PLACE_LINK = /^(.+?)\s+(?:des\s+Bezirke?s|der\s+Stadt|der\s+Gemeinde)\s+(\S.*)$/u;

/** Adjektiv mit starker Endung «-es» («Eidgenössisches Departement», «Deutsches
 *  Generalkonsulat», «Kantonales Labor», «Rotes Kreuz»): kein Genitiv, bleibt. */
const STRONG_ADJECTIVE =
  /(?:sch|lich|ig|al|ell|iv|är|ös|bar|sam|haft|los|er|ern)es$|^(?:neu|alt|gross|klein|hoh|frei|rot|weiss|schwarz|grün|blau|gelb|gut|lang|kurz)es$/iu;

/** Genitiv «-s» bzw. «-es» weg (in dieser Reihenfolge: «Zürichsees» → «Zürichsee» vor
 *  «Zürichse», beide mit demselben Schlüssel). Klein geschriebene Wörter sind Adjektive, das
 *  «s» von «-haus» gehört zum Wort («Sigristenhaus»). Personen nur «-s» («Hermanns»), nicht
 *  nach «u» («Markus», «Paulus»): «Johannes» ist kein Genitiv von «Johann». */
function genitiveBases(w: string, person: boolean): string[] {
  if (!/^\p{Lu}/u.test(w) || STRONG_ADJECTIVE.test(w)) return [];
  const out: string[] = [];
  if (w.length >= 4 && /\p{Ll}s$/u.test(w) && !/(?:ss|haus)$/u.test(w) && !(person && w.endsWith("us"))) out.push(w.slice(0, -1));
  if (!person && w.length >= 5 && /\p{Ll}es$/u.test(w)) out.push(w.slice(0, -2));
  return out;
}

/** Adjektiv vor dem Nomen: schwach «-en» → «-er», «-es», «-e» («Kleinen Rats» → «Kleiner Rat»);
 *  bei gleich vielen Belegen gewinnt die starke Form, die Form der Namen. */
function adjectiveBases(w: string): string[] {
  return w.length >= 5 && /\p{Ll}en$/u.test(w) ? [`${w.slice(0, -2)}er`, `${w.slice(0, -2)}es`, w.slice(0, -1)] : [];
}

/**
 * Grundform-Kandidaten einer NER-Form, wenigste Änderungen zuerst (ohne die Form selbst).
 * Gebeugt sein können die Wörter des Kopfs vor dem ersten Funktionswort; Adjektive davor
 * auf «-en» werden immer mitgebeugt («Kleinen Rat» wäre keine Grundform), nicht aber ein
 * Ort vor dem Kantonskürzel («Wettingen AG»). Bei Personen nur das letzte Wort des Kopfs
 * («Uli Musterlis», «Hermanns von Musterwil»), damit Vornamen auf «-s» bleiben («Andreas
 * Muster»), und keine Archivform «Nachname, Vorname».
 */
export function baseFormCandidates(label: NerLabel, text: string): string[] {
  const person = label === "PER";
  const words = text.trim().split(/\s+/);
  if (person && text.includes(",")) return [];
  const fw = words.findIndex((w) => FUNCTION_WORDS.has(w));
  const head = Math.min(fw < 0 ? words.length : fw, HEAD_MAX);
  /** [Änderungen, Wörter, ein Adjektiv blieb ungebeugt] */
  let combos: Array<[number, string[], boolean]> = [[0, [], false]];
  words.forEach((w, i) => {
    const adjective = !person && i < head - 1 && /\p{Ll}/u.test(words[i + 1]) ? adjectiveBases(w) : [];
    const bases = adjective.length ? adjective : (person ? i === head - 1 : i < head) ? genitiveBases(w, person) : [];
    const expand = combos.length * (1 + bases.length) <= CANDIDATES_MAX;
    const next: Array<[number, string[], boolean]> = [];
    for (const [n, ws, kept] of combos) {
      next.push([n, [...ws, w], kept || adjective.length > 0]);
      if (expand) for (const b of bases) next.push([n + 1, [...ws, b], kept]);
    }
    combos = next;
  });
  const out = combos.filter(([n, , kept]) => n > 0 && !kept).sort((a, b) => a[0] - b[0]);
  return [...new Set(out.map(([, ws]) => ws.join(" ")))];
}

/** «Statthalteramtes des Bezirks Affoltern» → «Statthalteramtes Affoltern» samt Grundformen
 *  («Statthalteramt Affoltern», die Form der Regeln); nur Organisationen. */
export function placeLinkCandidates(label: NerLabel, text: string): string[] {
  const link = label === "ORG" ? ORG_PLACE_LINK.exec(text.trim()) : null;
  if (!link) return [];
  const short = `${link[1]} ${link[2]}`;
  return [short, ...baseFormCandidates(label, short)];
}

/** Schlüssel, an denen sich die Grundform einer NER-Form ausrichtet. */
export interface BaseFormKnown {
  /** Schlüssel derselben Einheit aus Titelschema, Regeln und Ortsregister. */
  unit: Record<Kind, ReadonlySet<string>>;
  /** Häufigkeit im ganzen Aufbau; ohne sie zählt nur die Einheit. */
  counts?: KeyCounts;
}

/** Orte und Personen enden oft echt auf «-s» («Buchs», «Bachs», «Hans Fuchs»), Organisationen
 *  kaum, dafür stehen sie im Fliesstext oft im Genitiv («des Erziehungsrates» 88-mal, «Erziehungsrat»
 *  21-mal in den Spans vom 2026-11-09). Darum gilt die Grundform im Aufbau bei Orten und Personen
 *  nur, wenn sie mindestens so oft vorkommt wie die Form selbst, bei Organisationen schon ab einem Beleg. */
const COMPARE_IN_BUILD: Record<NerLabel, boolean> = { PER: true, LOC: true, ORG: false };

/**
 * Grundform einer NER-Form, wenn ihr Schlüssel vorkommt: zuerst in derselben Einheit, sonst im
 * ganzen Aufbau (häufigste Grundform; bei Orten und Personen und ohne «der Stadt» bzw. «des
 * Bezirks» nur, wenn sie mindestens so oft vorkommt wie die Form selbst). Sonst unverändert.
 */
export function nerBaseForm(label: NerLabel, text: string, known: BaseFormKnown): string {
  const kind = KIND[label];
  const keyOf = KEY_OF[kind];
  const unit = known.unit[kind];
  const k0 = keyOf(text);
  if (k0 && unit.has(k0)) return text;
  const flexed = baseFormCandidates(label, text);
  const linked = placeLinkCandidates(label, text);
  for (const c of [...flexed, ...linked]) {
    const k = keyOf(c);
    if (k && k !== k0 && unit.has(k)) return c;
  }
  const counts = known.counts?.[kind];
  if (!counts) return text;
  const n0 = (k0 && counts.get(k0)) || 0;
  let best = text;
  let bestN = 0;
  const consider = (c: string, min: number) => {
    const k = keyOf(c);
    const n = k && k !== k0 ? (counts.get(k) ?? 0) : 0;
    if (n > bestN && n >= min) {
      best = c;
      bestN = n;
    }
  };
  for (const c of flexed) consider(c, COMPARE_IN_BUILD[label] ? Math.max(1, n0) : 1);
  for (const c of linked) consider(c, Math.max(1, n0));
  return best;
}

/** NER-Form nach dem Nachfilter: null = verworfen (Stoppliste). */
export function cleanNerForm(label: NerLabel, text: string, known: BaseFormKnown, stats?: NerFilterStats): string | null {
  if (nerStopped(label, text)) {
    if (stats) stats.stopped++;
    return null;
  }
  const t = text.replace(/\s+/g, " ").trim();
  const expanded = label === "PER" ? t : normalizePlaceAbbr(t);
  if (stats && expanded !== t) stats.abbr++;
  const base = nerBaseForm(label, expanded, known);
  if (stats && base !== expanded) {
    stats.base++;
    const pair = `${label} ${expanded} → ${base}`;
    stats.pairs.set(pair, (stats.pairs.get(pair) ?? 0) + 1);
  }
  return base;
}

export function newNerFilterStats(): NerFilterStats {
  return { stopped: 0, abbr: 0, base: 0, pairs: new Map() };
}

const keySet = (keyOf: (form: string) => string | null, forms: string[]): Set<string> =>
  new Set(forms.map(keyOf).filter((k): k is string => k !== null));

export function mergeEntities(parts: {
  title?: TitleEntities;
  rules?: RuleEntities;
  ner?: NerSpans["ents"];
  registerPlaces?: string[];
  /** Häufigkeit der Schlüssel im ganzen Aufbau (Grundformen der NER). */
  keyCounts?: KeyCounts;
  /** Zählt, was der Nachfilter mit den NER-Spans tut. */
  nerStats?: NerFilterStats;
}): EntitySet {
  const persons = new Map<string, string>();
  const places = new Map<string, string>();
  const orgs = new Map<string, string>();
  const add = (map: Map<string, string>, key: string | null, form: string) => {
    if (key && !map.has(key) && map.size < MAX_PER_KIND) map.set(key, form.replace(/\s+/g, " ").trim());
  };
  const titlePersons = (parts.title?.persons ?? []).map(personDisplay);
  for (const p of titlePersons) add(persons, personKey(p), p);
  for (const p of parts.title?.places ?? []) add(places, placeKey(p), p);
  for (const o of parts.title?.organizations ?? []) add(orgs, orgKey(o), o);
  for (const p of parts.rules?.persons ?? []) add(persons, personKey(p), p);
  for (const p of parts.rules?.places ?? []) add(places, placeKey(p), p);
  for (const o of parts.rules?.organizations ?? []) add(orgs, orgKey(o), o);
  if (parts.ner?.length) {
    const known: BaseFormKnown = {
      unit: {
        person: keySet(personKey, [...titlePersons, ...(parts.rules?.persons ?? [])]),
        place: keySet(placeKey, [...(parts.title?.places ?? []), ...(parts.rules?.places ?? []), ...(parts.registerPlaces ?? [])]),
        org: keySet(orgKey, [...(parts.title?.organizations ?? []), ...(parts.rules?.organizations ?? [])]),
      },
      counts: parts.keyCounts,
    };
    for (const [label, raw] of parts.ner) {
      const text = cleanNerForm(label, raw, known, parts.nerStats);
      if (text === null) continue;
      if (label === "PER") add(persons, personKey(text), personForm(text));
      else if (label === "LOC") add(places, placeKey(text), text);
      else if (label === "ORG") add(orgs, orgKey(text), text);
    }
  }
  for (const p of parts.registerPlaces ?? []) add(places, placeKey(p), p);
  return {
    persons: [...persons.values()],
    places: [...places.values()],
    organizations: [...orgs.values()],
    personKeys: [...persons.keys()],
    placeKeys: [...places.keys()],
    orgKeys: [...orgs.keys()],
  };
}
