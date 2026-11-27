/**
 * Unit-Tests für die Sicht der Dokumentsuche im Browser. Lauf:
 *   npx tsx --test src/lib/server/documentResult.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { documentMeta, documentResultView, listAttributes } from "./documentResult";
import type { SearchHit, SearchResponse } from "../types";

const HIT = {
	id: "RRB_2023_0877",
	series: "RRB",
	title: "Beschluss <https://www.gra.ch/x> & Co",
	date: "2023-07-05",
	dateYear: 2023,
	startPg: null,
	volumeNr: null,
	serialNr: null,
	resolutionId: "2023/0877",
	stazhIdent: null,
	archiveLink: null,
	manifestUrl: null,
	body: "Volltext",
	persons: ["Anna Meier"],
	_formatted: {
		title: 'Beschluss <https://www.gra.ch/x> & <mark class="match">Co</mark>',
		body: '<img src=x onerror=alert(1)> <mark class="match">Wald</mark> und <mark class="entity-match">Anna Meier</mark>',
	},
} as unknown as SearchHit;
const result = (hits: SearchHit[]) => ({ hits, estimatedTotalHits: 1, processingTimeMs: 2, page: 1, pageSize: 20 }) as SearchResponse;

test("documentResultView: Text maskiert, nur die Hervorhebungen bleiben Markup", () => {
	const [hit] = documentResultView(result([HIT])).hits;
	assert.equal(hit.titleHtml, 'Beschluss &lt;https://www.gra.ch/x&gt; &amp; <mark class="match">Co</mark>');
	assert.equal(
		hit.textHtml,
		'&lt;img src=x onerror=alert(1)&gt; <mark class="match">Wald</mark> und <mark class="entity-match">Anna Meier</mark>',
	);
});

test("documentResultView: Meilis Auslassungszeichen an den Enden fallen weg (die Liste setzt sie selbst)", () => {
	const at = (body: string) => documentResultView(result([{ ...HIT, _formatted: { title: "T", body } } as unknown as SearchHit])).hits[0].textHtml;
	assert.equal(at('…vom <mark class="match">Wald</mark> … und Feld…'), 'vom <mark class="match">Wald</mark> … und Feld');
	assert.equal(at("Anfang des Textes…"), "Anfang des Textes");
});

test("documentResultView: weder Volltext noch Namen noch Rohfelder, Zahlen bleiben", () => {
	const view = documentResultView(result([HIT]));
	assert.deepEqual(Object.keys(view.hits[0]).sort(), ["date", "id", "series", "stazhIdent", "textHtml", "titleHtml"]);
	assert.equal(view.estimatedTotalHits, 1);
	assert.equal(view.pageSize, 20);
});

test("documentResultView: ein Treffer nur mit Kennung (Zählung) bricht nicht ab", () => {
	const [hit] = documentResultView(result([{ id: "RRB_2023_0877" } as unknown as SearchHit])).hits;
	assert.equal(hit.titleHtml, "");
	assert.equal(hit.textHtml, null);
});

test("documentResultView: ohne Auszug und ohne Formatierung", () => {
	const [hit] = documentResultView(result([{ ...HIT, _formatted: undefined }])).hits;
	assert.equal(hit.titleHtml, "Beschluss &lt;https://www.gra.ch/x&gt; &amp; Co");
	assert.equal(hit.textHtml, null);
});

test("listAttributes: Volltext nur, wo der Server den Auszug schneidet", () => {
	const none = { q: "", anyTerms: [], theme: "", persons: [], places: [], organizations: [] };
	assert.ok(!listAttributes(none)?.includes("body"));
	assert.ok(listAttributes(none)?.includes("stazhIdent"));
	assert.equal(listAttributes({ ...none, theme: "Seuchen" }), undefined);
	// Mit einem Suchbegriff schneidet Meili den Auszug, mit ODER-Begriffen der Server.
	assert.ok(listAttributes({ ...none, theme: "Seuchen", q: "Spital" }));
	assert.ok(listAttributes({ ...none, theme: "Seuchen", anyTerms: ["Spital"] }));
	assert.equal(listAttributes({ ...none, theme: "Seuchen", anyTerms: ["Spital", "Lazarett"] }), undefined);
	assert.equal(listAttributes({ ...none, theme: "Seuchen", q: "Zürich", anyTerms: ["Spital", "Lazarett"] }), undefined);
	assert.ok(listAttributes({ ...none, q: "Spital" }));
	assert.equal(listAttributes({ ...none, places: ["Kyburg"] }), undefined);
	assert.ok(listAttributes({ ...none, theme: "  " }));
});

test("documentMeta: ohne Volltext und Namenslisten", () => {
	const meta = documentMeta(HIT) as unknown as Record<string, unknown>;
	assert.equal(meta.resolutionId, "2023/0877");
	for (const f of ["body", "persons", "_formatted"]) assert.ok(!(f in meta), f);
});
