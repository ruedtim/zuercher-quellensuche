import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, correctionsMarkdown, idResolutionNumber, upstreamId, type AbgleichUnit } from "./abgleich.ts";
import { PlatformIndex } from "./platform.ts";

const unit = (id: number, signature: string, weblink: string, series = "RRB", zsUnit = true): AbgleichUnit => ({
  id,
  signature,
  title: `Titel ${id}`,
  year: 1900,
  weblink: { series, id: weblink },
  zsUnit,
});

test("Abgleich: fehlende Dokumente, Varianten, Widersprüche, nicht im Export", () => {
  const r = compare({
    units: [
      unit(100, "MM 1.1 RRB 1832/0001", "MM_1_1_RRB_1832_0001"),
      // archiveLink des Dokuments nennt die Nachbareinheit (101 verlinkt ein anderes Dokument).
      unit(101, "MM 1.1 RRB 1832/0002", "MM_1_1_RRB_1832_0002"),
      unit(102, "MM 24.60 KRP 1942/086/0798", "MM_24_60_KRP_1942_086_0798", "KRP"),
      unit(104, "MM 3.45 RRB 1931/1864", "MM_3_45_RRB_1931_1864"),
      unit(105, "MM 2.26 RRB 1835/1811 - MM 2.26 RRB 1835/1812", "MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812"),
      unit(106, "ABl 1996 (S. 1217-1225)", "ABl_1996__S__1217-1222_", "ABl"),
      // Zwei Weblinks auf 1994/1749; das Dokument 1994/1750 nennt Einheit 108.
      unit(107, "MM 3.204 RRB 1994/1749", "MM_3_204_RRB_1994_1749"),
      unit(108, "MM 3.204 RRB 1994/1750", "MM_3_204_RRB_1994_1749"),
      // Urkunde mit Weblink auf einen Beschluss: Verweis, kein Widerspruch.
      unit(109, "C I, Nr. 3889", "MM_1_1_RRB_1832_0001", "RRB", false),
    ],
    platform: new PlatformIndex([
      { id: "MM_1_1_RRB_1832_0001", series: "RRB", archiveId: 100, resolutionId: "1832/0001" },
      { id: "MM_1_1_RRB_1832_0002", series: "RRB", archiveId: 103, resolutionId: "1832/0003" },
      { id: "MM_1_1_RRB_1832_0003", series: "RRB", archiveId: 103 },
      { id: "MM_9", series: "OS", archiveId: 555 },
      { id: "MM_8", series: "OS", archiveId: null },
      { id: "MM_3_45_RRB_1931_1864_t", series: "RRB", archiveId: 104 },
      { id: "MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812", series: "RRB", archiveId: 105 },
      { id: "ABl_1996__S__1217-1225_", series: "ABl", archiveId: 106 },
      { id: "MM_3_204_RRB_1994_1749_t", series: "RRB", archiveId: 107 },
      { id: "MM_3_204_RRB_1994_1750_t", series: "RRB", archiveId: 108 },
    ]),
    catalogIds: new Set([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]),
    signatures: new Map([[103, "MM 1.1 RRB 1832/0003"]]),
  });
  assert.deepEqual(r.missingOnPlatform, [{ catalogId: 102, docId: "MM_24_60_KRP_1942_086_0798", series: "KRP", year: 1900 }]);
  assert.deepEqual(r.mismatches, [{ docId: "MM_1_1_RRB_1832_0002", archiveId: "103", catalogId: 101 }]);
  assert.deepEqual(r.notInExport, [{ docId: "MM_9", series: "OS", archiveId: "555" }]);
  assert.deepEqual(
    Object.fromEntries(r.via),
    { "Weblink-ID": 3, "mit «_t»": 2, "ohne Bindestrich": 1, "über die archiveId des Dokuments": 1, "archiveId statt Weblink": 1 },
  );
  const byArt = (art: string) => r.corrections.filter((c) => c.art === art).map((c) => [c.katalogId, c.dokument, c.ist, c.soll]);
  assert.deepEqual(byArt("weblink-fehlt"), [[102, "MM_24_60_KRP_1942_086_0798", "MM_24_60_KRP_1942_086_0798", ""]]);
  assert.deepEqual(byArt("weblink-bindestrich"), [
    [105, "MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812", "MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812", "MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812"],
  ]);
  assert.deepEqual(byArt("weblink-id"), [[106, "ABl_1996__S__1217-1225_", "ABl_1996__S__1217-1222_", "ABl_1996__S__1217-1225_"]]);
  // Die Plattform des Staatsarchivs kennt die ID ohne «_t».
  assert.deepEqual(byArt("weblink-anderes-dokument"), [[108, "MM_3_204_RRB_1994_1750_t", "MM_3_204_RRB_1994_1749", "MM_3_204_RRB_1994_1750"]]);
  assert.deepEqual(byArt("archivelink"), [[101, "MM_1_1_RRB_1832_0002", "103 MM 1.1 RRB 1832/0003", "101"]]);
  assert.deepEqual(byArt("archivelink-unbekannt"), [[null, "MM_9", "555", ""]]);
  // Die Einheit mit Weblink aufs Dokument, nicht die (falsch) genannte.
  assert.deepEqual(byArt("beschlussnummer"), [[101, "MM_1_1_RRB_1832_0002", "1832/0003", "1832/0002"]]);
  const tei = r.corrections.find((c) => c.art === "archivelink");
  assert.equal(tei?.hinweis, "Die genannte Einheit hat keinen Weblink");
  assert.deepEqual(Object.keys(tei ?? {}), ["art", "ort", "katalogId", "signatur", "titel", "dokument", "ist", "soll", "hinweis"]);
  assert.equal(tei?.signatur, "MM 1.1 RRB 1832/0002");
});

test("Abgleich: zweiter Weblink auf ein Dokument, das die andere Einheit nennt", () => {
  const r = compare({
    units: [unit(1, "MM 1.1 RRB 1900/0001", "MM_1_1_RRB_1900_0001"), unit(2, "MM 1.1 RRB 1900/0002", "MM_1_1_RRB_1900_0001")],
    platform: new PlatformIndex([{ id: "MM_1_1_RRB_1900_0001", series: "RRB", archiveId: 1 }]),
    catalogIds: new Set([1, 2]),
  });
  assert.deepEqual(r.mismatches, []);
  assert.deepEqual(
    r.corrections.map((c) => [c.art, c.katalogId, c.dokument]),
    [["weblink-doppelt", 2, "MM_1_1_RRB_1900_0001"]],
  );
});

test("Beschlussnummer aus der Dokument-ID, ID beim Staatsarchiv", () => {
  assert.equal(idResolutionNumber("MM_2_3_RRB_1831_0882"), "1831/0882");
  assert.equal(idResolutionNumber("MM_3_45_RRB_1931_1864_t"), "1931/1864");
  assert.equal(idResolutionNumber("MM_24_60_KRP_1942_086_0798"), "1942/086/0798");
  assert.equal(idResolutionNumber("MM_2_191_RRB_1871_0012a"), "1871/0012a");
  assert.equal(idResolutionNumber("MM_2_24_mitgliederliste"), null);
  assert.equal(idResolutionNumber("ABl_1980__S__1-10_"), null);
  assert.equal(upstreamId("MM_3_45_RRB_1931_1864_t"), "MM_3_45_RRB_1931_1864");
  assert.equal(upstreamId("ABl_1980__S__1-10_"), "ABl_1980__S__1-10_");
});

test("Korrekturliste als Markdown: nach Ort und Art, lange Listen gekürzt", () => {
  const c = (art: "weblink-fehlt" | "archivelink", katalogId: number) => ({
    art,
    ort: art === "archivelink" ? ("TEI" as const) : ("Katalog" as const),
    katalogId,
    signatur: `MM 1.${katalogId}`,
    titel: "",
    dokument: `D|${katalogId}`,
    ist: "x",
    soll: "",
    hinweis: "",
  });
  const md = correctionsMarkdown([c("weblink-fehlt", 1), c("weblink-fehlt", 2), c("weblink-fehlt", 3), c("archivelink", 4)], "2026-11-09", 2);
  assert.match(md, /## Im Online-Archivkatalog \(Weblinks\)\n\n### Weblink auf ein Dokument, das es nicht gibt: 3/);
  assert.match(md, /\| 1 \| MM 1\.1 \| D\\\|1 \|/);
  assert.match(md, /\| … \| 1 weitere im CSV \|/);
  assert.match(md, /## In den TEI-Dateien der Zentralen Serien\n\n### archiveLink nennt eine andere Einheit/);
  assert.doesNotMatch(md, /\n\n\n/);
});
