// Lauf: npx tsx --test src/lib/server/ratCouncil.test.ts
// Nur ausgedachte Personen – das Register des Staatsarchivs liegt nicht im Repo
// (Lizenz offen, docs/zuercher-rat-plan.md §2).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	councilAt,
	hasRmSeat,
	mayorOf,
	periodOfHalf,
	ratLifeSpan,
	ratPersonName,
	seatCovers,
	type RatPerson,
} from "./ratCouncil";

const person = (id: number, last: string, first: string, seats: RatPerson["seats"]): RatPerson => ({
	id,
	last,
	first,
	seats,
});

const people: RatPerson[] = [
	person(1, "Rahn", "Hans Rudolf", [{ period: "nat", from: 1644, to: 1655, office: "Bürgermeister" }]),
	person(2, "Escher", "Hans Caspar", [
		{ period: "nat", from: 1640, to: 1652, office: "Zunftmeister", guild: "Saffran" },
		{ period: "bapt", from: 1650, to: 1660, office: "Ratsherr", guild: "Meisen" },
	]),
	person(3, "Holzhalb", "Leonhard", [{ period: "nat", from: 1648, to: 1652, office: "Constaffelherr", guild: "Constaffel" }]),
	person(4, "Werdmüller", "Hans Georg", [{ period: "nat", from: 1650, to: 1650, office: "Zunftmeister", guild: "Meisen" }]),
	person(5, "Alt", "Rudolf", [{ period: "herbst", from: 1300, to: 1310 }]),
];

test("Halbjahr → Ratsperiode", () => {
	assert.equal(periodOfHalf(1), "nat");
	assert.equal(periodOfHalf(2), "bapt");
});

test("Einsitz deckt das Jahr, Ein- und Austrittsjahr zählen mit", () => {
	const seat = { period: "nat", from: 1644, to: 1655 } as const;
	assert.ok(seatCovers(seat, "nat", 1644));
	assert.ok(seatCovers(seat, "nat", 1655));
	assert.ok(!seatCovers(seat, "nat", 1643));
	assert.ok(!seatCovers(seat, "nat", 1656));
	assert.ok(!seatCovers(seat, "bapt", 1650), "andere Ratshälfte");
});

test("Wer sass im Natalrat 1650? Reihenfolge Funktion, Zunft, Name", () => {
	const members = councilAt(people, 1650, 1);
	assert.deepEqual(
		members.map((m) => `${m.person.last} (${m.seat.office})`),
		[
			"Rahn (Bürgermeister)",
			"Holzhalb (Constaffelherr)",
			"Werdmüller (Zunftmeister)", // Meisen vor Saffran
			"Escher (Zunftmeister)",
		],
	);
	assert.equal(mayorOf(members)?.person.last, "Rahn");
});

test("Baptistalrat 1650 ist ein anderer Rat", () => {
	const members = councilAt(people, 1650, 2);
	assert.deepEqual(members.map((m) => m.person.last), ["Escher"]);
	assert.equal(members[0].seat.guild, "Meisen");
	assert.equal(mayorOf(members), null);
});

test("Quartalsräte vor 1336 kommen in keinem Halbjahresrat vor", () => {
	assert.deepEqual(councilAt(people, 1305, 1), []);
	assert.deepEqual(councilAt(people, 1305, 2), []);
});

test("Zwei Einsitze im selben Halbjahr: die höhere Funktion gilt, die Person steht einmal", () => {
	const doppelt = [
		person(9, "Meyer", "Hug", [
			{ period: "nat", from: 1600, to: 1610, office: "Zunftmeister", guild: "Gerwe" },
			{ period: "nat", from: 1605, to: 1605, office: "Bürgermeister" },
		]),
	];
	const members = councilAt(doppelt, 1605, 1);
	assert.equal(members.length, 1);
	assert.equal(members[0].seat.office, "Bürgermeister");
	assert.equal(councilAt(doppelt, 1606, 1)[0].seat.office, "Zunftmeister");
});

test("Name und Lebensdaten", () => {
	assert.equal(ratPersonName(people[0]), "Hans Rudolf Rahn");
	assert.equal(ratPersonName({ ...people[0], first: "" }), "Rahn");
	assert.equal(ratLifeSpan({ ...people[0], born: 1759, died: 1856 }), "1759–1856");
	assert.equal(ratLifeSpan({ ...people[0], born: 1759 }), "* 1759");
	assert.equal(ratLifeSpan({ ...people[0], died: 1856 }), "† 1856");
	assert.equal(ratLifeSpan(people[0]), "");
});

test("Einsitz in der Zeit der Ratsmanuale", () => {
	assert.ok(hasRmSeat(people[0]));
	assert.ok(!hasRmSeat(people[4]), "Herbstrat 1300–1310 liegt vor 1484");
	assert.ok(hasRmSeat(person(6, "Spät", "Hans", [{ period: "nat", from: 1480, to: 1490 }])), "überlappt 1484");
});
