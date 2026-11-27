import { test } from "node:test";
import { strict as assert } from "node:assert";
import { gndOfRef, loadRatRefNames, personRefsOf, ratFacetName, ratRefNames } from "./rmGnd.ts";
import { loadRmNames } from "./rmNames.ts";

test("gndOfRef: Nummer aus @ref, auch neben der HLS-URL und mit X", () => {
  assert.equal(gndOfRef("https://d-nb.info/gnd/143681346 https://hls-dhs-dss.ch/de/articles/018060/"), "143681346");
  assert.equal(gndOfRef("https://d-nb.info/gnd/105381173X https://hls-dhs-dss.ch/de/articles/018165/"), "105381173X");
  assert.equal(gndOfRef("https://d-nb.info/gnd/1074213939"), "1074213939");
  // Zwei Nummern (Transkribus «1089449119 / 136255507»): die erste gilt – so schreibt rmtk sie seit
  // 2026-11-20, und so stand es vorher in einer URL. Ohne Nummer keine GND.
  assert.equal(gndOfRef("https://d-nb.info/gnd/1089449119 https://d-nb.info/gnd/136255507"), "1089449119");
  assert.equal(gndOfRef("https://d-nb.info/gnd/1089449119 /  136255507 https://hls-dhs-dss.ch/de/articles/018087/"), "1089449119");
  assert.equal(gndOfRef("https://d-nb.info/gnd/hls-d143681346143681346 https://hls-dhs-dss.ch/de/articles/018060/"), null);
  assert.equal(gndOfRef("https://hls-dhs-dss.ch/de/articles/018060/"), null);
  assert.equal(gndOfRef(undefined), null);
});

test("personRefsOf: GND, HLS-Artikel und SSRQ-Personen-ID aus @ref", () => {
  assert.deepEqual(
    personRefsOf(
      "https://d-nb.info/gnd/143681346 https://hls-dhs-dss.ch/de/articles/018060/ https://personae.ssrq-sds-fds.ch/?query=per002157",
    ),
    { gnd: "143681346", hls: "018060", ssrq: "per002157" },
  );
  assert.deepEqual(personRefsOf("https://personae.ssrq-sds-fds.ch/?query=per026517a"), { gnd: null, hls: null, ssrq: "per026517a" });
  assert.deepEqual(personRefsOf("https://d-nb.info/gnd/137770006"), { gnd: "137770006", hls: null, ssrq: null });
  // Andere Serien: eine nackte SSRQ-ID oder ein HLS-Link mit Datum ist keine Auszeichnung aus rmtk.
  assert.deepEqual(personRefsOf("per002157"), { gnd: null, hls: null, ssrq: null });
  assert.deepEqual(personRefsOf(null), { gnd: null, hls: null, ssrq: null });
});

test("ratFacetName: Registername vereinheitlicht wie die übrigen RM-Namen", () => {
  const idx = loadRmNames();
  assert.equal(ratFacetName({ first: "Hans Caspar", last: "Escher vom Glas" }, idx), "Hans Kaspar Escher");
  assert.equal(ratFacetName({ first: "Hans Heinrich", last: "Orelli, von" }, idx), "Hans Heinrich von Orelli");
  // Varianten des Vornamens: der erste zählt.
  assert.equal(ratFacetName({ first: "Leonhard, Lienhart", last: "Holzhalb" }, idx), "Leonhard Holzhalb");
  assert.equal(ratFacetName({ first: "Hans", last: "" }, idx), null);
  // Doppelte GND im Register: die erste Person behält sie; die SSRQ-ID gilt daneben.
  const names = ratRefNames(
    [
      { first: "Heinrich", last: "Bräm", gnd: "1", ssrq: "per000001" },
      { first: "Hans", last: "Rahn", gnd: "1", ssrq: "per000002" },
    ],
    idx,
  );
  assert.deepEqual([...names], [["1", "Heinrich Bräm"], ["per000001", "Heinrich Bräm"], ["per000002", "Hans Rahn"]]);
});

test.skip("Register-Kopie: GND und SSRQ der Bürgermeister in den Ratsmanualen haben Namen", () => {
  const names = loadRatRefNames();
  assert.ok(names.size >= 190, `nur ${names.size} Namen`);
  assert.equal(names.get("143681346"), "Hans Heinrich Holzhalb");
  assert.equal(names.get("per002157"), "Hans Heinrich Holzhalb");
  assert.equal(names.get("137770006"), "Hans Heinrich von Orelli");
});
