/**
 * Herkunft der Eheleute in der Ehedatenbank (Spalten `Herkunft_Mann`/`Herkunft_Frau`) →
 * Gemeinde, Kanton bzw. Land und Herkunftsraum (Kanton Zürich, anderer Kanton, Ausland).
 *
 * Schreibweise der Ehedatenbank (Zenodo 11191059, v6.0, ausgezählt 2026-10-31; ein Drittel
 * der Angaben ist leer):
 * - «Weiler (Gemeinde)» im Kanton Zürich: «Ottikon (Illnau-Effretikon)» ⇒ Gemeinde
 *   Illnau-Effretikon (rund 6 % der Angaben);
 * - Kantonskürzel am Ende für die übrige Schweiz: «Nussbaumen TG», «Kappel (Toggenburg) SG»;
 * - Land in Klammern am Ende fürs Ausland: «Büsingen (Deutschland)», «Munzenheim (Elsass)
 *   (Frankreich)», selten nur das Land oder eine Landschaft («Frankreich», «Hessen»);
 * - « ?» = unsicher gelesen.
 *
 * Ohne Klammer, Kürzel oder Land gilt die Angabe als Ort im Kanton Zürich und bleibt, wie sie
 * steht – auch ein Weiler («Irgenhausen»): Weilernamen sind mehrdeutig (Ottikon liegt in Gossau
 * und in Illnau-Effretikon), ohne Ortsverzeichnis lassen sie sich nicht sicher zuordnen.
 * Ausnahmen sind wenige eindeutige Namen anderer Kantone (Bern, Schaffhausen, Glarus …) und
 * Länder. Pur, unit-getestet in herkunft.test.ts.
 */

import { placeKey } from "../../../apps/web/src/lib/entityKey.ts";

export type HerkunftRaum = "zh" | "ch" | "ausland";

export interface Herkunft {
  /** Angabe wie in der Ehedatenbank, ohne « ?». */
  text: string;
  /** Ort ohne Klammerzusätze, Kürzel und Land («Ottikon», «Kappel», «Munzenheim»). */
  ort: string;
  /** Wert der Facette «Herkunft»: Gemeinde im Kanton Zürich, sonst Ort mit Kantonskürzel
   *  («Nussbaumen TG») bzw. mit Land («Büsingen (Deutschland)»). */
  gemeinde: string;
  /** Kantonskürzel (ZH für den Kanton Zürich); null im Ausland und ohne Kanton («Schweiz»). */
  kanton: string | null;
  /** Land im Ausland, sonst null. */
  land: string | null;
  raum: HerkunftRaum;
  unsicher: boolean;
}

export const CANTON_NAMES: Readonly<Record<string, string>> = {
  ZH: "Zürich",
  BE: "Bern",
  LU: "Luzern",
  UR: "Uri",
  SZ: "Schwyz",
  OW: "Obwalden",
  NW: "Nidwalden",
  GL: "Glarus",
  ZG: "Zug",
  FR: "Freiburg",
  SO: "Solothurn",
  BS: "Basel-Stadt",
  BL: "Basel-Landschaft",
  SH: "Schaffhausen",
  AR: "Appenzell Ausserrhoden",
  AI: "Appenzell Innerrhoden",
  SG: "St. Gallen",
  GR: "Graubünden",
  AG: "Aargau",
  TG: "Thurgau",
  TI: "Tessin",
  VD: "Waadt",
  VS: "Wallis",
  NE: "Neuenburg",
  GE: "Genf",
  JU: "Jura",
};

/** Länder, wie die Ehedatenbank sie in Klammern oder allein schreibt. */
const COUNTRIES = new Set([
  "Deutschland",
  "Frankreich",
  "Italien",
  "Österreich",
  "Niederlande",
  "Polen",
  "Tschechien",
  "Belgien",
  "Ungarn",
  "Dänemark",
  "Schottland",
  "England",
  "Irland",
  "Rumänien",
  "Slowakei",
  "Slowenien",
  "Kroatien",
  "Russland",
  "Lettland",
  "Schweden",
  "Norwegen",
  "Spanien",
  "Portugal",
  "Luxemburg",
  "Liechtenstein",
  "Vereinigte Staaten von Amerika",
]);

/** Landschaften und Städte des Auslands, die allein stehen («Hessen»). */
const ABROAD_REGIONS: Readonly<Record<string, string>> = {
  Hessen: "Deutschland",
  Sachsen: "Deutschland",
  Schwarzwald: "Deutschland",
  "Grafschaft Hanau": "Deutschland",
  Württemberg: "Deutschland",
  Schwaben: "Deutschland",
  Pfalz: "Deutschland",
  Breisgau: "Deutschland",
  Allgäu: "Deutschland",
  Elsass: "Frankreich",
  Lothringen: "Frankreich",
  Savoyen: "Frankreich",
  Paris: "Frankreich",
  Veltlin: "Italien",
  Tirol: "Österreich",
  Vorarlberg: "Österreich",
};

/** Eindeutige Namen anderer Kantone, die ohne Kürzel stehen (Bern 95-mal, Schaffhausen 668-mal). */
const BARE_SWISS: Readonly<Record<string, string | null>> = {
  Bern: "BE",
  "Berner Gebiet": "BE",
  Basel: "BS",
  Schaffhausen: "SH",
  "Sankt Gallen": "SG",
  "St. Gallen": "SG",
  Wattwil: "SG",
  Luzern: "LU",
  Genf: "GE",
  Glarus: "GL",
  Zug: "ZG",
  Solothurn: "SO",
  Olten: "SO",
  Frauenfeld: "TG",
  Thurgau: "TG",
  Neuenburg: "NE",
  Neuchâtel: "NE",
  Appenzell: "AI",
  Vaud: "VD",
  Waadt: "VD",
  Aargau: "AG",
  Graubünden: "GR",
  Uri: "UR",
  Schwyz: "SZ",
  Wallis: "VS",
  Schweiz: null,
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Alle Klammerzusätze weg, auch verschachtelte und eine offene Klammer am Ende. */
export function stripParens(s: string): string {
  let out = s;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, " ");
  }
  return clean(out.replace(/\(.*$/, ""));
}

/** Klammergruppen der obersten Ebene, von links nach rechts (Inhalt ohne äussere Klammer). */
function topGroups(s: string): Array<{ start: number; inner: string }> {
  const groups: Array<{ start: number; inner: string }> = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") {
      if (depth === 0) start = i;
      depth++;
    } else if (s[i] === ")" && depth > 0) {
      depth--;
      if (depth === 0) groups.push({ start, inner: s.slice(start + 1, i) });
    }
  }
  return groups;
}

const countryOf = (inner: string) => {
  const v = clean(inner.replace(/\?/g, ""));
  return COUNTRIES.has(v) ? v : null;
};

export function parseHerkunft(raw: string | null | undefined): Herkunft | null {
  let t = clean(raw ?? "");
  if (!t || t === "-") return null;
  const unsicher = t.includes("?");
  // « ?» am Ende und vor einer Klammer («Gailingen ? (Deutschland)»).
  t = clean(t.replace(/\s*\?\s*$/, "").replace(/\s+\?(?=\s*\()/g, ""));
  if (!t) return null;
  const base = { text: t, unsicher };

  // Kantonskürzel am Ende: übrige Schweiz (ZH selten, dann Kanton Zürich).
  const code = /^(.*\S)\s+([A-Z]{2})$/.exec(t);
  if (code && CANTON_NAMES[code[2]]) {
    const ort = stripParens(code[1]) || code[1];
    if (code[2] === "ZH") return { ...base, ort, gemeinde: ort, kanton: "ZH", land: null, raum: "zh" };
    return { ...base, ort, gemeinde: `${ort} ${code[2]}`, kanton: code[2], land: null, raum: "ch" };
  }

  // Land in Klammern: die letzte Gruppe, die ein Land nennt («Franken (Deutschland) (oder Frankreich ?)»).
  const groups = topGroups(t);
  for (let i = groups.length - 1; i >= 0; i--) {
    const land = countryOf(groups[i].inner);
    if (!land) continue;
    const ort = stripParens(t.slice(0, groups[i].start));
    return { ...base, ort: ort || land, gemeinde: ort ? `${ort} (${land})` : land, kanton: null, land, raum: "ausland" };
  }

  // «Weiler (Gemeinde)» im Kanton Zürich; «(bei X)» und «(oder …)» sind keine Gemeinde.
  const last = groups.at(-1);
  if (last && clean(t.slice(last.start + last.inner.length + 2)) === "") {
    const ort = stripParens(t.slice(0, last.start));
    const inner = stripParens(last.inner);
    const gemeinde = inner && !/^(bei|oder|im|am|an|auf|ob)\b/i.test(inner) ? inner : ort;
    return { ...base, ort: ort || gemeinde, gemeinde: gemeinde || ort, kanton: "ZH", land: null, raum: "zh" };
  }

  const ort = stripParens(t) || t;
  if (Object.hasOwn(BARE_SWISS, ort)) return { ...base, ort, gemeinde: ort, kanton: BARE_SWISS[ort], land: null, raum: "ch" };
  if (COUNTRIES.has(ort)) return { ...base, ort, gemeinde: ort, kanton: null, land: ort, raum: "ausland" };
  if (Object.hasOwn(ABROAD_REGIONS, ort)) {
    const land = ABROAD_REGIONS[ort];
    return { ...base, ort, gemeinde: `${ort} (${land})`, kanton: null, land, raum: "ausland" };
  }
  return { ...base, ort, gemeinde: ort, kanton: "ZH", land: null, raum: "zh" };
}

/**
 * Vergleichsschlüssel (placeKey) einer Herkunft für den Ortsfilter, den die Reiter teilen
 * (`places`): Gemeinde, Ort, Land und Kanton – «Pfäffikon» trifft auch «Irgenhausen
 * (Pfäffikon)», «Thurgau» jede Herkunft mit «TG», «Deutschland» jede aus Deutschland.
 */
export function herkunftKeys(h: Herkunft): string[] {
  const forms = [h.gemeinde, h.ort, h.land ?? "", h.kanton && h.kanton !== "ZH" ? (CANTON_NAMES[h.kanton] ?? "") : ""];
  return [...new Set(forms.map((f) => (f ? placeKey(f) : null)).filter((k): k is string => !!k))];
}
