/**
 * Unit-Tests für die RM-Lesefassung auf der Anfrage-Seite. Lauf:
 *   npx tsx --test src/lib/rmText.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { editionSearchForm, foldRmQueryMarks, rmReadingForm, rmSearchForm } from "./rmText";

// Dieselben Golden-Vektoren wie der Indexer (services/indexer/src/
// rmSearchForm.test.ts) und der Konverter (rmtk/lese.py): die Kopie hier darf
// nicht abweichen, sonst trifft eine Suche aus der Detailseite den Index nicht.
const GOLDEN = new URL("../../../../services/indexer/src/rmSearchForm.golden.json", import.meta.url);

test("rmSearchForm: Golden-Vektoren des Indexers", () => {
	const { cases } = JSON.parse(readFileSync(GOLDEN, "utf-8")) as { cases: Array<[string, string]> };
	assert.ok(cases.length > 0);
	for (const [input, expected] of cases) assert.equal(rmSearchForm(input), expected, input);
});

test("foldRmQueryMarks: Nasalstrich über m/n wird Doppelbuchstabe", () => {
	assert.equal(foldRmQueryMarks("kom̅en"), "kommen");
	assert.equal(foldRmQueryMarks("Man̄"), "Mann");
	assert.equal(foldRmQueryMarks("ein̄emen"), "einnemen");
	assert.equal(foldRmQueryMarks("KOM̅EN"), "KOMMEN");
});

test("foldRmQueryMarks: Ausnahmen verlieren nur den Strich", () => {
	assert.equal(foldRmQueryMarks("Nam̅en"), "Namen");
	assert.equal(foldRmQueryMarks("Am̅tman"), "Amtman");
	assert.equal(foldRmQueryMarks("Im̅e"), "Ime");
	assert.equal(foldRmQueryMarks("Sam̅stags"), "Samstags");
	assert.equal(foldRmQueryMarks("Mon̄tag"), "Montag");
	assert.equal(foldRmQueryMarks("diejen̄igen"), "diejenigen");
	// Nur das ganze Wort zählt: «Im̅er» ist keine Ausnahme.
	assert.equal(foldRmQueryMarks("Im̅er"), "Immer");
});

test("foldRmQueryMarks: ¬-Trennung wird aufgelöst", () => {
	assert.equal(foldRmQueryMarks("Burger¬ meister"), "Burgermeister");
	assert.equal(foldRmQueryMarks("Burger¬\nmeister"), "Burgermeister");
});

test("foldRmQueryMarks: gewöhnliche Anfragen bleiben unverändert", () => {
	for (const q of ["fisch -das", '"freiwillige Feuerwehr"', "Zürich Straße", "Beschluß", "Kokain OR Koks", ""]) {
		assert.equal(foldRmQueryMarks(q), q);
	}
	// Andere Diakritika und ß bleiben (Meili gleicht Akzente selbst an; die
	// übrigen Serien schreiben ß zeichengetreu).
	assert.equal(foldRmQueryMarks("Zuͦrich daß kom̅en"), "Zuͦrich daß kommen");
});

test("rmReadingForm: Lesefassung für die Phrasensuche aus der Detailseite", () => {
	assert.equal(rmReadingForm("Hanß Heinrich Eßlinger"), "Hanss Heinrich Esslinger");
	assert.equal(rmReadingForm("10 ß."), "10 ß.");
	assert.equal(rmReadingForm("  Johan̄   Escher\n"), "Johann Escher");
	assert.equal(rmReadingForm("Am̅t Grüningen"), "Amt Grüningen");
	assert.equal(rmReadingForm("Schuͦlmeister zuͤ Kilch¬ berg"), "Schulmeister zü Kilchberg");
});

// --- Editionen ---------------------------------------------------------------------


test("editionSearchForm: kombinierende Zeichen wie die Ratsmanuale", () => {
	assert.equal(editionSearchForm("zů"), "zu");
	assert.equal(editionSearchForm("Gruͤningen"), "Grüningen");
	assert.equal(editionSearchForm("gruͦß"), "gruss");
	assert.equal(editionSearchForm("oͧch"), "och");
	assert.equal(editionSearchForm("fu̍rbas"), "furbas");
	assert.equal(editionSearchForm("kom̅en"), "kommen");
});

test("editionSearchForm: ß → ss, Umlaute bleiben", () => {
	assert.equal(editionSearchForm("daß alß"), "dass alss");
	assert.equal(editionSearchForm("Scheüchtzer"), "Scheüchtzer");
});

test("editionSearchForm: weiche Trennstriche und ¬ verschwinden", () => {
	assert.equal(editionSearchForm("der ­toüf­fer"), "der toüffer");
	assert.equal(editionSearchForm("Burger¬ meister"), "Burgermeister");
});

test("editionSearchForm: Suchsyntax der Anfrage bleibt", () => {
	assert.equal(editionSearchForm('"zů gast" -daß'), '"zu gast" -dass');
	assert.equal(editionSearchForm("Täufer"), "Täufer");
});
