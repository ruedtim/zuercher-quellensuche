/**
 * Unit-Tests für die DTS-Parameter-Parser. Lauf:
 *   npx tsx --test src/lib/server/dts/params.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	isParamError,
	parseCollectionQuery,
	parseDocumentQuery,
	parseNavigationQuery,
} from "./params";

const u = (path: string, qs: string) => new URL(`https://example.org/api/dts/${path}${qs}`);

// --- Collection -------------------------------------------------------------

test("collection: leere Query → root-Defaults", () => {
	const r = parseCollectionQuery(u("collection", ""));
	assert.ok(!isParamError(r));
	assert.equal(r.id, null);
	assert.equal(r.page, 1);
	assert.equal(r.nav, "children");
});

test("collection: id + nav=parents", () => {
	const r = parseCollectionQuery(u("collection", "?id=ABl&nav=parents"));
	assert.ok(!isParamError(r));
	assert.equal(r.id, "ABl");
	assert.equal(r.nav, "parents");
});

test("collection: nav-Whitelist, page-Validierung", () => {
	assert.ok(isParamError(parseCollectionQuery(u("collection", "?nav=foo"))));
	assert.ok(isParamError(parseCollectionQuery(u("collection", "?page=0"))));
	assert.ok(isParamError(parseCollectionQuery(u("collection", "?page=abc"))));
	const ok = parseCollectionQuery(u("collection", "?page=3"));
	assert.ok(!isParamError(ok));
	assert.equal(ok.page, 3);
});

// --- Navigation -------------------------------------------------------------

test("navigation: resource Pflicht", () => {
	assert.ok(isParamError(parseNavigationQuery(u("navigation", ""))));
	const ok = parseNavigationQuery(u("navigation", "?resource=RRB_1837_1395"));
	assert.ok(!isParamError(ok));
	assert.equal(ok.resource, "RRB_1837_1395");
	assert.equal(ok.ref, null);
	assert.equal(ok.down, null);
	assert.equal(ok.page, 1);
});

test("navigation: ref ⊥ start/end", () => {
	const r = parseNavigationQuery(u("navigation", "?resource=X&ref=1&start=1"));
	assert.ok(isParamError(r));
	assert.match(r.message, /ref/);
});

test("navigation: start ohne end → Fehler", () => {
	assert.ok(isParamError(parseNavigationQuery(u("navigation", "?resource=X&start=1"))));
	const ok = parseNavigationQuery(u("navigation", "?resource=X&start=1&end=1"));
	assert.ok(!isParamError(ok));
	assert.equal(ok.start, "1");
	assert.equal(ok.end, "1");
});

test("navigation: down=-1 erlaubt, down=abc → Fehler", () => {
	const ok = parseNavigationQuery(u("navigation", "?resource=X&down=-1"));
	assert.ok(!isParamError(ok));
	assert.equal(ok.down, -1);
	assert.ok(isParamError(parseNavigationQuery(u("navigation", "?resource=X&down=abc"))));
});

// --- Document ---------------------------------------------------------------

test("document: resource Pflicht, mediaType passthrough", () => {
	assert.ok(isParamError(parseDocumentQuery(u("document", ""))));
	const ok = parseDocumentQuery(u("document", "?resource=X&mediaType=text/html"));
	assert.ok(!isParamError(ok));
	assert.equal(ok.resource, "X");
	assert.equal(ok.mediaType, "text/html");
});

test("document: ref ⊥ start/end", () => {
	assert.ok(isParamError(parseDocumentQuery(u("document", "?resource=X&ref=1&end=1"))));
});
