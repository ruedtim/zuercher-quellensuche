/**
 * Unit-Tests für die Editionen des Index `editions`: Kennung, Zitierform, Permalink,
 * Bildnachweis, Verweise, Stücke der Rechtsquellen. Lauf: npx tsx --test src/editionSources.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EDITION_SOURCES, groupSsrqFiles, ssrqImageCredit, ssrqPart, ssrqPieceId } from "./editionSources.ts";

test("Rechtsquellen: Dateien zu Stücken, Grundtext und weitere Überlieferungen, keine Einleitungen", () => {
  const pieces = groupSsrqFiles([
    "SSRQ_ZH_NF_II_3_000a_Vorwort.xml",
    "SSRQ_ZH_NF_II_3_007_2.xml",
    "SSRQ_ZH_NF_II_3_007_1.xml",
    "SSRQ_ZH_NF_II_3_010.xml",
    "SSRQ_ZH_NF_II_3_009_3.xml",
    "SSRQ_ZH_NF_II_3_009_2.xml",
    "volinfo.xml",
    "SSRQ_ZH_NF_II_3_bibl-refs.tsv",
  ]);
  assert.deepEqual(
    pieces.map((p) => [p.localId, p.main.fileId, p.witnesses.map((w) => w.fileId)]),
    [
      ["SSRQ_ZH_NF_II_3_007", "SSRQ_ZH_NF_II_3_007_1", ["SSRQ_ZH_NF_II_3_007_2"]],
      // Ohne _1: der Text mit der kleinsten Nummer ist der Grundtext.
      ["SSRQ_ZH_NF_II_3_009", "SSRQ_ZH_NF_II_3_009_2", ["SSRQ_ZH_NF_II_3_009_3"]],
      ["SSRQ_ZH_NF_II_3_010", "SSRQ_ZH_NF_II_3_010", []],
    ],
  );
  assert.equal(pieces[0].volume, "ZH_NF_II_3");
  assert.equal(ssrqPieceId("SSRQ_ZH_NF_I_1_11_062"), "SSRQ_ZH_NF_I_1_11_062");
  assert.equal(ssrqPieceId("SSRQ_ZH_NF_II_3_047_2"), "SSRQ_ZH_NF_II_3_047");
  assert.equal(ssrqPieceId("QZH_401"), null);
});

test("Zitierform und Permalink je Edition", () => {
  assert.equal(EDITION_SOURCES.ssrq.label("SSRQ_ZH_NF_II_3_047"), "SSRQ ZH NF II/3 Nr. 47");
  assert.equal(EDITION_SOURCES.ssrq.label("SSRQ_ZH_NF_I_1_11_062"), "SSRQ ZH NF I/1/11 Nr. 62");
  assert.equal(EDITION_SOURCES.ssrq.permalink("SSRQ_ZH_NF_II_3_047"), "https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_047");
  assert.equal(EDITION_SOURCES.qzh.label("QZH_401"), "QZH_401");
  assert.equal(EDITION_SOURCES.qzh.permalink("QZH_401"), "https://qzh.sources-online.org/quellenstuecke/QZH_401");
  assert.equal(EDITION_SOURCES.ssrq.imageService("Bild_1_.tif"), "https://media.sources-online.org/iiif/2/erqzh!Bild_1_.tif");
});

test("Verweise der Edition auf eigene Stücke", () => {
  const own = EDITION_SOURCES.ssrq.ownTarget;
  assert.equal(own("/suche/detail/SSRQ_ZH_NF_II_3_029"), "SSRQ_ZH_NF_II_3_029");
  assert.equal(own("/suche/detail/SSRQ_ZH_NF_I_1_3_012_1"), "SSRQ_ZH_NF_I_1_3_012");
  assert.equal(own("https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_047"), "SSRQ_ZH_NF_II_3_047");
  assert.equal(own("http://permalink.snl.ch/bib/chbsg000110417"), null);
  assert.equal(EDITION_SOURCES.qzh.ownTarget("https://qzh.sources-online.org/quellenstuecke/QZH_401"), "QZH_401");
});

test("Bildnachweis nach der Signatur der Vorlage", () => {
  assert.equal(ssrqImageCredit("StAZH C I, Nr. 2466"), undefined);
  assert.equal(ssrqImageCredit("STAW B 2/3, S. 398 (Eintrag 8)"), "Stadtarchiv Winterthur");
  assert.equal(ssrqImageCredit("StArZH VI.WP.A.6.:40"), "Stadtarchiv Zürich");
  assert.equal(ssrqImageCredit("PGA Musterdorf I A 2"), "Gemeindearchiv Musterdorf");
  assert.equal(ssrqImageCredit("ERKGA Probe Tal I A 4"), "Archiv der reformierten Kirchgemeinde Probe Tal");
  assert.equal(ssrqImageCredit("XYZ 1"), undefined);
});

test("Band als Teil aus volinfo", () => {
  const vi = (human: string, title: string) =>
    `<TEI><teiHeader><fileDesc><titleStmt>\n<title>${title}</title></titleStmt><seriesStmt>${human}</seriesStmt></fileDesc></teiHeader></TEI>`;
  assert.equal(
    ssrqPart("ZH_NF_II_3", vi('<idno type="human">SSRQ ZH NF II/3</idno>', "I. Abteilung: Ausgedacht. Band 3: Die\n  Muster Vogtei")),
    "SSRQ ZH NF II/3: Die Muster Vogtei",
  );
  assert.equal(ssrqPart("ZH_NF_I_1_11", vi("", "I. Abteilung. Band 11: Gedruckte Muster")), "SSRQ ZH NF I/1/11: Gedruckte Muster");
  assert.equal(ssrqPart("ZH_NF_I_2_1", undefined), "SSRQ ZH NF I/2/1");
});
