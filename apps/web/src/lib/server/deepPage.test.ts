// Lauf: npx tsx --test src/lib/server/deepPage.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { DEEP_PAGE_MIN_OFFSET, idsOnly, inPageOrder, isDeepPage, pageOnly, searchDeepPage, type PageId, formatGroups, formatInGroups, wantsFormat } from "./deepPage";

test("isDeepPage: ab DEEP_PAGE_MIN_OFFSET, die ersten Seiten bleiben eine Abfrage", () => {
	assert.equal(DEEP_PAGE_MIN_OFFSET, 40);
	assert.equal(isDeepPage(0, 20), false);
	assert.equal(isDeepPage(20, 20), false); // Seite 2 à 20
	assert.equal(isDeepPage(40, 20), true); // Seite 3 à 20
	assert.equal(isDeepPage(0, 100), false); // Seite 1 à 100
	assert.equal(isDeepPage(100, 100), true);
	assert.equal(isDeepPage(0, 1000), false); // grosses Fenster ab Treffer 1: alles wird ohnehin formatiert
	assert.equal(isDeepPage(5000, 0), false);
});

const BODY = {
	q: "fisch",
	offset: 400,
	limit: 20,
	filter: ["series IN ['KRP']"],
	facets: ["series", "dateYear"],
	sort: ["date:asc"],
	matchingStrategy: "all",
	attributesToSearchOn: ["title"],
	attributesToRetrieve: ["id", "title", "body"],
	attributesToHighlight: ["title", "body"],
	attributesToCrop: ["body"],
	cropLength: 30,
	cropMarker: "…",
	highlightPreTag: '<mark class="match">',
	highlightPostTag: "</mark>",
	showMatchesPosition: false,
	showRankingScore: true,
	retrieveVectors: true,
};

test("idsOnly: Fenster, Filter, Facetten, Sortierung, Suche und Score bleiben, nur `id`, ohne Formatierung", () => {
	const before = JSON.stringify(BODY);
	assert.deepEqual(idsOnly(BODY), {
		q: "fisch",
		offset: 400,
		limit: 20,
		filter: ["series IN ['KRP']"],
		facets: ["series", "dateYear"],
		sort: ["date:asc"],
		matchingStrategy: "all",
		attributesToSearchOn: ["title"],
		showRankingScore: true,
		attributesToRetrieve: ["id"],
	});
	// Vektor bleibt: Stufe 1 ist dieselbe (Hybrid-)Suche.
	assert.deepEqual(idsOnly({ q: "x", hybrid: { embedder: "jina_de", semanticRatio: 0.7 }, vector: [1, 2] }), {
		q: "x",
		hybrid: { embedder: "jina_de", semanticRatio: 0.7 },
		vector: [1, 2],
		attributesToRetrieve: ["id"],
	});
	assert.equal(JSON.stringify(BODY), before);
});

test("pageOnly: Suche, Felder, Formatierung und Score der Abfrage, Filter auf die IDs, ohne Fenster, Facetten, Sortierung", () => {
	const before = JSON.stringify(BODY);
	assert.deepEqual(pageOnly(BODY, ["id IN ['a', 'b']"], 2), {
		q: "fisch",
		matchingStrategy: "all",
		attributesToSearchOn: ["title"],
		attributesToRetrieve: ["id", "title", "body"],
		attributesToHighlight: ["title", "body"],
		attributesToCrop: ["body"],
		cropLength: 30,
		cropMarker: "…",
		highlightPreTag: '<mark class="match">',
		highlightPostTag: "</mark>",
		showMatchesPosition: false,
		showRankingScore: true,
		retrieveVectors: true,
		filter: ["id IN ['a', 'b']"],
		offset: 0,
		limit: 2,
	});
	assert.deepEqual(pageOnly({ q: "", page: 3, hitsPerPage: 20, filter: "onPlatform = false" }, "id IN [1, 2]", 2), {
		q: "",
		filter: "id IN [1, 2]",
		offset: 0,
		limit: 2,
	});
	// Thema: der Vektor bleibt (gleiche Hervorhebung und Auszüge, auch für reine Vektor-Treffer).
	assert.deepEqual(pageOnly({ q: "x", hybrid: { embedder: "jina_de", semanticRatio: 0.7 }, vector: [1, 2], offset: 60, limit: 20, facets: [] }, ["id IN ['a']"], 1), {
		q: "x",
		hybrid: { embedder: "jina_de", semanticRatio: 0.7 },
		vector: [1, 2],
		filter: ["id IN ['a']"],
		offset: 0,
		limit: 1,
	});
	assert.equal(JSON.stringify(BODY), before);
});

test("inPageOrder: Reihenfolge und Reihungs-Angaben aus Stufe 1, Felder aus Stufe 2, Schlüssel an ihrem Platz", () => {
	const order = [
		{ id: "b", _rankingScore: 0.9, _federation: { indexUid: "documents", queriesPosition: 1, weightedRankingScore: 0.9 } },
		{ id: "x", _rankingScore: 0.8 },
		{ id: "a", _rankingScore: 0.7 },
	];
	const formatted = [
		{ id: "a", title: "A", _formatted: { title: "<em>A</em>" }, _rankingScore: 0.69 },
		{ id: "b", title: "B", _formatted: { title: "B" }, _rankingScore: 0.9, _federation: { indexUid: "documents", queriesPosition: 1, weightedRankingScore: 0.9 } },
	];
	const page = inPageOrder(order, formatted);
	// «x» fehlt in Stufe 2 (Index dazwischen geändert): kürzere Seite.
	assert.equal(
		JSON.stringify(page),
		JSON.stringify([
			{ id: "b", title: "B", _formatted: { title: "B" }, _rankingScore: 0.9, _federation: { indexUid: "documents", queriesPosition: 1, weightedRankingScore: 0.9 } },
			{ id: "a", title: "A", _formatted: { title: "<em>A</em>" }, _rankingScore: 0.7 },
		]),
	);
	// Ohne Score in Stufe 1 bleibt der von Stufe 2; ohne Score in Stufe 2 kommt er dazu (am Ende).
	assert.deepEqual(inPageOrder([{ id: 1 }], [{ id: 1, t: "x", _rankingScore: 0.5 }]), [{ id: 1, t: "x", _rankingScore: 0.5 }]);
	assert.equal(JSON.stringify(inPageOrder([{ id: 1, _rankingScore: 0.4 }], [{ id: 1, t: "x" }])), JSON.stringify([{ id: 1, t: "x", _rankingScore: 0.4 }]));
});

test("searchDeepPage: Antwort von Stufe 1 mit den formatierten Treffern, Dauer beider Abfragen", async () => {
	const calls: PageId[][] = [];
	const res = await searchDeepPage({
		ids: async () => ({
			hits: [{ id: 3 }, { id: 1 }],
			estimatedTotalHits: 1234,
			facetDistribution: { level: { Dossier: 2 } },
			semanticHitCount: 1,
			processingTimeMs: 7,
		}),
		format: async (ids) => {
			calls.push(ids);
			return { hits: [{ id: 1, t: "eins" }, { id: 3, t: "drei" }], processingTimeMs: 2 };
		},
	});
	assert.deepEqual(calls, [[3, 1]]);
	assert.deepEqual(res, {
		hits: [{ id: 3, t: "drei" }, { id: 1, t: "eins" }],
		estimatedTotalHits: 1234,
		facetDistribution: { level: { Dossier: 2 } },
		semanticHitCount: 1,
		processingTimeMs: 9,
	});
});

test("searchDeepPage: leere Seite ⇒ keine zweite Abfrage", async () => {
	let formatted = 0;
	const res = await searchDeepPage({
		ids: async () => ({ hits: [], estimatedTotalHits: 50, processingTimeMs: 3 }),
		format: async () => {
			formatted++;
			return { hits: [] };
		},
	});
	assert.equal(formatted, 0);
	assert.deepEqual(res, { hits: [], estimatedTotalHits: 50, processingTimeMs: 3 });
});

// Eine Attrappe von Meilis Suche: Treffer nach Score, Filter `id IN […]`, Fenster, Felder,
// Formatierung und Score wie bei Meili (nur die Seite wird «gemacht»). Zweistufig muss
// dieselbe Antwort herauskommen wie eine Abfrage.
interface Doc {
	id: string;
	title: string;
	body: string;
	score: number;
}
const DOCS: Doc[] = Array.from({ length: 260 }, (_, i) => ({
	id: `d${String(i).padStart(3, "0")}`,
	title: `Titel ${i}`,
	body: `Text ${i} über Fische`,
	score: 1 - ((i * 37) % 260) / 1000,
}));
function fakeSearch(body: Record<string, unknown>) {
	const filter = (Array.isArray(body.filter) ? body.filter : [body.filter]).filter(Boolean) as string[];
	const idClause = filter.find((f) => f.startsWith("id IN ["));
	const allowed = idClause ? new Set([...idClause.matchAll(/'([^']+)'/g)].map((m) => m[1])) : null;
	const ranked = DOCS.filter((d) => !allowed || allowed.has(d.id)).sort((a, b) => b.score - a.score);
	const offset = Number(body.offset ?? 0);
	const limit = Number(body.limit ?? 20);
	const retrieve = (body.attributesToRetrieve as string[] | undefined) ?? ["id", "title", "body"];
	const highlight = (body.attributesToHighlight as string[] | undefined) ?? [];
	const crop = (body.attributesToCrop as string[] | undefined) ?? [];
	const hits = ranked.slice(offset, offset + limit).map((d) => {
		const hit: Record<string, unknown> = {};
		for (const f of retrieve) hit[f] = d[f as keyof Doc];
		if (highlight.length > 0 || crop.length > 0) {
			hit._formatted = Object.fromEntries(
				retrieve.map((f) => {
					let v = String(d[f as keyof Doc]);
					if (highlight.includes(f)) v = v.replace("Fische", `${body.highlightPreTag}Fische${body.highlightPostTag}`);
					if (crop.includes(f)) v = v.slice(0, Number(body.cropLength ?? 10));
					return [f, v];
				}),
			);
		}
		if (body.showRankingScore) hit._rankingScore = d.score;
		return hit as { id: string };
	});
	return { hits, estimatedTotalHits: ranked.length, processingTimeMs: 1, facetDistribution: body.facets ? { series: { KRP: ranked.length } } : undefined };
}

test("searchDeepPage mit idsOnly/pageOnly = eine Abfrage (Attrappe), an jeder Stelle", async () => {
	const body = {
		q: "fisch",
		limit: 20,
		facets: ["series"],
		matchingStrategy: "all",
		attributesToHighlight: ["title", "body"],
		attributesToCrop: ["body"],
		cropLength: 12,
		highlightPreTag: "<mark>",
		highlightPostTag: "</mark>",
		showRankingScore: true,
	};
	for (const offset of [100, 120, 240, 250, 260, 300]) {
		const single = fakeSearch({ ...body, offset });
		const deep = await searchDeepPage({
			ids: async () => fakeSearch(idsOnly({ ...body, offset })),
			format: async (ids) => fakeSearch(pageOnly({ ...body, offset }, [`id IN [${ids.map((id) => `'${id}'`).join(", ")}]`], ids.length)),
		});
		assert.equal(JSON.stringify({ ...deep, processingTimeMs: 1 }), JSON.stringify(single), `Offset ${offset}`);
	}
});

test("formatGroups: höchstens vier Gruppen, reihum verteilt, keine unter zwei", () => {
	assert.deepEqual(formatGroups([1]), [[1]]);
	assert.deepEqual(formatGroups([1, 2]), [[1, 2]]);
	assert.deepEqual(formatGroups([1, 2, 3, 4, 5]), [[1, 4], [2, 5], [3]]);
	const twenty = formatGroups(Array.from({ length: 20 }, (_, i) => i));
	assert.equal(twenty.length, 4);
	assert.deepEqual(twenty[0], [0, 4, 8, 12, 16]);
	assert.deepEqual(twenty.flat().sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
});

test("formatInGroups: alle Gruppen gleichzeitig, die Dauer ist die der längsten", async () => {
	let running = 0;
	let most = 0;
	const res = await formatInGroups(["a", "b", "c", "d", "e", "f"], async (group) => {
		most = Math.max(most, ++running);
		await new Promise((r) => setTimeout(r, 5));
		running--;
		return { hits: group.map((id) => ({ id })), processingTimeMs: group.includes("b") ? 40 : 3 };
	});
	assert.equal(most, 3);
	assert.equal(res.processingTimeMs, 40);
	assert.deepEqual(res.hits.map((h) => h.id).sort(), ["a", "b", "c", "d", "e", "f"]);
	assert.deepEqual(await formatInGroups([], async () => assert.fail("keine Abfrage")), { hits: [], processingTimeMs: 0 });
	await assert.rejects(formatInGroups(["a", "b", "c"], async () => Promise.reject(new Error("Meili 503"))), /503/);
});

test("wantsFormat: Hervorhebung oder Auszug verlangt", () => {
	assert.equal(wantsFormat({ q: "x" }), false);
	assert.equal(wantsFormat({ attributesToHighlight: [], attributesToCrop: [] }), false);
	assert.equal(wantsFormat({ attributesToHighlight: ["title"] }), true);
	assert.equal(wantsFormat({ attributesToCrop: ["body"] }), true);
});
