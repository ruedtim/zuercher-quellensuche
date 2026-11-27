import { test } from "node:test";
import { strict as assert } from "node:assert";
import { settingsDrift } from "./settingsDrift.ts";
import { CHUNK_INDEX_SETTINGS } from "./meili.ts";

// GET /indexes/chunks/settings auf Prod (2026-09-25, searchCutoffMs neu 2026-11): Meili liefert die
// filterableAttributes sortiert und ergänzt Defaults (faceting, typoTolerance …).
const PROD_CHUNK_SETTINGS = {
  displayedAttributes: ["id", "docId", "series", "title", "date", "dateYear", "stazhIdent", "subset", "chunkText"],
  searchableAttributes: ["chunkText", "title"],
  filterableAttributes: ["dateYear", "docId", "id", "series", "subset"],
  sortableAttributes: ["date"],
  rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
  stopWords: [],
  nonSeparatorTokens: [],
  separatorTokens: [],
  dictionary: [],
  synonyms: {},
  distinctAttribute: null,
  proximityPrecision: "byWord",
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
    disableOnWords: [],
    disableOnAttributes: [],
  },
  faceting: { maxValuesPerFacet: 100, sortFacetValuesBy: { "*": "alpha" } },
  pagination: { maxTotalHits: 100000 },
  embedders: {
    jina_de: { source: "userProvided", dimensions: 768 },
    qwen3_06b: { source: "userProvided", dimensions: 1024 },
  },
  searchCutoffMs: 10_000,
  localizedAttributes: null,
  facetSearch: true,
  prefixSearch: "indexingTime",
};

test("CHUNK_INDEX_SETTINGS gegen den Prod-Stand: kein Drift", () => {
  assert.deepEqual(settingsDrift(PROD_CHUNK_SETTINGS, CHUNK_INDEX_SETTINGS), []);
});

test("Mengen-Listen reihenfolgeunabhängig, echte Listen exakt", () => {
  const cur = { filterableAttributes: ["a", "b"], searchableAttributes: ["x", "y"] };
  assert.deepEqual(settingsDrift(cur, { filterableAttributes: ["b", "a"] }), []);
  assert.deepEqual(settingsDrift(cur, { filterableAttributes: ["a", "b", "c"] }), ["filterableAttributes"]);
  assert.deepEqual(settingsDrift(cur, { searchableAttributes: ["y", "x"] }), ["searchableAttributes"]);
});

test("Embedder: neuer oder geänderter Eintrag ist Drift, zusätzlicher im Index nicht", () => {
  const cur = { embedders: { jina_de: { source: "userProvided", dimensions: 768 } } };
  const qwen = { source: "userProvided", dimensions: 1024 };
  assert.deepEqual(settingsDrift(cur, { embedders: { jina_de: { source: "userProvided", dimensions: 768 }, qwen3_06b: qwen } }), ["embedders"]);
  assert.deepEqual(settingsDrift(cur, { embedders: { jina_de: { source: "userProvided", dimensions: 512 } } }), ["embedders"]);
  assert.deepEqual(settingsDrift({ embedders: { ...cur.embedders, qwen3_06b: qwen } }, cur), []);
});

test("verschachtelte Objekte mergen, sortFacetValuesBy wird ersetzt", () => {
  const cur = PROD_CHUNK_SETTINGS;
  assert.deepEqual(settingsDrift(cur, { typoTolerance: { minWordSizeForTypos: { oneTypo: 5 } } }), []);
  assert.deepEqual(settingsDrift(cur, { typoTolerance: { minWordSizeForTypos: { oneTypo: 4 } } }), ["typoTolerance"]);
  assert.deepEqual(settingsDrift(cur, { faceting: { sortFacetValuesBy: { "*": "alpha" } } }), []);
  assert.deepEqual(settingsDrift(cur, { faceting: { sortFacetValuesBy: { "*": "alpha", persons: "count" } } }), ["faceting"]);
});

test("Skalare, null und undefined", () => {
  assert.deepEqual(settingsDrift({ searchCutoffMs: null }, { searchCutoffMs: 10_000 }), ["searchCutoffMs"]);
  assert.deepEqual(settingsDrift({ searchCutoffMs: 10_000 }, { searchCutoffMs: 10_000 }), []);
  assert.deepEqual(settingsDrift({ distinctAttribute: null }, { distinctAttribute: null }), []);
  assert.deepEqual(settingsDrift({}, { searchCutoffMs: undefined }), []);
  assert.deepEqual(settingsDrift({}, { pagination: { maxTotalHits: 100000 } }), ["pagination"]);
});
