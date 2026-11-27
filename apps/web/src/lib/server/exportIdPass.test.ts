/**
 * Unit-Tests für den ID-Pass des Treffer-Exports (Wiederholung bei kaltem
 * Cache, Abbruch bei still abgeschnittenem Thema-Ranking). Lauf:
 *   npx tsx --test src/lib/server/exportIdPass.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SLOW_ID_PASS_MS, runIdPass, semanticDropped, type IdPassRun } from "./exportIdPass";
import type { SearchHit } from "../types";

const hits = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `D${i}` }) as SearchHit);

function runner(runs: IdPassRun[]) {
	let calls = 0;
	const run = async () => {
		const r = runs[Math.min(calls, runs.length - 1)];
		calls++;
		return r;
	};
	return { run, calls: () => calls };
}

test("schneller Lauf: keine Wiederholung", async () => {
	const r = runner([{ result: { hits: hits(3) }, ms: 900 }]);
	const out = await runIdPass(r.run);
	assert.equal(r.calls(), 1);
	assert.ok(out.ok);
	if (out.ok) assert.equal(out.retried, false);
});

test("schneller Lauf mit 0 semantischen Treffern ist legitim (kein Abbruch möglich)", async () => {
	const r = runner([{ result: { hits: hits(3), semanticHitCount: 0 }, ms: 500 }]);
	const out = await runIdPass(r.run);
	assert.ok(out.ok);
	assert.equal(r.calls(), 1);
});

test("langsamer erster Lauf (kalter Cache): einmal wiederholen, zweiten nehmen", async () => {
	const second = { result: { hits: hits(5), semanticHitCount: 5 }, ms: 1200 };
	const r = runner([{ result: { hits: hits(5), semanticHitCount: 0 }, ms: 23_000 }, second]);
	const out = await runIdPass(r.run);
	assert.equal(r.calls(), 2);
	assert.ok(out.ok);
	if (out.ok) {
		assert.equal(out.retried, true);
		assert.equal(out.run, second);
		assert.equal(out.firstMs, 23_000);
	}
});

test("auch der zweite Lauf abgeschnitten (Thema ohne semantische Treffer): Abbruch", async () => {
	const r = runner([
		{ result: { hits: hits(5), semanticHitCount: 0 }, ms: 15_000 },
		{ result: { hits: hits(5), semanticHitCount: 0 }, ms: 12_000 },
	]);
	const out = await runIdPass(r.run);
	assert.equal(r.calls(), 2);
	assert.deepEqual(out, { ok: false, reason: "degraded", firstMs: 15_000, secondMs: 12_000 });
});

test("zweiter Lauf langsam, aber mit semantischen Treffern bzw. rein lexikalisch: liefern", async () => {
	const hybrid = runner([
		{ result: { hits: hits(5), semanticHitCount: 0 }, ms: 15_000 },
		{ result: { hits: hits(5), semanticHitCount: 5 }, ms: 11_000 },
	]);
	assert.ok((await runIdPass(hybrid.run)).ok);
	const lexical = runner([
		{ result: { hits: hits(5) }, ms: 16_000 },
		{ result: { hits: hits(5) }, ms: 14_000 },
	]);
	const out = await runIdPass(lexical.run);
	assert.ok(out.ok);
	if (out.ok) assert.equal(out.retried, true);
});

test("semanticDropped + Schwelle unter Meilis Cutoff", () => {
	assert.equal(semanticDropped({ result: { hits: hits(2), semanticHitCount: 0 }, ms: 0 }), true);
	assert.equal(semanticDropped({ result: { hits: hits(2), semanticHitCount: 2 }, ms: 0 }), false);
	assert.equal(semanticDropped({ result: { hits: hits(2) }, ms: 0 }), false, "nicht hybrid");
	assert.equal(semanticDropped({ result: { hits: [], semanticHitCount: 0 }, ms: 0 }), false, "keine Treffer");
	assert.ok(SLOW_ID_PASS_MS < 10_000);
});
