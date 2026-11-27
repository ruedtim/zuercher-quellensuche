/**
 * Unit-Tests für den Collection-Identifier-Raum + die URI-Templates. Lauf:
 *   npx tsx --test src/lib/server/dts/ids.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	collectionIdOf,
	collectionLinkFor,
	collectionTemplate,
	documentLinkFor,
	documentTemplate,
	navigationLinkFor,
	navigationTemplate,
	parseCollectionId,
} from "./ids";

const BASE = "https://example.org";

test("parseCollectionId: root (leer/null/'corpus')", () => {
	for (const id of ["", null, undefined, "corpus", "  "]) {
		assert.deepEqual(parseCollectionId(id), { kind: "root" });
	}
});

test("parseCollectionId: Serie", () => {
	assert.deepEqual(parseCollectionId("ABl"), { kind: "series", series: "ABl" });
	assert.deepEqual(parseCollectionId("RRB"), { kind: "series", series: "RRB" });
});

test("parseCollectionId: Jahr", () => {
	assert.deepEqual(parseCollectionId("ABl/1834"), { kind: "year", series: "ABl", year: 1834 });
	assert.deepEqual(parseCollectionId("OS/1803"), { kind: "year", series: "OS", year: 1803 });
});

test("parseCollectionId: Dokument (kein Slash, keine Serie)", () => {
	assert.deepEqual(parseCollectionId("RRB_1837_1395"), { kind: "document", id: "RRB_1837_1395" });
	assert.deepEqual(parseCollectionId("MM_1_1_KRP_1823_01"), {
		kind: "document",
		id: "MM_1_1_KRP_1823_01",
	});
});

test("parseCollectionId: ungültige Jahr-Form → null", () => {
	for (const id of ["ABl/", "OS/abc", "XYZ/1834", "ABl/1834/x", "/1834"]) {
		assert.equal(parseCollectionId(id), null, id);
	}
});

test("collectionIdOf: Round-Trip", () => {
	for (const id of ["corpus", "ABl", "ABl/1834", "RRB_1837_1395"]) {
		const node = parseCollectionId(id);
		assert.ok(node);
		assert.equal(collectionIdOf(node), id);
	}
});

test("Entry-Templates tragen die RFC-6570-Variablen", () => {
	assert.equal(collectionTemplate(BASE), `${BASE}/api/dts/collection{?id,page,nav}`);
	assert.equal(
		navigationTemplate(BASE),
		`${BASE}/api/dts/navigation{?resource,ref,start,end,down,tree,page}`,
	);
	assert.equal(
		documentTemplate(BASE),
		`${BASE}/api/dts/document{?resource,ref,start,end,tree,mediaType}`,
	);
});

test("Link-Bauer binden id/resource und encodieren", () => {
	assert.equal(
		collectionLinkFor(BASE, { kind: "year", series: "ABl", year: 1834 }),
		`${BASE}/api/dts/collection?id=ABl%2F1834{&page,nav}`,
	);
	assert.equal(
		navigationLinkFor(BASE, "RRB_1837_1395"),
		`${BASE}/api/dts/navigation?resource=RRB_1837_1395{&ref,start,end,down,tree,page}`,
	);
	assert.equal(
		documentLinkFor(BASE, "RRB_1837_1395"),
		`${BASE}/api/dts/document?resource=RRB_1837_1395{&ref,start,end,tree,mediaType}`,
	);
});
