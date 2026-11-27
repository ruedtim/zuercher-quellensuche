/**
 * Unit-Tests für die Einzeldatei-vs-ZIP-Entscheidung. Lauf:
 *   npx tsx --test src/lib/server/packageDownload.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlainText, buildSlug, pickSingleFile, singleFileMeta } from "./packageDownload";

test("genau ein Textformat ohne Bilder → dieses Format", () => {
	assert.equal(pickSingleFile(new Set(["txt"]), false), "txt");
	assert.equal(pickSingleFile(new Set(["html"]), false), "html");
	assert.equal(pickSingleFile(new Set(["xml"]), false), "xml");
});

test("Bilder dabei → null (ZIP), auch bei einem Format", () => {
	assert.equal(pickSingleFile(new Set(["txt"]), true), null);
	assert.equal(pickSingleFile(new Set(["html"]), true), null);
});

test("mehrere Formate → null (ZIP)", () => {
	assert.equal(pickSingleFile(new Set(["txt", "html"]), false), null);
	assert.equal(pickSingleFile(new Set(["txt", "xml", "html"]), false), null);
});

test("kein Format → null", () => {
	assert.equal(pickSingleFile(new Set([]), false), null);
});

test("unbekanntes Format → null (defensiv)", () => {
	assert.equal(pickSingleFile(new Set(["pdf"]), false), null);
});

test("singleFileMeta: Slug + Endung + Content-Type", () => {
	assert.deepEqual(singleFileMeta("StAZH_ABl_1930_S._1-3", "txt"), {
		filename: "StAZH_ABl_1930_S._1-3.txt",
		contentType: "text/plain; charset=utf-8",
	});
	assert.deepEqual(singleFileMeta("StAZH_ABl_1930_S._1-3", "html"), {
		filename: "StAZH_ABl_1930_S._1-3.html",
		contentType: "text/html; charset=utf-8",
	});
	assert.deepEqual(singleFileMeta("StAZH_ABl_1930_S._1-3", "xml"), {
		filename: "StAZH_ABl_1930_S._1-3.xml",
		contentType: "application/xml; charset=utf-8",
	});
});

test("buildSlug: Signatur → dateisystem-sicherer Name", () => {
	assert.equal(buildSlug("StAZH MM 3.188 RRB 1989/0355", "x"), "StAZH_MM_3.188_RRB_1989_0355");
	assert.equal(buildSlug("StAZH OS 10 (S.\n  115-120)", "x"), "StAZH_OS_10_S._115-120");
	assert.equal(buildSlug("Zürich – Gemeindeordnung", "x"), "Zurich_-_Gemeindeordnung");
	assert.equal(buildSlug(null, "RRB_2016_0271"), "RRB_2016_0271");
	assert.equal(buildSlug("   ", "KRP_1999_gabc"), "KRP_1999_gabc");
	assert.equal(buildSlug("///", "x"), "dokument");
});

test("buildPlainText: Kopf + Trennlinie + Body", () => {
	const txt = buildPlainText({
		title: " Armut im Kanton Zürich ",
		stazhIdent: "StAZH MM 3.188 RRB 1989/0355",
		date: "1989-02-08",
		body: " Der Kantonsrat hat … ",
	});
	assert.equal(
		txt,
		"Armut im Kanton Zürich – StAZH MM 3.188 RRB 1989/0355 – 1989-02-08\n" +
			"=".repeat(60) +
			"\n\nDer Kantonsrat hat …\n",
	);
	assert.equal(buildPlainText({ body: "nur Text" }), "nur Text\n");
});
