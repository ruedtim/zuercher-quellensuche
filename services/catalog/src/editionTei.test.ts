/**
 * Unit-Tests für den TEI-Renderer der Editionen. Nur ausgedachte Beispiele im Format der
 * QZH (kein Editionstext im Repo). Lauf: npx tsx --test src/editionTei.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { dateOf, isoSpan, letterLabel, parseEditionTei, partOf, pbLabel } from "./editionTei.ts";

const tei = (body: string, header = "", back = "", group = false) => {
  const text = `<body>${body}</body>${back ? `<back>${back}</back>` : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/css" href="https://example.org/x.css“?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>
<titleStmt><respStmt><persName>Erika Muster</persName><resp key="transcript"/></respStmt>
<respStmt><persName>Max Probe</persName><resp key="tagging"/></respStmt></titleStmt>
<publicationStmt><publisher>Staatsarchiv des Kantons Zürich</publisher><date type="electronic" when="2021-05-01"/></publicationStmt>
<seriesStmt><title>Quellen zur Geschichte der Täufer in der Schweiz</title>
<respStmt><persName>Hanna Herausgeberin</persName><resp>Herausgeberschaft</resp></respStmt><idno>QZH_999</idno></seriesStmt>
<sourceDesc><msDesc><msIdentifier><idno source="https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1234567">StAZH X 1.2, Nr. 3</idno></msIdentifier>
<head>Ausgedachter Ratsbeschluss</head>
<msContents><msItem><textLang>Deutsch</textLang><filiation type="current">Eintrag</filiation></msItem>${header}</msContents>
<history><origin><origDate when="1583-09-21"/></origin></history>
<additional><listBibl><head>Edition</head><bibl>QGTS, Bd. 5, Nr. 12</bibl></listBibl></additional>
</msDesc></sourceDesc></fileDesc>
<profileDesc><textClass><keywords><term ref="key1">Täufertum</term><term ref="key2">Armenversorgung</term></keywords></textClass></profileDesc>
</teiHeader><text>${group ? `<group><text>${text}</text></group>` : text}</text></TEI>`;
};

test("Kopf: Kennung, Titel, Teil mit Band, Signatur, Katalog-ID, Datum, Schlagwörter", () => {
  const r = parseEditionTei(tei("<div><p>x</p></div>"), "QZH_999");
  assert.equal(r.localId, "QZH_999");
  assert.equal(r.title, "Ausgedachter Ratsbeschluss");
  assert.equal(r.part, "Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5");
  assert.deepEqual(r.editors, ["Hanna Herausgeberin"]);
  assert.deepEqual(r.transcription, ["Erika Muster"]);
  assert.deepEqual(r.tagging, ["Max Probe"]);
  assert.equal(r.signature, "StAZH X 1.2, Nr. 3");
  assert.deepEqual(r.catalogIds, [1234567]);
  assert.deepEqual(r.date, { from: "1583-09-21", to: "1583-09-21" });
  assert.equal(r.filiation, "Eintrag");
  assert.deepEqual(r.keywords.map((k) => k.term), ["Täufertum", "Armenversorgung"]);
  assert.equal(r.bibl[0].text, "QGTS, Bd. 5, Nr. 12");
  assert.equal(r.published, "2021-05-01");
});

test("Katalog-ID nur aus Links auf den Katalog des Staatsarchivs, nicht aus denen anderer Archive", () => {
  const stazh = 'source="https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1234567"';
  const withSource = (source: string) => tei("<div><p>x</p></div>").replace(stazh, `source="${source}"`);
  const fremd = parseEditionTei(withSource("https://amsquery.stadt-zuerich.ch/detail.aspx?ID=1234567"), "QZH_999");
  assert.deepEqual(fremd.catalogIds, []);
  // Der Link der Edition auf die Vorlage bleibt.
  assert.equal(fremd.sourceUrl, "https://amsquery.stadt-zuerich.ch/detail.aspx?ID=1234567");
  assert.deepEqual(parseEditionTei(withSource("http://scope.stiftsarchiv.sg.ch/detail.aspx?ID=7"), "QZH_999").catalogIds, []);
  assert.deepEqual(parseEditionTei(withSource("http://archivkatalog.ji.zh.ch/detail.aspx?id=42"), "QZH_999").catalogIds, [42]);
  assert.deepEqual(parseEditionTei(withSource("StAZH X 1.2, Nr. 3 / https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=43"), "QZH_999").catalogIds, [43]);
});

test("Anmerkungen: textkritisch mit Buchstaben, Sachanmerkungen mit Zahlen, aus dem Lesetext", () => {
  const r = parseEditionTei(
    tei('<div><p>der rat<note type="editorial"> Kleiner Rat</note> beschloss<note type="critical">Folgt gestrichen: nit</note> und wolt<note type="editorial">wollte</note>.</p></div>'),
    "QZH_999",
  );
  assert.deepEqual(
    r.notes.map((n) => [n.key, n.label, n.type, n.text]),
    [
      ["n1", "1", "editorial", "Kleiner Rat"],
      ["a1", "a", "critical", "Folgt gestrichen: nit"],
      ["n2", "2", "editorial", "wollte"],
    ],
  );
  assert.equal(r.text, "der rat beschloss und wolt.");
  assert.match(r.html, /<sup class="ed-note-ref ed-note-critical"><a href="#ed-note-a1" id="ed-ref-a1" data-note="a1" title="Folgt gestrichen: nit">a<\/a><\/sup>/);
});

test("Zeilenfall: break=no trennt ohne Leerzeichen, sonst Leerzeichen; Marke im HTML", () => {
  const r = parseEditionTei(tei('<div><p><lb/>ver<lb break="no"/>schienen\n      mittwuchen <lb/>gestelt</p></div>'), "QZH_999");
  assert.equal(r.text, "verschienen mittwuchen gestelt");
  assert.match(r.html, /ver<span class="ed-lb ed-lb-join" aria-hidden="true"><\/span>schienen mittwuchen <span class="ed-lb"/);
});

test("choice: Abkürzung zeigt die Vorlage, der Lesetext die Auflösung", () => {
  const r = parseEditionTei(tei("<div><p><choice><abbr>Act</abbr><expan>Actum</expan></choice> sambstags, <choice><sic>rath</sic><corr>rat</corr></choice></p></div>"), "QZH_999");
  assert.equal(r.text, "Actum sambstags, rat");
  assert.match(r.html, /<abbr class="ed-abbr" title="Actum">Act<\/abbr>/);
  assert.match(r.html, /<span class="ed-corr" title="Vorlage: rath">rat<\/span>/);
});

test("Gestrichenes nur im HTML, Ergänztes in beiden, Lücke und Ergänzung der Bearbeitung", () => {
  const r = parseEditionTei(tei('<div><p>gelt <del>und gut</del> <add place="above">zinß</add> <supplied>und</supplied> <gap reason="illegible"/> ende</p></div>'), "QZH_999");
  assert.equal(r.text, "gelt zinß und ende");
  assert.match(r.html, /<del class="ed-del" title="gestrichen">und gut<\/del>/);
  assert.match(r.html, /<ins class="ed-add" title="ergänzt über der Zeile">zinß<\/ins>/);
  assert.match(r.html, /\[und\]/);
  assert.match(r.html, /<span class="ed-gap" title="unleserlich">\[…\]<\/span>/);
});

test("Personen und Orte mit Verweis, Seitenwechsel mit Bild", () => {
  const r = parseEditionTei(
    tei('<div><pb n="1" facs="Bild_1.tif"/><p>Vogt zů <placeName ref="LOC_47.1_8.2">Gruͤningen</placeName> und <persName ref="GND_123">Hans Kriesi</persName> <pb n="2" facs="Bild_2.tif"/> und <persName>Bohq</persName></p></div>'),
    "QZH_999",
  );
  assert.deepEqual(r.persons, [
    { form: "Hans Kriesi", ref: "GND_123" },
    { form: "Bohq", ref: null },
  ]);
  assert.deepEqual(r.places, [{ form: "Gruͤningen", ref: "LOC_47.1_8.2" }]);
  assert.deepEqual(r.pages, [
    { n: "1", facs: "Bild_1.tif" },
    { n: "2", facs: "Bild_2.tif" },
  ]);
  assert.match(r.html, /<span class="ed-pb" data-page="1" data-facs title="S\. 2 der Vorlage">S\. 2<\/span>/);
});

test("Namen: data-name aus dem Register, auch in Anmerkungen und Regest; Registereintrag ohne Text; Literatur nicht", () => {
  const entityName = (kind: string, form: string, ref: string | null) => (ref ? `${kind}:${ref}` : form);
  const r = parseEditionTei(
    tei(
      '<div><p><persName ref="Kriesi, Jörg"><choice><abbr>Jo</abbr><expan>Jörg</expan></choice> <del>Kriessj</del>Kriesi</persName> und Hanns Waser<persName ref="Waser, Hans"/>' +
        '<note type="editorial">Vgl. <persName ref="GND_123">Hans Kambli</persName> in <placeName ref="LOC_47.1_8.2">Grüningen</placeName>.</note>, <orgName>Rat</orgName></p></div>',
      '<summary>Der Rat und <persName ref="Kriesi, Jörg">Jörg Kriesi</persName>.</summary>',
    ).replace("<bibl>QGTS, Bd. 5, Nr. 12</bibl>", "<bibl>QGTS, Bd. 5, Nr. 12</bibl><bibl><persName>Emil Egli</persName>: Actensammlung</bibl>"),
    "QZH_999",
    { entityName },
  );
  assert.deepEqual(r.persons, [
    { form: "Jörg Kriesi", ref: "Kriesi, Jörg" },
    { form: "", ref: "Waser, Hans" },
    { form: "Hans Kambli", ref: "GND_123" },
    { form: "Jörg Kriesi", ref: "Kriesi, Jörg" },
  ]);
  assert.deepEqual(r.places, [{ form: "Grüningen", ref: "LOC_47.1_8.2" }]);
  assert.deepEqual(r.orgs, [{ form: "Rat", ref: null }]);
  // Anzeige mit Abkürzung und Gestrichenem, gesucht wird mit dem Namen des Registers.
  assert.match(r.html, /<span class="ed-person" data-ref="Kriesi, Jörg" data-name="person:Kriesi, Jörg"><abbr class="ed-abbr" title="Jörg">Jo<\/abbr> <del/);
  assert.match(r.html, /<span class="ed-person" data-ref="Waser, Hans"><\/span>/);
  assert.match(r.html, /<span class="ed-org" data-name="Rat">Rat<\/span>/);
  assert.match(r.notes[0].html, /<span class="ed-person" data-ref="GND_123" data-name="person:GND_123">Hans Kambli<\/span>/);
  assert.match(r.notes[0].html, /data-name="place:LOC_47\.1_8\.2"/);
  assert.match(r.regestHtml ?? "", /data-name="person:Kriesi, Jörg"/);
  // Literatur: Name ohne Register, ohne Filterwert.
  assert.ok(r.bibl.some((b) => b.html.includes('<span class="ed-person">Emil Egli</span>')));
});

test("group/text, Kommentar im back, Regest im Kopf", () => {
  const r = parseEditionTei(
    tei("<div><p>quelle</p></div>", "<summary>Der Rat <persName>N.</persName> beschliesst.</summary>", "<div><p>Kommentar mit <q>zitat</q>.</p></div>", true),
    "QZH_999",
  );
  assert.equal(r.text, "quelle");
  assert.equal(r.backText, "Kommentar mit zitat.");
  assert.equal(r.backHtml, '<div class="ed-div"><p>Kommentar mit <q class="ed-q">zitat</q>.</p></div>');
  assert.equal(r.regestText, "Der Rat N. beschliesst.");
  assert.match(r.regestHtml ?? "", /<span class="ed-person">N\.<\/span>/);
});

test("Zeichen: weiche Trennstriche weg, MUFI-Münzzeichen lesbar, HTML maskiert", () => {
  const r = parseEditionTei(tei("<div><p>die ­toüf­fer zalten 10 <abbr></abbr> &amp; &lt;mehr&gt;</p></div>"), "QZH_999");
  assert.equal(r.text, "die toüffer zalten 10 ß & <mehr>");
  assert.match(r.html, /<span class="ed-sign" title="Schilling">ß<\/span>/);
  assert.match(r.html, /&amp; &lt;mehr&gt;/);
});

test("Verweise: eigene Stücke über linkFor, nur http(s) als Link", () => {
  const linkFor = (t: string) => t.replace("https://qzh.sources-online.org/quellenstuecke/QZH_044", "/editionen/qzh/QZH_044");
  const r = parseEditionTei(
    tei("<div><p>x</p></div>", "", '<div><p>Vgl. <ref target="https://qzh.sources-online.org/quellenstuecke/QZH_044">QZH, Nr. 44</ref> und <ref target="javascript:alert(1)">böse</ref>.</p></div>'),
    "QZH_999",
    { linkFor },
  );
  assert.match(r.backHtml ?? "", /<a href="\/editionen\/qzh\/QZH_044">QZH, Nr. 44<\/a>/);
  assert.doesNotMatch(r.backHtml ?? "", /javascript/);
});

test("Datum: Tag, Monat, Spanne; ungültig = null", () => {
  assert.deepEqual(isoSpan("1530-05"), { from: "1530-05-01", to: "1530-05-31" });
  assert.deepEqual(isoSpan("1600"), { from: "1600-01-01", to: "1600-12-31" });
  assert.equal(isoSpan("1583-02-30"), null);
  assert.equal(isoSpan("um 1600"), null);
  const span = (attrs: string) => dateOf({ origDate: [], ":@": Object.fromEntries(attrs.split(" ").map((a) => a.split("="))) });
  assert.deepEqual(span("from=1530 to=1532-03"), { from: "1530-01-01", to: "1532-03-31" });
});

test("Teil und Buchstabenzählung", () => {
  assert.equal(partOf("Quellen zur Zürcher Geschichte", []), "Quellen zur Zürcher Geschichte");
  assert.equal(partOf("Quellen zur Geschichte der Täufer in der Schweiz", [{ head: "Edition", html: "", text: "QGTS, Bd. 6, Nr. 1" }]), "Quellen zur Geschichte der Täufer in der Schweiz, Bd. 6");
  assert.deepEqual([1, 2, 26, 27, 28].map(letterLabel), ["a", "b", "z", "aa", "ab"]);
  assert.deepEqual(["2", "16r", "16v", "Umschlag"].map(pbLabel), ["S. 2", "fol. 16r", "fol. 16v", "Umschlag"]);
});

// ── SSRQ-TEI (Zürcher Rechtsquellen), ausgedachte Beispiele ──────────────────

const ssrq = (body: string, origDate = '<origDate when="1402-10-25"/>') => `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>
<titleStmt><title>Ausgedachter Band</title><respStmt><persName>Erika Muster</persName><resp key="transcript"/></respStmt></titleStmt>
<publicationStmt><date type="electronic" when="2021-07-01"/></publicationStmt>
<seriesStmt><title>Sammlung Schweizerischer Rechtsquellen</title>
<respStmt><orgName>Ausgedachte Stiftung</orgName><resp>Herausgeberschaft</resp></respStmt><idno>SSRQ_ZH_NF_II_3_007_1</idno></seriesStmt>
<sourceDesc><msDesc><msIdentifier><idno source="https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=7654321">StAZH Z 9, Nr. 9</idno></msIdentifier>
<head>Ausgedachte Verpfändung</head><msContents><summary>Ein Graf verpfändet eine Burg.</summary></msContents>
<history><origin>${origDate}</origin></history></msDesc></sourceDesc></fileDesc></teiHeader>
<text><group><text><body corresp="Sigle1"><div>${body}</div></body></text></group></text></TEI>`;

test("SSRQ: Herausgeberin als Körperschaft, Kalender, Kennung aus seriesStmt", () => {
  const r = parseEditionTei(ssrq("<p>x</p>", '<origDate calendar="Julian" when="1530-05-02"/>'), "SSRQ_ZH_NF_II_3_007_1");
  assert.deepEqual(r.editors, ["Ausgedachte Stiftung"]);
  assert.equal(r.calendar, "julian");
  assert.equal(r.localId, "SSRQ_ZH_NF_II_3_007_1");
  assert.deepEqual(r.catalogIds, [7654321]);
  assert.equal(parseEditionTei(ssrq("<p>x</p>"), "x").calendar, null);
  // Kopf nur mit dem Datum: Kalender aus der Datierung im Text mit demselben Datum.
  const inText = (d: string) =>
    parseEditionTei(ssrq(`<head><origDate when="${d}" calendar="Julian">Mentags, den letsten octobris</origDate></head><p>x</p>`, '<origDate when="1402-10-25"/>'), "x");
  assert.equal(inText("1402-10-25").calendar, "julian");
  assert.equal(inText("1402-10-26").calendar, null);
});

test("SSRQ: Abschrift – Datum des Rechtsakts aus filiation, das der Abschrift bleibt für die Vorlage", () => {
  const xml = ssrq("<p>x</p>", '<origDate from="1801-01-01" to="1900-12-31"/>').replace(
    "</summary></msContents>",
    '</summary><msItem><filiation type="current">Abschrift</filiation><filiation type="original"><origDate when="1438-03-14"/></filiation></msItem></msContents>',
  );
  const r = parseEditionTei(xml, "x", { originalDateFirst: true });
  assert.deepEqual(r.date, { from: "1438-03-14", to: "1438-03-14" });
  assert.deepEqual(r.witnessDate, { from: "1801-01-01", to: "1900-12-31" });
  assert.equal(r.filiation, "Abschrift");
  // Ohne die Option (QZH): wie bisher das Datum der Vorlage.
  assert.deepEqual(parseEditionTei(xml, "x").date, { from: "1801-01-01", to: "1900-12-31" });
});

test("SSRQ: Artikelnummern, Unterschrift, Spaltenwechsel", () => {
  const r = parseEditionTei(ssrq('<p><seg n="1">Item der erst artikel</seg> <seg n="2">Item der ander</seg><cb/>fort</p><signed><persName ref="per000001">Hans Schriber</persName></signed>'), "x");
  assert.match(r.html, /<span class="ed-seg-n">\[1\]<\/span> Item der erst artikel/);
  assert.match(r.html, /<span class="ed-seg-n">\[2\]<\/span>/);
  assert.match(r.html, /<span class="ed-cb" title="Spaltenwechsel"/);
  assert.match(r.html, /<div class="ed-signed">/);
  assert.equal(r.text.replace(/\n/g, " "), "Item der erst artikel Item der ander fort Hans Schriber");
  assert.deepEqual(r.unknown, []);
});

test("SSRQ: delSpan bis anchor fehlt in der Lesefassung, addSpan bleibt; über Elementgrenzen", () => {
  const r = parseEditionTei(
    ssrq('<p>vor <delSpan spanTo="#del1"/>gestrichen <hi rend="italic">auch das</hi></p><p>und hier<anchor xml:id="del1"/> danach <addSpan spanTo="#add1"/>neu<anchor xml:id="add1"/> ende</p>'),
    "x",
  );
  // Gestrichen ist alles von «gestrichen» bis zum anchor im nächsten Absatz.
  assert.equal(r.text, "vor\ndanach neu ende");
  assert.match(r.html, /<del class="ed-del" title="gestrichen">gestrichen <\/del>/);
  assert.match(r.html, /<em><del class="ed-del" title="gestrichen">auch das<\/del><\/em>/);
  assert.match(r.html, /<ins class="ed-add" title="ergänzt">neu<\/ins>/);
});

test("SSRQ: Organisationen mit Verweis, Heilige in Datumsangaben nicht im Register", () => {
  const entityName = (kind: string, form: string, ref: string | null) => (ref ? `${kind}:${ref}` : form);
  const r = parseEditionTei(
    ssrq('<p>dem <orgName ref="org000001">rat</orgName> jerlich uff <date type="deadline" when="--11-11">sant <persName ref="per000141">Martis</persName> tag</date> von <persName ref="per000327">Fridrich</persName></p>'),
    "x",
    { entityName },
  );
  assert.deepEqual(r.orgs, [{ form: "rat", ref: "org000001" }]);
  assert.deepEqual(r.persons, [{ form: "Fridrich", ref: "per000327" }]);
  assert.equal(r.datedNames, 1);
  assert.match(r.html, /<span class="ed-org" data-ref="org000001" data-name="org:org000001">rat<\/span>/);
  // Der Heilige bleibt im Text ausgezeichnet, aber ohne Filterwert.
  assert.match(r.html, /<span class="ed-person" data-ref="per000141">Martis<\/span>/);
});
