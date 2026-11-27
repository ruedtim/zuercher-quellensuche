/**
 * Unit-Tests für die Register der Zürcher Rechtsquellen. Nur ausgedachte Einträge im Format von
 * stazh/erqzh-data. Lauf: npx tsx --test src/ssrqRegisters.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSsrqRegisters, ssrqGeo, ssrqOrgName } from "./ssrqRegisters.ts";

const wrap = (list: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader/><standOff><${list}>${body}</${list}></standOff></TEI>`;

const person = wrap(
  "listPerson",
  `<person xml:id="per000001"><persName type="full">Erika Muster</persName><persName type="full_sorted">Muster, Erika</persName><note type="date">1490-1550</note></person>
   <person xml:id="per000002"><persName type="full">Hans Probe</persName><persName type="full_sorted">Probe, Hans</persName><note type="date">1529</note></person>
   <person xml:id="per000003"><persName type="full">Hans Probe</persName><persName type="full_sorted">Probe, Hans</persName><note type="date">1601</note></person>
   <person xml:id="per000004"><persName type="full">Martin (Heilige und biblische Gestalten)</persName><note type="date">11.11.</note></person>
   <person xml:id="per000005"><persName type="full">Uli Probe</persName><note type="date">1441-26.03.1492</note></person>
   <person xml:id="per000006"><persName type="full">Uli Probe</persName><note type="date">1530</note></person>`,
);
const place = wrap(
  "listPlace",
  `<place xml:id="loc000001" n="Musterdorf"><placeName type="main">Musterdorf</placeName><placeName type="add">(CH-ZH) Dorf</placeName><location><geo>47.4 8.7</geo></location></place>
   <place xml:id="loc000002" n="Probetal"><placeName type="main">Probetal</placeName><location><geo> </geo></location></place>`,
);
const organization = wrap(
  "listOrg",
  `<org xml:id="org000001" type="Bürgermeister und Rat/bourgmestre et Conseil"><orgName>Musterstadt</orgName></org>
   <org xml:id="org000002" type="Familie/famille"><orgName>Probegg</orgName></org>
   <org xml:id="org000003" type="Gericht/tribunal"><orgName>Ehegericht</orgName></org>`,
);
const taxonomy = wrap(
  "listPlace",
  `<category xml:id="key000001"><desc xml:lang="deu">Pfand</desc><gloss>Sache als Sicherheit für eine Schuld</gloss></category>
   <category xml:id="key000002"><desc xml:lang="deu">Mühle</desc></category>`,
);

test("Personen: Name des Registers, gleiche Namen mit Datierung, Heilige mit Zusatz", () => {
  const reg = buildSsrqRegisters({ person });
  assert.deepEqual(reg.person("Erica", "per000001"), { name: "Erika Muster", gnd: null });
  assert.equal(reg.person("Hans", "per000002").name, "Hans Probe (1529)");
  assert.equal(reg.person("Hans", "per000003").name, "Hans Probe (1601)");
  assert.equal(reg.person("Martis", "per000004").name, "Martin (Heilige und biblische Gestalten)");
  // Ohne Eintrag bzw. ohne Verweis: die Form im Text.
  assert.equal(reg.person("Uli Unbekannt", "per999999").name, "Uli Unbekannt");
  assert.equal(reg.person("Uli Unbekannt", null).name, "Uli Unbekannt");
  // Spannen der Datierung mit Halbgeviertstrich.
  assert.equal(reg.person("Uli", "per000005").name, "Uli Probe (1441–26.03.1492)");
  assert.equal(reg.counts.namesakes, 4);
});

test("Orte: Hauptname, Koordinaten nur wo vorhanden", () => {
  const reg = buildSsrqRegisters({ place });
  assert.deepEqual(reg.place("Musterdorff", "loc000001"), { name: "Musterdorf", lat: 47.4, lon: 8.7 });
  assert.deepEqual(reg.place("Brobetal", "loc000002"), { name: "Probetal", lat: null, lon: null });
});

test("Organisationen: Typ hinter Orts- und Familiennamen, sprechende Namen bleiben", () => {
  const reg = buildSsrqRegisters({ organization });
  assert.equal(reg.org("burgermeister und rat", "org000001").name, "Musterstadt (Bürgermeister und Rat)");
  assert.equal(reg.org("die von Probegg", "org000002").name, "Probegg (Familie)");
  assert.equal(reg.org("eegericht", "org000003").name, "Ehegericht");
  assert.equal(ssrqOrgName("Zunft zum Weggen", "Zunft/corporation"), "Zunft zum Weggen");
  assert.equal(ssrqOrgName("Musterdorf", "Dorfgemeinde/communauté villageoise"), "Musterdorf (Dorfgemeinde)");
  assert.equal(ssrqOrgName("Müller", "Handwerk, Gewerbe/métier"), "Müller (Handwerk)");
  assert.equal(ssrqOrgName("Musterfamilie", "Familie/famille"), "Musterfamilie");
});

test("Schlagwörter: Erklärung über die Kennung", () => {
  const reg = buildSsrqRegisters({ taxonomy });
  assert.equal(reg.keywordGloss("Pfand", "key000001"), "Sache als Sicherheit für eine Schuld");
  assert.equal(reg.keywordGloss("Mühle", "key000002"), null);
  assert.equal(reg.keywordGloss("Pfand", null), null);
});

test("Koordinaten aus geo", () => {
  assert.deepEqual(ssrqGeo("47.4556 8.7438"), { lat: 47.4556, lon: 8.7438 });
  assert.equal(ssrqGeo(" "), null);
  assert.equal(ssrqGeo("147 8"), null);
});
