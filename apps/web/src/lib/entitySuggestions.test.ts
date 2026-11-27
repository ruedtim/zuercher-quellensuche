// Lauf: npx tsx --test src/lib/entitySuggestions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyedSuggestions, pickKeyForm, suggestionQueryWords, type SuggestionLookups } from "./entitySuggestions";

/** Attrappe für die Abfragen: zeichnet die Aufrufe auf. */
function fakeLookups(counts: Record<string, number>, forms: Record<string, string | null> = {}) {
	const calls: { count: string[][]; form: string[][] } = { count: [], form: [] };
	const lookups: SuggestionLookups = {
		async count(keys) {
			calls.count.push(keys);
			return new Map(keys.flatMap((k) => (k in counts ? [[k, counts[k]] as const] : [])));
		},
		async form(keys) {
			calls.form.push(keys);
			return new Map(keys.flatMap((k) => (k in forms ? [[k, forms[k]] as const] : [])));
		},
	};
	return { calls, lookups };
}

const opts = { limit: 20, recountMax: 20 };

test("pickKeyForm: häufigste Form des Schlüssels, Gleichstand ohne Versalien und kürzer", () => {
	assert.equal(pickKeyForm("places", "fischental", [["Fischental", 69], ["Fischenthal", 3612], ["Fischenthal ZH", 6]]), "Fischenthal");
	assert.equal(pickKeyForm("places", "fischental", [["Fischenthals", 12_000], ["Fischental", 69]]), "Fischental", "anderer Schlüssel zählt nicht");
	assert.equal(pickKeyForm("places", "zurich", [["ZÜRICH", 5], ["Zürich", 5]]), "Zürich");
	assert.equal(pickKeyForm("places", "zurich", [["ZÜRICH", 6], ["Zürich", 5]]), "ZÜRICH", "Versalien nur bei Gleichstand zurück");
	assert.equal(pickKeyForm("places", "uster", [["Gemeinde Uster", 3], ["Uster", 3]]), "Uster");
	assert.equal(pickKeyForm("persons", "hans frei", [["Frey, Hans", 4], ["Hans Frei", 4]]), "Hans Frei");
	assert.equal(pickKeyForm("places", "uster", []), null);
});

test("suggestionQueryWords: Fassung 2, vollständige Form als Schlüssel, sonst je Wort", () => {
	assert.deepEqual(suggestionQueryWords("persons", "Escher"), [["escher"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Escher, Alfred"), [["alfred"], ["escher"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Herr Frei"), [["frei"]], "Anrede fällt weg");
	// Anreden, die auch Nachnamen sind, bleiben stehen (Review: «Ritter Hans» suchte nur «hans»).
	assert.deepEqual(suggestionQueryWords("persons", "Vogt"), [["vogt"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Vogt E"), [["vogt"], ["e"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Ritter Hans"), [["riter"], ["hans"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Alt Max"), [["alt"], ["max"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Vogt Hans Jakob"), [["vogt"], ["hans"], ["jakob"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Herr"), [["her"]], "allein bleibt auch eine Anrede");
	assert.deepEqual(suggestionQueryWords("persons", "Dr"), [["dr"]], "ein Wort allein ist ein Namensanfang (Dreher)");
	assert.deepEqual(suggestionQueryWords("persons", "Alfred E"), [["alfred"], ["e"]]);
	assert.deepEqual(suggestionQueryWords("persons", "Esc"), [["esk", "esch"]], "c am Ende auch als ch");
	assert.deepEqual(suggestionQueryWords("places", "Wädensweil"), [["wadenswil"]]);
	assert.deepEqual(suggestionQueryWords("places", "Stadt Zür"), [["zur"]]);
	assert.deepEqual(suggestionQueryWords("places", "12"), [["12"]]);
	assert.deepEqual(suggestionQueryWords("organizations", "Regierungsrath"), [["regierungsrat"]]);
	assert.deepEqual(suggestionQueryWords("organizations", "Re"), [["re"]]);
	assert.deepEqual(suggestionQueryWords("persons", "  "), []);
});

test("keyedSuggestions ohne Eingabe: je Schlüssel die Zahl der Auswahl, Formen ohne Schlüssel einzeln", async () => {
	const { calls, lookups } = fakeLookups({});
	const out = await keyedSuggestions(
		{
			dim: "places",
			keyDist: { zurich: 228_832, fischental: 3700, "kanton zurich": 900 },
			formDist: { Zürich: 228_727, Fischenthal: 3612, Fischental: 69, "Kanton Zürich": 850, "Stadt Zürich": 400, "12": 40 },
		},
		lookups,
		opts,
	);
	assert.deepEqual(out, [
		{ value: "Zürich", count: 228_832 },
		{ value: "Fischenthal", count: 3700 },
		{ value: "Kanton Zürich", count: 900 },
		{ value: "12", count: 40 },
	]);
	assert.deepEqual(calls, { count: [], form: [] }, "alle Anzeigeformen aus der Facette");
});

test("keyedSuggestions: Anzeigeform nachschlagen, wenn die Facette keine Form des Schlüssels hat", async () => {
	const { calls, lookups } = fakeLookups({}, { "st galen": "St. Gallen", kur: null });
	const out = await keyedSuggestions({ dim: "places", keyDist: { "st galen": 500, kur: 7, uster: 300 }, formDist: { Uster: 290 } }, lookups, opts);
	assert.deepEqual(out, [
		{ value: "St. Gallen", count: 500 },
		{ value: "Uster", count: 300 },
	], "ohne passende Form fällt der Schlüssel weg");
	assert.deepEqual(calls, { count: [], form: [["st galen", "kur"]] });
});

test("keyedSuggestions mit Eingabe: Formen der Facettensuche nach Schlüssel, Unbekannte nachgezählt", async () => {
	const { calls, lookups } = fakeLookups({ fischenzen: 30, fischetz: 0 });
	const out = await keyedSuggestions(
		{
			dim: "places",
			keyDist: { fischental: 3700, zurich: 228_832 },
			formDist: { Zürich: 228_727 },
			hits: [
				{ value: "Fischenthal", count: 3612 },
				{ value: "Fischental", count: 69 },
				{ value: "Fischenzen", count: 25 },
				{ value: "Fischetz", count: 2 },
			],
			words: suggestionQueryWords("places", "Fischent"),
		},
		lookups,
		opts,
	);
	assert.deepEqual(out, [
		{ value: "Fischenthal", count: 3700 },
		{ value: "Fischenzen", count: 30 },
	]);
	assert.deepEqual(calls, { count: [["fischenzen", "fischetz"]], form: [] }, "nur Schlüssel ausserhalb der Verteilung, Form aus der Facettensuche");
});

test("keyedSuggestions mit Eingabe: Wortanfänge treffen Schlüssel der Auswahl («Escher» → Alfred Escher)", async () => {
	const { calls, lookups } = fakeLookups({});
	const out = await keyedSuggestions(
		{
			dim: "persons",
			keyDist: { "alfred escher": 120, "hans escher": 50, "hans frei": 400 },
			formDist: { "Alfred Escher": 100, "Escher, Alfred": 15, "Hans Escher": 50, "Hans Frei": 380, Escher: 300 },
			hits: [{ value: "Escher", count: 300 }, { value: "Escher, Alfred", count: 15 }],
			words: suggestionQueryWords("persons", "Escher"),
		},
		lookups,
		opts,
	);
	assert.deepEqual(out, [
		{ value: "Escher", count: 300 },
		{ value: "Alfred Escher", count: 120 },
		{ value: "Hans Escher", count: 50 },
	]);
	assert.deepEqual(calls, { count: [], form: [] });
});

test("keyedSuggestions: Nachzählung gedeckelt, die mit der häufigsten Form zuerst; Limit", async () => {
	const { calls, lookups } = fakeLookups({ "ana meier": 40, "eva meier": 9 });
	const out = await keyedSuggestions(
		{
			dim: "persons",
			keyDist: {},
			formDist: {},
			hits: [
				{ value: "Eva Meier", count: 8 },
				{ value: "Anna Meyer", count: 30 },
				{ value: "Meier", count: 5 },
			],
			words: suggestionQueryWords("persons", "Mei"),
		},
		lookups,
		{ limit: 2, recountMax: 1 },
	);
	assert.deepEqual(out, [
		{ value: "Anna Meyer", count: 40 },
		{ value: "Meier", count: 5 },
	]);
	assert.deepEqual(calls, { count: [["ana meier"]], form: [] });
});

test("keyedSuggestions: keine Nachzählung, wenn Unbekannte nicht mehr unter die ersten kommen", async () => {
	// Ausserhalb der gekappten Verteilung höchstens so häufig wie ihr seltenster Schlüssel (50).
	const { calls, lookups } = fakeLookups({ "hans fritschi": 12 });
	const input = {
		dim: "persons" as const,
		keyDist: { "hans frei": 1113, "hans fischer": 300, "hans brunner": 50 },
		formDist: { "Hans Frei": 1100, "Hans Fischer": 290, "Hans Brunner": 50 },
		hits: [{ value: "Hans Fritschi", count: 12 }],
		words: suggestionQueryWords("persons", "Hans F"),
	};
	const two = await keyedSuggestions(input, lookups, { limit: 2, recountMax: 20 });
	assert.deepEqual(two, [
		{ value: "Hans Frei", count: 1113 },
		{ value: "Hans Fischer", count: 300 },
	]);
	assert.deepEqual(calls.count, []);
	const three = await keyedSuggestions(input, lookups, { limit: 3, recountMax: 20 });
	assert.deepEqual(three.map((s) => s.value), ["Hans Frei", "Hans Fischer", "Hans Fritschi"]);
	assert.deepEqual(calls.count, [["hans fritschi"]]);
});

test("keyedSuggestions: Wortanfänge auch in Formen der Auswahl, deren Schlüssel die Verteilung nicht kennt", async () => {
	const { calls, lookups } = fakeLookups({ "alfred escher": 160 });
	const out = await keyedSuggestions(
		{
			dim: "persons",
			keyDist: { "hans frei": 400 },
			formDist: { "Hans Frei": 390, "Alfred Escher": 150 },
			hits: [],
			words: suggestionQueryWords("persons", "Escher"),
		},
		lookups,
		opts,
	);
	assert.deepEqual(out, [{ value: "Alfred Escher", count: 160 }]);
	assert.deepEqual(calls.count, [["alfred escher"]]);
});
