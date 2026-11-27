import { test } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldSharpS, titleSearchFor } from "./searchText.ts";
import { MAX_BODY_BYTES, parseTeiFile } from "./parser.ts";

test("foldSharpS: ß und ẞ, sonst unverändert", () => {
  assert.equal(foldSharpS("Straße, daß, Großrathsbeschluß"), "Strasse, dass, Grossrathsbeschluss");
  assert.equal(foldSharpS("GROẞE STRAẞE"), "GROSSE STRASSE");
  assert.equal(foldSharpS("Strasse"), "Strasse");
  assert.equal(foldSharpS(""), "");
});

test("titleSearchFor: nur bei Unterschied, sonst null", () => {
  assert.equal(titleSearchFor("Bau der Straße nach Baden"), "Bau der Strasse nach Baden");
  assert.equal(titleSearchFor("Bau der Strasse nach Baden"), null);
});

async function parseXml(title: string, body: string, series: "RRB" | "RM" = "RRB") {
  const dir = await mkdtemp(join(tmpdir(), "searchtext-test-"));
  const path = join(dir, "MM_2_106_RRB_1850_0001a.xml");
  await writeFile(
    path,
    `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>${title}</title></titleStmt>
    <sourceDesc><bibl><title>${title}</title><date when="1850-01-02">2. Januar 1850</date></bibl></sourceDesc>
  </fileDesc></teiHeader>
  <text><body><p>${body}</p></body></text>
</TEI>`,
    "utf-8",
  );
  try {
    return await parseTeiFile({ absPath: path, relPath: "RRB/MM_2_106_RRB_1850_0001a.xml", series });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("parseTeiFile: Suchtext mit ss, Titel im Original plus titleSearch", async () => {
  const parsed = await parseXml("Erlaß betreffend die Straße", "Es wird beschlossen, daß die Straße gebaut wird.");
  assert.equal(parsed.body, "Es wird beschlossen, dass die Strasse gebaut wird.");
  assert.equal(parsed.meta.title, "Erlaß betreffend die Straße");
  assert.equal(parsed.meta.titleSearch, "Erlass betreffend die Strasse");
});

test("parseTeiFile: ohne ß kein titleSearch", async () => {
  const parsed = await parseXml("Bau der Strasse", "Die Strasse wird gebaut.");
  assert.equal(parsed.meta.titleSearch, null);
  assert.equal(parsed.body, "Die Strasse wird gebaut.");
});

test("parseTeiFile: Suchtext bis 1 MiB statt 100 KB", async () => {
  const long = "Sitzung des Kantonsrats. ".repeat(20_000); // ~500 KB
  const parsed = await parseXml("Protokoll", long + "Schlusswort");
  assert.ok(MAX_BODY_BYTES >= 1024 * 1024);
  assert.ok(parsed.body.endsWith("Schlusswort"), "Ende des langen Texts fehlt");
});
