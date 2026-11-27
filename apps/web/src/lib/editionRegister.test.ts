// Lauf: npx tsx --test src/lib/editionRegister.test.ts
// Ausgedachte Beispiele (kein Editionsmaterial im Repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildEditionRegister,
	editionEntitySearchHref,
	editionRegisterHref,
	editionRegisterKinds,
	editionSortName,
	filterEditionRegister,
	FORMS_SHOWN,
	gndHref,
	isNameSpelling,
	yearSpan,
	type EditionRegisterPiece,
} from "./editionRegister";

const piece = (p: Partial<EditionRegisterPiece>): EditionRegisterPiece => ({
	edition: "qzh",
	dateFrom: null,
	dateTo: null,
	persons: [],
	places: [],
	orgs: [],
	...p,
});

const PIECES: EditionRegisterPiece[] = [
	piece({
		dateFrom: 1530,
		dateTo: 1531,
		persons: [
			{ name: "Hans Wäber", gnd: "111", forms: ["Hanns Weber", "Wäber"], count: 3 },
			{ name: "Anna Gugger", gnd: null, forms: ["Ana Guggerin", "Wädenswil", "fer"], count: 1 },
		],
		places: [{ name: "Kyburg", lat: 47.46, lon: 8.74, forms: ["Kyburch", "Kÿburg", "land"], count: 2 }],
		orgs: ["Rat von Zürich"],
	}),
	piece({
		dateFrom: 1545,
		dateTo: null,
		persons: [
			{ name: "Hans Wäber", gnd: "111", forms: ["Hanns Weber", "Hans Wæber"], count: 2 },
			// Derselbe Name zweimal im Stück zählt einmal als Stück.
			{ name: "Hans Wäber", gnd: "111", forms: ["Weber"], count: 1 },
		],
		places: [{ name: "Kyburg", lat: 47.46, lon: 8.74, forms: ["Kyburg"], count: 1 }],
		orgs: ["Rat von Zürich", "  "],
	}),
	piece({
		dateFrom: null,
		dateTo: 1520,
		persons: [
			{ name: "Paulus, Apostel, Heiliger", gnd: "222", forms: ["Paulus"], count: 1 },
			{ name: "Ulrich Zwingli (1556–1601)", gnd: "333", forms: ["Zwinglj"], count: 1 },
		],
		places: [],
		orgs: [],
	}),
];

test("Register: ein Eintrag je Name, Stücke, Nennungen, Zeitraum, Schreibungen, GND", () => {
	const reg = buildEditionRegister(PIECES);
	assert.equal(reg.pieces, 3);
	const waeber = reg.person.entries[0];
	assert.equal(waeber.name, "Hans Wäber");
	assert.equal(waeber.pieces, 2);
	assert.equal(waeber.mentions, 6);
	assert.equal(waeber.yearFrom, 1530);
	assert.equal(waeber.yearTo, 1545);
	assert.equal(waeber.gnd, "111");
	// Häufigste Schreibung zuerst (zwei Stücke), der Name selbst nicht.
	assert.deepEqual(waeber.forms.slice(0, 1), ["Hanns Weber"]);
	assert.ok(!waeber.forms.includes("Hans Wäber"));
	assert.ok(waeber.forms.length <= FORMS_SHOWN);
	assert.deepEqual(waeber.editions, ["qzh"]);
	// Nur das Jahr, das ein Stück hat, zählt (1520 ohne Anfangsjahr).
	const paulus = reg.person.entries.find((e) => e.name.startsWith("Paulus"));
	assert.equal(paulus?.yearFrom, 1520);
	assert.equal(paulus?.yearTo, 1520);
	const kyburg = reg.place.entries[0];
	assert.equal(kyburg.name, "Kyburg");
	assert.equal(kyburg.pieces, 2);
	assert.deepEqual(kyburg.coords, { lat: 47.46, lon: 8.74 });
	// Fehlgriffe der Auszeichnung (Ort an einer Person, Gattungswort, Satzrest) sind keine Schreibungen.
	assert.deepEqual(reg.person.entries.find((e) => e.name === "Anna Gugger")?.forms, ["Ana Guggerin"]);
	assert.deepEqual(kyburg.forms, ["Kyburch", "Kÿburg"]);
	// Leere Organisationen fallen weg, je Stück einmal.
	assert.deepEqual(
		reg.org.entries.map((e) => [e.name, e.pieces]),
		[["Rat von Zürich", 2]],
	);
});

test("Suche: Wortanfänge im Namen vor Schreibungen im Text, Sortierung nach Name", () => {
	const reg = buildEditionRegister(PIECES);
	const names = (q: string, sort: "count" | "name" = "count") => filterEditionRegister("person", reg.person, { q, sort }).map((e) => e.name);
	assert.deepEqual(names("wäb"), ["Hans Wäber"]);
	// Umlaut und Schreibvariante falten wie die Schlüssel («Waeber», «Weber» erst über die Schreibung).
	assert.deepEqual(names("Waeber"), ["Hans Wäber"]);
	assert.deepEqual(names("Weber"), ["Hans Wäber"]);
	assert.deepEqual(names("Zwinglj"), ["Ulrich Zwingli (1556–1601)"]);
	assert.deepEqual(names("Wäber, Hans"), ["Hans Wäber"]);
	assert.deepEqual(names("Gugger Anna"), ["Anna Gugger"]);
	assert.deepEqual(names("xyz"), []);
	assert.deepEqual(names("Wädenswil"), []);
	assert.deepEqual(names("–?"), []);
	// Ohne Suchwort alle, häufigste zuerst bzw. nach Nachnamen.
	assert.equal(names("").length, 4);
	assert.deepEqual(names("", "name"), ["Anna Gugger", "Paulus, Apostel, Heiliger", "Hans Wäber", "Ulrich Zwingli (1556–1601)"]);
	assert.deepEqual(
		filterEditionRegister("place", reg.place, { q: "Stadt Kyburg", sort: "count" }).map((e) => e.name),
		["Kyburg"],
	);
});

test("Schreibung eines Namens: ähnliches Wort bzw. ähnlicher Ortsschlüssel", () => {
	assert.ok(isNameSpelling("person", "Rudolf Gwalther", "Walthern"));
	assert.ok(isNameSpelling("person", "Johannes Keller", "Hans Keller"));
	assert.ok(!isNameSpelling("person", "Rudolf Gwalther", "dechan"));
	assert.ok(!isNameSpelling("person", "Hans Wäber", "Wädenswil"));
	assert.ok(isNameSpelling("place", "Grüningen", "Gruͤningen"));
	assert.ok(!isNameSpelling("place", "Mähren", "land"));
	assert.ok(isNameSpelling("org", "Rat von Zürich", "Raths von Zürich"));
});

test("Sortiername: Nachname, Einzelname vor dem Komma, Zusätze in Klammern zählen nicht", () => {
	assert.equal(editionSortName("person", "Hans Wäber"), "waber hans");
	assert.equal(editionSortName("person", "Paulus, Apostel, Heiliger"), "paulus");
	assert.equal(editionSortName("person", "Ulrich Zwingli (1556–1601)"), "zwingli ulrich");
	assert.equal(editionSortName("person", "Donatus"), "donatus");
	assert.equal(editionSortName("place", "Kloster Töss (Winterthur)"), "kloster toss");
});

test("Typen mit Einträgen und Links", () => {
	const reg = buildEditionRegister([piece({ persons: [{ name: "Hans Wäber" }] })]);
	assert.deepEqual(
		editionRegisterKinds(reg).map((k) => k.slug),
		["personen"],
	);
	assert.equal(editionRegisterHref("orte"), "/editionen/register/orte");
	assert.equal(editionRegisterHref("personen", { q: "Wäber", sort: "name", page: 2 }), "/editionen/register/personen?q=W%C3%A4ber&sort=name&page=2");
	assert.equal(editionEntitySearchHref("person", "Hans Wäber"), "/search?persons=Hans+W%C3%A4ber&view=editions");
	assert.equal(editionEntitySearchHref("org", "Rat von Zürich"), "/search?organizations=Rat+von+Z%C3%BCrich&view=editions");
	assert.equal(gndHref("118517414"), "https://d-nb.info/gnd/118517414");
	assert.equal(yearSpan(1530, 1545), "1530–1545");
	assert.equal(yearSpan(1530, 1530), "1530");
	assert.equal(yearSpan(null, 1520), "1520");
	assert.equal(yearSpan(null, null), "");
});
