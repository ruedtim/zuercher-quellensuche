/**
 * Unit-Tests für die reinen JSON-LD-Objekt-Bauer. Lauf:
 *   npx tsx --test src/lib/server/dts/objects.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SearchHit } from "../../types";
import { COLLECTION_MEMBER_FIELDS } from "./constants";
import {
	citableUnit,
	dublinCoreOf,
	navResource,
	resourceObject,
	rootObject,
	seriesObject,
	yearObject,
} from "./objects";
import { SITE_HOST } from "../../site";

const BASE = "https://example.org";

const DOC: SearchHit = {
	id: "RRB_1837_1395",
	series: "RRB",
	title: "Beschluss über die Strassenbaute",
	date: "1837-05-12",
	dateYear: 1837,
	startPg: null,
	volumeNr: null,
	serialNr: null,
	resolutionId: "1837/1395",
	stazhIdent: "StAZH MM 3.31 RRB 1837/1395",
	archiveLink: null,
	manifestUrl: null,
};

test("rootObject: Collection mit 5 Kindern (Serien inkl. Ratsmanuale), totalParents 0", () => {
	const root = rootObject(BASE);
	assert.equal(root["@id"], "corpus");
	assert.equal(root["@type"], "Collection");
	assert.equal(root.totalParents, 0);
	assert.equal(root.totalChildren, 5);
	assert.match(String(root.collection), /\/api\/dts\/collection\?id=corpus\{&page,nav\}/);
});

test("seriesObject: optionale description, totalChildren = Jahre", () => {
	const withDesc = seriesObject(BASE, "ABl", 167, "Amtsblatt-Beschreibung");
	assert.equal(withDesc["@id"], "ABl");
	assert.equal(withDesc["@type"], "Collection");
	assert.equal(withDesc.totalChildren, 167);
	assert.equal(withDesc.description, "Amtsblatt-Beschreibung");
	const noDesc = seriesObject(BASE, "ABl", 167);
	assert.equal("description" in noDesc, false);
});

test("yearObject: Titel + Doc-Count", () => {
	const y = yearObject(BASE, "ABl", 1834, 42);
	assert.equal(y["@id"], "ABl/1834");
	assert.equal(y.title, "Amtsblatt 1834");
	assert.equal(y.totalChildren, 42);
	assert.match(String(y.collection), /id=ABl%2F1834/);
});

test("resourceObject: @type Resource + Links + dublinCore", () => {
	const r = resourceObject(BASE, DOC);
	assert.equal(r["@id"], "RRB_1837_1395");
	assert.equal(r["@type"], "Resource");
	assert.equal(r.totalParents, 1);
	assert.match(String(r.navigation), /\/api\/dts\/navigation\?resource=RRB_1837_1395/);
	assert.match(String(r.document), /\/api\/dts\/document\?resource=RRB_1837_1395/);
	assert.ok(r.dublinCore);
	assert.equal(r.totalChildren, 0); // lesbare Collection ohne Unter-Collections
});

test("navResource: trägt eine flache CitationTree (maxCiteDepth 1)", () => {
	const nr = navResource(BASE, DOC);
	const trees = nr.citationTrees as Array<Record<string, unknown>>;
	assert.equal(trees.length, 1);
	assert.equal(trees[0]["@type"], "CitationTree");
	assert.equal(trees[0].maxCiteDepth, 1);
	const cite = trees[0].citeStructure as Array<Record<string, unknown>>;
	assert.equal(cite[0].citeType, "document");
});

test("citableUnit: identifier '1', level 1, parent null, citeType document", () => {
	const cu = citableUnit(DOC);
	assert.equal(cu.identifier, "1");
	assert.equal(cu["@type"], "CitableUnit");
	assert.equal(cu.level, 1);
	assert.equal(cu.parent, null);
	assert.equal(cu.citeType, "document");
});

test("dublinCoreOf: Sprach-getaggter Titel, publisher, date, source", () => {
	const dc = dublinCoreOf(DOC);
	assert.deepEqual(dc.title, [{ lang: "de", value: DOC.title }]);
	assert.deepEqual(dc.publisher, ["Staatsarchiv des Kantons Zürich"]);
	assert.deepEqual(dc.date, ["1837-05-12"]);
	assert.deepEqual(dc.isPartOf, ["Regierungsratsbeschlüsse"]);
	assert.deepEqual(dc.source, ["StAZH MM 3.31 RRB 1837/1395"]);
});

test("dublinCoreOf: Spätbestand nennt die publizierende Behörde, nicht das Staatsarchiv", () => {
	const late = { ...DOC, id: "RRB_2020_0123", subset: "rrb-late", stazhIdent: "RRB 2020/0123" };
	assert.deepEqual(dublinCoreOf(late).publisher, ["Regierungsrat des Kantons Zürich"]);
	assert.deepEqual(dublinCoreOf({ ...DOC, subset: "krp-late" }).publisher, ["Kantonsrat des Kantons Zürich"]);
	assert.deepEqual(dublinCoreOf({ ...DOC, subset: "os-late" }).publisher, ["Staatskanzlei des Kantons Zürich"]);
});

test("COLLECTION_MEMBER_FIELDS projiziert subset (sonst fällt der Publisher auf Staatsarchiv zurück)", () => {
	assert.ok((COLLECTION_MEMBER_FIELDS as readonly string[]).includes("subset"));
});

test("rootObject: Titel nennt nicht das Staatsarchiv als Herausgeber", () => {
	const root = rootObject(BASE);
	assert.equal(root.title, "Zentrale Serien des Kantons Zürich");
	assert.ok(String(root.description).includes(SITE_HOST));
});

test("dublinCoreOf: ohne date/stazhIdent fehlen die Felder", () => {
	const dc = dublinCoreOf({ ...DOC, date: null, stazhIdent: null });
	assert.equal("date" in dc, false);
	assert.equal("source" in dc, false);
});
