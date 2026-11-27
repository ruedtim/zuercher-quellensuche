import { test } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTeiFile } from "./parser.ts";

async function withTempXml<T>(xml: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "parser-test-"));
  const path = join(dir, "test.xml");
  await writeFile(path, xml, "utf-8");
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const TEI_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Test</title></titleStmt>
      <sourceDesc>
        <bibl>
          <title>Test-Eintrag</title>
          <date when="1965-03-15">15. März 1965</date>
        </bibl>
      </sourceDesc>
    </fileDesc>
  </teiHeader>`;

test("extractEntities: sammelt persName/placeName/orgName separat", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p>
      Dr. <persName n="abc">Willy Hochuli</persName> aus
      <placeName n="def">Uster</placeName> spricht zum
      <orgName n="ghi">Regierungsrat</orgName>.
    </p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    assert.deepEqual(parsed.persons, ["Willy Hochuli"]);
    assert.deepEqual(parsed.places, ["Uster"]);
    assert.deepEqual(parsed.organizations, ["Regierungsrat"]);
  });
});

test("extractEntities: skip type='deriv'", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p>
      Das <placeName n="a" type="deriv">Zürcher</placeName> Volk
      und die Stadt <placeName n="b">Zürich</placeName>.
    </p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    assert.deepEqual(parsed.places, ["Zürich"]);
  });
});

test("extractEntities: dedupe innerhalb eines Dokuments", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p><orgName n="a">Regierungsrat</orgName> und <orgName n="b">Regierungsrat</orgName>.</p>
    <p>Der <orgName n="c">Regierungsrat</orgName> nochmal.</p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    assert.deepEqual(parsed.organizations, ["Regierungsrat"]);
  });
});

test("extractEntities: mixed content mit lb (Worttrennung)", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p>Beim <orgName n="a">Reg<lb break="no"/>ierungsrat</orgName> beantragt.</p>
    <p>Der <orgName n="b">Stadt<lb/>rat</orgName> tagte.</p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    // break="no" → kein Space; default break="yes" → Space
    assert.deepEqual(parsed.organizations, ["Regierungsrat", "Stadt rat"]);
  });
});

test("extractEntities: trailing Satzzeichen werden abgeschnitten", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p>Antrag des <orgName n="a">Regierungsrates.</orgName></p>
    <p>Der <orgName n="b">Regierungsrates</orgName> tagte.</p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    assert.deepEqual(parsed.organizations, ["Regierungsrates"]);
  });
});

test("extractEntities: leere Tags werden ignoriert", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p><persName n="a"></persName> und <persName n="b">Hans</persName>.</p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    assert.deepEqual(parsed.persons, ["Hans"]);
  });
});

test("extractEntities: Output ist sortiert", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p>
      <placeName n="a">Zürich</placeName>,
      <placeName n="b">Uster</placeName>,
      <placeName n="c">Bülach</placeName>.
    </p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    // Default-String-Sort: B vor U vor Z
    assert.deepEqual(parsed.places, ["Bülach", "Uster", "Zürich"]);
  });
});

test("extractEntities: OCR-Junk wird ausgefiltert", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p>
      <persName n="a">A</persName>,
      <persName n="b">0</persName>,
      <persName n="c">500</persName>,
      <persName n="d">...</persName>,
      <persName n="e">&amp; Bodmer</persName>,
      <persName n="f">'Heuscher</persName>,
      <persName n="g">Willy Hochuli</persName>,
      <persName n="h">Émile Zola</persName>.
    </p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    // Akzeptiert: Namen mit min. 2 Zeichen und Buchstabe am Anfang
    // Verworfen: einzelne Buchstaben, Zahlen, Punkte, Sonderzeichen-Präfixe
    assert.deepEqual(parsed.persons, ["Willy Hochuli", "Émile Zola"]);
  });
});

test("extractEntities: Body ohne Entities → leere Arrays", async () => {
  const xml = TEI_HEADER + `
  <text><body>
    <p>Reine Fließtext-Passage ohne Annotationen.</p>
  </body></text>
</TEI>`;

  await withTempXml(xml, async (path) => {
    const parsed = await parseTeiFile({ absPath: path, relPath: "test.xml", series: "ABl" });
    assert.deepEqual(parsed.persons, []);
    assert.deepEqual(parsed.places, []);
    assert.deepEqual(parsed.organizations, []);
  });
});
