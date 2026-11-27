// Lauf: npx tsx --test src/lib/editions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EDITIONS, editionsOf, indexEditionLinks, mergeEditionLinks, type EditionLink, type EditionLinksData } from "./editions";

const QZH_401 = "https://qzh.sources-online.org/quellenstuecke/QZH_401";
const NR_47 = "https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_047";

const data: EditionLinksData = {
	texts: {
		QZH_401: { edition: "qzh", label: "QZH_401", url: QZH_401, title: "Ratsbeschluss betreffend Verfolgung von Täufern" },
		SSRQ_ZH_NF_II_3_040: { edition: "ssrq", label: "SSRQ ZH NF II/3 Nr. 40", url: "https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_040" },
		SSRQ_ZH_NF_II_3_047_1: { edition: "ssrq", label: "SSRQ ZH NF II/3 Nr. 47", url: NR_47 },
		SSRQ_ZH_NF_II_3_047_2: { edition: "ssrq", label: "SSRQ ZH NF II/3 Nr. 47", url: NR_47, witness: true, title: "Fähre" },
	},
	catalog: { "5354900": ["QZH_401"], "1236054": ["SSRQ_ZH_NF_II_3_040", "QZH_401", "fehlt"], "3283081": ["SSRQ_ZH_NF_II_3_047_2"] },
	rm: { RM_1583_0204_0030: ["QZH_401"], RM_1507_0040_0002: ["SSRQ_ZH_NF_II_3_047_2"] },
};

test("Verweise je Katalog-ID und Ratsmanual-Sitzung", () => {
	const idx = indexEditionLinks(data);
	assert.deepEqual(idx.forCatalog(5354900), [
		{ edition: "qzh", id: "QZH_401", label: "QZH_401", url: QZH_401, witness: false, title: "Ratsbeschluss betreffend Verfolgung von Täufern" },
	]);
	// Reihenfolge der Liste, unbekannte Text-IDs fallen weg.
	assert.deepEqual(idx.forCatalog(1236054).map((l) => l.id), ["SSRQ_ZH_NF_II_3_040", "QZH_401"]);
	assert.deepEqual(idx.forDocument("RM_1507_0040_0002"), [
		{ edition: "ssrq", id: "SSRQ_ZH_NF_II_3_047_2", label: "SSRQ ZH NF II/3 Nr. 47", url: NR_47, witness: true, title: "Fähre" },
	]);
	assert.deepEqual(idx.forCatalog(1), []);
	assert.deepEqual(idx.forCatalog(Number.NaN), []);
	assert.deepEqual(idx.forDocument("RM_1491_0019_0024"), []);
	// Keine Prototyp-Schlüssel.
	assert.deepEqual(idx.forDocument("constructor"), []);
	assert.deepEqual(idx.forDocument("__proto__"), []);
});

test("Unlesbare oder fremde Einträge ergeben keine Verweise", () => {
	for (const raw of [null, "x", 42, {}, { texts: [] }, { texts: null, catalog: {} }]) {
		assert.deepEqual(indexEditionLinks(raw).forCatalog(5354900), [], JSON.stringify(raw));
	}
	const bad = indexEditionLinks({
		texts: {
			a: { edition: "bullinger", label: "A", url: "https://example.org/a" },
			b: { edition: "qzh", label: "B", url: "javascript:alert(1)" },
			c: { edition: "qzh", label: "", url: "https://example.org/c" },
			d: { edition: "qzh", label: "D", url: "https://example.org/d" },
		},
		catalog: { "1": ["a", "b", "c", "d"], "2": "d" },
		rm: [],
	});
	assert.deepEqual(bad.forCatalog(1).map((l) => l.id), ["d"]);
	assert.deepEqual(bad.forCatalog(2), []);
	assert.deepEqual(bad.forDocument("0"), []);
});

test("Zusammenführen: jedes Stück einmal, Grundtext vor weiterer Überlieferung", () => {
	const idx = indexEditionLinks(data);
	const witness = idx.forDocument("RM_1507_0040_0002");
	const grund: EditionLink[] = [{ ...witness[0], id: "SSRQ_ZH_NF_II_3_047_1", witness: false, title: null }];
	assert.deepEqual(mergeEditionLinks(witness, grund).map((l) => [l.id, l.witness]), [["SSRQ_ZH_NF_II_3_047_1", false]]);
	assert.deepEqual(mergeEditionLinks(grund, witness).map((l) => l.id), ["SSRQ_ZH_NF_II_3_047_1"]);
	const all = mergeEditionLinks(idx.forCatalog(1236054), idx.forDocument("RM_1583_0204_0030"));
	assert.deepEqual(all.map((l) => l.id), ["SSRQ_ZH_NF_II_3_040", "QZH_401"]);
	assert.deepEqual(editionsOf(all), ["ssrq", "qzh"]);
});

test("Lizenz und Nennung je Edition", () => {
	assert.equal(EDITIONS.qzh.license, "CC BY 4.0");
	assert.equal(EDITIONS.ssrq.license, "CC BY 4.0");
	for (const e of Object.values(EDITIONS)) {
		assert.match(e.licenseUrl, /^https:\/\/creativecommons\.org\/licenses\//);
		assert.ok(e.attribution.includes("Staatsarchiv des Kantons Zürich"));
		assert.ok(!/\u2014/.test(e.attribution + e.name + e.heading), "kein Geviertstrich");
	}
});

test("Die committete Liste ist lesbar und verweist nur auf die beiden Editionen", () => {
	const raw = JSON.parse(readFileSync(new URL("./server/data/edition-links.json", import.meta.url), "utf8"));
	const idx = indexEditionLinks(raw);
	const texts = Object.keys(raw.texts);
	assert.ok(texts.length > 0);
	for (const [id, ids] of Object.entries(raw.catalog as Record<string, string[]>)) {
		assert.match(id, /^\d{1,9}$/);
		assert.equal(idx.forCatalog(Number(id)).length > 0, true, id);
		for (const t of ids) assert.ok(texts.includes(t), t);
	}
	for (const [id, ids] of Object.entries(raw.rm as Record<string, string[]>)) {
		assert.match(id, /^RM_\d{4}_\d{4}[a-z]?_\d{4}$/);
		const links = idx.forDocument(id);
		assert.equal(links.length, ids.length, id);
		// Auf der Sitzung steht, welcher Eintrag ediert ist.
		for (const l of links) assert.ok(l.title, l.id);
	}
	for (const t of Object.values(raw.texts as EditionLinksData["texts"])) {
		assert.ok(t.url.startsWith(EDITIONS[t.edition].home + "/"), t.url);
	}
});

test("Die committete Liste: Vorlagen in anderen Archiven ergeben keine Katalog-Verweise", () => {
	// Die Rechtsquellen verweisen bei Vorlagen im Stadtarchiv Zürich bzw. im Stiftsarchiv St. Gallen
	// auf deren Kataloge mit eigenen IDs (Stadtarchiv 528718 ist im Staatsarchiv ein RRB von 1833).
	const raw = JSON.parse(readFileSync(new URL("./server/data/edition-links.json", import.meta.url), "utf8"));
	const foreign = new Set(["SSRQ_ZH_NF_II_3_036", "SSRQ_ZH_NF_II_3_015", "SSRQ_ZH_NF_II_3_001_1"]);
	for (const [id, ids] of Object.entries(raw.catalog as Record<string, string[]>)) {
		for (const t of ids) assert.ok(!foreign.has(t), `${id}: ${t}`);
	}
});

test("Umkehrung: Ratsmanual-Sitzungen je Stück (Detailseite der Editionen)", () => {
	const idx = indexEditionLinks(data);
	assert.deepEqual(idx.documentsFor("QZH_401"), ["RM_1583_0204_0030"]);
	assert.deepEqual(idx.documentsFor("SSRQ_ZH_NF_II_3_047_2"), ["RM_1507_0040_0002"]);
	assert.deepEqual(idx.documentsFor("unbekannt"), []);
	assert.deepEqual(indexEditionLinks(null).documentsFor("QZH_401"), []);
});

test("Register: jede Edition mit Kurzname und Lizenz; QZH mit Bildrechten und Rohdaten", () => {
	for (const info of Object.values(EDITIONS)) {
		assert.ok(info.short && info.license && info.licenseUrl.startsWith("https://"));
	}
	assert.equal(EDITIONS.qzh.short, "QZH");
	assert.equal(EDITIONS.qzh.images?.label, "gemeinfrei");
	assert.equal(EDITIONS.qzh.repo, "https://github.com/stazh/qzh-data");
});
