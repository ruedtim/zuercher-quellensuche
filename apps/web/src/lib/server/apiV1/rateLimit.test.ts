/**
 * Unit-Tests für den Sliding-Window-Rate-Limiter (node:test, Repo-Muster wie
 * chunkAlign.test.ts). Lauf:
 *   npx tsx --test src/lib/server/apiV1/rateLimit.test.ts
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, resetRateLimiter, sweepStale, bucketCount } from "./rateLimit";

const WINDOW = 60_000;

beforeEach(() => resetRateLimiter());

test("erlaubt bis zum Limit, blockt danach", () => {
	const t0 = 1_000_000;
	for (let i = 0; i < 5; i++) {
		const r = checkRateLimit("a", 5, WINDOW, t0 + i);
		assert.equal(r.ok, true, `Request ${i + 1} muss durchgehen`);
	}
	const blocked = checkRateLimit("a", 5, WINDOW, t0 + 10);
	assert.equal(blocked.ok, false);
	assert.equal(blocked.remaining, 0);
});

test("remaining zählt runter", () => {
	const t0 = 0;
	assert.equal(checkRateLimit("a", 3, WINDOW, t0).remaining, 2);
	assert.equal(checkRateLimit("a", 3, WINDOW, t0 + 1).remaining, 1);
	assert.equal(checkRateLimit("a", 3, WINDOW, t0 + 2).remaining, 0);
});

test("Retry-After: Sekunden bis der älteste Eintrag rausfällt", () => {
	const t0 = 0;
	checkRateLimit("a", 2, WINDOW, t0);
	checkRateLimit("a", 2, WINDOW, t0 + 10_000);
	const blocked = checkRateLimit("a", 2, WINDOW, t0 + 30_000);
	assert.equal(blocked.ok, false);
	// Ältester Eintrag bei t0, Fenster 60 s, jetzt 30 s → 30 s warten.
	assert.equal(blocked.retryAfterS, 30);
});

test("Retry-After ist mindestens 1", () => {
	const t0 = 0;
	checkRateLimit("a", 1, WINDOW, t0);
	const blocked = checkRateLimit("a", 1, WINDOW, t0 + WINDOW - 1);
	assert.equal(blocked.ok, false);
	assert.ok(blocked.retryAfterS >= 1);
});

test("nach Ablauf des Fensters wieder frei", () => {
	const t0 = 0;
	checkRateLimit("a", 1, WINDOW, t0);
	assert.equal(checkRateLimit("a", 1, WINDOW, t0 + 1).ok, false);
	assert.equal(checkRateLimit("a", 1, WINDOW, t0 + WINDOW + 1).ok, true);
});

test("Keys sind unabhängig", () => {
	const t0 = 0;
	checkRateLimit("a", 1, WINDOW, t0);
	assert.equal(checkRateLimit("a", 1, WINDOW, t0 + 1).ok, false);
	assert.equal(checkRateLimit("b", 1, WINDOW, t0 + 1).ok, true);
});

test("sweepStale entfernt abgelaufene Keys", () => {
	const t0 = 0;
	checkRateLimit("alt", 5, WINDOW, t0);
	checkRateLimit("frisch", 5, WINDOW, t0 + WINDOW * 2);
	assert.equal(bucketCount(), 2);
	sweepStale(t0 + WINDOW);
	assert.equal(bucketCount(), 1);
	// Der frische Key überlebt, der alte ist weg.
	assert.equal(checkRateLimit("frisch", 5, WINDOW, t0 + WINDOW * 2 + 1).remaining, 3);
});
