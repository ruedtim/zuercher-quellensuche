// Lauf: npx tsx --test src/lib/catalog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearchParams } from "./searchParams";
import {
	carriedYear,
	catalogAncestors,
	catalogAutoOpensAdvanced,
	catalogCitation,
	catalogDateClauses,
	catalogDocIdVariants,
	catalogFacetsOf,
	catalogLinkResolver,
	catalogPermalink,
	catalogPositionLabel,
	catalogShowsTree,
	catalogTimelineClickLevels,
	catalogTimelineLevels,
	CATALOG_TIMELINE_LEVELS,
	catalogThemeMode,
	catalogTimelineAxis,
	catalogTimelineOf,
	catalogUnitHref,
	digitalLinks,
	DOCUMENT_REFERENCES_MAX,
	documentCatalogFilter,
	documentsOnlyFilters,
	sortByCatalogDate,
	writeCatalogParams,
	fieldLines,
	formatCatalogDate,
	groupByBestand,
	parseCatalogFilters,
	personCatalogFilter,
	pickDocumentCatalog,
	platformIdFallbacks,
	shortTreeName,
	splitArchivePath,
	splitCatalogLabel,
	topFacetValues,
	treeNodeName,
	ZS_WEBLINK_MISSING,
} from "./catalog";

const u = (qs: string) => new URL(`http://localhost/search?${qs}`);

test("Katalog-Filter lesen: Reiter, Zeitraum vor 1483, Mehrfachwerte", () => {
	const f = parseCatalogFilters(u("catView=1&q=Mühle&dateFrom=1250&dateTo=1300&catLevel=Dokument&catLevel=Dokument&catBestand=C%20I&catDigital=1"));
	assert.deepEqual(f, {
		active: true,
		dateFrom: 1250,
		dateTo: 1300,
		level: ["Dokument"],
		bestand: ["C I"],
		digital: true,
		entities: { person: [], place: [], org: [] },
		fields: [],
	});
	// Personen, Orte, Organisationen teilen beide Reiter; der Katalog nimmt nur Formen mit Schlüssel.
	assert.deepEqual(parseCatalogFilters(u("catView=1&persons=Meier,%20Anna&persons=Meier&places=Uster")).entities, {
		person: ["Meier, Anna"],
		place: ["Uster"],
		org: [],
	});
	assert.equal(parseCatalogFilters(u("dateFrom=abc&dateTo=99999")).dateFrom, null);
	assert.equal(parseCatalogFilters(u("dateFrom=12")).dateFrom, 700);
	assert.equal(parseCatalogFilters(u("q=x")).active, false, "Standard-Reiter ist «Alle Quellen», nicht der Katalog");
	assert.equal(parseCatalogFilters(u("q=x&view=catalog")).active, true);
	assert.equal(parseCatalogFilters(u("q=x&view=documents")).active, false);
});

test("Katalog-Parameter schreiben: nur die Filter, Reiter und geteilte Felder bleiben unberührt", () => {
	const url = writeCatalogParams(u("view=catalog&q=Mühle&series=RRB&dateFrom=900&catLevel=Dossier&catDigital=1"), {
		level: ["Dokument"],
		bestand: [],
		digital: false,
	});
	assert.equal(url.searchParams.get("q"), "Mühle");
	assert.equal(url.searchParams.get("series"), "RRB");
	assert.equal(url.searchParams.get("dateFrom"), "900");
	assert.deepEqual(url.searchParams.getAll("catLevel"), ["Dokument"]);
	assert.equal(url.searchParams.get("view"), "catalog");
	assert.equal(url.searchParams.has("catDigital"), false);
	const docs = writeCatalogParams(u("q=x"), { level: ["Dossier"], bestand: ["C I"], digital: true });
	assert.equal(docs.search, "?q=x&catLevel=Dossier&catBestand=C+I&catDigital=1");
});

test("Reiter Archivkatalog: view=catalog, alte Links mit catView=1", () => {
	assert.equal(parseCatalogFilters(u("view=catalog")).active, true);
	assert.equal(parseCatalogFilters(u("catView=1")).active, true);
	assert.equal(parseCatalogFilters(u("view=ehedaten&catView=1")).active, false);
});

test("Zeitraum über den Reiterwechsel: ein Katalog-Jahr vor 1483 bleibt, bis es jemand ändert", () => {
	// URL dateFrom=900: Dokumentsuche liest 1483, der Katalog 900.
	assert.equal(carriedYear("documents", 1483, 1483, 900), 900);
	assert.equal(carriedYear("documents", 1600, 1483, 900), 1600);
	assert.equal(carriedYear("documents", null, 1483, 900), null);
	assert.equal(carriedYear("documents", 1800, 1800, 1800), 1800);
	// Im Reiter «Ehedaten» wie in den Dokumenten (gleiche Kappung).
	assert.equal(carriedYear("ehedaten", 1483, 1483, 900), 900);
	// Im Katalog-Reiter gilt das Feld, auch wenn es 1483 heisst.
	assert.equal(carriedYear("catalog", 1483, 1483, 900), 1483);
	assert.equal(carriedYear("catalog", 900, 1483, 900), 900);
	// Editionen lesen den Zeitraum wie der Katalog (ab 700).
	assert.equal(carriedYear("editions", 1483, 1483, 1275), 1483);
	assert.equal(carriedYear("editions", 1275, 1483, 1275), 1275);
});

test("Thema im Katalog: Reihung bei Relevanz, die K ähnlichsten bei Datums-Sortierung", () => {
	assert.equal(catalogThemeMode({ theme: "Seuchen", sort: "relevance" }, true), "rank");
	assert.equal(catalogThemeMode({ theme: "Seuchen", sort: "date_desc" }, true), "topK");
	assert.equal(catalogThemeMode({ theme: " ", sort: "relevance" }, true), "none");
	assert.equal(catalogThemeMode({ theme: "Seuchen", sort: "relevance" }, false), "none");
});

test("Die K ähnlichsten nach Datum: Anfangs-, dann Endjahr, undatierte zuletzt, sonst stabil", () => {
	const hits = [
		{ id: 1, dateFrom: 1850, dateTo: 1900 },
		{ id: 2, dateFrom: null, dateTo: null },
		{ id: 3, dateFrom: 1700, dateTo: 1710 },
		{ id: 4, dateFrom: 1850, dateTo: 1860 },
		{ id: 5 },
		{ id: 6, dateFrom: 1700, dateTo: 1710 },
	];
	assert.deepEqual(sortByCatalogDate(hits, "date_asc").map((h) => h.id), [3, 6, 4, 1, 2, 5]);
	assert.deepEqual(sortByCatalogDate(hits, "date_desc").map((h) => h.id), [1, 4, 3, 6, 2, 5]);
});

test("Zeitleiste und Facetten aus einer festen Treffermenge", () => {
	const hits = [
		{ dateFrom: 1850, dateTo: 1900, level: "Dossier", bestand: "Z 1", hasDigitization: true },
		{ dateFrom: 1850, dateTo: 1850, level: "Dokument", bestand: "Z 1", hasDigitization: false },
		{ dateFrom: null, dateTo: null, level: "Dossier", bestand: null },
	];
	assert.deepEqual(catalogTimelineOf(hits), { from: { 1850: 2 }, to: { 1850: 1, 1900: 1 }, min: 1850, max: 1900, undated: 1 });
	assert.deepEqual(catalogFacetsOf(hits), { level: { Dossier: 2, Dokument: 1 }, bestand: { "Z 1": 2 }, digital: 1 });
	assert.deepEqual(catalogTimelineOf([]), { from: {}, to: {}, min: null, max: null, undated: 0 });
});

test("Hinweis im Katalog-Reiter: was nur die Dokumente filtert", () => {
	const none = { series: [], persons: [], places: [], organizations: [], volumeNr: [], startPg: [], serialNr: [], resolutionId: [], years: [], theme: "" };
	assert.deepEqual(documentsOnlyFilters(none, true), []);
	// Personen, Orte und Organisationen filtern auch den Katalog; nur Formen ohne Schlüssel
	// (Nachname ohne Vornamen) wirken allein auf die Dokumente.
	assert.deepEqual(
		documentsOnlyFilters(
			{ ...none, series: ["RRB", "KRP"], persons: ["Meier", "Keller", "Anna Meier"], places: ["Uster"], years: [1850], theme: "Hunde" },
			false,
		),
		["Serien RRB, KRP", "2 Personen ohne Vornamen", "Filter der Serie", "Thema"],
	);
	// Das Thema reiht der Katalog selbst; ODER-Begriffe gelten in beiden Reitern (kein Feld hier).
	assert.deepEqual(documentsOnlyFilters({ ...none, theme: "Hunde", organizations: ["Escher Wyss AG"], persons: ["Meier"] }, true), [
		"1 Person ohne Vornamen",
	]);
});

// «Erweiterte Suchoptionen» im Katalog-Reiter: geprüft wie ein geteilter Link ankommt
// (parseSearchParams + parseCatalogFilters), mit bzw. ohne Thema-Reihung im Katalog.
const catalogAutoOpen = (qs: string, semantic = true) => {
	const url = u(`view=catalog&${qs}`);
	return catalogAutoOpensAdvanced(parseSearchParams(url), parseCatalogFilters(url), semantic);
};

test("Katalog-Reiter: Suchbegriff und Zeitraum lassen die erweiterten Suchoptionen zu", () => {
	assert.equal(catalogAutoOpen(""), false, "pristine Suche");
	assert.equal(catalogAutoOpen("dateFrom=900&dateTo=1300"), false, "Zeitraum (Zeitleiste oder Link): Pill");
	// Suchbegriff (Chips), «nur im Titel» und Sortierung stehen auch eingeklappt.
	assert.equal(catalogAutoOpen("q=M%C3%BChle+-S%C3%A4ge&titleOnly=1&dateFrom=1500&sort=date_desc"), false);
	// Was nur die Dokumente filtert, nennt im Katalog der Hinweis darunter.
	assert.equal(catalogAutoOpen("series=KRP&years=1850&persons=Meier"), false, "Serien-Filter, Nachname ohne Vornamen");
	assert.equal(catalogAutoOpen("theme=Seuchen", false), false, "Thema ohne Vektoren im Katalog");
});

test("Katalog-Reiter: Filter, die nur in den erweiterten Suchoptionen stehen, klappen sie auf", () => {
	for (const qs of [
		"catLevel=Dokument",
		"catBestand=C%20I",
		"catDigital=1",
		"catSig=C%20II%2012",
		"catTitle=M%C3%BChle",
		"catText=Konkurs",
		"catProv=Bezirksgericht",
		"qAny=Cholera&qAny=Typhus",
		"qAny=Pest",
		"persons=Anna%20Meier",
		"places=Uster",
		"organizations=Escher%20Wyss%20AG",
		"theme=Seuchen",
		"topK=100",
	]) {
		assert.equal(catalogAutoOpen(qs), true, qs);
		assert.equal(catalogAutoOpen(`${qs}&dateFrom=900&dateTo=1300`), true, `${qs} + Zeitraum`);
	}
	// Link aus dem Register: Name im gewählten Bestand.
	assert.equal(catalogAutoOpen("persons=Meier%2C+Anna&catBestand=W+I+3"), true);
});

const catalogTree = (qs: string, semantic = true) => {
	const url = u(`view=catalog&${qs}`);
	return catalogShowsTree(parseSearchParams(url), parseCatalogFilters(url), semantic);
};

test("Katalog-Reiter: ohne Suche und Filter der Archivbaum, sonst die Trefferliste", () => {
	assert.equal(catalogTree(""), true, "pristine Suche");
	// Was nur die Dokumente filtert oder ohne Suchbegriff nichts tut, lässt den Baum stehen.
	assert.equal(catalogTree("series=KRP&years=1850&persons=Meier&titleOnly=1&topK=50&page=3"), true);
	assert.equal(catalogTree("theme=Seuchen", false), true, "Thema ohne Vektoren im Katalog");
	for (const qs of [
		"q=M%C3%BChle",
		"q=-S%C3%A4ge",
		"qAny=Cholera&qAny=Typhus",
		"theme=Seuchen",
		"sort=date_asc",
		"sort=date_desc",
		"dateFrom=1800",
		"dateTo=1300",
		"persons=Anna+Meier",
		"places=Uster",
		"catLevel=Bestand",
		"catBestand=Z+1114",
		"catDigital=1",
		"catSig=C+II+12",
	]) {
		assert.equal(catalogTree(qs), false, qs);
	}
});

test("Zeitleiste: ohne Stufenwahl nur die unteren Stufen, sonst die gewählten", () => {
	assert.deepEqual(catalogTimelineLevels([]), ["Dossier", "Subdossier", "Dokument"]);
	assert.deepEqual(catalogTimelineLevels(["Bestand", "Dossier"]), ["Bestand", "Dossier"]);
	assert.deepEqual(CATALOG_TIMELINE_LEVELS, ["Dossier", "Subdossier", "Dokument"]);
});

test("Klick in die Zeitleiste: ohne Stufenwahl die unteren Stufen, «Alle Jahre» nimmt sie zurück", () => {
	assert.deepEqual(catalogTimelineClickLevels([], 1850, 1850), ["Dossier", "Subdossier", "Dokument"]);
	assert.deepEqual(catalogTimelineClickLevels([], null, 1300), ["Dossier", "Subdossier", "Dokument"]);
	assert.deepEqual(catalogTimelineClickLevels(["Bestand"], 1850, 1860), ["Bestand"]);
	assert.deepEqual(catalogTimelineClickLevels(["Dokument", "Dossier", "Subdossier"], null, null), []);
	assert.deepEqual(catalogTimelineClickLevels(["Dossier"], null, null), ["Dossier"]);
	assert.deepEqual(catalogTimelineClickLevels([], null, null), []);
});

test("Digitalisat-Links: Typ aus der Endung, Bildansicht, Nummern bei mehreren", () => {
	const base = "https://suche.staatsarchiv.djiktzh.ch";
	assert.deepEqual(
		digitalLinks([
			{ name: "Z_2_1_4.pdf", url: `${base}/Dateien/303/D1.pdf`, kind: "file" },
			{ name: "Bild 1", url: `${base}/bild.aspx?VEID=1&DEID=10&SQNZNR=1`, kind: "image" },
		]).map((l) => l.label),
		["PDF", "Bildansicht"],
	);
	assert.deepEqual(
		digitalLinks([
			{ name: "a.pdf", url: `${base}/Dateien/1/D1.pdf`, kind: "file" },
			{ name: "b.pdf", url: `${base}/Dateien/1/D2.PDF`, kind: "file" },
			{ name: "c.mp3", url: `${base}/Dateien/1/D3.mp3`, kind: "file" },
			{ name: "d", url: `${base}/Dateien/1/D4`, kind: "file" },
		]).map((l) => l.label),
		["PDF 1", "PDF 2", "Audio", "Datei"],
	);
});

test("Permalink, Detailseite und Zitiervorschlag", () => {
	assert.equal(catalogPermalink(42), "https://archivkatalog.ji.zh.ch/detail.aspx?ID=42");
	assert.equal(catalogUnitHref(42), "/archivkatalog/42");
	assert.equal(
		catalogCitation({ id: 42, signature: "X 1.2.3", title: "Muster,\n Akte", dateText: "1934 - 1935" }),
		"StAZH X 1.2.3, Muster, Akte, 1934 – 1935; https://archivkatalog.ji.zh.ch/detail.aspx?ID=42",
	);
	assert.equal(
		catalogCitation({ id: 7, signature: "", title: "Musterkonferenz", dateText: "" }),
		"Staatsarchiv Zürich, Musterkonferenz; https://archivkatalog.ji.zh.ch/detail.aspx?ID=7",
	);
	// Die Wurzel heisst selbst «Staatsarchiv Zürich».
	assert.equal(
		catalogCitation({ id: 1, signature: "", title: "Staatsarchiv Zürich", dateText: "" }),
		"Staatsarchiv Zürich; https://archivkatalog.ji.zh.ch/detail.aspx?ID=1",
	);
});

test("Datum und Archivplan-Etikett zur Anzeige", () => {
	assert.equal(formatCatalogDate("12.09.1272 - 19. Jh."), "12.09.1272 – 19. Jh.");
	assert.equal(formatCatalogDate("1800-1987"), "1800–1987");
	assert.equal(formatCatalogDate(null), "");
	assert.deepEqual(splitCatalogLabel("X 94 - X 112 Musterfakultät, 1800-1987 (Klasse)"), {
		name: "X 94 - X 112 Musterfakultät",
		date: "1800 – 1987",
		level: "Klasse",
	});
	// Etiketten schreiben Daten anders als die Einheiten: auf deren Schreibweise gebracht.
	assert.deepEqual(splitCatalogLabel("Fragmente (von Einbänden abgelöst), 05. Jh.-1900.12.31 (Bestand)"), {
		name: "Fragmente (von Einbänden abgelöst)",
		date: "5. Jh. – 31.12.1900",
		level: "Bestand",
	});
	const date = (label: string) => splitCatalogLabel(label).date;
	assert.equal(date("Kanton Muster, 1803- (Hauptabteilung)"), "ab 1803");
	assert.equal(date("Provenienzarchiv, 19. Jh.- (Hauptabteilung)"), "ab 19. Jh.");
	assert.equal(date("Altakten, -1900 (Klasse)"), "bis 1900");
	assert.equal(date("Urkunden, 1272.09.12-19. Jh. (Bestand)"), "12.09.1272 – 19. Jh.");
	assert.equal(date("Pläne, 1600 (ca.)-2016 (Bestand)"), "ca. 1600 – 2016");
	assert.equal(date("Bericht, 1953.05 (Dossier)"), "05.1953");
	assert.deepEqual(splitCatalogLabel("Musterarchiv (Archiv)"), { name: "Musterarchiv", date: null, level: "Archiv" });
	// Klammer im Namen ist keine Stufe.
	assert.deepEqual(splitCatalogLabel("Akten (Kopien), 1900"), { name: "Akten (Kopien)", date: "1900", level: null });
});

test("Feldzeilen: Verweise auf Einheiten, Plattform-Dokument und Web", () => {
	const resolve = catalogLinkResolver(new Set([9]), { series: "RRB", id: "MM_1_RRB_1900_0001" });
	const lines = fieldLines(
		{
			label: "Verwandte Verzeichnungseinheiten",
			text: "Siehe:\nX 9 Andere Akten (Dossier)\nX 10 Weitere Akten (Dossier)",
			links: [
				{ text: "X 10 Weitere Akten (Dossier)", id: 10 },
				{ text: "X 9 Andere Akten (Dossier)", id: 9 },
				{ text: "Volltext", href: "https://www.zentraleserien.zh.ch/documents/rrb/MM_1_RRB_1900_0001" },
			],
		},
		resolve,
	);
	assert.deepEqual(lines, [
		{ text: "Siehe:" },
		{ text: "X 9 Andere Akten (Dossier)", href: "/archivkatalog/9", external: false },
		{ text: "X 10 Weitere Akten (Dossier)", href: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=10", external: true },
		{ text: "Volltext", href: "/documents/RRB/MM_1_RRB_1900_0001", external: false },
	]);
	assert.deepEqual(fieldLines({ label: "x", text: "Skript", links: [{ text: "Skript", href: "javascript:alert(1)" }] }, resolve), [
		{ text: "Skript" },
	]);
	// Weblink, dessen Dokument auf der Plattform fehlt: kein Link (auch nicht zum Staatsarchiv).
	const weblink = { label: "Weblinks", text: "Volltext und Digitalisat", links: [{ text: "Volltext und Digitalisat", href: "https://www.zentraleserien.zh.ch/documents/krp/MM_24_60_KRP_1942_086_0798" }] };
	assert.deepEqual(fieldLines(weblink, catalogLinkResolver(new Set(), null)), [
		{ text: "Volltext und Digitalisat", note: ZS_WEBLINK_MISSING },
	]);
	// Andere Weblinks bleiben extern.
	assert.deepEqual(fieldLines({ label: "x", text: "HLS", links: [{ text: "HLS", href: "https://hls-dhs-dss.ch/de/articles/1/" }] }, catalogLinkResolver(new Set(), null)), [
		{ text: "HLS", href: "https://hls-dhs-dss.ch/de/articles/1/", external: true },
	]);
});

test("Plattform-IDs für alte Katalog-Links: «_t» und Doppelbeschlüsse ohne Bindestrich", () => {
	assert.deepEqual(platformIdFallbacks("MM_3_41_RRB_1927_1580"), ["MM_3_41_RRB_1927_1580_t"]);
	assert.deepEqual(platformIdFallbacks("OS_54__S__6_"), ["OS_54__S__6__t"]);
	assert.deepEqual(platformIdFallbacks("MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812"), [
		"MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812_t",
		"MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812",
		"MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812_t",
	]);
	// Schon mit «_t»: nichts mehr anzuhängen.
	assert.deepEqual(platformIdFallbacks("MM_3_41_RRB_1927_1580_t"), []);
	// Seitenbereiche des Amtsblatts behalten ihren Bindestrich.
	assert.deepEqual(platformIdFallbacks("ABl_1980__S__1-10_"), ["ABl_1980__S__1-10__t"]);
});

test("Achse der Katalog-Zeitleiste", () => {
	assert.deepEqual(catalogTimelineAxis({ min: 195, max: 2027 }, { dateFrom: null, dateTo: null }, 2026), { min: 700, max: 2026 });
	assert.deepEqual(catalogTimelineAxis({ min: 1850, max: 1900 }, { dateFrom: 1800, dateTo: null }, 2026), { min: 1800, max: 1900 });
	// Mindestens 21 Jahre, am Rand verschoben statt abgeschnitten.
	assert.deepEqual(catalogTimelineAxis({ min: 1935, max: 1935 }, { dateFrom: null, dateTo: null }, 2026), { min: 1925, max: 1945 });
	assert.deepEqual(catalogTimelineAxis({ min: 2024, max: 2025 }, { dateFrom: null, dateTo: null }, 2026), { min: 2006, max: 2026 });
	assert.equal(catalogTimelineAxis({ min: null, max: null }, { dateFrom: null, dateTo: null }, 2026), null);
	assert.deepEqual(catalogTimelineAxis({ min: null, max: null }, { dateFrom: 1500, dateTo: 1600 }, 2026), { min: 1500, max: 1600 });
});

test("topFacetValues: häufigste und gewählte Werte", () => {
	const dist = { A: 5, B: 9, C: 1, D: 9 };
	assert.deepEqual(topFacetValues(dist, 2), { B: 9, D: 9 });
	assert.deepEqual(topFacetValues(dist, 2, ["C", "Z"]), { B: 9, D: 9, C: 1 });
});

test("Archivplan-Kontext: Zeile über dem nächsten Bestand, Treppe ab dort", () => {
	const node = (name: string, level: string | null) => ({ name, level });
	const deep = [
		node("Musterarchiv", "Archiv"),
		node("Kanton", "Hauptabteilung"),
		node("Verwaltung", "Abteilung"),
		node("Musterdirektion", "Bestand"),
		node("Musteramt", "Bestand"),
		node("Betrieb", "Klasse"),
		node("Werkstätten", "Klasse"),
	];
	const names = (xs: Array<{ name: string }>) => xs.map((n) => n.name);
	// Zwei Bestände übereinander: die Treppe beginnt beim nächsten.
	assert.deepEqual(names(splitArchivePath(deep).line), ["Musterarchiv", "Kanton", "Verwaltung", "Musterdirektion"]);
	assert.deepEqual(names(splitArchivePath(deep).stairs), ["Musteramt", "Betrieb", "Werkstätten"]);
	// Ohne Bestand darüber die letzten vier Stufen …
	const noBestand = ["Archiv", "Hauptabteilung", "Hauptabteilung", "Abteilung", "Abteilung", "Klasse", "Klasse"].map((l, i) => node(`S${i}`, l));
	assert.deepEqual(names(splitArchivePath(noBestand).line), ["S0", "S1", "S2"]);
	assert.deepEqual(names(splitArchivePath(noBestand).stairs), ["S3", "S4", "S5", "S6"]);
	// … und blieben für die Zeile höchstens zwei Stufen, steht alles in der Treppe.
	assert.deepEqual(splitArchivePath(noBestand.slice(0, 5)).line, []);
	assert.deepEqual(splitArchivePath([node("Musterarchiv", "Archiv"), node("Kanton", "Hauptabteilung"), node("Amt", "Bestand")]).line, []);
	assert.deepEqual(splitArchivePath([]), { line: [], stairs: [] });
});

test("Namen im Archivbaum und Position unter den Geschwistern", () => {
	assert.equal(treeNodeName({ signature: "X 1.2", title: "Akten\n  zur Sache" }), "X 1.2 Akten zur Sache");
	assert.equal(treeNodeName({ signature: "", title: " " }), "(ohne Titel)");
	const long = `X 1 ${"Regest ".repeat(40)}`.trim();
	assert.ok(shortTreeName(long).length <= 142 && shortTreeName(long).endsWith("Regest …"));
	assert.equal(shortTreeName("X 1 Akte"), "X 1 Akte");
	assert.equal(catalogPositionLabel(3, 4, "Werkstätten"), "3 von 4 in «Werkstätten»");
	// Tausendertrennzeichen je nach ICU «'» oder «’».
	const nf = new Intl.NumberFormat("de-CH");
	assert.equal(catalogPositionLabel(1504, 2310, "Werkstätten"), `${nf.format(1504)} von ${nf.format(2310)} in «Werkstätten»`);
	assert.equal(catalogPositionLabel(1, 1, "Werkstätten"), "einzige Einheit in «Werkstätten»");
});

test("catalogDateClauses: Berührung (Reiter, API, MCP)", () => {
	assert.deepEqual(catalogDateClauses(1800, 1850), ["dateTo >= 1800", "dateFrom <= 1850"]);
	// Eine Grenze: «vor 1800» = bis 1799.
	assert.deepEqual(catalogDateClauses(null, 1799), ["dateFrom <= 1799"]);
	assert.deepEqual(catalogDateClauses(1900, null), ["dateTo >= 1900"]);
	// Ohne Grenzen kein Filter.
	assert.deepEqual(catalogDateClauses(null, null), []);
});

test("Archivplan einer Einheit: Wurzel davor, Etiketten zerlegt, Wurzel selbst ohne Pfad", () => {
	const path = catalogAncestors(42, [
		{ id: 7, label: "M Allgemeine kantonale Angelegenheiten (Hauptabteilung)" },
		{ id: 9, label: "MM 24 Protokoll, 1803-1995 (Bestand)" },
	]);
	assert.deepEqual(
		path.map((n) => [n.id, n.name, n.date, n.level]),
		[
			[1, "Staatsarchiv Zürich", null, "Archiv"],
			[7, "M Allgemeine kantonale Angelegenheiten", null, "Hauptabteilung"],
			[9, "MM 24 Protokoll", "1803 – 1995", "Bestand"],
		],
	);
	assert.equal(path[2].label, "MM 24 Protokoll, 1803-1995 (Bestand)");
	assert.deepEqual(catalogAncestors(1, []), []);
	assert.deepEqual(catalogAncestors(5, undefined).map((n) => n.id), [1]);
});

test("Katalogeintrag eines Dokuments: Filter über archiveId und docId", () => {
	assert.deepEqual(catalogDocIdVariants("MM_3_45_RRB_1931_1864_t"), ["MM_3_45_RRB_1931_1864_t", "MM_3_45_RRB_1931_1864"]);
	assert.deepEqual(catalogDocIdVariants("RM_1792_1038_0002"), ["RM_1792_1038_0002"]);
	assert.equal(
		documentCatalogFilter({ id: "MM_24_7_KRP_1830_0066", archiveId: 721279 }),
		'id = 721279 OR docId IN ["MM_24_7_KRP_1830_0066"]',
	);
	assert.equal(documentCatalogFilter({ id: "RM_1792_1038_0002", archiveId: null }), 'docId IN ["RM_1792_1038_0002"]');
	assert.equal(documentCatalogFilter({ id: 'x"y', archiveId: 0 }), 'docId IN ["x\\"y"]');
});

test("Katalogeintrag eines Dokuments: Einheit und Verweise trennen", () => {
	type H = { id: number; signature: string; onPlatform?: boolean; docId?: string; stub?: boolean };
	const own: H = { id: 3300005, signature: "MM 2.190 RRB 1870/2529", onPlatform: true, docId: "MM_2_190_RRB_1870_2529" };
	const urkunde: H = { id: 252294, signature: "C I, Nr. 3889", onPlatform: false, docId: "MM_2_190_RRB_1870_2529" };
	const andere: H = { id: 252290, signature: "C I, Nr. 3885", onPlatform: false, docId: "MM_2_190_RRB_1870_2529" };
	const doc = { id: "MM_2_190_RRB_1870_2529", archiveId: 3300005 };
	assert.deepEqual(pickDocumentCatalog([urkunde, own, andere], doc), { unit: own, references: [andere, urkunde] });
	// Einheit noch nicht übernommen: nur die Verweise.
	assert.deepEqual(pickDocumentCatalog([urkunde], doc), { unit: null, references: [urkunde] });
	// Vor dem Neuaufbau trägt eine Urkunde onPlatform = true: weder Einheit noch Verweis.
	assert.deepEqual(pickDocumentCatalog([{ ...urkunde, onPlatform: true }], doc), { unit: null, references: [] });
	// Ratsmanuale (ohne archiveId): die Sitzungseinheit über docId.
	const sitzung: H = { id: 5122094, signature: "B II 1038 (S. 2-3)", onPlatform: true, docId: "RM_1792_1038_0002" };
	assert.deepEqual(pickDocumentCatalog([sitzung], { id: "RM_1792_1038_0002", archiveId: null }), { unit: sitzung, references: [] });
	// Plattform-ID mit «_t»: Weblinks tragen sie ohne.
	const ohneT: H = { id: 9, signature: "C I, Nr. 1", onPlatform: false, docId: "MM_3_45_RRB_1931_1864" };
	assert.deepEqual(pickDocumentCatalog([ohneT], { id: "MM_3_45_RRB_1931_1864_t", archiveId: 8 }).references, [ohneT]);
	// Stufe nur aus Pfaden ist nie die Einheit; Verweise gedeckelt.
	assert.equal(pickDocumentCatalog([{ id: 8, signature: "", stub: true }], { id: "x", archiveId: 8 }).unit, null);
	const many = Array.from({ length: DOCUMENT_REFERENCES_MAX + 3 }, (_, i): H => ({ ...urkunde, id: i + 1, signature: `C I, Nr. ${i + 1}` }));
	const refs = pickDocumentCatalog(many, doc).references;
	assert.equal(refs.length, DOCUMENT_REFERENCES_MAX);
	assert.deepEqual(refs.slice(0, 3).map((r) => r.signature), ["C I, Nr. 1", "C I, Nr. 2", "C I, Nr. 3"]);
});

test("Katalogeintrag eines Dokuments: archiveLink nennt die Nachbareinheit", () => {
	type H = { id: number; signature: string; onPlatform?: boolean; docId?: string; stub?: boolean };
	// Prod 2026-11-09: MM_2_3_RRB_1831_0882 trägt die archiveId der Einheit von 1831/0883.
	const nachbar: H = { id: 460367, signature: "MM 2.3 RRB 1831/0883", onPlatform: true, docId: "MM_2_3_RRB_1831_0883" };
	const eigene: H = { id: 460366, signature: "MM 2.3 RRB 1831/0882", onPlatform: true, docId: "MM_2_3_RRB_1831_0882" };
	const doc = { id: "MM_2_3_RRB_1831_0882", archiveId: 460367 };
	assert.equal(pickDocumentCatalog([nachbar, eigene], doc).unit, eigene);
	assert.equal(pickDocumentCatalog([eigene, nachbar], doc).unit, eigene);
	// Die genannte Einheit verlinkt das Dokument (auch ohne «_t») oder hat keinen Weblink: sie gilt.
	assert.equal(pickDocumentCatalog([nachbar, eigene], { id: "MM_2_3_RRB_1831_0883", archiveId: 460367 }).unit, nachbar);
	const ohneLink: H = { id: 714502, signature: "MM 2.181 RRB 1868/1295 - MM 2.181 RRB 1868/1801", onPlatform: false };
	assert.equal(pickDocumentCatalog([ohneLink, eigene], { id: "MM_2_3_RRB_1831_0882", archiveId: 714502 }).unit, ohneLink);
	// Zweite Mitgliederliste eines Bandes: keine Einheit verlinkt sie, die genannte bleibt.
	const band: H = { id: 714445, signature: "MM 2.124 RRB 1854/0499 - MM 2.124 RRB 1854/1080", onPlatform: true, docId: "MM_2_124_mitgliederliste" };
	assert.equal(pickDocumentCatalog([band], { id: "MM_2_124_mitgliederliste_II", archiveId: 714445 }).unit, band);
	// Genannte Einheit (noch) nicht im Index: die Einheit mit Weblink.
	assert.equal(pickDocumentCatalog([eigene], doc).unit, eigene);
	// Getippte Fassung: Weblink ohne «_t».
	const getippt: H = { id: 3848476, signature: "MM 3.41 RRB 1927/1580", onPlatform: true, docId: "MM_3_41_RRB_1927_1580" };
	assert.equal(pickDocumentCatalog([getippt], { id: "MM_3_41_RRB_1927_1580_t", archiveId: 999 }).unit, getippt);
	// Vor dem Neuaufbau trugen Verweise onPlatform: eine Urkunde ist nie die Einheit.
	const urkunde: H = { id: 252294, signature: "C I, Nr. 3889", onPlatform: true, docId: "MM_2_3_RRB_1831_0882" };
	assert.equal(pickDocumentCatalog([nachbar, urkunde], doc).unit, nachbar);
});

test("Personenseite: Filter für gesicherte Einheiten und Namensvorschläge, Gruppen nach Bestand", () => {
	assert.equal(personCatalogFilter([3182, 977], "secured"), "onPlatform = false AND krdbIds IN [3182, 977]");
	assert.equal(
		personCatalogFilter([3182], "names"),
		"onPlatform = false AND krdbNameIds IN [3182] AND NOT krdbIds IN [3182]",
	);
	const u = (id: number, bestand: string | null, bestandId: number | null) => ({ id, bestand, bestandId });
	const groups = groupByBestand([u(1, "Z 1114 Fotos (Bestand)", 50), u(2, "U Akten (Bestand)", null), u(3, "Z 1114 Fotos (Bestand)", 50), u(4, null, null), u(5, "U Akten (Bestand)", 60)]);
	assert.deepEqual(
		groups.map((g) => [g.bestand, g.bestandId, g.units.map((x) => x.id)]),
		[
			["Z 1114 Fotos (Bestand)", 50, [1, 3]],
			["U Akten (Bestand)", 60, [2, 5]],
			[null, null, [4]],
		],
	);
});
