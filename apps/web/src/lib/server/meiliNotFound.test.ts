/**
 * Unit-Tests: «gibt es nicht» gegen «nicht erreichbar». Lauf:
 *   npx tsx --test src/lib/server/meiliNotFound.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isMeiliNotFound, orNull } from "./meiliNotFound";

const apiError = (status: number) => Object.assign(new Error("x"), { response: { status } });

test("nur 404 heisst «gibt es nicht»", async () => {
	assert.equal(isMeiliNotFound(apiError(404)), true);
	for (const e of [apiError(400), apiError(500), new Error("fetch failed"), null, undefined, "404"]) {
		assert.equal(isMeiliNotFound(e), false);
	}
	assert.equal(await orNull(Promise.resolve(1)), 1);
	assert.equal(await orNull(Promise.reject(apiError(404))), null);
	await assert.rejects(orNull(Promise.reject(apiError(503))));
	await assert.rejects(orNull(Promise.reject(new TypeError("fetch failed"))));
});
