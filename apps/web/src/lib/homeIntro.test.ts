// Lauf: npx tsx --test src/lib/homeIntro.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeIntro, roughCount } from "./homeIntro";

const nbsp = (s: string) => s.replace(/’/g, "'");

test("roughCount: ab einer Million gerundet", () => {
	assert.equal(roughCount(1_855_875), "1,86 Millionen");
	assert.equal(nbsp(roughCount(999_999)), "999'999");
});

test("homeIntro: alle Bestände", () => {
	assert.equal(
		nbsp(homeIntro({ documents: 697_540, since: 1484, catalog: 1_855_875, ehedaten: 296_293, editions: 1_687 }, 2026)),
		"Finden Sie heraus, was im Staatsarchiv liegt, und lesen Sie amtliche Quellen aus über 500 Jahren im Volltext. Eine Suche für 1,86 Millionen Einträge des Archivkatalogs, 697'540 Protokolle, Beschlüsse, Gesetze und Amtsblatt-Texte seit 1484, 296'293 Eheeinträge und 1'687 edierte Quellenstücke.",
	);
});

test("homeIntro: fehlende Bestände fallen weg", () => {
	assert.equal(
		nbsp(homeIntro({ documents: 10, since: 1803, catalog: null, ehedaten: null, editions: 0 }, 2026)),
		"Lesen Sie amtliche Quellen aus über 200 Jahren im Volltext. Eine Suche für 10 Protokolle, Beschlüsse, Gesetze und Amtsblatt-Texte seit 1803.",
	);
});
