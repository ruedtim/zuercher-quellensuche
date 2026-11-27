import { test } from "node:test";
import assert from "node:assert/strict";
import { foldedField as webFoldedField, foldSharpS as webFoldSharpS } from "../../../apps/web/src/lib/sharpS.ts";
import { EHEDATEN_INDEX_SETTINGS } from "./ehedatenSettings.ts";
import {
  CATALOG_FOLDED_FIELDS,
  CATALOG_FORMATTED_FIELDS,
  EHEDATEN_FOLDED_FIELDS,
  EHEDATEN_FORMATTED_FIELDS,
  foldedField,
  foldedFields,
  foldLine,
  foldSharpS,
  withFolded,
} from "./searchText.ts";
import { CATALOG_INDEX_SETTINGS } from "./settings.ts";

test("foldedFields: nur Felder mit ß, ganzes Feld mit ss", () => {
  assert.deepEqual(
    foldedFields({ title: "Straßen.", signature: "A 1", text: "Kauf der Mühle", provenienz: "Schloßverwaltung" }, CATALOG_FOLDED_FIELDS),
    { titleSearch: "Strassen.", provenienzSearch: "Schlossverwaltung" },
  );
  assert.deepEqual(foldedFields({ title: "Strassen.", signature: "", text: undefined, provenienz: undefined }, CATALOG_FOLDED_FIELDS), {});
  assert.deepEqual(foldedFields({ title: "GROẞE HALDE, daß", text: "" }, ["title", "text"]), { titleSearch: "GROSSE HALDE, dass" });
});

test("Faltung und Feldname wie in der Web-App (Anfrage und Suchfeld müssen gleich falten)", () => {
  for (const s of ["Straße", "GROẞE", "10 ß", "uß dem Thurgöuw", "Schloss", "", "Müßa", "ßß"]) assert.equal(foldSharpS(s), webFoldSharpS(s), s);
  for (const f of [...CATALOG_FOLDED_FIELDS, ...EHEDATEN_FOLDED_FIELDS]) assert.equal(foldedField(f), webFoldedField(f));
});

test("foldLine: ältere Index-Dateien bekommen die Suchfelder beim Import", () => {
  const unit = { id: 1, title: "Straßen.", text: "daß", onPlatform: false, _vectors: { jina_de: [0.25, -0.125] }, embedded: true };
  const line = JSON.stringify(unit);
  const folded = foldLine(line, CATALOG_FOLDED_FIELDS);
  assert.deepEqual(JSON.parse(folded), { ...unit, titleSearch: "Strassen.", textSearch: "dass" });
  // Schon da (Aufbau): dieselbe Zeile.
  assert.equal(foldLine(folded, CATALOG_FOLDED_FIELDS), folded);
  // Ohne ß, ß nur in anderen Feldern, Plattform-Dokument, Stufe nur aus Pfaden, Index ohne Faltung.
  for (const other of [
    { id: 2, title: "Strassen.", onPlatform: false },
    { id: 3, title: "Akten", path: [{ id: 1, label: "Straßenbau" }], onPlatform: false },
    { id: 4, title: "Straßen.", onPlatform: true },
    { id: 5, title: "Straßenbau", stub: true },
  ]) {
    const same = JSON.stringify(other);
    assert.equal(foldLine(same, CATALOG_FOLDED_FIELDS), same);
  }
  assert.equal(foldLine(line, []), line);
  // ß maskiert, wie JSON es auch schreiben darf.
  const escaped = JSON.stringify({ id: 7, title: "Straßen.", onPlatform: false }).replace("ß", "\\u00df");
  assert.ok(!escaped.includes("ß"));
  assert.equal(JSON.parse(foldLine(escaped, CATALOG_FOLDED_FIELDS)).titleSearch, "Strassen.");
  // Eheeinträge haben kein `onPlatform`.
  assert.equal(JSON.parse(foldLine(JSON.stringify({ id: 6, mannZusatz: "Joß" }), EHEDATEN_FOLDED_FIELDS)).mannZusatzSearch, "Joss");
});

test("withFolded: gefaltetes Suchfeld direkt hinter dem Original", () => {
  assert.deepEqual(withFolded(["a", "b", "c"], ["a", "c"]), ["a", "aSearch", "b", "c", "cSearch"]);
});

/** Rang jedes Originals unter den Suchfeldern: Alle müssen sich verdoppeln, damit die Rangfolge von
 *  Treffern ohne ß (Summen der Ränge, Ranking-Regel `attribute`) dieselbe bleibt. */
function ranksDouble(searchable: readonly string[]) {
  const originals = searchable.filter((f) => !f.endsWith("Search"));
  originals.forEach((f, i) => assert.equal(searchable.indexOf(f), 2 * i, f));
}

test("Settings catalog: durchsucht, formatiert, Signatur ohne Tippfehler", () => {
  const s = CATALOG_INDEX_SETTINGS;
  const searchable = s.searchableAttributes ?? [];
  ranksDouble(searchable);
  for (const f of CATALOG_FOLDED_FIELDS) assert.equal(searchable[searchable.indexOf(f) + 1], foldedField(f), f);
  for (const f of CATALOG_FORMATTED_FIELDS) assert.ok(s.displayedAttributes?.includes(foldedField(f)), f);
  for (const f of ["signature", "provenienz"] as const) assert.ok(!s.displayedAttributes?.includes(foldedField(f)), f);
  assert.deepEqual(s.typoTolerance?.disableOnAttributes, ["signature", "signatureSearch"]);
});

test("Settings ehedaten: durchsucht und formatiert", () => {
  const s = EHEDATEN_INDEX_SETTINGS;
  const searchable = s.searchableAttributes ?? [];
  ranksDouble(searchable);
  for (const f of EHEDATEN_FOLDED_FIELDS) assert.equal(searchable[searchable.indexOf(f) + 1], foldedField(f), f);
  for (const f of EHEDATEN_FORMATTED_FIELDS) assert.ok(s.displayedAttributes?.includes(foldedField(f)), f);
  assert.ok(!s.displayedAttributes?.includes("kirchgemeindeSearch"));
  assert.equal(searchable.at(-1), "signatur");
});
