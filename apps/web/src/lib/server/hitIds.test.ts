// Lauf: npx tsx --test src/lib/server/hitIds.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { collectHitIds, sliceClause, yearSlices, type YearSlice } from "./hitIds";

test("yearSlices: aufeinanderfolgende Jahre bis zur Obergrenze, grosse Jahre allein, ohne Jahr eine eigene Scheibe", () => {
	assert.deepEqual(yearSlices({ "1850": 400, "1803": 300, "1851": 500, "1900": 1_500, "1901": 10, "1902": 0 }, 7, 1_000), [
		{ from: 1803, to: 1850, count: 700 },
		{ from: 1851, to: 1851, count: 500 },
		{ from: 1900, to: 1900, count: 1_500 },
		{ from: 1901, to: 1901, count: 10 },
		{ from: null, to: null, count: 7 },
	]);
	assert.deepEqual(yearSlices({}, 0, 1_000), []);
	// Jede Scheibe bis auf die grossen Jahre passt, alle Jahre kommen genau einmal vor.
	const years = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(1800 + i), (i * 37) % 400]));
	const slices = yearSlices(years, 0, 1_000);
	assert.ok(slices.every((s) => s.count <= 1_000));
	assert.equal(
		slices.reduce((n, s) => n + s.count, 0),
		Object.values(years).reduce((a, b) => a + b, 0),
	);
	slices.slice(1).forEach((s, i) => assert.ok(s.from! > slices[i].to!));
});

test("sliceClause: Jahresbereich bzw. ohne Jahr", () => {
	assert.equal(sliceClause({ from: 1803, to: 1850, count: 1 }, "dateYear"), "dateYear >= 1803 AND dateYear <= 1850");
	assert.equal(sliceClause({ from: null, to: null, count: 1 }, "dateFrom"), "(dateFrom IS NULL OR dateFrom NOT EXISTS)");
});

/** Attrappe: Treffer je Jahr; die Facette nennt höchstens `limit` Werte je Scheibe. */
function index(byYear: Record<number, string[]>, limit: number) {
	const calls: string[] = [];
	const of = (s: YearSlice) => Object.entries(byYear).filter(([y]) => Number(y) >= s.from! && Number(y) <= s.to!).flatMap(([, ids]) => ids);
	return {
		calls,
		byFacet: async (slices: YearSlice[]) => {
			calls.push(`Facette ${slices.length}`);
			return slices.flatMap((s) => of(s).slice(0, limit));
		},
		bySearch: async (s: YearSlice) => {
			calls.push(`Suche ${s.from}`);
			return of(s);
		},
	};
}

test("collectHitIds: alle Kennungen, grosse Jahre über die Suche", async () => {
	const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
	const d = index({ 1850: ids("a", 3), 1851: ids("b", 4), 1900: ids("c", 9) }, 5);
	const got = await collectHitIds(yearSlices({ "1850": 3, "1851": 4, "1900": 9 }, 0, 5), 5, 16, d);
	assert.equal(got?.length, 16);
	assert.deepEqual(d.calls, ["Facette 2", "Suche 1900"]);
	// Zählt die Verteilung mehr, als die Suche trifft (Ratsmanuale ohne Vektor), genügt die erwartete Zahl.
	const e = index({ 1850: ids("a", 3) }, 5);
	assert.equal((await collectHitIds(yearSlices({ "1850": 5 }, 0, 5), 5, 3, e))?.length, 3);
});

test("collectHitIds: kommen weniger zusammen als erwartet, gilt der gewöhnliche Weg", async () => {
	// Die Facette ist enger eingestellt als angenommen.
	const d = index({ 1850: ["a", "b", "c", "d"] }, 2);
	assert.equal(await collectHitIds(yearSlices({ "1850": 4 }, 0, 5), 5, 4, d), null);
	assert.equal(await collectHitIds([], 5, 4, d), null);
});
