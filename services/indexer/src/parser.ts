import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { loadRatRefNames, personRefsOf } from "./rmGnd.ts";
import { loadRmNames, rmOrgName, rmPersonName, rmPlaceName, rmPlacesInSpan, type RmNamesIndex } from "./rmNames.ts";
import { rmSearchForm } from "./rmSearchForm.ts";
import { foldSharpS, titleSearchFor } from "./searchText.ts";
import type { DocRelation, PageBreak, ParsedTei, SeriesAbbr, Surface, TeiMetadata } from "./types.ts";

// Suchtext je Dokument höchstens 1 MiB (bis 2026-11-17: 100 KB). Bei 100 KB endeten die
// KRP-Sitzungen ohne Traktanden-Aufteilung (~6 % der Sitzungen ab 1995) genau bei 102'400
// Byte: Stichprobe 4 von 4 gekürzt, indexiert 63–96 % (TEI-Text 106–163 KB), Wörter aus dem
// Rest fanden die Sitzung nicht. Meili selbst indexiert je Feld höchstens 65'536
// Wortpositionen (jedes «. », «, », «;», «!», «?», «§» zählt 8) – etwa 35'000 Wörter Prosa,
// grob 230 KB; was darüber hinausgeht, steht im Text, ist aber nicht durchsuchbar.
export const MAX_BODY_BYTES = 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  // Tag-Textwerte NICHT zu Zahlen casten: sonst wird z. B. <idno>170.5</idno>
  // oder <idno>181.10</idno> zur Zahl 170.5/181.1 (Nachkomma-Null verloren) und
  // firstText() liefert null → serialNr (Ordnungsnummer) ginge verloren. TEI-
  // Textinhalt ist semantisch immer String; Zahlen werden ohnehin per Regex aus
  // Strings (ident/Filename) gezogen.
  parseTagValue: false,
  trimValues: false,
  preserveOrder: false,
  removeNSPrefix: true,
  // pb, lb sollen leere Elemente bleiben, nicht zu Strings kollabieren
  alwaysCreateTextNode: false,
  // Einige Elemente sind potentiell Listen – wir behandeln das beim Walken.
  isArray: (name) =>
    [
      "p", "div", "head", "lg", "l", "list", "item", "table", "row", "cell",
      "note", "ref", "persName", "placeName", "orgName", "title", "name",
      "pb", "lb", "milestone", "graphic", "surface", "zone", "figure",
    ].includes(name),
});

// Zweiter Parser mit preserveOrder=true – nur für die Body-Plaintext-Extraktion.
// Ohne preserveOrder zerreißt fast-xml-parser mixed content (Text + Inline-Tags
// im Wechsel) in separate Buckets ("#text" sammelt alle Text-Knoten, child-Tags
// landen in eigenen Arrays). Beim Zusammenbauen geht die ursprüngliche
// Reihenfolge – und damit die Wort-Whitespace-Grenzen – verloren ("InnernDer"
// statt "Direktion des Innern, Der").
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  // attributesGroupName NICHT explizit setzen – bei preserveOrder=true führt
  // das zu doppelt verschachtelten ":@"-Knoten (bekannter fast-xml-parser-Bug).
  // Der Default-Schlüssel ":@" gilt eh.
  attributeNamePrefix: "",
  textNodeName: "#text",
  preserveOrder: true,
  trimValues: false,
  removeNSPrefix: true,
});

// Block-Elemente erzeugen am Ende einen logischen Zeilenumbruch → Space im
// Plaintext. Inline-Elemente (persName, placeName, orgName, hi, …) nicht.
const BLOCK_TAGS = new Set([
  "p", "div", "head", "lg", "l", "list", "item", "table", "row", "cell",
  "note", "figure", "quote",
]);

export async function parseTeiFile(opts: {
  absPath: string;
  relPath: string;
  series: SeriesAbbr;
}): Promise<ParsedTei> {
  const buf = await readFile(opts.absPath);
  const xml = buf.toString("utf-8");
  const doc = parser.parse(xml) as Record<string, unknown>;
  const tei = doc["TEI"] as Record<string, unknown> | undefined;
  if (!tei) throw new Error(`no <TEI> root in ${opts.relPath}`);

  const teiHeader = tei["teiHeader"] as Record<string, unknown> | undefined;
  const text = tei["text"] as Record<string, unknown> | undefined;
  const facsimile = tei["facsimile"] as Record<string, unknown> | undefined;

  const biblGraphicUrl = extractBiblGraphicUrl(teiHeader);
  const meta = extractMetadata({ teiHeader, opts, biblGraphicUrl });
  const body = (text?.["body"] ?? null) as unknown;
  // Ordered-Parse einmal – sowohl für Plaintext (korrekte Word-Spaces in
  // mixed-content-Bereichen, vgl. Kommentar zum orderedParser oben) als auch
  // für die Entity-Extraktion. Doppelt zu parsen wäre verschwenderisch.
  const orderedBody = parseOrderedBody(xml);
  // RM: Suchtext = Lesefassung (Nasalstrich ausgeschrieben, ¬ aufgelöst; Plan E4),
  // TEI und HTML bleiben diplomatisch. Alle Serien: ß als ss (searchText.ts).
  const transform = opts.series === "RM" ? (t: string) => foldSharpS(rmSearchForm(t)) : foldSharpS;
  const plain = orderedBody ? bodyPlaintextFromChildren(orderedBody, MAX_BODY_BYTES, transform) : "";
  // RM: normalisierte Namen statt der Rohformen (rmNames.ts) – Personen nur mit Vor- und
  // Nachnamen, Orte aus dem Ortsverzeichnis, kuratierte Einrichtungen ohne die Räte. Die
  // Rohformen hätten Schreibvarianten weniger Präsides in die globalen Toplisten gebracht
  // (Plan E5). TEI und HTML bleiben diplomatisch.
  const entities = !orderedBody
    ? { persons: [], places: [], organizations: [] }
    : opts.series === "RM"
      ? extractRmEntities(orderedBody)
      : extractEntities(orderedBody);
  const pageBreaks = collectPageBreaks(body, orderedBody);
  const surfaces = collectSurfaces(facsimile);

  return {
    meta,
    body: plain,
    persons: entities.persons,
    places: entities.places,
    organizations: entities.organizations,
    pageBreaks,
    surfaces,
    biblGraphicUrl,
    rawXml: xml,
  };
}

function extractBiblGraphicUrl(teiHeader: Record<string, unknown> | undefined): string | null {
  if (!teiHeader) return null;
  const fileDesc = teiHeader["fileDesc"] as Record<string, unknown> | undefined;
  const sourceDesc = fileDesc?.["sourceDesc"] as Record<string, unknown> | undefined;
  const bibl = sourceDesc?.["bibl"] as Record<string, unknown> | undefined;
  if (!bibl) return null;
  const figure = bibl["figure"] as unknown;
  const figs = Array.isArray(figure) ? figure : figure ? [figure] : [];
  for (const fig of figs) {
    const f = fig as Record<string, unknown>;
    const g = f["graphic"];
    const gs = Array.isArray(g) ? g : g ? [g] : [];
    for (const grp of gs) {
      const url = (grp as Record<string, unknown>)["@_url"];
      if (typeof url === "string" && url.length > 0) return url;
    }
  }
  return null;
}

function extractMetadata(args: {
  teiHeader: Record<string, unknown> | undefined;
  opts: { absPath: string; relPath: string; series: SeriesAbbr };
  biblGraphicUrl: string | null;
}): TeiMetadata {
  const { teiHeader, opts } = args;
  const id = idFromRelPath(opts.relPath);

  const fileDesc = (teiHeader?.["fileDesc"] ?? {}) as Record<string, unknown>;
  const titleStmt = (fileDesc["titleStmt"] ?? {}) as Record<string, unknown>;
  const sourceDesc = (fileDesc["sourceDesc"] ?? {}) as Record<string, unknown>;
  const bibl = (sourceDesc["bibl"] ?? {}) as Record<string, unknown>;

  // Spezifischen sourceDesc/bibl/title bevorzugen: bei ABl ist titleStmt/title
  // immer generisch ("Amtsblatt des Kantons Zürich"); bibl/title enthält den
  // konkreten Eintragstitel. Bei OS/KRP/RRB sind beide gleich.
  const title =
    firstText(bibl["title"]) ?? firstText(titleStmt["title"]) ?? "(ohne Titel)";

  const biblDate = bibl["date"] as Record<string, unknown> | string | undefined;
  const date = extractDate(biblDate);
  const dateYear = date ? Number.parseInt(date.slice(0, 4), 10) : yearFromFilename(id, opts.series);

  const ident = firstText(bibl["ident"]);
  const idnoStr = firstText(bibl["idno"]);
  const refTarget = (() => {
    const r = bibl["ref"];
    if (!r) return null;
    const refs = Array.isArray(r) ? r : [r];
    for (const x of refs) {
      const t = (x as Record<string, unknown>)?.["@_target"];
      if (typeof t === "string" && t.length > 0) return t;
    }
    return null;
  })();

  // RM: archiveLink ist der Katalogeintrag des Bandes. Teilten sich ~70
  // Sitzungen dieselbe archiveId, bräche die Auflösung der Querverweise
  // (findByArchiveIds) – darum leer (Plan E8).
  const archiveId = opts.series === "RM" ? null : archiveIdFromUrl(refTarget);
  const relations = extractRelations(bibl, archiveId);

  const seriesAttrs = parseSeriesAttributes({
    series: opts.series,
    id,
    ident,
    idnoStr,
  });

  // Teilbestands-Marker für born-digital Spätbestände:
  // - KRP-Gever-Traktanden: `<edition>…Gever-Web-Service…</edition>` → "krp-late".
  // - RRB-zh.ch: pfadbasiert (`data/RRB/RRB_late/`) → "rrb-late". Bewusst NICHT
  //   per `<edition>`, weil dieselbe Editions-Bezeichnung den kuratierten RRB-
  //   Altbestand nicht unterscheidbar macht; der Pfad ist eindeutig.
  // - OS-ZH-Lex ab 1999: pfadbasiert (`data/OS/OS_late/`) → "os-late" (analog RRB).
  const edition = firstText(bibl["edition"]);
  const subset =
    edition && /gever/i.test(edition)
      ? "krp-late"
      : /(^|\/)RRB_late(\/|$)/.test(opts.relPath)
        ? "rrb-late"
        : /(^|\/)OS_late(\/|$)/.test(opts.relPath)
          ? "os-late"
          : null;

  return {
    id,
    series: opts.series,
    relativePath: opts.relPath,
    title,
    titleSearch: titleSearchFor(title),
    titleSort: title.toLocaleLowerCase("de").replace(/\s+/g, " ").trim(),
    date,
    dateYear: Number.isFinite(dateYear) ? dateYear : null,
    volumeNr: seriesAttrs.volumeNr,
    serialNr: seriesAttrs.serialNr,
    resolutionId: seriesAttrs.resolutionId,
    startPg: seriesAttrs.startPg,
    stazhIdent: ident ?? null,
    archiveLink: refTarget,
    // manifestUrl wird im iiif-Stage nachträglich gesetzt
    manifestUrl: null,
    subset,
    archiveId,
    relations,
  };
}

/**
 * Zieht die numerische Staatsarchiv-Katalog-ID aus einer detail.aspx-URL.
 * Case-insensitiv (`?ID=` im archiveLink, `?Id=` in den Relations-Attributen).
 */
function archiveIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/[?&]id=(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Parst `<sourceDesc><bibl><listRelation><relation>` zu DocRelation[].
 * `active` ist immer das eigene Dokument, `passive` das Ziel – wir verlinken
 * auf `passive` (Fallback `active`, falls `passive` == self oder fehlt). Ein
 * einzelnes `<relation>` ist beim Standard-Parser ein Objekt, mehrere ein
 * Array; beides normalisieren. Attribute tragen das `@_`-Präfix.
 */
function extractRelations(
  bibl: Record<string, unknown>,
  selfArchiveId: number | null,
): DocRelation[] {
  const listRelation = bibl["listRelation"] as Record<string, unknown> | undefined;
  if (!listRelation) return [];
  const rel = listRelation["relation"];
  if (!rel) return [];
  const rels = Array.isArray(rel) ? rel : [rel];
  const out: DocRelation[] = [];
  for (const r of rels) {
    const obj = r as Record<string, unknown>;
    const name = obj["@_name"];
    if (typeof name !== "string" || name.length === 0) continue;
    const active = typeof obj["@_active"] === "string" ? (obj["@_active"] as string) : null;
    const passive = typeof obj["@_passive"] === "string" ? (obj["@_passive"] as string) : null;
    // Ziel = passive, ausser passive zeigt aufs eigene Dokument (dann active).
    const passiveId = archiveIdFromUrl(passive);
    const useActive =
      passive == null || (selfArchiveId != null && passiveId === selfArchiveId);
    const url = useActive ? active : passive;
    if (!url) continue;
    out.push({ name, targetId: archiveIdFromUrl(url), url });
  }
  return out;
}

function idFromRelPath(relPath: string): string {
  const base = basename(relPath, ".xml");
  return base;
}

function firstText(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const t = firstText(x);
      if (t) return t;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const txt = obj["#text"];
    if (typeof txt === "string" && txt.trim()) return txt.trim();
    // Verschachtelte Mixed-Content-Knoten konkatenieren (z. B. <title>Foo <bar/> baz</title>)
    return concatText(obj).trim() || null;
  }
  return null;
}

function concatText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(concatText).join(" ");
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    let out = "";
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith("@_")) continue;
      if (key === "#text") {
        if (typeof val === "string") out += val;
        continue;
      }
      out += " " + concatText(val);
    }
    return out;
  }
  return "";
}

function extractDate(biblDate: unknown): string | null {
  if (biblDate == null) return null;
  // Kann String oder Object sein. Bei mehreren <date>-Knoten ist es Array.
  const candidates = Array.isArray(biblDate) ? biblDate : [biblDate];
  for (const cand of candidates) {
    if (typeof cand === "string") continue;
    const obj = cand as Record<string, unknown>;
    const when = obj["@_when"];
    if (typeof when === "string" && when.length >= 4) return normalizeDate(when);
    // RM: undatierbare Sitzung, `from`–`to` ist nur der mögliche Zeitraum
    // (zwischen den Nachbarsitzungen bzw. der des Bandes) – kein Datum.
    if (obj["@_cert"] === "low") continue;
    const from = obj["@_from"];
    if (typeof from === "string" && from.length >= 4) return normalizeDate(from);
    const text = firstText(cand);
    if (text) {
      const parsed = parseGermanDate(text);
      if (parsed) return parsed;
    }
  }
  return null;
}

function normalizeDate(input: string): string {
  // ISO-Variante: nimm erste 10 Zeichen wenn YYYY-MM-DD oder YYYY-MM oder YYYY
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(input)) return input + "-01";
  if (/^\d{4}$/.test(input)) return input + "-01-01";
  return input.slice(0, 10);
}

function parseGermanDate(text: string): string | null {
  // "23.05.1957" oder "23.05.1957-31.05.1957" → 1957-05-23
  const m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function yearFromFilename(id: string, series: SeriesAbbr): number {
  // ABl_1965__S__327-328_  → 1965
  // MM_1_1_KRP_1803_001    → 1803
  // MM_1_1_RRB_1803_0001   → 1803
  // OS_40__S__511-513__t   → kein Jahr im Filename
  const m = id.match(/_(\d{4})_/);
  if (m) return Number.parseInt(m[1], 10);
  if (series === "ABl") {
    const a = id.match(/^ABl_(\d{4})/);
    if (a) return Number.parseInt(a[1], 10);
  }
  return Number.NaN;
}

function parseSeriesAttributes(args: {
  series: SeriesAbbr;
  id: string;
  ident: string | null;
  idnoStr: string | null;
}): {
  volumeNr: number | null;
  serialNr: string | null;
  resolutionId: string | null;
  startPg: number | null;
} {
  const { series, id, ident, idnoStr } = args;
  let volumeNr: number | null = null;
  let serialNr: string | null = null;
  let resolutionId: string | null = null;
  let startPg: number | null = null;

  // OS: "StAZH OS 40 (S. 511-513)"  → volume 40, page 511
  if (series === "OS") {
    if (ident) {
      const vm = ident.match(/OS\s+(\d+)/i);
      if (vm) volumeNr = Number.parseInt(vm[1], 10);
      const pm = ident.match(/S\.\s*(\d+)/i);
      if (pm) startPg = Number.parseInt(pm[1], 10);
    }
    // serialNr = LS-Loseblatt-Systematik (z. B. "632.31"). Ab 1981 verlässlich
    // gepflegt, davor oft leer. Als String belassen, weil die Punkt-Notation
    // semantisch ist (hierarchische Sammlung).
    if (idnoStr) {
      const trimmed = idnoStr.trim();
      if (trimmed.length > 0) serialNr = trimmed;
    }
  }

  // ABl: "ABl_1965__S__327-328_"  → page 327
  if (series === "ABl") {
    const pm = id.match(/__S__(\d+)/);
    if (pm) startPg = Number.parseInt(pm[1], 10);
  }

  // RM: "StAZH B II 441, S. 22–25" → volumeNr 441 (nur informativ: Band-
  // Operationen laufen über die ID, 555/555a würden kollidieren);
  // startPg = laufende Nummer der Sitzung im Band (RM_1642_0441_0012 → 12).
  if (series === "RM") {
    const vm = ident?.match(/B\s+II\s+(\d+)/);
    if (vm) volumeNr = Number.parseInt(vm[1], 10);
    const sm = id.match(/_(\d{4})$/);
    if (sm) startPg = Number.parseInt(sm[1], 10);
  }

  // RRB: aus "StAZH MM 1.1 RRB 1803/0003" → resolutionId "1803/0003".
  // Manche Beschlüsse haben Buchstaben-Suffix (Anlagen/Beilagen), z. B.
  // "1810/0249a" – diese als eigenen Identifier behalten. Fallback aus dem
  // Filename "MM_1_1_RRB_1803_0003" (Altbestand) bzw. "RRB_2026_0534"
  // (born-digital, Spätbestand). <idno> NICHT verwenden – das ist die
  // Seitenangabe im Manualband (z. B. "8–9"), nicht die Beschlussnummer.
  if (series === "RRB") {
    const im = ident?.match(/RRB\s+(\d{4})\/(\d+)([a-zA-Z]*)/);
    if (im) {
      resolutionId = `${im[1]}/${im[2].padStart(4, "0")}${im[3]}`;
    } else {
      const fm = id.match(/(?:^|_)RRB_(\d{4})_(\d+)([a-zA-Z]*)/);
      if (fm) resolutionId = `${fm[1]}/${fm[2].padStart(4, "0")}${fm[3]}`;
    }
  }

  return { volumeNr, serialNr, resolutionId, startPg };
}

/**
 * Parst das XML mit dem ordered-Parser und liefert die Body-Children, oder
 * null wenn der Parse fehlschlägt oder kein <text>/<body> existiert.
 * Wird einmal pro Datei aufgerufen, das Ergebnis wird mehrfach konsumiert
 * (Plaintext + Entity-Extraktion).
 */
function parseOrderedBody(rawXml: string): Array<Record<string, unknown>> | null {
  let ordered: Array<Record<string, unknown>>;
  try {
    ordered = orderedParser.parse(rawXml) as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
  return findBodyChildren(ordered);
}

/**
 * Plaintext-Extraktion aus den ordered-Body-Children. Sorgt dafür, dass mixed
 * content (`Der <orgName>Regierungsrat</orgName>, nach Einsicht…`) korrekt
 * zusammengesetzt wird – der Inhalt aller Knoten kommt in der ursprünglichen
 * XML-Reihenfolge, und Block-/Linebreak-Elemente erzeugen Whitespace.
 */
function bodyPlaintextFromChildren(
  bodyChildren: Array<Record<string, unknown>>,
  maxBytes: number,
  transform?: (text: string) => string,
): string {
  const raw = collectOrderedText(bodyChildren);
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const norm = transform ? transform(collapsed) : collapsed;
  if (Buffer.byteLength(norm, "utf-8") <= maxBytes) return norm;
  const buf = Buffer.from(norm, "utf-8");
  return buf.subarray(0, maxBytes).toString("utf-8").replace(/�$/u, "");
}

/**
 * Sammelt alle Named-Entity-Vorkommen (persName, placeName, orgName) aus dem
 * Body. Filtert `type="deriv"` (abgeleitete Adjektivformen wie "Zürcher" für
 * "Zürich") aus, weil deren Inner-Text nicht das Lemma ist. Pro Dokument
 * werden Duplikate entfernt; Surface-Form wird leicht normalisiert
 * (Whitespace-Collapse, trailing Satzzeichen weg) – keine Lemmatisierung,
 * keine Case-Faltung. Sortiert für deterministische Ausgabe.
 */
export function extractEntities(bodyChildren: Array<Record<string, unknown>>): {
  persons: string[];
  places: string[];
  organizations: string[];
} {
  const persons = new Set<string>();
  const places = new Set<string>();
  const organizations = new Set<string>();
  walkForEntities(bodyChildren, persons, places, organizations);
  return {
    persons: [...persons].sort(),
    places: [...places].sort(),
    organizations: [...organizations].sort(),
  };
}

/** Ein Entity-Span der Ratsmanuale: Tag, Text wie collectOrderedText (diplomatisch), `@type`,
 *  GND und SSRQ-Personen-ID aus `@ref` (in Transkribus ausgezeichnete Personen, rmGnd.ts). */
export interface RmSpan {
  tag: "persName" | "placeName" | "orgName";
  text: string;
  type: string | null;
  gnd: string | null;
  ssrq: string | null;
}

/** RM: alle Entity-Spans in Dokumentreihenfolge, auch verschachtelte (Ort in einer Person). */
export function rmEntitySpans(bodyChildren: Array<Record<string, unknown>>): RmSpan[] {
  const out: RmSpan[] = [];
  const visit = (children: Array<Record<string, unknown>>) => {
    for (const child of children) {
      const tag = Object.keys(child).find((k) => k !== ":@" && k !== "#text");
      if (!tag) continue;
      const kids = child[tag];
      if (tag === "persName" || tag === "placeName" || tag === "orgName") {
        const attrs = (child[":@"] ?? {}) as Record<string, string>;
        const refs = personRefsOf(attrs["ref"]);
        out.push({
          tag,
          text: Array.isArray(kids) ? collectOrderedText(kids as Array<Record<string, unknown>>) : "",
          type: attrs["type"] ?? null,
          gnd: refs.gnd,
          ssrq: refs.ssrq,
        });
      }
      if (Array.isArray(kids)) visit(kids as Array<Record<string, unknown>>);
    }
  };
  visit(bodyChildren);
  return out;
}

/** RM-Spans einer TEI-Datei (Aufbau der Tabellen in rmNamesBuild.ts). */
export function rmEntitySpansFromXml(xml: string): RmSpan[] {
  const body = parseOrderedBody(xml);
  return body ? rmEntitySpans(body) : [];
}

/**
 * RM: normalisierte Namen je Sitzung (rmNames.ts). Personen mit Vor- und Nachnamen, Orte aus
 * dem Ortsverzeichnis (auch verschachtelte und nach «zu/von» in Personen- und Amts-Spans),
 * kuratierte Einrichtungen. Eine Person mit GND oder SSRQ-ID aus dem Register des Kleinen Rats
 * trägt dessen Namen, auch wenn der Text nur den Nachnamen nennt (rmGnd.ts). Ohne Dubletten, sortiert.
 */
export function extractRmEntities(
  bodyChildren: Array<Record<string, unknown>>,
  idx: RmNamesIndex = loadRmNames(),
  refNames: ReadonlyMap<string, string> = loadRatRefNames(),
): { persons: string[]; places: string[]; organizations: string[] } {
  const persons = new Set<string>();
  const places = new Set<string>();
  const organizations = new Set<string>();
  for (const span of rmEntitySpans(bodyChildren)) {
    if (span.type === "deriv") continue;
    if (span.tag === "persName") {
      const name =
        (span.gnd && refNames.get(span.gnd)) || (span.ssrq && refNames.get(span.ssrq)) || rmPersonName(span.text, idx);
      if (name) persons.add(name);
      for (const p of rmPlacesInSpan(span.text, "pers", idx)) places.add(p);
    } else if (span.tag === "placeName") {
      const place = rmPlaceName(span.text, idx);
      if (place) places.add(place);
    } else {
      const org = rmOrgName(span.text);
      if (org) organizations.add(org);
      for (const p of rmPlacesInSpan(span.text, "org", idx)) places.add(p);
    }
  }
  return {
    persons: [...persons].sort(),
    places: [...places].sort(),
    organizations: [...organizations].sort(),
  };
}

function walkForEntities(
  children: Array<Record<string, unknown>>,
  persons: Set<string>,
  places: Set<string>,
  organizations: Set<string>,
): void {
  for (const child of children) {
    const tag = Object.keys(child).find((k) => k !== ":@" && k !== "#text");
    if (!tag) continue;
    const attrs = (child[":@"] ?? {}) as Record<string, string>;

    if (tag === "persName" || tag === "placeName" || tag === "orgName") {
      // type="deriv" überspringen – Inner-Text ist eine flektierte/abgeleitete
      // Form, kein Lemma (z.B. "Zürcher" für Place "Zürich").
      if (attrs["type"] !== "deriv") {
        const kids = child[tag];
        const raw = Array.isArray(kids)
          ? collectOrderedText(kids as Array<Record<string, unknown>>)
          : "";
        const norm = normalizeEntityText(raw);
        if (norm) {
          if (tag === "persName") persons.add(norm);
          else if (tag === "placeName") places.add(norm);
          else organizations.add(norm);
        }
      }
      // Nicht weiter rekursieren: Entities verschachteln sich praktisch nie,
      // und falls doch, ist die innere Form nicht eigenständig sammelbar.
      continue;
    }

    const kids = child[tag];
    if (Array.isArray(kids)) {
      walkForEntities(
        kids as Array<Record<string, unknown>>,
        persons,
        places,
        organizations,
      );
    }
  }
}

function normalizeEntityText(raw: string): string {
  const norm = raw
    .replace(/\s+/g, " ")
    .trim()
    // Trailing-Satzzeichen abschneiden – das XML markiert oft "Regierungsrates."
    // mit dem Punkt im Tag, was sonst von "Regierungsrates" als eigene Form
    // unterschieden würde.
    .replace(/[.,;:]+$/, "")
    .trim();
  // OCR-/NER-Artefakte rausfiltern: einzelne Buchstaben/Ziffern, reine Zahlen,
  // Sonderzeichen-Präfixe ("& Bodmer", "'Heuscher", "...", "0", "500").
  // Eine sinnvolle Entity hat mindestens 2 Zeichen und beginnt mit einem
  // Buchstaben. Akzentbuchstaben + Umlaute sind erlaubt.
  if (norm.length < 2) return "";
  if (!/^[A-Za-zÀ-ÿ]/.test(norm)) return "";
  return norm;
}

function findBodyChildren(
  ordered: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> | null {
  const teiNode = ordered.find((x) => "TEI" in x);
  if (!teiNode) return null;
  const teiChildren = teiNode["TEI"];
  if (!Array.isArray(teiChildren)) return null;
  const textNode = teiChildren.find((x: unknown) => x && typeof x === "object" && "text" in (x as object));
  if (!textNode) return null;
  const textChildren = (textNode as Record<string, unknown>)["text"];
  if (!Array.isArray(textChildren)) return null;
  const bodyNode = textChildren.find((x: unknown) => x && typeof x === "object" && "body" in (x as object));
  if (!bodyNode) return null;
  const kids = (bodyNode as Record<string, unknown>)["body"];
  return Array.isArray(kids) ? (kids as Array<Record<string, unknown>>) : null;
}

function collectOrderedText(children: Array<Record<string, unknown>>): string {
  let out = "";
  for (const child of children) {
    const txt = child["#text"];
    if (typeof txt === "string") {
      out += txt;
      continue;
    }
    if (typeof txt === "number") {
      out += String(txt);
      continue;
    }
    const tag = Object.keys(child).find((k) => k !== ":@");
    if (!tag) continue;
    const attrs = (child[":@"] ?? {}) as Record<string, string>;

    // Leere/inhaltslose Inline-Marker
    if (tag === "lb") {
      // TEI P5: <lb break="no"/> = Wort umbricht ohne Trennung ("Be<lb/>schlusse")
      //         <lb/> (default break="yes") = Zeilenumbruch im Original → Space
      if (attrs["break"] !== "no") out += " ";
      continue;
    }
    if (tag === "pb" || tag === "milestone") {
      // <pb break="no"/>: Seitenwechsel mitten im Wort (RM) – kein Space
      if (attrs["break"] !== "no") out += " ";
      continue;
    }
    if (tag === "facsimile" || tag === "graphic") {
      // Image-Verweise haben keinen Lesetext
      continue;
    }

    const kids = child[tag];
    if (Array.isArray(kids)) {
      out += collectOrderedText(kids as Array<Record<string, unknown>>);
    }
    // Block-Elemente: trennender Space am Ende, sonst kleben Sätze aneinander
    if (BLOCK_TAGS.has(tag)) out += " ";
  }
  return out;
}

function collectPageBreaks(body: unknown, orderedBody: Array<Record<string, unknown>> | null): PageBreak[] {
  const out: PageBreak[] = [];
  // Dokumentreihenfolge aus dem ordered-Parse: der Objekt-Parse bündelt gleichnamige
  // Geschwister (alle <pb> eines div vor den <p>-Kindern). Stand ein Seitenwechsel im
  // Absatz und ein späterer auf div-Ebene, ordnete das RM-Manifest die Canvases falsch.
  if (orderedBody) {
    const visit = (nodes: Array<Record<string, unknown>>): void => {
      for (const node of nodes) {
        const tag = Object.keys(node).find((k) => k !== ":@" && k !== "#text");
        if (!tag) continue;
        if (tag === "pb") {
          const attrs = (node[":@"] ?? {}) as Record<string, unknown>;
          const n = attrs["n"];
          const facs = attrs["facs"];
          out.push({
            n: typeof n === "string" ? n : "",
            facs: typeof facs === "string" ? facs.replace(/^#/, "") : null,
          });
        }
        const kids = node[tag];
        if (Array.isArray(kids)) visit(kids as Array<Record<string, unknown>>);
      }
    };
    visit(orderedBody);
    return out;
  }
  walk(body, (node, name) => {
    if (name === "pb") {
      const obj = node as Record<string, unknown>;
      const n = obj["@_n"];
      const facs = obj["@_facs"];
      out.push({
        n: typeof n === "string" ? n : "",
        facs: typeof facs === "string" ? facs.replace(/^#/, "") : null,
      });
    }
  });
  return out;
}

function collectSurfaces(facsimile: unknown): Surface[] {
  const out: Surface[] = [];
  if (!facsimile) return out;
  walk(facsimile, (node, name) => {
    if (name === "surface") {
      const obj = node as Record<string, unknown>;
      const id = (obj["@_id"] as string | undefined) ?? "";
      let graphicUrl: string | null = null;
      let width: number | null = null;
      let height: number | null = null;
      const graphics = obj["graphic"];
      const gList = Array.isArray(graphics) ? graphics : graphics ? [graphics] : [];
      for (const g of gList) {
        const go = g as Record<string, unknown>;
        const url = go["@_url"];
        if (typeof url === "string") graphicUrl = url;
        const w = go["@_width"];
        if (typeof w === "string") width = parseDim(w);
        const h = go["@_height"];
        if (typeof h === "string") height = parseDim(h);
      }
      out.push({ id, graphicUrl, width, height });
    }
  });
  return out;
}

function parseDim(input: string): number | null {
  const m = input.match(/^(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

function walk(node: unknown, visit: (node: unknown, name: string) => void): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [name, val] of Object.entries(obj)) {
    if (name.startsWith("@_") || name === "#text") continue;
    if (Array.isArray(val)) {
      for (const v of val) {
        visit(v, name);
        walk(v, visit);
      }
    } else if (val && typeof val === "object") {
      visit(val, name);
      walk(val, visit);
    }
  }
}
