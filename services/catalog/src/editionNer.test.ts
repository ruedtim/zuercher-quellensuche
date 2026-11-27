/**
 * Unit-Tests für die NER-Schnittstelle der Editionen (editionNer.ts). Ausgedachte Texte.
 * Lauf: npx tsx --test src/editionNer.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmNamesIndex, rmPlaceKey } from "../../indexer/src/rmNames.ts";
import { addNerEval, nerEntitiesFor, nerEvalReport, nerForm, nerInputOf, newNerEval, parseNerLine, textHash } from "./editionNer.ts";

// Kleines Ortsverzeichnis statt der Tabellen des Bestands (rmNames.data.json).
const IDX = rmNamesIndex({ version: 1, places: { [rmPlaceKey("Musterdorf")]: "Musterdorf" }, surnames: { probe: "Probe", proben: "Probe" }, vonSurnames: [] });

test("Eingabe: Lesefassung mit Prüfsumme und Kennzeichen «ausgezeichnet»", () => {
  const tei = { text: "Hans Probe von Musterdorf", persons: [], places: [], orgs: [] };
  const i = nerInputOf("ssrq-SSRQ_ZH_NF_II_3_007", "ssrq", tei);
  assert.equal(i.marked, false);
  assert.equal(i.hash, textHash("Hans Probe von Musterdorf"));
  assert.equal(nerInputOf("x", "qzh", { ...tei, persons: [{ form: "Hans", ref: null }] }).marked, true);
});

test("Ausgabe: Zeilen prüfen, kaputte und unbekannte Spans verwerfen", () => {
  const r = parseNerLine(JSON.stringify({ id: "a", hash: "h", spans: [["PER", 0, 10, "Hans Probe"], ["DATE", 0, 4, "1530"], ["LOC", 5, 3, "x"]] }));
  assert.deepEqual(r?.spans, [["PER", 0, 10, "Hans Probe"]]);
  assert.equal(parseNerLine("{abgeschnitten"), null);
  assert.equal(parseNerLine(JSON.stringify({ id: "a" })), null);
});

test("Namen aus dem NER nur zum selben Text, vereinheitlicht wie bei den Ratsmanualen", () => {
  const entry = {
    id: "a",
    hash: "h1",
    spans: [
      ["PER", 0, 11, "Hans Probe,"],
      ["PER", 20, 30, "Hanß Proben"],
      ["PER", 0, 5, "Probe"],
      ["PER", 40, 70, "Heini Muster von Musterdorf"],
      ["LOC", 31, 41, "Musterdorff"],
      ["LOC", 50, 55, "Irgendwo"],
      ["ORG", 0, 3, "beid Räth"],
      ["ORG", 4, 14, "Seckelamt"],
      ["PER", 0, 1, "H."],
    ] as Array<["PER" | "LOC" | "ORG", number, number, string]>,
  };
  assert.equal(nerEntitiesFor(entry, "anders", IDX), null);
  const e = nerEntitiesFor(entry, "h1", IDX);
  // Flexion (Tabelle des Bestands) und Vornamen angeglichen («Heini» = Heinrich), Nachname allein fällt weg.
  assert.deepEqual(
    e?.persons.map((p) => [p.name, p.count]),
    [
      ["Hans Probe", 2],
      ["Heinrich Muster", 1],
    ],
  );
  assert.deepEqual(e?.persons[0].forms, ["Hans Probe", "Hanß Proben"]);
  // Orte nur aus dem Ortsverzeichnis, auch nach «von» im Personen-Span; die Räte nicht.
  assert.deepEqual(
    e?.places.map((p) => [p.name, p.count, p.forms]),
    [["Musterdorf", 2, ["Musterdorff"]]],
  );
  assert.deepEqual(e?.orgs, ["Seckelamt"]);
  assert.equal(nerForm(" «Uli» "), "Uli");
  assert.equal(nerForm("H."), "");
});

test("Vergleich mit der Auszeichnung: gefunden und bestätigt als Mehrfachmengen", () => {
  const ev = newNerEval();
  const entry = { id: "a", hash: "h", spans: [["PER", 0, 4, "Hans"], ["PER", 5, 9, "hans"], ["PER", 10, 13, "Uli"], ["LOC", 0, 4, "Rüti"]] as Array<["PER" | "LOC" | "ORG", number, number, string]> };
  addNerEval(ev, { PER: ["Hans", "Heini"], LOC: ["Rüti"], ORG: ["Rat"] }, entry, "h", undefined, IDX);
  addNerEval(ev, { PER: ["Hans"], LOC: [], ORG: [] }, undefined, "h", undefined, IDX);
  assert.equal(ev.pieces, 1);
  assert.equal(ev.missing, 1);
  assert.deepEqual(ev.byLabel.PER, { edition: 2, found: 1, ner: 3, confirmed: 1 });
  assert.deepEqual(ev.byLabel.LOC, { edition: 1, found: 1, ner: 1, confirmed: 1 });
  assert.deepEqual(ev.byLabel.ORG, { edition: 1, found: 0, ner: 0, confirmed: 0 });
  assert.match(nerEvalReport(ev, "spans.jsonl").join("\n"), /\| Personen \| 2 \| 1 \(50\.0 %\) \| 3 \| 1 \(33\.3 %\) \|/);
  assert.match(nerEvalReport(ev, null).join("\n"), /nicht gelesen/);
});

test("Vergleich der vereinheitlichten Namen mit dem Register des Stücks", () => {
  const ev = newNerEval();
  const entry = { id: "a", hash: "h", spans: [["PER", 0, 10, "Hanß Proben"], ["PER", 11, 20, "Uli Anders"], ["LOC", 21, 31, "Musterdorf"]] as Array<["PER" | "LOC" | "ORG", number, number, string]> };
  addNerEval(ev, { PER: [], LOC: [], ORG: [] }, entry, "h", { PER: ["Hans Probe", "Heini Muster"], LOC: ["Musterdorf"], ORG: ["Rat"] }, IDX);
  assert.deepEqual(ev.names.PER, { edition: 2, found: 1, ner: 2, confirmed: 1 });
  assert.deepEqual(ev.names.LOC, { edition: 1, found: 1, ner: 1, confirmed: 1 });
  assert.deepEqual(ev.names.ORG, { edition: 1, found: 0, ner: 0, confirmed: 0 });
  assert.match(nerEvalReport(ev, "spans.jsonl").join("\n"), /\| Personen \| 2 \| 1 \(50\.0 %\) \| 2 \| 1 \(50\.0 %\) \|/);
});
