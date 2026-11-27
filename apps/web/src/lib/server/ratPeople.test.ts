// Lauf: npx tsx --test src/lib/server/ratPeople.test.ts
// Ausgedachte Personen und Bände; die Golden-Fälle am echten Register stehen in ratRegister.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	filterRatDirectory,
	firstEntry,
	personVolumes,
	searchSurname,
	seatInRm,
	seatLabel,
	seatSummary,
	seatValueOptions,
	seatVolumes,
} from "./ratPeople";
import { DEFAULT_RAT_DIRECTORY_QUERY } from "../rat";
import type { RatPerson } from "./ratCouncil";
import type { RmBand } from "../rmBands";

const bands: Record<string, RmBand> = {
	"0441": { nr: 441, year: 1642, half: 2, rat: "Baptistalrat", scribe: "Unterschreiber" },
	"0442": { nr: 442, year: 1643, half: 1, rat: "Natalrat", scribe: "Stadtschreiber" },
	"0443": { nr: 443, year: 1643, half: 1, rat: "Natalrat", scribe: "Unterschreiber" },
	"0444": { nr: 444, year: 1643, half: 2, rat: "Baptistalrat", scribe: "Stadtschreiber" },
	"0555": { nr: 555, year: 1671, half: 2, rat: "Baptistalrat" },
	"0555a": { nr: 555, suffix: "a", year: 1671, rat: "beide", special: "Handexemplar Beat Holzhalb" },
	"0074": { nr: 74, year: 1550, rat: "beide" },
};

const person = (id: number, last: string, first: string, seats: RatPerson["seats"]): RatPerson => ({ id, last, first, seats });

test("Bände eines Einsitzes: gleiche Ratshälfte, Bandjahr im Einsitz", () => {
	assert.deepEqual(seatVolumes({ period: "nat", from: 1643, to: 1643 }, bands), [442, 443]);
	assert.deepEqual(seatVolumes({ period: "bapt", from: 1642, to: 1643 }, bands), [441, 444]);
	assert.deepEqual(seatVolumes({ period: "bapt", from: 1671, to: 1671 }, bands), [555], "Nummer einmal, auch mit Handexemplar");
	// Bände für beide Räte zählen nicht (wie der Reiter «Rat»), Quartalsräte haben keine Bände.
	assert.deepEqual(seatVolumes({ period: "nat", from: 1550, to: 1550 }, bands), []);
	assert.deepEqual(seatVolumes({ period: "herbst", from: 1300, to: 1310 }, bands), []);
});

test("Bände der ganzen Amtszeit ohne Doppelte", () => {
	const p = person(1, "Muster", "Hans", [
		{ period: "nat", from: 1643, to: 1643 },
		{ period: "bapt", from: 1642, to: 1643 },
		{ period: "nat", from: 1643, to: 1643, office: "Bürgermeister" },
	]);
	assert.deepEqual(personVolumes(p, bands), [441, 442, 443, 444]);
});

test("Beschriftung und Kurzfassung: höchstes Amt zuerst, Ratshälften zusammengefasst", () => {
	assert.equal(seatLabel({ period: "nat", from: 1644, to: 1655 }), "Natalrat 1644–1655");
	assert.equal(seatLabel({ period: "hoerner", from: 1489, to: 1489 }), "Hörnerner Rat 1489");
	const p = person(2, "Grossmann", "Konrad", [
		{ period: "bapt", from: 1573, to: 1581, office: "Zunftmeister", guild: "Schneidern" },
		{ period: "nat", from: 1574, to: 1582, office: "Zunftmeister", guild: "Schneidern" },
		{ period: "bapt", from: 1591, to: 1608, office: "Bürgermeister" },
		{ period: "nat", from: 1700, to: 1700, guild: "Constaffel" },
	]);
	assert.deepEqual(seatSummary(p), ["Bürgermeister 1591–1608", "Zunftmeister · Schneidern 1573–1582"]);
	assert.deepEqual(seatSummary(p, 3).at(-1), "Ratsmitglied 1700", "Constaffel ohne Funktion");
	assert.equal(firstEntry(p), 1573);
});

test("Verzeichnis: Name nach Wortanfängen, ohne Akzente; Filter; Sortierung", () => {
	const people = [
		person(1, "Hirzel", "Salomon", [{ period: "bapt", from: 1637, to: 1651, office: "Bürgermeister" }]),
		person(2, "Escher vom Luchs", "Hans Heinrich", [{ period: "bapt", from: 1628, to: 1664, office: "Constaffelherr", guild: "Constaffel" }]),
		person(3, "Bräm", "Heinrich", [{ period: "nat", from: 1601, to: 1607, office: "Zunftmeister", guild: "Widder" }]),
		person(4, "Mülner", "Rudolf", [{ period: "sommer", from: 1296, to: 1322 }]),
	];
	const find = (patch: Partial<typeof DEFAULT_RAT_DIRECTORY_QUERY>) =>
		filterRatDirectory(people, { ...DEFAULT_RAT_DIRECTORY_QUERY, ...patch }).map((p) => p.id);

	assert.deepEqual(find({}), [3, 2, 1, 4], "nach Nachname");
	assert.deepEqual(find({ q: "hirz" }), [1]);
	assert.deepEqual(find({ q: "escher luchs" }), [2]);
	assert.deepEqual(find({ q: "Bram" }), [3], "Umlaut wie ohne");
	assert.deepEqual(find({ q: "zel" }), [], "nur Wortanfänge");
	assert.deepEqual(find({ guild: "Widder" }), [3]);
	assert.deepEqual(find({ office: "Bürgermeister" }), [1]);
	assert.deepEqual(find({ century: 14 }), [4], "1296–1322 berührt das 14. Jahrhundert");
	assert.deepEqual(find({ century: 13 }), [4]);
	assert.deepEqual(find({ rmOnly: true }), [3, 2, 1]);
	assert.deepEqual(find({ sort: "entry" }), [4, 3, 2, 1]);
});

test("Auswahl im Verzeichnis: Personen je Wert, häufigste zuerst", () => {
	const people = [
		person(1, "A", "", [{ period: "nat", from: 1600, to: 1601, guild: "Saffran" }, { period: "bapt", from: 1602, to: 1603, guild: "Saffran" }]),
		person(2, "B", "", [{ period: "nat", from: 1600, to: 1601, guild: "Saffran", office: "Zunftmeister" }]),
		person(3, "C", "", [{ period: "nat", from: 1600, to: 1601, guild: "Meisen", office: "Zunftmeister" }]),
	];
	assert.deepEqual(seatValueOptions(people, "guild"), [
		{ value: "Saffran", count: 2 },
		{ value: "Meisen", count: 1 },
	]);
	assert.deepEqual(seatValueOptions(people, "office"), [{ value: "Zunftmeister", count: 2 }]);
});

test("Nachname für die Textsuche: erstes Wort ohne Partikel", () => {
	assert.equal(searchSurname("Escher vom Luchs"), "Escher");
	assert.equal(searchSurname("von Cham"), "Cham");
	assert.equal(searchSurname("Hirzel"), "Hirzel");
	assert.equal(searchSurname("zum Thor"), "Thor");
	assert.equal(searchSurname(""), "");
});

test("Einsitz in der Zeit der Ratsmanuale", () => {
	assert.ok(seatInRm({ period: "nat", from: 1480, to: 1490 }));
	assert.ok(seatInRm({ period: "bapt", from: 1798, to: 1798 }));
	assert.ok(!seatInRm({ period: "nat", from: 1400, to: 1483 }));
});
