/**
 * Unit-Tests für die Register der Editionen (ausgedachte Einträge im Format der QZH).
 * Lauf: npx tsx --test src/editionRegisters.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRegisters,
  coordsOf,
  datedNameRef,
  displayName,
  gndDisplayName,
  gndLifeDates,
  gndRecordOf,
  isNameRef,
  isPlaceSpelling,
  modernSpelling,
  placeFormsOf,
  sharesNameWord,
} from "./editionRegisters.ts";

const reg = buildRegisters({
  person: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><standOff><listPerson>
    <person xml:id="GND_111"><persName type="full">Hainrich Bullingern, Heinrich Bullinger</persName></person>
    <person xml:id="GND_222"><persName type="full">Ulrich Zwingli</persName></person>
    <person xml:id="QZH_087_252"><persName type="full">Abraham Schoch</persName><source>QZH_087</source></person>
  </listPerson></standOff></TEI>`,
  personAdditions: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><persName ref="GND_111">Bullinger, Heinrich</persName></text></TEI>`,
  place: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><standOff><listPlace>
    <place xml:id="LOC_47.38878_8.04826" n="Arauw, Arow"><placeName type="main">Arauw</placeName><location><geo>47.38878 8.04826</geo></location></place>
    <place xml:id="LOC_47.5_8.7" n="Adlikon bei Andelfingen, Adlicken"><placeName type="main">Adlicken</placeName></place>
  </listPlace></standOff></TEI>`,
  placeAdditions: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><placeName ref="LOC_47.38878_8.04826">Aarau</placeName></text></TEI>`,
});

test("Personen: Normname der Ergänzungen, erste Schreibung, Normname als ref, Form", () => {
  assert.deepEqual(reg.person("Bullingern", "GND_111"), { name: "Heinrich Bullinger", gnd: "111" });
  assert.deepEqual(reg.person("Zwinglin", "GND_222"), { name: "Ulrich Zwingli", gnd: "222" });
  assert.deepEqual(reg.person("Schoch", "QZH_087_252"), { name: "Abraham Schoch", gnd: null });
  assert.deepEqual(reg.person("Kriessj", "Kriesi, Jörg"), { name: "Jörg Kriesi", gnd: null });
  assert.deepEqual(reg.person("Bohq", null), { name: "Bohq", gnd: null });
  assert.deepEqual(reg.person("Unbekannt", "GND_999"), { name: "Unbekannt", gnd: "999" });
});

test("Orte: heutige Form der Ergänzungen, erste Form aus @n, Koordinaten aus Register oder ref", () => {
  assert.deepEqual(reg.place("Arauw", "LOC_47.38878_8.04826"), { name: "Aarau", lat: 47.38878, lon: 8.04826 });
  assert.deepEqual(reg.place("Adlicken", "LOC_47.5_8.7"), { name: "Adlikon bei Andelfingen", lat: 47.5, lon: 8.7 });
  assert.deepEqual(reg.place("Algiers", "LOC_36.73225_3.08746"), { name: "Algiers", lat: 36.73225, lon: 3.08746 });
  assert.deepEqual(reg.place("Bern", null), { name: "Bern", lat: null, lon: null });
});

test("GND: Ergänzungen vor der GND, GND-Name nur wenn plausibel, Lebensjahre bei gleichem Namen", () => {
  const rec = (name: string | null, names: string[] = [], dates: string | null = null) => ({ name, names, dates });
  const withGnd = buildRegisters({
    person: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><standOff><listPerson>
      <person xml:id="GND_111"><persName type="full">Hainrich Bullingern, Heinrich Bullinger</persName></person>
      <person xml:id="GND_333"><persName type="full">dechan, Gwalther</persName></person>
      <person xml:id="GND_444"><persName type="full">Ludwigen Lafatern, Ludwig Lavater</persName></person>
      <person xml:id="GND_555"><persName type="full">durch Nebukadnezar</persName></person>
      <person xml:id="GND_666"><persName type="full">rich Zwingli</persName></person>
      <person xml:id="Donatus"><persName type="full">Karthago, hat Donatus</persName></person>
    </listPerson></standOff></TEI>`,
    personAdditions: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><persName ref="GND_111">Bullinger, Heinrich</persName><persName ref="GND_777">Zwingli, Ulrich</persName></text></TEI>`,
    gndRecords: new Map([
      ["111", rec("Heinrich Bullinger (GND)")],
      ["333", rec("Rudolf Gwalther", ["Gwalther, Rudolf", "Gualtherus, Rodolphus"])],
      ["555", rec("Joachim Neander", ["Neander, Joachim"], "1650–1680")],
      ["666", rec("Ulrich Zwingli", ["Zwingli, Ulrich"], "1556–1601")],
    ]),
  });
  assert.deepEqual(withGnd.person("Bullingern", "GND_111"), { name: "Heinrich Bullinger", gnd: "111" });
  assert.deepEqual(withGnd.person("dechan", "GND_333"), { name: "Rudolf Gwalther", gnd: "333" });
  // Ohne Datensatz (lobid nicht erreichbar, Familie): weiter die erste Schreibung.
  assert.deepEqual(withGnd.person("Ludwigen Lafatern", "GND_444"), { name: "Ludwigen Lafatern", gnd: "444" });
  // Kein Wort gemeinsam: der GND-Verweis der Edition passt nicht, die Schreibung bleibt.
  assert.deepEqual(withGnd.person("durch Nebukadnezar", "GND_555"), { name: "durch Nebukadnezar", gnd: "555" });
  // Gleicher Name wie eine andere GND-Person (Ergänzungen): mit Lebensjahren.
  assert.deepEqual(withGnd.person("rich Zwingli", "GND_666"), { name: "Ulrich Zwingli (1556–1601)", gnd: "666" });
  assert.deepEqual(withGnd.person("Zwingli", "GND_777"), { name: "Ulrich Zwingli", gnd: "777" });
  // Verweis, der selbst ein Name ist, auch ohne Komma – nicht der gleich lautende Eintrag in person.xml.
  assert.deepEqual(withGnd.person("", "Donatus"), { name: "Donatus", gnd: null });
  const r = withGnd.gndReport();
  assert.deepEqual(r.used, [
    ["333", "dechan", "Rudolf Gwalther"],
    ["666", "rich Zwingli", "Ulrich Zwingli (1556–1601)"],
  ]);
  assert.deepEqual(r.rejected, [["555", "durch Nebukadnezar", "Joachim Neander"]]);
});

test("Orte: heutige Schreibung aus dem Ortsverzeichnis, nur wenn sie der ersten ähnelt", () => {
  const known = new Set(["Kyburg", "Egg", "Enge", "Meilen", "Zürich"]);
  const places = buildRegisters({
    place: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><standOff><listPlace>
      <place xml:id="LOC_47.45249_8.7485" n="Kyburch, Kyburg, Kiburg, Kybrug"><placeName type="main">Kiburg</placeName></place>
      <place xml:id="LOC_47.29614_8.50781" n="Bůchenegg, Egg, Buchenegg"/>
      <place xml:id="LOC_47.3605_8.53127" n="Engi, Enge"/>
      <place xml:id="LOC_47.27_8.64" n="Meylen, Meilen, Undermeilen"/>
      <place xml:id="LOC_47.38878_8.04826" n="Arauw, Arow"/>
      <place xml:id="Mähren" n="land"/>
      <place xml:id="Knonau" n="Konouw"/>
      <place xml:id="LOC_47.4789_8.70215" n="Töss, Töss, Kloster, Tösser"><placeName type="main">Töss, Kloster</placeName></place>
    </listPlace></standOff></TEI>`,
    placeAdditions: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><placeName ref="LOC_47.38878_8.04826">Aarau</placeName></text></TEI>`,
    knownPlaces: known,
  });
  assert.equal(places.place("Kyburch", "LOC_47.45249_8.7485").name, "Kyburg");
  assert.equal(places.place("Bůchenegg", "LOC_47.29614_8.50781").name, "Bůchenegg");
  assert.equal(places.place("Engi", "LOC_47.3605_8.53127").name, "Enge");
  assert.equal(places.place("Meylen", "LOC_47.27_8.64").name, "Meilen");
  assert.equal(places.place("Arauw", "LOC_47.38878_8.04826").name, "Aarau");
  // Verweise, die selbst Namen sind: der Name, nicht der Eintrag gleichen Namens («land», «Konouw»).
  assert.equal(places.place("", "Mähren").name, "Mähren");
  assert.equal(places.place("Konouw", "Knonau").name, "Knonau");
  assert.equal(places.place("", "Zürich").name, "Zürich");
  assert.equal(places.place("Töss", "LOC_47.4789_8.70215").name, "Töss");
  assert.deepEqual(places.modernizedPlaces(), [
    ["Engi", "Enge"],
    ["Kyburch", "Kyburg"],
    ["Meylen", "Meilen"],
  ]);
  // Ohne Ortsverzeichnis wie bisher die erste Form.
  assert.equal(buildRegisters({ place: `<TEI><standOff><listPlace><place xml:id="LOC_47.45_8.75" n="Kyburch, Kyburg"/></listPlace></standOff></TEI>` }).place("x", "LOC_47.45_8.75").name, "Kyburch");
});

test("modernSpelling und gndDisplayName", () => {
  const known = new Set(["Greifensee", "Höngg", "Regensberg", "Hirzel"]);
  assert.equal(modernSpelling(["Gryffensee", "Grifense", "Greifensee"], known), "Greifensee");
  assert.equal(modernSpelling(["Hönngg", "Höngg"], known), "Höngg");
  assert.equal(modernSpelling(["Regensperg", "Regensberg"], known), "Regensberg");
  assert.equal(modernSpelling(["Boden", "Hirzel"], known), null);
  assert.equal(modernSpelling(["Hirzel", "Hirtzel"], known), "Hirzel");
  assert.equal(modernSpelling([], known), null);
  assert.equal(gndDisplayName({ preferredNameEntityForThePerson: { forename: ["Rudolf"], surname: ["Gwalther"] } }), "Rudolf Gwalther");
  assert.equal(gndDisplayName({ preferredNameEntityForThePerson: { forename: ["Bernhard"], prefix: ["von"], surname: ["Cham"] } }), "Bernhard von Cham");
  // Einzelname: Beinamen mit Komma wie die GND (in Klammern bliebe für die Schlüssel nur «Paulus»).
  assert.equal(gndDisplayName({ preferredNameEntityForThePerson: { personalName: ["Paulus"], nameAddition: ["Apostel, Heiliger"] } }), "Paulus, Apostel, Heiliger");
  assert.equal(gndDisplayName({ preferredNameEntityForThePerson: { personalName: ["Jakob"], nameAddition: ["Biblische Person"] } }), "Jakob, Biblische Person");
  // Herkunft gehört zum Namen, der Rest in Klammern.
  assert.equal(gndDisplayName({ preferredNameEntityForThePerson: { personalName: ["Nikolaus"], nameAddition: ["von Flüe, Heiliger"] } }), "Nikolaus von Flüe (Heiliger)");
  assert.equal(gndDisplayName({ preferredNameEntityForThePerson: { personalName: ["Hans"], nameAddition: ["von Habsburg-Laufenburg"] } }), "Hans von Habsburg-Laufenburg");
  assert.equal(gndDisplayName({ preferredNameEntityForThePerson: { personalName: ["Leopold"], counting: ["IV."], nameAddition: ["Österreich, Herzog"] } }), "Leopold IV. (Österreich, Herzog)");
  assert.equal(gndDisplayName({ preferredName: "Habsburger, Dynastie : 1200-", type: ["Family"] }), null);
  assert.equal(gndDisplayName(null), null);
  assert.equal(gndLifeDates({ dateOfBirth: ["1556"], dateOfDeath: ["1601"] }), "1556–1601");
  assert.equal(gndLifeDates({ dateOfDeath: ["1680-05-31"] }), "–1680");
  assert.equal(gndLifeDates({}), null);
  assert.deepEqual(gndRecordOf({ preferredName: "Gwalther, Rudolf", variantName: ["Gualtherus, Rodolphus"], preferredNameEntityForThePerson: { forename: ["Rudolf"], surname: ["Gwalther"] }, dateOfBirth: ["1519"], dateOfDeath: ["1586"] }), {
    name: "Rudolf Gwalther",
    names: ["Gwalther, Rudolf", "Gualtherus, Rodolphus"],
    dates: "1519–1586",
  });
  // Plausibilität: gleiches Wort, Wortanfang, ab 4 Zeichen ein Zeichen Abstand; Titel zählen nicht.
  assert.equal(sharesNameWord(["Gwalther, Rudolf"], ["dechan", "Gwalther"]), true);
  assert.equal(sharesNameWord(["Bullinger, Heinrich"], ["Hainrich Bullingern"]), true);
  assert.equal(sharesNameWord(["Neander, Joachim"], ["durch Nebukadnezar"]), false);
  assert.equal(sharesNameWord(["Agatha, Hildegardis, Heilige"], ["sanct Agten", "sant Agatha"]), true);
  assert.equal(sharesNameWord(["Hildegardis, Heilige"], ["sanct Agten"]), false);
  assert.equal(sharesNameWord(["Agatha, Hildegardis"], ["Agten"]), false);
  // Flexionsendungen der Edition («Verenen», «zum Timotheo», «sön Ahrons»).
  assert.equal(sharesNameWord(["Verena, Heilige"], ["Verenen"]), true);
  assert.equal(sharesNameWord(["Timotheus"], ["zum Timotheo"]), true);
  assert.equal(sharesNameWord(["Aaron, Biblische Person"], ["sön Ahrons"]), true);
});

test("Formen eines Ortes und Verweise als Namen", () => {
  assert.equal(isPlaceSpelling("Kyburg", "Kyburch"), true);
  assert.equal(isPlaceSpelling("Fischenthal", "Vischental"), true);
  assert.equal(isPlaceSpelling("Mähren", "land"), false);
  assert.equal(isPlaceSpelling("Wädenswil", "berg"), false);
  assert.deepEqual(placeFormsOf("Töss, Töss, Kloster, Tösser", ["Töss, Kloster"]), ["Töss", "Töss, Kloster", "Tösser"]);
  assert.deepEqual(placeFormsOf("Zürich, Brunngasse 8, Brunngass", ["Zürich, Brunngasse 8"]), ["Zürich, Brunngasse 8", "Brunngass"]);
  assert.deepEqual(placeFormsOf("Kyburch, Kyburg", ["Kiburg"]), ["Kyburch", "Kyburg", "Kiburg"]);
  assert.equal(isNameRef("Kriesi, Jörg"), true);
  assert.equal(isNameRef("Mähren"), true);
  assert.equal(isNameRef("GND_123"), false);
  assert.equal(isNameRef("QZH_087_252"), false);
  assert.equal(isNameRef("LOC_47.1_8.2"), false);
  assert.equal(isNameRef("LOC47.48096_8.20869"), false);
  assert.equal(isNameRef("47.87468_7.65721"), false);
});

test("Hilfen: Namensumkehr und Koordinaten", () => {
  assert.equal(displayName("Kriesi, Jörg"), "Jörg Kriesi");
  assert.equal(displayName("Kambli, Hans (1554-1621)"), "Hans Kambli (1554–1621)");
  assert.equal(displayName("Keller, Rudolf (1576 - 1621)"), "Rudolf Keller (1576–1621)");
  assert.equal(displayName("Meyer-Ott, Hans"), "Hans Meyer-Ott");
  assert.deepEqual(datedNameRef("Bullinger, Heinrich (1504-1575)"), { name: "Heinrich Bullinger", dates: "1504–1575" });
  assert.equal(datedNameRef("Keller, Rudolf (gest. 1565)"), null);
  assert.equal(datedNameRef("Kriesi, Jörg"), null);
  assert.equal(displayName("Escher, N. (Salzhausschreiber)"), "N. Escher (Salzhausschreiber)");
  assert.equal(displayName("Eberli, Heini Uli (identisch mit Ebrecht, Heini Uli?)"), "Heini Uli Eberli (identisch mit Ebrecht, Heini Uli?)");
  assert.equal(displayName("Meyer von Knonau, Hans Heinrich"), "Hans Heinrich Meyer von Knonau");
  assert.equal(displayName("Jesus Christus"), "Jesus Christus");
  assert.equal(displayName("Hedinger, (Hans?)"), "(Hans?) Hedinger");
  assert.deepEqual(coordsOf("LOC_46_2"), { lat: 46, lon: 2 });
  assert.equal(coordsOf("LOC_x"), null);
  assert.equal(coordsOf("LOC_99_200"), null);
});

test("Verweise mit Lebensjahren: gleiche GND-Person ⇒ gleicher Name, sonst Halbgeviertstrich", () => {
  const rec = (name: string, dates: string) => ({ name, names: [], dates });
  const r = buildRegisters({
    person: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><standOff><listPerson>
      <person xml:id="GND_111"><persName type="full">Heinrich Bullinger</persName></person>
      <person xml:id="GND_112"><persName type="full">Heinrich Bullinger</persName></person>
      <person xml:id="GND_143"><persName type="full">Hans Kambli</persName></person>
      <person xml:id="GND_108"><persName type="full">Hans Kambli</persName></person>
    </listPerson></standOff></TEI>`,
    personAdditions: `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><persName ref="GND_111">Bullinger, Heinrich</persName><persName ref="GND_143">Kambli, Hans</persName></text></TEI>`,
    gndRecords: new Map([
      ["111", rec("Heinrich Bullinger", "1504–1575")],
      ["112", rec("Heinrich Bullinger", "1534–1583")],
      ["143", rec("Hans Kambli", "1507–1590")],
      ["108", rec("Hans Kambli", "1554–1624")],
    ]),
  });
  // Der Reformator: Verweis als Name = GND-Person der Ergänzungen, ohne Jahre.
  assert.deepEqual(r.person("", "Bullinger, Heinrich (1504-1575)"), { name: "Heinrich Bullinger", gnd: "111" });
  // Der Sohn: gleicher Name wie über die GND (mit Halbgeviertstrich).
  assert.deepEqual(r.person("", "Bullinger, Heinrich (1534-1583)"), { name: "Heinrich Bullinger (1534–1583)", gnd: "112" });
  assert.deepEqual(r.person("", "GND_112"), { name: "Heinrich Bullinger (1534–1583)", gnd: "112" });
  // Andere Jahre als die GND: eigener Name, nur in den Bericht.
  assert.deepEqual(r.person("", "Kambli, Hans (1554-1621)"), { name: "Hans Kambli (1554–1621)", gnd: null });
  assert.deepEqual(r.person("", "Keller, Rudolf (1576-1621)"), { name: "Rudolf Keller (1576–1621)", gnd: null });
  assert.deepEqual(r.gndReport().dated, [
    ["Bullinger, Heinrich (1504-1575)", "Heinrich Bullinger", "111", []],
    ["Bullinger, Heinrich (1534-1583)", "Heinrich Bullinger (1534–1583)", "112", []],
    ["Kambli, Hans (1554-1621)", "Hans Kambli (1554–1621)", null, ["108 (1554–1624)"]],
    ["Keller, Rudolf (1576-1621)", "Rudolf Keller (1576–1621)", null, []],
  ]);
});
