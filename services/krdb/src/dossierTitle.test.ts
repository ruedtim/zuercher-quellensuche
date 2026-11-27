// Lauf: npx tsx --test src/dossierTitle.test.ts
// Titel von Personendossiers (Bestand Z 1114 und Archivkatalog).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDossierName, parseDossierTerms } from "./dossierTitle.ts";

test("parseDossierName: Name und Lebensjahre aus dem Dossiertitel", () => {
  assert.deepEqual(parseDossierName("Abplanalp, Peter (1936-2005), Malermeister \\ SVP, Kantonsrat 1990-1999"), {
    last: "Abplanalp",
    first: "Peter",
    born: 1936,
    died: 2005,
  });
  assert.deepEqual(parseDossierName("Bürgi-Hammer, Urs, Dr. med. (1909-1989), Arzt"), {
    last: "Bürgi-Hammer",
    first: "Urs",
    born: 1909,
    died: 1989,
  });
  assert.equal(parseDossierName("Achermann, Christian (geb. 1945), Gemüseproduzent")?.born, 1945);
  assert.deepEqual(parseDossierName("Förtsch, Peter, Unternehmensberater \\ Grüne Partei GP, Kantonsrat ab 1996"), {
    last: "Förtsch",
    first: "Peter",
    born: undefined,
    died: undefined,
  });
  assert.deepEqual(parseDossierName("Zweifel Paul (geb. 1936), Obstfachtechnologe"), {
    last: "Zweifel",
    first: "Paul",
    born: 1936,
    died: undefined,
  });
  assert.equal(parseDossierName("Gruppenfoto"), null);
});

test("parseDossierTerms: Amtszeiten aus dem Dossiertitel", () => {
  assert.deepEqual(parseDossierTerms("Egli, Hans (geb. 1912) \\ SP, Kantonsrat 1973-1979"), [
    { council: "Kantonsrat", from: 1973, to: 1979 },
  ]);
  assert.deepEqual(parseDossierTerms("Förtsch, Peter \\ Grüne Partei GP, Kantonsrat ab 1996"), [
    { council: "Kantonsrat", from: 1996, to: null },
  ]);
  assert.deepEqual(parseDossierTerms("Diener, Verena \\ Grüne, Kantonsrätin 1987-1995, Regierungsrätin 1995-2007"), [
    { council: "Kantonsrat", from: 1987, to: 1995 },
    { council: "Regierungsrat", from: 1995, to: 2007 },
  ]);
});
