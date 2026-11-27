// Lauf: npx tsx --test src/lib/server/searchTools.test.ts
// Deckt die netzfreien (env-freien) Bausteine der MCP-Such-Werkzeuge ab:
// Argument-Normalisierung, die searchDocuments-Argumente der Zähl-, Listen- und
// Ranking-Werkzeuge (mit einer Meili-Attrappe), Gegenproben-Hinweise, Lücken-
// Vorbehalte und Katalog-Hilfen. Den I/O-Teil (mcp/tools.ts) deckt das nicht ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	normalizeSeries,
	clampYear,
	clampTopK,
	normalizeSort,
	normalizeTerms,
	mergeRoundRobin,
	mergeRoundRobinPage,
	clampListLimit,
	clampOffset,
	clampPassageOffset,
	PASSAGE_WINDOW_MAX,
	fieldAttrs,
	fetchText,
	FETCH_TEXT_MAX,
	phraseWrap,
	exactWrap,
	lexicalQuery,
	exactProbeQuery,
	inflationHint,
	EXACT_HINT_MAX_RATIO,
	EXACT_HINT_MIN_DIFF,
	aggregateSearch,
	aggregateYearDist,
	countAggregate,
	queryWords,
	rankingSearch,
	type AggregateSearchFn,
	type AggregateSearchOpts,
	PAGE_WINDOW_MAX,
	INCOMPLETE_SERIES,
	timelineCoverageCaveat,
	topYearsByCount,
	zeroHitHint,
	catalogExactLast,
	catalogPrefixNote,
	semanticCatalogText,
	clampCatalogYear,
	normalizeCatalogLevel,
	type CatalogHitInput,
	isLexicalOnlyScope,
	preModernTimelineNote,
} from "./searchTools";
import { DEFAULT_SEARCH, type SearchHit, type SearchParams } from "$lib/types";

const params = (over: Partial<SearchParams> = {}): SearchParams => ({ ...DEFAULT_SEARCH, ...over });

const hit = (id: string, series: SearchHit["series"] = "RRB"): SearchHit => ({
	id,
	series,
	title: `Titel ${id}`,
	date: "2010-01-01",
	dateYear: 2010,
	startPg: null,
	volumeNr: null,
	serialNr: null,
	resolutionId: null,
	stazhIdent: null,
	archiveLink: null,
	manifestUrl: null,
});

test("normalizeSeries: nur gültige Kürzel, dedupliziert", () => {
	assert.deepEqual(normalizeSeries(["RRB", "KRP", "RRB", "XX", 5, "OS"]), ["RRB", "KRP", "OS"]);
	// Ein einzelnes Kürzel als String (MCP-Clients schicken das) zählt, statt still ungefiltert zu suchen.
	assert.deepEqual(normalizeSeries("RRB"), ["RRB"]);
	assert.deepEqual(normalizeSeries("RRB, KRP"), ["RRB", "KRP"]);
	assert.deepEqual(normalizeSeries("XX"), []);
	assert.deepEqual(normalizeSeries(undefined), []);
});

test("clampYear: Bereich 1483–2100, sonst null", () => {
	assert.equal(clampYear(1850), 1850);
	assert.equal(clampYear(1650), 1650);
	assert.equal(clampYear(1400), 1483);
	assert.equal(clampYear(3000), 2100);
	assert.equal(clampYear(1999.7), 1999);
	assert.equal(clampYear("1900"), 1900, "Ziffern-String zählt");
	assert.equal(clampYear("19. Jh."), null);
	assert.equal(clampYear(undefined), null);
});

test("clampTopK: [1,max], Default 6; max überschreibbar", () => {
	assert.equal(clampTopK(undefined), 6);
	assert.equal(clampTopK(0), 1);
	assert.equal(clampTopK(99), 25, "Default-Decke 25");
	assert.equal(clampTopK("8"), 8, "Ziffern-String zählt");
	assert.equal(clampTopK(4), 4);
	assert.equal(clampTopK(99, 6, 12), 12, "eigene Decke 12");
	assert.equal(clampTopK(undefined, 6, 12), 6);
});

test("normalizeSort: nur date_asc/date_desc, sonst relevance", () => {
	assert.equal(normalizeSort("date_desc"), "date_desc");
	assert.equal(normalizeSort("date_asc"), "date_asc");
	assert.equal(normalizeSort("foo"), "relevance");
	assert.equal(normalizeSort(undefined), "relevance");
});

test("normalizeTerms: query + Synonyme, getrimmt, dedupliziert (case-insensitiv), gekappt", () => {
	assert.deepEqual(normalizeTerms("Tollwut", ["Wut", " Hydrophobie ", "tollwut", "Lyssa"]), [
		"Tollwut",
		"Wut",
		"Hydrophobie",
		"Lyssa",
	]);
	assert.deepEqual(normalizeTerms("a", undefined), ["a"]);
	assert.deepEqual(normalizeTerms("x", ["1", "2", "3", "4", "5", "6", "7"], 3), ["x", "1", "2"]);
	assert.equal(normalizeTerms("q", ["1", "2", "3", "4", "5", "6", "7", "8", "9"]).length, 8, "Default-Deckel 8");
});

test("mergeRoundRobin: faires Interleaving, Dedup über docId, Cap", () => {
	const r = (id: string) => ({ hit: { id } });
	// Liste A: a1,a2,a3 ; Liste B: b1,a2(dup),b3. i=0→a1,b1 ; i=1→a2,(b.a2 dup) ;
	// i=2→a3 erreicht den Cap 4 (b3 fällt raus).
	const merged = mergeRoundRobin([[r("a1"), r("a2"), r("a3")], [r("b1"), r("a2"), r("b3")]], 4);
	assert.deepEqual(merged.map((m) => m.hit.id), ["a1", "b1", "a2", "a3"], "round-robin, a2-Dup übersprungen");
	assert.equal(mergeRoundRobin([[r("a")], [r("b")], [r("c")]], 2).length, 2, "Cap greift");
});

test("phraseWrap: Anfrage bei phrase=true in Anführungszeichen, auch ein einzelnes Wort", () => {
	assert.equal(phraseWrap("Jacqueline Fehr", true), '"Jacqueline Fehr"');
	assert.equal(phraseWrap("  Jacqueline Fehr  ", true), '"Jacqueline Fehr"', "getrimmt");
	assert.equal(phraseWrap("Jacqueline Fehr", false), "Jacqueline Fehr", "ohne phrase unverändert");
	// Bis 2026-11 ein stiller No-op: In Meili schaltet das Zitat auch bei einem
	// Wort die Tippfehler-Toleranz und den Wortanfang ab (Prod vor #259: 8'066 → 841).
	assert.equal(phraseWrap("Pause", true), '"Pause"', "einzelnes Wort wird gewrappt");
	assert.equal(phraseWrap('"Jacqueline Fehr"', true), '"Jacqueline Fehr"', "bereits gequotet → unverändert");
	assert.equal(phraseWrap("", true), "", "leer → leer");
	assert.equal(phraseWrap("   ", true), "", "nur Leerzeichen → leer, kein Zitat um nichts");
});

test("exactWrap: jedes Wort einzeln zitiert, Phrasen und Ausschlüsse unangetastet", () => {
	assert.equal(exactWrap("Pause Schulhaus", true), '"Pause" "Schulhaus"');
	assert.equal(exactWrap("Pause", true), '"Pause"', "ein Wort");
	assert.equal(exactWrap("  Pause   Schulhaus  ", true), '"Pause" "Schulhaus"', "getrimmt, einfache Abstände");
	assert.equal(exactWrap("Pause Schulhaus", false), "Pause Schulhaus", "ohne exact unverändert");
	assert.equal(exactWrap("", true), "", "leer → leer");
	// Schon Zitiertes bleibt eine Wortfolge, Ausschlüsse bleiben Ausschlüsse
	// (ein zitiertes `-"wort"` würde sonst zum Pflicht-Term).
	assert.equal(exactWrap('"Pause Schulhaus" Turnhalle', true), '"Pause Schulhaus" "Turnhalle"');
	assert.equal(exactWrap("Pause -Mittagspause", true), '"Pause" -Mittagspause');
	assert.equal(exactWrap('Pause -"lange Pause"', true), '"Pause" -"lange Pause"');
	// Quote-Parity-Guard wie exclusionsFirst: unbalanciert = Tippfehler, nichts umstellen.
	assert.equal(exactWrap('Pause "schul', true), 'Pause "schul', "unbalancierte Anführungszeichen → unverändert");
	assert.equal(exactWrap("Pause -", true), '"Pause" -', "Token ohne Buchstabe/Zahl bleibt roh");
});

test("lexicalQuery: phrase gewinnt, sonst zitiert exact jedes Wort", () => {
	assert.equal(lexicalQuery("Pause Schulhaus", true, false), '"Pause Schulhaus"', "phrase = eine Wortfolge");
	assert.equal(lexicalQuery("Pause Schulhaus", false, true), '"Pause" "Schulhaus"', "exact = Wort für Wort");
	assert.equal(lexicalQuery("Pause Schulhaus", true, true), '"Pause Schulhaus"', "beide → phrase, exact ignoriert");
	assert.equal(lexicalQuery("Pause Schulhaus", false, false), "Pause Schulhaus", "keines → roh");
	assert.equal(lexicalQuery("", true, true), "", "leer → leer");
});

test("exactProbeQuery: Gegenprobe nur, wenn die Suche selbst nicht exakt zählt", () => {
	assert.equal(exactProbeQuery("Pause"), '"Pause"');
	assert.equal(exactProbeQuery("Pause Schulhaus"), '"Pause" "Schulhaus"');
	assert.equal(exactProbeQuery('"Pause" Schulhaus'), '"Pause" "Schulhaus"', "teils zitiert ⇒ Gegenprobe");
	assert.equal(exactProbeQuery(""), "", "leere Anfrage");
	assert.equal(exactProbeQuery("   "), "", "nur Leerzeichen");
	// Hauptsuche zählt schon exakt (phrase bzw. exact=true) ⇒ keine zweite Abfrage.
	assert.equal(exactProbeQuery('"Pause Schulhaus"'), "", "Phrase");
	assert.equal(exactProbeQuery('"Pause" "Schulhaus"'), "", "schon Wort für Wort zitiert");
	assert.equal(exactProbeQuery('  "Pause"  '), "", "nur getrimmt ⇒ kein Unterschied");
	assert.equal(exactProbeQuery("-Mittagspause"), "", "nur ein Ausschluss");
	assert.equal(exactProbeQuery('Pause "schul'), "", "unbalanciert ⇒ keine Gegenprobe");
});

test("inflationHint: Hinweis nur bei wesentlichem Unterschied, mit beiden Richtungen", () => {
	// Prod 2026-11-17 vor #259: «Pause» 8'066 Treffer, davon 841 genau so geschrieben.
	const hint = inflationHint(8066, 841);
	assert.match(hint, /8066/);
	assert.match(hint, /841/);
	assert.match(hint, /exactTotal/);
	assert.match(hint, /exact=true/);
	// Zwei Ursachen getrennt: die Wortanfang-Erweiterung gilt immer, die
	// Tippfehler-Toleranz erst ab einer Mindestlänge – nur `exact` hilft gegen beide.
	assert.match(hint, /Wortanfang-Erweiterung des LETZTEN Suchworts/);
	assert.match(hint, /Tippfehler-Toleranz/);
	assert.match(hint, /Mindestlänge/);
	// Die Schwelle ist eine Index-Einstellung und je Index verschieden (seit 2026-11-17
	// documents 7, PR #259; Katalog 5): eine Zahl im Hinweis wäre irgendwo falsch.
	assert.doesNotMatch(hint, /\b(5|7|fünf|sieben) Zeichen/, "keine Schwellenzahl im Hinweis");
	assert.match(hint, /gestemmt/, "nennt auch die Gegenrichtung (exact verliert Plurale)");
	// Verhältnis-Schwelle: knapp darunter meldet, knapp darüber schweigt.
	assert.ok(inflationHint(1000, Math.floor(1000 * EXACT_HINT_MAX_RATIO) - 1) !== "", "unter 60 % ⇒ Hinweis");
	assert.equal(inflationHint(1000, Math.ceil(1000 * EXACT_HINT_MAX_RATIO) + 1), "", "über 60 % ⇒ kein Hinweis");
	// Grosse Differenz bei hohem Verhältnis ist Rundungsrauschen.
	assert.equal(inflationHint(10000, 9000), "", "90 % exakt ⇒ kein Hinweis");
	// Absolute Untergrenze hält kleine Suchen still.
	assert.equal(inflationHint(12, 4), "", `Differenz unter ${EXACT_HINT_MIN_DIFF} ⇒ kein Hinweis`);
	assert.ok(inflationHint(20, 2) !== "", "Differenz über der Untergrenze und 10 % ⇒ Hinweis");
	// Unplausible Zahlen (Meilis estimatedTotalHits) stumm statt irreführend.
	assert.equal(inflationHint(0, 0), "", "keine Treffer ⇒ Sache des Null-Treffer-Hinweises");
	assert.equal(inflationHint(100, 100), "", "gleich ⇒ nichts zu melden");
	assert.equal(inflationHint(100, 120), "", "Gegenprobe grösser als die Suche ⇒ stumm");
	assert.equal(inflationHint(Number.NaN, 5), "", "NaN ⇒ stumm");
});

// --- Aggregat-Abfragen: alle Wörter (count_documents, timeline, list_documents, overview) --

// Attrappe für Meilis Wortabgleich: strict ⇒ matchingStrategy "all" (jedes Wort
// bzw. jede "Phrase" muss vorkommen), sonst Meilis Default "last" – die Wörter
// fallen von hinten weg, es zählt jedes Dokument mit dem ersten Wort. Nimmt die
// Optionen der Aggregat- wie der Ranking-Suche (aggregateSearch, rankingSearch).
interface FakeDoc {
	series: SearchHit["series"];
	year: number;
	text: string;
}

type FakeOpts = { strict?: boolean; attributesToRetrieve?: string[] };

function fakeMeili(docs: FakeDoc[]) {
	const calls: Array<{ params: SearchParams; opts: FakeOpts }> = [];
	const has = (d: FakeDoc, term: string) => {
		const words = d.text.toLowerCase().split(/\s+/);
		const seq = term.replace(/"/g, "").toLowerCase().split(/\s+/);
		return words.some((_, i) => seq.every((w, j) => words[i + j] === w));
	};
	const search = async (p: SearchParams, opts: FakeOpts) => {
		calls.push({ params: p, opts });
		const terms = p.q.match(/"[^"]*"|\S+/g) ?? [];
		const hits = docs.filter(
			(d) =>
				(p.series.length === 0 || p.series.includes(d.series)) &&
				(p.dateFrom == null || d.year >= p.dateFrom) &&
				(p.dateTo == null || d.year <= p.dateTo) &&
				(opts.strict ? terms : terms.slice(0, 1)).every((t) => has(d, t)),
		);
		const facet = (key: (d: FakeDoc) => string) => {
			const out: Record<string, number> = {};
			for (const d of hits) out[key(d)] = (out[key(d)] ?? 0) + 1;
			return out;
		};
		return {
			estimatedTotalHits: hits.length,
			facetDistribution: { series: facet((d) => d.series), dateYear: facet((d) => String(d.year)) },
			hits: hits.slice(0, p.pageSize),
		};
	};
	return { search: search satisfies AggregateSearchFn, calls };
}

// Nach Prod 2026-10-30: «Zivilschutzanlagen» und «Bunker» stehen weit öfter
// ohne «Rämibühl» als mit.
const RAEMIBUEHL: FakeDoc[] = [
	{ series: "RRB", year: 1968, text: "Neubau Kantonsschule Rämibühl Zivilschutzanlagen" },
	{ series: "ABl", year: 1974, text: "Vertrag mit der Stadt Zürich Zivilschutzanlagen Rämibühl" },
	{ series: "RRB", year: 1963, text: "Zweites Bezirksgebäude Winterthur Zivilschutzanlagen" },
	{ series: "KRP", year: 1983, text: "Kredit für Zivilschutzanlagen im Spital" },
	{ series: "RRB", year: 1965, text: "Kantonsschule Rämibühl Turnhalle" },
	{ series: "RRB", year: 1968, text: "Luftschutz Bunker Rämibühl" },
	{ series: "RM", year: 1484, text: "bunker am Rennweg" },
];

test("aggregateSearch: alle Wörter (strict), rein lexikalisch; Defaults für Zählung und Zeitleiste", () => {
	const [p, opts] = aggregateSearch({ q: "Zivilschutzanlagen Rämibühl", series: ["RRB"], dateFrom: 1960, dateTo: null });
	assert.equal(opts.strict, true, "matchingStrategy all");
	assert.equal(opts.vector, null, "kein Vektor-Arm");
	assert.equal(p.semanticRatio, 0);
	assert.equal(p.q, "Zivilschutzanlagen Rämibühl", "Begriff unverändert (phrase setzt der Aufrufer)");
	assert.deepEqual([p.page, p.pageSize, p.sort], [1, 1, "relevance"], "nur Trefferzahl und Facetten");
	assert.deepEqual([p.series, p.dateFrom, p.dateTo], [["RRB"], 1960, null]);
	assert.deepEqual([p.theme, p.anyTerms, p.titleOnly], ["", [], false], "sonst DEFAULT_SEARCH");
});

test("aggregateSearch: Titel-Überblick und overview mit Sortierung, Fenster und Projektion", () => {
	const [p, opts] = aggregateSearch({
		q: '"Jacqueline Fehr"',
		series: [],
		dateFrom: null,
		dateTo: null,
		sort: "date_asc",
		pageSize: 40,
		attributesToRetrieve: ["id", "title"],
		attributesToSearchOn: ["title"],
	});
	assert.deepEqual([p.sort, p.pageSize], ["date_asc", 40]);
	assert.deepEqual(opts, {
		vector: null,
		strict: true,
		attributesToRetrieve: ["id", "title"],
		attributesToSearchOn: ["title"],
	});
});

test("countAggregate: «Zivilschutzanlagen Rämibühl» zählt nur Dokumente mit beiden Wörtern", async () => {
	const { search, calls } = fakeMeili(RAEMIBUEHL);
	const r = await countAggregate(search, { q: "Zivilschutzanlagen Rämibühl", series: [], dateFrom: null, dateTo: null });
	assert.equal(r.total, 2);
	assert.deepEqual(r.bySeries, { RRB: 1, ABl: 1 });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].opts.strict, true);
	assert.deepEqual(calls[0].opts.attributesToRetrieve, ["id"], "ohne Bodies");
	// Gegenprobe: Meilis Default «last» zählte auch die Dokumente mit nur
	// «Zivilschutzanlagen» (Prod: 335 statt 6).
	const [p] = aggregateSearch({ q: "Zivilschutzanlagen Rämibühl", series: [], dateFrom: null, dateTo: null });
	const last = await search(p, { vector: null } as unknown as AggregateSearchOpts);
	assert.equal(last.estimatedTotalHits, 4);
});

test("aggregateYearDist: jede Alternative eine eigene Suche mit allen ihren Wörtern, Verteilungen summiert", async () => {
	const { search, calls } = fakeMeili(RAEMIBUEHL);
	const dist = await aggregateYearDist(search, ["Zivilschutzanlagen Rämibühl", "Bunker Rämibühl"], { series: [], dateFrom: null, dateTo: null });
	assert.deepEqual(dist, { "1968": 2, "1974": 1 }, "ohne 1963/1983 (nur Zivilschutzanlagen) und 1484 (nur Bunker)");
	assert.deepEqual(
		calls.map((c) => [c.params.q, c.opts.strict]),
		[
			["Zivilschutzanlagen Rämibühl", true],
			["Bunker Rämibühl", true],
		],
	);
	// Phrase: nur die Wortfolge «Kantonsschule Rämibühl».
	assert.deepEqual(await aggregateYearDist(search, [phraseWrap("Kantonsschule Rämibühl", true)], { series: [], dateFrom: null, dateTo: null }), {
		"1965": 1,
		"1968": 1,
	});
});

test("aggregateYearDist: ohne Begriff die Verteilung der Filter-Menge", async () => {
	const { search, calls } = fakeMeili(RAEMIBUEHL);
	const dist = await aggregateYearDist(search, [], { series: ["RRB"], dateFrom: 1964, dateTo: null });
	assert.deepEqual(dist, { "1965": 1, "1968": 2 });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].params.q, "");
});

test("queryWords: positive Wörter, Phrasen als Ganzes, ohne Ausschlüsse, dedupliziert und gekappt", () => {
	assert.deepEqual(queryWords("Zivilschutzanlagen Rämibühl"), ["Zivilschutzanlagen", "Rämibühl"]);
	assert.deepEqual(queryWords('"Jacqueline Fehr" Motion -Postulat'), ['"Jacqueline Fehr"', "Motion"]);
	assert.deepEqual(queryWords("Rämibühl rämibühl"), ["Rämibühl"]);
	assert.deepEqual(queryWords("a b c d e f g"), ["a", "b", "c", "d", "e"]);
	assert.deepEqual(queryWords(phraseWrap("Mario Fehr", true)), ['"Mario Fehr"'], "phrase=true ⇒ ein Wort");
	assert.deepEqual(queryWords(""), []);
});

// --- Ranking-Suchen: keyword_search verlangt alle Wörter, semantic_search nicht --

// Nach Prod 2026-10-30: kein Dokument enthält «Velowege» und «Rämibühl», 347
// eines davon; Meilis «last» lieferte die Velowege-Dokumente als Treffer.
const VELOWEGE: FakeDoc[] = [
	{ series: "KRP", year: 2009, text: "Abklassierung der Schaffhauserstrasse Velowege" },
	{ series: "RRB", year: 2016, text: "Bundesbeschluss über die Velowege" },
	{ series: "RRB", year: 1968, text: "Neubau Kantonsschule Rämibühl" },
];

const ranking = (over: Partial<Parameters<typeof rankingSearch>[0]> = {}) =>
	rankingSearch({ kind: "keyword", q: "Velowege Rämibühl", vector: null, series: [], dateFrom: null, dateTo: null, sort: "relevance", pageSize: 6, ...over });

test("rankingSearch: keyword_search liefert für «Velowege Rämibühl» keinen Teiltreffer (auch das MCP-total)", async () => {
	const { search, calls } = fakeMeili(VELOWEGE);
	const res = await search(...ranking());
	assert.deepEqual(res.hits, [], "kein Dokument mit nur einem der Wörter");
	assert.equal(res.estimatedTotalHits, 0, "das MCP-total zählt nur Dokumente mit allen Wörtern");
	assert.equal(calls[0].opts.strict, true);
	// Gegenprobe: mit Meilis Default «last» kamen beide Velowege-Dokumente (E2E: «Es gibt ein Dokument, das Velowege Rämibühl erwähnt»).
	const [p] = ranking();
	const last = await search(p, {});
	assert.deepEqual(
		last.hits.map((d) => d.year),
		[2009, 2016],
	);
	// Ein Wort allein bleibt eine gewöhnliche Suche; die Phrase verlangt die Wortfolge.
	assert.equal((await search(...ranking({ q: "Velowege" }))).estimatedTotalHits, 2);
	assert.equal((await search(...ranking({ q: phraseWrap("Kantonsschule Rämibühl", true) }))).estimatedTotalHits, 1);
});

test("rankingSearch: keyword_search strikt auch nach Datum sortiert, mit Titelfeld", () => {
	const [p, opts] = ranking({ sort: "date_asc", pageSize: 20, series: ["KRP"], dateFrom: 1995, attributesToSearchOn: ["title"] });
	assert.deepEqual([p.q, p.sort, p.page, p.pageSize, p.semanticRatio], ["Velowege Rämibühl", "date_asc", 1, 20, 0]);
	assert.deepEqual([p.series, p.dateFrom, p.dateTo], [["KRP"], 1995, null]);
	assert.deepEqual([p.theme, p.anyTerms, p.titleOnly], ["", [], false], "sonst DEFAULT_SEARCH");
	assert.deepEqual(opts, { vector: null, strict: true, attributesToSearchOn: ["title"] });
});

test("rankingSearch: semantic_search bleibt weich – hybrid mit Vektor, ohne Vektor eine weiche Stichwortsuche", () => {
	const [p, opts] = ranking({ kind: "semantic", q: "Massnahmen gegen die Tollwut", vector: [0.1, 0.2] });
	assert.equal(p.semanticRatio, 0.7);
	assert.deepEqual([opts.vector, opts.strict], [[0.1, 0.2], false]);
	// Ratsmanuale/embed nicht erreichbar: kein Vektor ⇒ BM25 über die Frage, Wörter fallen weg.
	const [pRm, optsRm] = ranking({ kind: "semantic", q: "Pest in der Stadt", series: ["RM"] });
	assert.equal(pRm.semanticRatio, 0);
	assert.deepEqual([optsRm.vector, optsRm.strict], [null, false]);
});

test("clampListLimit: [1,60], Default 40", () => {
	assert.equal(clampListLimit(undefined), 40);
	assert.equal(clampListLimit(0), 1);
	assert.equal(clampListLimit(999), 60, "Cap = LIST_MAX");
	assert.equal(clampListLimit(25), 25);
	assert.equal(clampListLimit(40.9), 40);
	assert.equal(clampListLimit("30"), 30, "Ziffern-String zählt");
	assert.equal(clampListLimit("viele"), 40, "ungültig → Default");
});

test("clampOffset: [0, PAGE_WINDOW_MAX-1], Default 0", () => {
	assert.equal(clampOffset(undefined), 0);
	assert.equal(clampOffset(-5), 0);
	assert.equal(clampOffset(10), 10);
	assert.equal(clampOffset(10.9), 10);
	assert.equal(clampOffset(99999), PAGE_WINDOW_MAX - 1, "Cap = PAGE_WINDOW_MAX-1");
	assert.equal(clampOffset("3"), 3, "Ziffern-String zählt");
	assert.equal(clampOffset("x"), 0, "ungültig → 0");
});

test("fieldAttrs: 'title' → ['title']; sonst undefined", () => {
	assert.deepEqual(fieldAttrs("title"), ["title"]);
	assert.equal(fieldAttrs("fulltext"), undefined);
	assert.equal(fieldAttrs(undefined), undefined);
	assert.equal(fieldAttrs("body"), undefined, "unbekannter Wert → Default");
});

test("timelineCoverageCaveat: ABl in Scope → Lücken-Vorbehalt", () => {
	const c = timelineCoverageCaveat(["ABl"]);
	assert.ok(c, "Caveat vorhanden");
	assert.match(c!, /unvollständig digitalisiert/);
	assert.match(c!, /KEIN inhaltlicher Rückgang/);
});

test("timelineCoverageCaveat: leerer Scope (Gesamtkorpus) → Vorbehalt für ABl+RRB", () => {
	const c = timelineCoverageCaveat([]);
	assert.ok(c);
	assert.match(c!, /Amtsblatt/);
	assert.match(c!, /Regierungsrat/);
});

test("timelineCoverageCaveat: nur durchgehende Serien → kein Vorbehalt", () => {
	assert.equal(timelineCoverageCaveat(["KRP"]), null);
	assert.equal(timelineCoverageCaveat(["KRP", "OS"]), null);
});

test("timelineCoverageCaveat: gemischt KRP+RRB → nur RRB nennen", () => {
	const c = timelineCoverageCaveat(["KRP", "RRB"]);
	assert.ok(c);
	assert.match(c!, /Regierungsrat/);
	assert.doesNotMatch(c!, /Amtsblatt/);
});

test("INCOMPLETE_SERIES: genau ABl und RRB (keine Jahres-Hardcodes)", () => {
	assert.deepEqual([...INCOMPLETE_SERIES].sort(), ["ABl", "RRB"]);
});

test("topYearsByCount: absteigend nach Anzahl, Gleichstand → früheres Jahr, gekappt", () => {
	const years: [number, number][] = [
		[1994, 228],
		[1995, 131],
		[2008, 309],
		[2009, 309],
		[2010, 298],
	];
	assert.deepEqual(topYearsByCount(years, 3), [
		[2008, 309],
		[2009, 309],
		[2010, 298],
	]);
	// 1994 (228) liegt vor 1995 (131) – die im Issue #75 verwechselten Jahre.
	assert.deepEqual(topYearsByCount(years, 10).slice(3), [
		[1994, 228],
		[1995, 131],
	]);
	assert.deepEqual(topYearsByCount(years, 0), []);
});


test("zeroHitHint: nennt die Einschränkung, die Treffer verhindert", () => {
	assert.equal(zeroHitHint([]), "");
	const series = zeroHitHint([{ kind: "series", total: 3, bySeries: { OS: 2, ABl: 1, KRP: 0 } }]);
	assert.match(series, /Ohne Serien-Einschränkung gäbe es 3 Treffer \(Gesetzessammlung: 2, Amtsblatt: 1\)/);
	assert.doesNotMatch(series, /Kantonsrat/);
	assert.match(zeroHitHint([{ kind: "phrase", total: 12 }]), /Ohne die exakte Form \(phrase\/exact weglassen: .*\) gäbe es 12 Treffer/);
	assert.match(zeroHitHint([{ kind: "filters", total: 0 }]), /überhaupt keine Dokumente/);
	assert.match(zeroHitHint([{ kind: "filters", total: 500 }]), /umfassen 500 Dokumente/);
	// Alle Gegenproben leer → Rat zu Schreibweisen statt Schweigen.
	assert.match(zeroHitHint([{ kind: "series", total: 0 }, { kind: "dates", total: 0 }]), /Auch ohne die gesetzten Einschränkungen keine Treffer/);
});

test("zeroHitHint: Aggregat-Tools verlangen alle Wörter – die Probe nennt jedes Wort einzeln", () => {
	const words = (w: Array<[string, number]>) => ({ kind: "words" as const, total: 0, words: w.map(([word, total]) => ({ word, total })) });
	assert.match(
		zeroHitHint([words([["Velowege", 0], ["Rämibühl", 1092]])]),
		/^Hinweis: Alle Wörter der Suche müssen im selben Dokument vorkommen; einzeln \(gleiche Filter\) stehen »Velowege« in 0, »Rämibühl« in 1092 Dokumenten – lass Wörter weg/,
	);
	// Neben einer gelockerten Einschränkung, in der Reihenfolge der Proben.
	assert.match(zeroHitHint([{ kind: "series", total: 6 }, words([["Zivilschutzanlagen", 2], ["Rämibühl", 50]])]), /Ohne Serien-Einschränkung gäbe es 6 Treffer.* Alle Wörter der Suche/);
	// phrase=true: findet die Suche ohne Phrase etwas, ist das der Rat (keine Wörter weglassen) …
	const phraseOk = zeroHitHint([{ kind: "phrase", total: 4 }, words([["Fehr", 900], ["Jacqueline", 1200]])]);
	assert.match(phraseOk, /Ohne die exakte Form/);
	assert.doesNotMatch(phraseOk, /Alle Wörter/);
	// … bleibt sie auch ohne Phrase leer, zählen die Wörter einzeln (E2E 2026-10-30: «Velowege Rämibühl» mit phrase=true).
	assert.match(zeroHitHint([{ kind: "phrase", total: 0 }, words([["Velowege", 9], ["Rämibühl", 1092]])]), /^Hinweis: Alle Wörter der Suche .*»Velowege« in 9, »Rämibühl« in 1092 Dokumenten/);
	// Kommt keines der Wörter vor, bleibt der Rat zur Schreibweise – ohne zu
	// behaupten, die Filter seien gelockert worden (Zählung/Zeitleiste prüfen nur die Wörter).
	assert.equal(
		zeroHitHint([words([["Velowege", 0], ["Rämibühel", 0]])]),
		"Hinweis: Mit diesen Filtern kommt keines der Wörter vor – prüfe Schreibweise, Synonyme und ältere Formen (alternatives).",
	);
});

test("isLexicalOnlyScope: nur Ratsmanuale bzw. Zeitraum vor 1803", () => {
	assert.equal(isLexicalOnlyScope(["RM"], null), true);
	assert.equal(isLexicalOnlyScope(["RM", "KRP"], null), false);
	assert.equal(isLexicalOnlyScope(["KRP"], 1790), false, "ausdrückliche Serie geht vor");
	assert.equal(isLexicalOnlyScope([], 1798), true);
	assert.equal(isLexicalOnlyScope([], 1803), false);
	assert.equal(isLexicalOnlyScope([], null), false);
});

test("preModernTimelineNote: nur mit Jahren vor 1803", () => {
	assert.equal(preModernTimelineNote(1803, 2020), null);
	assert.match(preModernTimelineNote(1600, 1700) ?? "", /Ratsmanualen/);
	assert.doesNotMatch(preModernTimelineNote(1600, 1700) ?? "", /nicht vergleichbar/);
	assert.match(preModernTimelineNote(1600, 1900) ?? "", /nicht vergleichbar/);
});

test("clampCatalogYear: Bereich 700–2100 (vor 1483), sonst null", () => {
	assert.equal(clampCatalogYear(853), 853);
	assert.equal(clampCatalogYear(1200.7), 1200);
	assert.equal(clampCatalogYear(12), 700);
	assert.equal(clampCatalogYear(3000), 2100);
	assert.equal(clampCatalogYear("1850"), 1850, "Ziffern-String zählt");
	assert.equal(clampCatalogYear("um 1850"), null);
	assert.equal(clampCatalogYear(Number.NaN), null);
});

test("normalizeCatalogLevel: bekannte Stufen (case-insensitiv), sonst kein Filter", () => {
	assert.equal(normalizeCatalogLevel("dossier"), "Dossier");
	assert.equal(normalizeCatalogLevel(" Dokument "), "Dokument");
	assert.equal(normalizeCatalogLevel("Plan"), null);
	assert.equal(normalizeCatalogLevel(undefined), null);
});

const catalogHit = (over: Partial<CatalogHitInput> = {}): CatalogHitInput => ({
	id: 3244110,
	signature: "U 105.9.6.1",
	title: "Brief von Alfred Escher an den Erziehungsrat, Ausstellungsort Enge",
	level: "Dokument",
	dateText: "31.01.1844",
	bestand: "U 1 - U 128 Pertinenzablage, 1554 (ca.)-1987 (Bestand)",
	path: [
		{ id: 724853, label: "U 1 - U 128 Pertinenzablage, 1554 (ca.)-1987 (Bestand)" },
		{ id: 636449, label: "U 105.9.6 Escher, Alfred (1819-1882), von Zürich, 1844 (Dossier)" },
	],
	hasDigitization: true,
	files: [
		{ name: "U_105_9_6_1_p.pdf", url: "https://suche.staatsarchiv.djiktzh.ch/Dateien/81/D408899.pdf", kind: "file" },
		{ name: "U_105_9_6_1_t.pdf", url: "https://suche.staatsarchiv.djiktzh.ch/Dateien/100/D502273.pdf", kind: "file" },
	],
	...over,
});

test("catalogExactLast: Signatur-Kürzel und Zahlen am Ende ganz suchen, nicht als Wortanfang", () => {
	for (const q of ["C", "C II", "C II 12", "Rüti C", "PLAN", "Enge PLAN", "Kappel 1340", "W I 1", "Rüti C -Pläne"]) assert.equal(catalogExactLast(q), true, q);
	for (const q of ["C Rüti", "PLAN Enge", "Escher Alfred", "Rüti", "", "c rüti", '"C II"', "Urkunden -C"]) assert.equal(catalogExactLast(q), false, q);
});

test("catalogPrefixNote: kurzes letztes Wort trifft die meisten Einheiten nur als Wortanfang («Pest» → Pestalozzi, E2E 2026-10-30)", () => {
	const unit = (title: string, text = "") => ({ signature: "Z 1", title, text });
	const pestalozzi = [
		unit("PESTALOZZIGESELLSCHAFT IN ZÜRICH, Zürich Verein zur Hebung der Volkswohlfahrt"),
		unit("Pestalozzianum Zürich betreffend Unterschrift"),
		unit("Pestalozzi, H.-Th., Zürich: Vorrichtung zur Blattbewegung"),
		unit("Mandat betreffend Massnahmen wegen der Pest in der Walachei"),
	];
	assert.equal(
		catalogPrefixNote("Pest", pestalozzi),
		"Hinweis: 3 der 4 gezeigten Einheiten enthalten «Pest» nur als Wortanfang (etwa «PESTALOZZIGESELLSCHAFT», «Pestalozzianum») – das letzte Suchwort trifft auch längere Wörter. Gehören sie nicht zur Frage, suche «\"Pest\"»: In Anführungszeichen zählt nur das ganze Wort.",
	);
	assert.match(catalogPrefixNote("Pest -Pestalozzi", pestalozzi), /^Hinweis: 3 der 4/, "Ausschlüsse sind nicht das letzte Wort");
	// Kein Hinweis: ganzes Wort in Anführungszeichen, Signatur-Kürzel, langes Wort, Mehrheit trifft das Wort.
	assert.equal(catalogPrefixNote('"Pest"', pestalozzi), "");
	assert.equal(catalogPrefixNote("Rüti C", pestalozzi), "");
	assert.equal(catalogPrefixNote("Eisenbahn", [unit("Eisenbahnbau"), unit("Eisenbahnlinie"), unit("Eisenbahnbrücke")]), "", "Zusammensetzungen längerer Wörter");
	assert.equal(catalogPrefixNote("Pest", [...pestalozzi.slice(0, 2), unit("Pest in Zürich"), unit("Pestordnung", "wegen der Pest"), unit("Pesten")]), "", "nur 2 von 5");
	// Gebeugte Formen und Wörter im Text zählen als ganzes Wort.
	assert.equal(catalogPrefixNote("Enge", [unit("Engelberg"), unit("Engelhardt"), unit("Plan", "Bahnhof Enge"), unit("Engen")]), "");
	assert.equal(catalogPrefixNote("Enge", [unit("Engelberg"), unit("Engelhardt"), unit("Engel")]), "Hinweis: 3 der 3 gezeigten Einheiten enthalten «Enge» nur als Wortanfang (etwa «Engelberg», «Engelhardt») – das letzte Suchwort trifft auch längere Wörter. Gehören sie nicht zur Frage, suche «\"Enge\"»: In Anführungszeichen zählt nur das ganze Wort.");
	// ß und ss gelten als gleich: «Floß» steht als ganzes Wort da.
	assert.equal(catalogPrefixNote("Floss", [unit("Floß"), unit("Bau eines Floßes"), unit("Flossholz")]), "");
	assert.match(catalogPrefixNote("Floß", [unit("Flossholz"), unit("Floßholz"), unit("Flossgasse")]), /^Hinweis: 3 der 3 .*«Flossholz», «Floßholz»/);
	assert.equal(catalogPrefixNote("Floße", [unit("Floßes"), unit("Flossers"), unit("Flosserei")]), "", "gefaltet sechs Buchstaben");
	assert.equal(catalogPrefixNote("Flosse", [unit("Floßes"), unit("Flossers"), unit("Flosserei")]), "");
});

test("semanticCatalogText: Suchwörter ohne Meili-Operatoren", () => {
	assert.equal(semanticCatalogText("Grippe Epidemie"), "Grippe Epidemie");
	assert.equal(semanticCatalogText('"Pest" Zürich'), "Pest Zürich", "Anführungszeichen tragen keine Bedeutung");
	assert.equal(semanticCatalogText("Pest -Pestalozzi"), "Pest", "ein Ausschluss zöge die Suche zum ausgeschlossenen Wort");
	assert.equal(semanticCatalogText("  „Bau“  von   Eisenbahnen "), "Bau von Eisenbahnen");
	assert.equal(semanticCatalogText("-Pestalozzi"), "");
	assert.equal(semanticCatalogText(""), "");
});

test("mergeRoundRobinPage: Folgeseiten ohne Doppelte und ohne Lücke", () => {
	const r = (id: string) => ({ hit: { id } });
	const a = Array.from({ length: 12 }, (_, i) => r(`a${i + 1}`));
	// b teilt zwei Treffer mit a (Dedup-Runde) – genau dort entstünden Lücken,
	// wenn jede Liste einzeln um den Offset gekürzt würde.
	const b = Array.from({ length: 12 }, (_, i) => r(i % 5 === 0 ? `a${i + 1}` : `b${i + 1}`));
	const ids = (l: Array<{ hit: { id: string } }>) => l.map((x) => x.hit.id);
	const seite1 = ids(mergeRoundRobinPage([a, b], 0, 6));
	const seite2 = ids(mergeRoundRobinPage([a, b], 6, 6));
	assert.deepEqual(seite1, ids(mergeRoundRobin([a, b], 6)), "Seite 1 unverändert");
	assert.equal(new Set([...seite1, ...seite2]).size, 12, "keine Doppelten");
	assert.deepEqual([...seite1, ...seite2], ids(mergeRoundRobin([a, b], 12)), "lückenlos");
});

test("clampPassageOffset: offset + topK ≤ PASSAGE_WINDOW_MAX", () => {
	assert.equal(clampPassageOffset(undefined, 8), 0);
	assert.equal(clampPassageOffset(16, 8), 16);
	assert.equal(clampPassageOffset(999, 8), PASSAGE_WINDOW_MAX - 8, "gekappt auf die letzte Seite");
	assert.equal(clampPassageOffset(999, PASSAGE_WINDOW_MAX + 10), 0, "topK über dem Fenster ⇒ Seite 1");
	assert.ok(PASSAGE_WINDOW_MAX < PAGE_WINDOW_MAX, "engeres Fenster als bei den Dokument-Werkzeugen");
});

test("fieldAttrs: Titelfelder vom Aufrufer (ab dem Suchtext-Stand mit titleSearch)", () => {
	assert.deepEqual(fieldAttrs("title"), ["title"]);
	assert.deepEqual(fieldAttrs("title", ["title", "titleSearch"]), ["title", "titleSearch"]);
	assert.equal(fieldAttrs("fulltext", ["title", "titleSearch"]), undefined);
});

test("fetchText: kurzer Text unverändert, langer an einer Wortgrenze gekürzt", () => {
	assert.deepEqual(fetchText("Kurzer Text"), { text: "Kurzer Text", truncated: null });
	const long = "Wort ".repeat(30_000);
	const { text, truncated } = fetchText(long);
	assert.equal(truncated, long.length);
	assert.ok(text.length <= FETCH_TEXT_MAX + 2 && text.endsWith(" …"));
});
