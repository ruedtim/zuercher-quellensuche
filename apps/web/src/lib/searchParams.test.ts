// Lauf: npx tsx --test src/lib/searchParams.test.ts
// Sichert die Sort-Default-Logik der Trefferliste ab: Relevanz (Label «Relevanz» bzw.
// «Ähnlichkeit») ist nur mit Suchbegriff oder Thema ein sinnvolles Ranking –
// ohne beides fällt der Default auf "älteste zuerst" (date_asc), sonst zeigt
// Meili bei leerer Query die interne Einfüge-Reihenfolge (= ältester ABl-
// Jahrgang zuoberst).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	effectiveSort,
	relevanceSortApplicable,
	parseSearchParams,
	SEARCH_LIMITS,
	searchParamsToUrl,
	splitOrQuery,
	foldSingleAnyTerm,
	foldRmSharpS,
	combineUnionQuery,
	parseFieldInput,
	exclusionsFirst,
	unionHighlightTerms,
	autoOpensAdvanced,
	dateRangeLabel,
} from "./searchParams";
import type { SeriesAbbr } from "./types";

test("relevanceSortApplicable: nur mit Suchbegriff, Thema oder ODER-Begriffen", () => {
	assert.equal(relevanceSortApplicable({ q: "", theme: "", anyTerms: [] }), false);
	assert.equal(relevanceSortApplicable({ q: "   ", theme: "  ", anyTerms: [] }), false, "Whitespace zählt nicht");
	assert.equal(relevanceSortApplicable({ q: "spital", theme: "", anyTerms: [] }), true);
	assert.equal(relevanceSortApplicable({ q: "", theme: "gesundheitswesen", anyTerms: [] }), true);
	assert.equal(relevanceSortApplicable({ q: "spital", theme: "gesundheitswesen", anyTerms: [] }), true);
	// ODER-Begriffe sind ein Ranking-Signal (Föderations-Score).
	assert.equal(relevanceSortApplicable({ q: "", theme: "", anyTerms: ["Kokain", "Coca"] }), true);
});

test("effectiveSort: relevance ohne Ranking-Signal → date_asc (älteste zuerst)", () => {
	assert.equal(effectiveSort({ q: "", theme: "", anyTerms: [], sort: "relevance" }), "date_asc");
	assert.equal(effectiveSort({ q: "   ", theme: "", anyTerms: [], sort: "relevance" }), "date_asc");
});

test("effectiveSort: explizit gewählte Datums-Sorts bleiben unangetastet", () => {
	assert.equal(effectiveSort({ q: "", theme: "", anyTerms: [], sort: "date_desc" }), "date_desc");
	assert.equal(effectiveSort({ q: "", theme: "", anyTerms: [], sort: "date_asc" }), "date_asc");
});

test("effectiveSort: mit Ranking-Signal bleibt relevance erhalten", () => {
	assert.equal(effectiveSort({ q: "spital", theme: "", anyTerms: [], sort: "relevance" }), "relevance");
	assert.equal(effectiveSort({ q: "", theme: "gesundheitswesen", anyTerms: [], sort: "relevance" }), "relevance");
	// ODER-Begriffe halten relevance (Föderations-Score) ebenfalls.
	assert.equal(effectiveSort({ q: "", theme: "", anyTerms: ["Kokain", "Coca"], sort: "relevance" }), "relevance");
	// Datums-Sort mit Suchbegriff bleibt natürlich auch Datums-Sort.
	assert.equal(effectiveSort({ q: "spital", theme: "", anyTerms: [], sort: "date_desc" }), "date_desc");
});

test("splitOrQuery: trennt an OR / | , trimmt, dedupliziert, hält Mehrwort-Begriffe", () => {
	assert.deepEqual(splitOrQuery("Kokain OR Coca OR Kokainismus"), ["Kokain", "Coca", "Kokainismus"]);
	assert.deepEqual(splitOrQuery("Kokain | Koks"), ["Kokain", "Koks"]);
	assert.deepEqual(splitOrQuery("tolle Hunde OR Wuth"), ["tolle Hunde", "Wuth"], "Mehrwort bleibt intakt");
	assert.deepEqual(splitOrQuery("Kokain or coca"), ["Kokain", "coca"], "OR ist case-insensitiv");
	assert.deepEqual(splitOrQuery("Kokain OR kokain OR  Kokain "), ["Kokain"], "dedupe (case-insensitiv) + trim");
	assert.deepEqual(splitOrQuery("nuretwas"), ["nuretwas"], "ein Begriff bleibt einer (kein ODER)");
	assert.deepEqual(splitOrQuery("   "), [], "leer → leer");
});

test("splitOrQuery: in Anführungszeichen ist OR ein gewöhnliches Wort", () => {
	// OR = Obligationenrecht: die Phrase bleibt ganz.
	assert.deepEqual(splitOrQuery('"Art. 41 OR Haftung"'), ['"Art. 41 OR Haftung"']);
	assert.deepEqual(splitOrQuery('"a | b"'), ['"a | b"'], "auch | bleibt in der Phrase");
	// Phrasen als ODER-Teile behalten ihre Anführungszeichen.
	assert.deepEqual(splitOrQuery('"tolle Hunde" OR Wuth'), ['"tolle Hunde"', "Wuth"]);
	assert.deepEqual(splitOrQuery('Wuth | "tolle Hunde"'), ["Wuth", '"tolle Hunde"']);
	assert.deepEqual(splitOrQuery('"Art. 41 OR" OR Haftpflicht'), ['"Art. 41 OR"', "Haftpflicht"]);
	// Ungeschlossene Phrase reicht wie bei Meili bis zum Ende.
	assert.deepEqual(splitOrQuery('Koks OR "Kokain OR Coca'), ["Koks", '"Kokain OR Coca']);
});

// Ein einzelner ODER-Begriff (`?qAny=Wuth`, entsteht beim ersten Begriff im
// Feld «Irgendeines dieser Wörter») ist keine Union und wirkt als Suchbegriff.
// Trefferliste, Facetten-Typeahead und KI-Treffer-Scope falten ihn gemeinsam –
// vorher ignorierte der KI-Scope ihn und befragte den ganzen Korpus.
test("foldSingleAnyTerm: einzelner ODER-Begriff → an q angehängt", () => {
	const url = parseSearchParams(new URL("http://local/search?qAny=Wuth&series=RRB"));
	const folded = foldSingleAnyTerm(url);
	assert.equal(folded.q, "Wuth");
	assert.deepEqual(folded.anyTerms, []);
	assert.deepEqual(folded.series, ["RRB"], "übrige Felder bleiben erhalten");
	// Mit Suchbegriff: angehängt, q getrimmt (UND wie ein weiterer Pflicht-Term).
	assert.deepEqual(foldSingleAnyTerm({ q: "  Hund ", anyTerms: ["Wuth"] }), { q: "Hund Wuth", anyTerms: [] });
	// Phrasen- und Ausschluss-Syntax reist unverändert mit (Meili parst sie).
	assert.deepEqual(foldSingleAnyTerm({ q: "", anyTerms: ['"tolle Hunde"'] }), { q: '"tolle Hunde"', anyTerms: [] });
	assert.deepEqual(foldSingleAnyTerm({ q: "-Katze", anyTerms: ["Wuth"] }), { q: "-Katze Wuth", anyTerms: [] });
});

test("foldSingleAnyTerm: Kopie beim Falten, sonst dasselbe Objekt", () => {
	// Die Roh-Params der UI (ODER-Chip) dürfen nicht mutiert werden.
	const raw = { q: "Hund", anyTerms: ["Wuth"] };
	const folded = foldSingleAnyTerm(raw);
	assert.notEqual(folded, raw);
	assert.deepEqual(raw, { q: "Hund", anyTerms: ["Wuth"] });
	// Keine oder >= 2 Begriffe (echte Union): unverändert.
	const none = { q: "Hund", anyTerms: [] };
	assert.equal(foldSingleAnyTerm(none), none);
	const union = { q: "", anyTerms: ["Koks", "Kokain"] };
	assert.equal(foldSingleAnyTerm(union), union);
});

// Mehrwortige ODER-Begriffe verlangen alle ihre Wörter: mit Meilis Default
// `last` träfe `tolle Hunde OR Wuth` auch Dokumente, die nur «tolle» enthalten.
test("combineUnionQuery: Pflicht-`q` an jeden ODER-Zweig, jeder Zweig strikt – auch ohne q", () => {
	assert.deepEqual(combineUnionQuery("tolle Hunde", ""), { q: "tolle Hunde", matchingStrategy: "all" });
	assert.deepEqual(combineUnionQuery("Kokain", "   "), { q: "Kokain", matchingStrategy: "all" }, "leerer q zählt nicht");
	// Mit Suchbegriff: anhängen (→ (A ODER B) UND q).
	assert.deepEqual(combineUnionQuery("Kokain", "Beschlagnahmung"), {
		q: "Kokain Beschlagnahmung",
		matchingStrategy: "all",
	});
	// q wird getrimmt; Ausschlüsse wandern nach vorn (exclusionsFirst), damit
	// das letzte positive Wort seine Prefix-Expansion behält (Issue #112).
	assert.deepEqual(combineUnionQuery("Koks", "  Beschlagnahmung -Heroin  "), {
		q: "-Heroin Koks Beschlagnahmung",
		matchingStrategy: "all",
	});
});

// Wortfelder der Suchmaske: Einfach-Feld (exclude = «ausschliessen»), «Alle
// diese Wörter», «Irgendeines dieser Wörter» (alternative), «Ohne diese Wörter»
// (exclude). exact = Häkchen «exakt».
test("parseFieldInput: Einzelbegriff je Feld (ohne ODER)", () => {
	assert.deepEqual(parseFieldInput(" Hundesteuer ", { exact: false }), { q: "Hundesteuer", anyTerms: [] });
	assert.deepEqual(parseFieldInput("tolle Hunde", { exact: true }), { q: '"tolle Hunde"', anyTerms: [] });
	// Anführungszeichen in der Eingabe machen sie zur Phrase (wie das Häkchen).
	assert.deepEqual(parseFieldInput('"tolle" Hunde', { exact: false }), { q: '"tolle Hunde"', anyTerms: [] });
	// Ausschluss: mehrere Wörter einzeln negiert, Phrase als Ganzes.
	assert.deepEqual(parseFieldInput("Entwurf Vorlage", { exact: false, exclude: true }), {
		q: "-Entwurf -Vorlage",
		anyTerms: [],
	});
	assert.deepEqual(parseFieldInput("freiwillige Feuerwehr", { exact: true, exclude: true }), {
		q: '-"freiwillige Feuerwehr"',
		anyTerms: [],
	});
	// ODER-Feld: ein einzelner Begriff ist eine Alternative.
	assert.deepEqual(parseFieldInput("See", { exact: false, alternative: true }), { q: "", anyTerms: ["See"] });
	assert.deepEqual(parseFieldInput("tolle Hunde", { exact: true, alternative: true }), {
		q: "",
		anyTerms: ['"tolle Hunde"'],
	});
	// Leer bzw. nur Anführungszeichen → nichts.
	assert.deepEqual(parseFieldInput("   ", { exact: false }), { q: "", anyTerms: [] });
	assert.deepEqual(parseFieldInput('""', { exact: false, alternative: true }), { q: "", anyTerms: [] });
});

test("parseFieldInput: getipptes A OR B in «Alle diese Wörter» → ODER-Alternativen statt Pflicht-«or»", () => {
	assert.deepEqual(parseFieldInput("Kokain OR Coca", { exact: false }), { q: "", anyTerms: ["Kokain", "Coca"] });
	assert.deepEqual(parseFieldInput("tolle Hunde | Wuth", { exact: false }), {
		q: "",
		anyTerms: ["tolle Hunde", "Wuth"],
	});
	// «exakt» gilt je Teil; ohne Häkchen ist nur ein selbst gequoteter Teil Phrase.
	assert.deepEqual(parseFieldInput("tolle Hunde OR Wuth", { exact: true }), {
		q: "",
		anyTerms: ['"tolle Hunde"', '"Wuth"'],
	});
	assert.deepEqual(parseFieldInput('"tolle Hunde" OR Wuth', { exact: false }), {
		q: "",
		anyTerms: ['"tolle Hunde"', "Wuth"],
	});
	// OR in Anführungszeichen ist wörtlich → gewöhnliche Phrase (Pflicht).
	assert.deepEqual(parseFieldInput('"Art. 41 OR Haftung"', { exact: false }), {
		q: '"Art. 41 OR Haftung"',
		anyTerms: [],
	});
});

test("parseFieldInput: getipptes A OR B im ODER-Feld – «exakt» je Teil", () => {
	assert.deepEqual(parseFieldInput("Kokain OR Coca", { exact: false, alternative: true }), {
		q: "",
		anyTerms: ["Kokain", "Coca"],
	});
	assert.deepEqual(parseFieldInput("Kokain OR Coca", { exact: true, alternative: true }), {
		q: "",
		anyTerms: ['"Kokain"', '"Coca"'],
	});
});

test("parseFieldInput: getipptes A OR B beim Ausschluss → NICHT A UND NICHT B", () => {
	// «Ohne diese Wörter» / Häkchen «ausschliessen»: kein -OR-Token.
	assert.deepEqual(parseFieldInput("Entwurf OR Vorlage", { exact: false, exclude: true }), {
		q: "-Entwurf -Vorlage",
		anyTerms: [],
	});
	// Mehrwortige Teile wortweise, doppelte Wörter nur einmal.
	assert.deepEqual(parseFieldInput("tolle Hunde OR Hunde | Wuth", { exact: false, exclude: true }), {
		q: "-tolle -Hunde -Wuth",
		anyTerms: [],
	});
	// «exakt» bzw. eigene Anführungszeichen: je Teil eine ausgeschlossene Phrase.
	assert.deepEqual(parseFieldInput("tolle Hunde OR Wuth", { exact: true, exclude: true }), {
		q: '-"tolle Hunde" -"Wuth"',
		anyTerms: [],
	});
	assert.deepEqual(parseFieldInput('"tolle Hunde" OR Wuth', { exact: false, exclude: true }), {
		q: '-"tolle Hunde" -Wuth',
		anyTerms: [],
	});
});

// Meili expandiert Wortanfänge nur beim letzten Query-Term – Ausschlüsse am
// Ende verdrängen das letzte positive Wort von dieser Position und lassen die
// Treffermenge kollabieren (Issue #112: `fisch` 17'732 ↔ `fisch -das` 125
// statt 2'579). exclusionsFirst stellt Negationen nach vorn.
test("exclusionsFirst: Ausschluss-Tokens nach vorn, Reihenfolge je Gruppe stabil", () => {
	assert.equal(exclusionsFirst("fisch -das"), "-das fisch");
	assert.equal(exclusionsFirst("fisch -das -see wasser"), "-das -see fisch wasser");
	// Negierte Phrasen wandern mit, positive Phrasen bleiben an ihrem Platz.
	assert.equal(exclusionsFirst('feuerwehr -"freiwillige Feuerwehr"'), '-"freiwillige Feuerwehr" feuerwehr');
	assert.equal(exclusionsFirst('"tolle Hunde" -Wuth biss'), '-Wuth "tolle Hunde" biss');
});

test("exclusionsFirst: unbalancierte Anführungszeichen → keine Umstellung", () => {
	// Meili liest eine ungeschlossene `"` als Phrase bis zum String-Ende – ein
	// nach vorn gestellter offener Negations-Token würde alle folgenden
	// positiven Wörter verschlucken (Match-all über den ganzen Korpus statt
	// Suche). Quote-Parity-Guard: solche Queries unverändert lassen.
	assert.equal(exclusionsFirst('fisch -"das'), 'fisch -"das');
	assert.equal(exclusionsFirst('fisch -"freiwillige'), 'fisch -"freiwillige');
	assert.equal(exclusionsFirst('"der fisch -das'), '"der fisch -das');
	assert.equal(exclusionsFirst('fisch "a b" -"c'), 'fisch "a b" -"c');
	// Balancierte Phrasen werden weiterhin umgestellt.
	assert.equal(exclusionsFirst('fisch -"a b"'), '-"a b" fisch');
});

test("exclusionsFirst: ohne Ausschlüsse bleibt die Query unangetastet (roh)", () => {
	assert.equal(exclusionsFirst("fisch see"), "fisch see");
	assert.equal(exclusionsFirst(""), "");
	// Binnen-Minus ist kein Ausschluss – Original-String (inkl. Whitespace) bleibt roh.
	assert.equal(exclusionsFirst("Kokain-Handel  see"), "Kokain-Handel  see");
	// Nur Ausschlüsse → keine Umstellung nötig, aber stabil.
	assert.equal(exclusionsFirst("-das"), "-das");
});

test("exclusionsFirst: Nasalstrich/¬ der Ratsmanuale wie in der Lesefassung", () => {
	// Aus der diplomatischen Detailseite kopiert («kom̅en») → Lesefassung «kommen».
	assert.equal(exclusionsFirst('"zu kom\u0305en"'), '"zu kommen"');
	assert.equal(exclusionsFirst("Burger¬ meister -Rat"), "-Rat Burgermeister");
});

test("foldRmSharpS: ß → ss nur bei reiner Ratsmanual-Auswahl", () => {
	const p = { q: '"Hanßen Müllers" daß -Großrat 10 ß.', anyTerms: ["Eßlinger", "Wyß"], series: ["RM"] as SeriesAbbr[] };
	const f = foldRmSharpS(p);
	assert.equal(f.q, '"Hanssen Müllers" dass -Grossrat 10 ß.');
	assert.deepEqual(f.anyTerms, ["Esslinger", "Wyss"]);
	assert.equal(p.q, '"Hanßen Müllers" daß -Großrat 10 ß.', "Original unverändert");
	// Andere Serien schreiben ß zeichengetreu: keine Angleichung.
	assert.equal(foldRmSharpS({ ...p, series: ["RM", "KRP"] }).q, p.q);
	assert.equal(foldRmSharpS({ ...p, series: [] }).q, p.q);
	// Ohne ß dasselbe Objekt.
	const plain = { q: "Pest", anyTerms: [], series: ["RM"] as SeriesAbbr[] };
	assert.equal(foldRmSharpS(plain), plain);
});

test("parseSearchParams: zerlegte Umlaute (macOS, PDF) werden zusammengesetzt", () => {
	const ue = "u\u0308";
	const p = parseSearchParams(new URL(`http://local/search?q=K${ue}snacht&theme=M${ue}hle&qAny=Z${ue}rich&qAny=Zürich&persons=M${ue}ller, Hans`));
	assert.deepEqual([p.q, p.theme, p.anyTerms, p.persons], ["Küsnacht", "Mühle", ["Zürich"], ["Müller, Hans"]]);
	// Zeichen ohne zusammengesetzte Form bleiben (uͤ der Ratsmanuale).
	assert.equal(parseSearchParams(new URL("http://local/search?q=uͤbergab")).q, "uͤbergab");
});

test("parseSearchParams: Jahresgrenzen ab 1483 (Ratsmanuale), darunter geklemmt", () => {
	const p = (qs: string) => parseSearchParams(new URL(`http://local/search?${qs}`));
	assert.equal(p("dateFrom=1484&dateTo=1798").dateFrom, 1484);
	assert.equal(p("dateFrom=1484&dateTo=1798").dateTo, 1798);
	assert.equal(p("dateFrom=1650").dateFrom, 1650);
	assert.equal(p("dateFrom=1400").dateFrom, 1483);
	assert.equal(p("series=RM").series.join(","), "RM");
});

test("qAny: Round-Trip als wiederholter Param (ODER-Begriffe)", () => {
	const url = searchParamsToUrl({ anyTerms: ["Kokain", "Coca", "Kokainismus"] });
	assert.deepEqual(url.searchParams.getAll("qAny"), ["Kokain", "Coca", "Kokainismus"]);
	const round = parseSearchParams(url).anyTerms;
	assert.deepEqual(round, ["Kokain", "Coca", "Kokainismus"]);
	// Leer → nicht serialisiert.
	assert.equal(searchParamsToUrl({ anyTerms: [] }).searchParams.has("qAny"), false);
	// Parser dedupliziert/trimmt wiederholte Werte.
	const dup = parseSearchParams(new URL("http://local/search?qAny=Kokain&qAny=Kokain&qAny=%20Coca%20"));
	assert.deepEqual(dup.anyTerms, ["Kokain", "Coca"]);
});

test("titleOnly: Round-Trip als titleOnly=1, Default false, weglassen bei false", () => {
	// Default: nicht gesetzt → false, nicht serialisiert.
	assert.equal(parseSearchParams(new URL("http://local/search?q=x")).titleOnly, false);
	assert.equal(searchParamsToUrl({ titleOnly: false }).searchParams.has("titleOnly"), false);
	// Gesetzt: serialisiert als "1" und überlebt den Round-Trip.
	assert.equal(searchParamsToUrl({ titleOnly: true }).searchParams.get("titleOnly"), "1");
	assert.equal(parseSearchParams(searchParamsToUrl({ titleOnly: true })).titleOnly, true);
	// Nur exakt "1" zählt (defensive gegen alte/fremde Werte).
	assert.equal(parseSearchParams(new URL("http://local/search?titleOnly=0")).titleOnly, false);
	assert.equal(parseSearchParams(new URL("http://local/search?titleOnly=true")).titleOnly, false);
});

test("unionHighlightTerms: positive Tokens aus ODER-Zweigen + UND-q", () => {
	assert.deepEqual(unionHighlightTerms(["Kokain", "Coca"], ""), ["Kokain", "Coca"]);
	// UND-q kommt dazu, Ausschlüsse fallen weg, Phrasen bleiben ganz.
	assert.deepEqual(unionHighlightTerms(['"Heroin Handel"', "Koks"], "Polizei -Brennstoff"), [
		"Heroin Handel",
		"Koks",
		"Polizei",
	]);
	// Mehrwortige unquoted ODER-Begriffe werden wortweise tokenisiert (wie
	// Meili wortweise highlightet); Dubletten case-insensitiv dedupliziert.
	assert.deepEqual(unionHighlightTerms(["tolle Hunde", "hunde"], ""), ["tolle", "Hunde"]);
	// Das Thema ist hier bewusst kein Input – nur lexikalische Begriffe.
	assert.deepEqual(unionHighlightTerms([], "  "), []);
});

// «Erweiterte Suchoptionen» klappen nur für Filter auf, die allein dort sichtbar
// wären. Geprüft über parseSearchParams, also genau so, wie ein geteilter Link
// bzw. die URL nach einem Klick auf die Zeitleiste ankommt.
const autoOpen = (qs: string) => autoOpensAdvanced(parseSearchParams(new URL(`http://local/search?${qs}`)));

test("autoOpensAdvanced: Zeitraum (Zeitleiste oder Link) klappt nicht auf", () => {
	assert.equal(autoOpen(""), false, "pristine Suche");
	assert.equal(autoOpen("dateFrom=1650&dateTo=1659"), false, "Jahrzehnt aus der Zeitleiste");
	assert.equal(autoOpen("dateFrom=1655&dateTo=1655"), false, "Einzeljahr");
	assert.equal(autoOpen("dateFrom=1850"), false, "nur von");
	assert.equal(autoOpen("dateTo=1550"), false, "nur bis");
	// Suchbegriff (Chips) und «nur im Titel» (Häkchen) sind auch eingeklappt sichtbar.
	assert.equal(autoOpen("q=fisch+-see&titleOnly=1&dateFrom=1900&dateTo=1950&sort=date_desc"), false);
});

test("autoOpensAdvanced: echte Advanced-Eingaben klappen weiterhin auf", () => {
	for (const qs of [
		"qAny=Kokain&qAny=Coca",
		"qAny=Wuth",
		"theme=Tierhaltung",
		"series=KRP",
		"persons=Escher",
		"places=Uster",
		"organizations=Regierungsrat",
		// Serienspezifische Filter (in der UI nur bei einer Serie) zählen je für sich.
		"volumeNr=441",
		"startPg=12",
		"serialNr=131.1",
		"resolutionId=1803%2F0003",
		"years=1934",
		"topK=100",
	]) {
		assert.equal(autoOpen(qs), true, qs);
		// … auch zusammen mit einem Zeitraum (der allein nicht aufklappt).
		assert.equal(autoOpen(`${qs}&dateFrom=1900&dateTo=1950`), true, `${qs} + Zeitraum`);
	}
	// Ein Thema aus Leerzeichen zählt nicht.
	assert.equal(
		autoOpensAdvanced({ ...parseSearchParams(new URL("http://local/search")), theme: "   " }),
		false,
	);
});

test("dateRangeLabel: Einzeljahr, Bereich, offene Enden", () => {
	assert.equal(dateRangeLabel(null, null), null);
	assert.equal(dateRangeLabel(1655, 1655), "1655");
	assert.equal(dateRangeLabel(1600, 1700), "1600 – 1700");
	assert.equal(dateRangeLabel(1850, null), "ab 1850");
	assert.equal(dateRangeLabel(null, 1550), "bis 1550");
});

test("foldRmSharpS mit allSeries: ß → ss für jede Auswahl (Suchtext-Stand des Index)", () => {
	const p = { ...parseSearchParams(new URL("http://x/search?q=Straße&qAny=Maß&qAny=Fuß")) };
	const f = foldRmSharpS(p, true);
	assert.equal(f.q, "Strasse");
	assert.deepEqual(f.anyTerms, ["Mass", "Fuss"]);
	assert.equal(foldRmSharpS(p).q, "Straße", "ohne allSeries nur bei reiner RM-Auswahl");
	assert.equal(foldRmSharpS({ ...p, q: "GROẞE" }, true).q, "GROSSE");
});

test("Zahlen aus der URL: nur sichere Ganzzahlen, Seite geklemmt (kein «1e+26» an Meili)", () => {
	const p = (qs: string) => parseSearchParams(new URL(`http://local/search?${qs}`));
	const huge = "1" + "0".repeat(26);
	assert.deepEqual(p(`volumeNr=${huge}`).volumeNr, []);
	assert.deepEqual(p(`startPg=12,${huge},-${huge},7`).startPg, [12, 7]);
	assert.deepEqual(p(`years=1900,${huge}`).years, [1900]);
	for (const list of [p(`volumeNr=3,${huge}`).volumeNr, p(`years=${Number.MAX_SAFE_INTEGER}`).years]) {
		assert.ok(list.every((n) => /^-?\d+$/.test(String(n))), String(list));
	}
	assert.equal(p("page=3").page, 3);
	assert.equal(p("page=0").page, 1);
	assert.equal(p("page=-5").page, 1);
	assert.equal(p("page=abc").page, 1);
	assert.ok(/^\d+$/.test(String(p(`page=${huge}`).page * 100)), "auch der Offset bleibt ohne Exponent");
});

test("parseSearchParams: Obergrenzen, weit über dem, was die Oberfläche erzeugt", () => {
	const many = (name: string, n: number, value = (i: number) => `w${i}`) =>
		Array.from({ length: n }, (_, i) => `${name}=${encodeURIComponent(value(i))}`).join("&");
	const p = parseSearchParams(
		new URL(
			`http://x/search?q=${"a".repeat(2000)}&theme=${"b".repeat(2000)}&${many("qAny", 40)}&${many("persons", 80)}` +
				`&${many("places", 1, () => "x".repeat(900))}&volumeNr=${Array.from({ length: 900 }, (_, i) => i + 1).join(",")}` +
				`&resolutionId=${Array.from({ length: 900 }, (_, i) => `1803/${i}`).join(",")}`,
		),
	);
	assert.equal(p.q.length, SEARCH_LIMITS.text);
	assert.equal(p.theme.length, SEARCH_LIMITS.text);
	assert.deepEqual(p.anyTerms, Array.from({ length: SEARCH_LIMITS.anyTerms }, (_, i) => `w${i}`), "die ersten");
	assert.equal(p.persons.length, SEARCH_LIMITS.names);
	assert.equal(p.places[0].length, SEARCH_LIMITS.value);
	assert.equal(p.volumeNr.length, SEARCH_LIMITS.values);
	assert.equal(p.resolutionId.length, SEARCH_LIMITS.values);
	// Die Seiten des Kleinen Rats verlinken bis 114 Bände.
	assert.ok(SEARCH_LIMITS.values >= 114);
	// Normales bleibt unberührt.
	const normal = parseSearchParams(new URL("http://x/search?q=wald%20see&qAny=a&qAny=b&volumeNr=1,2&persons=Anna%20Meier"));
	assert.deepEqual([normal.q, normal.anyTerms, normal.volumeNr, normal.persons], ["wald see", ["a", "b"], [1, 2], ["Anna Meier"]]);
});
