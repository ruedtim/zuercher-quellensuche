import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveIIIF } from "./iiif.ts";
import { parseTeiFile } from "./parser.ts";
import { renderTeiHtml } from "./render.ts";
import { UNEMBEDDED_SERIES } from "./types.ts";

// Kurzform einer Sitzung, wie services/rm-transkribus sie schreibt.
const RM_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
<teiHeader>
<fileDesc>
<titleStmt><title>Ratssitzung 17.10.1642 (a. St.) – Unterschreiber-Manual</title></titleStmt>
<sourceDesc><bibl>
<title>Ratssitzung 17.10.1642 (a. St.) – Unterschreiber-Manual</title>
<date when="1642-10-17" calendar="#julian"/>
<ident>StAZH B II 441, S. 22–25</ident>
<ref type="catalog-volume" target="https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=244697"/>
</bibl></sourceDesc>
</fileDesc>
</teiHeader>
<facsimile>
<surface xml:id="f0011" n="S. 20–21"><graphic url="https://files.transkribus.eu/iiif/2/AAAABBBBCCCCDDDDEEEEFFFF" width="3272px" height="4480px"/></surface>
<surface xml:id="f0012" n="S. 22–23"><graphic url="https://files.transkribus.eu/iiif/2/GGGGHHHHIIIIJJJJKKKKLLLL" width="3272px" height="4480px"/></surface>
</facsimile>
<text><body>
<div type="session">
<pb n="S. 20–21" facs="#f0011"/><head>Montags den 17. Octobris
<lb/>Prnt. Herr <persName resp="#ner">Burgermeister Wa<lb break="no"/>ser</persName> und beid Räth</head>
<p><add place="left" type="marginal">Mühle zu <placeName resp="#ner">Küsnacht</placeName></add> Ist erken̄t, daß die kom̅en<lb break="no"/><pb n="S. 22–23" facs="#f0012" break="no"/>den Sachen
<lb/>uͤbergeben werden</p>
</div>
</body></text>
</TEI>
`;

async function parseRm() {
  const dir = await mkdtemp(join(tmpdir(), "rm-test-"));
  const path = join(dir, "RM_1642_0441_0012.xml");
  await writeFile(path, RM_TEI, "utf-8");
  try {
    return await parseTeiFile({ absPath: path, relPath: "data/RM/0441/RM_1642_0441_0012.xml", series: "RM" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("RM: body ist die Lesefassung, ohne Leerzeichen beim Seitenwechsel im Wort", async () => {
  const parsed = await parseRm();
  assert.equal(
    parsed.body,
    "Montags den 17. Octobris Prnt. Herr Burgermeister Waser und beid Räth " +
      "Mühle zu Küsnacht Ist erkennt, dass die kommenden Sachen übergeben werden",
  );
});

test("RM: Metadaten – Datum, Band, Sitzungsnummer, kein archiveId, Namen normalisiert", async () => {
  const { meta, persons, places, organizations } = await parseRm();
  assert.equal(meta.date, "1642-10-17");
  assert.equal(meta.dateYear, 1642);
  assert.equal(meta.volumeNr, 441);
  assert.equal(meta.startPg, 12);
  assert.equal(meta.archiveLink, "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=244697");
  assert.equal(meta.archiveId, null);
  // «Burgermeister Waser» ist ein Nachname allein (kein Wert), der Ort steht im Ortsverzeichnis.
  assert.deepEqual([persons, places, organizations], [[], ["Küsnacht"], []]);
  assert.ok(UNEMBEDDED_SERIES.has(meta.series));
});

test("RM: Namen aus den Spans normalisiert, auch verschachtelt; body bleibt der Lesetext", async () => {
  const xml = RM_TEI.replace(
    "uͤbergeben werden</p>",
    'uͤbergeben werden. Dem <persName resp="#ner">M. Hanß Conrad Eschern zu <placeName resp="#ner">Wädenschwyl</placeName></persName>' +
      ' ward vor <orgName resp="#ner">Stattgricht</orgName> und <orgName type="Kleiner Rat" resp="#stazh">beid Räth</orgName>' +
      ' erkhendt, wie <persName resp="#ner">Landtvogt Eschers zue Kyburg</persName> schreibt</p>',
  );
  const dir = await mkdtemp(join(tmpdir(), "rm-test-"));
  const path = join(dir, "RM_1642_0441_0012.xml");
  await writeFile(path, xml, "utf-8");
  try {
    const parsed = await parseTeiFile({ absPath: path, relPath: "data/RM/0441/RM_1642_0441_0012.xml", series: "RM" });
    assert.deepEqual(parsed.persons, ["Hans Konrad Escher"]);
    assert.deepEqual(parsed.places, ["Kyburg", "Küsnacht", "Wädenswil"]); // sort() nach Codepunkten wie extractEntities
    assert.deepEqual(parsed.organizations, ["Stadtgericht"]);
    // Der Lesetext bleibt der Text der TEI (Lesefassung), keine Normformen darin.
    assert.ok(parsed.body.includes("Dem M. Hanss Conrad Eschern zu Wädenschwyl ward vor Stattgricht und beid Räth erkhendt"));
    assert.ok(parsed.rawXml.includes("<persName resp=\"#ner\">M. Hanß Conrad Eschern zu"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RM: Seitenwechsel in Dokumentreihenfolge – pb im Absatz vor einem späteren pb auf div-Ebene", async () => {
  // pb 23 im ersten Absatz, pb 24 auf div-Ebene vor dem zweiten Absatz: der Objekt-Parse
  // bündelte die pb des div vor den p-Kindern ⇒ Canvases 22, 24, 23.
  const xml = RM_TEI.replace(
    "uͤbergeben werden</p>",
    'uͤbergeben werden</p>\n<pb n="S. 24–25" facs="#f0013"/><p>Zweites Geschäft</p>',
  ).replace(
    "</facsimile>",
    '<surface xml:id="f0013" n="S. 24–25"><graphic url="https://files.transkribus.eu/iiif/2/MMMMNNNNOOOOPPPPQQQQRRRR" width="3272px" height="4480px"/></surface>\n</facsimile>',
  );
  const dir = await mkdtemp(join(tmpdir(), "rm-test-"));
  const path = join(dir, "RM_1642_0441_0012.xml");
  await writeFile(path, xml, "utf-8");
  try {
    const parsed = await parseTeiFile({ absPath: path, relPath: "data/RM/0441/RM_1642_0441_0012.xml", series: "RM" });
    assert.deepEqual(parsed.pageBreaks.map((p) => p.facs), ["f0011", "f0012", "f0013"]);
    const iiif = resolveIIIF(parsed, { publicBaseUrl: "https://zentraleserien.ch" });
    assert.equal(iiif.kind, "local");
    if (iiif.kind !== "local") return;
    assert.deepEqual(iiif.manifest.items.map((c) => c.label.de[0]), ["S. 20–21", "S. 22–23", "S. 24–25"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RM: Manifest mit Transkribus-Bildservice, Seitenlabels und Bildnachweis", async () => {
  const parsed = await parseRm();
  const iiif = resolveIIIF(parsed, { publicBaseUrl: "https://zentraleserien.ch" });
  assert.equal(iiif.kind, "local");
  if (iiif.kind !== "local") return;
  assert.equal(iiif.publicUrl, "https://zentraleserien.ch/iiif/RM/RM_1642_0441_0012/manifest.json");
  const canvases = iiif.manifest.items;
  assert.deepEqual(canvases.map((c) => c.label.de[0]), ["S. 20–21", "S. 22–23"]);
  const service = canvases[1].items[0].items[0].body.service[0];
  assert.equal(service.id, "https://files.transkribus.eu/iiif/2/GGGGHHHHIIIIJJJJKKKKLLLL");
  assert.equal(canvases[0].width, 3272);
  assert.deepEqual(iiif.manifest.requiredStatement?.value.de, ["Staatsarchiv des Kantons Zürich, StAZH B II 441"]);
});

test("RM: HTML bleibt diplomatisch, Randtitel als Marginalie", async () => {
  const html = renderTeiHtml(await parseRm());
  assert.match(html, /kom̅en/);
  assert.match(html, /<aside class="tei-marginal tei-marginal--left">Mühle zu <span class="tei-place">Küsnacht<\/span><\/aside>/);
  assert.match(html, /<span class="tei-person">Burgermeister Waser<\/span>/);
});

/** RM-TEI mit dem Vorsitz als in Transkribus ausgezeichnete Person (nur der Nachname im Text). */
async function parseRmWithRef(ref: string) {
  const xml = RM_TEI.replace(
    '<persName resp="#ner">Burgermeister Wa<lb break="no"/>ser</persName>',
    `<persName resp="#stazh" ref="${ref}">Holtz<lb break="no"/>halb</persName>`,
  );
  const dir = await mkdtemp(join(tmpdir(), "rm-test-"));
  const path = join(dir, "RM_1642_0441_0012.xml");
  await writeFile(path, xml, "utf-8");
  try {
    return await parseTeiFile({ absPath: path, relPath: "data/RM/0441/RM_1642_0441_0012.xml", series: "RM" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test.skip("RM: Person mit Normdaten – Name aus dem Register in der Facette, data-gnd/-hls/-ssrq im HTML", async () => {
  const parsed = await parseRmWithRef(
    "https://d-nb.info/gnd/143681346 https://hls-dhs-dss.ch/de/articles/018060/ https://personae.ssrq-sds-fds.ch/?query=per002157",
  );
  // Ohne Register fiele der Nachname allein weg.
  assert.deepEqual(parsed.persons, ["Hans Heinrich Holzhalb"]);
  const html = renderTeiHtml(parsed);
  assert.ok(html.includes('<span class="tei-person" data-gnd="143681346" data-hls="018060" data-ssrq="per002157">Holtz'), html);
  assert.ok(!html.includes("d-nb.info") && !html.includes("personae."), "die URLs selbst bleiben aus dem HTML");
  // Text und Suchtext bleiben diplomatisch.
  assert.ok(parsed.body.includes("Prnt. Herr Holtzhalb und beid Räth"));
});

test.skip("RM: Person nur mit SSRQ-ID (GND in Transkribus unlesbar) – Name über die SSRQ-ID", async () => {
  const parsed = await parseRmWithRef("https://personae.ssrq-sds-fds.ch/?query=per002157");
  assert.deepEqual(parsed.persons, ["Hans Heinrich Holzhalb"]);
  assert.ok(renderTeiHtml(parsed).includes('<span class="tei-person" data-ssrq="per002157">Holtz'));
});

test("RM: undatierbare Sitzung (Zeitraum, cert=low) hat kein Datum, nur das Jahr aus der ID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rm-test-"));
  const path = join(dir, "RM_1499_0030_0003.xml");
  await writeFile(path, RM_TEI.replace('<date when="1642-10-17" calendar="#julian"/>',
    '<date from="1499-01-01" to="1499-06-30" calendar="#julian" cert="low"/>'), "utf-8");
  try {
    const parsed = await parseTeiFile({ absPath: path, relPath: "data/RM/0030/RM_1499_0030_0003.xml", series: "RM" });
    assert.equal(parsed.meta.date, null);
    assert.equal(parsed.meta.dateYear, 1499);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
