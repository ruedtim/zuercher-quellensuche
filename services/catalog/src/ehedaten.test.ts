import { test } from "node:test";
import assert from "node:assert/strict";
import { EDB_COLUMNS, type EdbRow } from "./edb.ts";
import { ehedatenArt, ehedatenDate, ehedatenDoc, ehedatenQuelle } from "./ehedaten.ts";

// Erfundene Namen in den Mustern der Ehedatenbank.

function row(over: Partial<EdbRow> = {}): EdbRow {
  const base = Object.fromEntries(EDB_COLUMNS.map((c) => [c, ""])) as EdbRow;
  return {
    ...base,
    Signatur: "E III 30.1, EDB 276",
    Nachname_Mann: "Muster",
    Vorname_Mann: "Hans Jakob",
    Herkunft_Mann: "Ottikon (Illnau-Effretikon)",
    Nachname_Frau: "Beispiel",
    Vorname_Frau: "Elisabeth",
    Herkunft_Frau: "Nussbaumen TG",
    Zusatzinfo_Mann: "verkündet 22. Febr.; getraut zu Wädenswil",
    Zusatzinfo_Frau: "-",
    Datum: "1689.03.03",
    Datum_Von: "1689-03-03",
    Datum_Bis: "1689-03-03",
    Kirchgemeinde: "Wädenswil",
    Band: "S. 12",
    ID: "1944835",
    ...over,
  };
}

test("Datum: Werte aus den ISO-Spalten, Genauigkeit und «ca.» aus der Anzeige", () => {
  assert.equal(ehedatenDate("1553.07.23", "1553-07-23", "1553-07-23")?.text, "23.07.1553");
  assert.equal(ehedatenDate("1636.09", "1636-09-01", "1636-09-30")?.text, "09.1636");
  assert.equal(ehedatenDate("1632", "1632-01-01", "1632-12-31")?.text, "1632");
  assert.equal(ehedatenDate("1567 (ca.)", "1567-01-01", "1567-12-31")?.text, "ca. 1567");
  assert.equal(
    ehedatenDate("1553.07.23 (ca.)-1553.07.30 (ca.)", "1553-07-23", "1553-07-30")?.text,
    "ca. 23.07.1553 – ca. 30.07.1553",
  );
  assert.equal(ehedatenDate("1657.01.23 (ca.)-1657.07 (ca.)", "1657-01-23", "1657-07-31")?.text, "ca. 23.01.1657 – ca. 07.1657");
  assert.equal(ehedatenDate("1526 (ca.)-1532 (ca.)", "1526-01-01", "1532-12-31")?.text, "ca. 1526 – ca. 1532");
});

test("Datum: Excel-Schaden «1696.1» = Oktober, aus den ISO-Spalten", () => {
  const d = ehedatenDate("1696.1", "1696-10-01", "1696-10-31");
  assert.equal(d?.text, "10.1696");
  assert.equal(d?.sortDate, 16961001);
  assert.equal(d?.dateFrom, 1696);
  assert.equal(d?.dateTo, 1696);
});

test("Datum: ohne lesbare Anzeige nur aus den ISO-Grenzen; ohne ISO kein Datum", () => {
  assert.equal(ehedatenDate("", "1700-01-01", "1700-12-31")?.text, "1700");
  assert.equal(ehedatenDate("?", "1700-02-01", "1700-02-28")?.text, "02.1700");
  assert.equal(ehedatenDate("", "1700-02-03", "1700-02-09")?.text, "03.02.1700 – 09.02.1700");
  assert.equal(ehedatenDate("1700", "", ""), null);
  assert.equal(ehedatenDate("1700", "1700-12-31", "1700-01-01"), null);
  const span = ehedatenDate("1687.12 (ca.)-1688.01.10 (ca.)", "1687-12-01", "1688-01-10");
  assert.equal(span?.dateFrom, 1687);
  assert.equal(span?.dateTo, 1688);
});

test("Art: «Verkünddatum» = Verkündung, sonst Trauung", () => {
  assert.equal(ehedatenArt("Verkünddatum; getraut zu Zürich", "-"), "verkuendung");
  assert.equal(ehedatenArt("-", "Witwe; Verkünddatum"), "verkuendung");
  assert.equal(ehedatenArt("verkündet 30. Juni; getraut zu Zürich", ""), "trauung");
});

test("Überlieferung aus der Signatur", () => {
  assert.equal(ehedatenQuelle("E III 30.1, EDB 276"), "E III");
  assert.equal(ehedatenQuelle("TAI 1.725; StadtA Winterthur B 3 m/1, EDB 1"), "TAI");
});

test("Dokument: Band, Eintrag, Herkunft, Schlüssel und Namenswörter", () => {
  const d = ehedatenDoc(row());
  assert.ok(d);
  assert.equal(d.id, 1944835);
  assert.equal(d.band, "E III 30.1");
  assert.equal(d.eintrag, 276);
  assert.equal(d.quelle, "E III");
  assert.equal(d.seite, "S. 12");
  assert.equal(d.art, "trauung");
  assert.equal(d.datum, "03.03.1689");
  assert.equal(d.titel, "Muster, Hans Jakob, Ottikon (Illnau-Effretikon), getraut mit Beispiel, Elisabeth, Nussbaumen TG");
  assert.equal(d.mannName, "Hans Jakob Muster");
  assert.equal(d.mannOrt, "Illnau-Effretikon");
  assert.equal(d.frauOrt, "Nussbaumen TG");
  assert.deepEqual(d.herkunft, ["Illnau-Effretikon", "Nussbaumen TG"]);
  assert.deepEqual(d.raum, ["zh", "ch"]);
  assert.deepEqual(d.herkunftKeys, ["ilnau efretikon", "otikon", "nusbaumen", "turgau"]);
  assert.deepEqual(d.persons, ["Hans Jakob Muster", "Elisabeth Beispiel"]);
  assert.deepEqual(d.personKeys, ["hans jakob muster", "elisabet beispiel"]);
  assert.deepEqual(d.mannTok, ["hans", "jakob", "muster"]);
  assert.equal(d.frauZusatz, "");
  assert.equal(d.unsicher, false);
});

test("Dokument: «N.» ohne Personenschlüssel, «?» unsicher, Excel-Fehler leer, GND als https", () => {
  const d = ehedatenDoc(
    row({
      Nachname_Frau: "N.",
      Nachname_Mann: "Knus ?",
      Zusatzinfo_Frau: "#NAME?",
      Herkunft_Frau: "",
      GND_Mann: "http://d-nb.info/gnd/1072490153",
    }),
  );
  assert.ok(d);
  assert.equal(d.frauKey, null);
  assert.deepEqual(d.personKeys, ["hans jakob knus"]);
  assert.equal(d.unsicher, true);
  assert.equal(d.frauZusatz, "");
  assert.equal(d.frauOrt, "");
  assert.deepEqual(d.raum, ["zh"]);
  assert.equal(d.mannGnd, "https://d-nb.info/gnd/1072490153");
});

test("Dokument: ohne gültige ID oder Datum keines", () => {
  assert.equal(ehedatenDoc(row({ ID: "" })), null);
  assert.equal(ehedatenDoc(row({ ID: "abc" })), null);
  assert.equal(ehedatenDoc(row({ Datum_Von: "", Datum_Bis: "" })), null);
});

test("Dokument: Angaben mit ß bekommen gefaltete Suchfelder, angezeigt bleibt das Original", () => {
  const d = ehedatenDoc(row({ Zusatzinfo_Mann: '"uß dem Thurgöuw"', Herkunft_Frau: "Großenhain (Deutschland)", Nachname_Frau: "Groß" }));
  assert.ok(d);
  assert.equal(d.mannZusatz, '"uß dem Thurgöuw"');
  assert.equal(d.mannZusatzSearch, '"uss dem Thurgöuw"');
  assert.equal(d.frauHerkunftSearch, "Grossenhain (Deutschland)");
  assert.equal(d.frauNameSearch, "Elisabeth Gross");
  assert.equal(d.titel, "Muster, Hans Jakob, Ottikon (Illnau-Effretikon), getraut mit Groß, Elisabeth, Großenhain (Deutschland)");
  assert.deepEqual(d.herkunft, ["Illnau-Effretikon", "Großenhain (Deutschland)"], "Facette im Original");
  for (const f of ["mannNameSearch", "mannHerkunftSearch", "frauZusatzSearch", "kirchgemeindeSearch"]) assert.ok(!(f in d), f);
  // Namenswörter, Personen- und Ortsschlüssel falten ß ohnehin: Filter finden beide Schreibungen.
  const ss = ehedatenDoc(row({ Herkunft_Frau: "Grossenhain (Deutschland)", Nachname_Frau: "Gross" }));
  assert.deepEqual([d.frauTok, d.frauKey, d.personKeys, d.herkunftKeys], [ss?.frauTok, ss?.frauKey, ss?.personKeys, ss?.herkunftKeys]);
  assert.ok(!Object.keys(ss ?? {}).some((k) => k.endsWith("Search")), "ohne ß keine Suchfelder");
});
