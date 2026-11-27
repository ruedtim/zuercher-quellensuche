import { test } from "node:test";
import assert from "node:assert/strict";
import { GivenNameLexicon, inLexicon, lexiconToken, parseTitleEntities, personDisplay } from "./titleSchema.ts";

// Erfundene Namen in den Mustern des Archivkatalogs.

test("Personendossier mit Geburtsjahr, Bürger- und Wohnort", () => {
  const r = parseTitleEntities("Beispiel, Wilhelm (geb. 1851), von Riesbach", "U 1.2.3");
  assert.equal(r.schema, "person");
  assert.deepEqual(r.persons, [{ last: "Beispiel", first: "Wilhelm", born: 1851 }]);
  assert.deepEqual(r.places, ["Riesbach"]);

  const s = parseTitleEntities("Muster-Frei, Alwine (geb. 1864), gewesene Wirtin, von Stettfurt TG, in Adliswil", "Z 1.2");
  assert.deepEqual(s.persons, [{ last: "Muster-Frei", first: "Alwine", born: 1864 }]);
  assert.deepEqual(s.places, ["Stettfurt TG", "Adliswil"]);
});

test("Lebensjahre, geborene, von und in, mehrere Orte", () => {
  const r = parseTitleEntities("Probst, Albertina Bertha, geborene Fiktiv (1858-1938), von Sevelen SG, in Adliswil", "Z 3.4");
  assert.deepEqual(r.persons, [{ last: "Probst", first: "Albertina Bertha", born: 1858, died: 1938, birthName: "Fiktiv" }]);
  assert.deepEqual(r.places, ["Sevelen SG", "Adliswil"]);
  assert.deepEqual(parseTitleEntities("Exempel, Werner (geb. 1928), von Hedingen und Luzern", "U 1").places, ["Hedingen", "Luzern"]);
  assert.deepEqual(parseTitleEntities("Exempel, Johann Rudolf (geb. 1872), von und in Zürich", "Z 5").places, ["Zürich"]);
});

test("Grossbuchstaben-Nachname und Kontext vor dem Namen", () => {
  const a = parseTitleEntities("Ausschreibungsgrund: MUSTERMANN, Martin Johann (geb. 1916), von Diepoldsau SG", "Z 6.1");
  assert.deepEqual(a.persons, [{ last: "Mustermann", first: "Martin Johann", born: 1916 }]);
  const b = parseTitleEntities("Hinterlassenschaft des BEISPIEL-MEIER, Richard (1909-1936), von Zürich", "Z 6.2");
  assert.deepEqual(b.persons, [{ last: "Beispiel-Meier", first: "Richard", born: 1909, died: 1936 }]);
  // Nur ein Ort als Indiz: der Vorname muss im Lexikon stehen.
  assert.equal(parseTitleEntities("FIKTIV, Fridolin (Dietikon)", "Z 10.1").schema, null);
  const c = parseTitleEntities("FIKTIV, Fridolin (Dietikon)", "Z 10.1", { givenNames: new Set(["fridolin"]) });
  assert.deepEqual(c.persons, [{ last: "Fiktiv", first: "Fridolin" }]);
  assert.deepEqual(c.places, ["Dietikon"]);
});

test("Titel nur «Nachname, Vorname»: nur mit bekanntem Vornamen", () => {
  const lex = { givenNames: new Set(["otto", "georg", "hans", "jakob"]) };
  assert.deepEqual(parseTitleEntities("Beispielhuber, Otto", "U 110.3.1", lex).persons, [{ last: "Beispielhuber", first: "Otto" }]);
  assert.equal(parseTitleEntities("Beispielhuber, Otto", "U 110.3.1").schema, null);
  assert.equal(parseTitleEntities("Zürichsee, Horgen", "Z 740.1", lex).schema, null);
  assert.equal(parseTitleEntities("Hittnau, Dürstelen", "W I 90.1", lex).schema, null);
  const g = parseTitleEntities("Probe, Hans, in Hirzel, gegen Muster, Jakob, in Hirzel", "Z 206.1", lex);
  assert.deepEqual(g.persons.map(personDisplay), ["Hans Probe", "Jakob Muster"]);
  const h = parseTitleEntities("Probe, Hans, in Hirzel, und Fiktiv-Meier, Otto, in Hirzel, gegen Muster, Jakob, in Hirzel", "Z 206.2", lex);
  assert.deepEqual(h.persons.map(personDisplay), ["Hans Probe", "Otto Fiktiv-Meier", "Jakob Muster"]);
});

test("Todesjahr «(gest. …)» ist ein starkes Indiz", () => {
  const r = parseTitleEntities("Beispiel, Alfred Emil (gest. 1890), Postcommis, von Gossau, in Zürich", "Z 666.1");
  assert.deepEqual(r.persons, [{ last: "Beispiel", first: "Alfred Emil", died: 1890 }]);
  assert.deepEqual(r.places, ["Gossau", "Zürich"]);
});

test("Firmen in Grossbuchstaben und mit Rechtsform", () => {
  const a = parseTitleEntities("SENNEREI OBERDORF-BEISPIEL, Stäfa", "Z 2.1");
  assert.equal(a.schema, "firm");
  assert.deepEqual(a.organizations, ["Sennerei Oberdorf-Beispiel"]);
  assert.deepEqual(a.places, ["Stäfa"]);
  const b = parseTitleEntities("Weberei Musterthal AG, Baumwollweberei und Handel mit Geweben, in Bauma", "Z 292.1");
  assert.deepEqual(b.organizations, ["Weberei Musterthal AG"]);
  assert.deepEqual(b.places, ["Bauma"]);
  assert.deepEqual(parseTitleEntities("KRANKENKASSE DER KIRCHGEMEINDE MUSTERDORF, Seen", "Z 2.2").organizations, ["Krankenkasse der Kirchgemeinde Musterdorf"]);
  assert.deepEqual(parseTitleEntities("STAHLWARENFABRIK BEISPIEL AG, Zürich", "Z 2.3").organizations, ["Stahlwarenfabrik Beispiel AG"]);
  assert.deepEqual(
    parseTitleEntities("VERBAND DER FUHRHALTER-, PFERDE- UND LASTWAGENBESITZER, Zürich", "Z 2.4").organizations,
    ["Verband der Fuhrhalter-, Pferde- und Lastwagenbesitzer"],
  );
  assert.equal(parseTitleEntities("Statuten der Gesellschaft der Musterleute", "STAT 1").schema, null);
  assert.equal(parseTitleEntities("Pläne zum Geschäftsprotokoll A Uster NW, Bd. 4", "Z 559.1").schema, null);
});

test("zweite Person «und Vorname Nachname» nur mit bekanntem Vornamen", () => {
  const lex = { givenNames: new Set(["maria"]) };
  const title = "PROBE, Rudolf (geb. 1838), von Rüti, in Aussersihl, Postknabe, und Maria Testerin, geborene X";
  assert.deepEqual(parseTitleEntities(title, "Y 60.1", lex).persons.map(personDisplay), ["Rudolf Probe", "Maria Testerin"]);
  // Ohne Lexikon (erster Durchlauf des Aufbaus) keine zweite Person.
  assert.deepEqual(parseTitleEntities(title, "Y 60.1").persons.map(personDisplay), ["Rudolf Probe"]);
  // Behörde statt Person: «Bezirksrat» ist kein Vorname, auch wenn das Lexikon ihn führt.
  const rat = "Muster, Fritz (geb. 1890), von Musterwil, gegen Armenpflege Musterwil, in Musterwil, und Bezirksrat Beispielhausen, in Beispielhausen";
  for (const givenNames of [lex.givenNames, new Set(["maria", "bezirksrat", "armenpflege"])]) {
    assert.deepEqual(parseTitleEntities(rat, "Z 1.1", { givenNames }).persons.map(personDisplay), ["Fritz Muster"]);
  }
  // Verwandtschaftswort vor dem Namen.
  const gattin = parseTitleEntities("Probe, Georg (geb. 1894), Kaufmann, und Gattin Maria Probe, geborene Muster (geb. 1902)", "Z 43.1", lex);
  assert.deepEqual(gattin.persons.map(personDisplay), ["Georg Probe", "Maria Probe"]);
});

test("Anreden und Titel vor dem Vornamen zählen nicht für das Lexikon", () => {
  const lex = { givenNames: new Set(["anna", "hans"]) };
  assert.deepEqual(parseTitleEntities("Muster, Frau Anna, in Uster", "Z 43.2", lex).persons.map(personDisplay), ["Frau Anna Muster"]);
  assert.deepEqual(parseTitleEntities("Muster, Dr. Hans, in Uster", "Z 43.3", lex).persons.map(personDisplay), ["Dr. Hans Muster"]);
  // Nur Anrede oder Titel: eine Person ohne Vornamen (ohne Schlüssel); die Gegenpartei bleibt.
  // Ohne Lexikon (NER-Auswahl) wie bisher kein Schema.
  assert.deepEqual(parseTitleEntities("Muster, Frau, in Uster", "Z 43.4", lex).persons, [{ last: "Muster", first: "Frau" }]);
  const arzt = parseTitleEntities("Muster, Dr. med., in Horgen, gegen Probe, Hans, in Hirzel", "Z 43.5", lex);
  assert.deepEqual(arzt.persons.map(personDisplay), ["Dr. Muster", "Hans Probe"]);
  assert.equal(parseTitleEntities("Muster, Dr. med., in Horgen, gegen Probe, Hans, in Hirzel", "Z 43.5").schema, null);
  // Ein Amt oder «Herr» an dieser Stelle beginnt ein Urkunden-Regest, kein Dossier.
  assert.equal(parseTitleEntities("Hans von Musterwil, Ritter, Burgermeister, und der Rat von Basel verkaufen", "C I, Nr. 1", lex).schema, null);
  assert.equal(parseTitleEntities("Johans, Herr von Musterberg, bestätigt dem Kloster Kappel", "C II 4, Nr. 1", lex).schema, null);
  assert.ok(inLexicon("H. Hans", lex.givenNames) && inLexicon("Frau Anna", lex.givenNames));
  assert.ok(!inLexicon("Bezirksrat", new Set(["bezirksrat"])) && !inLexicon("Frau Dr.", new Set(["frau", "dr"])));
});

test("Lexikon-Token: ohne Satzzeichen, Initialen, Partikeln, Anreden, Ämter und Verwandtschaft", () => {
  for (const [tok, want] of [
    ["Hans", "hans"],
    ["Joh.", "joh"],
    ["Anna-Maria", "anna-maria"],
    ["(Peter", "peter"],
    ['"Kuno"', "kuno"],
    ["Paul)", "paul"],
    ["(Hansi)", "hansi"],
  ] as const) {
    assert.equal(lexiconToken(tok), want, tok);
  }
  for (const tok of ["H.", "H", "Bezirksrat", "Frau", "Dr.", "Prof.", "De", "von", "Gattin", "Ehefrau", "Sohn", "Hans2", "Ha(n)s", "&"]) {
    assert.equal(lexiconToken(tok), null, tok);
  }
});

test("Vornamen-Lexikon: Titelpersonen ab drei Belegen, KRDB immer, ohne Rollenwörter", () => {
  const lex = new GivenNameLexicon();
  for (const first of ["Hans Jakob", "Hans", "Hans", "Frau Anna", "Frau Berta", "Frau Clara", "Dr.", "Dr.", "Dr.", "Bezirksrat", "Bezirksrat", "Bezirksrat"]) {
    lex.addTitlePerson(first);
  }
  lex.addKrdb('Konrad "Kuno"');
  lex.addKrdb("Hans (Peter Paul)");
  lex.addKrdb("Joh.");
  assert.deepEqual([...lex.build(3)].sort(), ["hans", "konrad", "kuno", "paul", "peter"]);
});

test("ohne Indiz keine Person", () => {
  assert.equal(parseTitleEntities("Akten, Protokolle", "Z 1").schema, null);
  assert.equal(parseTitleEntities("Reden, Ansprachen und Produktionen", "W I 5").schema, null);
  assert.equal(parseTitleEntities("Kyburg: Sennschür mit Chuehalden", "PLAN P 1").schema, null);
});

test("Ehedatenbank", () => {
  const r = parseTitleEntities("Muster, Hans, Mühlebach, getraut mit Beispiel, Anna, Waldsberg", "E III 41.5, EDB 1");
  assert.equal(r.schema, "ehe");
  assert.deepEqual(r.persons.map(personDisplay), ["Hans Muster", "Anna Beispiel"]);
  assert.deepEqual(r.places, ["Mühlebach", "Waldsberg"]);
  assert.deepEqual(
    parseTitleEntities("Fiktiv, Hans Konrad, getraut mit Probe, Anna Elisabeth, Enge", "TAI 1.708").persons.map(personDisplay),
    ["Hans Konrad Fiktiv", "Anna Elisabeth Probe"],
  );
});

test("Patentschriften: Personen und Firmen", () => {
  const p = parseTitleEntities("Exempel, Viktor, Dietikon: Gerät zum Stechen von Tieren", "PAT 3, 66 a, 10, Nr. 1");
  assert.equal(p.schema, "patent");
  assert.deepEqual(p.persons.map(personDisplay), ["Viktor Exempel"]);
  assert.deepEqual(p.places, ["Dietikon"]);
  const f = parseTitleEntities("C. Muster und Co., Zürich, und Probe, Robert, Zürich: Lenkbare Spielzeugfigur", "PAT 3, 77 f, Nr. 2");
  assert.deepEqual(f.organizations, ["C. Muster und Co."]);
  assert.deepEqual(f.persons.map(personDisplay), ["Robert Probe"]);
  const g = parseTitleEntities("XYZ, Gesellschaft zur Förderung der Forschung, Zürich: Reibdichtung", "PAT 3, 1");
  assert.deepEqual(g.organizations, ["XYZ, Gesellschaft zur Förderung der Forschung"]);
  assert.deepEqual(g.places, ["Zürich"]);
  const h = parseTitleEntities("Fiktivi, Franz, und Probe, Hans, Zürich: Verschluss an Tuben", "PAT 2, 125 b, Nr. 3");
  assert.deepEqual(h.persons.map(personDisplay), ["Franz Fiktivi", "Hans Probe"]);
  assert.deepEqual(h.organizations, []);
  const i = parseTitleEntities("Beispiel, Tihamer, Dr. ing., Zürich: Bauelement für Faltdächer", "PAT 3, 37 b, Nr. 4");
  assert.deepEqual(i.persons.map(personDisplay), ["Tihamer Beispiel"]);
  assert.deepEqual(i.places, ["Zürich"]);
});

test("nur die erste Titelzeile", () => {
  const r = parseTitleEntities("Beispiel, Gustav (geb. 1939), Treuhändler\nSVP, Kantonsrat 1975-1978", "Z 1114.1");
  assert.deepEqual(r.persons, [{ last: "Beispiel", first: "Gustav", born: 1939 }]);
});

test("Firmenwort in Sätzen und Ortsangaben macht keine Firma", () => {
  const urkunde = parseTitleEntities(
    "Präsident und Mitglieder des Zürcher Regierungsrates danken für die erfolgte Errichtung der Muster-Stiftung durch Jgfr. Anna Muster von Herrliberg, wohnhaft in Uetikon, und ihren Bruder. Original, mit Siegel in Metallkapsel.",
    "C I, Nr. 1",
  );
  assert.equal(urkunde.schema, null);
  assert.deepEqual(urkunde.places, []);
  assert.equal(parseTitleEntities("Wiesenstrasse 24: Lager und Reklametafeln der Firma Muster, Zürich", "Z 1.1").schema, null);
  assert.equal(parseTitleEntities("Weberei Musterthal AG, Baumwollweberei, in Bauma", "Z 292.1").schema, "firm");
});
