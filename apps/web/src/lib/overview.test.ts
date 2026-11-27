// Lauf: npx tsx --test src/lib/overview.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { allAutoOpensAdvanced, foreignFilters, overviewIsLanding, type OverviewParams } from "./overview";
import { NO_EDITIONS_FILTERS, type EditionsFilterValues } from "./editionTexts";
import type { EhedatenFilterValues } from "./ehedaten";

const P: OverviewParams = {
	q: "",
	anyTerms: [],
	theme: "",
	topK: null,
	sort: "relevance",
	series: [],
	persons: [],
	places: [],
	organizations: [],
	volumeNr: [],
	startPg: [],
	serialNr: [],
	resolutionId: [],
	years: [],
};
const CAT = { level: [], bestand: [], digital: false, fields: [] };
const EHE: EhedatenFilterValues = { mann: [], frau: [], kirche: [], raum: [], quelle: [], art: null, band: [] };
const ED: EditionsFilterValues = { ...NO_EDITIONS_FILTERS };
const NO_DATES = { dateFrom: null, dateTo: null };

test("overviewIsLanding: nur ohne jede Eingabe", () => {
	assert.equal(overviewIsLanding(P, NO_DATES, CAT, EHE, ED), true);
	assert.equal(overviewIsLanding({ ...P, q: "Mühle" }, NO_DATES, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding({ ...P, anyTerms: ["Mühle", "Säge"] }, NO_DATES, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding({ ...P, theme: "Seuchen" }, NO_DATES, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding({ ...P, sort: "date_desc" }, NO_DATES, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding(P, { dateFrom: 900, dateTo: null }, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding({ ...P, series: ["RRB"] }, NO_DATES, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding({ ...P, persons: ["Anna Meier"] }, NO_DATES, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding({ ...P, years: [1850] }, NO_DATES, CAT, EHE, ED), false);
	assert.equal(overviewIsLanding(P, NO_DATES, { ...CAT, level: ["Dossier"] }, EHE, ED), false);
	assert.equal(overviewIsLanding(P, NO_DATES, CAT, { ...EHE, mann: ["Heusser"] }, ED), false);
	assert.equal(overviewIsLanding(P, NO_DATES, CAT, { ...EHE, art: "trauung" }, ED), false);
	assert.equal(overviewIsLanding(P, NO_DATES, CAT, EHE, { ...ED, facs: true }), false);
});

test("allAutoOpensAdvanced: ODER, Thema (nur mit Embed), Themen-Umfang, Namen; Zeitraum nicht", () => {
	assert.equal(allAutoOpensAdvanced(P, true), false);
	assert.equal(allAutoOpensAdvanced({ ...P, anyTerms: ["a", "b"] }, true), true);
	assert.equal(allAutoOpensAdvanced({ ...P, theme: "Seuchen" }, true), true);
	assert.equal(allAutoOpensAdvanced({ ...P, theme: "Seuchen" }, false), false);
	assert.equal(allAutoOpensAdvanced({ ...P, topK: 100 }, false), true);
	assert.equal(allAutoOpensAdvanced({ ...P, places: ["Uster"] }, false), true);
});

test("foreignFilters im Reiter «Alle Quellen»: Serie und Filter der drei Reiter, je Reiter gruppiert", () => {
	const groups = foreignFilters(
		"all",
		{ ...P, series: ["RRB"], years: [1850] },
		{ ...CAT, level: ["Dossier", "Dokument"], digital: true, fields: [{ field: "signature", value: "C II 12" }] },
		{ ...EHE, mann: ["Heusser"], kirche: ["Uster"], art: "trauung", raum: ["zh"] },
		{ ...ED, facs: true, keyword: ["Täufertum"] },
		true,
	);
	assert.deepEqual(
		groups.map((g) => [g.view, g.label, g.items]),
		[
			["documents", "Zentrale Serien", ["Serie RRB", "Filter der Serie"]],
			["catalog", "Archivkatalog", ["Stufe Dossier, Dokument", "nur mit Digitalisat", "Feldsuche (1 Eintrag)"]],
			["ehedaten", "Ehedaten", ["Bräutigam Heusser", "Kirchgemeinde Uster", "Herkunftsraum Kanton Zürich", "nur Trauung"]],
			["editions", "Editionen", ["Schlagwort Täufertum", "nur mit Faksimile"]],
		],
	);
	assert.deepEqual(foreignFilters("all", P, CAT, EHE, ED, true), []);
});

test("foreignFilters in den Fach-Reitern: nur, was dort nicht wirkt", () => {
	const ehe = { ...EHE, frau: ["Meier"] };
	const cat = { ...CAT, bestand: ["Handelsregisteramt HRA, 1819-2003 (Bestand)"] };
	// Dokumente: Katalog-, Ehedaten- und Editionsfilter; Serie wirkt.
	assert.deepEqual(
		foreignFilters("documents", { ...P, series: ["RRB"] }, cat, ehe, ED, true).map((g) => [g.view, g.items]),
		[
			["catalog", ["Bestand Handelsregisteramt HRA"]],
			["ehedaten", ["Braut Meier"]],
		],
	);
	// Katalog: Serie (documentsOnlyFilters) und die Filter von Ehedaten und Editionen; Stufe wirkt.
	assert.deepEqual(
		foreignFilters("catalog", { ...P, series: ["RRB"] }, { ...CAT, level: ["Dossier"] }, ehe, { ...ED, facs: true }, true).map((g) => [g.view, g.items]),
		[
			["documents", ["Serie RRB"]],
			["ehedaten", ["Braut Meier"]],
			["editions", ["nur mit Faksimile"]],
		],
	);
	// Ehedaten: Thema wirkt dort nie, dazu Katalog- und Editionsfilter.
	assert.deepEqual(
		foreignFilters("ehedaten", { ...P, theme: "Seuchen" }, cat, ehe, ED, false).map((g) => [g.view, g.items]),
		[
			["documents", ["Thema"]],
			["catalog", ["Bestand Handelsregisteramt HRA"]],
		],
	);
	// Editionen: Thema nur ohne Vektoren; Ehedaten- und Katalogfilter.
	assert.deepEqual(
		foreignFilters("editions", { ...P, theme: "Seuchen" }, CAT, ehe, ED, true).map((g) => [g.view, g.items]),
		[["ehedaten", ["Braut Meier"]]],
	);
	assert.deepEqual(
		foreignFilters("editions", { ...P, theme: "Seuchen" }, CAT, EHE, ED, false).map((g) => [g.view, g.items]),
		[["documents", ["Thema"]]],
	);
});

test("foreignFilters kürzt lange Listen", () => {
	const groups = foreignFilters("all", P, { ...CAT, level: ["Dossier", "Dokument", "Klasse", "Bestand", "Fonds"] }, EHE, ED, true);
	assert.deepEqual(groups[0].items, ["Stufe Dossier, Dokument, Klasse und 2 weitere"]);
});
