import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCatalogApiParams, toCatalogItem } from "./catalog";
import { isParamError } from "./params";

const u = (qs: string) => new URL(`https://zentraleserien.ch/api/v1/catalog?${qs}`);

test("Parameter: Defaults, Zeitraum vor 1483, wiederholte Filter", () => {
	const r = parseCatalogApiParams(u("q=Mühle&dateFrom=1250&level=Dokument&level=Dossier&bestand=C%20I&digital=true&facets=level,bestand"));
	assert.ok(!isParamError(r));
	if (isParamError(r)) return;
	assert.equal(r.q, "Mühle");
	assert.equal(r.sort, "relevance");
	assert.equal(r.offset, 0);
	assert.equal(r.limit, 20);
	assert.deepEqual(r.filters, { active: true, dateFrom: 1250, dateTo: null, level: ["Dokument", "Dossier"], bestand: ["C I"], digital: true });
	assert.deepEqual(r.facets, ["level", "bestand"]);
});

test("Parameter: Namen aus dem Register, Varianten einmal", () => {
	const r = parseCatalogApiParams(u("person=Anna%20Meier&person=Meyer,%20Anna&person=Jakob%20Huber&place=Gemeinde%20Uster&organization=Escher%20Wyss%20AG"));
	assert.ok(!isParamError(r));
	if (isParamError(r)) return;
	assert.deepEqual(r.filters.entities, { person: ["Anna Meier", "Jakob Huber"], place: ["Gemeinde Uster"], org: ["Escher Wyss AG"] });
	const none = parseCatalogApiParams(u("q=x"));
	assert.ok(!isParamError(none) && none.filters.entities === undefined);
});

test("Parameter: ungültige Werte ergeben 400-Fehler", () => {
	const many = Array.from({ length: 21 }, (_, i) => `place=Ort${i}`).join("&");
	for (const qs of [
		"limit=0",
		"limit=101",
		"offset=995&limit=10",
		"dateFrom=1900&dateTo=1800",
		"sort=alpha",
		"digital=yes",
		"facets=series",
		"dateFrom=abc",
		"person=Meier",
		"organization=AG",
		many,
	]) {
		const r = parseCatalogApiParams(u(qs));
		assert.ok(isParamError(r), qs);
	}
	const w = parseCatalogApiParams(u("offset=995&limit=10"));
	assert.ok(isParamError(w) && w.code === "pagination_window_exceeded");
});

const raw = {
	id: 588692,
	signature: "Z 403.1504",
	title: "Musterhof",
	text: "Reglement zur Bewirtschaftung des Musterhofs.",
	level: "Dossier",
	dateText: "1918 - 1959",
	dateFrom: 1918,
	dateTo: 1959,
	bestand: "Musteranstalt, 1828-2008 (Bestand)",
	path: [{ id: 1, label: "Musteranstalt, 1828-2008 (Bestand)" }],
	provenienz: "Direktion der Justiz",
	hasDigitization: true,
	files: [{ name: "x.pdf", url: "https://suche.staatsarchiv.djiktzh.ch/Dateien/1/D1.pdf", kind: "file" }],
	url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=588692",
	_formatted: { text: 'Reglement zur <mark class="match">Bewirtschaftung</mark> …' },
	// Interne Felder, die nie hinaus dürfen:
	persons: ["Hans Muster"],
	krdbNameIds: [1],
	personKeys: ["hans muster"],
};

test("Mapper: Allowlist, Auszug in Listen, Volltext in der Einzelansicht", () => {
	const list = toCatalogItem(raw, "https://zentraleserien.ch", { full: false });
	assert.equal(list.excerpt, "Reglement zur Bewirtschaftung …");
	assert.equal(list.text, undefined);
	assert.equal(list.document, null);
	assert.deepEqual(list.links, {
		self: "https://zentraleserien.ch/api/v1/catalog/588692",
		web: "https://zentraleserien.ch/archivkatalog/588692",
		catalog: raw.url,
	});
	assert.deepEqual((list.path as Array<{ url: string }>)[0].url, "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1");
	for (const key of ["persons", "krdbNameIds", "personKeys", "_formatted"]) assert.equal(key in list, false, key);

	const full = toCatalogItem(
		{ ...raw, onPlatform: true, docId: "MM_3_45_RRB_1931_1864_t", docSeries: "RRB" },
		"https://zentraleserien.ch",
		{ full: true },
	);
	assert.equal(full.text, raw.text);
	assert.equal(full.excerpt, undefined);
	assert.deepEqual(full.editions, []);
	assert.equal("editions" in list, false);
	assert.deepEqual(full.document, {
		id: "MM_3_45_RRB_1931_1864_t",
		series: "RRB",
		relation: "depicts",
		links: {
			self: "https://zentraleserien.ch/api/v1/documents/MM_3_45_RRB_1931_1864_t",
			web: "https://zentraleserien.ch/documents/RRB/MM_3_45_RRB_1931_1864_t",
		},
	});
	assert.equal("onPlatform" in full, false);

	// Eigene Einheit mit Weblink auf ein Dokument (Urkunde zum Beschluss): nur ein Verweis.
	const ref = toCatalogItem({ ...raw, onPlatform: false, docId: "MM_2_1_RRB_1831_0531", docSeries: "RRB" }, "https://zentraleserien.ch", {
		full: false,
	});
	assert.equal((ref.document as { relation: string }).relation, "references");

	// Einzelansicht mit Verweis auf eine Edition: Lizenz der Edition je Eintrag.
	const edited = toCatalogItem(raw, "https://zentraleserien.ch", {
		full: true,
		editions: [
			{
				edition: "ssrq",
				id: "SSRQ_ZH_NF_II_3_040",
				label: "SSRQ ZH NF II/3 Nr. 40",
				url: "https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_040",
				witness: false,
				title: null,
			},
		],
	});
	assert.deepEqual(
		(edited.editions as Array<{ label: string; relation: string; license: string }>).map((e) => [e.label, e.relation, e.license]),
		[["SSRQ ZH NF II/3 Nr. 40", "edition", "CC BY 4.0"]],
	);
});
