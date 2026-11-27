import { test } from "node:test";
import assert from "node:assert/strict";
import { entityKey, entityKeyV2, foldText, isPersonPrefix, nameWords, orgKey, orgKeyV2, personKey, personKeyV2, placeKey, placeKeyV2 } from "./entityKey";

test("foldText: Umlaute, ß, Diakritika, Satzzeichen", () => {
  assert.equal(foldText("Rüegg-Weiß, Hélène"), "ruegg weiss helene");
  assert.equal(foldText("  St. Gallen "), "st gallen");
});

test("Schlüssel und Namenswörter: ß und ss sind gleich, in beiden Fassungen", () => {
  for (const [a, b] of [["Hans Großmann", "Hans Grossmann"], ["Georg von Wyß", "Georg von Wyss"], ["Meß, Anna", "Mess, Anna"], ["HANS GROẞ", "Hans Gross"]]) {
    assert.equal(personKey(a), personKey(b));
    assert.equal(personKeyV2(a), personKeyV2(b));
    assert.deepEqual(nameWords(a), nameWords(b));
  }
  for (const key of [placeKey, placeKeyV2]) assert.equal(key("Küßnacht"), key("Küssnacht"));
  for (const key of [orgKey, orgKeyV2]) assert.equal(key("Schloßverwaltung Kyburg"), key("Schlossverwaltung Kyburg"));
});

test("Personen: Archivform und Fliesstext ergeben denselben Schlüssel", () => {
  const a = personKey("Wildpret, Carl Joseph");
  assert.equal(a, personKey("Carl Joseph Wildpret"));
  assert.equal(a, personKey("Karl Joseph Wildpret"));
  assert.equal(personKey("Müller, Hans Jakob"), personKey("Hans Jacob Mueller"));
  assert.equal(personKey("Philipp Hotz"), personKey("Filipp Hotz"));
  assert.notEqual(personKey("Hans Hotz"), personKey("Hans Hoz"));
});

test("Personen: Anreden und Ämter fallen weg, Lebensdaten in Klammern auch", () => {
  assert.equal(personKey("Herr Statthalter Hans Billeter"), personKey("Hans Billeter"));
  assert.equal(personKey("Burgermeister Salomon Hirzel"), personKey("Hirzel, Salomon"));
  assert.equal(personKey("Oechsli, Wilhelm (geb. 1851)"), personKey("Wilhelm Oechsli"));
  assert.equal(personKey("Dr. med. Anna Heer"), personKey("Anna Heer"));
});

test("Anreden, Titel und Ämter erkennen (wie personKey sie überspringt)", () => {
  for (const w of ["Frau", "Dr.", "Prof.", "Bezirksrat", "Präsident", "Fräulein"]) assert.ok(isPersonPrefix(w), w);
  for (const w of ["Anna", "Hans", "Bezirk", "Zürich"]) assert.ok(!isPersonPrefix(w), w);
});

test("Personen: ohne Vornamen kein Schlüssel", () => {
  assert.equal(personKey("Meier"), null);
  assert.equal(personKey("Herr Meier"), null);
  assert.equal(personKey("Statthalter Billeter"), null);
  assert.equal(personKey(""), null);
});

test("Personen: Partikeln bleiben Teil des Namens", () => {
  assert.equal(personKey("Walse, Niklaus von"), personKey("Niklaus von Walse"));
  assert.notEqual(personKey("Niklaus von Walse"), personKey("Niklaus Walse"));
});

test("Orte: Kantonskürzel und Verwaltungswörter", () => {
  assert.equal(placeKey("Diessenhofen TG"), placeKey("Diessenhofen"));
  assert.equal(placeKey("Gemeinde Wädenswil"), placeKey("Wädenswil"));
  assert.equal(placeKey("Kanton Zug"), placeKey("Zug"));
  assert.equal(placeKey("St. Gallen"), "st galen");
  assert.equal(placeKey("12"), null);
});

test("Organisationen: & und Cie", () => {
  assert.equal(orgKey("Burger & Kehl & Cie"), orgKey("Burger und Kehl und Co."));
  assert.equal(orgKey("AG"), null);
  assert.equal(entityKey("org", "Escher Wyss AG"), "escher wis ag");
});

test("Fassung 2: doppelte Konsonanten fallen zusammen, doppelte Vokale nicht", () => {
  assert.equal(orgKeyV2("Staat"), "staat");
  assert.equal(orgKeyV2("Stadt"), "stat");
  assert.equal(orgKey("Staat"), orgKey("Stadt"), "Fassung 1 bleibt, wie sie ist");
  assert.notEqual(placeKeyV2("Zürich II"), placeKeyV2("Zürich I"));
  assert.notEqual(placeKeyV2("Zürich III"), placeKeyV2("Zürich II"));
  assert.notEqual(personKeyV2("Hans Heer"), personKeyV2("Hans Her"));
  assert.equal(placeKeyV2("Fischenthal"), placeKeyV2("Fischental"));
  assert.equal(placeKeyV2("Weißlingen"), placeKeyV2("Weisslingen"));
  assert.equal(placeKeyV2("Rueti"), placeKeyV2("Rüti"));
  assert.equal(placeKeyV2("Talwil"), placeKeyV2("Thalwil"));
  assert.equal(orgKeyV2("Regierungsrath"), orgKeyV2("Regierungsrat"));
  assert.equal(personKeyV2("Frey, Hans"), personKeyV2("Hans Frei"));
  assert.equal(personKeyV2("Meier, Carl"), personKeyV2("Karl Meyer"));
});

test("Fassung 2: Kanton, Bezirk und Amt bleiben Teil des Ortsnamens, nur ZH fällt weg", () => {
  assert.equal(placeKeyV2("Stadt Zürich"), placeKeyV2("Zürich"));
  assert.equal(placeKeyV2("Gemeinde Wädenswil"), placeKeyV2("Wädenswil"));
  assert.notEqual(placeKeyV2("Kanton Zürich"), placeKeyV2("Zürich"));
  assert.equal(placeKeyV2("Kantons Zürich"), placeKeyV2("Kanton Zürich"));
  assert.equal(placeKeyV2("Kt. Zürich"), placeKeyV2("Kanton Zürich"));
  assert.equal(placeKeyV2("Bezirks Horgen"), placeKeyV2("Bezirk Horgen"));
  assert.notEqual(placeKeyV2("Bezirk Horgen"), placeKeyV2("Horgen"));
  assert.notEqual(placeKeyV2("Amt Grüningen"), placeKeyV2("Grüningen"));
  assert.equal(placeKeyV2("Uster ZH"), placeKeyV2("Uster"));
  assert.notEqual(placeKeyV2("Pfäffikon SZ"), placeKeyV2("Pfäffikon"));
  assert.equal(placeKeyV2("Sankt Gallen"), placeKeyV2("St. Gallen"));
  assert.equal(placeKeyV2("St. Gallen"), "st galen");
});

test("Fassung 2: «-weil» wie «-wil»", () => {
  assert.equal(placeKeyV2("Wädensweil"), placeKeyV2("Wädenswil"));
  assert.equal(placeKeyV2("Wädenswyl"), placeKeyV2("Wädenswil"));
  assert.equal(placeKeyV2("Thalweil"), placeKeyV2("Thalwil"));
  assert.equal(placeKeyV2("Weil"), "weil");
  assert.equal(orgKeyV2("Gemeinderath Wädensweil"), orgKeyV2("Gemeinderat Wädenswil"));
  assert.notEqual(personKeyV2("Hans Weil"), personKeyV2("Hans Wil"));
});

test("Fassung 2: übrige Regeln wie Fassung 1", () => {
  assert.equal(personKeyV2("Meier"), null);
  assert.equal(personKeyV2("Herr Statthalter Hans Billeter"), personKeyV2("Billeter, Hans"));
  assert.equal(personKeyV2("Walse, Niklaus von"), personKeyV2("Niklaus von Walse"));
  assert.equal(orgKeyV2("Burger & Kehl & Cie"), orgKeyV2("Burger und Kehl und Co."));
  assert.equal(orgKeyV2("AG"), null);
  assert.equal(entityKeyV2("org", "Escher Wyss AG"), "escher wis ag");
  assert.equal(entityKeyV2("place", "12"), null);
  assert.equal(entityKeyV2("person", "Hans Jacob Mueller"), personKeyV2("Müller, Hans Jakob"));
});
