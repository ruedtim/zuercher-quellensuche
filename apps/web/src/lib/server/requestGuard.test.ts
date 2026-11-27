/**
 * Unit-Tests für die Prüfungen am Anfang jeder Anfrage. Lauf:
 *   npx tsx --test src/lib/server/requestGuard.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCostlyRoute, isSuspiciousPath, publicApiOf } from "./requestGuard";

test("isSuspiciousPath: normale Adressen gehen durch", () => {
	for (const t of [
		"/",
		"/search?q=Z%C3%BCrich%20%26%20Uster&from=q%3Dwald%26page%3D2",
		"/search?q=a%2Fb%23c%5Cd%25",
		"/documents/ABl/ABl_1904__S__1-13_",
		"/documents/KRP/KRP_2015_gca05cc996e7d4f24acdecbdf198bb3c1_t04?from=q%3Dwald&pos=3",
		"/api/v1/documents/RM_1552_0001_0001",
		"/api/document/ABl/ABl_1904__S__1-13_/package?formats=xml,txt&images=0",
		"/editionen/ssrq/SSRQ_ZH_NF_II_3_040",
		"/Caf%C3%A9/x%20y",
		"/iiif/ABl/ABl_1904__S__1-13_/manifest.json",
		"/_app/immutable/entry/start.DUUz1La.js",
		"/portraits/z1114/Z_1114_118_2.webp",
		"/a%2Db%5Fc%7Ed",
		"/a..b/..c/d..",
		"/.well-known/mcp.json",
		"/search?from=/../x",
	]) {
		assert.equal(isSuspiciousPath(t), false, t);
	}
});

test("isSuspiciousPath: zweite Lesart wird erkannt", () => {
	for (const t of [
		"/documents/ABl/x%23%2F..%2F..%2Fapi%2Fv1%2Fx",
		"/documents/ABl/..%5Cstats",
		"/documents/ABl/..\\stats",
		"/api/v1/x\\..\\..\\search",
		"/%61pi/v1/series",
		"/api/%761/series",
		"/api/v1/%2e%2E/search",
		"/a%252f",
		"/a%00",
		"/a%3Fb",
		"/%4D%50%6f%7a%30",
		"/api/document//../v1/x/package",
		"/a/..",
		"/a/..?x=1",
		"/a/..#x",
	]) {
		assert.equal(isSuspiciousPath(t), true, t);
	}
});

test("publicApiOf: nach der Route, nicht nach dem rohen Pfad", () => {
	assert.equal(publicApiOf("/api/v1/series", "/%61pi/v1/series"), "v1");
	assert.equal(publicApiOf("/api/v1/[...rest]", "/api/v1/unbekannt"), "v1");
	assert.equal(publicApiOf("/api/dts/document", "/api/d%74s/document"), "dts");
	assert.equal(publicApiOf("/api/mcp", "/api/mcp"), "mcp");
	assert.equal(publicApiOf("/search", "/api/v1"), null);
	assert.equal(publicApiOf("/api/search", "/api/search"), null);
	// Ohne Route (404) bleibt der Pfad, damit auch unbekannte Pfade darunter zählen.
	assert.equal(publicApiOf(null, "/api/mcp/.well-known/x"), "mcp");
	assert.equal(publicApiOf(null, "/nirgends"), null);
});

test("isCostlyRoute: Suche, Seiten mit Abfragen und offene APIs; nicht MCP, Export und Seiten aus dem Speicher", () => {
	for (const r of [
		"/search",
		"/api/search",
		"/api/search/facetSearch",
		"/api/v1/documents/[id]/similar",
		"/api/dts/document",
		"/documents/[abbr]/[id]",
		"/personen/[id]",
		"/register",
		"/archivkatalog/register/[typ]",
		"/editionen/[edition]/[id]",
		"/api/document/[...path]/package",
	]) {
		assert.equal(isCostlyRoute(r), true, r);
	}
	for (const r of [null, "/", "/about", "/personen", "/rat", "/healthz", "/api/mcp", "/api/search/export", "/api/portrait/[qid]", "/api/feedback", "/searchx"]) {
		assert.equal(isCostlyRoute(r), false, String(r));
	}
});
