import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveIdOf, PlatformIndex, platformIdVariants, type PlatformTarget } from "./platform.ts";

test("Plattform-IDs eines Weblinks: «_t» und Doppelbeschlüsse ohne Bindestrich", () => {
  assert.deepEqual(platformIdVariants("MM_3_41_RRB_1927_1580"), ["MM_3_41_RRB_1927_1580", "MM_3_41_RRB_1927_1580_t"]);
  assert.deepEqual(platformIdVariants("MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812"), [
    "MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812",
    "MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812_t",
    "MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812",
    "MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812_t",
  ]);
  // Seitenbereiche der Amtsblatt-IDs behalten ihren Bindestrich.
  assert.deepEqual(platformIdVariants("ABl_1980__S__1-10_"), ["ABl_1980__S__1-10_", "ABl_1980__S__1-10__t"]);
});

test("archiveId als Zahl oder Text, sonst null", () => {
  assert.equal(archiveIdOf({ archiveId: 460367 }), 460367);
  assert.equal(archiveIdOf({ archiveId: "460367" }), 460367);
  assert.equal(archiveIdOf({ archiveId: null }), null);
  assert.equal(archiveIdOf({}), null);
  assert.equal(archiveIdOf({ archiveId: "x" }), null);
});

const platform = new PlatformIndex([
  { id: "MM_2_3_RRB_1831_0882", series: "RRB", archiveId: 460367 },
  { id: "MM_2_3_RRB_1831_0883", series: "RRB", archiveId: 460367 },
  { id: "MM_3_41_RRB_1927_1580_t", series: "RRB", archiveId: 3848476 },
  { id: "MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812", series: "RRB", archiveId: 631404 },
  { id: "ABl_1996__S__1217-1225_", series: "ABl", archiveId: 5139206 },
  { id: "OS_2__S__313-368__t", series: "OS", archiveId: 777 },
  // Zwei Weblinks auf 1994/1749; das Dokument 1994/1750 nennt die zweite Einheit.
  { id: "MM_3_204_RRB_1994_1749_t", series: "RRB", archiveId: 4183521 },
  { id: "MM_3_204_RRB_1994_1750_t", series: "RRB", archiveId: 4183522 },
]);

test("Stufe 1: Weblink, Varianten, archiveId, fehlt", () => {
  const at = (unitId: number, series: string, id: string) => platform.locate(unitId, { series, id });
  assert.deepEqual(at(460366, "RRB", "MM_2_3_RRB_1831_0882"), { id: "MM_2_3_RRB_1831_0882", series: "RRB", via: "id" });
  assert.deepEqual(at(3848476, "RRB", "MM_3_41_RRB_1927_1580"), { id: "MM_3_41_RRB_1927_1580_t", series: "RRB", via: "variant" });
  assert.deepEqual(at(631404, "RRB", "MM_2_26_RRB_1835_1811_-_MM_2_26_RRB_1835_1812"), {
    id: "MM_2_26_RRB_1835_1811_MM_2_26_RRB_1835_1812",
    series: "RRB",
    via: "variant",
  });
  // Weblink mit falscher ID: das Dokument, das die Einheit nennt.
  assert.deepEqual(at(5139206, "ABl", "ABl_1996__S__1217-1222_"), { id: "ABl_1996__S__1217-1225_", series: "ABl", via: "archiveId" });
  // Nur dieselbe Serie, nur eindeutig.
  assert.equal(at(777, "RRB", "MM_9_RRB_1900_0001"), null);
  assert.equal(at(460367, "RRB", "MM_9_RRB_1900_0001"), null);
  // Nirgends: fehlt auf der Plattform.
  assert.equal(at(3684605, "KRP", "MM_24_60_KRP_1942_086_0798"), null);
});

test("Stufe 2: zwei Weblinks auf ein Dokument, das Dokument stützt den anderen", () => {
  const first = new Map<number, PlatformTarget | null>([
    [4183521, platform.locate(4183521, { series: "RRB", id: "MM_3_204_RRB_1994_1749" })],
    [4183522, platform.locate(4183522, { series: "RRB", id: "MM_3_204_RRB_1994_1749" })],
    [460366, platform.locate(460366, { series: "RRB", id: "MM_2_3_RRB_1831_0882" })],
    [460367, platform.locate(460367, { series: "RRB", id: "MM_2_3_RRB_1831_0883" })],
    [252294, platform.locate(252294, { series: "RRB", id: "MM_2_3_RRB_1831_0883" })],
  ]);
  const located = (id: number) => first.get(id)?.id;
  const settle = (id: number) => platform.settle(id, first.get(id) ?? null, located);
  assert.deepEqual(settle(4183522), { id: "MM_3_204_RRB_1994_1750_t", series: "RRB", via: "switched" });
  assert.deepEqual(settle(4183521), { id: "MM_3_204_RRB_1994_1749_t", series: "RRB", via: "variant" });
  // archiveLink des Dokuments falsch (die genannte Einheit verlinkt ein anderes): Weblink bleibt.
  assert.deepEqual(settle(460366), { id: "MM_2_3_RRB_1831_0882", series: "RRB", via: "id" });
  assert.deepEqual(settle(460367), { id: "MM_2_3_RRB_1831_0883", series: "RRB", via: "id" });
  // Verweis ohne eigenes Dokument (Urkunde zu einem Beschluss): bleibt beim Weblink.
  assert.deepEqual(settle(252294), { id: "MM_2_3_RRB_1831_0883", series: "RRB", via: "id" });
  assert.equal(platform.settle(1, null, located), null);
});
