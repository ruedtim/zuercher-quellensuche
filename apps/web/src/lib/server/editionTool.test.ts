// Lauf: npx tsx --test src/lib/server/editionTool.test.ts
// Nur ausgedachte Stücke (kein Editionstext im Repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDITION_TOOL_PARAMETERS, normalizeEditionArgs } from "./editionTool";

test("Argumente: Defaults, Edition nur aus dem Index, Jahre getauscht und gekappt, topK gedeckelt", () => {
	const empty = normalizeEditionArgs({});
	assert.equal(empty.q, "");
	assert.equal(empty.semantic, false);
	assert.equal(empty.sort, "relevance");
	assert.equal(empty.limit, 8);
	assert.deepEqual(empty.criteria, []);

	const q = normalizeEditionArgs({
		query: "  töuffer   Grüningen ",
		semantic: true,
		edition: "qzh",
		person: "Heinrich Bullinger",
		place: "Grüningen",
		keyword: "Täufertum",
		dateFrom: 1600,
		dateTo: "1570",
		sort: "date_desc",
		topK: 99,
	});
	assert.equal(q.q, "töuffer Grüningen");
	assert.equal(q.semantic, true);
	assert.equal(q.sort, "date_desc");
	assert.equal(q.limit, 20);
	assert.deepEqual(q.filters, { edition: ["qzh"], part: [], keyword: ["Täufertum"], facs: false });
	assert.deepEqual(q.shared, { dateFrom: 1570, dateTo: 1600, persons: ["Heinrich Bullinger"], places: ["Grüningen"], organizations: [] });
	assert.deepEqual(q.criteria, ["nach Bedeutung «töuffer Grüningen»", "Edition QZH", "Person «Heinrich Bullinger»", "Ort «Grüningen»", "Schlagwort «Täufertum»", "1570–1600"]);

	// Nach Bedeutung nur mit Wörtern; unbekannte Edition und Sortierung fallen weg; Jahre gekappt.
	const odd = normalizeEditionArgs({ semantic: true, edition: "erqzh", sort: "title", dateFrom: 12, dateTo: 3000, topK: 0 });
	assert.equal(odd.semantic, false);
	assert.deepEqual(odd.filters.edition, []);
	assert.equal(odd.sort, "relevance");
	assert.equal(odd.shared.dateFrom, 700);
	assert.equal(odd.shared.dateTo, 2100);
	assert.equal(odd.limit, 1);
	assert.deepEqual(normalizeEditionArgs({ topK: 5 }, { maxTopK: 3 }).limit, 3);
	// Das Schema bietet nur Editionen aus dem Index an.
	assert.deepEqual([...EDITION_TOOL_PARAMETERS.properties.edition.enum], ["qzh", "ssrq"]);
});
