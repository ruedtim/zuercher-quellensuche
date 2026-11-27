import { test } from "node:test";
import { strict as assert } from "node:assert";
import { loadRmNames, rmOrgClass, rmOrgName, rmPersonName, rmPlaceKey, rmPlaceName, rmPlacesInSpan } from "./rmNames.ts";

// Golden-Fälle aus den Stichproben der Auswertung (docs/ratsmanuale-namen-auswertung.md), gegen
// die committeten Tabellen (rmNames.data.json).
const idx = loadRmNames();

test("RM-Namen: Tabellen geladen und plausibel gross", () => {
  assert.ok(idx.places.size > 500, `places ${idx.places.size}`);
  assert.ok(idx.surnames.size > 10_000, `surnames ${idx.surnames.size}`);
  assert.ok(idx.von.has("von cham") && idx.von.has("von muralt"));
  assert.ok(!idx.von.has("von daselbst") && !idx.von.has("von horgen"));
});

test("RM-Namen: Personen – Ämter, Herkunft, Flexion und Schreibung weg", () => {
  const cases: Array<[string, string | null]> = [
    ["Burgermeister Hanß Conrad Eschern zu Kyburg", "Hans Konrad Escher"],
    ["Burger Meister Joh Caspar Escher", "Johann Kaspar Escher"],
    ["Hanns Cunrat Escher", "Hans Konrad Escher"],
    ["M. Heinrich Bullingern", "Heinrich Bullinger"],
    ["Heinrichen Bullingers Pfarrers zu S. Petter", "Heinrich Bullinger"],
    ["Rathsherr und alt Landvogt Salomon Hirzel", "Salomon Hirzel"],
    ["Pfleger Melchior von Muralt", "Melchior von Muralt"],
    ["Hans von Cham", "Hans von Cham"],
    ["Johan̄ Baltoser Schiffer, Schneider aus dem Würtenberg", "Johann Baltoser Schiffer"],
    ["Mr: Heinrich Groben sel. gewesenen wächters bey dem Augustyner-Thärli", "Heinrich Grob"],
    ["Kilchenpfleger Jacob Manzen von", "Jakob Manz"],
    ["Leüt. Bernhard Brämen", "Bernhard Bräm"],
    ["Hs: Jacob Schmid", "Hans Jakob Schmid"],
    ["Jacoben Kleiner wyber zu gelt", "Jakob Kleiner"],
    ["Uli Suters seligen", "Ulrich Suter"],
    ["Felix Huber von dielstorff", "Felix Huber"],
    // Frauenform und Schreibvarianten des Nachnamens
    ["Elsbetha Greblin", "Elisabeth Grebel"],
    ["Rathsherr Hans Conrad Wertmüller", "Hans Konrad Werdmüller"],
    ["Georg Hirtzel", "Georg Hirzel"],
    // nicht in die Felder: Nachname allein, Vorname allein, Fehltreffer, kein Vorname
    ["Burgermeister Escher", null],
    ["Steinbruchmeister Schmid von Richtischwyl", null],
    ["Jacob", null],
    ["hab", null],
    ["B. hab", null],
    ["Herr", null],
    ["Venationischen Residen ten Cale Sarotti", null],
    ["Jkr. Raths-Substitut Zoller aus frauwenfeld", null],
  ];
  for (const [form, want] of cases) assert.equal(rmPersonName(form, idx), want, form);
});

test("RM-Namen: Orte aus dem Ortsverzeichnis, heutiger Name", () => {
  const cases: Array<[string, string | null]> = [
    ["Wädenschweil", "Wädenswil"],
    ["Wedenschwyl", "Wädenswil"],
    ["Costantz", "Konstanz"],
    ["Constanz", "Konstanz"],
    ["Costenntz", "Konstanz"],
    ["Lauwis", "Lugano"],
    ["Grafschafft Kyburg", "Kyburg"],
    ["in der Grafschafft Kyburg", "Kyburg"],
    ["Landvogteyamt Kyburg", "Kyburg"],
    ["Kybung", "Kyburg"],
    ["Eglisauw", "Eglisau"],
    ["Schaffhausen in LeütschLand", "Schaffhausen"],
    ["Öttenbach", "Ötenbach"],
    ["Ottenbach", "Ottenbach"],
    ["Schweitz", "Schwyz"],
    ["Engi", "Enge"],
    ["Werdenberg", "Werdenberg"],
    ["Wirtenberg", "Württemberg"],
    ["Rotwyl", "Rottweil"],
    ["Stein am Rhyn", "Stein am Rhein"],
    ["Herrliberg", "Herrliberg"],
    ["Wyl", "Wil"],
    ["Wald", "Wald"],
    // Gattungswörter, Kleinschreibung, mehrdeutige Familiennamen
    ["Rathhuß", null],
    ["Statt", null],
    ["wyl", null],
    ["wald", null],
    ["Hirzel", null],
  ];
  for (const [form, want] of cases) assert.equal(rmPlaceName(form, idx), want, form);
  assert.equal(rmPlaceKey("Herrschafft Wädischwyl"), "wadiswil");
});

test("RM-Namen: Orte in Personen- und Amts-Spans", () => {
  assert.deepEqual(rmPlacesInSpan("Landtvogt Eschers zue Kyburg", "pers", idx), ["Kyburg"]);
  assert.deepEqual(rmPlacesInSpan("Hans Müller von Wädenschwyl", "pers", idx), ["Wädenswil"]);
  assert.deepEqual(rmPlacesInSpan("Landvogteyamt Kyburg", "org", idx), ["Kyburg"]);
  // Familienname mit Partikel, Ort als Familienname
  assert.deepEqual(rmPlacesInSpan("Hans von Cham", "pers", idx), []);
  assert.deepEqual(rmPlacesInSpan("Heinrich Uster", "pers", idx), []);
});

test("RM-Namen: Organisationen kuratiert, die Räte nicht in die Facette", () => {
  assert.deepEqual(rmOrgClass("beid Reth"), { kind: "rat", name: "Kleiner Rat" });
  assert.deepEqual(rmOrgClass("Räth und Burger"), { kind: "rat", name: "Grosser Rat" });
  assert.deepEqual(rmOrgClass("Geheime Räth"), { kind: "rat", name: "Geheimer Rat" });
  assert.equal(rmOrgName("beid Reth"), null);
  assert.equal(rmOrgName("Sekelam̅t"), "Seckelamt");
  assert.equal(rmOrgName("Ehegricht"), "Ehegericht");
  assert.equal(rmOrgName("Stattgricht"), "Stadtgericht");
  assert.equal(rmOrgName("Zunfft zum weggen"), "Zunft zur Weggen");
  assert.equal(rmOrgName("Ehren Com̅ißion"), "Ehrenkommission");
  assert.equal(rmOrgName("Kauffman̄ischen Directorio"), "Kaufmännisches Direktorium");
  assert.equal(rmOrgName("Zünfften"), null);
});
