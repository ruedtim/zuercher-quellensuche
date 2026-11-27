// Lauf: npx tsx --test src/lib/server/themeOrder.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
	THEME_LIST_MAX,
	cachedOrder,
	themeOrderAlone,
	themeOrderWithin,
	vectorWindow,
	type Ranked,
	type ThemeOrder,
	type ThemeWithinDeps,
} from "./themeOrder";

// Ein Korpus nach Ähnlichkeit: n0 ist dem Thema am nächsten.
const corpus = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`);
const ranked = (ids: readonly string[]): Ranked<string>[] => ids.map((id) => ({ id, score: 1 - Number(id.slice(1)) / 1e6 }));
const ids = (o: ThemeOrder<string>) => o.hits.map((h) => h.id);

const WIDE = { max: THEME_LIST_MAX, narrow: false };

function aloneDeps(n: number, rest: string[] = []) {
	const calls: string[] = [];
	return {
		calls,
		nearest: async (k: number) => {
			calls.push(`nearest ${k}`);
			return ranked(corpus(n).slice(0, k));
		},
		rest: async (limit: number) => {
			calls.push(`rest ${limit}`);
			return rest.slice(0, limit).map((id) => ({ id, score: 0 }));
		},
	};
}

test("vectorWindow: breiter als gezeigt, stufenweise bis zur ganzen Liste; darüber so breit wie nötig", () => {
	assert.equal(vectorWindow(5), 75);
	assert.equal(vectorWindow(60), 75);
	assert.equal(vectorWindow(61), 200);
	assert.equal(vectorWindow(140), 200);
	assert.equal(vectorWindow(300), 300);
	assert.equal(vectorWindow(301), THEME_LIST_MAX);
	assert.equal(vectorWindow(10_000), 10_000);
	// Enge Auswahl: Meili sucht von sich aus breiter, das Fenster bleibt klein.
	assert.equal(vectorWindow(5, true), 25);
	assert.equal(vectorWindow(26, true), 50);
	assert.equal(vectorWindow(51, true), 100);
	assert.equal(vectorWindow(101, true), 300);
	assert.equal(vectorWindow(301, true), THEME_LIST_MAX);
});

test("Thema allein: eine Seite kostet eine Vektorsuche, der Rest nur am Ende der Liste", async () => {
	const d = aloneDeps(5_000, ["r0"]);
	const o = await themeOrderAlone(null, 20, WIDE, d);
	assert.deepEqual(d.calls, ["nearest 75"]);
	assert.equal(o.hits.length, 75);
	assert.equal(o.ranked, 75);
	assert.equal(o.complete, false);
	// Was schon verlangt war, ohne Abfrage, ebenso die Seiten 2 und 3; dann aus einem breiteren Fenster.
	assert.equal(await themeOrderAlone(o, 20, WIDE, d), o);
	const third = await themeOrderAlone(o, 60, WIDE, d);
	assert.deepEqual(d.calls, ["nearest 75"]);
	assert.equal(third.shown, 60);
	const more = await themeOrderAlone(third, 80, WIDE, d);
	assert.deepEqual(d.calls, ["nearest 75", "nearest 200"]);
	const again = await themeOrderAlone(more, 140, WIDE, d);
	assert.equal(d.calls.length, 2);
	assert.equal(again.shown, 140);
});

test("Thema allein: «Alle Quellen» und danach der Reiter kosten eine Vektorsuche, auch bei enger Auswahl bleiben die fünf vorn", async () => {
	const d = aloneDeps(5_000);
	const five = await themeOrderAlone(null, 5, WIDE, d);
	await themeOrderAlone(five, 20, WIDE, d);
	assert.deepEqual(d.calls, ["nearest 75"]);
	const NARROW = { max: THEME_LIST_MAX, narrow: true };
	const n = await themeOrderAlone(null, 25, NARROW, { ...d, nearest: async () => ranked(corpus(26).filter((x) => x !== "n2")) });
	const more = await themeOrderAlone(n, 50, NARROW, d);
	assert.deepEqual(ids(more).slice(0, 4), ["n0", "n1", "n3", "n4"]);
	assert.equal(ids(more)[25], "n2");
});

test("Thema allein: wächst die Liste, behalten die gezeigten Plätze ihren Ort, der Rest kommt aus dem breiteren Fenster", async () => {
	const d = aloneDeps(5_000);
	// Das schmale Fenster hat n3 übersehen und n99 zu früh.
	const narrow = ranked([...corpus(75).filter((x) => x !== "n3"), "n120"]);
	const first = await themeOrderAlone(null, 20, WIDE, { ...d, nearest: async () => narrow });
	const wide = await themeOrderAlone(first, 80, WIDE, d);
	assert.deepEqual(d.calls, ["nearest 200"]);
	assert.deepEqual(ids(wide).slice(0, 20), ids(first).slice(0, 20));
	// Danach die genaue Folge, samt dem übersehenen Treffer, ohne Doppelte.
	assert.equal(ids(wide)[20], "n3");
	assert.equal(new Set(ids(wide)).size, wide.hits.length);
	assert.ok(ids(wide).includes("n120"));
});

test("Thema allein: alle mit Vektor gesehen ⇒ der Rest schliesst an, die Liste ist vollständig", async () => {
	const d = aloneDeps(30, ["r0", "r1"]);
	const o = await themeOrderAlone(null, 20, WIDE, d);
	assert.deepEqual(d.calls, ["nearest 75", `nearest ${THEME_LIST_MAX}`, `rest ${THEME_LIST_MAX - 30}`]);
	assert.deepEqual(ids(o).slice(-2), ["r0", "r1"]);
	assert.equal(o.ranked, 30);
	assert.equal(o.complete, true);
	// Auch weit hinten keine weitere Abfrage.
	assert.equal(await themeOrderAlone(o, 900, WIDE, d).then((x) => x.hits.length), 32);
	assert.equal(d.calls.length, 3);
});

test("Thema allein: die Höchstlänge gilt, im Export reicht das Fenster so weit wie verlangt", async () => {
	const d = aloneDeps(5_000, ["r0"]);
	const o = await themeOrderAlone(null, 5_000, WIDE, d);
	assert.equal(o.hits.length, THEME_LIST_MAX);
	assert.equal(o.complete, true);
	const e = aloneDeps(50_000);
	const x = await themeOrderAlone(null, 10_000, { max: 10_000, narrow: false }, e);
	assert.deepEqual(e.calls, ["nearest 10000"]);
	assert.equal(x.hits.length, 10_000);
});

/** `word(id)`: enthält das Dokument das Wort? */
function withinDeps(n: number, word: (i: number) => boolean, rest: string[] = []) {
	const calls: string[] = [];
	const all = corpus(n);
	const deps: ThemeWithinDeps<string> = {
		nearest: async (k, within) => {
			calls.push(within ? `nearest ${k} in ${within.length}` : `nearest ${k}`);
			const set = within ? new Set(within) : null;
			return ranked((set ? all.filter((x) => set.has(x)) : all).slice(0, k));
		},
		match: async (list) => {
			calls.push(`match ${list.length}`);
			return list.filter((x) => word(Number(x.slice(1))));
		},
		candidates: async (limit) => {
			calls.push(`candidates ${limit}`);
			// In einer anderen Folge als die Ähnlichkeit: die hinteren zuerst.
			return all.filter((x) => word(Number(x.slice(1)))).reverse().slice(0, limit);
		},
		rest: async (limit) => {
			calls.push(`rest ${limit}`);
			return rest.slice(0, limit).map((id) => ({ id, score: 0 }));
		},
	};
	return { calls, deps, hits: all.filter((x) => word(Number(x.slice(1)))) };
}

test("Wort + Thema, wenige Treffer: Meili reiht sie direkt, Treffer ohne Vektor am Ende", async () => {
	const { calls, deps, hits } = withinDeps(10_000, (i) => i % 5 === 0, ["r0"]);
	const o = await themeOrderWithin(null, 20, { withVectors: 2_000, max: THEME_LIST_MAX }, deps);
	assert.deepEqual(calls, ["candidates 2000", `nearest ${THEME_LIST_MAX} in 2000`]);
	assert.deepEqual(ids(o), hits.slice(0, THEME_LIST_MAX));
	assert.equal(o.complete, true);
	const small = withinDeps(1_000, (i) => i < 3, ["r0", "r1"]);
	const s = await themeOrderWithin(null, 20, { withVectors: 3, max: THEME_LIST_MAX }, small.deps);
	assert.deepEqual(ids(s), ["n0", "n1", "n2", "r0", "r1"]);
	assert.equal(s.ranked, 3);
});

test("Wort + Thema, breites Wort: die nächsten 300 und der Abgleich genügen für die erste Seite", async () => {
	const { calls, deps, hits } = withinDeps(100_000, (i) => i % 4 === 0);
	const o = await themeOrderWithin(null, 20, { withVectors: 25_000, max: THEME_LIST_MAX }, deps);
	assert.deepEqual(calls, ["nearest 300", "match 300"]);
	assert.deepEqual(ids(o), hits.slice(0, 75));
	assert.equal(o.complete, false);
	// Seiten 2 und 3 aus derselben Liste, Seite 4 reiht alle Treffer – die kleine Runde läuft nicht nochmals.
	const third = await themeOrderWithin(o, 60, { withVectors: 25_000, max: THEME_LIST_MAX }, deps);
	assert.equal(third.hits.length, 75);
	const more = await themeOrderWithin(third, 80, { withVectors: 25_000, max: THEME_LIST_MAX }, deps);
	assert.deepEqual(calls.slice(2), ["candidates 25000", `nearest ${THEME_LIST_MAX} in 25000`]);
	assert.deepEqual(ids(more), hits.slice(0, THEME_LIST_MAX));
	assert.equal(more.complete, true);
});

test("Wort + Thema, bis 20'000 Treffer: gleich alle gereiht, ohne Runden", async () => {
	const { calls, deps, hits } = withinDeps(80_000, (i) => i % 4 === 0);
	const o = await themeOrderWithin(null, 20, { withVectors: 20_000, max: THEME_LIST_MAX }, deps);
	assert.deepEqual(calls, ["candidates 20000", `nearest ${THEME_LIST_MAX} in 20000`]);
	assert.deepEqual(ids(o), hits.slice(0, THEME_LIST_MAX));
});

test("Wort + Thema: reicht die kleine Runde nicht, kommen bis 50'000 die Treffer selbst, ohne die grosse", async () => {
	// Nur jedes 150. der nächsten enthält das Wort: 2 in 300, zu wenig für 20.
	const { calls, deps, hits } = withinDeps(1_000_000, (i) => i % 150 === 0);
	const o = await themeOrderWithin(null, 20, { withVectors: 30_000, max: THEME_LIST_MAX }, deps);
	assert.deepEqual(calls, ["nearest 300", "match 300", "candidates 30000", `nearest ${THEME_LIST_MAX} in 6667`]);
	assert.deepEqual(ids(o), hits.slice(0, THEME_LIST_MAX));
	assert.equal(o.complete, true);
});

test("Wort + Thema: sehr viele Treffer ⇒ erst die grosse Runde, dann die 10'000 relevantesten", async () => {
	// Wenig in der Nähe: 2 in 300, aber 100 in 1'000.
	const some = withinDeps(1_000_000, (i) => (i < 300 ? i % 150 === 0 : i < 400 || i >= 400_000));
	const o = await themeOrderWithin(null, 20, { withVectors: 600_000, max: THEME_LIST_MAX }, some.deps);
	assert.deepEqual(some.calls, ["nearest 300", "match 300", "nearest 1000", "match 1000"]);
	assert.deepEqual(ids(o).slice(0, 4), ["n0", "n150", "n300", "n301"]);
	const none = withinDeps(1_000_000, (i) => i >= 400_000);
	await themeOrderWithin(null, 20, { withVectors: 600_000, max: THEME_LIST_MAX }, none.deps);
	assert.deepEqual(none.calls, ["nearest 300", "match 300", "nearest 1000", "match 1000", "candidates 10000", `nearest ${THEME_LIST_MAX} in 10000`]);
});

test("Wort + Thema: wächst die Liste nach der grossen Runde, bleiben deren Treffer stehen und die relevantesten folgen", async () => {
	// 57 unter den nächsten 1'000; die 10'000 relevantesten enthalten keinen davon.
	const { calls, deps } = withinDeps(1_000_000, (i) => (i < 300 ? i % 30 === 0 : i < 347 || i >= 400_000));
	const size = { withVectors: 600_000, max: THEME_LIST_MAX };
	const first = await themeOrderWithin(null, 40, size, deps);
	assert.deepEqual(calls, ["nearest 300", "match 300", "nearest 1000", "match 1000"]);
	assert.equal(first.hits.length, 57);
	const more = await themeOrderWithin(first, 60, size, deps);
	assert.deepEqual(calls.slice(4), ["candidates 10000", `nearest ${THEME_LIST_MAX} in 10000`]);
	assert.deepEqual(ids(more).slice(0, 57), ids(first));
	assert.equal(more.hits.length, THEME_LIST_MAX);
	assert.equal(new Set(ids(more)).size, THEME_LIST_MAX);
	// Dieselbe Folge wie auf einmal (Export).
	const x = withinDeps(1_000_000, (i) => (i < 300 ? i % 30 === 0 : i < 347 || i >= 400_000));
	assert.deepEqual(ids(await themeOrderWithin(null, 1_000, size, x.deps)), ids(more));
});

test("Wort + Thema: viele Treffer auf einmal (Themen-Umfang, Export) überspringen die kleine Runde", async () => {
	const { calls, deps, hits } = withinDeps(200_000, (i) => i % 2 === 0);
	const o = await themeOrderWithin(null, 250, { withVectors: 100_000, max: THEME_LIST_MAX }, deps);
	assert.deepEqual(calls, ["nearest 1000", "match 1000"]);
	assert.deepEqual(ids(o), hits.slice(0, 500));
	const x = withinDeps(200_000, (i) => i % 2 === 0);
	const e = await themeOrderWithin(null, 10_000, { withVectors: 100_000, max: 10_000 }, x.deps);
	assert.deepEqual(x.calls, ["nearest 1000", "match 1000", "candidates 10000", "nearest 10000 in 10000"]);
	// Die nächsten stehen vorn, ohne Doppelte.
	assert.deepEqual(ids(e).slice(0, 500), x.hits.slice(0, 500));
	assert.equal(new Set(ids(e)).size, e.hits.length);
});

test("abgebrochene Reihung aller Treffer: dann die relevantesten statt einer kurzen Liste", async () => {
	const w = withinDeps(400_000, (i) => i % 10 === 0);
	const cut = { ...w.deps, nearest: async (k: number, within?: readonly string[]) => (await w.deps.nearest(k, within)).slice(0, within && within.length > 10_000 ? 5 : k) };
	const o = await themeOrderWithin(null, 100, { withVectors: 40_000, max: THEME_LIST_MAX }, cut);
	assert.deepEqual(w.calls, ["candidates 40000", `nearest ${THEME_LIST_MAX} in 40000`, "candidates 10000", `nearest ${THEME_LIST_MAX} in 10000`]);
	assert.equal(o.hits.length, THEME_LIST_MAX);
});

test("lückenhafte Vektorsuche (abgebrochen): die Liste endet nicht dort", async () => {
	const w = withinDeps(100_000, (i) => i % 4 === 0);
	const short = { ...w.deps, nearest: async (k: number, within?: readonly string[]) => (within ? w.deps.nearest(k, within) : (await w.deps.nearest(k)).slice(0, 12)) };
	const o = await themeOrderWithin(null, 20, { withVectors: 25_000, max: THEME_LIST_MAX }, short);
	assert.equal(o.hits.length, THEME_LIST_MAX);
	const d = aloneDeps(5_000);
	const a = await themeOrderAlone(null, 20, WIDE, { ...d, nearest: async (k) => (await d.nearest(k)).slice(0, k === 75 ? 40 : k) });
	assert.equal(a.hits.length, THEME_LIST_MAX);
});

test("Wort + Thema: kein Treffer mit Vektor ⇒ nur der Rest", async () => {
	const { calls, deps } = withinDeps(0, () => false, ["r0", "r1"]);
	const o = await themeOrderWithin(null, 20, { withVectors: 0, max: THEME_LIST_MAX }, deps);
	assert.deepEqual(calls, [`rest ${THEME_LIST_MAX}`]);
	assert.deepEqual(ids(o), ["r0", "r1"]);
	assert.equal(o.ranked, 0);
});

test("cachedOrder: gleichzeitige Anfragen rechnen einmal, grösserer Bedarf setzt fort, Fehler bleiben nicht stehen", async () => {
	const map = new Map<string, Promise<ThemeOrder<string> | null>>();
	const cache = { get: (k: string) => map.get(k), set: (k: string, v: Promise<ThemeOrder<string> | null>) => void map.set(k, v) };
	const d = aloneDeps(5_000);
	const run = (need: number) => cachedOrder(cache, "k", (prev) => themeOrderAlone(prev, need, WIDE, d));
	const [a, b] = await Promise.all([run(20), run(20)]);
	assert.deepEqual(d.calls, ["nearest 75"]);
	assert.deepEqual(ids(a), ids(b));
	await run(15);
	assert.deepEqual(d.calls, ["nearest 75"]);
	const c = await run(120);
	assert.deepEqual(d.calls, ["nearest 75", "nearest 200"]);
	assert.deepEqual(ids(c).slice(0, 20), ids(a).slice(0, 20));
	await run(140);
	assert.equal(d.calls.length, 2);
	// Fehler: der Aufrufer sieht ihn, die nächste Anfrage rechnet neu.
	await assert.rejects(cachedOrder(cache, "f", async () => Promise.reject(new Error("Meili 503"))), /503/);
	const ok = await cachedOrder(cache, "f", (prev) => {
		assert.equal(prev, null);
		return themeOrderAlone(prev, 20, WIDE, d);
	});
	assert.equal(ok.hits.length, 75);
});

test("cachedOrder: was keep verwirft, bleibt nicht stehen – weder am Anfang noch beim Fortsetzen", async () => {
	const map = new Map<string, Promise<ThemeOrder<string> | null>>();
	const cache = { get: (k: string) => map.get(k), set: (k: string, v: Promise<ThemeOrder<string> | null>) => void map.set(k, v) };
	const d = aloneDeps(5_000);
	const run = (need: number, keep: boolean) => cachedOrder(cache, "k", (prev) => themeOrderAlone(prev, need, WIDE, d), () => keep);
	assert.equal((await run(20, false)).hits.length, 75);
	assert.equal(await map.get("k"), null);
	// Die nächste Anfrage rechnet neu und hebt auf.
	await run(20, true);
	assert.deepEqual(d.calls, ["nearest 75", "nearest 75"]);
	// Eine abgebrochene Fortsetzung wird gezeigt, aufgehoben bleibt der frühere Stand.
	assert.equal((await run(80, false)).hits.length, 200);
	assert.equal((await map.get("k"))?.hits.length, 75);
});
