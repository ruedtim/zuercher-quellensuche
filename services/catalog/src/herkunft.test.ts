import { test } from "node:test";
import assert from "node:assert/strict";
import { herkunftKeys, parseHerkunft, stripParens } from "./herkunft.ts";

// Muster aus der Ehedatenbank (Zenodo 11191059, v6.0); die Orte sind real, die Zuordnung pur.

test("leer und «-»: keine Herkunft", () => {
  assert.equal(parseHerkunft(""), null);
  assert.equal(parseHerkunft("  "), null);
  assert.equal(parseHerkunft("-"), null);
  assert.equal(parseHerkunft(undefined), null);
});

test("Weiler in Klammern ⇒ Gemeinde im Kanton Zürich", () => {
  const h = parseHerkunft("Ottikon (Illnau-Effretikon)");
  assert.deepEqual(h, {
    text: "Ottikon (Illnau-Effretikon)",
    ort: "Ottikon",
    gemeinde: "Illnau-Effretikon",
    kanton: "ZH",
    land: null,
    raum: "zh",
    unsicher: false,
  });
  // «(bei X)» ist keine Gemeinde, die letzte Klammer schon
  assert.equal(parseHerkunft("Neuhaus (bei Wendhüslen) (Bubikon)")?.gemeinde, "Bubikon");
  assert.equal(parseHerkunft("Hof (bei Wila)")?.gemeinde, "Hof");
});

test("ohne Klammer, Kürzel oder Land: Ort im Kanton Zürich, wie er steht", () => {
  const h = parseHerkunft("Irgenhausen");
  assert.equal(h?.gemeinde, "Irgenhausen");
  assert.equal(h?.raum, "zh");
  assert.equal(h?.kanton, "ZH");
  assert.equal(parseHerkunft("Zürich")?.gemeinde, "Zürich");
  // mehrdeutige Weiler bleiben, Lindau ist eine Zürcher Gemeinde
  assert.equal(parseHerkunft("Lindau")?.raum, "zh");
});

test("Kantonskürzel ⇒ anderer Kanton, Klammerzusatz weg", () => {
  assert.deepEqual(parseHerkunft("Nussbaumen TG"), {
    text: "Nussbaumen TG",
    ort: "Nussbaumen",
    gemeinde: "Nussbaumen TG",
    kanton: "TG",
    land: null,
    raum: "ch",
    unsicher: false,
  });
  const k = parseHerkunft("Kappel (Toggenburg) SG");
  assert.equal(k?.gemeinde, "Kappel SG");
  assert.equal(k?.ort, "Kappel");
  assert.equal(parseHerkunft("Buchen (Kappel (Toggenburg)) SG")?.gemeinde, "Buchen SG");
  // ZH als Kürzel: Kanton Zürich
  assert.equal(parseHerkunft("Rheinau ZH")?.raum, "zh");
  // kein Kantonskürzel: zwei Grossbuchstaben, die keinen Kanton bezeichnen
  assert.equal(parseHerkunft("Yverdon D")?.raum, "zh");
});

test("Land in Klammern ⇒ Ausland, Landschaft weg", () => {
  assert.deepEqual(parseHerkunft("Büsingen (Deutschland)"), {
    text: "Büsingen (Deutschland)",
    ort: "Büsingen",
    gemeinde: "Büsingen (Deutschland)",
    kanton: null,
    land: "Deutschland",
    raum: "ausland",
    unsicher: false,
  });
  assert.equal(parseHerkunft("Munzenheim (Elsass) (Frankreich)")?.gemeinde, "Munzenheim (Frankreich)");
  assert.equal(parseHerkunft("Franken (Deutschland) (oder Frankreich ?)")?.land, "Deutschland");
  assert.equal(parseHerkunft("Württemberg (Deutschland)")?.gemeinde, "Württemberg (Deutschland)");
});

test("Land oder Landschaft allein; eindeutige Namen anderer Kantone", () => {
  assert.equal(parseHerkunft("Frankreich")?.raum, "ausland");
  assert.equal(parseHerkunft("Frankreich")?.gemeinde, "Frankreich");
  assert.equal(parseHerkunft("Hessen")?.gemeinde, "Hessen (Deutschland)");
  assert.equal(parseHerkunft("Hessen")?.land, "Deutschland");
  const sh = parseHerkunft("Schaffhausen");
  assert.equal(sh?.raum, "ch");
  assert.equal(sh?.kanton, "SH");
  assert.equal(parseHerkunft("Schweiz")?.raum, "ch");
  assert.equal(parseHerkunft("Schweiz")?.kanton, null);
});

test("unsicher gelesen: « ?» weg, Kennzeichen gesetzt", () => {
  const h = parseHerkunft("Gailingen ? (Deutschland)");
  assert.equal(h?.unsicher, true);
  assert.equal(h?.gemeinde, "Gailingen (Deutschland)");
  assert.equal(parseHerkunft("Rumlikon ?")?.text, "Rumlikon");
  assert.equal(parseHerkunft("Rumlikon ?")?.unsicher, true);
  assert.equal(parseHerkunft("Bibern SH ?")?.gemeinde, "Bibern SH");
});

test("Klammern entfernen, auch verschachtelt und offen", () => {
  assert.equal(stripParens("Buchen (Kappel (Toggenburg))"), "Buchen");
  assert.equal(stripParens("Pfaffhausen (Fällanden("), "Pfaffhausen");
});

test("Schlüssel für den Ortsfilter: Gemeinde, Ort, Land, Kanton", () => {
  assert.deepEqual(herkunftKeys(parseHerkunft("Irgenhausen (Pfäffikon)")!), ["pfafikon", "irgenhausen"]);
  assert.deepEqual(herkunftKeys(parseHerkunft("Nussbaumen TG")!), ["nusbaumen", "turgau"]);
  assert.deepEqual(herkunftKeys(parseHerkunft("Büsingen (Deutschland)")!), ["busingen", "deutschland"]);
  assert.deepEqual(herkunftKeys(parseHerkunft("Zürich")!), ["zurich"]);
});
