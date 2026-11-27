// Lauf: npx tsx --test src/lib/server/browseLimit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { CORPUS_CAP } from "$lib/types";
import { BROWSE_LIMIT, beyondBrowseLimit, browseLimitOf, browseWindow, pageWithin, type PageParams } from "./browseLimit";

test("BROWSE_LIMIT: derselbe Deckel wie die zweistufigen Pfade", () => {
	assert.equal(BROWSE_LIMIT, CORPUS_CAP);
	assert.equal(BROWSE_LIMIT, 10_000);
});

test("beyondBrowseLimit: die letzte Seite vor dem Deckel gehört dazu", () => {
	assert.equal(beyondBrowseLimit({ page: 1, pageSize: 20 }), false);
	assert.equal(beyondBrowseLimit({ page: 500, pageSize: 20 }), false); // Treffer 9'981–10'000
	assert.equal(beyondBrowseLimit({ page: 501, pageSize: 20 }), true);
	assert.equal(beyondBrowseLimit({ page: 100, pageSize: 100 }), false);
	assert.equal(beyondBrowseLimit({ page: 101, pageSize: 100 }), true);
	assert.equal(beyondBrowseLimit({ page: 10_000, pageSize: 1 }), false);
	assert.equal(beyondBrowseLimit({ page: 10_001, pageSize: 1 }), true);
	// Geht die Seitengrösse nicht auf, beginnt die letzte Seite noch davor.
	assert.equal(beyondBrowseLimit({ page: 334, pageSize: 30 }), false); // ab Treffer 9'991
	assert.equal(beyondBrowseLimit({ page: 335, pageSize: 30 }), true);
	// Höchste Seite aus der Adresse.
	assert.equal(beyondBrowseLimit({ page: 1_000_000, pageSize: 100 }), true);
	// Eigene Grenze (gereihte IDs einer zweistufigen Suche).
	assert.equal(beyondBrowseLimit({ page: 16, pageSize: 20 }, 300), true);
	assert.equal(beyondBrowseLimit({ page: 15, pageSize: 20 }, 300), false);
});

test("browseWindow: Fenster der Seite, hinter dem Deckel keine Treffer", () => {
	assert.deepEqual(browseWindow({ page: 1, pageSize: 20 }), { offset: 0, limit: 20 });
	assert.deepEqual(browseWindow({ page: 3, pageSize: 50 }), { offset: 100, limit: 50 });
	assert.deepEqual(browseWindow({ page: 500, pageSize: 20 }), { offset: 9_980, limit: 20 });
	// limit 0 ab Offset 0: Meili liefert nur Trefferzahl und Facetten.
	assert.deepEqual(browseWindow({ page: 501, pageSize: 20 }), { offset: 0, limit: 0 });
	assert.deepEqual(browseWindow({ page: 1_000_000, pageSize: 100 }), { offset: 0, limit: 0 });
	// Nie eine Abfrage hinter dem Deckel.
	for (const pageSize of [1, 7, 20, 30, 50, 100]) {
		for (const page of [1, 2, 99, 100, 101, 333, 334, 335, 500, 501, 10_000, 10_001, 63_183, 1_000_000]) {
			const { offset, limit } = browseWindow({ page, pageSize });
			assert.ok(limit === 0 || offset < BROWSE_LIMIT, `Seite ${page} à ${pageSize}`);
			assert.ok(offset + limit < BROWSE_LIMIT + pageSize, `Seite ${page} à ${pageSize}`);
		}
	}
});

test("browseLimitOf: nur, wenn die Liste vor dem letzten Treffer endet", () => {
	assert.deepEqual(browseLimitOf(0), {});
	assert.deepEqual(browseLimitOf(10_000), {});
	assert.deepEqual(browseLimitOf(10_001), { browseLimit: 10_000 });
	assert.deepEqual(browseLimitOf(1_263_651), { browseLimit: 10_000 });
});

test("pageWithin: vor der Grenze die Seite selbst, dahinter nur Zahlen ab Treffer 1", async () => {
	const calls: PageParams[] = [];
	const run = async (p: PageParams & { q: string }) => {
		calls.push({ page: p.page, pageSize: p.pageSize });
		return { hits: [`${p.q} ${p.page}`], page: p.page, pageSize: p.pageSize, total: 12_345, facets: { series: 2 } };
	};
	assert.deepEqual(await pageWithin({ q: "x", page: 500, pageSize: 20 }, BROWSE_LIMIT, run), {
		hits: ["x 500"],
		page: 500,
		pageSize: 20,
		total: 12_345,
		facets: { series: 2 },
	});
	assert.deepEqual(await pageWithin({ q: "x", page: 63_183, pageSize: 20 }, BROWSE_LIMIT, run), {
		hits: [],
		page: 63_183,
		pageSize: 20,
		total: 12_345,
		facets: { series: 2 },
	});
	// Hinter den gereihten IDs einer zweistufigen Suche ebenso; der Export (Seite 1) immer davor.
	assert.deepEqual((await pageWithin({ q: "x", page: 2, pageSize: 20 }, 7, run)).hits, []);
	assert.deepEqual((await pageWithin({ q: "x", page: 1, pageSize: 100_000 }, 7, run)).hits, ["x 1"]);
	assert.deepEqual(calls, [
		{ page: 500, pageSize: 20 },
		{ page: 1, pageSize: 1 },
		{ page: 1, pageSize: 1 },
		{ page: 1, pageSize: 100_000 },
	]);
});
