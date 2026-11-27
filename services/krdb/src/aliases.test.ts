import { test } from "node:test";
import assert from "node:assert/strict";
import type { KrdbPerson } from "../../../apps/web/src/lib/server/krdbMatch.ts";
import { carryAliases } from "./aliases.ts";

const person = (id: number, first: string, last: string, extra: Partial<KrdbPerson> = {}): KrdbPerson => ({
  id,
  first,
  last,
  seats: [["Kantonsrat", "1991-05-13", null, null]],
  ...extra,
});

test("neu vergebene ID: alte ID wird Alias der neuen (Name, Einsitz, Geburtsjahr)", () => {
  const previous = [person(100, "Hans", "Meier", { born: 1950 }), person(200, "Anna", "Frei")];
  const next = [
    // Todesdatum nachgetragen ⇒ neue ID; Einsitz hat jetzt ein Austrittsdatum.
    person(900, "Hans", "Meier", { born: 1950, died: 2025, seats: [["Kantonsrat", "1991-05-13", "1999-05-09", null]] }),
    person(200, "Anna", "Frei"),
  ];
  const r = carryAliases(previous, next);
  assert.deepEqual(r.resolved, [{ oldId: 100, newId: 900, name: "Hans Meier" }]);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(next[0].aliases, [100]);
  assert.equal(next[1].aliases, undefined, "unveränderte ID ohne Alias");
});

test("bisherige Aliasse bleiben bei gleicher ID, wandern bei neuer ID mit", () => {
  const previous = [person(500, "Eva", "Keller", { aliases: [11, 22] }), person(600, "Max", "Bühler", { aliases: [33] })];
  const next = [
    person(500, "Eva", "Keller"),
    person(950, "Max", "Bühler"), // 600 ⇒ 950
  ];
  const r = carryAliases(previous, next);
  assert.equal(r.carried, 1);
  assert.deepEqual(next[0].aliases, [11, 22]);
  assert.deepEqual(next[1].aliases, [33, 600], "Alias-Kette: 33 → 600 → 950");
});

test("nicht eindeutig oder ohne gemeinsamen Einsitz: keine Zuordnung, Meldung", () => {
  const previous = [
    person(10, "Hans", "Meier"),
    person(20, "Paul", "Huber", { seats: [["Kantonsrat", "1975-05-26", null, null]] }),
    person(30, "Rita", "Weber"),
  ];
  const next = [
    person(91, "Hans", "Meier"), // zwei Kandidaten für die alte 10 …
    person(92, "Hans", "Meier"),
    person(93, "Paul", "Huber", { seats: [["Kantonsrat", "2003-05-05", null, null]] }), // anderer Einsitz
    person(94, "Rita", "Weber", { born: 1960 }),
  ];
  const old30 = previous[2];
  old30.born = 1961; // Geburtsjahr widerspricht
  const r = carryAliases(previous, next);
  assert.deepEqual(r.resolved, []);
  assert.deepEqual(
    r.unresolved.map((u) => [u.id, u.reason.split(" ")[0]]),
    [
      [10, "mehrdeutig"],
      [20, "keine"],
      [30, "keine"],
    ],
  );
  assert.ok(next.every((p) => p.aliases === undefined));
});

test("zwei alte IDs beanspruchen dieselbe neue: keine wird übernommen", () => {
  const previous = [person(10, "Hans", "Meier"), person(11, "Hans", "Meier")];
  const next = [person(99, "Hans", "Meier")];
  const r = carryAliases(previous, next);
  assert.deepEqual(r.resolved, []);
  assert.equal(r.unresolved.length, 2);
  assert.ok(r.unresolved.every((u) => /beansprucht/.test(u.reason)));
  assert.equal(next[0].aliases, undefined);
});

test("Umlaute und Gross-/Kleinschreibung im Namen sind egal, aus dem Register verschwundene Person wird gemeldet", () => {
  const previous = [person(1, "Jürg", "Müller"), person(2, "Karl", "Gone")];
  const next = [person(7, "JÜRG", "müller"), person(3, "Neu", "Person", { seats: [["Kantonsrat", "2023-05-08", null, null]] })];
  const r = carryAliases(previous, next);
  assert.deepEqual(r.resolved.map((x) => [x.oldId, x.newId]), [[1, 7]]);
  assert.deepEqual(r.unresolved.map((u) => u.id), [2]);
});
