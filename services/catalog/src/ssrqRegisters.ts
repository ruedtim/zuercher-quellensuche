/**
 * Register der Zürcher Rechtsquellen (SSRQ ZH, StAZH-Kopie stazh/erqzh-data: person/person.xml,
 * place/place.xml, organization/organization.xml, taxonomy/taxonomy.xml – die Gesamtdateien,
 * daneben liegen dieselben Einträge je Band). Die Stücke verweisen mit SSRQ-Kennungen darauf:
 * `persName/@ref="per000327"`, `placeName/@ref="loc000065"`, `orgName/@ref="org002406"`,
 * Schlagwörter `term/@ref="key000441"`.
 *
 * - Personen: `persName[@type=full]` ist schon «Vorname Nachname» («Friedrich von Toggenburg»,
 *   Heilige mit Zusatz: «Martin (Heilige und biblische Gestalten)»). Tragen mehrere Einträge
 *   denselben Namen (294 Namen, etwa «Hans Pfister»), steht die Datierung des Registers
 *   dahinter («Hans Pfister (1508)», «Hans Pfister (1742)») – sonst vereinte die Facette Namensvettern; mit dem Zusatz
 *   filtern sie nur exakt (isQualifiedPersonName). Keine GND im Repo.
 * - Orte: `placeName[@type=main]` («Kyburg», «Pfäfers Kloster»), Koordinaten aus `geo`, wo
 *   vorhanden (377 von 1'389).
 * - Organisationen: `orgName` allein ist oft ein Ortsname («Zürich» mit dem Typ «Bürgermeister
 *   und Rat», «Aesch» als Dorfgemeinde, «Toggenburg» als Familie) oder ein Familienname («Pfister»
 *   als Handwerk). Für diese Typen steht der Typ dahinter: «Zürich (Bürgermeister und Rat)»,
 *   «Toggenburg (Familie)» (ssrqOrgName).
 * - Schlagwörter: Erklärung (`gloss`) als Tooltip der Detailseite.
 *
 * Pur, unit-getestet in ssrqRegisters.test.ts (nur ausgedachte Beispiele).
 */

import { XMLParser } from "fast-xml-parser";
import type { EditionRegisters, GndReport } from "./editionRegisters.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ["person", "place", "org", "category", "persName", "placeName", "orgName", "note", "desc", "gloss"].includes(name),
});

type Obj = Record<string, unknown>;

const text = (v: unknown): string => {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in (v as Obj)) return text((v as Obj)["#text"]);
  return "";
};
const attr = (v: unknown, name: string): string => (v && typeof v === "object" ? text((v as Obj)[name]) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function deep(o: unknown, key: string): unknown[] {
  const out: unknown[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x as Obj)) {
        if (k === key) list(v).forEach((e) => out.push(e));
        else walk(v);
      }
    }
  };
  walk(o);
  return out;
}

/** Typen, bei denen der Name der Organisation allein ein Orts- oder Familienname ist. */
const ORG_TYPE_SUFFIX: Readonly<Record<string, string>> = {
  familie: "Familie",
  "bürgermeister und rat": "Bürgermeister und Rat",
  "rat allgemein": "Rat",
  dorfgemeinde: "Dorfgemeinde",
  stiftskapitel: "Stiftskapitel",
  "handwerk, gewerbe": "Handwerk",
};

/** Name einer Organisation im Register: «Zürich» mit Typ «Bürgermeister und Rat/bourgmestre et
 *  Conseil» ⇒ «Zürich (Bürgermeister und Rat)»; Namen, die für sich sprechen («Ehegericht»,
 *  «Zunft zum Weggen»), bleiben. */
export function ssrqOrgName(name: string, type: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  const de = type.split("/")[0].replace(/\s+/g, " ").trim().toLowerCase();
  const suffix = ORG_TYPE_SUFFIX[de];
  if (!n || !suffix || n.toLowerCase().includes(suffix.toLowerCase())) return n;
  return `${n} (${suffix})`;
}

/** Koordinaten aus `geo` («47.4556 8.7438»), sonst null. */
export function ssrqGeo(value: string): { lat: number; lon: number } | null {
  const m = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export interface SsrqRegisterInput {
  person?: string;
  place?: string;
  organization?: string;
  taxonomy?: string;
}

export interface SsrqRegisters extends EditionRegisters {
  /** Zahlen fürs Protokoll. */
  counts: { persons: number; places: number; orgs: number; keywords: number; namesakes: number };
}

export function buildSsrqRegisters(xml: SsrqRegisterInput): SsrqRegisters {
  // Personen: Name und Datierung je Kennung; gleiche Namen ⇒ Datierung dahinter.
  const personRaw = new Map<string, { full: string; date: string }>();
  if (xml.person) {
    for (const p of deep(parser.parse(xml.person), "person")) {
      const id = attr(p, "id");
      const names = list((p as Obj).persName);
      const full = text(names.find((n) => attr(n, "type") === "full") ?? names[0]);
      // Spannen mit Halbgeviertstrich («1441-26.03.1492» ⇒ «1441–26.03.1492»).
      const date = text(list((p as Obj).note).find((n) => attr(n, "type") === "date")).replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
      if (id && full) personRaw.set(id, { full, date });
    }
  }
  const byName = new Map<string, number>();
  for (const { full } of personRaw.values()) byName.set(full, (byName.get(full) ?? 0) + 1);
  const personName = new Map<string, string>();
  let namesakes = 0;
  for (const [id, { full, date }] of personRaw) {
    const shared = (byName.get(full) ?? 0) > 1;
    if (shared) namesakes++;
    personName.set(id, shared && date && !full.includes("(") ? `${full} (${date})` : full);
  }

  const placeName = new Map<string, string>();
  const placeGeo = new Map<string, { lat: number; lon: number }>();
  if (xml.place) {
    for (const p of deep(parser.parse(xml.place), "place")) {
      const id = attr(p, "id");
      const names = list((p as Obj).placeName);
      const main = text(names.find((n) => attr(n, "type") === "main") ?? names[0]) || attr(p, "n");
      if (id && main) placeName.set(id, main);
      const geo = ssrqGeo(deep(p, "geo").map(text).find(Boolean) ?? "");
      if (id && geo) placeGeo.set(id, geo);
    }
  }

  const orgName = new Map<string, string>();
  if (xml.organization) {
    for (const o of deep(parser.parse(xml.organization), "org")) {
      const id = attr(o, "id");
      const name = ssrqOrgName(text(list((o as Obj).orgName)[0]), attr(o, "type"));
      if (id && name) orgName.set(id, name);
    }
  }

  const gloss = new Map<string, string>();
  let keywords = 0;
  if (xml.taxonomy) {
    for (const c of deep(parser.parse(xml.taxonomy), "category")) {
      const id = attr(c, "id");
      if (!id) continue;
      keywords++;
      const g = text(list((c as Obj).gloss)[0]);
      if (g) gloss.set(id, g);
    }
  }

  const report: GndReport = { used: [], rejected: [], dated: [] };
  return {
    person: (form, ref) => ({ name: (ref ? personName.get(ref) : undefined) || form, gnd: null }),
    place: (form, ref) => {
      const geo = ref ? placeGeo.get(ref) : undefined;
      return { name: (ref ? placeName.get(ref) : undefined) || form, lat: geo?.lat ?? null, lon: geo?.lon ?? null };
    },
    org: (form, ref) => ({ name: (ref ? orgName.get(ref) : undefined) || form }),
    keywordGloss: (_term, ref) => (ref ? (gloss.get(ref) ?? null) : null),
    modernizedPlaces: () => [],
    gndReport: () => report,
    counts: { persons: personRaw.size, places: placeName.size, orgs: orgName.size, keywords, namesakes },
  };
}
