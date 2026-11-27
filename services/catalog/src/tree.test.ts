import { test } from "node:test";
import assert from "node:assert/strict";
import { ArchiveTree, naturalSortKey, SiblingOrder, siblingSortKey, stubDoc, stubRecord } from "./tree.ts";
import type { CatalogPathNode, CatalogRecord } from "./types.ts";

// Archivplan frei erfunden.

const ROOT: CatalogPathNode = { id: 1, label: "Musterarchiv (Archiv)", level: "Archiv" };
const ABT: CatalogPathNode = { id: 10, label: "X Musterabteilung, 1803- (Abteilung)", level: "Abteilung" };
const BESTAND: CatalogPathNode = { id: 20, label: "X 1 - X 9 Musterbestand, 1850-1950 (Bestand)", level: "Bestand" };
const KLASSE: CatalogPathNode = { id: 30, label: "X 1.2 Jahresakten, 1900-1910 (Klasse)", level: "Klasse" };

function unit(id: number, path: CatalogPathNode[]): CatalogRecord {
  const self = { id, label: `X 1.2.${id} Akte, 1901 (Dossier)`, level: "Dossier" };
  return {
    id,
    url: "",
    signature: `X 1.2.${id}`,
    title: "Akte",
    level: "Dossier",
    date_text: "1901",
    parent_id: path.at(-1)?.id ?? null,
    path: [...path, self],
    sections: [],
    fields: {},
  };
}

test("Kinder und Stufen, die nur aus Pfaden bekannt sind", () => {
  const tree = new ArchiveTree();
  tree.add(unit(101, [ROOT, ABT, BESTAND, KLASSE]));
  tree.add(unit(102, [ROOT, ABT, BESTAND, KLASSE]));
  // Die Abteilung selbst ist gecrawlt: kein Stub mehr, auch wenn sie später kommt.
  tree.add({ id: 10, url: "", signature: "X", title: null, level: "Abteilung", date_text: null, parent_id: 1, path: [ROOT, ABT], sections: [], fields: {} });
  assert.equal(tree.childCount(30), 2);
  assert.equal(tree.childCount(20), 1);
  assert.equal(tree.childCount(1), 1);
  assert.equal(tree.childCount(101), 0);
  assert.deepEqual(
    tree.stubs().map((s) => [s.id, s.path.map((n) => n.id)]),
    [
      [1, [1]],
      [20, [1, 10, 20]],
      [30, [1, 10, 20, 30]],
    ],
  );
});

test("Stub-Dokument: Titel und Datum aus dem Etikett, ohne onPlatform", () => {
  const order = new SiblingOrder();
  order.add(stubRecord(30, [ROOT, ABT, BESTAND, KLASSE]));
  order.add({ ...unit(31, [ROOT, ABT, BESTAND]), signature: "X 1.1" });
  order.finish();
  const doc = stubDoc(30, [ROOT, ABT, BESTAND, KLASSE], 2, order);
  assert.deepEqual(doc, {
    id: 30,
    signature: "",
    title: "X 1.2 Jahresakten",
    level: "Klasse",
    dateText: "1900 - 1910",
    dateFrom: 1900,
    dateTo: 1910,
    path: [
      { id: 10, label: ABT.label },
      { id: 20, label: BESTAND.label },
    ],
    bestand: BESTAND.label,
    parentId: 20,
    hasDigitization: false,
    url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=30",
    sigSort: naturalSortKey("X 1.2 Jahresakten"),
    sigPos: 2,
    childCount: 2,
    stub: true,
  });
  assert.equal("onPlatform" in doc, false);
});

test("Position unter Geschwistern: Reihenfolge von sigSort, Gleichstände nach ID", () => {
  const order = new SiblingOrder();
  const klasse = [ROOT, ABT, BESTAND, KLASSE];
  const twin = (id: number) => ({ ...unit(id, klasse), signature: "X 1.2.3", title: "Akte" });
  for (const rec of [unit(102, klasse), twin(205), unit(101, klasse), twin(204), unit(103, [ROOT, ABT, BESTAND])]) order.add(rec);
  order.add(stubRecord(1, [ROOT]));
  order.finish();
  const key = (id: number) => siblingSortKey(id >= 204 ? "X 1.2.3" : `X 1.2.${id}`, "Akte");
  const placed = Object.fromEntries([101, 102, 103, 204, 205, 1].map((id) => [id, order.place(id, key(id))]));

  // X 1.2.3 (zweimal) vor X 1.2.101 vor X 1.2.102; eigene Zählung je Stufe.
  assert.deepEqual([204, 205, 101, 102].map((id) => placed[id].sigPos), [1, 2, 3, 4]);
  assert.equal(placed[103].sigPos, 1);
  assert.equal(placed[1].sigPos, 1, "Wurzel: Stufe ohne Eltern");
  assert.equal(order.place(999, "x").sigPos, 0, "nie hinzugefügt");
  // Nur die Zwillinge bekommen die ID angehängt; so sortiert Meili wie die Position.
  assert.equal(placed[101].sigSort, key(101));
  assert.equal(placed[204].sigSort, `${key(204)} 0000000204`);
  assert.equal(order.ties, 2);
  const meili = [101, 102, 204, 205].sort((a, b) => (placed[a].sigSort < placed[b].sigSort ? -1 : 1));
  assert.deepEqual(meili, [204, 205, 101, 102]);
  // Lange Schlüssel bleiben mit ID innerhalb der Länge, die Meili sortiert.
  const long = new SiblingOrder();
  for (const id of [7, 8]) long.add({ ...unit(id, klasse), signature: "", title: "Akte ".repeat(60) });
  long.finish();
  const longKey = long.place(7, siblingSortKey("", "Akte ".repeat(60))).sigSort;
  assert.ok(longKey.length <= 160 && longKey.endsWith(" 0000000007"));
});

test("Sortierschlüssel: Zahlen aufgefüllt, römische Zahlen nach dem ersten Glied", () => {
  const sorted = (xs: string[]) => [...xs].sort((a, b) => (naturalSortKey(a) < naturalSortKey(b) ? -1 : 1));
  assert.deepEqual(sorted(["X 1.10", "X 1.9", "X 1.2.3", "X 1.2"]), ["X 1.2", "X 1.2.3", "X 1.9", "X 1.10"]);
  assert.deepEqual(sorted(["B X", "B IX", "B V", "B II", "B IV"]), ["B II", "B IV", "B V", "B IX", "B X"]);
  // «C» ist als erstes Glied die Abteilung, keine 100.
  assert.deepEqual(sorted(["D I", "C VI 1", "C II"]), ["C II", "C VI 1", "D I"]);
  assert.deepEqual(sorted(["X 1, Nr. 7", "[X 1, Nr. 53]", "X 1, Nr. 2"]), ["X 1, Nr. 2", "X 1, Nr. 7", "[X 1, Nr. 53]"]);
  assert.equal(naturalSortKey("Älteste  Akten"), "alteste akten");
  assert.ok(naturalSortKey("A ".repeat(200)).length <= 160);
});

test("Geschwister mit und ohne Signatur sortieren gemeinsam", () => {
  // Gecrawlte Einheit: Signatur getrennt; Stufe aus dem Pfad: Signatur im Titel.
  assert.equal(siblingSortKey("X 1.2", "Jahresakten"), siblingSortKey(null, "X 1.2 Jahresakten"));
  assert.ok(siblingSortKey("X 1.2", "Jahresakten") < siblingSortKey("", "X 1.10 Weitere Akten"));
});
