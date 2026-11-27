import { test } from "node:test";
import assert from "node:assert/strict";
import { documentEntityClause, editionEntityClause, entityClause, keysOf, variantFormsInHit } from "./entityFilter";
import { placeKey } from "./entityKey";

const q = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

test("entityClause: Form oder Schlüssel, ohne Schlüssel nur die Form", () => {
  assert.equal(entityClause([], "places", "placeKeys", placeKey, q), null);
  assert.equal(entityClause(["Fischental"], "places", "placeKeys", placeKey, q), "(places IN ['Fischental'] OR placeKeys IN ['fischental'])");
  assert.equal(entityClause(["Fischental"], "places", null, placeKey, q), "places IN ['Fischental']");
  assert.equal(entityClause(["12"], "places", "placeKeys", placeKey, q), "places IN ['12']");
});

test("keysOf: ohne Dubletten und ohne Werte ohne Schlüssel", () => {
  assert.deepEqual(keysOf(["Fischental", "Fischenthal", "12"], placeKey), ["fischental"]);
});

test("documentEntityClause: Fassung 2, nur wenn der Index die Schlüssel trägt", () => {
  assert.equal(
    documentEntityClause("organizations", ["Stadt", "Staat"], true, q),
    "(organizations IN ['Stadt', 'Staat'] OR orgKeys IN ['stat', 'staat'])",
  );
  assert.equal(documentEntityClause("persons", ["Meier"], true, q), "persons IN ['Meier']");
  assert.equal(documentEntityClause("persons", ["Hans Frey"], false, q), "persons IN ['Hans Frey']");
  assert.equal(documentEntityClause("persons", ["Frey, Hans"], true, q), "(persons IN ['Frey, Hans'] OR personKeys IN ['hans frei'])");
  assert.equal(documentEntityClause("places", ["O'Neill"], true, q), "(places IN ['O\\'Neill'] OR placeKeys IN ['o neil'])");
});

test("editionEntityClause: Fassung 1, Organisationen heissen orgs", () => {
  const dq = (v: string) => `"${v}"`;
  assert.equal(editionEntityClause("organizations", ["Rat"], dq), '(orgs IN ["Rat"] OR orgKeys IN ["rat"])');
  assert.equal(editionEntityClause("organizations", ["Staat"], dq), '(orgs IN ["Staat"] OR orgKeys IN ["stat"])');
  // Namensvettern mit Lebensjahren: nur exakt, sonst träfe der Schlüssel auch den Reformator.
  assert.equal(editionEntityClause("persons", ["Ulrich Zwingli (1556–1601)"], dq), 'persons IN ["Ulrich Zwingli (1556–1601)"]');
  assert.equal(
    editionEntityClause("persons", ["Ulrich Zwingli (1556–1601)", "Heinrich Bullinger"], dq),
    '(persons IN ["Ulrich Zwingli (1556–1601)", "Heinrich Bullinger"] OR personKeys IN ["heinrich bulinger"])',
  );
});

test("variantFormsInHit: Formen des Treffers mit dem Schlüssel eines gewählten Namens", () => {
  const hit = { places: ["Fischenthal", "Bauma", "Fischental"], persons: ["Meier", "Hans Frey"] };
  assert.deepEqual(variantFormsInHit(hit, { places: ["Fischental"] }), ["Fischenthal"]);
  assert.deepEqual(variantFormsInHit(hit, { persons: ["Hans Frei"], places: [] }), ["Hans Frey"]);
  assert.deepEqual(variantFormsInHit(hit, { persons: ["Meier"] }), [], "ohne Schlüssel keine Varianten");
  assert.deepEqual(variantFormsInHit({}, { places: ["Fischental"] }), []);
});
