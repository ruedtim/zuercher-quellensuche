/**
 * Personen, Orte und Organisationen aus den Erschliessungsregeln des Staatsarchivs
 * (Erschliessungshandbuch, Version 2.11, 2026: Namensansetzung 3.1.2.4, Ortsbezeichnungen
 * 3.1.2.6, Titelbildung 3.4.1.2, Felder 3.4.2–3.4.6). Ergänzt Titelschema und NER:
 *
 * - Orte aus dem Archivplan: nächster Ahne der Stufe Klasse/Dossier/Subdossier, der eine
 *   Gemeinde ist («Hofstetten» über den Zivilstandsregistern), und Titel = Gemeinde.
 * - Ortsformen im Titel: Schulfotos «Gemeinde, Schulhaus ⏎ Lehrperson: …», «Objekt,
 *   Gemeinde», «Gemeinde(n): Sachtitel», «Grundprotokoll Wetzikon», «in/von/bei + Gemeinde»,
 *   Ort mit Kantonskürzel bzw. Land in Klammern, Postleitzahl + Ort.
 * - Körperschaften: Behörde + Ort («Bezirksrat Andelfingen»), Firma mit Rechtsform,
 *   Gastgewerbe («Restaurant Bären, …, 8627 Grüningen»).
 * - Felder, die die NER nie sieht: Autorschaft (ohne Heimatort/Sitz des Urhebers),
 *   Schreiber, Provenienz als Person, Ausstellungsort, Personenregister und Ketten des
 *   Ortsregisters URStAZH, GND-/HLS-Links, Impressum.
 * - Lücken des Titelschemas: Initialen statt Vornamen, «Von Arx», «Erben des X, Y»,
 *   Versalien-Name mitten im Titel, zweite Zeile der Fallakten (Opfer, «in Ort am Datum»).
 *
 * Orte nur aus dem Ortsverzeichnis (gazetteer.ts), Vornamen nur aus dem Lexikon des
 * Aufbaus. Bewusst nicht: Organisationsnamen ohne Rechtsform oder Ort, Kürzel,
 * Ablieferer als Person, Provenienz als Amtsstelle und vererbter Amtsbezirk (Bestands-
 * konstanten, besser als Facette). Gegen den Aufbau vom 2026-10-30 geprüft (Bericht im
 * Scratchpad der Sitzung). Pur, getestet in ruleEntities.test.ts (erfundene Namen).
 */

import { isPersonPrefix } from "../../../apps/web/src/lib/entityKey.ts";
import { type Gazetteer, LO, UP, normalizePlaceAbbr } from "./gazetteer.ts";
import { inLexicon } from "./titleSchema.ts";
import type { CatalogPathNode, CatalogSection } from "./types.ts";

export interface RuleEntities {
  persons: string[];
  places: string[];
  organizations: string[];
}

export interface RuleContext {
  gaz: Gazetteer;
  /** Vornamen-Lexikon des Aufbaus (`GivenNameLexicon`, titleSchema.ts). */
  givenNames: ReadonlySet<string>;
}

export interface RuleInput {
  /** Titel wie im Index (bei Klassen und Beständen aus «Name» bzw. Pfad-Etikett). */
  title: string;
  signature: string;
  /** Ahnen von der Wurzel bis zum Elternteil, ohne die Einheit selbst. */
  ancestors: CatalogPathNode[];
  sections: CatalogSection[];
  /** Das Titelschema hat schon Personen: Lücken-Regeln für Dossiertitel übergehen. */
  hasTitlePersons: boolean;
}

/** Wortgrenzen auch nach und vor Umlauten (JS-`\b` kennt nur ASCII). */
const B0 = "(?<![\\p{L}\\p{N}])";
const B1 = "(?![\\p{L}\\p{N}])";
const W = `[${UP}][${LO}${UP}'’\\-]*`;
const WL = `[${UP}][${LO}][${LO}'’]*(?:-[${UP}]?[${LO}'’]+)*`;
const INIT = `[${UP}]\\.`;
const WC = "\\p{L}\\p{N}_";
const PLC = `(?:St\\.\\s+)?[${UP}][${LO}]+(?:-[${UP}][${LO}]+)*(?:\\s+(?:am|an der|an|bei|ob)\\s+[${UP}][${LO}]+)?`;
const CANTONS = "AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG";
const COUNTRIES =
  "Deutschland|Österreich|Frankreich|Italien|Spanien|Portugal|England|Grossbritannien|Vereinigte Staaten von Amerika|USA|" +
  "Niederlande|Belgien|Luxemburg|Schweden|Norwegen|Dänemark|Polen|Ungarn|Tschechoslowakei|Tschechien|Russland|Sowjetunion|" +
  "Jugoslawien|Türkei|Griechenland|Liechtenstein|Kanada|Argentinien|Brasilien|Israel|Ägypten|Indien|China|Japan|Elsass|" +
  "Württemberg|Bayern|Preussen|Lombardei|Savoyen|Tirol|Vorarlberg";

const re = (src: string, flags = "u") => new RegExp(src, flags);
const LIFE = /\((?:geb\.\s*(\d{4})|gest\.\s*(\d{4})|(\d{4})\s*[-–]\s*(\d{4}))/;
/** «D., K.», «K. D.»: Urheber nur mit Initialen (Zeichner, Fotografen), eine Person. */
const INITIALS_ONLY = re(`^${INIT}(?:[\\s,]*-?${INIT})*$`);
/** «Muster (1822-1889), Ingenieur, …»: Nachname mit Lebensdaten, eine Person ohne Vornamen. */
const SURNAME_LIFE = re(`^(${W}(?:-${W})?)\\s*\\((?:geb\\.\\s*\\d{4}|gest\\.\\s*\\d{4}|\\d{4}\\s*[-–]\\s*\\d{4})\\)`);
const PLC_ONLY = re(`^${PLC}$`);
const WL_ONLY = re(`^${WL}$`);
/** Partikel vor dem Nachnamen, auch gross geschrieben («De Muster, M.»). */
const PARTICLE = "(?:[Vv]on|[Vv]om|[Vv]an|[Dd]e|[Dd]i|[Dd]a|[Dd]el|[Dd]u|[Ll]a|[Ll]e|[Zz]u|[Zz]um|[Zz]ur)";
const PERS_INV = re(`^((?:${PARTICLE}\\s+)?${W}(?:-${W})?),\\s+((?:${W}\\.?|${INIT})(?:\\s+(?:${W}\\.?|${INIT}))*)`);
const PERS_DIR = re(`^((?:(?:${W}|${INIT})\\s+){1,3})(${WL}(?:-${WL})?)`);
/** Anrede vor dem Namen («Frau V. Muster», «Herr Muster»): eine Person, auch ohne Vornamen. */
const HONORIFIC = re(`^(?:Herr|Herrn|Frau|Fräulein)$`);
const INIT_ONLY = re(`^${INIT}$`);
const NOT_PERSON = re(`${B0}(?:AG|GmbH|Verein|Amt|Bureau|Büro|Dienst|Direktion|Verlag|Labor)${B1}`);
const GEWAESSER = /(?:bach|bächlein|see|weiher|kanal|graben|fluss|Limmat|Glatt|Töss|Thur|Sihl|Reuss|Rhein|Jona|Aa|Furtbach|Eulach|Kempt)$/u;
const RIVERS = new Set(["Rhein", "Thur", "Töss", "Glatt", "Sihl", "Reuss", "Limmat", "Zürichsee", "Greifensee", "Pfäffikersee"]);
const PLACE_KINDS = "Gemeinde|Politische Gemeinde|Bezirk|Distrikt|Stadt|Kirchgemeinde|Schulgemeinde";

const KORP =
  "Politische Gemeinde|Zivilgemeinde|Kirchgemeinde|Schulgemeinde|Primarschulgemeinde|Sekundarschulgemeinde|" +
  "Oberstufenschulgemeinde|Kirchenpflege|Armenpflege|Schulpflege|Gemeinderat|Gemeinderates|Gemeinderats|Stadtrat|Stadtrates|Stadtrats|" +
  "Gemeinde|Gemeinden|Stadt|Bezirk|Bezirks|Bezirksrat|Bezirksrates|Bezirksrats|Bezirksratskanzlei|Bezirksgericht|Bezirksgerichts|" +
  "Bezirksschulpflege|Bezirksanwaltschaft|Bezirkskirchenpflege|Statthalteramt|Statthalteramts|Notariat|Notariats|Grundbuchamt|" +
  "Betreibungsamt|Konkursamt|Friedensrichteramt|Gemeindeammannamt|Pfarramt|Pfarrei|Pfarrkapitel|Kapitel|Landvogtei|Obervogtei|" +
  "Vogtei|Herrschaft|Grafschaft|Amt|Kloster|Klosters|Stift|Stifts|Spital|Kantonsspital|Krankenhaus|Jugendsekretariat|Zivilstandsamt|" +
  "Waisenamt|Jugendanwaltschaft|Distrikt|Munizipalität|Gemeindeschule|Primarschule|Sekundarschule|Kantonsschule|Zivilstandskreis|" +
  "Wahlkreis|Steuerkommission|Feuerwehr|Wasserversorgung|Korporation|Genossenschaft";
/** Gebietskörperschaften: nur der Ort, keine Organisation. */
const TERRITORY = new Set(["Gemeinde", "Gemeinden", "Stadt", "Bezirk", "Distrikt"]);
/** Die Körperschaftswörter; ein Genitiv-«s» fällt nur, wenn die Grundform darunter ist
 *  («Gemeinderats» → «Gemeinderat»), nicht bei «Wahlkreis», «Krankenhaus». */
const KORP_WORDS = new Set(KORP.split("|"));

const RX = {
  initials: re(
    `^((?:(?:von|vom|van|de|di|da|del|du|la|le|zu|zum|zur)\\s+)?${W}(?:-${W})?),\\s+((?:${INIT}\\s?){1,3}(?:-${INIT})?)(?=\\s*(?:,|$|\\(|\\s))(.*)$`,
  ),
  particle: re(`^((?:Von|Vom|Van|De|Di|Da|Del|Della|Du|La|Le|Zur|Zum|Auf der|Von der)\\s+${W}(?:\\s+${W})?),\\s+(${W}(?:\\s+${W})*)(.*)$`),
  victim: re(`(?:Opfer|Geschädigte[rn]?|Opfer/Geschädigte|Kläger(?:in)?|Erblasser(?:in)?)\\s*:\\s*((?:${W}\\.?\\s+){1,3}${WL})`, "gu"),
  crimeScene: re(`${B0}(?:in|bei)\\s+(${PLC})\\s+am\\s+\\d{1,2}\\.\\d{1,2}\\.\\d{4}`, "gu"),
  heirs: re(
    `^(?:Erben(?:gemeinschaft)?|Hinterlassenschaft|Nachlass|Konkursmasse|Verlassenschaft|Erbschaft|Nachlassverfahren|Vormundschaft)\\s+(?:des|der|von|über)\\s+((?:${W}\\s+)?${W}(?:-${W})?),\\s+(${W}(?:\\s+${W})*)`,
  ),
  capsName: re(`(?<=\\s)([${UP}]{2,}(?:-[${UP}]{2,})?(?:\\s+[${UP}]{2,})?),\\s+(${WL}(?:\\s+${WL})?)`, "gu"),
  placePrefix: /^([^:\n]{2,140}?)\s*:\s+\S/u,
  objectPlace: re(`^([${UP}][^\\n:]{1,100}),\\s*(${PLC})\\s*$`),
  placeKind: re(`^(?:${PLACE_KINDS})\\s+(${PLC})$`),
  placeWithParens: re(`^(${PLC})\\s+(?:mit\\s+.+?\\s*)?\\((${PLC})\\)$`),
  seriesPlace: re(
    `^([${UP}][${LO}]+(?:-[${UP}]?[${LO}]+)?)\\s+(${PLC})(?:\\s*\\((?:bis\\s+\\d{4}\\s+)?(${PLC})\\))?(?:,\\s*(?:Bd\\.|Band|Teil|Nr\\.)\\s*\\S+)?$`,
  ),
  body: re(`${B0}(${KORP})\\s+(?:des\\s+Bezirks\\s+|der\\s+Stadt\\s+|der\\s+Gemeinde\\s+)?(${PLC})`, "gu"),
  canton: re(`${B0}(?:in|von|aus|nach|bei)\\s+((?:St\\.\\s+)?${W}(?:[\\s-]${W}){0,2})\\s+(?:${CANTONS})${B1}`, "gu"),
  country: re(`((?:St\\.\\s+)?${W}(?:[\\s-]${W}){0,2})\\s+\\((?:${COUNTRIES})\\)`, "gu"),
  postcode: re(`(?:^|,\\s*)(?:CH-)?([1-9]\\d{3})\\s+((?:St\\.\\s+)?${W}(?:[\\s-]${W}){0,3})\\s*(?=$|,|\\n|\\))`, "gu"),
  hospitality: /^(Restaurant|Hotel|Gasthof|Gasthaus|Wirtschaft|Café|Cafe|Bar|Pension|Tea-Room|Tearoom|Kurhaus|Bistro|Pizzeria|Hotel-Restaurant|Weinstube|Bierhalle|Imbiss|Dancing|Kino)\s+([^,\n]+)/u,
  legalForm: re(
    `((?:[${UP}][${WC}&.\\-]*)(?:[^\\S\\n]+(?:[${UP}][${WC}&.\\-]*|und|&|de|du|la|et|für|der|des)){0,5})[^\\S\\n]+(AG|GmbH|SA|S\\.A\\.|KG|& Co\\.?|und Co\\.?|& Cie\\.?|und Cie\\.?|Aktiengesellschaft|Genossenschaft)(?![${WC}])`,
    "gu",
  ),
  issuePlace: re(`^${PLC}(?:\\s+(?:${CANTONS}))?(?:\\s*\\(.+\\))?$`),
  ancestorPlace: re(`^(?:Gemeinde|Bezirk|Distrikt|Stadt|Kirchgemeinde|Schulgemeinde)\\s+(${PLC})$`),
  placeCanton: re(`^(${PLC})\\s+(?:${CANTONS})$`),
  startsInitial: re(`^${INIT}`),
  startsUpper: re(`^[${UP}]`),
  trailingPlace: re(`,\\s+(?:${PLC})$`),
  authorSeat: re(`,\\s+(?:in\\s+)?(?:${PLC})(?:\\s+[A-Z]{2})?\\s*$`),
  inverseName: re(`^${W},\\s+${W}`),
  registerInstitution: re(
    `^(${PLC})\\s+\\(((?:[${WC}-]*kloster|Stift|Spital|Kommende|Propstei|Chorherrenstift|Dominikaner[${WC}]*|Benediktiner[${WC}]*|Zisterzienser[${WC}]*)[${WC} ]*)\\)$`,
  ),
};

/** Vornamen im Lexikon; Anreden, Titel und Ämter zählen nicht («Bezirksrat Zürich» ist keine Person). */
function givenOk(ctx: RuleContext, seq: string): boolean {
  return inLexicon(seq, ctx.givenNames);
}

/** Kandidat → Orte aus dem Verzeichnis («Zürich-Riesbach» → beide Teile). */
export function gazPlace(gaz: Gazetteer, cand: string, strict = true): string[] {
  const c = cand.trim();
  if ((strict ? gaz.strict : gaz.all).has(c)) return [c];
  if (c.includes("-")) {
    const parts = c.split("-");
    if (parts.every((p) => gaz.all.has(p))) return parts;
  }
  return [];
}

const prepRegexes = new Map<string, RegExp>();

function placesAfter(gaz: Gazetteer, text: string, strict = true, preps = "in|von|bei|aus|nach|ob"): string[] {
  let rx = prepRegexes.get(preps);
  if (!rx) {
    rx = re(`(?:${B0}(?:${preps})|(?:^|\\n)(?:In|Von|Bei|Aus|Nach))\\s+(${PLC})`, "gu");
    prepRegexes.set(preps, rx);
  }
  const out: string[] = [];
  for (const m of text.matchAll(rx)) {
    out.push(...gazPlace(gaz, m[1], strict));
  }
  return out;
}

/** Ortsliste «A, B und C», «A bis B», «Zürich (Kreis 7)»: alle Teile Orte oder Gewässer. */
function segmentPlaces(gaz: Gazetteer, seg: string): string[] {
  const clean = seg
    .trim()
    .replace(/\s*\((?:Kreis|Stadtkreis)\s*\d+\)/gu, "")
    .replace(/^(?:Bezirk|Stadt|Gemeinde|Gemeinden)\s+/u, "");
  const parts = clean.split(/,\s*|\s+und\s+|\s+bis\s+|\s*;\s*|\s+\/\s+/u).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const bare = p.replace(/\s*\((.+?)\)$/u, "");
    let pl = gazPlace(gaz, bare, false);
    if (pl.length === 0) {
      const m = RX.placeCanton.exec(bare);
      if (m) pl = [m[1]];
    }
    if (pl.length === 0 && (GEWAESSER.test(bare) || RIVERS.has(bare))) pl = [`~${bare}`];
    if (pl.length === 0) return [];
    out.push(...pl);
    const inner = /\((.+?)\)$/u.exec(p);
    if (inner) out.push(...gazPlace(gaz, inner[1], false));
  }
  if (out.length === 0 || out.every((o) => o.startsWith("~"))) return [];
  return out.map((o) => o.replace(/^~/, ""));
}

/** Wert eines Personenfelds: Person «Vorname Nachname», sonst Organisation. */
function personOrOrg(ctx: RuleContext, raw: string): { kind: "person" | "org"; name: string } | null {
  const s = raw
    .trim()
    .replace(/^(?:Vermutlich|Wahrscheinlich|Möglicherweise|vermutlich|wahrscheinlich|möglicherweise):?\s+/u, "")
    .replace(/^[^:]{2,40}:\s+/u, "");
  if (!s || s === "N. N." || s === "N.N." || s === "unbekannt") return null;
  const inv = PERS_INV.exec(s);
  // «…, von Zofingen AG»: Kantonskürzel nach dem Heimat- oder Wohnort, keine Rechtsform.
  if (inv && !NOT_PERSON.test(s.replace(RX.canton, " "))) {
    const first = inv[2];
    // «Muster, Dr.», «Muster, Prof. Dr.»: nur Titel, eine Person ohne Vornamen.
    const titles = first.split(/\s+/u).every((t) => isPersonPrefix(t));
    if (givenOk(ctx, first) || LIFE.test(s) || RX.startsInitial.test(first) || titles) return { kind: "person", name: `${first} ${inv[1]}` };
  }
  const dir = PERS_DIR.exec(s);
  if (dir) {
    const given = dir[1].trim();
    const tokens = given.split(/\s+/u);
    const honorific = tokens.some((t) => HONORIFIC.test(t)) && tokens.every((t) => HONORIFIC.test(t) || INIT_ONLY.test(t));
    if (givenOk(ctx, given) || honorific) return { kind: "person", name: `${given} ${dir[2]}` };
  }
  // Personen ohne Schlüssel (der Aufbau verwirft sie), aber keine Organisationen.
  if (INITIALS_ONLY.test(s)) return { kind: "person", name: s.split(/,\s*/u).reverse().join(" ") };
  const surname = SURNAME_LIFE.exec(s);
  if (surname) return { kind: "person", name: surname[1] };
  const org = s
    .split(/,\s+in\s+/u)[0]
    .trim()
    .replace(RX.trailingPlace, "");
  if (RX.startsUpper.test(org) && org.length > 3 && org.length <= 100) return { kind: "org", name: org };
  return null;
}

/** «WEIBEL-MEIER» → «Weibel-Meier». */
function nameCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** Signatur vorne im Etikett: «E III 10 Hofstetten» → «Hofstetten». */
const LEADING_SIGNATURE = re(`^(?:[A-Z]{1,5}(?:\\s+[IVX]+)?\\s+\\d[\\w.\\s–-]*?\\s+)(?=[${UP}])`);

function stripSignature(t: string): string {
  return t.replace(LEADING_SIGNATURE, "");
}

/** Pfad-Etikett ohne Laufzeit, Stufe und Signatur. */
function pathLabel(label: string): string {
  const l = label
    .replace(/,\s*[^,]*\d[^,]*\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*\((?:Bestand|Klasse|Dossier|Subdossier|Abteilung|Hauptabteilung|Dokument)\)\s*$/u, "");
  return stripSignature(l).trim();
}

function fieldTexts(sections: CatalogSection[], key: string): string[] {
  const out: string[] = [];
  for (const s of sections) for (const f of s.fields) if (f.key === key && f.text.trim()) out.push(f.text.trim());
  return out;
}

export function ruleEntities(input: RuleInput, ctx: RuleContext): RuleEntities {
  const { gaz } = ctx;
  const persons: string[] = [];
  const places: string[] = [];
  const orgs: string[] = [];
  const title = normalizePlaceAbbr(input.title ?? "");
  const lines = title.split("\n");
  const l1 = (lines[0] ?? "").trim();
  const restLines = lines.slice(1).join("\n");
  const sig = input.signature ?? "";

  // Lücken des Titelschemas (nur, wo es keine Person gefunden hat).
  if (!input.hasTitlePersons) {
    let m = RX.initials.exec(l1);
    if (m && !/^(?:Nr|Bd|Act|Teil|Fol|Seite|S|Blatt)$/.test(m[1])) {
      const pl = placesAfter(gaz, m[3], false, "in|von|aus");
      if (pl.length || LIFE.test(m[3]) || /,\s+[mw]\./.test(m[3]) || m[3].includes(" gegen ")) {
        persons.push(`${m[2].trim()} ${m[1]}`);
        places.push(...pl);
      }
    }
    m = RX.particle.exec(l1);
    if (m) {
      const pl = placesAfter(gaz, m[3], false, "in|von");
      if (LIFE.test(m[3]) || pl.length || givenOk(ctx, m[2])) {
        persons.push(`${m[2]} ${m[1]}`);
        places.push(...pl);
      }
    }
    m = RX.heirs.exec(l1);
    if (m && (givenOk(ctx, m[2]) || LIFE.test(l1))) {
      persons.push(`${m[2]} ${m[1]}`);
      places.push(...placesAfter(gaz, l1, false, "in|von"));
    }
    for (const c of ` ${l1}`.matchAll(RX.capsName)) {
      if ((c.index ?? 0) > 1 && givenOk(ctx, c[2]) && !["AG", "SA", "AHV", "SBB", "EKZ", "NOK"].includes(c[1])) persons.push(`${c[2]} ${nameCase(c[1])}`);
    }
  }
  // Zweite Zeile der Fallakten: «Opfer/Geschädigte: …», «Delikt in Ort am Datum».
  if (restLines || l1.includes(" / ")) {
    const tail = restLines || l1.split(" / ").slice(1).join(" / ");
    for (const m of tail.matchAll(RX.victim)) {
      const name = m[1].trim();
      if (givenOk(ctx, name.slice(0, name.lastIndexOf(" ")))) persons.push(name);
    }
    for (const m of tail.matchAll(RX.crimeScene)) {
      const pl = gazPlace(gaz, m[1], false);
      places.push(...(pl.length ? pl : PLC_ONLY.test(m[1]) ? [m[1]] : []));
    }
  }

  // Orte aus dem Archivplan: nächster Ahne, der ein Ort ist; nur Klassen, Dossiers und
  // Subdossiers (ein vererbter Bezirk oder Bestand ist Provenienz, nicht Inhalt).
  for (const node of [...input.ancestors].reverse()) {
    const lab = pathLabel(node.label ?? "");
    let pl = gaz.all.has(lab) ? [lab] : [];
    if (pl.length === 0) {
      const m = RX.ancestorPlace.exec(lab);
      if (m) pl = gazPlace(gaz, m[1], false);
    }
    if (pl.length) {
      if (["Klasse", "Dossier", "Subdossier"].includes(node.level) && !/^(?:Bezirk|Distrikt)\s/u.test(lab)) places.push(...pl);
      break;
    }
  }
  // Titel ist ein Ortsname («Marthalen», «Gemeinde Truttikon», «Hirzel mit Spitzen (Horgen)»).
  const t0 = stripSignature(l1);
  if (gaz.all.has(t0)) places.push(t0);
  else {
    const kind = RX.placeKind.exec(t0);
    if (kind) places.push(...gazPlace(gaz, kind[1], false));
    const paren = RX.placeWithParens.exec(t0);
    if (paren && gazPlace(gaz, paren[2], false).length) places.push(...gazPlace(gaz, paren[1], false), ...gazPlace(gaz, paren[2], false));
  }
  // Schulfotos: «Gemeinde (Kreis n), Schulhaus ⏎ Stufe/Klasse: … ⏎ Lehrperson: …».
  if (title.includes("Lehrperson:")) {
    const pl = gazPlace(gaz, l1.split(/,|\s\(/u)[0].trim(), false);
    if (pl.length) {
      places.push(...pl);
      const school = l1.split(",").slice(1).map((s) => s.trim()).find((s) => /[Ss]chul|Kindergarten|Seminar|Gymnasium|Institut|Heim/u.test(s));
      if (school) orgs.push(school);
    }
  }
  // «Gemeinde(n): Sachtitel» (Bau, Pläne); die Patente haben dort den Anmelder.
  const prefix = RX.placePrefix.exec(l1);
  if (prefix && !sig.startsWith("PAT")) places.push(...segmentPlaces(gaz, prefix[1]));
  // «Objekt, Gemeinde» («Wehrenbach, Zollikon»), Gewässer zusätzlich als Ort.
  const obj = RX.objectPlace.exec(l1);
  if (obj && !LIFE.test(l1)) {
    const pl = gazPlace(gaz, obj[2], false);
    const inv = PERS_INV.exec(`${obj[1]} `);
    if (pl.length && !(inv && givenOk(ctx, inv[2]))) {
      places.push(...pl, ...obj[1].split(/,\s*|\s+und\s+/u).filter((h) => GEWAESSER.test(h)));
    }
  }
  // Serielle Sachakten «Grundprotokoll Wetzikon, Bd. 56».
  const series = RX.seriesPlace.exec(t0);
  if (series && !["Gemeinde", "Bezirk", "Stadt", "Distrikt", "Kirchgemeinde", "Schulgemeinde"].includes(series[1])) {
    const pl = gazPlace(gaz, series[2], false);
    if (pl.length) places.push(...pl, ...(series[3] ? gazPlace(gaz, series[3], false) : []));
  }
  // Körperschaft/Behörde + Ort («Bezirksrat Andelfingen», «Zivilgemeinde Sulz»).
  for (const m of title.matchAll(RX.body)) {
    const pl = gazPlace(gaz, m[2], false);
    if (pl.length === 0) continue;
    places.push(...pl);
    const kw = ["Gemeinde", "Gemeinden", "Amt", "Stift", "Spital", "Bezirks", "Notariats"].includes(m[1])
      ? m[1].replace("Bezirks", "Bezirk").replace("Notariats", "Notariat")
      : KORP_WORDS.has(m[1].replace(/(?:es|s)$/u, ""))
        ? m[1].replace(/(?:es|s)$/u, "")
        : m[1];
    if (!TERRITORY.has(kw)) orgs.push(`${kw} ${m[2]}`);
  }
  // «in/von/bei/aus/nach» + eindeutige Gemeinde, Ort mit Kantonskürzel bzw. Land, PLZ + Ort.
  places.push(...placesAfter(gaz, title, true));
  for (const m of title.matchAll(RX.canton)) places.push(m[1]);
  for (const m of title.matchAll(RX.country)) places.push(m[1]);
  for (const m of title.matchAll(RX.postcode)) places.push(m[2]);
  // Gastgewerbe.
  const inn = RX.hospitality.exec(l1);
  if (inn) {
    orgs.push(`${inn[1]} ${inn[2].trim()}`);
    const pc = [...l1.matchAll(RX.postcode)].map((m) => m[2]);
    places.push(...(pc.length ? pc : placesAfter(gaz, l1, false)));
  }
  // Firma mit Rechtsform; «Wettingen AG» (ein Wort, «von/in X AG») ist der Kanton.
  for (const ln of lines) {
    for (const m of ln.matchAll(RX.legalForm)) {
      const name = m[1].trim().replace(/^(?:Antrag|Gesuch|Rekurs|Beschwerde|Firma|Fa\.)\s+(?:der|des|von)?\s*/u, "");
      if (m[2] === "AG" && (name.split(/\s+/).length === 1 || /(?:von|in|aus|nach|bei)\s*$/u.test(ln.slice(0, m.index ?? 0)))) continue;
      if (name.length > 2 && !/^(?:Die|Der|Das) /u.test(name)) orgs.push(`${name} ${m[2]}`);
    }
  }

  // Felder (nicht im NER-Text).
  for (const text of fieldTexts(input.sections, "autorschaft")) {
    for (const e of text.split(/\n|;\s+/u)) {
      if (/^(?:Ersatzoriginal|Digitalisat|Reproduktion|Kopie|Original)\s*:/u.test(e)) continue;
      // Heimatort und Sitz des Urhebers sind kein Ort der Einheit.
      const v = /(?:AG|GmbH|Verlag|Dienst|Amt|amts|Bureau|Büro|Labor|Studio|Photo|Foto)/u.test(e)
        ? e.replace(RX.authorSeat, "")
        : e;
      const pf = personOrOrg(ctx, v.replace(/\s*\(Hrsg\.\)/u, ""));
      if (pf) (pf.kind === "person" ? persons : orgs).push(pf.name);
    }
  }
  for (const text of fieldTexts(input.sections, "schreiber")) {
    for (const e of text.split(";")) {
      const pf = personOrOrg(ctx, RX.inverseName.test(e.trim()) ? e : e.split(",")[0]);
      if (pf?.kind === "person") persons.push(pf.name);
    }
  }
  const prov = fieldTexts(input.sections, "provenienz")[0]?.split("\n")[0];
  if (prov) {
    const pf = personOrOrg(ctx, prov);
    if (pf?.kind === "person") persons.push(pf.name);
  }
  for (const text of fieldTexts(input.sections, "ausstellungsort")) {
    for (const e of text.split(/\s+und\s+|;/u)) {
      const v = e.trim().replace(/^(?:bei|im|in|auf|vor|Rathaus|Schloss|Burg|Kloster|Feldlager bei|Lager bei)\s+/u, "");
      if (RX.issuePlace.test(v)) places.push(v);
    }
  }
  for (const text of fieldTexts(input.sections, "personenregister_urstazh")) {
    for (const raw of text.split(";")) {
      const e = raw.replace(/\s*\([^)]*\)/gu, "").trim();
      if (!e || e.includes(" siehe ")) continue;
      const bits = e.split(",").map((b) => b.trim()).filter(Boolean);
      const gi = bits.findIndex((b, i) => i >= 1 && givenOk(ctx, b.replace(/\s+(?:von|vom|de|zum|zur)$/u, "")));
      if (gi >= 1) persons.push(`${bits[gi]} ${bits[0]}`);
      else if (bits.length === 1 && bits[0].split(/\s+/).length >= 2 && givenOk(ctx, bits[0].split(/\s+/)[0])) persons.push(bits[0]);
    }
  }
  for (const text of fieldTexts(input.sections, "ortsregister_urstazh")) {
    for (const raw of text.split(";")) {
      const bits = raw.split(",").map((b) => b.trim());
      const last = (bits[bits.length - 1] ?? "").replace(" (Z)", "");
      // «…, Flumine, Heinrich de»: Partikel nach dem Vornamen wie im Personenregister.
      const given = last.replace(/\s+(?:von|vom|de|zum|zur)$/u, "");
      if (bits.length >= 3 && givenOk(ctx, given) && WL_ONLY.test(bits[bits.length - 2])) persons.push(`${last} ${bits[bits.length - 2]}`);
      for (const b of bits.slice(1)) {
        const m = RX.registerInstitution.exec(b);
        if (m) orgs.push(`${m[2]} ${m[1]}`);
      }
    }
  }
  for (const s of input.sections) {
    for (const f of s.fields) {
      for (const l of f.links) {
        if (!/d-nb\.info\/gnd|hls-dhs-dss\.ch/.test(l.href)) continue;
        const t = (l.text ?? "").trim();
        if (!t || t.startsWith("http") || t.startsWith("Artikel im HLS")) continue;
        const pf = personOrOrg(ctx, t);
        if (pf?.kind === "person") persons.push(pf.name);
      }
    }
  }
  // «Erscheinungsort : Verlag»; Verlagsnamen enthalten Kommas («Orell, Gessner, Füssli und Comp.»).
  for (const text of fieldTexts(input.sections, "impressum")) {
    const m = /^\(?([^():]+?)\)?\s*:\s*(.+)$/u.exec(text.split("\n")[0]);
    if (!m) continue;
    const publisher = m[2].replace(/,\s*\[?\d{4}\]?.*$/u, "").replace(/^\((.*)\)$/u, "$1").trim();
    if (!/s\.\s?l\.|o\.\s?O\./u.test(m[1])) places.push(m[1].trim());
    if (publisher && !/s\.\s?n\./u.test(publisher)) orgs.push(publisher);
  }

  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 2))];
  return { persons: clean(persons), places: clean(places), organizations: clean(orgs) };
}
