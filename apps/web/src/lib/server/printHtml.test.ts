/**
 * Unit-Tests für die HTML-Druckansicht. Lauf:
 *   npx tsx --test src/lib/server/printHtml.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrintHtml } from "./printHtml";
import { LICENSE, LICENSE_URL } from "./apiV1/constants";
import { SERIES_LABEL, type SearchHit, type SeriesAbbr } from "../types";

function mkDoc(overrides: Partial<SearchHit> = {}): SearchHit {
	return {
		id: "ABl_1935_001",
		series: "ABl",
		title: "Bekanntmachung des Regierungsrates",
		date: "1935-03-22",
		dateYear: 1935,
		startPg: null,
		volumeNr: null,
		serialNr: null,
		resolutionId: null,
		stazhIdent: "StAZH ABl 1935",
		archiveLink: null,
		manifestUrl: null,
		body: "",
		...overrides,
	};
}

const BASE = "https://example.test";

function build(overrides: Partial<SearchHit>, fragment: string | null = null): string {
	const doc = mkDoc(overrides);
	return buildPrintHtml({ series: doc.series, id: doc.id, doc, fragment, baseUrl: BASE });
}

test("emittiert ein vollständiges HTML-Dokument-Skelett", () => {
	const html = build({}, "<article class=\"tei\"><section class=\"tei-text\"><p>x</p></section></article>");
	assert.ok(html.startsWith("<!DOCTYPE html>"), "beginnt mit Doctype");
	assert.match(html, /<html lang="de">/);
	assert.match(html, /<meta charset="utf-8">/);
	assert.match(html, /<style>/);
	assert.match(html, /<\/html>\s*$/);
});

test("fügt das Render-Fragment roh ein und wrappt es in .tei-document-body", () => {
	const fragment = '<article class="tei"><section class="tei-text"><p>Inhalt &amp; mehr</p></section></article>';
	const html = build({}, fragment);
	assert.ok(html.includes(fragment), "Fragment erscheint verbatim");
	assert.ok(!html.includes("&amp;amp;"), "kein Doppel-Escaping der Entität");
	assert.match(html, /<main class="tei-document-body">/);
});

test("escaped Header-Felder (Titel) und gibt kein rohes Markup aus", () => {
	const html = build({ title: 'A & B <x> "z"', stazhIdent: "StAZH X" });
	assert.ok(html.includes("A &amp; B &lt;x&gt; &quot;z&quot;"), "Titel ist escaped");
	assert.ok(!html.includes("<x>"), "kein rohes <x> im Output");
});

test("generischer Titel fällt auf stazhIdent zurück", () => {
	// SERIES_LABEL.ABl
	const a = build({ title: SERIES_LABEL["ABl" as SeriesAbbr], stazhIdent: "StAZH ABl 17" });
	assert.match(a, /<h1>StAZH ABl 17<\/h1>/);
	// Lang-Variante
	const b = build({ title: "Amtsblatt des Kantons Zürich", stazhIdent: "StAZH ABl 18" });
	assert.match(b, /<h1>StAZH ABl 18<\/h1>/);
	// "(ohne Titel)"
	const c = build({ title: "(ohne Titel)", stazhIdent: "StAZH ABl 19" });
	assert.match(c, /<h1>StAZH ABl 19<\/h1>/);
});

test("Permalink nutzt den übergebenen baseUrl (kein hartcodierter Host)", () => {
	const html = build({ id: "ABl_1935_007", series: "ABl" });
	assert.ok(html.includes(`href="${BASE}/documents/ABl/ABl_1935_007"`));
	assert.ok(!html.includes("https://zentraleserien.ch/documents/ABl/ABl_1935_007"));
});

test("nennt Lizenz und Lizenz-URL aus den Konstanten", () => {
	const html = build({});
	assert.ok(html.includes(LICENSE), "LICENSE-Text vorhanden");
	assert.ok(html.includes(LICENSE_URL), "LICENSE_URL vorhanden");
});

test("Quelle je Teilbestand: Altbestand Staatsarchiv, Spätbestand publizierende Behörde", () => {
	assert.ok(build({}).includes("Quelle: Staatsarchiv des Kantons Zürich"));
	const late = build({ series: "RRB", subset: "rrb-late", stazhIdent: "RRB 2020/0123" });
	assert.ok(late.includes("Quelle: Regierungsrat des Kantons Zürich"));
	assert.ok(!late.includes("Staatsarchiv"), "Spätbestand nennt das Staatsarchiv nicht");
	assert.ok(late.includes(LICENSE_URL), "Lizenz-Link bleibt");
});

test("Fallback aus doc.body, wenn kein Fragment vorliegt", () => {
	const html = build({ body: "Zeile1\n\nZeile2" }, null);
	assert.match(html, /<p>Zeile1<\/p>/);
	assert.match(html, /<p>Zeile2<\/p>/);
	assert.ok(html.startsWith("<!DOCTYPE html>"));
});

test("Fragment null und leerer Body → valides Dokument mit Hinweis, kein Throw", () => {
	const html = build({ body: "" }, null);
	assert.ok(html.startsWith("<!DOCTYPE html>"));
	assert.match(html, /nicht verfügbar/);
});

test("bedingte Meta: Bd./Nr. nur bei vorhandenen Werten", () => {
	const without = build({ volumeNr: null, resolutionId: null });
	assert.ok(!without.includes("Bd."), "kein Bd.-Label ohne volumeNr");
	assert.ok(!without.includes("Nr."), "kein Nr.-Label ohne resolutionId");
	const withVals = build({ volumeNr: 12, resolutionId: "2024/345" });
	assert.match(withVals, /Bd\./);
	assert.match(withVals, /Nr\./);
	assert.ok(withVals.includes("2024/345"));
});

test("Entity-Spans bleiben erhalten (Neutralisierung ist nur CSS)", () => {
	const fragment = '<article class="tei"><section class="tei-text"><p><span class="tei-person">Müller</span></p></section></article>';
	const html = build({}, fragment);
	assert.ok(html.includes('<span class="tei-person">Müller</span>'));
});

test("Ratsmanuale: Datum mit «(a. St.)», Band B II, HTR-Hinweis und Zitiervorschlag", () => {
	const html = build({
		id: "RM_1642_0441_0012",
		series: "RM",
		title: "Ratssitzung 17.10.1642 (a. St.) – Unterschreiber-Manual",
		date: "1642-10-17",
		dateYear: 1642,
		volumeNr: 441,
		stazhIdent: "StAZH B II 441, S. 122–124",
	});
	assert.match(html, /17\. Oktober 1642 \(a\. St\.\)/);
	assert.match(html, /B&nbsp;II&nbsp;441/);
	assert.ok(!html.includes("Bd.&nbsp;441"));
	assert.match(html, /Maschinelle Transkription \(HTR\)/);
	assert.ok(
		html.includes(
			"Zitiervorschlag: StAZH B II 441, S. 122–124, Sitzung vom 17.10.1642 (a. St.); maschinelle Transkription, zitiert nach https://example.test/documents/RM/RM_1642_0441_0012",
		),
	);
	// Andere Serien ohne RM-Hinweise.
	assert.ok(!build({}).includes("Zitiervorschlag"));
});
