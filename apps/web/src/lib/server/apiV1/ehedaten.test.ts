// Lauf: npx tsx --test src/lib/server/apiV1/ehedaten.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EhedatenEntry } from "../../ehedaten";
import { ehedatenFacetsMeta, parseEhedatenApiParams, toEhedatenItem } from "./ehedaten";
import { isParamError } from "./params";
import { okEhedaten } from "./respond";

const u = (qs: string) => new URL(`https://zentraleserien.ch/api/v1/ehedaten?${qs}`);

test("Parameter: Defaults, Namen mit Rolle, Herkunft, Filter, Facetten", () => {
	const r = parseEhedatenApiParams(
		u(
			"q=Witwer&name=Heusser&name=Heusser&braeutigam=Hans%20Jakob%20Heusser&braut=Meier&herkunft=Thurgau&kirchgemeinde=Stadt%20Z%C3%BCrich&kirchgemeinde=Uster&raum=ch&quelle=E%20III&art=verkuendung&band=E%20III%20117.1&dateFrom=1650&dateTo=1700&sort=date_desc&facets=kirchgemeinde,jahrzehnt,kirchgemeinde",
		),
	);
	assert.ok(!isParamError(r));
	if (isParamError(r)) return;
	assert.equal(r.q, "Witwer");
	assert.equal(r.sort, "date_desc");
	assert.equal(r.offset, 0);
	assert.equal(r.limit, 20);
	assert.deepEqual(r.filters, {
		mann: ["Hans Jakob Heusser"],
		frau: ["Meier"],
		kirche: ["Stadt Zürich", "Uster"],
		raum: ["ch"],
		quelle: ["E III"],
		art: "verkuendung",
		band: ["E III 117.1"],
	});
	assert.deepEqual(r.shared, { dateFrom: 1650, dateTo: 1700, persons: ["Heusser"], places: ["Thurgau"] });
	assert.deepEqual(r.facets, ["kirchgemeinde", "jahrzehnt"]);

	const empty = parseEhedatenApiParams(u("unbekannt=1"));
	assert.ok(!isParamError(empty));
	if (isParamError(empty)) return;
	assert.equal(empty.sort, "relevance");
	assert.deepEqual(empty.shared, { dateFrom: null, dateTo: null, persons: [], places: [] });
	assert.equal(empty.filters.art, null);
	assert.deepEqual(empty.facets, []);
});

test("Parameter: ungültige Werte ergeben 400-Fehler, Fenster als eigener Code", () => {
	const many = Array.from({ length: 21 }, (_, i) => `kirchgemeinde=K${i}`).join("&");
	for (const qs of [
		"limit=0",
		"limit=101",
		"offset=995&limit=10",
		"dateFrom=1400",
		"dateTo=1801",
		"dateFrom=1700&dateTo=1650",
		"dateFrom=abc",
		"sort=alpha",
		"art=hochzeit",
		"raum=mond",
		"quelle=X",
		"facets=series",
		"name=%20.%20",
		"braeutigam=-",
		"herkunft=%2B",
		many,
	]) {
		assert.ok(isParamError(parseEhedatenApiParams(u(qs))), qs);
	}
	const w = parseEhedatenApiParams(u("offset=995&limit=10"));
	assert.ok(isParamError(w) && w.code === "pagination_window_exceeded");
	const d = parseEhedatenApiParams(u("dateFrom=1400"));
	assert.ok(isParamError(d) && d.code === "invalid_parameter");
});

// Erfundene Namen in den Mustern der Ehedatenbank.
const entry: EhedatenEntry = {
	id: 1944835,
	signatur: "E III 30.1, EDB 276",
	band: "E III 30.1",
	eintrag: 276,
	quelle: "E III",
	seite: "S. 12",
	kirchgemeinde: "Wädenswil",
	art: "verkuendung",
	datum: "03.03.1689",
	isoVon: "1689-03-03",
	isoBis: "1689-03-03",
	dateFrom: 1689,
	dateTo: 1689,
	titel: "Muster, Hans Jakob, Ottikon (Illnau-Effretikon), getraut mit Beispiel, Elisabeth",
	mann: {
		vorname: "Hans Jakob",
		nachname: "Muster",
		name: "Hans Jakob Muster",
		herkunft: "Ottikon (Illnau-Effretikon)",
		ort: "Illnau-Effretikon",
		zusatz: "Verkünddatum; getraut zu Wädenswil",
		hls: "",
		gnd: "https://d-nb.info/gnd/100000001",
	},
	frau: { vorname: "Elisabeth", nachname: "Beispiel", name: "Elisabeth Beispiel", herkunft: "", ort: "", zusatz: "", hls: "", gnd: "" },
	unsicher: false,
};

test("Mapper: explizite Allowlist, leere Felder als null, Kalender und Art", () => {
	const item = toEhedatenItem(entry, "https://zentraleserien.ch");
	assert.deepEqual(item, {
		id: 1944835,
		signature: "E III 30.1, EDB 276",
		volume: "E III 30.1",
		entry: 276,
		page: "S. 12",
		source: "E III",
		parish: "Wädenswil",
		type: "verkuendung",
		typeLabel: "Verkündung",
		date: { text: "03.03.1689", from: "1689-03-03", to: "1689-03-03", yearFrom: 1689, yearTo: 1689, calendar: "julian" },
		groom: {
			firstName: "Hans Jakob",
			lastName: "Muster",
			name: "Hans Jakob Muster",
			origin: "Ottikon (Illnau-Effretikon)",
			originNormalized: "Illnau-Effretikon",
			note: "Verkünddatum; getraut zu Wädenswil",
			hls: null,
			gnd: "https://d-nb.info/gnd/100000001",
		},
		bride: {
			firstName: "Elisabeth",
			lastName: "Beispiel",
			name: "Elisabeth Beispiel",
			origin: null,
			originNormalized: null,
			note: null,
			hls: null,
			gnd: null,
		},
		title: "Muster, Hans Jakob, Ottikon (Illnau-Effretikon), getraut mit Beispiel, Elisabeth",
		uncertain: false,
		sameMarriage: null,
		url: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1944835",
		links: {
			self: "https://zentraleserien.ch/api/v1/ehedaten/1944835",
			web: "https://zentraleserien.ch/archivkatalog/1944835",
			catalog: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1944835",
		},
	});
	// Interne Felder (Namenswörter, Schlüssel) kommen nie hinaus, auch wenn sie am Objekt hängen.
	const leaky = { ...entry, mannTok: ["hans"], personKeys: ["hans muster"], _formatted: {} } as EhedatenEntry;
	const keys = Object.keys(toEhedatenItem(leaky, "https://x"));
	for (const k of ["mannTok", "personKeys", "_formatted", "titel", "art"]) assert.ok(!keys.includes(k), k);
	assert.equal((toEhedatenItem({ ...entry, dateFrom: 1701, dateTo: 1701 }, "https://x").date as { calendar: string }).calendar, "gregorian");
});

test("Mapper: übrige Einträge derselben Ehe (geprüfte Liste) mit Art, Kirchgemeinde, Datum und Links", () => {
	const trauung: EhedatenEntry = {
		...entry,
		id: 1972592,
		signatur: "E III 139.1, EDB 90",
		kirchgemeinde: "Wetzikon",
		art: "trauung",
		datum: "05.03.1689",
		isoVon: "1689-03-05",
		isoBis: "1689-03-05",
	};
	const item = toEhedatenItem(entry, "https://zentraleserien.ch", { sicher: true, entries: [trauung] });
	assert.deepEqual(item.sameMarriage, {
		certainty: "certain",
		entries: [
			{
				id: 1972592,
				signature: "E III 139.1, EDB 90",
				parish: "Wetzikon",
				type: "trauung",
				typeLabel: "Trauung",
				date: { text: "05.03.1689", from: "1689-03-05", to: "1689-03-05", yearFrom: 1689, yearTo: 1689, calendar: "julian" },
				links: {
					self: "https://zentraleserien.ch/api/v1/ehedaten/1972592",
					web: "https://zentraleserien.ch/archivkatalog/1972592",
					catalog: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1972592",
				},
			},
		],
	});
	// Nur die öffentlichen Felder des Partners, auch wenn er mehr trägt.
	const leaky = { ...trauung, mannTok: ["hans"] } as EhedatenEntry;
	const keys = Object.keys((toEhedatenItem(entry, "https://x", { sicher: true, entries: [leaky] }).sameMarriage as { entries: object[] }).entries[0]);
	assert.deepEqual(keys, ["id", "signature", "parish", "type", "typeLabel", "date", "links"]);
	assert.equal((toEhedatenItem(entry, "https://x", { sicher: false, entries: [trauung] }).sameMarriage as { certainty: string }).certainty, "probable");
	// Ohne Partner im Index: null wie ohne Listeneintrag.
	assert.equal(toEhedatenItem(entry, "https://x", { sicher: true, entries: [] }).sameMarriage, null);
});

test("Facetten: Zählungen als Objekte Wert → Anzahl", () => {
	assert.deepEqual(
		ehedatenFacetsMeta({
			kirchgemeinde: [
				{ value: "Uster", count: 9 },
				{ value: "Wald", count: 2 },
			],
			jahrzehnt: [{ value: "1650er", count: 11 }],
		}),
		{ kirchgemeinde: { Uster: 9, Wald: 2 }, jahrzehnt: { "1650er": 11 } },
	);
});

test("Envelope: Lizenz CC BY 4.0 mit Nennung und Quelle statt Public Domain Mark", async () => {
	const body = (await okEhedaten([], { total: 0 }).json()) as { meta: Record<string, unknown> };
	assert.equal(body.meta.total, 0);
	assert.equal(body.meta.license, "CC BY 4.0");
	assert.equal(body.meta.licenseUrl, "https://creativecommons.org/licenses/by/4.0/deed.de");
	assert.equal(body.meta.attribution, "Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert");
	assert.equal(body.meta.source, "https://suche.staatsarchiv.djiktzh.ch");
	assert.match(String(body.meta.note), /alten Stil/);
	// Stand des Katalogs und der veröffentlichte Datensatz stehen im Hinweis.
	assert.match(String(body.meta.note), /Online-Archivkatalog des Staatsarchivs, Stand \d{1,2}\.\d{1,2}\.\d{4}/);
	assert.match(String(body.meta.note), /doi\.org\/10\.5281\/zenodo\.11191059/);
	assert.doesNotMatch(JSON.stringify(body), /Public Domain/);
});
