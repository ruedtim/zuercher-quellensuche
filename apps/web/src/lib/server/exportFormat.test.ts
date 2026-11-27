/**
 * Unit-Tests für die Formate des Treffer-Exports. Lauf:
 *   npx tsx --test src/lib/server/exportFormat.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	CSV_BOM,
	EXPORT_COLUMNS,
	IIIF_RIGHTS_PDM,
	buildExportReadme,
	buildIiifCollection,
	csvEscape,
	csvHeader,
	csvRow,
	dedupeIds,
	docToCells,
	exportBaseName,
	exportColumns,
	exportFileExtension,
	iiifItemLabel,
	orderByIds,
	reproducibleSearchUrl,
	textEntryName,
	type ExportReadmeInput,
} from "./exportFormat";
import { parseSearchParams } from "../searchParams";
import { DEFAULT_SEARCH, type SearchHit, type SearchParams } from "../types";
import { ATTRIBUTION } from "./apiV1/constants";

const BASE = "https://zentraleserien.ch";

function doc(partial: Partial<SearchHit> & { id: string }): SearchHit {
	return {
		series: "RRB",
		title: "Titel",
		date: null,
		dateYear: null,
		startPg: null,
		volumeNr: null,
		serialNr: null,
		resolutionId: null,
		stazhIdent: null,
		archiveLink: null,
		manifestUrl: null,
		...partial,
	};
}

function params(p: Partial<SearchParams>): SearchParams {
	return { ...DEFAULT_SEARCH, ...p };
}

test("csvEscape: RFC 4180", () => {
	assert.equal(csvEscape(null), "");
	assert.equal(csvEscape(undefined), "");
	assert.equal(csvEscape(0), "0");
	assert.equal(csvEscape(1989), "1989");
	assert.equal(csvEscape("einfach"), "einfach");
	assert.equal(csvEscape("a,b"), '"a,b"');
	assert.equal(csvEscape('er sagte "ja"'), '"er sagte ""ja"""');
	assert.equal(csvEscape("zwei\nZeilen"), '"zwei\nZeilen"');
	assert.equal(csvEscape("cr\rx"), '"cr\rx"');
	assert.equal(csvEscape("a;b"), "a;b");
	assert.equal(csvEscape("=SUMME(A1)"), "=SUMME(A1)");
});

test("csvRow/csvHeader: CRLF, Spaltenreihenfolge", () => {
	assert.equal(csvRow(["a", 1, null, "x,y"]), 'a,1,,"x,y"\r\n');
	assert.equal(csvHeader(EXPORT_COLUMNS), EXPORT_COLUMNS.map((c) => c.key).join(",") + "\r\n");
	assert.equal(EXPORT_COLUMNS[0].key, "rank");
	assert.equal(EXPORT_COLUMNS[1].key, "id");
	assert.equal(exportColumns(true).at(-1)?.key, "textFile");
	assert.equal(exportColumns(false).length, EXPORT_COLUMNS.length);
	assert.equal(CSV_BOM, "\uFEFF");
});

test("docToCells: Felder, Links, Normalisierung", () => {
	const cells = docToCells(
		doc({
			id: "MM_3_188_RRB_1989_0355_t",
			series: "RRB",
			title: "  Armut im\n Kanton Zürich ",
			stazhIdent: "StAZH MM 3.188\n   RRB 1989/0355",
			date: "1989-02-08",
			dateYear: 1989,
			resolutionId: "1989/0355",
			persons: ["Mona, Marco", "Heidi Hofmann"],
			places: [],
			manifestUrl: "http://localhost:5173/iiif/ABl/x/manifest.json",
			archiveLink: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=4162942",
		}),
		7,
		BASE,
	);
	const byKey = Object.fromEntries(EXPORT_COLUMNS.map((c, i) => [c.key, cells[i]]));
	assert.equal(cells.length, EXPORT_COLUMNS.length);
	assert.equal(byKey.rank, 7);
	assert.equal(byKey.title, "Armut im Kanton Zürich");
	assert.equal(byKey.stazhIdent, "StAZH MM 3.188 RRB 1989/0355");
	assert.equal(byKey.dateYear, 1989);
	assert.equal(byKey.persons, "Mona, Marco | Heidi Hofmann");
	assert.equal(byKey.places, null);
	assert.equal(byKey.url, `${BASE}/documents/RRB/MM_3_188_RRB_1989_0355_t`);
	assert.equal(byKey.teiUrl, `${BASE}/xml/RRB/MM_3_188_RRB_1989_0355_t.xml`);
	assert.equal(byKey.manifestUrl, `${BASE}/iiif/ABl/x/manifest.json`);
	const withFile = docToCells(doc({ id: "x" }), 1, BASE, "texte/001_x.txt");
	assert.equal(withFile.at(-1), "texte/001_x.txt");
});

test("exportBaseName: ASCII, Suchbegriff ohne Ausschlüsse, Zürcher Datum", () => {
	const now = new Date("2026-09-25T23:30:00Z"); // in Zürich schon der 26.
	assert.equal(exportBaseName(params({ q: "Armut" }), now), "zentraleserien_armut_2026-09-26");
	assert.equal(exportBaseName(params({ q: "fisch -das" }), now), "zentraleserien_fisch_2026-09-26");
	assert.equal(
		exportBaseName(params({ q: '"Jacqueline Fehr" Zürich' }), now),
		"zentraleserien_jacqueline-fehr-zurich_2026-09-26",
	);
	assert.equal(exportBaseName(params({ anyTerms: ["Kokain", "Koks"] }), now), "zentraleserien_kokain-oder-koks_2026-09-26");
	assert.equal(exportBaseName(params({ theme: "Eisenbahnbau" }), now), "zentraleserien_eisenbahnbau_2026-09-26");
	assert.equal(exportBaseName(params({ series: ["KRP", "OS"] }), now), "zentraleserien_krp-os_2026-09-26");
	assert.equal(exportBaseName(params({}), now), "zentraleserien_treffer_2026-09-26");
	const long = exportBaseName(params({ q: "a".repeat(200) }), now);
	assert.ok(/^[a-z0-9_-]+$/.test(long.replace(/_\d{4}-\d{2}-\d{2}$/, "")));
	assert.ok(long.length <= 70);
	assert.equal(exportFileExtension("table", "csv"), "csv");
	assert.equal(exportFileExtension("table", "xlsx"), "xlsx");
	assert.equal(exportFileExtension("text", "xlsx"), "zip");
	assert.equal(exportFileExtension("iiif", "csv"), "zip");
});

test("textEntryName: Rang gepolstert + Signatur-Slug", () => {
	assert.equal(
		textEntryName(42, 2544, { id: "x", stazhIdent: "StAZH MM 3.188 RRB 1989/0355" }),
		"texte/0042_StAZH_MM_3.188_RRB_1989_0355.txt",
	);
	assert.equal(textEntryName(1, 12, { id: "RRB_2016_0271", stazhIdent: null }), "texte/001_RRB_2016_0271.txt");
});

test("reproducibleSearchUrl parst identisch zurück (ohne Seite/Modell)", () => {
	const p = params({
		q: "Armut",
		anyTerms: ["Kokain", "Koks"],
		theme: "Drogen",
		series: ["KRP", "RRB"],
		dateFrom: 1980,
		dateTo: 2000,
		sort: "date_desc",
		topK: 250,
		persons: ["Müller, Hans"],
		titleOnly: true,
		page: 7,
	});
	const url = reproducibleSearchUrl(p, BASE);
	assert.ok(url.startsWith(`${BASE}/search?`));
	const back = parseSearchParams(new URL(url));
	assert.deepEqual(back, { ...p, page: 1, semanticRatio: 0.7 });
});

test("dedupeIds + orderByIds: Reihenfolge, Lücken, Rang-Offset", () => {
	assert.deepEqual(dedupeIds(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
	const ids = ["a", "b", "c", "d"];
	const docs = [doc({ id: "d" }), doc({ id: "a" }), doc({ id: "c" })];
	const { ordered, missing } = orderByIds(ids, docs, 100);
	assert.deepEqual(
		ordered.map((o) => [o.rank, o.doc.id]),
		[
			[101, "a"],
			[103, "c"],
			[104, "d"],
		],
	);
	assert.equal(missing, 1);
});

test("IIIF-Sammlung: Presentation 3, Rechte-URI, Einträge", () => {
	const json = JSON.parse(
		buildIiifCollection({
			id: `${BASE}/search?q=Armut#iiif-collection`,
			label: "Treffer",
			summary: "2 Dokumente",
			items: [
				{ manifestUrl: "https://zszh.sources-online.org/manifests/RRB/x/info.json", label: "A (StAZH x)" },
				{ manifestUrl: `${BASE}/iiif/ABl/y/manifest.json`, label: "B" },
			],
		}),
	);
	assert.equal(json["@context"], "http://iiif.io/api/presentation/3/context.json");
	assert.equal(json.type, "Collection");
	assert.equal(json.rights, IIIF_RIGHTS_PDM);
	assert.deepEqual(json.requiredStatement.value, { de: [ATTRIBUTION] });
	assert.equal(json.items.length, 2);
	for (const it of json.items) {
		assert.equal(it.type, "Manifest");
		assert.ok(typeof it.id === "string" && it.id.startsWith("http"));
		assert.ok(Array.isArray(it.label.de) && it.label.de[0]);
	}
	assert.equal(iiifItemLabel(doc({ id: "x", title: "Titel", stazhIdent: "StAZH 1" })), "Titel (StAZH 1)");
	assert.equal(iiifItemLabel(doc({ id: "x", title: "", stazhIdent: null })), "x");
});

function readmeInput(p: Partial<ExportReadmeInput>): ExportReadmeInput {
	return {
		content: "text",
		format: "csv",
		params: params({ q: "Armut", series: ["RRB"], dateFrom: 1980 }),
		searchUrl: `${BASE}/search?q=Armut&series=RRB&dateFrom=1980`,
		baseUrl: BASE,
		planned: { count: 2544, total: 2544, scope: "all" },
		exported: 2544,
		missing: 0,
		stoppedByBudget: false,
		budgetMb: 300,
		withFacsimile: 0,
		withRm: 0,
		generatedAt: new Date("2026-09-25T10:00:00Z"),
		...p,
	};
}

test("README: Such-Link, Umfang, Dateien, Spalten, Lizenz", () => {
	const txt = buildExportReadme(readmeInput({}));
	assert.ok(txt.includes(`${BASE}/search?q=Armut&series=RRB&dateFrom=1980`));
	assert.ok(txt.includes("Suchbegriff:      Armut"));
	assert.ok(txt.includes("RRB (Regierungsratsbeschlüsse)"));
	assert.ok(txt.includes("Zeitraum:         1980 bis …"));
	assert.ok(txt.includes("treffer.csv"));
	assert.ok(txt.includes("texte/"));
	assert.ok(txt.includes("textFile"));
	assert.ok(txt.includes("Public Domain Mark"));
	assert.ok(txt.includes(ATTRIBUTION));
	assert.ok(txt.includes("Aus Text/CSV"));
	assert.ok(!txt.includes("iiif-collection.json"));
	assert.ok(!txt.includes("\u2014"), "kein Em-Dash");
});

test("README: Namen mit Vergleichsschlüssel nennen andere Schreibungen", () => {
	const p = params({ places: ["Fischental"], persons: ["Meier"] });
	const keyed = buildExportReadme(readmeInput({ params: p, entityKeys: true }));
	assert.ok(keyed.includes("Orte:             Fischental (auch andere Schreibungen)"));
	assert.ok(keyed.includes("Personen:         Meier\n"), "nackter Nachname ohne Schlüssel");
	const exact = buildExportReadme(readmeInput({ params: p }));
	assert.ok(exact.includes("Orte:             Fischental\n"));
	const api = buildExportReadme(readmeInput({ params: { ...p, entityMatch: "exact" }, entityKeys: true }));
	assert.ok(api.includes("Orte:             Fischental\n"));
});

test("IIIF-Sammlung mit Ratsmanualen: kein pauschales rights, Bildnachweis ergänzt", () => {
	const json = JSON.parse(
		buildIiifCollection({
			id: `${BASE}/search?q=Pest#iiif-collection`,
			label: "Treffer",
			summary: "2 Dokumente",
			items: [
				{ manifestUrl: `${BASE}/iiif/ABl/y/manifest.json`, label: "B", series: "ABl" },
				{ manifestUrl: `${BASE}/iiif/RM/RM_1642_0441_0012/manifest.json`, label: "R", series: "RM" },
			],
		}),
	);
	assert.equal(json.rights, undefined);
	assert.equal(json.requiredStatement.value.de[0], ATTRIBUTION);
	assert.match(json.requiredStatement.value.de[1], /Ratsmanuale.*Staatsarchiv des Kantons Zürich, StAZH B II/);
	assert.equal(json.items.length, 2);
});

test("README: Ratsmanuale – Lesefassung und Bilder ohne Kennzeichnung", () => {
	const txt = buildExportReadme(readmeInput({ content: "iiif", withRm: 3, withFacsimile: 3 }));
	assert.ok(txt.includes("Ratsmanuale (RM): maschinelle Transkription"));
	assert.ok(txt.includes("Lesefassung"));
	assert.ok(txt.includes("Transkribus-Bildserver"));
	assert.ok(txt.includes("RM = Ratsmanuale"));
	assert.ok(!txt.includes("\u2014"), "kein Em-Dash");
	const without = buildExportReadme(readmeInput({ content: "iiif", withFacsimile: 3 }));
	assert.ok(!without.includes("Transkribus"));
	assert.ok(!without.includes("Lesefassung"));
});

test("README: Kappung, fehlende Docs, Budget, IIIF, Excel", () => {
	const txt = buildExportReadme(
		readmeInput({
			content: "iiif",
			format: "xlsx",
			planned: { count: 10_000, total: 46_586, scope: "cap" },
			exported: 9_000,
			missing: 3,
			stoppedByBudget: true,
			withFacsimile: 8_123,
		}),
	);
	assert.ok(txt.includes("die ersten"));
	assert.ok(txt.includes("bulk-daten"));
	assert.ok(txt.includes("nicht mehr im Index"));
	assert.ok(txt.includes("Volltext-Budget von 300 MB"));
	assert.ok(txt.includes("iiif-collection.json"));
	assert.ok(txt.includes("treffer.xlsx"));
	assert.ok(!txt.includes("Aus Text/CSV"));
	assert.ok(!txt.includes("\u2014"), "kein Em-Dash");
	const tableOnly = buildExportReadme(readmeInput({ content: "table" }));
	assert.ok(!tableOnly.includes("textFile"));
	assert.ok(!tableOnly.includes("texte/"));
});
