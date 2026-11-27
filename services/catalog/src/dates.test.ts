import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCatalogDate, parseCatalogDays } from "./dates.ts";

test("Einzeldaten in allen Genauigkeiten", () => {
  assert.deepEqual(parseCatalogDate("02.07.1946"), { from: 1946, to: 1946 });
  assert.deepEqual(parseCatalogDate("06.1972"), { from: 1972, to: 1972 });
  assert.deepEqual(parseCatalogDate("2004"), { from: 2004, to: 2004 });
  assert.deepEqual(parseCatalogDate("ca. 07.03.1493"), { from: 1493, to: 1493 });
  assert.deepEqual(parseCatalogDate("ca. 0853 - 03.1863"), { from: 853, to: 1863 });
});

test("Spannen, auch gemischt und mit ca.", () => {
  assert.deepEqual(parseCatalogDate("1963 - 2022"), { from: 1963, to: 2022 });
  assert.deepEqual(parseCatalogDate("08.1831 - 01.1857"), { from: 1831, to: 1857 });
  assert.deepEqual(parseCatalogDate("ca. 1921 - ca. 1942"), { from: 1921, to: 1942 });
  assert.deepEqual(parseCatalogDate("12.09.1272 - 1812"), { from: 1272, to: 1812 });
  assert.deepEqual(parseCatalogDate("1875 - 18.12.2002"), { from: 1875, to: 2002 });
  // Vertauschte Reihenfolge kommt vor; die Spanne bleibt korrekt.
  assert.deepEqual(parseCatalogDate("02.12.1901 - 30.10.1899"), { from: 1899, to: 1901 });
});

test("Jahrhunderte", () => {
  assert.deepEqual(parseCatalogDate("19. Jh."), { from: 1801, to: 1900 });
  assert.deepEqual(parseCatalogDate("ca. 18. Jh."), { from: 1701, to: 1800 });
  assert.deepEqual(parseCatalogDate("ca. 9. Jh."), { from: 801, to: 900 });
  assert.deepEqual(parseCatalogDate("17. Jh. - 18. Jh."), { from: 1601, to: 1800 });
  assert.deepEqual(parseCatalogDate("1290 - 19. Jh."), { from: 1290, to: 1900 });
});

test("zwischen … und …, bis/vor/nach/ab", () => {
  assert.deepEqual(parseCatalogDate("zwischen ca. 1700 und ca. 1725"), { from: 1700, to: 1725 });
  assert.deepEqual(parseCatalogDate("zwischen 21.05.1526 und 26.12.1529"), { from: 1526, to: 1529 });
  assert.deepEqual(parseCatalogDate("bis 1971"), { from: 1971, to: 1971 });
  assert.deepEqual(parseCatalogDate("vor ca. 1961"), { from: 1961, to: 1961 });
  assert.deepEqual(parseCatalogDate("nach 1798"), { from: 1798, to: 1798 });
  assert.deepEqual(parseCatalogDate("ab 1913"), { from: 1913, to: 1913 });
});

test("unlesbar oder leer ⇒ null", () => {
  assert.equal(parseCatalogDate("s. d. (sine dato)"), null);
  assert.equal(parseCatalogDate(""), null);
  assert.equal(parseCatalogDate(null), null);
  assert.equal(parseCatalogDate("Frühling 1641"), null);
});

test("Tage: Tag, Monat, Jahr und Spannen, mit ca.", () => {
  assert.deepEqual(parseCatalogDays("23.07.1553"), { from: "1553-07-23", to: "1553-07-23" });
  assert.deepEqual(parseCatalogDays("07.1577"), { from: "1577-07-01", to: "1577-07-31" });
  assert.deepEqual(parseCatalogDays("1632"), { from: "1632-01-01", to: "1632-12-31" });
  assert.deepEqual(parseCatalogDays("ca. 15.07.1693"), { from: "1693-07-15", to: "1693-07-15" });
  assert.deepEqual(parseCatalogDays("ca. 23.07.1553 - ca. 13.08.1553"), { from: "1553-07-23", to: "1553-08-13" });
  assert.deepEqual(parseCatalogDays("ca. 29.09.1646 - ca. 11.1646"), { from: "1646-09-29", to: "1646-11-30" });
  assert.deepEqual(parseCatalogDays("02.1773 - 11.1773"), { from: "1773-02-01", to: "1773-11-30" });
  assert.deepEqual(parseCatalogDays("ca. 1526 - ca. 1532"), { from: "1526-01-01", to: "1532-12-31" });
});

test("Tage: «zwischen» schliesst die Grenzen aus (wie die ISO-Spalten der Ehedatenbank)", () => {
  assert.deepEqual(parseCatalogDays("zwischen ca. 10.03.1683 und ca. 07.09.1683"), { from: "1683-03-11", to: "1683-09-06" });
  assert.deepEqual(parseCatalogDays("zwischen ca. 06.06.1613 und ca. 31.10.1613"), { from: "1613-06-07", to: "1613-10-30" });
  // Aufeinanderfolgende Tage: nichts dazwischen, die Grenzen gelten.
  assert.deepEqual(parseCatalogDays("zwischen 01.11.1544 und 02.11.1544"), { from: "1544-11-01", to: "1544-11-02" });
});

test("Tage: Kalender wie im Kirchenbuch", () => {
  // Gregorianische Monatslängen wie Zenodo (Februar 1700: 28 Tage) …
  assert.deepEqual(parseCatalogDays("02.1700"), { from: "1700-02-01", to: "1700-02-28" });
  assert.deepEqual(parseCatalogDays("02.1696"), { from: "1696-02-01", to: "1696-02-29" });
  // … aber julianische Tage bleiben: 29.02.1700, 7.10.1582 (fehlen gregorianisch).
  assert.deepEqual(parseCatalogDays("29.02.1700"), { from: "1700-02-29", to: "1700-02-29" });
  assert.deepEqual(parseCatalogDays("07.10.1582"), { from: "1582-10-07", to: "1582-10-07" });
  assert.equal(parseCatalogDays("30.02.1700"), null);
  assert.equal(parseCatalogDays("31.04.1650"), null);
  assert.equal(parseCatalogDays("13.1650"), null);
});

test("Tage: Jahrhunderte, offene Grenzen und Unlesbares ⇒ null", () => {
  assert.equal(parseCatalogDays("18. Jh."), null);
  assert.equal(parseCatalogDays("bis 1700"), null);
  assert.equal(parseCatalogDays("s. d. (sine dato)"), null);
  assert.equal(parseCatalogDays("1700 - 1701 - 1702"), null);
  assert.equal(parseCatalogDays("02.12.1701 - 30.10.1699"), null);
  assert.equal(parseCatalogDays(""), null);
  assert.equal(parseCatalogDays(null), null);
});
