/**
 * Unit-Tests für den Reiter «Editionen» (Parameter, Filter, Anzeige, Manifest). Lauf:
 *   npx tsx --test src/lib/editionTexts.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	editionCitation,
	editionCredits,
	editionDateLabel,
	editionDocId,
	editionManifest,
	editionNeighborLabel,
	editionNeighborsIn,
	editionTeiUrl,
	editionTextIds,
	editionsAutoOpensAdvanced,
	editionsFilterClauses,
	editionsIgnoredFilters,
	editionsTimelineAxis,
	editionUnitPath,
	isIndexedEdition,
	NO_EDITIONS_FILTERS,
	parseEditionsFilters,
	topFacet,
	writeEditionsParams,
} from "./editionTexts";

const NO_SHARED = { dateFrom: null, dateTo: null, persons: [], places: [], organizations: [] };

test("URL: eigene Filter lesen und schreiben, Reiter aktiv nur mit view=editions", () => {
	const url = new URL("http://x/search?view=editions&edEdition=qzh&edEdition=xyz&edPart=Teil%20A&edKeyword=Täufertum&edFacs=1");
	const f = parseEditionsFilters(url);
	assert.equal(f.active, true);
	assert.deepEqual(f.edition, ["qzh"]);
	assert.deepEqual(f.part, ["Teil A"]);
	assert.deepEqual(f.keyword, ["Täufertum"]);
	assert.equal(f.facs, true);
	assert.equal(parseEditionsFilters(new URL("http://x/search?edFacs=1")).active, false);
	const out = writeEditionsParams(new URL("http://x/search?q=a&edPart=alt"), { edition: ["qzh"], part: [], keyword: ["Armut"], facs: false });
	assert.equal(out.search, "?q=a&edEdition=qzh&edKeyword=Armut");
});

test("Filter: Zeitraum nach Berührung, Namen über Form oder Schlüssel, eigene Filter", () => {
	assert.deepEqual(editionsFilterClauses(NO_EDITIONS_FILTERS, NO_SHARED), []);
	const clauses = editionsFilterClauses(
		{ edition: ["qzh"], part: ["Teil A"], keyword: ["Täufertum", "Armut"], facs: true },
		{ dateFrom: 1500, dateTo: 1600, persons: ["Heinrich Bullinger", "Bohq"], places: ["Zürich"], organizations: [] },
	);
	assert.deepEqual(clauses, [
		"dateTo >= 1500",
		"dateFrom <= 1600",
		'(persons IN ["Heinrich Bullinger", "Bohq"] OR personKeys IN ["heinrich bulinger"])',
		'(places IN ["Zürich"] OR placeKeys IN ["zurich"])',
		'edition IN ["qzh"]',
		'part IN ["Teil A"]',
		'keywords IN ["Täufertum", "Armut"]',
		"hasFacsimile = true",
	]);
	// Ein Einzelname ohne Schlüssel filtert nur über den Namen.
	assert.deepEqual(editionsFilterClauses(NO_EDITIONS_FILTERS, { ...NO_SHARED, persons: ["Bohq"] }), ['persons IN ["Bohq"]']);
});

test("Hinweise: Serien und Thema ohne Vektoren wirken nicht; Aufklappen wie im Katalog", () => {
	const p = { series: ["RM" as const], volumeNr: [], startPg: [], serialNr: [], resolutionId: [], years: [], theme: "Armut" };
	assert.deepEqual(editionsIgnoredFilters(p, false), ["Serie RM", "Thema"]);
	assert.deepEqual(editionsIgnoredFilters(p, true), ["Serie RM"]);
	const none = { anyTerms: [], theme: "", topK: null, persons: [], places: [], organizations: [] };
	assert.equal(editionsAutoOpensAdvanced(none, true), false);
	assert.equal(editionsAutoOpensAdvanced({ ...none, theme: "Armut" }, true), true);
	assert.equal(editionsAutoOpensAdvanced({ ...none, theme: "Armut" }, false), false);
	assert.equal(editionsAutoOpensAdvanced({ ...none, places: ["Zürich"] }, false), true);
});

test("Datum: Tag, Monat, Jahr, Spannen", () => {
	assert.equal(editionDateLabel("1583-09-21", "1583-09-21"), "21.9.1583");
	assert.equal(editionDateLabel("1530-05-01", "1530-05-31"), "Mai 1530");
	assert.equal(editionDateLabel("1530-01-01", "1530-12-31"), "1530");
	assert.equal(editionDateLabel("1530-01-01", "1532-12-31"), "1530–1532");
	assert.equal(editionDateLabel("1275-01-26", "1275-04-09"), "26.1.–9.4.1275");
	assert.equal(editionDateLabel("1599-12-30", "1600-01-02"), "30.12.1599–2.1.1600");
	assert.equal(editionDateLabel(null, null), "");
});

test("Rechtsquellen: TEI-Datei, Texte eines Stücks, Nachbarn mit Nummer", () => {
	const piece = {
		edition: "ssrq" as const,
		localId: "SSRQ_ZH_NF_II_9_007",
		sourceFile: "ZH_NF_II_9/SSRQ_ZH_NF_II_9_007_1.xml",
		witnesses: [{ textId: "SSRQ_ZH_NF_II_9_007_2" }, {}] as Array<{ textId?: string }>,
	};
	assert.equal(editionTeiUrl(piece), "https://github.com/stazh/erqzh-data/blob/main/ZH_NF_II_9/SSRQ_ZH_NF_II_9_007_1.xml");
	// Ältere Index-Stände ohne sourceFile: QZH wie bisher, Rechtsquellen ohne Link.
	assert.equal(editionTeiUrl({ edition: "qzh", localId: "QZH_401", sourceFile: null }), "https://github.com/stazh/qzh-data/blob/main/quellenstuecke/QZH_401.xml");
	assert.equal(editionTeiUrl({ ...piece, sourceFile: null }), null);
	assert.deepEqual(editionTextIds(piece as never), ["SSRQ_ZH_NF_II_9_007", "SSRQ_ZH_NF_II_9_007_1", "SSRQ_ZH_NF_II_9_007_2"]);
	assert.deepEqual(editionTextIds({ localId: "QZH_401", sourceFile: "quellenstuecke/QZH_401.xml", witnesses: [] }), ["QZH_401"]);
	assert.equal(editionNeighborLabel("ssrq", "SSRQ_ZH_NF_II_9_046"), "Nr. 46");
	assert.equal(editionNeighborLabel("qzh", "QZH_046"), "QZH_046");
});

test("Pfade, IDs, Editionen im Index", () => {
	assert.equal(editionUnitPath("qzh", "QZH_401"), "/editionen/qzh/QZH_401");
	assert.equal(editionDocId("qzh", "QZH_401"), "qzh-QZH_401");
	assert.equal(isIndexedEdition("qzh"), true);
	assert.equal(isIndexedEdition("ssrq"), true);
	assert.equal(isIndexedEdition("erqzh"), false);
});

const UNIT = {
	edition: "qzh" as const,
	localId: "QZH_999",
	title: "Ausgedachter Ratsbeschluss",
	isoFrom: "1583-09-21",
	isoTo: "1583-09-21",
	signature: "StAZH X 1.2, Nr. 3",
	permalink: "https://qzh.sources-online.org/quellenstuecke/QZH_999",
	transcription: ["Erika Muster"],
	tagging: ["Erika Muster"],
	editors: ["Hanna Herausgeberin"],
	facs: [
		{ service: "https://media.example.org/iiif/2/qzh!A_1.tif", width: 1000, height: 1500, n: "1" },
		{ service: "https://media.example.org/iiif/2/qzh!A_2.tif", width: 1000, height: 1400, n: "2" },
	],
};

test("Zitat und Bearbeitung", () => {
	assert.equal(
		editionCitation(UNIT, "https://zentraleserien.ch/editionen/qzh/QZH_999"),
		"Ausgedachter Ratsbeschluss, 21.9.1583. StAZH X 1.2, Nr. 3. In: Quellen zur Zürcher Geschichte (QZH), QZH_999, bearbeitet von Erika Muster, https://qzh.sources-online.org/quellenstuecke/QZH_999 (CC BY 4.0). Auf archivquellen.ch: https://zentraleserien.ch/editionen/qzh/QZH_999",
	);
	assert.deepEqual(editionCredits(UNIT), [
		{ label: "Transkription und Auszeichnung", names: ["Erika Muster"] },
		{ label: "Herausgeberschaft", names: ["Hanna Herausgeberin"] },
	]);
});

test("Manifest: je Bild ein Canvas, Bilddienst, Rechte nur für Bilder der Edition", () => {
	const m = editionManifest(UNIT, "https://zentraleserien.ch/editionen/qzh/QZH_999") as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
	assert.equal(m.id, "https://zentraleserien.ch/editionen/qzh/QZH_999/manifest.json");
	assert.equal(m.items.length, 2);
	assert.equal(m.items[1].label.de[0], "2");
	assert.equal(m.items[1].height, 1400);
	assert.equal(m.items[0].items[0].items[0].body.service[0].id, "https://media.example.org/iiif/2/qzh!A_1.tif");
	assert.equal(m.rights, "http://creativecommons.org/publicdomain/mark/1.0/");
	assert.equal(m.requiredStatement.value.de[0], "Staatsarchiv des Kantons Zürich, X 1.2, Nr. 3");
	const mixed = editionManifest({ ...UNIT, facs: [{ ...UNIT.facs[0], credit: "Zentralbibliothek Zürich, Ms F 1, e-manuscripta.ch" }] }, "https://x") as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
	assert.equal(mixed.rights, undefined);
	assert.equal(mixed.items[0].requiredStatement.value.de[0], "Zentralbibliothek Zürich, Ms F 1, e-manuscripta.ch");
});

test("Facetten und Zeitleiste", () => {
	assert.deepEqual(topFacet({ a: 1, b: 5, c: 3 }, ["z"], 2), [
		{ value: "b", count: 5 },
		{ value: "c", count: 3 },
		{ value: "z", count: 0 },
	]);
	assert.deepEqual(editionsTimelineAxis({ min: 1275, max: 1795 }, { dateFrom: null, dateTo: null }), { min: 1275, max: 1795 });
	assert.deepEqual(editionsTimelineAxis({ min: 1583, max: 1583 }, { dateFrom: null, dateTo: null }), { min: 1573, max: 1593 });
	assert.equal(editionsTimelineAxis({ min: null, max: null }, { dateFrom: null, dateTo: null }), null);
});

test("Nachbarn nach Laufnummer (nr nur sortierbar)", () => {
	const order = [
		{ localId: "QZH_399", nr: 399 },
		{ localId: "QZH_400", nr: 400 },
		{ localId: "QZH_401", nr: 401 },
		{ localId: "QZH_405", nr: 405 },
	];
	assert.deepEqual(editionNeighborsIn(order, 401), { prev: "QZH_400", next: "QZH_405" });
	assert.deepEqual(editionNeighborsIn(order, 399), { prev: null, next: "QZH_400" });
	assert.deepEqual(editionNeighborsIn(order, 405), { prev: "QZH_401", next: null });
	assert.deepEqual(editionNeighborsIn(order, null), { prev: null, next: null });
	assert.deepEqual(editionNeighborsIn([], 3), { prev: null, next: null });
});
