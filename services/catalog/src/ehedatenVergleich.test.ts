import { test } from "node:test";
import assert from "node:assert/strict";
import { EDB_COLUMNS, type EdbRow } from "./edb.ts";
import { ehedatenDoc } from "./ehedaten.ts";
import { countFacets, diffDocs, emptyFacets } from "./ehedatenVergleich.ts";

// Erfundene Namen in den Mustern der Ehedatenbank.

test("Felder: inhaltlich, nur Anführungszeichen, neu, entfallen", () => {
  const diffs = diffDocs(
    { id: 1, mannZusatz: "Muoster", frauZusatz: "Jf.", mannGnd: "", titel: "Muster, Hans, getraut mit Beispiel, Anna", raum: ["zh"] },
    { id: 1, mannZusatz: '"Muoster"', frauZusatz: "", mannGnd: "https://d-nb.info/gnd/1", titel: "Muster, Hans, getraut mit Beispiel, Anna", raum: ["zh", "ch"] },
  );
  assert.deepEqual(
    diffs.map((d) => [d.field, d.kind]),
    [
      ["mannZusatz", "anfuehrungszeichen"],
      ["frauZusatz", "entfallen"],
      ["mannGnd", "neu"],
      ["raum", "inhaltlich"],
    ],
  );
  assert.equal(diffs[3].next, '["zh","ch"]');
  assert.deepEqual(diffDocs({ id: 2, art: "trauung" }, { id: 2, art: "trauung" }), []);
  // Gefaltete Suchfelder folgen aus dem Original und zählen nicht als Abweichung.
  assert.deepEqual(diffDocs({ id: 3, mannZusatz: "Wyß" }, { id: 3, mannZusatz: "Wyß", mannZusatzSearch: "Wyss" }), []);
});

test("Facetten: Kirchgemeinde, Raum, Herkunft, Jahrzehnt", () => {
  const row = Object.fromEntries(EDB_COLUMNS.map((c) => [c, ""])) as EdbRow;
  const d = ehedatenDoc({
    ...row,
    ID: "7",
    Signatur: "E III 30.1, EDB 1",
    Nachname_Mann: "Muster",
    Vorname_Mann: "Hans",
    Herkunft_Mann: "Uster",
    Nachname_Frau: "Beispiel",
    Vorname_Frau: "Anna",
    Herkunft_Frau: "Nussbaumen TG",
    Datum: "1689.03.03",
    Datum_Von: "1689-03-03",
    Datum_Bis: "1689-03-03",
    Kirchgemeinde: "Uster",
  });
  assert.ok(d);
  const c = emptyFacets();
  countFacets(c, d);
  countFacets(c, d);
  assert.equal(c.kirchgemeinde.get("Uster"), 2);
  assert.deepEqual([...c.raum.entries()], [["zh", 2], ["ch", 2]]);
  assert.equal(c.herkunft.get("Nussbaumen TG"), 2);
  assert.equal(c.jahrzehnt.get("1680er"), 2);
  assert.equal(c.band.get("E III 30.1"), 2);
});
