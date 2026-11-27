// Lauf: npx tsx --test src/lib/server/catalogUnion.test.ts
// ODER im Reiter «Archivkatalog»: Zweige der Föderation, Sortierung, Nachmarkieren.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	catalogLexical,
	catalogSortRules,
	isCatalogUnion,
	lexicalSearchOn,
	markUnionTerms,
	unionFacets,
	unionSearchBody,
	type CatalogUnion,
} from "./catalogUnion";
import { sanitizeMarks } from "./krdbPeople";

test("catalogLexical: ODER ab zwei Begriffen, ein einzelner gilt als Suchbegriff", () => {
	const union = catalogLexical({ q: "Zürich -Spital", anyTerms: ["Cholera", "Typhus"], titleOnly: false });
	assert.deepEqual(union, {
		q: "-Spital Zürich",
		terms: ["Cholera", "Typhus"],
		searchOn: undefined,
		highlight: ["Cholera", "Typhus", "Zürich"],
	});
	assert.equal(isCatalogUnion(union), true);
	const single = catalogLexical({ q: "Zürich", anyTerms: ["Cholera"], titleOnly: false });
	assert.deepEqual(single, { q: "Zürich Cholera", terms: null, searchOn: undefined, highlight: [] });
	assert.equal(isCatalogUnion(single), false);
	// Ohne ODER-Feld (API-artige Aufrufer): nur der Suchbegriff.
	assert.equal(catalogLexical({ q: " Mühle ", titleOnly: false }).q, "Mühle");
});

test("catalogLexical: «nur im Titel» auch, wenn nur ODER-Begriffe die Suche bilden", () => {
	assert.deepEqual(catalogLexical({ q: "", anyTerms: ["Cholera", "Typhus"], titleOnly: true }).searchOn, ["title"]);
	assert.deepEqual(catalogLexical({ q: "Mühle", anyTerms: [], titleOnly: true }).searchOn, ["title"]);
	assert.equal(catalogLexical({ q: "", anyTerms: [], titleOnly: true }).searchOn, undefined);
	assert.equal(catalogLexical({ q: "Mühle", anyTerms: ["A", "B"], titleOnly: false }).searchOn, undefined);
});

test("catalogSortRules: Relevanz mit Suchbegriff oder ODER, sonst chronologisch", () => {
	const none = { q: "", terms: null };
	const union = { q: "", terms: ["Cholera", "Typhus"] };
	assert.equal(catalogSortRules("relevance", union), undefined);
	assert.equal(catalogSortRules("relevance", { q: "Mühle", terms: null }), undefined);
	assert.deepEqual(catalogSortRules("relevance", none), ["dateFrom:asc"]);
	assert.deepEqual(catalogSortRules("date_asc", union), ["dateFrom:asc"]);
	assert.deepEqual(catalogSortRules("date_desc", none), ["dateFrom:desc"]);
});

test("unionSearchBody: je Begriff ein strikter Zweig mit Suchbegriff, Filter und Titel-Feld", () => {
	const lex = catalogLexical({ q: "Zürich -Spital", anyTerms: ["Cholera", '"Typhus abdominalis"'], titleOnly: true }) as CatalogUnion;
	const body = unionSearchBody(lex, "catalog", "onPlatform = false", { offset: 20, limit: 20, ...unionFacets("catalog", ["level"], 2000) }, {
		sort: ["dateFrom:asc"],
	});
	assert.deepEqual(body.federation, {
		offset: 20,
		limit: 20,
		facetsByIndex: { catalog: ["level"] },
		mergeFacets: { maxValuesPerFacet: 2000 },
	});
	assert.deepEqual(body.queries, [
		{
			indexUid: "catalog",
			q: "-Spital Cholera Zürich",
			matchingStrategy: "all",
			filter: "onPlatform = false",
			attributesToSearchOn: ["title"],
			sort: ["dateFrom:asc"],
		},
		{
			indexUid: "catalog",
			q: '-Spital "Typhus abdominalis" Zürich',
			matchingStrategy: "all",
			filter: "onPlatform = false",
			attributesToSearchOn: ["title"],
			sort: ["dateFrom:asc"],
		},
	]);
	// Ohne Suchbegriff und ohne «nur im Titel»: der Begriff allein, kein Titel-Feld.
	const plain = unionSearchBody(catalogLexical({ q: "", anyTerms: ["Mühle", "Säge"], titleOnly: false }) as CatalogUnion, "catalog", "f", { limit: 0 });
	assert.deepEqual(
		plain.queries.map((q) => [q.q, "attributesToSearchOn" in q]),
		[
			["Mühle", false],
			["Säge", false],
		],
	);
});

test("markUnionTerms: Föderation markiert die Begriffe der anderen Zweige nach", () => {
	const hit = {
		title: "Typhus und Cholera in Zürich",
		text: "Massnahmen gegen Cholera",
		_formatted: { title: 'Typhus und <mark class="match">Cholera</mark> in Zürich', text: 'Massnahmen gegen <mark class="match">Cholera</mark>' },
	};
	const [out] = markUnionTerms([hit], ["Cholera", "Typhus"], { recrop: false, cropLength: 40 });
	assert.equal(out._formatted.title, '<mark class="match">Typhus</mark> und <mark class="match">Cholera</mark> in Zürich');
	assert.equal(out._formatted.text, 'Massnahmen gegen <mark class="match">Cholera</mark>');
	// Ohne Begriffe (kein ODER): dieselben Treffer.
	const hits = [hit];
	assert.equal(markUnionTerms(hits, [], { recrop: true, cropLength: 40 }), hits);
});

test("markUnionTerms: Thema-Pfade schneiden den Auszug um die erste Fundstelle neu", () => {
	const words = Array.from({ length: 80 }, (_, i) => `w${i}`);
	words[50] = "Typhus";
	const text = words.join(" ");
	// Meilis Auszug ohne Suchbegriff: der Anfang des Textes.
	const hit = { title: "Sanitätswesen <Akten> & Berichte", text, _formatted: { title: "Sanitätswesen <Akten> & Berichte", text: `${words.slice(0, 40).join(" ")}…` } };
	const [out] = markUnionTerms([hit], ["Cholera", "Typhus"], { recrop: true, cropLength: 10 });
	assert.match(out._formatted.text ?? "", /^…w4\d .*<mark class="match">Typhus<\/mark>.* w5\d…$/);
	assert.ok(!(out._formatted.text ?? "").includes("w10 "), "Anfang weg");
	// Maskierung danach (toHit): Marken bleiben, «<» und «&» des Titels werden Text.
	assert.equal(sanitizeMarks(out._formatted.title ?? ""), "Sanitätswesen &lt;Akten&gt; &amp; Berichte");
	// Begriff nur im Titel: Meilis Auszug bleibt.
	const titleOnly = { title: "Cholera 1832", text: "Bericht des Sanitätsrates", _formatted: { title: "Cholera 1832", text: "Bericht des Sanitätsrates" } };
	const [t] = markUnionTerms([titleOnly], ["Cholera", "Typhus"], { recrop: true, cropLength: 10 });
	assert.equal(t._formatted.text, "Bericht des Sanitätsrates");
	assert.equal(t._formatted.title, '<mark class="match">Cholera</mark> 1832');
});

test("catalogLexical mit Faltung: ß als ss in Suchbegriff und ODER-Begriffen", () => {
	assert.deepEqual(catalogLexical({ q: "Straße -Schloß", anyTerms: [], titleOnly: false }, true), {
		q: "-Schloss Strasse",
		terms: null,
		searchOn: undefined,
		highlight: [],
		fold: true,
	});
	assert.deepEqual(catalogLexical({ q: "daß", anyTerms: ["Straße", '"Große Halde"'], titleOnly: true }, true), {
		q: "dass",
		terms: ["Strasse", '"Grosse Halde"'],
		searchOn: ["title"],
		highlight: ["Strasse", "Grosse Halde", "dass"],
		fold: true,
	});
	// Ein einzelner ODER-Begriff gilt als Suchbegriff, auch gefaltet.
	assert.equal(catalogLexical({ q: "Zürich", anyTerms: ["Fluß"], titleOnly: false }, true).q, "Zürich Fluss");
	// Beide Schreibungen als ODER-Begriffe sind gefaltet einer, also ein Suchbegriff.
	assert.deepEqual(
		catalogLexical({ q: "Zürich", anyTerms: ["Straße", "Strasse"], titleOnly: false }, true),
		catalogLexical({ q: "Zürich", anyTerms: ["Strasse"], titleOnly: false }, true),
	);
	assert.deepEqual(catalogLexical({ q: "", anyTerms: ["Straße", "Strasse", "Weg"], titleOnly: false }, true).terms, ["Strasse", "Weg"]);
	assert.deepEqual(catalogLexical({ q: "", anyTerms: ["Straße", "Strasse"], titleOnly: false }).terms, ["Straße", "Strasse"]);
	// Ohne Faltung (Index ohne gefaltete Suchfelder) bleibt die Anfrage, wie sie ist.
	assert.equal(catalogLexical({ q: "Straße", titleOnly: false }).q, "Straße");
	assert.equal("fold" in catalogLexical({ q: "Straße", titleOnly: false }), false);
});

test("catalogLexical mit Faltung: beide Schreibungen ergeben dieselbe Abfrage", () => {
	for (const [a, b] of [["Straße", "Strasse"], ['"Schloß Kyburg"', '"Schloss Kyburg"'], ["-daß Fluß", "-dass Fluss"]]) {
		assert.deepEqual(catalogLexical({ q: a, titleOnly: true }, true), catalogLexical({ q: b, titleOnly: true }, true));
	}
	const union = (terms: string[]) => unionSearchBody(catalogLexical({ q: "", anyTerms: terms, titleOnly: true }, true) as CatalogUnion, "catalog", "f", { limit: 0 });
	assert.deepEqual(union(["Straße", "Fluß"]), union(["Strasse", "Fluss"]));
});

test("lexicalSearchOn: «nur im Titel» sucht mit Faltung auch im gefalteten Titel", () => {
	assert.deepEqual(lexicalSearchOn(catalogLexical({ q: "Straße", titleOnly: true }, true)), ["title", "titleSearch"]);
	assert.deepEqual(lexicalSearchOn(catalogLexical({ q: "Straße", titleOnly: true })), ["title"]);
	assert.equal(lexicalSearchOn(catalogLexical({ q: "Straße", titleOnly: false }, true)), undefined);
	const body = unionSearchBody(catalogLexical({ q: "", anyTerms: ["Straße", "Weg"], titleOnly: true }, true) as CatalogUnion, "catalog", "f", { limit: 0 });
	assert.deepEqual(
		body.queries.map((q) => [q.q, q.attributesToSearchOn]),
		[
			["Strasse", ["title", "titleSearch"]],
			["Weg", ["title", "titleSearch"]],
		],
	);
});
