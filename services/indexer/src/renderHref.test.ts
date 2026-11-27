/**
 * Linkziele aus der TEI. Lauf: npx tsx --test src/renderHref.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeHref } from "./render.ts";

test("safeHref: Web-Adressen und Verweise ohne Schema bleiben", () => {
  for (const u of [
    "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=244697",
    "http://example.org/a:b",
    "mailto:a@b.ch",
    "/documents/RM/x",
    "#n1",
    "B II 4",
    "../x.xml",
    "",
  ]) {
    assert.equal(safeHref(u), u);
  }
});

test("safeHref: andere Schemata werden zu einem toten Link", () => {
  for (const u of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd"]) {
    assert.equal(safeHref(u), "#", u);
  }
});
