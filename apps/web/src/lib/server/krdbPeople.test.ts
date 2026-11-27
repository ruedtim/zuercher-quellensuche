import { test } from "node:test";
import assert from "node:assert/strict";
import {
	filterDirectory,
	officeLines,
	partyLines,
	personFilter,
	personIds,
	personName,
	residenceNames,
	sanitizeMarks,
	yearAxis,
} from "./krdbPeople";
import { DEFAULT_DIRECTORY_QUERY } from "../personUrls";
import type { KrdbPerson } from "./krdbMatch";

const NOW = 2026;

test("personFilter: alle, im Titel, nur im Text – inklusive früherer IDs", () => {
	assert.deepEqual(personIds({ id: 5, aliases: [2, 3] }), [5, 2, 3]);
	assert.deepEqual(personIds({ id: 5 }), [5]);
	assert.deepEqual(personFilter([5, 2], "all"), ["krdbIds IN [5, 2]"]);
	assert.deepEqual(personFilter([5, 2], "title"), ["krdbTitleIds IN [5, 2]"]);
	assert.deepEqual(personFilter([5], "text"), ["krdbIds IN [5]", "NOT krdbTitleIds IN [5]"]);
});

test("yearAxis: Spannweite der Treffer, mindestens zehn Jahre, innerhalb 1803..heute", () => {
	assert.deepEqual(yearAxis({ "1990": 3, "1999": 1 }, NOW), { min: 1990, max: 1999 });
	assert.deepEqual(yearAxis({ "1994": 4 }, NOW), { min: 1990, max: 1999 });
	assert.deepEqual(yearAxis({ "2025": 4, "2026": 1 }, NOW), { min: 2017, max: 2026 }, "am heutigen Rand zurückgeschoben");
	assert.deepEqual(yearAxis({ "1803": 1 }, NOW), { min: 1803, max: 1812 }, "am Korpusanfang nicht davor");
	assert.deepEqual(yearAxis({}, NOW), { min: 2017, max: 2026 });
	assert.deepEqual(yearAxis({ x: 1, "1500": 2, "1990": 1, "2000": 1 }, NOW), { min: 1990, max: 2000 }, "Unsinn ignoriert");
});

const person = (extra: Partial<KrdbPerson>): KrdbPerson => ({
	id: 1,
	first: "Hans",
	last: "Meier",
	seats: [["Kantonsrat", "1991-05-13", "1999-05-09", "01. Wahlkreis Zürich"]],
	...extra,
});

test("officeLines: Spannen verschmelzen, Wahlkreis normalisiert, Regierung ohne Gremium", () => {
	const lines = officeLines({
		sex: "w",
		seats: [
			["Kantonsrat", "1991-05-13", "1998-05-18", "14. Wahlkreis (Winterthur Stadt)"],
			["Kantonsrat", "1998-05-18", "1999-05-09", "14. Wahlkreis (Winterthur Stadt)"],
			["Regierungsrat", "2015-05-18", null, "Kanton Zürich"],
			["Kantonsrat", "2003-05-05", null, "02. Wahlkreis   (Zürich 3+9)"],
		],
	});
	assert.deepEqual(lines, [
		{ label: "Kantonsrätin", years: "1991–1999", district: "14. Wahlkreis (Winterthur Stadt)" },
		{ label: "Kantonsrätin", years: "seit 2003", district: "2. Wahlkreis (Zürich 3+9)" },
		{ label: "Regierungsrätin", years: "seit 2015", district: null },
	]);
	assert.deepEqual(officeLines({ seats: [["Grosser Rat", "1803-04-12", "1814-06-30", "Zünfte und Los"]] }), [
		{ label: "Mitglied des Grossen Rats", years: "1803–1814", district: "Zünfte und Los" },
	]);
	assert.deepEqual(
		officeLines({ seats: [["Kantonsrat", "1975-05-26", "1975-12-31", null], ["Kantonsrat", "1979-05-01", "1983-05-01", null]] }),
		[{ label: "Kantonsrat", years: "1975, 1979–1983", district: null }],
	);
});

test("partyLines: Jahre, alte Einbuchstaben-Kürzel entfallen, gleiche Partei verschmilzt", () => {
	assert.deepEqual(
		partyLines({
			parties: [
				["SVP", "SVP", "1991", "1995"],
				["SVP", null, "1995", "1999"],
				["S", null, "1943", "1947"],
				["", null, "1900", "1910"],
				["FDP", null, "2003", null],
			],
		}),
		[
			{ party: "SVP", years: "1991–1999" },
			{ party: "FDP", years: "seit 2003" },
		],
	);
	assert.deepEqual(partyLines({}), []);
});

test("residenceNames, personName", () => {
	assert.deepEqual(
		residenceNames({
			places: [
				["Winterthur", "1999", "2003"],
				["Küsnacht (ZH)", "1991", "1999"],
				["Winterthur", "2003", null],
			],
		}),
		["Küsnacht", "Winterthur"],
	);
	assert.equal(personName({ first: " Georg ", last: "Wyss von" }), "Georg von Wyss");
});

const D: KrdbPerson[] = [
	person({ id: 1, first: "Hans", last: "Meier" }),
	person({ id: 2, first: "Anna", last: "Müller", seats: [["Regierungsrat", "2003-05-05", null, null]] }),
	person({ id: 3, first: "Ursula", last: "Mueller-Frei" }),
	person({ id: 4, first: "Georg", last: "Wyss von", seats: [["Grosser Rat", "1850", "1860", null]] }),
];

test("filterDirectory: Name (Umlaute, Teile), Amt, nur mit Dokumenten, Sortierung", () => {
	const counts = new Map([[1, 120], [2, 5], [4, 0]]);
	const names = (list: KrdbPerson[]) => list.map((p) => p.id);
	// alphabetisch nach KRDB-Nachname (Partikel am Ende: «Wyss von» unter W, «Mueller» vor «Müller»);
	// ohne Zahlen alle, mit Zahlen nur Personen mit Dokumenten
	assert.deepEqual(names(filterDirectory(D, DEFAULT_DIRECTORY_QUERY, null)), [1, 3, 2, 4]);
	assert.deepEqual(names(filterDirectory(D, DEFAULT_DIRECTORY_QUERY, counts)), [1, 2]);
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, withDocs: false }, counts)), [1, 3, 2, 4]);
	// Namenssuche: gefaltet (ü/ue), Vor- und Nachname beliebig, von-Präfix
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, q: "mueller", withDocs: false }, counts)), [3, 2]);
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, q: "anna müller", withDocs: false }, counts)), [2]);
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, q: "von wyss", withDocs: false }, counts)), [4]);
	// Amt
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, council: "Regierungsrat", withDocs: false }, counts)), [2]);
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, council: "Grosser Rat", withDocs: false }, counts)), [4]);
	// nach Dokumentzahl
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, sort: "docs" }, counts)), [1, 2]);
	assert.deepEqual(names(filterDirectory(D, { ...DEFAULT_DIRECTORY_QUERY, sort: "docs", withDocs: false }, counts)), [1, 2, 3, 4]);
});

test("sanitizeMarks: Text maskiert, nur die Hervorhebungen bleiben Markup", () => {
	assert.equal(
		sanitizeMarks('Das <b>Postulat</b> von <mark class="match">Abplanalp</mark> & Co <script>alert(1)</script>'),
		'Das &lt;b&gt;Postulat&lt;/b&gt; von <mark class="match">Abplanalp</mark> &amp; Co &lt;script&gt;alert(1)&lt;/script&gt;',
	);
	assert.equal(sanitizeMarks('<mark class="entity-match">Meier</mark>'), '<mark class="match">Meier</mark>');
	assert.equal(
		sanitizeMarks('<mark class="entity-match">Meier & <b>Co</b></mark>', { keepEntities: true }),
		'&lt;mark class="entity-match"&gt;Meier &amp; &lt;b&gt;Co&lt;/b&gt;&lt;/mark&gt;',
	);
	assert.equal(
		sanitizeMarks('<mark class="match">A</mark> <mark class="entity-match">B & C</mark>', { keepEntities: true }),
		'<mark class="match">A</mark> <mark class="entity-match">B &amp; C</mark>',
	);
	// ein Mark mit fremden Attributen oder Inhalt zählt nicht als Hervorhebung
	assert.equal(sanitizeMarks('<mark onclick="x()">A</mark>'), "&lt;mark onclick=\"x()\"&gt;A&lt;/mark&gt;");
	assert.equal(sanitizeMarks(""), "");
	assert.equal(sanitizeMarks("a < b"), "a &lt; b");
});
