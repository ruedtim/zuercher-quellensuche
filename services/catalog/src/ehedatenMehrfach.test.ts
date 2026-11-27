import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "./edb.ts";
import {
  buildMehrfach,
  checkMehrfach,
  distinctReason,
  MEHRFACH_COLUMNS,
  mehrfachData,
  mehrfachRows,
  serializeMehrfach,
  type MehrfachDoc,
  type MehrfachFile,
  type MehrfachRow,
} from "./ehedatenMehrfach.ts";

// Erfundene Namen in den Mustern der Liste (stazh/sw-ehedaten) und der Ehedatenbank.

function doc(id: number, over: Partial<MehrfachDoc> = {}): MehrfachDoc {
  return {
    id,
    kirchgemeinde: "Gossau",
    signatur: `E III 44.2, EDB ${id % 1000}`,
    isoVon: "1585-11-28",
    isoBis: "1585-11-28",
    mannName: "Heinrich Muster",
    mannNachname: "Muster",
    mannVorname: "Heinrich",
    mannZusatz: "",
    frauName: "Barbara Beispiel",
    frauNachname: "Beispiel",
    frauVorname: "Barbara",
    frauZusatz: "",
    ...over,
  };
}

function row(ehe: string, d: MehrfachDoc, over: Partial<MehrfachRow> = {}): MehrfachRow {
  return {
    Marriage_ID: ehe,
    Nachname_Mann: d.mannNachname,
    Vorname_Mann: d.mannVorname,
    Herkunft_Mann: "",
    Nachname_Frau: d.frauNachname,
    Vorname_Frau: d.frauVorname,
    Herkunft_Frau: "",
    Datum: d.isoVon === d.isoBis ? d.isoVon.replace(/-/g, ".") : "",
    Startdatum: d.isoVon === d.isoBis ? "" : d.isoVon.replace(/-/g, "."),
    Enddatum: d.isoVon === d.isoBis ? "" : d.isoBis.replace(/-/g, "."),
    Kirchgemeinde: d.kirchgemeinde,
    Signatur: d.signatur,
    "Scope-ID": String(d.id),
    Sicherheitswert: "Certain",
    ...over,
  };
}

test("CSV der Liste: Semikolon, Anführungszeichen mit Semikolon, CRLF, BOM; fehlende Spalte bricht ab", () => {
  assert.deepEqual(parseCsv('a;"b;c";\r\n1;2;3', ";"), [["a", "b;c", ""], ["1", "2", "3"]]);
  const text =
    "﻿" +
    [
      MEHRFACH_COLUMNS.join(";"),
      '39436;Muster;Bartholomäus;;Beispiel;Verena;;1618.10.21;;;Grossmünster;"TAI 1.737; StadtAZH VIII.C. 3., EDB 1798";2060870;Certain',
      "",
    ].join("\r\n");
  const rows = mehrfachRows(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Signatur, "TAI 1.737; StadtAZH VIII.C. 3., EDB 1798");
  assert.equal(rows[0]["Scope-ID"], "2060870");
  assert.equal(rows[0].Sicherheitswert, "Certain");
  assert.throws(() => mehrfachRows("Marriage_ID;Scope-ID\r\n1;2"), /Spalte «Nachname_Mann» fehlt/);
});

test("Zwei Ehen statt einer: nur in derselben Kirchgemeinde, andere Vornamen oder Vermerk", () => {
  // Zwei Kirchgemeinden: Vornamen schwanken zwischen den Büchern, das bleibt eine Ehe.
  const gossau = doc(1, { mannName: "Heinrich Muster", mannVorname: "Heinrich" });
  const wetzikon = doc(2, { kirchgemeinde: "Wetzikon", mannName: "Kleinheinrich Muster", mannVorname: "Kleinheinrich" });
  assert.equal(distinctReason(gossau, wetzikon), null);
  // … auch mit dem Vermerk über den Bruder (er steht in beiden Büchern).
  const bruder = { mannZusatz: "Sein Bruder Hans Muster heiratet am gleichen Tag." };
  assert.equal(distinctReason({ ...gossau, ...bruder }, { ...wetzikon, ...bruder }), null);
  // Dieselbe Kirchgemeinde, andere Vornamen: Brüder heiraten am selben Tag Schwestern.
  const hans = doc(3, { mannName: "Hans Muster", mannVorname: "Hans", frauName: "Anna Beispiel", frauVorname: "Anna" });
  assert.equal(distinctReason(gossau, hans), "vornamen");
  assert.equal(distinctReason(gossau, doc(4, { frauName: "Verena Beispiel", frauVorname: "Verena" })), "vornamen");
  // Gleiche Namen (Meier = Meyer): Doppeleintrag derselben Ehe …
  assert.equal(distinctReason(gossau, doc(5, { frauName: "Barbara Beyspiel" })), null);
  // … ausser ein Vermerk nennt eine weitere Hochzeit am selben Tag (Vater und Sohn gleichen Namens).
  assert.equal(distinctReason(gossau, doc(6, { mannZusatz: "Sein Vater Heinrich Muster heiratet am gleichen Tag." })), "vermerk");
  assert.equal(distinctReason(doc(7, { frauZusatz: "-; Gleichentags heiratet ihre Schwester" }), gossau), "vermerk");
  // Derselbe Tag ohne Hochzeit im Satz zählt nicht.
  assert.equal(distinctReason(gossau, doc(8, { mannZusatz: "am gleichen Tag getauft? nein; heiratet zum zweiten Mal" })), null);
});

test("Aufbau: Ehen, «wahrscheinlich», verworfene Paare, Lücken und Abweichungen", () => {
  const a1 = doc(1972592, { kirchgemeinde: "Wetzikon" });
  const a2 = doc(1998353);
  const b1 = doc(1972853, { kirchgemeinde: "Wetzikon", isoVon: "1614-10-18", isoBis: "1614-10-18" });
  const b2 = doc(1998825, { isoVon: "1614-10-16", isoBis: "1614-10-16" });
  const c1 = doc(1959266, { kirchgemeinde: "Steinmaur" });
  const c2 = doc(1959267, { kirchgemeinde: "Steinmaur", mannZusatz: "Sein Vater Heinrich Muster heiratet am gleichen Tag." });
  const d1 = doc(4398583, { kirchgemeinde: "Uster", isoVon: "1742-10-31", isoBis: "1742-10-31" });
  const docs = new Map([a1, a2, b1, b2, c1, c2, d1].map((d) => [d.id, d]));
  const rows = [
    row("19389", a2),
    row("19389", a1),
    row("36532", b1, { Sicherheitswert: "Probably" }),
    row("36532", b2, { Sicherheitswert: "Probably" }),
    row("110021", c1),
    row("110021", c2),
    // Datum der Liste weicht ab (spätere Korrektur der Ehedatenbank), Partner fehlt im Index.
    row("200000", d1, { Datum: "1742.10.21" }),
    row("200000", doc(999), { Nachname_Mann: "Mustermann" }),
  ];
  const b = buildMehrfach(rows, docs);
  assert.deepEqual([...b.ehen.entries()], [
    ["19389", [1972592, 1998353]],
    ["36532", [1972853, 1998825]],
  ]);
  assert.deepEqual([...b.wahrscheinlich], ["36532"]);
  assert.deepEqual([...b.verschieden.entries()], [["110021", { ids: [1959266, 1959267], grund: "vermerk" }]]);
  assert.equal(b.rows, 8);
  assert.equal(b.listed, 4);
  assert.deepEqual(b.problems.ohneEintrag, ["999 (Ehe 200000, E III 44.2, EDB 999)"]);
  assert.deepEqual(b.problems.unvollstaendig, ["Ehe 200000: 1 von 2 Einträgen im Index"]);
  assert.deepEqual(b.abweichungen.datum, ["4398583: Liste 1742-10-21, Index 1742-10-31"]);
  assert.equal(b.datiert, 7);
});

test("Aufbau: eine Katalog-ID in zwei Ehen fällt überall weg", () => {
  const x = doc(1);
  const y = doc(2, { kirchgemeinde: "Wetzikon" });
  const z = doc(3, { kirchgemeinde: "Hinwil" });
  const b = buildMehrfach([row("1", x), row("1", y), row("2", y), row("2", z)], new Map([x, y, z].map((d) => [d.id, d])));
  assert.equal(b.ehen.size, 0);
  assert.deepEqual(b.problems.doppelt, ["2 in den Ehen 1, 2"]);
  assert.deepEqual(checkMehrfach(b), ["keine Ehe übrig"]);
});

test("Abbruch bei gregorianisch umgerechneten Daten (RDF statt CSV), nicht bei einzelnen Korrekturen", () => {
  const docs: MehrfachDoc[] = [];
  const pairs: Array<[MehrfachDoc, MehrfachDoc]> = [];
  for (let i = 0; i < 100; i++) {
    const a = doc(1000 + 2 * i, { isoVon: "1650-03-01", isoBis: "1650-03-01" });
    const b = doc(1001 + 2 * i, { kirchgemeinde: "Wetzikon", isoVon: "1650-03-01", isoBis: "1650-03-01" });
    docs.push(a, b);
    pairs.push([a, b]);
  }
  const byId = new Map(docs.map((d) => [d.id, d]));
  // Eine spätere Korrektur der Ehedatenbank (1 von 200 Daten): kein Abbruch.
  const corrected = pairs.flatMap(([a, b], i) => [row(String(i), a, i === 0 ? { Datum: "1650.03.02" } : {}), row(String(i), b)]);
  assert.deepEqual(checkMehrfach(buildMehrfach(corrected, byId)), []);
  // Julianisch 1.3.1650 = gregorianisch 11.3.1650: alle Daten verschoben.
  const shifted = pairs.flatMap(([a, b], i) => [row(String(i), a, { Datum: "1650.03.11" }), row(String(i), b, { Datum: "1650.03.11" })]);
  const built = buildMehrfach(shifted, byId);
  assert.equal(built.ehen.size, 100, "die Ehen selbst passen");
  assert.match(checkMehrfach(built).join(" "), /200 von 200 Daten weichen vom Index ab – gregorianisch/);
});

test("Datei: stabil sortiert, eine Ehe je Zeile, lesbar", () => {
  const a = doc(30, { kirchgemeinde: "Wetzikon" });
  const b = doc(10);
  const c = doc(20, { kirchgemeinde: "Hinwil" });
  const d = doc(40);
  const built = buildMehrfach([row("100", a), row("100", b), row("9", c), row("9", d, { Sicherheitswert: "Probably" })], new Map([a, b, c, d].map((x) => [x.id, x])));
  const data = mehrfachData(built);
  assert.deepEqual(Object.keys(data.ehen), ["9", "100"]);
  assert.deepEqual(data.ehen["100"], [10, 30]);
  assert.deepEqual(data.wahrscheinlich, ["9"]);
  const meta = {
    built: "2026-10-31",
    hash: "x",
    source: { repo: "stazh/sw-ehedaten", path: "p", commit: "c", date: "2022-02-17", rows: 4, marriages: 2 },
    edb: "edb.csv",
    counts: { marriages: 2, entries: 4, probable: 1, distinct: 0 },
  };
  const text = serializeMehrfach({ meta, ...data });
  assert.ok(text.includes('\n    "9": [20,40],\n    "100": [10,30]\n'), text);
  assert.deepEqual((JSON.parse(text) as MehrfachFile).ehen, data.ehen);
  assert.ok(!/—/.test(text), "kein Geviertstrich");
});
