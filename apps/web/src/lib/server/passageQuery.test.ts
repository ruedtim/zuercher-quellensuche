/**
 * Unit-Tests für die Frage-Analyse (node:test, Repo-Muster wie
 * chunkAlign.test.ts). Lauf:
 *   npx tsx --test src/lib/server/passageQuery.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildSemanticQuery,
	extractDateRange,
	extractKeywords,
	extractLexicalQuery,
	type ExtractedSpan,
} from "./passageQuery";

// Span-Inhalt auf der Original-Frage – so liest sich die Erwartung im Test
// als Phrase statt als Indexpaar.
function spanTexts(q: string, spans: ExtractedSpan[]): string[] {
	return spans.map((s) => q.toLowerCase().slice(s.start, s.end));
}

// Span eines Worts der Frage.
function wordSpan(q: string, word: string): ExtractedSpan[] {
	const start = q.indexOf(word);
	return start < 0 ? [] : [{ start, end: start + word.length }];
}

// --- extractDateRange: from/to wie vor der Verschiebung (Regression) --------

test("extractDateRange: expliziter Range", () => {
	const r = extractDateRange("Was geschah von 1920 bis 1950 in Uster?");
	assert.deepEqual([r?.from, r?.to], [1920, 1950]);
	assert.deepEqual(spanTexts("Was geschah von 1920 bis 1950 in Uster?", r!.spans), [
		"von 1920 bis 1950",
	]);
});

test("extractDateRange: Range mit Bindestrich, verdrehte Jahre", () => {
	const r = extractDateRange("Hungersnöte 1950–1920");
	assert.deepEqual([r?.from, r?.to], [1920, 1950]);
});

test("extractDateRange: Dekade inkl. Wort-Erweiterung", () => {
	const q = "Wirtschaftskrise in den 1920er Jahren";
	const r = extractDateRange(q);
	assert.deepEqual([r?.from, r?.to], [1920, 1929]);
	assert.deepEqual(spanTexts(q, r!.spans), ["1920er jahren"]);
});

test("extractDateRange: englische Dekade", () => {
	const r = extractDateRange("strikes in the 1830s");
	assert.deepEqual([r?.from, r?.to], [1830, 1839]);
});

test("extractDateRange: Jahrhundert", () => {
	const q = "Schulwesen im 19. Jahrhundert";
	const r = extractDateRange(q);
	assert.deepEqual([r?.from, r?.to], [1801, 1900]);
	assert.deepEqual(spanTexts(q, r!.spans), ["19. jahrhundert"]);
});

test("extractDateRange: um ±5", () => {
	const r = extractDateRange("Choleraepidemie um 1850");
	assert.deepEqual([r?.from, r?.to], [1845, 1855]);
});

test("extractDateRange: im Jahre X", () => {
	const r = extractDateRange("Was wurde im Jahre 1920 beschlossen?");
	assert.deepEqual([r?.from, r?.to], [1920, 1920]);
});

test("extractDateRange: einseitig ab", () => {
	const r = extractDateRange("Eisenbahnprojekte ab 1995");
	assert.deepEqual([r?.from, r?.to], [1995, null]);
});

test("extractDateRange: einseitig vor (exklusiv) mit Span", () => {
	const q = "wie funktionierte die einbürgerung in zürich vor 1880?";
	const r = extractDateRange(q);
	assert.deepEqual([r?.from, r?.to], [null, 1879]);
	assert.deepEqual(spanTexts(q, r!.spans), ["vor 1880"]);
});

test("extractDateRange: kombiniert ab+bis → zwei Spans", () => {
	const q = "Strassenbau ab 1920 und bis 1950";
	const r = extractDateRange(q);
	assert.deepEqual([r?.from, r?.to], [1920, 1950]);
	assert.deepEqual(spanTexts(q, r!.spans), ["ab 1920", "bis 1950"]);
});

test("extractDateRange: Ratsmanual-Zeit ab 1484", () => {
	assert.deepEqual(extractDateRange("Sitzungen von 1600 bis 1650")?.from, 1600);
	const c17 = extractDateRange("Pest im 17. Jahrhundert");
	assert.deepEqual([c17?.from, c17?.to], [1601, 1700]);
	const c16 = extractDateRange("Täufer im 16. Jahrhundert");
	assert.deepEqual([c16?.from, c16?.to], [1501, 1600]);
	// Das 15. Jahrhundert beginnt mit dem Korpus (1483), das 14. liegt davor.
	const c15 = extractDateRange("Burgen im 15. Jahrhundert");
	assert.deepEqual([c15?.from, c15?.to], [1483, 1500]);
	assert.equal(extractDateRange("Burgen im 14. Jahrhundert"), null);
});

test("extractDateRange: Jahr ausserhalb des Korpus-Fensters → null", () => {
	assert.equal(extractDateRange("Schlachten um 1315"), null);
});

test("extractDateRange: keine Angabe → null", () => {
	assert.equal(extractDateRange("Wie wurde die Hundesteuer erhoben?"), null);
});

// Dekaden-Schreibweisen (mit/ohne „Jahre", mit/ohne Bindestrich) – alle → {1990,1999}.
for (const q of ["1990er", "1990er-jahre", "1990er jahre", "die 1990er-Jahre", "in den 1990ern"]) {
	test(`extractDateRange: Dekade „${q}" → {1990,1999}`, () => {
		const r = extractDateRange(q);
		assert.deepEqual([r?.from, r?.to], [1990, 1999]);
	});
}

// Range-Schreibweisen (Bindestrich, verdreht, ausgeschrieben) – alle → {1990,2000}.
for (const q of ["1990-2000", "2000-1990", "von 1990 bis 2000", "1990 bis 2000", "Beschlüsse 1990–2000"]) {
	test(`extractDateRange: Range „${q}" → {1990,2000}`, () => {
		const r = extractDateRange(q);
		assert.deepEqual([r?.from, r?.to], [1990, 2000]);
	});
}

// --- buildSemanticQuery ------------------------------------------------------

test("buildSemanticQuery: Datums-Span raus, Satzzeichen aufgeräumt", () => {
	const q = "wie funktionierte die einbürgerung in zürich vor 1880?";
	const spans = extractDateRange(q)!.spans;
	assert.equal(buildSemanticQuery(q, spans), "wie funktionierte die einbürgerung in zürich?");
});

test("buildSemanticQuery: Datum und ein weiteres Filter-Wort kombiniert", () => {
	const q = "Was hat der Kantonsrat von 1920 bis 1950 zur Hundesteuer beschlossen?";
	const spans = [...extractDateRange(q)!.spans, ...wordSpan(q, "Kantonsrat")];
	assert.equal(buildSemanticQuery(q, spans), "Was hat der zur Hundesteuer beschlossen?");
});

test("buildSemanticQuery: Guard bei zu wenig Restinhalt → Original", () => {
	const q = "Was geschah vor 1880?";
	const spans = extractDateRange(q)!.spans;
	// Nach dem Strippen bleibt nur «Was geschah?» – ein Inhaltswort, also Original.
	assert.equal(buildSemanticQuery(q, spans), q);
});

test("buildSemanticQuery: überlappende Spans werden gemerged", () => {
	const q = "abcdefghij";
	const out = buildSemanticQuery(q, [
		{ start: 2, end: 6 },
		{ start: 4, end: 8 },
	]);
	// Rumpf «ab ij» hat keine 2 Inhaltswörter → Guard liefert Original.
	assert.equal(out, q);
});

test("buildSemanticQuery: ohne Spans unverändert", () => {
	assert.equal(buildSemanticQuery("Wie kam es zur Eingemeindung?", []), "Wie kam es zur Eingemeindung?");
});

// --- extractKeywords (Regression der Verschiebung) ---------------------------

test("extractKeywords: Stoppwörter weg, Namen und Jahre bleiben", () => {
	assert.equal(
		extractKeywords("Was forderte Franz Josef Sandmann im Jahr 1878?"),
		"forderte Franz Josef Sandmann 1878",
	);
});

test("extractKeywords: Rand-Bindestriche weg (kein Meili-Ausschluss «-Wort»)", () => {
	assert.equal(extractKeywords("Maul- und Klauenseuche"), "Maul Klauenseuche");
	assert.equal(extractKeywords("Ergebnisse -Archiv"), "Ergebnisse Archiv");
	assert.equal(extractKeywords("Covid-19 Massnahmen"), "Covid-19 Massnahmen");
});

// --- extractLexicalQuery (BM25-Query ohne Filter-Wörter) ---------------------

function filterSpans(q: string, word?: string): ExtractedSpan[] {
	return [...(extractDateRange(q)?.spans ?? []), ...(word ? wordSpan(q, word) : [])];
}

test("extractLexicalQuery: Prod-Befund – gelockerte Serie, Zeitraum und Frage-Rahmen fallen", () => {
	const q = "Was stand im Amtsblatt im 19. Jahrhundert über Eisenbahnen?";
	// Vorher (extractKeywords): «stand Amtsblatt 19 Eisenbahnen».
	assert.equal(extractLexicalQuery(q, filterSpans(q, "Amtsblatt")), "Eisenbahnen");
});

test("extractLexicalQuery: angewandte Filter fallen ebenfalls (seltenes «1930er» bliebe sonst Pflichtwort)", () => {
	const q = "Was sagte der Kantonsrat in den 1930er Jahren über Arbeitslosigkeit?";
	assert.equal(extractLexicalQuery(q, filterSpans(q, "Kantonsrat")), "Arbeitslosigkeit");
});

test("extractLexicalQuery: Frage-Rahmen fällt auch ohne Filter, Inhalt bleibt", () => {
	assert.equal(
		extractLexicalQuery("Welche Mitteilungen über Wölfe erschienen im Amtsblatt?", []),
		"Wölfe Amtsblatt",
	);
	assert.equal(
		extractLexicalQuery("Was forderte Franz Josef Sandmann im Jahr 1878?", []),
		"forderte Franz Josef Sandmann 1878",
	);
});

test("extractLexicalQuery: Schnitt vor Bindestrich erzeugt keinen Ausschluss", () => {
	const q = "Was steht im Amtsblatt-Archiv zu Brücken?";
	assert.equal(extractLexicalQuery(q, filterSpans(q, "Amtsblatt")), "Archiv Brücken");
});

test("extractLexicalQuery: nur Rahmen und Filter ⇒ leer", () => {
	const q = "Was gab es von 1920 bis 1930?";
	assert.equal(extractLexicalQuery(q, filterSpans(q)), "");
});

test("extractDateRange: Spanne über den Korpus-Beginn wird gekürzt, Beträge zählen nicht", () => {
	const r = extractDateRange("Urkunden von 1450 bis 1550");
	assert.deepEqual([r?.from, r?.to], [1483, 1550]);
	assert.equal(extractDateRange("Urkunden von 1200 bis 1300"), null, "ganz vor dem Korpus");
	const cat = extractDateRange("Urkunden von 1200 bis 1300", 700);
	assert.deepEqual([cat?.from, cat?.to], [1200, 1300], "Katalog: minYear 700");
	assert.equal(extractDateRange("Kosten von 1200–1600 Franken"), null);
	assert.equal(extractDateRange("ein Kredit von 1500 bis 1800 Fr. für die Schule"), null);
	const rest = extractDateRange("ein Kredit von 1500 bis 1800 Fr. im Jahr 1910");
	assert.deepEqual([rest?.from, rest?.to], [1910, 1910], "Betrag ausgeblendet, das Jahr danach zählt");
});
