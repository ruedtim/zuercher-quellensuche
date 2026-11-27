// Lauf: npx tsx --test src/lib/server/apiV1/editions.test.ts
// Nur ausgedachte Stücke im Format der QZH (kein Editionstext im Repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EditionHit, EditionUnit } from "../../editionTexts";
import { editionsFacetsMeta, parseEditionsApiParams, plainEditionHtml, toEditionItem, toEditionListItem } from "./editions";
import { isParamError } from "./params";
import { okEditions } from "./respond";

const u = (qs: string) => new URL(`https://zentraleserien.ch/api/v1/editions?${qs}`);
const BASE = "https://zentraleserien.ch";

test("Parameter: Defaults, Filter, Namen, Facetten", () => {
	const r = parseEditionsApiParams(
		u(
			"q=t%C3%B6uffer&edition=qzh&part=Gelebte%20Reformation&keyword=T%C3%A4ufertum&keyword=T%C3%A4ufertum&person=Heinrich%20Bullinger&place=Gr%C3%BCningen&organization=Rat&dateFrom=1570&dateTo=1590&facsimile=true&sort=date_desc&facets=part,keyword,part",
		),
	);
	assert.ok(!isParamError(r));
	if (isParamError(r)) return;
	assert.equal(r.q, "töuffer");
	assert.equal(r.sort, "date_desc");
	assert.equal(r.offset, 0);
	assert.equal(r.limit, 20);
	assert.deepEqual(r.filters, { edition: ["qzh"], part: ["Gelebte Reformation"], keyword: ["Täufertum"], facs: true });
	assert.deepEqual(r.shared, { dateFrom: 1570, dateTo: 1590, persons: ["Heinrich Bullinger"], places: ["Grüningen"], organizations: ["Rat"] });
	assert.deepEqual(r.facets, ["part", "keyword"]);

	const empty = parseEditionsApiParams(u("unbekannt=1"));
	assert.ok(!isParamError(empty));
	if (isParamError(empty)) return;
	assert.equal(empty.sort, "relevance");
	assert.deepEqual(empty.filters, { edition: [], part: [], keyword: [], facs: false });
	assert.deepEqual(empty.shared, { dateFrom: null, dateTo: null, persons: [], places: [], organizations: [] });
});

test("Parameter: ungültige Werte geben 400", () => {
	const ssrq = parseEditionsApiParams(u("edition=ssrq&part=SSRQ%20ZH%20NF%20II%2F3%3A%20Die%20Landvogtei%20Greifensee"));
	assert.ok(!isParamError(ssrq) && ssrq.filters.edition.join() === "ssrq", "edition=ssrq ist gültig");
	for (const qs of [
		"edition=erqzh",
		"edition=xyz",
		"facsimile=ja",
		"sort=title",
		"dateFrom=1600&dateTo=1500",
		"dateFrom=500",
		"facets=persons",
		"limit=0",
		"offset=990&limit=20",
		Array.from({ length: 21 }, (_, i) => `person=P${i}`).join("&"),
	]) {
		const r = parseEditionsApiParams(u(qs));
		assert.ok(isParamError(r), qs);
	}
	const window = parseEditionsApiParams(u("offset=990&limit=20"));
	assert.ok(isParamError(window) && window.code === "pagination_window_exceeded");
});

test("Facetten unter den Namen der API", () => {
	assert.deepEqual(
		editionsFacetsMeta({ part: { "Gelebte Reformation": 12 }, keywords: { Täufertum: 400 }, hasFacsimile: { true: 356, false: 434 } }, ["keyword", "facsimile", "edition"]),
		{ keyword: { Täufertum: 400 }, facsimile: { true: 356, false: 434 }, edition: {} },
	);
});

test("HTML-Felder als Text: Tags weg, Entitäten aufgelöst, Leerraum zusammengezogen", () => {
	assert.equal(plainEditionHtml('Der <span class="ed-person" data-ref="x">Rat</span>\n beschliesst &amp; &lt;so&gt;.'), "Der Rat beschliesst & <so>.");
});

const hit: EditionHit = {
	id: "qzh-QZH_999",
	edition: "qzh",
	localId: "QZH_999",
	label: "QZH_999",
	title: "Ausgedachter Ratsbeschluss",
	titleHtml: "Ausgedachter Ratsbeschluss",
	textHtml: 'der rat <mark class="match">beschloss</mark> …',
	permalink: "https://qzh.sources-online.org/quellenstuecke/QZH_999",
	part: "Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5",
	signature: "StAZH X 1.2, Nr. 3",
	isoFrom: "1583-09-21",
	isoTo: "1583-09-21",
	dateFrom: 1583,
	dateTo: 1583,
	keywords: ["Täufertum"],
	hasFacsimile: true,
};

test("Listen-Treffer: Allowlist mit Lizenz und Nennung je Stück, Links", () => {
	const item = toEditionListItem(hit, BASE);
	assert.deepEqual(item, {
		edition: "qzh",
		editionName: "Quellen zur Zürcher Geschichte",
		id: "QZH_999",
		label: "QZH_999",
		title: "Ausgedachter Ratsbeschluss",
		part: "Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5",
		date: { text: "21.9.1583", from: "1583-09-21", to: "1583-09-21", yearFrom: 1583, yearTo: 1583 },
		signature: "StAZH X 1.2, Nr. 3",
		keywords: ["Täufertum"],
		hasFacsimile: true,
		excerpt: "der rat beschloss …",
		url: "https://qzh.sources-online.org/quellenstuecke/QZH_999",
		license: "CC BY 4.0",
		licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
		attribution: "Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH)",
		imagesLicense: "gemeinfrei",
		imagesLicenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/deed.de",
		links: {
			self: "https://zentraleserien.ch/api/v1/editions/qzh/QZH_999",
			web: "https://zentraleserien.ch/editionen/qzh/QZH_999",
			edition: "https://qzh.sources-online.org/quellenstuecke/QZH_999",
			iiifManifest: "https://zentraleserien.ch/editionen/qzh/QZH_999/manifest.json",
		},
	});
	const plain = toEditionListItem({ ...hit, hasFacsimile: false, textHtml: "", part: "", signature: "" }, BASE);
	assert.equal(plain.excerpt, null);
	assert.equal(plain.part, null);
	assert.equal((plain.links as Record<string, unknown>).iiifManifest, null);
});

const unit: EditionUnit = {
	id: "qzh-QZH_999",
	edition: "qzh",
	localId: "QZH_999",
	label: "QZH_999",
	nr: 999,
	permalink: "https://qzh.sources-online.org/quellenstuecke/QZH_999",
	title: "Ausgedachter Ratsbeschluss",
	part: "Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5",
	editors: ["Hanna Herausgeberin"],
	transcription: ["Erika Muster"],
	tagging: ["Max Probe"],
	publisher: "Staatsarchiv des Kantons Zürich",
	published: "2021-05-01",
	signature: "StAZH X 1.2, Nr. 3",
	sourceUrl: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1234567",
	catalogIds: [1234567],
	textLang: ["Deutsch"],
	filiation: "Eintrag",
	physical: [],
	origPlace: "Zürich",
	witnesses: [],
	sourceFile: "quellenstuecke/QZH_999.xml",
	isoFrom: "1583-09-21",
	isoTo: "1583-09-21",
	calendar: null,
	dateFrom: 1583,
	dateTo: 1583,
	bibl: [{ head: "Edition", html: "QGTS, Bd. 5, Nr. 12", text: "QGTS, Bd. 5, Nr. 12" }],
	keywords: ["Täufertum"],
	keywordGlosses: {},
	entitySource: "edition",
	regestHtml: 'Der <span class="ed-person">Rat</span> beschliesst.',
	html: '<p>der rat<sup class="ed-note-ref"><a href="#ed-note-n1">1</a></sup> beschloss</p>',
	backHtml: "<div><p>Kommentar &amp; mehr.</p></div>",
	notes: [{ key: "n1", label: "1", type: "editorial", html: "Kleiner Rat", inBack: false }],
	persons: [{ name: "Hans Kriesi", gnd: "123", forms: ["Hans Kriesi"], count: 2 }],
	places: [{ name: "Grüningen", lat: 47.28, lon: 8.76, forms: ["Gruͤningen"], count: 1 }],
	orgs: [],
	pages: [
		{ n: "1", image: 0 },
		{ n: "2", image: null },
	],
	facs: [{ service: "https://media.sources-online.org/iiif/2/qzh!Bild_1.tif", width: 2000, height: 3000, n: "1" }],
	text: "der rat beschloss",
	comment: "Kommentar & mehr.",
};

test("Einzelstück: Lesefassung, Text der Edition, Anmerkungen, Register, Bilder, Lizenz", () => {
	const item = toEditionItem(unit, BASE);
	assert.equal(item.id, "QZH_999");
	assert.equal(item.number, 999);
	assert.equal(item.text, "der rat beschloss");
	assert.equal(item.html, unit.html);
	assert.equal(item.regest, "Der Rat beschliesst.");
	assert.equal(item.comment, "Kommentar & mehr.");
	assert.deepEqual(item.notes, [{ label: "1", type: "editorial", inCommentary: false, text: "Kleiner Rat" }]);
	assert.deepEqual(item.catalog, [{ id: 1234567, links: { self: `${BASE}/api/v1/catalog/1234567`, web: `${BASE}/archivkatalog/1234567` } }]);
	assert.deepEqual(item.persons, [{ name: "Hans Kriesi", gnd: "123", forms: ["Hans Kriesi"], mentions: 2 }]);
	assert.deepEqual(item.pages, [
		{ label: "1", image: 0 },
		{ label: "2", image: null },
	]);
	assert.deepEqual(item.images, [{ label: "1", service: unit.facs[0].service, width: 2000, height: 3000, credit: null }]);
	assert.equal(item.license, "CC BY 4.0");
	assert.equal(item.imagesLicense, "gemeinfrei");
	assert.equal((item.links as Record<string, unknown>).iiifManifest, `${BASE}/editionen/qzh/QZH_999/manifest.json`);
	// Keine Index-Felder (Schlüssel, Vektoren, Suchformen ausser text) in der Antwort.
	for (const k of ["personKeys", "placeKeys", "_vectors", "noteText", "embedded"]) assert.ok(!(k in item), k);
});

test("Einzelstück der Rechtsquellen: Zitierform, Kalender, weitere Überlieferungen, Lizenz", () => {
	const ssrq: EditionUnit = {
		...unit,
		id: "ssrq-SSRQ_ZH_NF_II_9_007",
		edition: "ssrq",
		localId: "SSRQ_ZH_NF_II_9_007",
		label: "SSRQ ZH NF II/9 Nr. 7",
		nr: 7,
		permalink: "https://rechtsquellen.sources-online.org/ZH_NF_II_9/SSRQ_ZH_NF_II_9_007",
		part: "SSRQ ZH NF II/9: Ausgedachter Band",
		sourceFile: "ZH_NF_II_9/SSRQ_ZH_NF_II_9_007_1.xml",
		calendar: "julian",
		witnesses: [
			{
				textId: "SSRQ_ZH_NF_II_9_007_2",
				signature: "StAZH Y 9, S. 1",
				sourceUrl: null,
				catalogIds: [7654321],
				filiation: "Abschrift",
				physical: [],
				isoFrom: "1601-02-03",
				isoTo: null,
				textLang: ["Deutsch"],
			},
		],
		keywordGlosses: { Offnung: "Aufzeichnung der Rechte" },
		facs: [],
		pages: [],
	};
	const item = toEditionItem(ssrq, BASE);
	assert.equal(item.id, "SSRQ_ZH_NF_II_9_007");
	assert.equal(item.label, "SSRQ ZH NF II/9 Nr. 7");
	assert.equal(item.calendar, "julian");
	assert.deepEqual(item.witnesses, [
		{
			textId: "SSRQ_ZH_NF_II_9_007_2",
			signature: "StAZH Y 9, S. 1",
			date: { text: "3.2.1601", from: "1601-02-03", to: null },
			catalogIds: [7654321],
			sourceUrl: null,
			filiation: "Abschrift",
			physical: [],
			languages: ["Deutsch"],
		},
	]);
	assert.deepEqual(item.keywordGlosses, { Offnung: "Aufzeichnung der Rechte" });
	assert.equal(item.license, "CC BY 4.0");
	assert.ok(!("imagesLicense" in item));
	assert.equal((item.links as Record<string, unknown>).iiifManifest, null);
	assert.equal((item.links as Record<string, unknown>).web, `${BASE}/editionen/ssrq/SSRQ_ZH_NF_II_9_007`);
});

test("Envelope: Hinweis im meta, keine Lizenz der amtlichen Serien", async () => {
	const res = okEditions([], { total: 0 });
	const body = (await res.json()) as { meta: Record<string, unknown> };
	assert.equal(body.meta.total, 0);
	assert.match(String(body.meta.note), /Lizenz und Nennung stehen an jedem Stück/);
	assert.ok(!("license" in body.meta));
});
