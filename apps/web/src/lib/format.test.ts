/**
 * Unit-Tests für die reinen Formatierungs-Helper. Lauf:
 *   npx tsx --test src/lib/format.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { documentSource, formatDateNumeric, formatDocDateDE, isOldStyleDate, rmCitation, rmImageCredit } from "./format";

test("documentSource: Altbestand (ohne subset) stammt vom Staatsarchiv", () => {
	assert.equal(documentSource(null), "Staatsarchiv des Kantons Zürich");
	assert.equal(documentSource(undefined), "Staatsarchiv des Kantons Zürich");
	assert.equal(documentSource(""), "Staatsarchiv des Kantons Zürich");
});

test("documentSource: Spätbestände nennen die publizierende Behörde", () => {
	assert.equal(documentSource("krp-late"), "Kantonsrat des Kantons Zürich");
	assert.equal(documentSource("rrb-late"), "Regierungsrat des Kantons Zürich");
	assert.equal(documentSource("os-late"), "Staatskanzlei des Kantons Zürich");
});

test("documentSource: unbekannter Teilbestand ist born-digital, nicht Staatsarchiv", () => {
	assert.equal(documentSource("ls-late"), "Kanton Zürich");
	assert.equal(documentSource("constructor"), "Kanton Zürich");
});

test("isOldStyleDate: nur Ratsmanuale bis einschliesslich 1700", () => {
	assert.equal(isOldStyleDate("RM", "1642-10-17"), true);
	assert.equal(isOldStyleDate("RM", "1700-12-31"), true);
	assert.equal(isOldStyleDate("RM", "1701-01-12"), false);
	assert.equal(isOldStyleDate("RM", "1650"), true);
	assert.equal(isOldStyleDate("RRB", "1642-10-17"), false);
	assert.equal(isOldStyleDate("RM", null), false);
	assert.equal(isOldStyleDate("RM", ""), false);
});

test("formatDocDateDE: «(a. St.)» nur bei RM bis 1700", () => {
	assert.equal(formatDocDateDE({ series: "RM", date: "1642-10-17" }), "17. Oktober 1642 (a. St.)");
	assert.equal(formatDocDateDE({ series: "RM", date: "1752-03-04" }), "4. März 1752");
	assert.equal(formatDocDateDE({ series: "KRP", date: "1850-03-04" }), "4. März 1850");
	assert.equal(formatDocDateDE({ series: "RM", date: null }), "");
});

test("formatDateNumeric: T.M.JJJJ wie in den RM-Titeln", () => {
	assert.equal(formatDateNumeric("1642-10-07"), "7.10.1642");
	assert.equal(formatDateNumeric("1642-10-17"), "17.10.1642");
	assert.equal(formatDateNumeric("1642"), "1642");
	assert.equal(formatDateNumeric(null), "");
});

test("rmCitation: Signatur, Sitzungsdatum mit a. St., Permalink", () => {
	const link = "https://zentraleserien.ch/documents/RM/RM_1642_0441_0012";
	assert.equal(
		rmCitation({ series: "RM", stazhIdent: "StAZH B II 441, S. 122–124", date: "1642-10-17" }, link),
		`StAZH B II 441, S. 122–124, Sitzung vom 17.10.1642 (a. St.); maschinelle Transkription, zitiert nach ${link}`,
	);
	assert.equal(
		rmCitation({ series: "RM", stazhIdent: "StAZH B II 1001, Aufn. 37", date: "1785-06-01" }, link),
		`StAZH B II 1001, Aufn. 37, Sitzung vom 1.6.1785; maschinelle Transkription, zitiert nach ${link}`,
	);
	// Undatierte Sitzung: ohne «Sitzung vom …».
	assert.equal(
		rmCitation({ series: "RM", stazhIdent: "StAZH B II 441,\n S. 130", date: null }, link),
		`StAZH B II 441, S. 130; maschinelle Transkription, zitiert nach ${link}`,
	);
});

test("rmImageCredit: Nachweis mit Band", () => {
	assert.equal(rmImageCredit(441), "Digitalisat: Staatsarchiv des Kantons Zürich, StAZH B II 441");
	assert.equal(rmImageCredit(null), "Digitalisat: Staatsarchiv des Kantons Zürich");
});
