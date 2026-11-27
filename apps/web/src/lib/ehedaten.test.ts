// Lauf: npx tsx --test src/lib/ehedaten.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	ehedatenCitation,
	ehedatenDateLabel,
	ehedatenFilter,
	ehedatenIgnoredFilters,
	expandKirchen,
	kirchgemeindeFacet,
	nameClause,
	namesDiffer,
	NO_EHEDATEN_FILTERS,
	parseEhedatenFilters,
	STADT_ZUERICH_KIRCHGEMEINDEN,
	trauortVermerk,
	writeEhedatenParams,
	type EhedatenPerson,
} from "./ehedaten";
import { DEFAULT_SEARCH } from "./types";

const u = (qs: string) => new URL(`http://localhost/search?${qs}`);
const shared = { dateFrom: null, dateTo: null, persons: [] as string[], places: [] as string[] };

test("Filter aus der URL: eigene Parameter, unbekannte Werte fallen weg", () => {
	const f = parseEhedatenFilters(
		u("view=ehedaten&eheMann=Hans%20Heusser&eheFrau=Meier&eheKirche=Uster&eheKirche=Uster&eheRaum=zh&eheRaum=mond&eheQuelle=TAI&eheQuelle=X&eheArt=verkuendung&eheBand=E%20III%20117.1"),
	);
	assert.deepEqual(f, {
		active: true,
		mann: ["Hans Heusser"],
		frau: ["Meier"],
		kirche: ["Uster"],
		raum: ["zh"],
		quelle: ["TAI"],
		art: "verkuendung",
		band: ["E III 117.1"],
	});
	assert.equal(parseEhedatenFilters(u("eheArt=hochzeit")).art, null);
	assert.equal(parseEhedatenFilters(u("q=x")).active, false);
});

test("Filter schreiben: nur die eigenen Parameter, Reiter und geteilte Felder bleiben", () => {
	const url = writeEhedatenParams(u("view=ehedaten&q=Heusser&eheKirche=Uster&eheArt=trauung"), {
		...NO_EHEDATEN_FILTERS,
		kirche: ["Stadt Zürich", "Wald"],
		raum: ["ausland"],
	});
	assert.equal(url.search, "?view=ehedaten&q=Heusser&eheKirche=Stadt+Z%C3%BCrich&eheKirche=Wald&eheRaum=ausland");
});

test("Namen: alle Wörter beim Bräutigam, bei der Braut oder bei einem der beiden, gefaltet", () => {
	assert.equal(nameClause("Heusser", "mann"), 'mannTok = "heuser"');
	assert.equal(nameClause("Hans Jakob Meyer", "frau"), '(frauTok = "hans" AND frauTok = "jakob" AND frauTok = "meier")');
	assert.equal(nameClause("Heusser", "beide"), '((mannTok = "heuser") OR (frauTok = "heuser"))');
	assert.equal(nameClause("Meier, Anna", "mann"), '(mannTok = "meier" AND mannTok = "ana")');
	assert.equal(nameClause(" ,. ", "mann"), null);
});

test("Filter: Zeitraum nach Berührung, Namen je Feld oder, Felder untereinander und", () => {
	const f = ehedatenFilter(
		{ ...NO_EHEDATEN_FILTERS, mann: ["Heusser", "Hüsser"], frau: ["Meier"] },
		{ ...shared, dateFrom: 1650, dateTo: 1700, persons: ["Anna Muster"] },
	);
	assert.equal(
		f,
		'dateTo >= 1650 AND dateFrom <= 1700 AND ((mannTok = "ana" AND mannTok = "muster") OR (frauTok = "ana" AND frauTok = "muster")) AND (mannTok = "heuser" OR mannTok = "huser") AND frauTok = "meier"',
	);
});

test("Filter: Herkunft über die Ortsschlüssel, Kirchgemeinde mit «Stadt Zürich», Raum, Überlieferung, Art, Band", () => {
	const f = ehedatenFilter(
		{ ...NO_EHEDATEN_FILTERS, kirche: ["Stadt Zürich", "Uster"], raum: ["ch", "ausland"], quelle: ["E III"], art: "trauung", band: ['E III 30.1'] },
		{ ...shared, places: ["Pfäffikon", "Kanton"] },
	);
	assert.equal(
		f,
		'herkunftKeys IN ["pfafikon", "kanton"] AND kirchgemeinde IN ["Grossmünster", "Fraumünster", "St. Peter", "Predigern", "Spitalpfarramt", "Zürich", "Uster"] AND raum IN ["ch", "ausland"] AND quelle IN ["E III"] AND art = "trauung" AND band IN ["E III 30.1"]',
	);
	assert.equal(ehedatenFilter(NO_EHEDATEN_FILTERS, shared), "");
	assert.deepEqual(expandKirchen(["Stadt Zürich", "Zürich"]), STADT_ZUERICH_KIRCHGEMEINDEN);
});

test("Filter: Herkunft mit Kantonskürzel oder Land exakt, sonst über die Ortsschlüssel", () => {
	// placeKey streicht Kürzel und Klammern: «Wald TG» träfe sonst auch Wald ZH.
	assert.equal(ehedatenFilter(NO_EHEDATEN_FILTERS, { ...shared, places: ["Wald TG"] }), 'herkunft IN ["Wald TG"]');
	assert.equal(
		ehedatenFilter(NO_EHEDATEN_FILTERS, { ...shared, places: ["Lindau (Deutschland)", "Uster", "Wil SG"] }),
		'(herkunft IN ["Lindau (Deutschland)", "Wil SG"] OR herkunftKeys IN ["uster"])',
	);
	assert.equal(ehedatenFilter(NO_EHEDATEN_FILTERS, { ...shared, places: ["Wald ZH"] }), 'herkunftKeys IN ["wald"]');
});

test("Filter: ß und ss sind in Namen, Herkunft und Kirchgemeinde gleich", () => {
	for (const role of ["mann", "frau", "beide"] as const) {
		assert.equal(nameClause("Hans Wyß", role), nameClause("Hans Wyss", role));
		assert.equal(nameClause("Großmann", role), nameClause("Grossmann", role));
	}
	assert.equal(
		ehedatenFilter(NO_EHEDATEN_FILTERS, { ...shared, persons: ["Anna Weiß"], places: ["Goßau"] }),
		ehedatenFilter(NO_EHEDATEN_FILTERS, { ...shared, persons: ["Anna Weiss"], places: ["Gossau"] }),
	);
	// Ganze Werte der Facette: in beiden Schreibungen.
	for (const v of ["Straßburg (Frankreich)", "Strassburg (Frankreich)"]) {
		assert.equal(ehedatenFilter(NO_EHEDATEN_FILTERS, { ...shared, places: [v] }), 'herkunft IN ["Strassburg (Frankreich)", "Straßburg (Frankreich)"]');
	}
	assert.deepEqual(expandKirchen(["Großmünster"]), ["Großmünster", "Grossmünster"]);
	assert.deepEqual(expandKirchen(["Grossmünster"]), ["Grossmünster"]);
});

test("Hinweis: was im Reiter nicht wirkt", () => {
	assert.deepEqual(
		ehedatenIgnoredFilters({ ...DEFAULT_SEARCH, series: ["RRB"], organizations: ["Zunft zur Meisen"], years: [1700], theme: "Hochzeit" }),
		["Serie RRB", "Filter der Serie", "1 Organisation", "Thema"],
	);
	assert.deepEqual(ehedatenIgnoredFilters(DEFAULT_SEARCH), []);
});

test("Anzeige: Datum bis 1700 mit «a. St.», Zitiervorschlag mit Lizenz und Permalink", () => {
	assert.equal(ehedatenDateLabel({ datum: "03.03.1689", dateFrom: 1689 }), "03.03.1689 (a. St.)");
	assert.equal(ehedatenDateLabel({ datum: "1701", dateFrom: 1701 }), "1701");
	assert.equal(ehedatenDateLabel({ datum: "ca. 1526 – ca. 1532", dateFrom: 1526 }), "ca. 1526 – ca. 1532 (a. St.)");
	const p = (name: string): EhedatenPerson => ({ vorname: "", nachname: "", name, herkunft: "", ort: "", zusatz: "", hls: "", gnd: "" });
	assert.equal(
		ehedatenCitation({ id: 1944835, signatur: "E III 30.1, EDB 276", mann: p("Hans Muster"), frau: p("Anna Beispiel"), datum: "03.03.1689", dateFrom: 1689, art: "trauung" }),
		"StAZH E III 30.1, EDB 276, Hans Muster und Anna Beispiel, Trauung 03.03.1689 (a. St.); Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert (CC BY 4.0); https://archivkatalog.ji.zh.ch/detail.aspx?ID=1944835",
	);
});

test("Trauort laut Vermerk: «getraut zu …» bis Klammer, Anmerkung oder Satzende", () => {
	const z = (mann: string, frau = "") => ({ mann: { zusatz: mann }, frau: { zusatz: frau } });
	assert.equal(trauortVermerk(z("zugenant der Tütsch; getraut zu Gossau")), "getraut zu Gossau");
	assert.equal(trauortVermerk(z("aet. 23; verkündet 13. Okt.; getraut zu Zürich beim Grossmünster (morgens). Sein Bruder …")), "getraut zu Zürich beim Grossmünster");
	assert.equal(trauortVermerk(z("Herr; getraut im Grossmünster", "Jf.")), "getraut im Grossmünster");
	assert.equal(trauortVermerk(z("verkündet 4. Nov.; getraut zu Zürich bei Sankt Peter [Traudatum gemäss VIII.C. 25.]")), "getraut zu Zürich bei Sankt Peter");
	assert.equal(trauortVermerk(z('getraut zu Wetzikon ("Copulati cum licentia Weziconae")')), "getraut zu Wetzikon");
	assert.equal(trauortVermerk(z("getraut zu Zürich beim Grossmünster, mit Bewilligung des Ehegerichts")), "getraut zu Zürich beim Grossmünster");
	assert.equal(trauortVermerk(z("-", "Ihr Vater heiratet am gleichen Tag; getraut zu Elgg")), "getraut zu Elgg");
	// Ohne Ortsangabe kein Trauort.
	assert.equal(trauortVermerk(z("von Diakon Hess morgens um ½ Uhr getraut")), null);
	assert.equal(trauortVermerk(z("")), null);
});

test("Namen im anderen Kirchenbuch: anders nur, wenn ein Personenschlüssel abweicht", () => {
	const e = (mann: string, frau: string) => ({
		mann: { vorname: "", nachname: "", name: mann, herkunft: "", ort: "", zusatz: "", hls: "", gnd: "" },
		frau: { vorname: "", nachname: "", name: frau, herkunft: "", ort: "", zusatz: "", hls: "", gnd: "" },
	});
	assert.equal(namesDiffer(e("Heinrich Hirzel", "Magdalena Weber"), e("Heinrich Hirzel", "Magdalena Weber")), false);
	assert.equal(namesDiffer(e("Hans Jakob Meier", "Anna Muster"), e("Hans Jacob Meyer", "Anna Muster")), false, "Meier = Meyer, Jakob = Jacob");
	assert.equal(namesDiffer(e("Heinrich Hirzel", "Magdalena Weber"), e("Kleinheinrich Hirzel", "Magdalena Weber")), true);
	assert.equal(namesDiffer(e("Hans Muster", "Barbara Beispiel"), e("Hans Muster", "Anna Barbara Beispiel")), true);
});

test("Facette Kirchgemeinde: «Stadt Zürich» als Summe der Stadtkirchen, gewählte immer dabei", () => {
	const dist = { Grossmünster: 30, "St. Peter": 20, Uster: 25, Wald: 3, Zürich: 1 };
	assert.deepEqual(kirchgemeindeFacet(dist, [], 2), [
		{ value: "Stadt Zürich", count: 51 },
		{ value: "Grossmünster", count: 30 },
	]);
	assert.deepEqual(kirchgemeindeFacet(dist, ["Wald", "Bauma"], 1), [
		{ value: "Stadt Zürich", count: 51 },
		{ value: "Wald", count: 3 },
		{ value: "Bauma", count: 0 },
	]);
});

test("Eheeintrag im Archivkatalog an der Signatur erkennen", async () => {
	const { isEhedatenSignature } = await import("./ehedaten");
	assert.equal(isEhedatenSignature("E III 30.1, EDB 276"), true);
	assert.equal(isEhedatenSignature("TAI 9.1; StadtA Musterhausen B 1, EDB 7"), true);
	assert.equal(isEhedatenSignature("E III 129.2, EDB 501 - E III 129.2, EDB 1000"), false);
	assert.equal(isEhedatenSignature("Z 1114.734"), false);
	assert.equal(isEhedatenSignature(null), false);
});
