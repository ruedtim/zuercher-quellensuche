/**
 * Unit-Tests für die Export-Obergrenzen (Popup-Zahl = Endpoint-Deckel). Lauf:
 *   npx tsx --test src/lib/exportLimits.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	EXPORT_TABLE_CAP,
	EXPORT_TEXT_CAP,
	exportCap,
	exportableCount,
	exportCountLabel,
	formatCount,
	parseExportContent,
	parseExportFormat,
} from "./exportLimits";
import { CORPUS_CAP } from "./types";

test("Caps je Inhalt", () => {
	assert.equal(exportCap("table"), EXPORT_TABLE_CAP);
	assert.equal(exportCap("text"), EXPORT_TEXT_CAP);
	assert.equal(exportCap("iiif"), EXPORT_TEXT_CAP);
	assert.equal(EXPORT_TABLE_CAP, 100_000);
	assert.equal(EXPORT_TEXT_CAP, 10_000);
});

test("Parser akzeptieren nur bekannte Werte", () => {
	assert.equal(parseExportContent("table"), "table");
	assert.equal(parseExportContent("iiif"), "iiif");
	assert.equal(parseExportContent("zip"), null);
	assert.equal(parseExportContent(null), null);
	assert.equal(parseExportFormat("xlsx"), "xlsx");
	assert.equal(parseExportFormat("csv"), "csv");
	assert.equal(parseExportFormat("xls"), null);
	assert.equal(parseExportFormat(undefined), null);
});

test("alle Treffer unter dem Deckel", () => {
	assert.deepEqual(exportableCount("text", { estimatedTotalHits: 2544 }), {
		count: 2544,
		total: 2544,
		scope: "all",
	});
});

test("Format-Deckel greift (Tabelle vs. Volltexte)", () => {
	const r = { estimatedTotalHits: 603_782 };
	assert.deepEqual(exportableCount("table", r), { count: 100_000, total: 603_782, scope: "cap" });
	assert.deepEqual(exportableCount("text", r), { count: 10_000, total: 603_782, scope: "cap" });
	assert.deepEqual(exportableCount("table", { estimatedTotalHits: 46_586 }), {
		count: 46_586,
		total: 46_586,
		scope: "all",
	});
});

test("Wort + Thema: der Export reiht bis CORPUS_CAP, auch wenn die Liste früher endet (rankedPool)", () => {
	const r = { estimatedTotalHits: 46_586, rankedPool: 1_000 };
	assert.deepEqual(exportableCount("table", r), { count: CORPUS_CAP, total: 46_586, scope: "pool" });
	assert.deepEqual(exportableCount("text", r), { count: CORPUS_CAP, total: 46_586, scope: "pool" });
	const small = { estimatedTotalHits: 4_000, rankedPool: 1_000 };
	assert.deepEqual(exportableCount("table", small), { count: 4_000, total: 4_000, scope: "all" });
});

test("Thema allein (themeRankedAll) deckelt auf CORPUS_CAP", () => {
	const r = { estimatedTotalHits: 250_000, themeRankedAll: true };
	assert.deepEqual(exportableCount("table", r), { count: CORPUS_CAP, total: 250_000, scope: "theme" });
	const small = { estimatedTotalHits: 800, themeRankedAll: true };
	assert.deepEqual(exportableCount("table", small), { count: 800, total: 800, scope: "all" });
});

test("Top-K-Modus: K Treffer, Bezug topKOfTotal", () => {
	const r = { estimatedTotalHits: 100, topKOfTotal: 5000 };
	assert.deepEqual(exportableCount("text", r), { count: 100, total: 5000, scope: "topK" });
	const all = { estimatedTotalHits: 40, topKOfTotal: 40 };
	assert.deepEqual(exportableCount("table", all), { count: 40, total: 40, scope: "topK" });
});

test("Labels (Schweizer Zahlenformat)", () => {
	assert.equal(exportCountLabel({ count: 1, total: 1, scope: "all" }), "1 Dokument");
	assert.equal(exportCountLabel({ count: 2544, total: 2544, scope: "all" }), `${formatCount(2544)} Dokumente`);
	assert.equal(
		exportCountLabel({ count: 10_000, total: 46_586, scope: "cap" }),
		`die ersten ${formatCount(10_000)} von ${formatCount(46_586)} Treffern`,
	);
	assert.equal(
		exportCountLabel({ count: 10_000, total: 46_586, scope: "pool" }),
		`die ersten ${formatCount(10_000)} von ${formatCount(46_586)} Treffern`,
	);
	assert.equal(
		exportCountLabel({ count: 100, total: 5000, scope: "topK" }),
		`die 100 ähnlichsten von ${formatCount(5000)} Treffern`,
	);
	assert.equal(exportCountLabel({ count: 40, total: 40, scope: "topK" }), "40 Dokumente");
	assert.match(formatCount(10_000), /^10.000$/);
});

test("kein Em-Dash in Labels", () => {
	for (const scope of ["all", "cap", "pool", "topK", "theme"] as const) {
		assert.ok(!exportCountLabel({ count: 5, total: 9, scope }).includes("\u2014"));
	}
});
