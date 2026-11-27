// Lauf: npx tsx --test src/lib/server/ttlCache.test.ts
// TTL-LRU hinter dem Embed-Vektor-Cache (embed.ts): Hit/Miss, TTL-Ablauf,
// LRU-Eviction-Ordnung, Oversize-Key-Guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtlLruCache } from "./ttlCache";

test("ttlCache: Hit/Miss + TTL-Ablauf (injizierte Uhr)", () => {
	let now = 1000;
	const c = createTtlLruCache<number>({ maxEntries: 3, ttlMs: 100, now: () => now });
	assert.equal(c.get("a"), undefined);
	c.set("a", 1);
	assert.equal(c.get("a"), 1);
	now += 99;
	assert.equal(c.get("a"), 1, "innerhalb der TTL");
	now += 2;
	assert.equal(c.get("a"), undefined, "nach der TTL weg");
	assert.equal(c.size, 0, "abgelaufener Eintrag wird beim get entfernt");
});

test("ttlCache: get refresht die LRU-Position, nicht die TTL", () => {
	let now = 0;
	const c = createTtlLruCache<number>({ maxEntries: 3, ttlMs: 100, now: () => now });
	c.set("a", 1);
	now = 90;
	assert.equal(c.get("a"), 1);
	now = 101;
	assert.equal(c.get("a"), undefined, "expiresAt bleibt beim ursprünglichen set");
});

test("ttlCache: LRU-Eviction – zuletzt benutzte überleben", () => {
	const c = createTtlLruCache<number>({ maxEntries: 3, ttlMs: 1000, now: () => 0 });
	c.set("a", 1);
	c.set("b", 2);
	c.set("c", 3);
	c.get("a"); // a frisch → b ist jetzt der älteste
	c.set("d", 4);
	assert.equal(c.get("b"), undefined, "ältester unbenutzter verdrängt");
	assert.equal(c.get("a"), 1);
	assert.equal(c.get("c"), 3);
	assert.equal(c.get("d"), 4);
	assert.equal(c.size, 3);
});

test("ttlCache: Oversize-Keys werden nicht gecached", () => {
	const c = createTtlLruCache<number>({ maxEntries: 3, ttlMs: 1000, maxKeyLen: 5, now: () => 0 });
	c.set("123456", 1);
	assert.equal(c.get("123456"), undefined);
	assert.equal(c.size, 0);
	c.set("12345", 2);
	assert.equal(c.get("12345"), 2);
});

test("ttlCache: Gewichtsgrenze verdrängt die ältesten, zu Schweres bleibt draussen", () => {
	const c = createTtlLruCache<string>({
		maxEntries: 10,
		ttlMs: 1000,
		now: () => 0,
		weigh: (v) => v.length,
		maxWeight: 10,
	});
	c.set("a", "xxxx");
	c.set("b", "xxxx");
	c.set("c", "xxxx"); // Summe 12 > 10 ⇒ a fliegt
	assert.equal(c.get("a"), undefined);
	assert.equal(c.get("b"), "xxxx");
	assert.equal(c.get("c"), "xxxx");
	c.set("big", "x".repeat(11));
	assert.equal(c.get("big"), undefined, "einzelner Wert über maxWeight wird nicht gecached");
	assert.equal(c.size, 2);
	c.set("b", "xx"); // Ersetzen rechnet das alte Gewicht heraus
	c.set("d", "xxxx");
	assert.equal(c.get("c"), "xxxx", "2 + 4 + 4 = 10 passt noch");
});
