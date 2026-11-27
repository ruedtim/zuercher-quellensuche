import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHARS, embedText, pathLabel } from "./embedInput.ts";

// Erfundene Einheiten in den Mustern des Archivkatalogs.

const path = [
  { id: 1, label: "Gesundheitswesen, 1803-1990 (Klasse)" },
  { id: 2, label: "S 999 Grippe, 1918-1922 (Dossier)" },
];

test("Sachakten: Titel und Beschreibung, ohne Pfad", () => {
  const t = embedText({
    id: 1,
    title: "Massnahmen gegen die Ausbreitung der Grippe in den Bezirken",
    signature: "S 999.1",
    text: "Enthält u. a. Berichte der Bezirksärzte.",
    path,
  });
  assert.equal(t, "Massnahmen gegen die Ausbreitung der Grippe in den Bezirken\nEnthält u. a. Berichte der Bezirksärzte.");
});

test("kurzer Titel bekommt die zwei nächsten Archivplan-Stufen", () => {
  assert.equal(embedText({ id: 2, title: "Akten", signature: "S 999.2", path }), "Akten\nGesundheitswesen › S 999 Grippe");
  assert.equal(embedText({ id: 3, title: "Akten", signature: "S 999.3" }), "Akten");
});

test("Patente: nur die Erfindung, ohne Anmelder", () => {
  assert.equal(
    embedText({ id: 4, title: "Exempel, Viktor, Dietikon: Verfahren zur Herstellung von Betonpfählen mit versenktem Vortreibrohr", signature: "PAT 3, 66 a, Nr. 1" }),
    "Verfahren zur Herstellung von Betonpfählen mit versenktem Vortreibrohr",
  );
  const kurz = embedText({
    id: 5,
    title: "Probe, Hans, Zürich: Waschbecken",
    signature: "PAT 2, 125 b, Nr. 3",
    path: [{ id: 9, label: "PAT 2, B 9 a Wasserversorgung, 1907.07.04-1954.09.15 (Klasse)" }],
  });
  assert.equal(kurz, "Waschbecken\nPAT 2, B 9 a Wasserversorgung");
});

test("keine Vektoren für Namen, Plattform-Einheiten und Stufen nur aus Pfaden", () => {
  assert.equal(embedText({ id: 6, title: "Beispiel, Wilhelm (geb. 1851), von Riesbach", signature: "U 1.2.3" }), null);
  assert.equal(embedText({ id: 7, title: "SENNEREI OBERDORF-BEISPIEL, Stäfa", signature: "Z 2.1" }), null);
  assert.equal(embedText({ id: 8, title: "Muster, Hans, von Zürich, getraut mit Probe, Anna, von Uster", signature: "E III 1.1, EDB 1" }), null);
  assert.equal(embedText({ id: 9, title: "Eröffnung des Grossen Rathes.", signature: "MM 24.7 KRP 1830/0066", onPlatform: true }), null);
  assert.equal(embedText({ id: 10, title: "Gesundheitswesen", signature: "S", stub: true }), null);
  assert.equal(embedText({ id: 11, title: "", signature: "S 1" }), null);
});

test("lange Texte werden gekürzt", () => {
  const t = embedText({ id: 12, title: "Protokoll", signature: "S 1", text: "x".repeat(5000) });
  assert.equal(t?.length, MAX_CHARS);
});

test("Pfad-Etikett ohne Laufzeit und Stufe", () => {
  assert.equal(pathLabel("Alter Stadtstaat, 09. Jh.- (Hauptabteilung)"), "Alter Stadtstaat");
  assert.equal(pathLabel("Kanton Zürich: Eisenbahnen, 1836 (ca.)-1948.06.20 (Bestand)"), "Kanton Zürich: Eisenbahnen");
  assert.equal(pathLabel("M 14 g.94 Kommissionsprotokolle, 1987-1994 (Klasse)"), "M 14 g.94 Kommissionsprotokolle");
  assert.equal(pathLabel("Wasser- und Brennstoffversorgung"), "Wasser- und Brennstoffversorgung");
});
