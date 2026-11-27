import { test } from "node:test";
import assert from "node:assert/strict";
import { assignKrdb, buildKrdbIndex, givenCompatible, type KrdbCandidate } from "./krdbAssign.ts";

// Erfundene Personen.
const persons: KrdbCandidate[] = [
  { id: 10, first: "Gustav", last: "Beispiel", born: 1939, seats: [["Kantonsrat", "1975-05-26", "1978-04-30"]] },
  { id: 11, first: "Hans Jakob", last: "Muster", born: 1890, died: 1960, seats: [["Kantonsrat", "1935-05-06", "1943-05-02"]] },
  { id: 12, first: "Hans", last: "Probe", born: 1880, died: 1950, seats: [["Kantonsrat", "1920-05-03", "1926-05-02"]] },
  { id: 13, first: "Hans", last: "Probe", born: 1910, died: 1985, seats: [["Kantonsrat", "1950-05-01", "1959-04-26"]] },
  { id: 14, first: "Anna", last: "Fiktiv", born: 1950, seats: [["Regierungsrat", "1999-07-01", null]] },
];
const index = buildKrdbIndex(persons, new Map([[9, 10]]));

test("gesichert über den KRDB-Link des Katalogs, auch über alte IDs", () => {
  const r = assignKrdb(
    { title: "Beispiel, Gustav (geb. 1939), Treuhändler\nSVP, Kantonsrat 1975-1978", dateFrom: 1975, dateTo: 1978, linkIds: [9], persons: [{ last: "Beispiel", first: "Gustav", born: 1939 }] },
    index,
  );
  assert.deepEqual(r, { strict: [{ id: 10, via: "link" }], names: [] });
});

test("Link ohne passenden Namen zählt nicht", () => {
  const r = assignKrdb({ title: "Andere, Person (geb. 1939)", dateFrom: 1975, dateTo: 1978, linkIds: [10], persons: [{ last: "Andere", first: "Person", born: 1939 }] }, index);
  assert.deepEqual(r.strict, []);
});

test("gesichert über Name + Geburtsjahr + Amtszeit im Titel", () => {
  const r = assignKrdb(
    { title: "Fiktiv, Anna (geb. 1950)\nRegierungsrätin ab 1999", dateFrom: 2000, dateTo: 2001, linkIds: [], persons: [{ last: "Fiktiv", first: "Anna", born: 1950 }] },
    index,
  );
  assert.deepEqual(r, { strict: [{ id: 14, via: "name" }], names: [] });
});

test("ohne Amtszeit nur Vorschlag, nicht gesichert", () => {
  const r = assignKrdb({ title: "Fiktiv, Anna (geb. 1950), von Zürich", dateFrom: 1990, dateTo: 1990, linkIds: [], persons: [{ last: "Fiktiv", first: "Anna", born: 1950 }] }, index);
  assert.deepEqual(r, { strict: [], names: [14] });
});

const rare = () => 1;
const common = () => 40;

test("Vorschlag: seltener Name, verträgliche Vornamen, Lebenszeit muss passen", () => {
  const r = assignKrdb({ title: "Muster, Hans, Landwirt, in Uster", dateFrom: 1930, dateTo: 1931, linkIds: [], persons: [{ last: "Muster", first: "Hans" }] }, index, rare);
  assert.deepEqual(r.names, [11]);
  const tooEarly = assignKrdb({ title: "Muster, Hans, getraut mit X, Y", dateFrom: 1650, dateTo: 1650, linkIds: [], persons: [{ last: "Muster", first: "Hans" }] }, index, rare);
  assert.deepEqual(tooEarly.names, []);
});

test("Vorschlag: andere zweite Vornamen schliessen aus", () => {
  const r = assignKrdb({ title: "Muster, Hans Heinrich, in Uster", dateFrom: 1930, dateTo: 1931, linkIds: [], persons: [{ last: "Muster", first: "Hans Heinrich" }] }, index, rare);
  assert.deepEqual(r.names, []);
  assert.equal(givenCompatible("Hans Jakob", "Hans"), true);
  assert.equal(givenCompatible("Hans Jakob", "Hans Heinrich"), false);
  assert.equal(givenCompatible("Jürg P.", "Jürg Peter"), true);
  assert.equal(givenCompatible("Carl", "Karl Emil"), true);
  assert.equal(givenCompatible("Albert", "A. Elisabetha"), false);
  assert.equal(givenCompatible("Heinrich", "H."), false);
});

test("Vorschlag: häufiger Name nur mit Geburtsjahr", () => {
  const plain = assignKrdb({ title: "Muster, Hans, in Uster", dateFrom: 1930, dateTo: 1931, linkIds: [], persons: [{ last: "Muster", first: "Hans" }] }, index, common);
  assert.deepEqual(plain.names, []);
  const withBorn = assignKrdb({ title: "Muster, Hans (geb. 1890), von Uster", dateFrom: 1930, dateTo: 1931, linkIds: [], persons: [{ last: "Muster", first: "Hans", born: 1890 }] }, index, common);
  assert.deepEqual(withBorn.names, [11]);
});

test("Vorschlag: abweichendes Geburtsjahr schliesst aus", () => {
  const r = assignKrdb({ title: "Muster, Hans (geb. 1903), von Uster", dateFrom: 1930, dateTo: 1930, linkIds: [], persons: [{ last: "Muster", first: "Hans", born: 1903 }] }, index);
  assert.deepEqual(r.names, []);
});

test("Vorschlag nur bei genau einer Person: Namensvettern ⇒ keiner", () => {
  const both = assignKrdb({ title: "Probe, Hans, in Uster", dateFrom: 1945, dateTo: 1946, linkIds: [], persons: [{ last: "Probe", first: "Hans" }] }, index, rare);
  assert.deepEqual(both.names, []);
  const one = assignKrdb({ title: "Probe, Hans, in Uster", dateFrom: 1975, dateTo: 1976, linkIds: [], persons: [{ last: "Probe", first: "Hans" }] }, index, rare);
  assert.deepEqual(one.names, [13]);
});
