/**
 * Vergleichsschlüssel für Named Entities (Personen, Orte, Organisationen).
 *
 * Zwei Namensformen gelten als dieselbe Entität, wenn ihr Schlüssel gleich ist –
 * Grundlage der Vorschläge «Möglicherweise verwandte Akten» zwischen den
 * Plattform-Dokumenten (NER-Formen) und dem Archivkatalog (NER + Titelschema).
 * Gefaltet werden Gross-/Kleinschreibung, Umlaute und Diakritika, gängige
 * Schreibvarianten (c/k, ph/f, th/t, y/i, ae/oe/ue, Doppelkonsonanten) sowie
 * die Archivform «Nachname, Vorname». Personen brauchen Vor- und Nachnamen;
 * ein nackter Nachname ergibt keinen Schlüssel.
 *
 * Pur und import-frei: services/catalog (Katalog-Aufbau, nur auf dem Mac)
 * importiert die Datei direkt, services/indexer hält eine Kopie
 * (src/vendor/entityKey.ts, `npm run sync-entity-key`, Drift-Test). Unit-getestet
 * in entityKey.test.ts.
 *
 * Zwei Fassungen: Fassung 1 (personKey, placeKey, orgKey) steckt in den Indizes
 * catalog, ehedaten und editions; Fassung 2 (…V2, 2026-11) in den Feldern
 * personKeys/placeKeys/orgKeys des documents-Index. Fassung 2 fasst nur doppelte
 * Konsonanten zusammen (Staat ≠ Stadt, Zürich II ≠ Zürich I), lässt Kanton,
 * Bezirk und Amt im Ortsnamen (Kanton Zürich ≠ Zürich), streicht nur das Kürzel
 * ZH (Pfäffikon SZ ≠ Pfäffikon) und liest «-weil» wie «-wil» (Wädensweil). Die
 * anderen Indizes ziehen bei ihrem nächsten Aufbau nach. Wer eine Fassung
 * ändert, muss den Index, der sie speichert, neu verschlüsseln – die Web-App
 * rechnet die Schlüssel der Filterwerte zur Suchzeit.
 */

export type EntityKind = "person" | "place" | "org";

/** Anreden, Titel und Ämter vor dem Namen («Herr Statthalter Billeter»). */
const PERSON_PREFIXES = new Set([
  "herr", "herrn", "herren", "hr", "hrn", "frau", "fr", "fraulein", "jungfrau", "jungfer", "witwe", "wwe",
  "dr", "prof", "professor", "med", "iur", "jur", "phil", "lic", "dipl", "ing", "theol", "vet",
  "sel", "selig", "alt", "junker", "jkr", "ritter", "sankt", "st",
  "burgermeister", "buergermeister", "statthalter", "landvogt", "obervogt", "vogt", "pfarrer", "dekan",
  "zunftmeister", "ratsherr", "seckelmeister", "stadtschreiber", "landschreiber", "schultheiss",
  "regierungsrat", "regierungsratin", "regierungsprasident", "kantonsrat", "kantonsratin", "nationalrat",
  "standerat", "stadtrat", "gemeinderat", "gemeindeprasident", "prasident", "oberst", "major",
  "hauptmann", "leutnant", "oberrichter", "bezirksrichter", "bezirksrat", "statthalterin",
]);

const PLACE_PREFIXES = new Set(["kanton", "stadt", "gemeinde", "bezirk", "dorf", "amt", "herrschaft", "grafschaft"]);

/** Kantonskürzel am Ende von Ortsangaben («Diessenhofen TG»). */
const CANTON_CODES = new Set([
  "zh", "be", "lu", "ur", "sz", "ow", "nw", "gl", "zg", "fr", "so", "bs", "bl", "sh", "ar", "ai",
  "sg", "gr", "ag", "tg", "ti", "vd", "vs", "ne", "ge", "ju",
]);

/** Kleinschreibung, ß → ss, Diakritika weg, nur Buchstaben/Ziffern als Wörter. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Anrede, Titel oder Amt vor dem Namen («Frau», «Dr.», «Bezirksrat»), die personKey
 *  überspringt – nie ein Vorname (Vornamen-Lexikon des Katalog-Aufbaus). */
export function isPersonPrefix(word: string): boolean {
  return PERSON_PREFIXES.has(foldText(word));
}

/** Schreibvarianten eines Wortes angleichen (Carl/Karl, Philipp/Filip, Müller/Mueller). */
function variantWord(w: string): string {
  return w
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/dt/g, "t")
    .replace(/ck/g, "k")
    .replace(/c(?!h)/g, "k")
    .replace(/y/g, "i");
}

/** Fassung 1: dazu jeden doppelten Buchstaben zusammenfassen. */
function fuzzyWord(w: string): string {
  return variantWord(w).replace(/([a-z])\1+/g, "$1");
}

/** Fassung 2: nur doppelte Konsonanten (Staat ≠ Stadt, II ≠ I). Eigene Funktion, nicht
 *  per Parameter – `ws.map(fuzzyWord)` reicht den Index als zweites Argument durch. */
function fuzzyWordV2(w: string): string {
  return variantWord(w).replace(/([b-df-hj-np-tv-z])\1+/g, "$1");
}

function words(form: string): string[] {
  return foldText(form.replace(/\([^)]*\)/g, " ")).split(" ").filter(Boolean);
}

/** Wörter eines Namens, gefaltet wie im Schlüssel, ohne Prüfung (auch Initialen). */
export function nameWords(form: string): string[] {
  return words(form).map(fuzzyWord);
}

/** «Nachname, Vorname» → «Vorname Nachname»; andere Formen unverändert. */
function uninvert(form: string): string {
  const m = /^\s*([^,]+),\s*([^,]+?)\s*$/.exec(form.replace(/\([^)]*\)/g, " "));
  return m ? `${m[2]} ${m[1]}` : form;
}

export function personKey(form: string): string | null {
  const ws = words(uninvert(form));
  while (ws.length > 0 && PERSON_PREFIXES.has(ws[0])) ws.shift();
  if (ws.length < 2 || ws[ws.length - 1].length < 2 || /\d/.test(ws.join(""))) return null;
  return ws.map(fuzzyWord).join(" ");
}

export function placeKey(form: string): string | null {
  const ws = words(form);
  while (ws.length > 1 && PLACE_PREFIXES.has(ws[0])) ws.shift();
  if (ws.length > 1 && CANTON_CODES.has(ws[ws.length - 1])) ws.pop();
  const key = ws.map(fuzzyWord).join(" ");
  return key.length >= 2 && !/^\d+$/.test(key) ? key : null;
}

export function orgKey(form: string): string | null {
  const ws = words(form.replace(/&/g, " und ")).map((w) => (w === "cie" ? "co" : w));
  const key = ws.map(fuzzyWord).join(" ");
  return key.replace(/ /g, "").length >= 3 ? key : null;
}

export function entityKey(kind: EntityKind, form: string): string | null {
  return kind === "person" ? personKey(form) : kind === "place" ? placeKey(form) : orgKey(form);
}

// --- Fassung 2 (documents-Index) ---------------------------------------------------

/** Fassung 2 streicht nur diese Wörter vor einem Ortsnamen (Stadt Zürich = Zürich). */
const PLACE_PREFIXES_V2 = new Set(["stadt", "gemeinde", "dorf"]);

/** Verwaltungswörter, die in Fassung 2 Teil des Ortsnamens bleiben: Genitiv und
 *  Abkürzung angeglichen (des Kantons Zürich = Kt. Zürich = Kanton Zürich). */
const PLACE_ADMIN_V2: Record<string, string> = {
  kanton: "kanton", kantons: "kanton", kant: "kanton", kt: "kanton",
  bezirk: "bezirk", bezirks: "bezirk", bezirkes: "bezirk", bez: "bezirk",
  amt: "amt", amts: "amt", amtes: "amt",
};

/** «-weil» wie «-wil» (Wädensweil, Hinweil, Thalweil); «Weil» allein bleibt. */
function wilWord(w: string): string {
  return w.length > 4 && w.endsWith("weil") ? `${w.slice(0, -4)}wil` : w;
}

export function personKeyV2(form: string): string | null {
  const ws = words(uninvert(form));
  while (ws.length > 0 && PERSON_PREFIXES.has(ws[0])) ws.shift();
  if (ws.length < 2 || ws[ws.length - 1].length < 2 || /\d/.test(ws.join(""))) return null;
  return ws.map((w) => fuzzyWordV2(w)).join(" ");
}

/** Anreden und Ämter, die auch Nachnamen sind (Hans Vogt, Anna Ritter, Max Alt). */
const PERSON_PREFIXES_SURNAMES = new Set(["herren", "alt", "junker", "ritter", "vogt", "pfarrer", "dekan", "major", "hauptmann", "oberst"]);

/**
 * Getippte Wörter einer Personensuche, gefaltet wie Fassung 2 (für Vorschläge, nicht für
 * Schlüssel): führende Anreden fallen weg, solange ein weiteres Wort mit mindestens zwei
 * Buchstaben bleibt («Herr Frei» → frei) – Wörter, die auch Nachnamen sind, bleiben stehen
 * («Vogt E» → vogt e, «Ritter Hans» → riter hans).
 */
export function personQueryWordsV2(q: string): string[] {
  const ws = words(uninvert(q));
  while (ws.length > 1 && PERSON_PREFIXES.has(ws[0]) && !PERSON_PREFIXES_SURNAMES.has(ws[0]) && ws.slice(1).some((w) => w.length >= 2)) {
    ws.shift();
  }
  return ws.map((w) => fuzzyWordV2(w));
}

export function placeKeyV2(form: string): string | null {
  const ws = words(form).map((w) => (w === "sankt" ? "st" : w));
  while (ws.length > 1 && PLACE_PREFIXES_V2.has(ws[0])) ws.shift();
  if (ws.length > 1 && ws[ws.length - 1] === "zh") ws.pop();
  const fw = ws.map((w) => wilWord(fuzzyWordV2(w)));
  if (fw.length > 1 && PLACE_ADMIN_V2[fw[0]]) fw[0] = PLACE_ADMIN_V2[fw[0]];
  const key = fw.join(" ");
  return key.length >= 2 && !/^\d+$/.test(key) ? key : null;
}

export function orgKeyV2(form: string): string | null {
  const ws = words(form.replace(/&/g, " und ")).map((w) => (w === "cie" ? "co" : w));
  const key = ws.map((w) => wilWord(fuzzyWordV2(w))).join(" ");
  return key.replace(/ /g, "").length >= 3 ? key : null;
}

export function entityKeyV2(kind: EntityKind, form: string): string | null {
  return kind === "person" ? personKeyV2(form) : kind === "place" ? placeKeyV2(form) : orgKeyV2(form);
}
