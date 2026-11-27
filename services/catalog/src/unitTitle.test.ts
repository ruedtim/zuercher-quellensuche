import { test } from "node:test";
import assert from "node:assert/strict";
import { labelDateToCatalog, splitPathLabel, unitTitle } from "./unitTitle.ts";
import { parseCatalogDate } from "./dates.ts";
import type { CatalogRecord } from "./types.ts";

// Etiketten in der Form des Archivplans; Namen frei erfunden.

test("Etikett: Signatur, Name, Datum und Stufe trennen", () => {
  assert.deepEqual(splitPathLabel("C X Beispielämter und Vogteien, 1272.09.12-19. Jh. (Bestand)", "Bestand", "C X"), {
    name: "Beispielämter und Vogteien",
    date: "1272.09.12-19. Jh.",
  });
  assert.deepEqual(splitPathLabel("O 211 - O 250 Jahresakten, 1930-1969 (Klasse)", "Klasse", "O 211 - O 250"), {
    name: "Jahresakten",
    date: "1930-1969",
  });
  assert.deepEqual(splitPathLabel("Musterkonferenz MKK, 1969-1991 (Klasse)", "Klasse", null), {
    name: "Musterkonferenz MKK",
    date: "1969-1991",
  });
  // Komma im Namen, offenes Ende, «(ca.)», Klammer im Namen
  assert.deepEqual(splitPathLabel("V I 1.1 - V I 1.9 Baugesetz, Verfügungen, 1959 (Dossier)", "Dossier", "V I 1.1 - V I 1.9"), {
    name: "Baugesetz, Verfügungen",
    date: "1959",
  });
  assert.deepEqual(splitPathLabel("Provenienzarchiv, 19. Jh.- (Hauptabteilung)", "Hauptabteilung", null), {
    name: "Provenienzarchiv",
    date: "19. Jh.-",
  });
  assert.deepEqual(splitPathLabel("PLAN Karten und Pläne, 1600 (ca.)-2016 (Bestand)", "Bestand", "PLAN"), {
    name: "Karten und Pläne",
    date: "1600 (ca.)-2016",
  });
  assert.deepEqual(splitPathLabel("C Y Fragmente (von Einbänden abgelöst), 05. Jh.-1900.12.31 (Bestand)", "Bestand", "C Y"), {
    name: "Fragmente (von Einbänden abgelöst)",
    date: "05. Jh.-1900.12.31",
  });
  // ohne Stufe im Datensatz und ohne Datum
  assert.deepEqual(splitPathLabel("Staatsarchiv Musterhausen (Archiv)", null, null), { name: "Staatsarchiv Musterhausen", date: null });
});

test("Etikett ohne Datum am Ende: Name bleibt ganz", () => {
  assert.deepEqual(splitPathLabel("Akten, 1950-1960, Nachträge (Klasse)", "Klasse", null), {
    name: "Akten, 1950-1960, Nachträge",
    date: null,
  });
});

test("Pfad-Datum → Entstehungszeitraum, den parseCatalogDate liest", () => {
  const cases: Array<[string, string, [number, number]]> = [
    ["1272.09.12-19. Jh.", "12.09.1272 - 19. Jh.", [1272, 1900]],
    ["05. Jh.-1900.12.31", "5. Jh. - 31.12.1900", [401, 1900]],
    ["1600 (ca.)-2016", "ca. 1600 - 2016", [1600, 2016]],
    ["1930-1969", "1930 - 1969", [1930, 1969]],
    ["1953.05", "05.1953", [1953, 1953]],
    ["19. Jh.-", "ab 19. Jh.", [1801, 1900]],
    ["-1900", "bis 1900", [1900, 1900]],
  ];
  for (const [label, catalog, [from, to]] of cases) {
    assert.equal(labelDateToCatalog(label), catalog);
    assert.deepEqual(parseCatalogDate(catalog), { from, to });
  }
});

function rec(over: Partial<CatalogRecord>): CatalogRecord {
  return {
    id: 7,
    url: "https://example.org/detail.aspx?ID=7",
    signature: null,
    title: null,
    level: "Klasse",
    date_text: null,
    parent_id: 1,
    path: [
      { id: 1, label: "Musterabteilung, 1850-2000 (Abteilung)", level: "Abteilung" },
      { id: 7, label: "Musterkonferenz MKK, 1969-1991 (Klasse)", level: "Klasse" },
    ],
    sections: [],
    fields: {},
    ...over,
  };
}

test("unitTitle: Titel vor Name vor Pfad; eigenes Datum vor Pfad-Datum", () => {
  assert.deepEqual(unitTitle(rec({})), { title: "Musterkonferenz MKK", dateText: "1969 - 1991", source: "pfad" });
  const bestand = rec({
    level: "Bestand",
    date_text: "12.09.1272 - 19. Jh.",
    path: [{ id: 7, label: "C X Beispielämter, 1272.09.12-19. Jh. (Bestand)", level: "Bestand" }],
    signature: "C X",
    sections: [{ section: "Identifikation", key: "identifikation", fields: [{ label: "Name", key: "name", text: "Beispielämter", lines: ["Beispielämter"], links: [] }] }],
  });
  assert.deepEqual(unitTitle(bestand), { title: "Beispielämter", dateText: "12.09.1272 - 19. Jh.", source: "name" });
  assert.deepEqual(unitTitle(rec({ title: "Probe, Hans, getraut mit Muster, Anna", level: "Dokument" })).source, "titel");
  // letzte Pfadstufe ist nicht die Einheit selbst: kein Ersatz
  assert.deepEqual(unitTitle(rec({ id: 9 })), { title: "", dateText: "", source: null });
});
