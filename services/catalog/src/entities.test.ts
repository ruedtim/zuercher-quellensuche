import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addKeyCounts,
  baseFormCandidates,
  type KeyCounts,
  mergeEntities,
  nerBaseForm,
  nerStopped,
  placeLinkCandidates,
  nerText,
  newKeyCounts,
  newNerFilterStats,
  registerPlaces,
  textHash,
} from "./entities.ts";
import type { CatalogRecord } from "./types.ts";

function rec(title: string, fields: Array<[string, string]>): CatalogRecord {
  return {
    id: 1,
    url: "",
    signature: "C I, Nr. 1",
    title,
    level: "Dokument",
    date_text: null,
    parent_id: null,
    path: [],
    fields: {},
    sections: [{ section: "x", key: "x", fields: fields.map(([key, text]) => ({ label: key, key, text, links: [] })) }],
  };
}

test("NER-Text: Titel, Regest und Inhalt ohne Dublette", () => {
  const r = rec("Titel.", [
    ["regest", "Regest."],
    ["inhalt_und_form", "Regest."],
  ]);
  assert.equal(nerText(r), "Titel.\nRegest.");
  assert.equal(textHash("a"), textHash("a"));
  assert.notEqual(textHash("a"), textHash("b"));
});

test("Ortsregister der Urkundenregesten", () => {
  const r = rec("x", [["ortsregister_urstazh", "Musterreich, Albrecht, Herzog von; Beispielhausen; Zürich, Hans Muster, Bürger."]]);
  assert.deepEqual(registerPlaces(r), ["Musterreich", "Beispielhausen", "Zürich"]);
});

const counts = (person: Record<string, number>, place: Record<string, number> = {}, org: Record<string, number> = {}): KeyCounts => ({
  person: new Map(Object.entries(person)),
  place: new Map(Object.entries(place)),
  org: new Map(Object.entries(org)),
});
const noUnit = { person: new Set<string>(), place: new Set<string>(), org: new Set<string>() };

test("NER-Stoppliste: Sachgebiete, Versicherungszweige, Altäre, «Kernen»", () => {
  for (const t of ["Notariatswesen", "Gerichtswesens", "Markt- und Hausierwesen", "Unfallversicherung"]) assert.ok(nerStopped("ORG", t), t);
  assert.ok(nerStopped("LOC", "Sankt-Blasius-Altars") && nerStopped("ORG", "Marienaltar") && nerStopped("LOC", "Altar des heiligen Kreuzes"));
  assert.ok(nerStopped("LOC", "Kernen"));
  for (const [l, t] of [["ORG", "Schweizerische Unfallversicherung"], ["ORG", "Verband für Rechnungswesen"], ["PER", "Hans Kernen"], ["LOC", "Kernenried"], ["ORG", "Walter Kaltarbeit AG"]] as const) {
    assert.ok(!nerStopped(l, t), t);
  }
});

test("Grundform-Kandidaten: Genitiv und schwache Adjektive im Kopf, bei Personen nur das letzte Wort", () => {
  assert.deepEqual(baseFormCandidates("ORG", "Bezirksrats Musterwil"), ["Bezirksrat Musterwil"]);
  assert.ok(baseFormCandidates("ORG", "Kleinen Rats").includes("Kleiner Rat"));
  assert.ok(!baseFormCandidates("ORG", "Kleinen Rats").includes("Kleinen Rat"));
  assert.ok(placeLinkCandidates("ORG", "Statthalteramtes des Bezirks Musterwil").includes("Statthalteramt Musterwil"));
  assert.deepEqual(placeLinkCandidates("LOC", "Kirche der Gemeinde Musterwil"), []);
  assert.deepEqual(baseFormCandidates("ORG", "Kirchenrats der Evangelischen Kirche des Kantons Zürich"), ["Kirchenrat der Evangelischen Kirche des Kantons Zürich"]);
  assert.deepEqual(baseFormCandidates("PER", "Uli Musterlis"), ["Uli Musterli"]);
  assert.deepEqual(baseFormCandidates("PER", "Hermanns von Musterwil"), ["Hermann von Musterwil"]);
  // Personen: Vornamen auf «-s», «-es» und die Archivform bleiben.
  assert.deepEqual(baseFormCandidates("PER", "Andreas Muster"), []);
  assert.deepEqual(baseFormCandidates("PER", "Johannes von Musterwil"), ["Johanne von Musterwil"]);
  assert.deepEqual(baseFormCandidates("PER", "Muster, Johannes"), []);
  assert.deepEqual(baseFormCandidates("LOC", "Zürichs"), ["Zürich"]);
  assert.deepEqual(baseFormCandidates("ORG", "Schloss"), []);
  assert.deepEqual(baseFormCandidates("LOC", "Musterhaus"), []);
  assert.deepEqual(baseFormCandidates("LOC", "Musterhauses"), ["Musterhause", "Musterhaus"]);
  assert.deepEqual(baseFormCandidates("PER", "Hans Markus"), []);
  // Starke Adjektive auf «-es» und klein geschriebene Wörter sind kein Genitiv, ein Ort vor dem
  // Kantonskürzel kein Adjektiv.
  assert.deepEqual(baseFormCandidates("ORG", "Eidgenössisches Departement des Innern"), []);
  assert.deepEqual(baseFormCandidates("ORG", "Deutsches Generalkonsulat"), []);
  assert.deepEqual(baseFormCandidates("ORG", "Rotes Kreuz"), []);
  assert.deepEqual(baseFormCandidates("LOC", "Musterlingen AG"), []);
  const steueramt = baseFormCandidates("ORG", "kantonalen Steueramtes");
  assert.ok(steueramt.includes("kantonales Steueramt") && !steueramt.includes("kantonalen Steueramt"), steueramt.join(" | "));
});

test("Grundform: gleicher Schlüssel, die Form mit dem kürzesten Schnitt", () => {
  const c = counts({}, { zurichse: 50 });
  assert.equal(nerBaseForm("LOC", "Zürichsees", { unit: noUnit, counts: c }), "Zürichsee");
});

test("Grundform nur, wenn ihr Schlüssel in der Einheit oder im Aufbau vorkommt", () => {
  const unit = { ...noUnit, org: new Set(["bezirksrat musterwil"]) };
  assert.equal(nerBaseForm("ORG", "Bezirksrats Musterwil", { unit }), "Bezirksrat Musterwil");
  assert.equal(nerBaseForm("ORG", "Bezirksrats Musterwil", { unit: noUnit }), "Bezirksrats Musterwil");
  const c = counts({ "uli musterli": 2, "hans fuch": 1 }, { zurich: 900, zurichs: 40 }, { "medizinische fakultat": 12, "medizinischen fakultat": 3 });
  assert.equal(nerBaseForm("PER", "Uli Musterlis", { unit: noUnit, counts: c }), "Uli Musterli");
  assert.equal(nerBaseForm("LOC", "Zürichs", { unit: noUnit, counts: c }), "Zürich");
  assert.equal(nerBaseForm("ORG", "Medizinischen Fakultät", { unit: noUnit, counts: c }), "Medizinische Fakultät");
  // Organisationen: ein Beleg genügt, auch wenn der Genitiv häufiger ist.
  const rat = counts({}, {}, { erziehungsrat: 2, erziehungsrates: 9 });
  assert.equal(nerBaseForm("ORG", "Erziehungsrates", { unit: noUnit, counts: rat }), "Erziehungsrat");
  // Ohne belegte Grundform bleibt die Form; Orte und Personen auch, wenn sie selbst häufiger ist.
  assert.equal(nerBaseForm("ORG", "Kunsthaus", { unit: noUnit, counts: counts({}, {}, { kunsthaus: 3 }) }), "Kunsthaus");
  assert.equal(nerBaseForm("LOC", "Buchs", { unit: noUnit, counts: counts({}, { buchs: 50, buch: 10 }) }), "Buchs");
  assert.equal(nerBaseForm("PER", "Hans Fuchs", { unit: noUnit, counts: counts({ "hans fuchs": 5, "hans fuch": 1 }) }), "Hans Fuchs");
  // Ohne «der Stadt» nur, wenn die kurze Form mindestens so oft vorkommt.
  const schule = counts({}, {}, { "musterschule der stat zurich": 9, "musterschule zurich": 2 });
  assert.equal(nerBaseForm("ORG", "Musterschule der Stadt Zürich", { unit: noUnit, counts: schule }), "Musterschule der Stadt Zürich");
  // Steht die Form selbst in der Einheit, bleibt sie.
  assert.equal(nerBaseForm("LOC", "Zürichs", { unit: { ...noUnit, place: new Set(["zurichs"]) }, counts: c }), "Zürichs");
});

test("Nachfilter im Zusammenführen: Grundform trifft den Regel-Schlüssel, Kürzel, Stoppliste", () => {
  const stats = newNerFilterStats();
  const e = mergeEntities({
    rules: { persons: [], places: ["Musterwil"], organizations: ["Bezirksrat Musterwil"] },
    ner: [
      ["ORG", "Bezirksrats Musterwil"],
      ["ORG", "Notariatswesen"],
      ["LOC", "Hausen a. A."],
      ["ORG", "Medizinischen Fakultät"],
    ],
    keyCounts: counts({}, {}, { "medizinische fakultat": 4 }),
    nerStats: stats,
  });
  assert.deepEqual(e.organizations, ["Bezirksrat Musterwil", "Medizinische Fakultät"]);
  assert.deepEqual(e.places, ["Musterwil", "Hausen am Albis"]);
  assert.deepEqual([stats.base, stats.abbr, stats.stopped], [2, 1, 1]);
  assert.equal(stats.pairs.get("ORG Bezirksrats Musterwil → Bezirksrat Musterwil"), 1);
  const c = newKeyCounts();
  addKeyCounts(c, e);
  addKeyCounts(c, e);
  assert.equal(c.org.get("bezirksrat musterwil"), 2);
});

test("Zusammenführen: Titelschema vor NER, gleiche Schlüssel nur einmal", () => {
  const e = mergeEntities({
    title: { schema: "person", persons: [{ last: "Muster", first: "Hans Jakob" }], places: ["Stäfa"], organizations: [] },
    ner: [
      ["PER", "Muster, Hans Jakob"],
      ["PER", "Anna Beispiel"],
      ["LOC", "Stäfa"],
      ["ORG", "Spinnerei Musterthal AG"],
      ["PER", "Meier"],
    ],
    registerPlaces: ["Uster"],
  });
  assert.deepEqual(e.persons, ["Hans Jakob Muster", "Anna Beispiel"]);
  assert.deepEqual(e.places, ["Stäfa", "Uster"]);
  assert.deepEqual(e.organizations, ["Spinnerei Musterthal AG"]);
  assert.equal(e.personKeys.length, 2);
});
