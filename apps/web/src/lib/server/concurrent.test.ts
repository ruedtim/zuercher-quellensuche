// Lauf: npx tsx --test src/lib/server/concurrent.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mapConcurrent } from "./concurrent";

test("mapConcurrent: Reihenfolge bleibt, höchstens limit gleichzeitig", async () => {
	let active = 0;
	let peak = 0;
	const out = await mapConcurrent([5, 1, 4, 2, 3, 0], 2, async (ms) => {
		active++;
		peak = Math.max(peak, active);
		await new Promise((r) => setTimeout(r, ms));
		active--;
		return ms * 10;
	});
	assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
	assert.equal(peak, 2);
	assert.deepEqual(await mapConcurrent([], 8, async (x: number) => x), []);
	assert.deepEqual(await mapConcurrent([1, 2], 0, async (x) => x + 1), [2, 3]);
});
