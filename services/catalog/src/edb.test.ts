import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDiff, compareEdb, edbRows, EDB_COLUMNS, edbTitle, fromCrawl, fromZenodo, isEdbUnit, parseCsv, type EdbRow } from "./edb.ts";
import type { CatalogRecord } from "./types.ts";

// Erfundene Namen in den Mustern der Ehedatenbank.

test("parseCsv: BOM, Anführungszeichen, Komma und Umbruch im Feld, CRLF, leere Felder", () => {
  const text = '﻿a,b,c\r\n"x, y","sagt ""hallo""","Zeile 1\nZeile 2"\r\n,,\n1,2,';
  assert.deepEqual(parseCsv(text), [
    ["a", "b", "c"],
    ["x, y", 'sagt "hallo"', "Zeile 1\nZeile 2"],
    ["", "", ""],
    ["1", "2", ""],
  ]);
});

function row(over: Partial<EdbRow>): EdbRow {
  const base = Object.fromEntries(EDB_COLUMNS.map((c) => [c, ""])) as EdbRow;
  return {
    ...base,
    Signatur: "TAI 9.1; StadtA Musterhausen B 1, EDB 7",
    Nachname_Mann: "Muster",
    Vorname_Mann: "Hans Heinrich",
    Nachname_Frau: "Beispiel",
    Vorname_Frau: "Elisabeth",
    Zusatzinfo_Mann: "-",
    Zusatzinfo_Frau: "Byspiel",
    Datum: "1553.08.28",
    Kirchgemeinde: "Musterhausen",
    Band: "S. 12",
    ID: "1944835",
    ...over,
  };
}

test("edbRows: Spalten über den Kopf, fehlende Spalte bricht ab", () => {
  const head = EDB_COLUMNS.join(",");
  const line = EDB_COLUMNS.map((c) => (c === "ID" ? "5" : c === "Nachname_Mann" ? "Muster" : "")).join(",");
  const rows = edbRows(`${head}\n${line}\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ID, "5");
  assert.equal(rows[0].Nachname_Mann, "Muster");
  assert.throws(() => edbRows("Signatur,ID\nx,1\n"), /Spalte «Nachname_Mann» fehlt/);
});

test("Titel wie im Katalog, Herkunft nur wenn vorhanden", () => {
  assert.equal(edbTitle(row({})), "Muster, Hans Heinrich, getraut mit Beispiel, Elisabeth");
  assert.equal(
    edbTitle(row({ Herkunft_Mann: "Moos TG", Herkunft_Frau: "Ristenbühl TG" })),
    "Muster, Hans Heinrich, Moos TG, getraut mit Beispiel, Elisabeth, Ristenbühl TG",
  );
});

test("Zenodo-Datum in der Schreibweise des Entstehungszeitraums", () => {
  assert.equal(fromZenodo(row({})).datum, "28.08.1553");
  assert.equal(fromZenodo(row({ Datum: "1553.9" })).datum, "09.1553");
  assert.equal(fromZenodo(row({ Datum: "1553" })).datum, "1553");
  assert.equal(fromZenodo(row({ Datum: "1553.07.23 (ca.)-1553.07.30 (ca.)" })).datum, "ca. 23.07.1553 - ca. 30.07.1553");
});

function crawl(fields: Array<[string, string, string[]?]>, over: Partial<CatalogRecord> = {}): CatalogRecord {
  return {
    id: 1944835,
    url: "https://example.org/detail.aspx?ID=1944835",
    signature: "TAI 9.1; StadtA Musterhausen B 1, EDB 7",
    title: "Muster, Hans Heinrich, getraut mit Beispiel, Elisabeth",
    level: "Dokument",
    date_text: "28.08.1553",
    parent_id: 1,
    path: [],
    sections: [
      {
        section: "Identifikation und Inhalt",
        key: "identifikation_und_inhalt",
        fields: fields.map(([key, text, links = []]) => ({ label: key, key, text, lines: text.split("\n"), links: links.map((href) => ({ href, text: href })) })),
      },
    ],
    fields: {},
    ...over,
  };
}

test("Crawl und Zenodo gleich: keine Abweichung", () => {
  const c = crawl([
    ["inhalt_und_form", "Zusatzinformation:\n-\nByspiel"],
    ["provenienz", "Kirchgemeinde Musterhausen"],
    ["anmerkungen", "S. 12"],
  ]);
  assert.deepEqual(compareEdb(fromCrawl(c), fromZenodo(row({}))), []);
});

test("Abweichungen je Feld; GND und HLS als IDs verglichen", () => {
  const c = crawl(
    [
      ["inhalt_und_form", "Zusatzinformation:\nHerr\n-"],
      ["provenienz", "Kirchgemeinde Musterhausen"],
      ["gnd_links", "Hans Heinrich Muster", ["https://d-nb.info/gnd/100000001"]],
      ["weblinks", "Artikel im HLS", ["https://hls-dhs-dss.ch/fr/articles/012345/"]],
    ],
    { title: "Muster, Hans Heinrich, getraut mit Beispil, Elisabeth" },
  );
  const z = row({
    Zusatzinfo_Mann: "Herr",
    Zusatzinfo_Frau: "-",
    GND_Mann: "http://d-nb.info/gnd/100000001",
    HLS_Artikel_Mann: "https://hls-dhs-dss.ch/de/articles/012345/",
  });
  assert.deepEqual(compareEdb(fromCrawl(c), fromZenodo(z)), [
    { field: "titel", crawl: "Muster, Hans Heinrich, getraut mit Beispil, Elisabeth", zenodo: "Muster, Hans Heinrich, getraut mit Beispiel, Elisabeth" },
    { field: "band", crawl: "", zenodo: "S. 12" },
  ]);
});

test("Art der Abweichung: Excel-Fehler und Anführungszeichen in Zenodo, sonst inhaltlich", () => {
  const z = row({ Datum: "1696.1" });
  const c = fromZenodo(row({ Zusatzinfo_Frau: "" }));
  assert.equal(classifyDiff({ field: "zusatzFrau", crawl: "-X", zenodo: "#NAME?" }, z, c), "excel");
  assert.equal(classifyDiff({ field: "datum", crawl: "10.1696", zenodo: "01.1696" }, z, c), "excel");
  assert.equal(classifyDiff({ field: "datum", crawl: "07.05.1587", zenodo: "06.05.1587" }, row({}), c), "inhaltlich");
  assert.equal(classifyDiff({ field: "zusatzMann", crawl: '"Josue"; Metzger', zenodo: "Josue; Metzger" }, z, c), "anfuehrungszeichen");
  assert.equal(classifyDiff({ field: "titel", crawl: "Huber, Hans, Urdorf", zenodo: "Huber, Hans, Niederurdorf" }, z, c), "inhaltlich");
  // unpaariges Anführungszeichen im Katalog: Zenodo verschmilzt Mann und Frau
  const odd = { ...c, zusatzMann: '"Findi Preiter', zusatzFrau: "" };
  assert.equal(classifyDiff({ field: "zusatzMann", crawl: '"Findi Preiter', zenodo: "Findi Preiter -" }, z, odd), "excel");
});

test("Katalog-Datum «zwischen … und …» gleich wie die Zenodo-Spanne", () => {
  const c = crawl([], { date_text: "zwischen ca. 06.06.1613 und ca. 31.10.1613" });
  assert.equal(fromCrawl(c).datum, fromZenodo(row({ Datum: "1613.06.06 (ca.)-1613.10.31 (ca.)" })).datum);
});

test("Eheeintrag erkennen: Dokument mit «, EDB n», nicht der Teilband", () => {
  assert.equal(isEdbUnit(crawl([])), true);
  assert.equal(isEdbUnit(crawl([], { level: "Subdossier", signature: "TAI 9.1, EDB 1 - TAI 9.1, EDB 500" })), false);
  assert.equal(isEdbUnit(crawl([], { signature: "Z 1.2" })), false);
});
