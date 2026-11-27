/**
 * Unit-Tests für Envelope/Hit-Mapping/Paginierungs-Links. Lauf:
 *   npx tsx --test src/lib/server/apiV1/respond.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	excerptFrom,
	fail,
	ok,
	paginationLinks,
	toApiEditions,
	toApiRelations,
	toDetailDoc,
	toListHit,
} from "./respond";
import type { EditionLink } from "../../editions";
import { ATTRIBUTION, LICENSE, WINDOW_MAX } from "./constants";
import type { DocRelation, SearchHit } from "../../types";
import { SITE_HOST } from "../../site";

const BASE = "https://zentraleserien.ch";

const hit: SearchHit = {
	id: "RRB_1803_0003",
	series: "RRB",
	title: "Ein Beschluss",
	date: "1803-04-12",
	dateYear: 1803,
	startPg: null,
	volumeNr: null,
	serialNr: null,
	resolutionId: "1803/0003",
	stazhIdent: "StAZH MM 1.1 RRB 1803/0003",
	archiveLink: "https://suche.staatsarchiv.djiktzh.ch/x",
	manifestUrl: "https://zszh.sources-online.org/manifests/RRB/x/info.json",
	subset: null,
	body: "Voller Text der nicht in Listen erscheinen darf",
	persons: ["Müller, Hans"],
	places: ["Zürich"],
	organizations: [],
	_formatted: {
		body: 'Anfang …<mark class="match">Hund</mark>e und <mark class="entity-match">Müller, Hans</mark>… Ende',
	},
	_rankingScore: 0.87,
};

test("excerptFrom strippt match- und entity-match-Marks, behält Text", () => {
	assert.equal(excerptFrom(hit), "Anfang …Hunde und Müller, Hans… Ende");
});

test("excerptFrom ohne _formatted → null", () => {
	assert.equal(excerptFrom({ ...hit, _formatted: undefined }), null);
});

test("toListHit: kein body, Links absolut, Score da", () => {
	const mapped = toListHit(hit, BASE);
	assert.ok(!("body" in mapped));
	assert.ok(!("persons" in mapped));
	assert.equal(mapped.score, 0.87);
	assert.equal(mapped.excerpt, "Anfang …Hunde und Müller, Hans… Ende");
	const links = mapped.links as Record<string, string>;
	assert.equal(links.self, `${BASE}/api/v1/documents/RRB_1803_0003`);
	assert.equal(links.web, `${BASE}/documents/RRB/RRB_1803_0003`);
});

test("toDetailDoc: Volltext + Link-Bündel, keine internen Felder", () => {
	const withInternal = {
		...hit,
		relativePath: "data/RRB/x.xml",
		_vectors: { jina_de: [0.1] },
	} as unknown as SearchHit;
	const mapped = toDetailDoc(withInternal, BASE);
	assert.equal(mapped.body, hit.body);
	assert.ok(!("relativePath" in mapped));
	assert.ok(!("_vectors" in mapped));
	assert.ok(!("_formatted" in mapped));
	const links = mapped.links as Record<string, string | null>;
	assert.equal(links.html, `${BASE}/render/RRB/RRB_1803_0003.html`);
	assert.equal(links.xml, `${BASE}/xml/RRB/RRB_1803_0003.xml`);
	assert.equal(links.zip, `${BASE}/api/document/RRB/RRB_1803_0003/package`);
	assert.equal(links.iiifManifest, hit.manifestUrl);
	assert.equal(links.similar, `${BASE}/api/v1/documents/RRB_1803_0003/similar`);
});

test("ok(): Envelope mit Lizenz/Attribution", async () => {
	const res = ok([1, 2], { total: 2 });
	assert.equal(res.status, 200);
	const body = (await res.json()) as { data: number[]; meta: Record<string, unknown> };
	assert.deepEqual(body.data, [1, 2]);
	assert.equal(body.meta.total, 2);
	assert.equal(body.meta.license, LICENSE);
	assert.equal(body.meta.attribution, ATTRIBUTION);
	// Quelle und Plattform getrennt: das Staatsarchiv ist Datenquelle, nicht Betreiber.
	assert.ok(String(body.meta.attribution).includes(`Plattform: ${SITE_HOST} `));
	// Kein eigenes «Quelle:»-Präfix (IIIF-requiredStatement setzt das Label schon).
	assert.doesNotMatch(String(body.meta.attribution), /^Quelle:/);
});

test("fail(): Fehler-Shape mit Status", async () => {
	const res = fail(404, "not_found", "Document 'X' not found.");
	assert.equal(res.status, 404);
	const body = (await res.json()) as { error: Record<string, unknown> };
	assert.equal(body.error.code, "not_found");
	assert.equal(body.error.status, 404);
});

test("paginationLinks: Mitte hat prev+next, Query-Parameter bleiben", () => {
	const sp = new URLSearchParams("q=Hund&offset=40&limit=20");
	const links = paginationLinks(BASE, "/api/v1/documents", sp, 40, 20, 500);
	assert.match(links.self, /offset=40/);
	assert.match(links.next!, /offset=60/);
	assert.match(links.next!, /q=Hund/);
	assert.match(links.prev!, /offset=20/);
});

test("paginationLinks: offset 0 ohne prev, offset-Param entfällt", () => {
	const sp = new URLSearchParams("q=Hund");
	const links = paginationLinks(BASE, "/api/v1/documents", sp, 0, 20, 500);
	assert.equal(links.prev, null);
	assert.ok(!links.self.includes("offset="));
	assert.match(links.next!, /offset=20/);
});

test("paginationLinks: next endet am Blätter-Fenster", () => {
	const sp = new URLSearchParams(`offset=${WINDOW_MAX - 20}&limit=20`);
	const links = paginationLinks(
		BASE,
		"/api/v1/documents",
		sp,
		WINDOW_MAX - 20,
		20,
		1_000_000,
	);
	assert.equal(links.next, null, "letzte Seite im Fenster hat kein next");
});

test("paginationLinks: next endet an der Treffermenge", () => {
	const sp = new URLSearchParams("limit=20");
	const links = paginationLinks(BASE, "/api/v1/documents", sp, 0, 20, 15);
	assert.equal(links.next, null);
});

test("toApiRelations: internes Ziel → document mit Links, externes → null, Label, Selbstverweis weg", () => {
	const target: SearchHit = {
		...hit,
		id: "OS_46__S__770-778__t",
		series: "OS",
		title: "Original-Verordnung",
		date: "1977-06-22",
		archiveId: 3460269,
	};
	const relations: DocRelation[] = [
		{ name: "Änderung_von", targetId: 3460269, url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?Id=3460269" },
		{ name: "Siehe", targetId: 999, url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?Id=999" },
		{ name: "Foo_bar", targetId: 1, url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?Id=1" },
	];
	const targets = new Map<number, SearchHit>([
		[3460269, target],
		[1, { ...hit, id: "SELF", archiveId: 1 }], // Ziel == aktuelles Doc
	]);
	const out = toApiRelations(relations, BASE, targets, "SELF");
	// Selbstverweis (targetId 1 → id "SELF") fällt raus → 2 Einträge
	assert.equal(out.length, 2);
	const byType = Object.fromEntries(out.map((r) => [r.type, r]));
	const aend = byType["Änderung_von"];
	assert.equal(aend.label, "Ändert");
	assert.equal(aend.archiveId, 3460269);
	assert.equal(aend.document?.id, "OS_46__S__770-778__t");
	assert.equal(aend.document?.links.self, `${BASE}/api/v1/documents/OS_46__S__770-778__t`);
	assert.equal(aend.document?.links.web, `${BASE}/documents/OS/OS_46__S__770-778__t`);
	const siehe = byType["Siehe"];
	assert.equal(siehe.label, "Siehe auch");
	assert.equal(siehe.document, null); // Ziel nicht im Korpus
	assert.equal(siehe.catalogUrl, "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?Id=999");
});

test("toDetailDoc: relations default [] und werden durchgereicht", () => {
	assert.deepEqual(toDetailDoc(hit, BASE).relations, []);
	const rels = toApiRelations(
		[{ name: "Siehe", targetId: null, url: "https://x" }],
		BASE,
		new Map(),
		hit.id,
	);
	assert.equal((toDetailDoc(hit, BASE, rels).relations as unknown[]).length, 1);
});

const QZH_401: EditionLink = {
	edition: "qzh",
	id: "QZH_401",
	label: "QZH_401",
	url: "https://qzh.sources-online.org/quellenstuecke/QZH_401",
	witness: false,
	title: "Ratsbeschluss betreffend Verfolgung von Täufern",
};

test("toApiEditions: Zitierform, Rolle, Lizenz und Nennung je Edition", () => {
	const nr47: EditionLink = {
		edition: "ssrq",
		id: "SSRQ_ZH_NF_II_3_047_2",
		label: "SSRQ ZH NF II/3 Nr. 47",
		url: "https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_047",
		witness: true,
		title: null,
	};
	const [q, s] = toApiEditions([QZH_401, nr47]);
	assert.deepEqual(q, {
		edition: "qzh",
		editionName: "Quellen zur Zürcher Geschichte",
		id: "QZH_401",
		label: "QZH_401",
		url: QZH_401.url,
		relation: "edition",
		title: QZH_401.title,
		license: "CC BY 4.0",
		licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
		attribution: "Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH)",
	});
	assert.equal(s.relation, "witness");
	assert.equal(s.license, "CC BY 4.0");
	assert.equal(s.title, null);
});

test("toDetailDoc: editions default [] und werden durchgereicht", () => {
	assert.deepEqual(toDetailDoc(hit, BASE).editions, []);
	assert.deepEqual(toDetailDoc(hit, BASE, [], [QZH_401]).editions, toApiEditions([QZH_401]));
});
