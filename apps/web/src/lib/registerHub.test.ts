// Lauf: npx tsx --test src/lib/registerHub.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fullTextHref, fullTextQuery, HUB_QUERY_MAX, isRegisterPath, parseHubQuery, REGISTER_SOURCES, registerHubHref } from "./registerHub";

test("Quellen in der Reihenfolge der Reiter, ohne «Alle Quellen»", () => {
	assert.deepEqual(
		REGISTER_SOURCES.map((s) => s.id),
		["catalog", "documents", "editions", "ehedaten"],
	);
	assert.equal(REGISTER_SOURCES[1].label, "Zentrale Serien");
});

test("Suchwort: Leerraum zusammengefasst, gekürzt; Links", () => {
	assert.equal(parseHubQuery(new URLSearchParams("q=%20%20Heinrich%20%20%20Bullinger%20")), "Heinrich Bullinger");
	assert.equal(parseHubQuery(new URLSearchParams("")), "");
	assert.equal(parseHubQuery(new URLSearchParams({ q: " – ?! " })), "");
	assert.equal(parseHubQuery(new URLSearchParams({ q: "x".repeat(300) })).length, HUB_QUERY_MAX);
	assert.equal(registerHubHref(), "/register");
	assert.equal(registerHubHref("Wäber"), "/register?q=W%C3%A4ber");
});

test("Volltext: mehrere Wörter als Wortfolge", () => {
	assert.equal(fullTextQuery("Bullinger"), "Bullinger");
	assert.equal(fullTextQuery("Heinrich Bullinger"), '"Heinrich Bullinger"');
	assert.equal(fullTextQuery('"Hans Wäber" Zürich'), '"Hans Wäber" Zürich');
	assert.equal(fullTextHref("Heinrich Bullinger"), "/search?q=%22Heinrich+Bullinger%22");
});

test("Menüpunkt «Register»: Übersicht und alle Registerseiten, nicht ihre Geschwister", () => {
	for (const p of ["/register", "/personen", "/personen/1234", "/rat", "/rat/38509", "/archivkatalog/register/orte", "/editionen/register/personen"]) {
		assert.ok(isRegisterPath(p), p);
	}
	for (const p of ["/", "/search", "/registerx", "/personenx", "/ratsmanuale", "/archivkatalog/123", "/editionen/qzh/QZH_001"]) {
		assert.ok(!isRegisterPath(p), p);
	}
});
