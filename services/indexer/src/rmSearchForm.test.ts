import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { rmSearchForm } from "./rmSearchForm.ts";

const golden = JSON.parse(
  readFileSync(new URL("./rmSearchForm.golden.json", import.meta.url), "utf-8"),
) as { cases: Array<[string, string]> };

test("rmSearchForm: gleiche Ergebnisse wie die Python-Fassung (Golden-Vektoren)", () => {
  assert.ok(golden.cases.length >= 10);
  for (const [input, expected] of golden.cases) {
    assert.equal(rmSearchForm(input), expected, `Eingabe: ${input}`);
  }
});

test("rmSearchForm: Nasalstrich, Ausnahmen, Umlaute, Schilling", () => {
  assert.equal(rmSearchForm("kom\u0305en dan\u0304"), "kommen dann");
  assert.equal(rmSearchForm("am\u0305tman\u0305"), "amtmann");
  assert.equal(rmSearchForm("zusam\u0305en gehorsam\u0305en"), "zusammen gehorsamen");
  assert.equal(rmSearchForm("u\u0364ber Zürich"), "über Zürich");
  assert.equal(rmSearchForm("daß 3 ß."), "dass 3 ß.");
});
