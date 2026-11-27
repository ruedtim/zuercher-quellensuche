// Lauf: npx tsx --test src/stale.test.ts
// Veraltete P13468 (neu nummerierte KRDB-IDs) über Name + Geburtsdatum auflösen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { birthMatches, nameMatches, resolveStale, type StaleItem, type StalePerson } from "./stale.ts";

const P: StalePerson[] = [
  { id: 23222, first: "Alfred", last: "Heer", bornDate: "1961-10-12" },
  { id: 23385, first: "Bettina", last: "Balmer-Schiltknecht", bornDate: "1966-04-19" },
  { id: 22914, first: "Heinrich", last: "Rüegg", bornDate: "1801" },
  { id: 100, first: "Hans", last: "Meier", bornDate: "1950-01-01" },
  { id: 101, first: "Hans", last: "Meier", bornDate: "1950-06-30" },
  { id: 200, first: "Peter", last: "von Arx", bornDate: "1970-02-02" },
  { id: 23111, first: "Johann Heinrich", last: "Zangger", bornDate: "1792-06-13" },
  { id: 23200, first: "Heinrich", last: "Ryffel", bornDate: "1804-02-12" },
];
const item = (qid: string, names: string[], births: StaleItem["births"], oldIds = ["1"]): StaleItem => ({ qid, oldIds, names, births });
const day = (date: string) => ({ date, precision: 11 });

test("nameMatches: Vorname + Nachnamensteil, Doppelnamen, Umlaut-Varianten, keine Partikel allein", () => {
  assert.ok(nameMatches(P[0], "Alfred Heer"));
  assert.ok(nameMatches(P[1], "Bettina Balmer"), "Teil eines Doppelnamens genügt");
  assert.ok(nameMatches(P[2], "Heinrich Ruegg"), "ü ↔ u");
  assert.ok(!nameMatches(P[0], "Alfred Escher"));
  assert.ok(!nameMatches(P[5], "Peter von Salis"), "nur «von» gemeinsam");
  assert.ok(nameMatches(P[6], "Hans Heinrich Zangger"), "Hans ↔ Johann");
  assert.ok(nameMatches(P[6], "Heinrich Zangger"), "zweiter Vorname genügt");
});

test("birthMatches: in der gröberen Genauigkeit", () => {
  assert.equal(birthMatches("1961-10-12", day("1961-10-12T00:00:00Z")), "date");
  assert.equal(birthMatches("1961-10-12", { date: "1961-00-00", precision: 9 }), "year");
  assert.equal(birthMatches("1961", day("1961-10-12")), "year");
  assert.equal(birthMatches("1961-10-12", day("1961-10-13")), null);
  assert.equal(birthMatches(undefined, day("1961-10-12")), null);
});

test("resolveStale: eindeutiger Treffer über Name + Geburtsdatum", () => {
  const r = resolveStale([item("Q117149", ["Alfred Heer"], [day("1961-10-12")], ["22511"])], P, new Map());
  assert.deepEqual(r.resolved, [
    { qid: "Q117149", oldIds: ["22511"], newId: 23222, name: "Alfred Heer", basis: "Name + Geburtsdatum", linkedAlready: false },
  ]);
  assert.deepEqual(r.unresolved, []);
});

test("resolveStale: Doppelname und nur Geburtsjahr am Item", () => {
  const r = resolveStale([item("Q123183642", ["Bettina Balmer"], [{ date: "1966-01-01", precision: 9 }])], P, new Map());
  assert.equal(r.resolved[0]?.newId, 23385);
  assert.equal(r.resolved[0]?.basis, "Name + Geburtsjahr");
});

test("resolveStale: taggenauer Treffer schlägt Jahrestreffer, sonst mehrdeutig", () => {
  const exact = resolveStale([item("Q1", ["Hans Meier"], [day("1950-06-30")])], P, new Map());
  assert.equal(exact.resolved[0]?.newId, 101);
  const yearOnly = resolveStale([item("Q2", ["Hans Meier"], [{ date: "1950-00-00", precision: 9 }])], P, new Map());
  assert.equal(yearOnly.resolved.length, 0);
  assert.match(yearOnly.unresolved[0].reason, /mehrdeutig \(KRDB 100, 101\)/);
});

test("resolveStale: ohne Geburtsdatum oder ohne passende Person bleibt es offen", () => {
  const r = resolveStale(
    [item("Q3", ["Alfred Heer"], []), item("Q4", ["Alfred Heer"], [day("1962-10-12")])],
    P,
    new Map(),
  );
  assert.deepEqual(r.resolved, []);
  assert.deepEqual(
    r.unresolved.map((u) => u.reason),
    ["Item ohne Geburtsdatum", "keine Person mit passendem Namen und Geburtsdatum"],
  );
});

test("resolveStale: schon anders verknüpft oder zwei Items für eine Person ⇒ Dublette melden", () => {
  const other = resolveStale([item("Q5", ["Alfred Heer"], [day("1961-10-12")])], P, new Map([[23222, "Q999"]]));
  assert.match(other.unresolved[0].reason, /schon mit Q999 verknüpft/);
  const same = resolveStale([item("Q6", ["Alfred Heer"], [day("1961-10-12")])], P, new Map([[23222, "Q6"]]));
  assert.equal(same.resolved[0]?.linkedAlready, true, "gleiche Verknüpfung: nur alten Wert korrigieren");
  const twice = resolveStale(
    [item("Q7", ["Alfred Heer"], [day("1961-10-12")]), item("Q8", ["Alfred Heer"], [day("1961-10-12")])],
    P,
    new Map(),
  );
  assert.equal(twice.resolved.length, 0);
  assert.equal(twice.unresolved.filter((u) => /mehrere Items/.test(u.reason)).length, 2);
  const taken = resolveStale([item("Q9", ["Alfred Heer"], [day("1961-10-12")])], P, new Map([[100, "Q9"]]));
  assert.match(taken.unresolved[0].reason, /Item ist schon mit KRDB 100 verknüpft/);
});

test("resolveStale: gleichwertige Vornamen; abweichendes Geburtsdatum wird konkret gemeldet", () => {
  const r = resolveStale(
    [
      item("Q18683323", ["Hans Heinrich Zangger"], [day("1792-06-13")], ["16870"]),
      item("Q47088566", ["Hans Heinrich Ryffel"], [day("1804-11-12")], ["17575"]),
    ],
    P,
    new Map(),
  );
  assert.equal(r.resolved[0]?.newId, 23111);
  assert.equal(r.unresolved[0]?.reason, "Name und Geburtsjahr passen, Geburtsdatum weicht ab (KRDB 23200)");
});
