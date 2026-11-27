// Lauf: npx tsx --test src/lib/server/vectorCutoff.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	CHUNK_BUDGET_MS,
	CHUNK_CUTOFF_MS,
	SEARCH_CUTOFF_MS,
	cutShort,
	rankedHits,
	searchTwice,
	searchVectors,
	vectorArmLost,
	type VectorResult,
} from "./vectorCutoff";

type Hit = { id: string; _rankingScore?: number };

function hits(...scores: number[]): Hit[] {
	return scores.map((s, i) => ({ id: `h${i}`, _rankingScore: s }));
}

test("CHUNK_CUTOFF_MS: gleich der Einstellung des Index (services/indexer), das Budget ist länger", () => {
	const source = readFileSync(new URL("../../../../../services/indexer/src/meili.ts", import.meta.url), "utf8");
	const settings = /CHUNK_INDEX_SETTINGS: Settings = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
	const cutoff = /searchCutoffMs: ([\d_]+)/.exec(settings)?.[1];
	assert.equal(Number(cutoff?.replaceAll("_", "")), CHUNK_CUTOFF_MS);
	assert.ok(CHUNK_BUDGET_MS > CHUNK_CUTOFF_MS);
});

test("SEARCH_CUTOFF_MS: gleich der Einstellung der Indizes documents und catalog", () => {
	for (const [file, name] of [
		["../../../../../services/indexer/src/meili.ts", "INDEX_SETTINGS"],
		["../../../../../services/catalog/src/settings.ts", "CATALOG_INDEX_SETTINGS"],
	] as const) {
		const source = readFileSync(new URL(file, import.meta.url), "utf8");
		const settings = new RegExp(`const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`).exec(source)?.[1] ?? "";
		const cutoff = /searchCutoffMs: ([\d_]+)/.exec(settings)?.[1];
		assert.equal(Number(cutoff?.replaceAll("_", "")), SEARCH_CUTOFF_MS, name);
	}
});

test("searchTwice: an der Frist abgebrochen ⇒ noch einmal, erst eine zweite Frist gilt als Abbruch", async () => {
	const run = (times: number[]) => {
		let i = 0;
		return async () => ({ hits: [`Lauf ${i + 1}`], processingTimeMs: times[i++] });
	};
	const warnings: string[] = [];
	const warn = (m: string) => void warnings.push(m);
	assert.deepEqual(await searchTwice(run([40]), "documents", warn), { result: { hits: ["Lauf 1"], processingTimeMs: 40 }, cut: false });
	assert.deepEqual(warnings, []);
	assert.deepEqual(await searchTwice(run([10_002, 900]), "documents", warn), { result: { hits: ["Lauf 2"], processingTimeMs: 900 }, cut: false });
	assert.equal(warnings.length, 1);
	assert.equal((await searchTwice(run([10_002, 10_001]), "documents", warn)).cut, true);
});

test("rankedHits: was Meili nicht gereiht hat (Score 0), fällt weg, der Rest bleibt in Reihenfolge", () => {
	const input: Hit[] = [...hits(0.7, 0, 0.5), { id: "ohne" }];
	assert.deepEqual(
		rankedHits(input).map((h) => h.id),
		["h0", "h2", "ohne"],
	);
});

test("vectorArmLost: semanticHitCount 0 bei Treffern ⇒ verloren (Stichwort-Arm füllte alles)", () => {
	assert.equal(vectorArmLost({ hits: hits(0.9, 0.8), semanticHitCount: 0 }), true);
});

test("vectorArmLost: Score 0 in den Treffern ⇒ verloren (ungerankte Auffüllung)", () => {
	assert.equal(vectorArmLost({ hits: hits(0.9, 0, 0), semanticHitCount: 2 }), true);
	// Reine Vektorsuche: Meili meldet semanticHitCount = Trefferzahl, auch ungerankt.
	assert.equal(vectorArmLost({ hits: hits(0, 0), semanticHitCount: 2 }), true);
});

test("vectorArmLost: intakte Hybrid-Suche, fehlender Zähler oder keine Treffer ⇒ nicht verloren", () => {
	assert.equal(vectorArmLost({ hits: hits(0.81, 0.8), semanticHitCount: 2 }), false);
	assert.equal(vectorArmLost({ hits: hits(0.81, 0.8) }), false);
	assert.equal(vectorArmLost({ hits: [], semanticHitCount: 0 }), false);
});

test("cutShort: die Teilliste einer abgebrochenen Suche verrät nur die Dauer (Befund Prod 2026-11-24)", () => {
	// Normale Scores, voller Zähler – 20 von 20 Treffern, aber ohne die gesuchte Passage.
	const teil = { hits: hits(0.92, 0.9, 0.88), semanticHitCount: 3 };
	assert.equal(cutShort({ ...teil, processingTimeMs: 1_506 }, 1_500), true);
	assert.equal(cutShort({ ...teil, processingTimeMs: 1_499 }, 1_500), false);
	assert.equal(cutShort({ ...teil, processingTimeMs: CHUNK_CUTOFF_MS }), true);
	assert.equal(cutShort({ ...teil, processingTimeMs: CHUNK_CUTOFF_MS - 1 }), false);
	assert.equal(cutShort(teil), false);
	// Der verlorene Vektor-Arm zählt unabhängig von der Dauer.
	assert.equal(cutShort({ hits: hits(0.4), semanticHitCount: 0, processingTimeMs: 12 }), true);
});

// Deps-Fake: zählt die Aufrufe, liefert vorgegebene Ergebnisse. "timeout" simuliert das
// abgelaufene Budget (Signal abgebrochen + Abbruch-Fehler wie bei fetch), ein Error-Objekt
// einen echten Fehler.
type Answer = VectorResult<Hit> | "timeout" | Error;
function fakeDeps(opts: { search: Answer; vectorOnly?: Answer; keywordOnly?: VectorResult<Hit> }) {
	const calls = { search: 0, vectorOnly: 0, keywordOnly: 0 };
	const budgets: number[] = [];
	const warnings: string[] = [];
	let last = new AbortController();
	const answer = async (r: Answer | undefined) => {
		if (r === undefined) throw new Error("unerwarteter Aufruf");
		if (r === "timeout") {
			last.abort();
			throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
		}
		if (r instanceof Error) throw r;
		return r;
	};
	const deps = {
		budget: (ms: number) => {
			budgets.push(ms);
			last = new AbortController();
			return last.signal;
		},
		search: () => (calls.search++, answer(opts.search)),
		vectorOnly: () => (calls.vectorOnly++, answer(opts.vectorOnly)),
		...(opts.keywordOnly
			? {
					keywordOnly: async () => {
						calls.keywordOnly++;
						return opts.keywordOnly!;
					},
				}
			: {}),
		warn: (m: string) => warnings.push(m),
	};
	return { deps, calls, budgets, warnings };
}
const ids = (r: { hits: Hit[] }) => r.hits.map((h) => h.id);

test("searchVectors: fertige Suche ⇒ ihr Ergebnis, nichts nachgeholt", async () => {
	const { deps, calls, warnings } = fakeDeps({ search: { hits: hits(0.82, 0.8), semanticHitCount: 2, processingTimeMs: 150 } });
	const r = await searchVectors(deps);
	assert.deepEqual([r.outcome, r.partial, ids(r)], ["complete", false, ["h0", "h1"]]);
	assert.deepEqual(calls, { search: 1, vectorOnly: 0, keywordOnly: 0 });
	assert.deepEqual(warnings, []);
});

test("searchVectors: am Cutoff abgebrochen ⇒ warme Vektorsuche nachgeholt, vollständig", async () => {
	const { deps, calls, budgets, warnings } = fakeDeps({
		search: { hits: hits(0.92, 0.9), semanticHitCount: 2, processingTimeMs: CHUNK_CUTOFF_MS + 6 },
		vectorOnly: { hits: [{ id: "gesucht", _rankingScore: 1 }], semanticHitCount: 1, processingTimeMs: 156 },
	});
	const r = await searchVectors(deps);
	assert.deepEqual([r.outcome, r.partial, ids(r)], ["retried", false, ["gesucht"]]);
	assert.deepEqual(calls, { search: 1, vectorOnly: 1, keywordOnly: 0 });
	assert.deepEqual(budgets, [CHUNK_BUDGET_MS, CHUNK_BUDGET_MS]);
	assert.match(warnings[0], /Vektorsuche abgebrochen \(10006 ms\) – in \d+ ms nachgeholt/);
});

test("searchVectors: auch das Nachholen abgebrochen ⇒ sein gerankter Teil, als unvollständig gekennzeichnet", async () => {
	const { deps, warnings } = fakeDeps({
		search: { hits: hits(0.9), semanticHitCount: 1, processingTimeMs: CHUNK_CUTOFF_MS },
		vectorOnly: { hits: [{ id: "naeher", _rankingScore: 0.95 }, { id: "rest", _rankingScore: 0 }], semanticHitCount: 2, processingTimeMs: CHUNK_CUTOFF_MS },
	});
	const r = await searchVectors(deps);
	assert.deepEqual([r.outcome, r.partial, ids(r)], ["partial", true, ["naeher"]]);
	assert.match(warnings[0], /Nachholen unvollständig \(wieder abgebrochen, \d+ ms\)/);
});

test("searchVectors: Nachholen ohne Treffer, über Budget oder mit Fehler ⇒ der Teil der ersten Suche, ohne Auffüllung", async () => {
	for (const vectorOnly of ["timeout", new Error("Meili 502"), { hits: hits(0, 0), semanticHitCount: 2 }] as const) {
		const { deps } = fakeDeps({ search: { hits: hits(0.5, 0.4, 0), semanticHitCount: 0 }, vectorOnly });
		const r = await searchVectors(deps);
		assert.deepEqual([r.outcome, r.partial, ids(r)], ["partial", true, ["h0", "h1"]]);
	}
});

test("searchVectors: keine Antwort im Budget ⇒ Stichwort-Suche, als unvollständig gekennzeichnet", async () => {
	const { deps, calls, warnings } = fakeDeps({ search: "timeout", keywordOnly: { hits: hits(0.6, 0.5, 0) } });
	const r = await searchVectors(deps);
	assert.deepEqual([r.outcome, r.partial, ids(r)], ["keyword", true, ["h0", "h1"]]);
	assert.deepEqual(calls, { search: 1, vectorOnly: 0, keywordOnly: 1 });
	assert.deepEqual(warnings, [`[chunks] Suche über ${CHUNK_BUDGET_MS} ms – Stichwort-Reihung`]);
});

test("searchVectors: reine Vektorsuche ohne Antwort bzw. echter Fehler ⇒ Fehler an den Aufrufer", async () => {
	await assert.rejects(searchVectors(fakeDeps({ search: "timeout" }).deps), /timeout/);
	const { deps, calls } = fakeDeps({ search: new Error("Meili 400"), keywordOnly: { hits: [] } });
	await assert.rejects(searchVectors(deps), /Meili 400/);
	assert.deepEqual(calls, { search: 1, vectorOnly: 0, keywordOnly: 0 });
});
