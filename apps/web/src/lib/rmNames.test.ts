import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEARCH } from "./types";
import { isPersonSpelling, isPlaceSpelling, sharesNameWord } from "./nameSpelling";
import { parseSearchParams } from "./searchParams";
import {
	RM_VARIANTS_MAX,
	rmBranchQueries,
	rmFilter,
	rmFilterNames,
	rmFulltextApplies,
	rmFulltextHref,
	rmNameVariants,
	rmPhraseForm,
	rmSearchRange,
} from "./rmNames";

const p = (over: Partial<typeof DEFAULT_SEARCH>) => ({ ...DEFAULT_SEARCH, ...over });

test("isPersonSpelling: Vor- und Nachname, Flexion, Schreibvarianten", () => {
	assert.ok(isPersonSpelling("Ludwig Lavater", "Ludwigen Lafatern"));
	assert.ok(isPersonSpelling("Rudolf Lavater", "Růdolff Lavather"));
	assert.ok(isPersonSpelling("Heinrich Bullinger", "Hainrich Bullingern"));
	// Nachname allein, Amt, Satzteile, anderer Vorname
	assert.ok(!isPersonSpelling("Rudolf Gwalther", "Walthern"));
	assert.ok(!isPersonSpelling("Rudolf Gwalther", "dechan"));
	assert.ok(!isPersonSpelling("Jacob Meyer", "mitt Jacob"));
	assert.ok(!isPersonSpelling("Rudolf Gwalther", "schribt er"));
	assert.ok(!isPersonSpelling("Rudolf Gwalther", "Hans Walter"));
	// anderer Anfangsbuchstabe = anderer Familienname
	assert.ok(!isPersonSpelling("Rudolf Gwalther", "Růdolf Walter"));
});

test("isPlaceSpelling und sharesNameWord bleiben wie im Editionen-Aufbau", () => {
	assert.ok(isPlaceSpelling("Kyburg", "Kyburch"));
	assert.ok(!isPlaceSpelling("Mähren", "land"));
	assert.ok(sharesNameWord(["Bullinger, Heinrich"], ["Hainrich Bullingern"]));
	assert.ok(!sharesNameWord(["Joachim Neander"], ["Nebukadnezar"]));
});

test("rmFulltextApplies: Namensfilter, Serie, Zeitraum", () => {
	assert.ok(!rmFulltextApplies(p({})));
	assert.ok(rmFulltextApplies(p({ places: ["Kyburg"] })));
	assert.ok(rmFulltextApplies(p({ places: ["Kyburg"], series: ["RM", "KRP"] })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], series: ["KRP"] })));
	assert.ok(rmFulltextApplies(p({ places: ["Kyburg"], dateFrom: 1798 })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], dateFrom: 1799 })));
	assert.ok(rmFulltextApplies(p({ places: ["Kyburg"], dateFrom: 1400, dateTo: 1484 })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], dateTo: 1483 })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], years: [1900] })));
	assert.ok(rmFulltextApplies(p({ places: ["Kyburg"], years: [1900, 1600] })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], titleOnly: true })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], anyTerms: ["Vogt", "Amt"] })));
	assert.ok(rmFulltextApplies(p({ places: ["Kyburg"], anyTerms: ["Vogt"] })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], volumeNr: [400] })));
	assert.ok(rmFulltextApplies(p({ places: ["Kyburg"], volumeNr: [400], series: ["RM"] })));
	assert.ok(!rmFulltextApplies(p({ places: ["Kyburg"], resolutionId: ["1803/0003"] })));
});

test("rmFilterNames: Personen nur mit Vor- und Nachnamen", () => {
	assert.deepEqual(rmFilterNames(p({ persons: ["Gwalther", "Rudolf Gwalther"], places: ["Kyburg"], organizations: ["Rat"] })), [
		{ kind: "person", value: "Rudolf Gwalther" },
		{ kind: "place", value: "Kyburg" },
		{ kind: "org", value: "Rat" },
	]);
});

test("rmPhraseForm: Lesefassung ohne Klammern, Ziffern und Kommata", () => {
	assert.equal(rmPhraseForm("Grü[nin]gen"), "Grüningen");
	assert.equal(rmPhraseForm("Růdolff Lavather"), "Rudolff Lavather");
	assert.equal(rmPhraseForm("Gruͤningen"), "Grüningen");
	assert.equal(rmPhraseForm("Hanß Müller"), "Hanss Müller");
	assert.equal(rmPhraseForm("Kom̅ende"), "Kommende");
	assert.equal(rmPhraseForm("Töss, Kloster"), "");
	assert.equal(rmPhraseForm("Zürich 8"), "");
	assert.equal(rmPhraseForm("Huno (von Kiburg)"), "Huno");
});

test("rmNameVariants: Ort – Schreibungen nach Häufigkeit, ohne Gattungswörter", () => {
	const entries = [
		{ name: "Kyburg", forms: ["Kyburg", "Kiburg", "ampt"], count: 3 },
		{ name: "Kyburg", forms: ["Kyburch", "Kiburg"], count: 2 },
		{ name: "Huno von Kiburg", forms: ["Huno von Kiburg"], count: 1 },
		{ name: "Winterthur", forms: ["Winterthur"], count: 9 },
	];
	assert.deepEqual(rmNameVariants("place", "Kyburg", entries), ["Kyburg", "Kiburg", "Kyburch"]);
	// gleiche Lesefassung nur einmal, Filterwert zuerst
	assert.deepEqual(rmNameVariants("place", "Grüningen", [{ name: "Grüningen", forms: ["Gruningen", "Gruͤningen", "Grüeningen"] }]), [
		"Grüningen",
		"Grüeningen",
	]);
	// ohne Register-Eintrag nur der Filterwert
	assert.deepEqual(rmNameVariants("place", "Uster", entries), ["Uster"]);
});

test("rmNameVariants: Person – nur Formen mit Vor- und Nachnamen", () => {
	const entries = [
		{ name: "Rudolf Gwalther", forms: ["Rudolf Gwalther", "dechan", "Walthern", "Růdolf Walter", "schribt er", "Růdolff Gwalthern"], count: 2 },
	];
	assert.deepEqual(rmNameVariants("person", "Rudolf Gwalther", entries), ["Rudolf Gwalther", "Rudolff Gwalthern"]);
	assert.deepEqual(rmNameVariants("person", "Gwalther", entries), []);
});

test("rmNameVariants: höchstens RM_VARIANTS_MAX", () => {
	const forms = Array.from({ length: 20 }, (_, i) => `Kyburg${"x".repeat(i % 2)}${String.fromCharCode(97 + i)}`);
	assert.ok(rmNameVariants("place", "Kyburg", [{ name: "Kyburg", forms }]).length <= RM_VARIANTS_MAX);
});

test("rmSearchRange: Personen in der Zeit ihrer Editionsstücke", () => {
	assert.deepEqual(rmSearchRange("place", p({}), []), { from: null, to: null });
	assert.deepEqual(rmSearchRange("place", p({ dateFrom: 1600 }), [1500]), { from: 1600, to: null });
	assert.deepEqual(rmSearchRange("person", p({}), [1548, 1601, 1555]), { from: 1538, to: 1611 });
	assert.deepEqual(rmSearchRange("person", p({ dateFrom: 1560, dateTo: 1900 }), [1548, 1601]), { from: 1560, to: 1611 });
	assert.deepEqual(rmSearchRange("person", p({}), [1480, 1795]), { from: 1484, to: 1798 });
	assert.equal(rmSearchRange("person", p({ dateFrom: 1700 }), [1548, 1601]), null);
	// ohne Register-Eintrag nur mit Zeitraum der Auswahl
	assert.equal(rmSearchRange("person", p({}), []), null);
	assert.deepEqual(rmSearchRange("person", p({ dateTo: 1600 }), []), { from: null, to: 1600 });
});

test("rmBranchQueries und rmFilter", () => {
	assert.deepEqual(rmBranchQueries(["Kyburg", "Kiburg"], "Vogt -Amt"), [
		{ q: '-Amt "Kyburg" Vogt', matchingStrategy: "all" },
		{ q: '-Amt "Kiburg" Vogt', matchingStrategy: "all" },
	]);
	assert.deepEqual(rmBranchQueries(["Kyburg"], "Hanß"), [{ q: '"Kyburg" Hanss', matchingStrategy: "all" }]);
	assert.deepEqual(rmFilter(p({ dateFrom: 1500, dateTo: 1600, years: [1550] })), [
		"series = 'RM'",
		"dateYear >= 1500",
		"dateYear <= 1600",
		"dateYear IN [1550]",
	]);
});

test("rmFulltextHref: RM-Suche mit ODER-Phrasen, ohne Namensfilter", () => {
	const href = rmFulltextHref(["Kyburg", "Kiburg"], p({ q: "Vogt", dateFrom: 1500, persons: ["X Y"] }));
	const back = parseSearchParams(new URL(href, "http://x"));
	assert.deepEqual(back.series, ["RM"]);
	assert.deepEqual(back.anyTerms, ['"Kyburg"', '"Kiburg"']);
	assert.equal(back.q, "Vogt");
	assert.equal(back.dateFrom, 1500);
	assert.deepEqual(back.places, []);
	assert.deepEqual(back.persons, []);
	assert.match(href, /view=documents/);
	const one = parseSearchParams(new URL(rmFulltextHref(["Kyburg"], p({})), "http://x"));
	assert.equal(one.q, '"Kyburg"');
	assert.deepEqual(one.anyTerms, []);
});
