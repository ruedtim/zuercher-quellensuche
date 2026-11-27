import { test } from "node:test";
import assert from "node:assert/strict";
import { GazetteerBuilder, gazetteerOf } from "./gazetteer.ts";
import { ruleEntities, type RuleInput } from "./ruleEntities.ts";
import type { CatalogLink, CatalogPathNode, CatalogSection } from "./types.ts";

// Erfundene Personen in den Mustern des Erschliessungshandbuchs; Orte sind Zürcher Gemeinden.

const gaz = gazetteerOf([
  "Zürich", "Winterthur", "Zollikon", "Uetikon am See", "Hofstetten", "Wetzikon", "Andelfingen", "Niederhasli", "Flaach",
  "Wülflingen", "Dübendorf", "Grüningen", "Truttikon", "Bauma", "Wald", "Riesbach", "Uster", "Kyburg", "Töss",
]);
const ctx = { gaz, givenNames: new Set(["hans", "anna", "otto", "jakob", "kaspar", "eduard", "rudolf", "heinrich"]) };
const input = (title: string, extra: Partial<RuleInput> = {}): RuleInput => ({
  title,
  signature: "Z 1.1",
  ancestors: [],
  sections: [],
  hasTitlePersons: false,
  ...extra,
});
const node = (label: string, level: string): CatalogPathNode => ({ id: 1, label, level });
const field = (key: string, text: string, links: CatalogLink[] = []): CatalogSection => ({
  section: "Abschnitt",
  key: "abschnitt",
  fields: [{ label: key, key, text, links }],
});
const run = (title: string, extra: Partial<RuleInput> = {}) => ruleEntities(input(title, extra), ctx);

test("Ort aus der nächsten Klasse des Archivplans, nicht aus Bezirk oder Bestand", () => {
  const zivilstand = [node("NN Zivilstandswesen, 1876-1999 (Bestand)", "Bestand"), node("NN 372 Hofstetten, 1876-1999 (Klasse)", "Klasse")];
  assert.deepEqual(run("Geburtsregister, Bd. 1", { ancestors: zivilstand }).places, ["Hofstetten"]);
  const bezirk = [node("Bezirksgerichte (Bestand)", "Bestand"), node("Bezirk Uster, 1831-1990 (Klasse)", "Klasse")];
  assert.deepEqual(run("Strafbefehle", { ancestors: bezirk }).places, []);
  assert.deepEqual(run("Strafbefehle", { ancestors: [node("Uster, 1831-1990 (Bestand)", "Bestand")] }).places, []);
});

test("Titel ist ein Ortsname", () => {
  assert.deepEqual(run("Gemeinde Truttikon").places, ["Truttikon"]);
  assert.deepEqual(run("Bauma").places, ["Bauma"]);
});

test("Schulfotos, «Objekt, Gemeinde», Ortspräfix und Aktengruppe", () => {
  assert.deepEqual(run("Uetikon am See\nStufe/Klasse: Primarschule\nLehrperson: Frau Probe").places, ["Uetikon am See"]);
  const schule = run("Zürich (Kreis 11), Schulhaus Buhn\nStufe/Klasse: Primarschule\nLehrperson: Herr Muster");
  assert.ok(schule.places.includes("Zürich"));
  assert.deepEqual(schule.organizations, ["Schulhaus Buhn"]);
  const bach = run("Wehrenbach, Zollikon\nAntrag zur Korrektion des Wehrenbachs");
  assert.ok(bach.places.includes("Zollikon") && bach.places.includes("Wehrenbach"));
  assert.deepEqual(run("Wülflingen: Pfarrhaus; Längs- und Querschnitt", { signature: "PLAN R 1" }).places, ["Wülflingen"]);
  assert.deepEqual(run("Muster, Hans, Zürich: Waschbecken", { signature: "PAT 2, 125 b, Nr. 3", hasTitlePersons: true }).places, []);
  assert.deepEqual(run("Grundprotokoll Wetzikon, Bd. 56").places, ["Wetzikon"]);
});

test("Körperschaften mit Ort, Gebietskörperschaft nur als Ort", () => {
  const rat = run("Protokoll des Bezirksrats Andelfingen");
  assert.deepEqual(rat.organizations, ["Bezirksrat Andelfingen"]);
  assert.deepEqual(rat.places, ["Andelfingen"]);
  assert.deepEqual(run("Verzeichnis des Archivs der Zivilgemeinde Niederhasli").organizations, ["Zivilgemeinde Niederhasli"]);
  // Genitiv-«s» nur, wo die Grundform ein Körperschaftswort ist; bei Wahlkreis, Krankenhaus gehört es zum Wort.
  assert.deepEqual(run("Wahlen im Wahlkreis Uster").organizations, ["Wahlkreis Uster"]);
  assert.deepEqual(run("Zivilstandskreis Andelfingen").organizations, ["Zivilstandskreis Andelfingen"]);
  assert.deepEqual(run("Neubau Krankenhaus Wald").organizations, ["Krankenhaus Wald"]);
  assert.deepEqual(run("Protokolle des Gemeinderates Wetzikon").organizations, ["Gemeinderat Wetzikon"]);
  assert.deepEqual(run("Archiv des Klosters Töss").organizations, ["Kloster Töss"]);
  assert.deepEqual(run("Akten des Statthalteramts Uster").organizations, ["Statthalteramt Uster"]);
  assert.deepEqual(run("Herrschaft Flaach und Volken: Urbar").organizations, ["Herrschaft Flaach"]);
  assert.deepEqual(run("Rekurs der Gemeinde Uster").organizations, []);
});

test("Präposition nur mit eindeutigem Ort, Kantonskürzel, Land und Postleitzahl", () => {
  assert.deepEqual(run("Brand in Wald").places, []);
  assert.deepEqual(run("Brand in Bauma").places, ["Bauma"]);
  assert.ok(run("Muster, Hans, von Malters LU", { hasTitlePersons: true }).places.includes("Malters"));
  assert.ok(run("Reise nach Linz (Österreich)").places.includes("Linz"));
  const beiz = run("Restaurant Bären, Städtchen, 8627 Grüningen");
  assert.deepEqual(beiz.organizations, ["Restaurant Bären"]);
  assert.ok(beiz.places.includes("Grüningen"));
});

test("Firma mit Rechtsform, aber «Wettingen AG» ist der Kanton", () => {
  assert.ok(run("Weberei Tössthal AG, in Bauma").organizations.includes("Weberei Tössthal AG"));
  assert.deepEqual(run("Wettingen AG: Teil der Limmat oberhalb der Brücke").organizations, []);
  assert.deepEqual(run("Gutachten über die Fähre von Wettingen AG").organizations, []);
});

test("Autorschaft ohne Heimatort des Urhebers, Schreiber, Provenienz", () => {
  const foto = run("Strassenansicht", {
    sections: [field("autorschaft", "Aufnahme: Muster, Hans (1880-1950), Photograph, von Zürich\nPhotoglob AG, Zürich")],
  });
  assert.deepEqual(foto.persons, ["Hans Muster"]);
  assert.deepEqual(foto.organizations, ["Photoglob AG"]);
  assert.deepEqual(foto.places, []);
  assert.deepEqual(run("Abschrift", { sections: [field("schreiber", "Vermutlich Heinrich Exempel, Stadtschreiber")] }).persons, ["Heinrich Exempel"]);
  assert.deepEqual(run("Briefe", { sections: [field("provenienz", "Beispiel-Muster, Kaspar (1820-1902)")] }).persons, ["Kaspar Beispiel-Muster"]);
  assert.deepEqual(run("Briefe", { sections: [field("provenienz", "Direktion der Justiz")] }).persons, []);
});

test("Provenienz: Behörde mit Rollenwort ist keine Person, auch wenn das Lexikon das Wort führt", () => {
  // Das Lexikon enthielt bis 2026-11 «bezirksrat», «frau» und «dr» (Evaluation 2026-11-09).
  const polluted = { gaz, givenNames: new Set([...ctx.givenNames, "bezirksrat", "frau", "dr"]) };
  for (const c of [ctx, polluted]) {
    assert.deepEqual(ruleEntities(input("Akten", { sections: [field("provenienz", "Bezirksrat Andelfingen")] }), c).persons, []);
    // Eine Anrede ist eine Person, auch ohne Vornamen (ohne Schlüssel, der Aufbau verwirft sie).
    assert.deepEqual(ruleEntities(input("Akten", { sections: [field("provenienz", "Frau Muster")] }), c).persons, ["Frau Muster"]);
  }
  // Anrede vor einem Vornamen schadet nicht.
  assert.deepEqual(run("Briefe", { sections: [field("provenienz", "Frau Anna Exempel")] }).persons, ["Frau Anna Exempel"]);
});

test("Autorschaft: Kantonskürzel nach dem Heimatort ist keine Rechtsform, Initialen keine Organisation", () => {
  const karte = run("Karte des Kantons Zürich", {
    sections: [field("autorschaft", "Muster, Hans (1819-1879), Topograf und Kartograf, von Zofingen AG\nExempel (1822-1889), Ingenieur, von Uster\nD., K.")],
  });
  assert.deepEqual(karte.persons, ["Hans Muster", "Exempel", "K. D."]);
  assert.deepEqual(karte.organizations, []);
  // Nur Titel bzw. Anrede, gross geschriebene Partikel: Personen, keine Organisationen.
  const plan = run("Situationsplan", {
    sections: [field("autorschaft", "Probe, Dr. med.\nFrau V. Exempel\nDe Muster, M.\nDe Beispiel, Anna (1688-1766), Geografin")],
  });
  assert.deepEqual(plan.persons, ["Dr. Probe", "Frau V. Exempel", "M. De Muster", "Anna De Beispiel"]);
  assert.deepEqual(plan.organizations, []);
  // «AG» als Rechtsform sperrt die Person weiterhin.
  const druck = run("Plakat", { sections: [field("autorschaft", "Muster, Otto AG, Zürich")] });
  assert.deepEqual(druck.persons, []);
  assert.deepEqual(druck.organizations, ["Muster, Otto AG"]);
});

test("Urkundenfelder: Register, Ausstellungsort, GND-Links, Impressum", () => {
  const reg = run("Kaufbrief", {
    sections: [field("personenregister_urstazh", "Muster, Hans; Landenberg, Breitenlandenberg, Rudolf von; Probe, Anna (Z)")],
  });
  assert.deepEqual(reg.persons, ["Hans Muster", "Rudolf von Landenberg", "Anna Probe"]);
  const kette = run("Kaufbrief", { sections: [field("ortsregister_urstazh", "Winterthur, Töss (Dominikanerinnenkloster), Klosterfrau, Exempel, Anna")] });
  assert.deepEqual(kette.persons, ["Anna Exempel"]);
  const partikel = run("Urkunde", { sections: [field("ortsregister_urstazh", "Musterstadt, Bistum, Notar, Probe, Heinrich de")] });
  assert.deepEqual(partikel.persons, ["Heinrich de Probe"]);
  // «St. Johann» ist kein Vorname, auch wenn «St.» vor Namen sonst übersprungen wird.
  const kloster = run("Urkunde", { sections: [field("personenregister_urstazh", "Musterwil, Äbtissin, St. Johann, Anna von")] });
  assert.deepEqual(kloster.persons, ["Anna von Musterwil"]);
  assert.deepEqual(kette.organizations, ["Dominikanerinnenkloster Töss"]);
  assert.deepEqual(run("Urkunde", { sections: [field("ausstellungsort", "Schloss Kyburg und Winterthur")] }).places, ["Kyburg", "Winterthur"]);
  const gnd = run("Porträt", { sections: [field("gnd_links", "x", [{ text: "Heinrich Muster (1800-1870)", href: "https://d-nb.info/gnd/123456789" }])] });
  assert.deepEqual(gnd.persons, ["Heinrich Muster"]);
  const druck = run("Jahresbericht", { sections: [field("impressum", "Zürich : Obergericht")] });
  assert.deepEqual(druck.places, ["Zürich"]);
  assert.deepEqual(druck.organizations, ["Obergericht"]);
  assert.deepEqual(run("Mandat", { sections: [field("impressum", "Zürich : Orell, Gessner, Füssli und Comp.")] }).organizations, [
    "Orell, Gessner, Füssli und Comp.",
  ]);
  assert.deepEqual(run("Mandat", { sections: [field("impressum", "(Zürich) : (s. n.)")] }).organizations, []);
});

test("Lücken des Titelschemas", () => {
  const init = run("Muster, H., Spenglerei, in Zürich");
  assert.deepEqual(init.persons, ["H. Muster"]);
  assert.ok(init.places.includes("Zürich"));
  assert.deepEqual(run("Von Probe, Otto (geb. 1917), von Uster").persons, ["Otto Von Probe"]);
  assert.deepEqual(run("Erben des Exempel, Kaspar (gest. 1918), in Andelfingen").persons, ["Kaspar Exempel"]);
  assert.deepEqual(run("Schadenersatzforderung wegen Verhaftung von MUSTER, Eduard").persons, ["Eduard Muster"]);
  assert.deepEqual(run("Muster, H., Spenglerei, in Zürich", { hasTitlePersons: true }).persons, []);
  const fall = run("Muster, Hans (geb. 1900), von Zürich\nBetrug in Uster am 12.03.1950; Opfer: Anna Probe", { hasTitlePersons: true });
  assert.deepEqual(fall.persons, ["Anna Probe"]);
  assert.ok(fall.places.includes("Uster"));
});

test("Ortsverzeichnis aus Gemeinde-Klassen und KRDB-Wohnorten", () => {
  const b = new GazetteerBuilder();
  b.addClass("GA Gemeindearchive, 1250-2010 (Bestand)", "Niederhasli");
  b.addClass("GA Gemeindearchive, 1250-2010 (Bestand)", "Allgemeines");
  b.addClass("NN 301 - NN 500 Zivilstandswesen (Bestand)", "Theilingen (Weisslingen)");
  b.addClass("Steueramt, 1899-1990 (Bestand)", "Nurhier");
  b.addClass("Steueramt, 1899-1990 (Bestand)", "Niederhasli");
  b.addClass("E III Kirchenbücher (Bestand)", "E III 12 Bäretswil");
  b.addClass("Helvetik (Bestand)", "Distrikt Andelfingen");
  b.addKrdbPlace("Affoltern a. A.");
  b.addKrdbPlace("Zürich 2");
  b.addKrdbPlace("Wald");
  const g = b.build();
  for (const p of ["Niederhasli", "Theilingen", "Weisslingen", "Bäretswil", "Andelfingen", "Affoltern am Albis", "Wald", "Leimbach"]) {
    assert.ok(g.all.has(p), p);
  }
  for (const p of ["Allgemeines", "Nurhier", "Zürich 2"]) assert.ok(!g.all.has(p), p);
  assert.ok(!g.strict.has("Wald") && g.strict.has("Niederhasli"));
});
