/**
 * Unit-Tests für JSON-LD-Envelope + Hydra-Paginierung. Lauf:
 *   npx tsx --test src/lib/server/dts/serialize.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ldEnvelope, paginationView } from "./serialize";

test("ldEnvelope: @context + dtsVersion 1.0", () => {
	const e = ldEnvelope();
	assert.equal(e.dtsVersion, "1.0");
	assert.equal(e["@context"], "https://dtsapi.org/context/v1.0.json");
});

const pageUrl = (p: number) => `https://example.org/api/dts/collection?id=ABl%2F1834&page=${p}`;

test("paginationView: eine Seite → null (kein view)", () => {
	assert.equal(paginationView("self", pageUrl, 1, 1), null);
});

test("paginationView: erste Seite hat first/next/last, kein previous", () => {
	const v = paginationView("https://example.org/self", pageUrl, 1, 5);
	assert.ok(v);
	assert.equal(v["@type"], "Pagination");
	assert.equal(v["@id"], "https://example.org/self");
	assert.equal(v.first, pageUrl(1));
	assert.equal(v.next, pageUrl(2));
	assert.equal(v.last, pageUrl(5));
	assert.equal("previous" in v, false);
});

test("paginationView: mittlere Seite hat previous + next", () => {
	const v = paginationView("self", pageUrl, 3, 5);
	assert.ok(v);
	assert.equal(v.previous, pageUrl(2));
	assert.equal(v.next, pageUrl(4));
	assert.equal(v.first, pageUrl(1));
	assert.equal(v.last, pageUrl(5));
});

test("paginationView: letzte Seite hat kein next", () => {
	const v = paginationView("self", pageUrl, 5, 5);
	assert.ok(v);
	assert.equal(v.previous, pageUrl(4));
	assert.equal("next" in v, false);
	assert.equal(v.last, pageUrl(5));
});
