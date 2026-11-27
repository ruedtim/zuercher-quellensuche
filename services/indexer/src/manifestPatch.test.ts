import { test } from "node:test";
import { strict as assert } from "node:assert";
import { diffManifestUrls } from "./manifestPatch.ts";

const PUBLIC = "https://zentraleserien.ch/iiif/ABl/A/manifest.json";
const LOCAL = "http://localhost:5173/iiif/ABl/A/manifest.json";
const EXTERNAL = "https://zszh.sources-online.org/manifests/KRP/x/info.json";

test("diffManifestUrls: localhost → öffentlich wird gepatcht", () => {
  const d = diffManifestUrls([{ id: "A", manifestUrl: PUBLIC }], [{ id: "A", manifestUrl: LOCAL }]);
  assert.deepEqual(d.changes, [{ id: "A", manifestUrl: PUBLIC }]);
  assert.equal(d.fromLocalhost, 1);
  assert.deepEqual(d.other, []);
});

test("diffManifestUrls: gleicher Stand wird nicht gepatcht, fehlendes Feld zählt als null", () => {
  const d = diffManifestUrls(
    [
      { id: "A", manifestUrl: PUBLIC },
      { id: "B", manifestUrl: EXTERNAL },
      { id: "C", manifestUrl: null },
      { id: "D", manifestUrl: null },
    ],
    [
      { id: "A", manifestUrl: PUBLIC },
      { id: "B", manifestUrl: EXTERNAL },
      { id: "C", manifestUrl: null },
      { id: "D" },
    ],
  );
  assert.deepEqual(d.changes, []);
  assert.equal(d.unchanged, 4);
});

test("diffManifestUrls: Docs ohne Meili-Eintrag werden übersprungen, nicht angelegt", () => {
  const d = diffManifestUrls(
    [
      { id: "neu", manifestUrl: PUBLIC },
      { id: "A", manifestUrl: PUBLIC },
    ],
    [{ id: "A", manifestUrl: LOCAL }],
  );
  assert.deepEqual(d.missing, ["neu"]);
  assert.deepEqual(d.changes.map((c) => c.id), ["A"]);
});

test("diffManifestUrls: Änderungen ohne localhost landen in `other`", () => {
  const d = diffManifestUrls(
    [
      { id: "weg", manifestUrl: null },
      { id: "ext", manifestUrl: EXTERNAL },
    ],
    [
      { id: "weg", manifestUrl: PUBLIC },
      { id: "ext", manifestUrl: null },
    ],
  );
  assert.equal(d.changes.length, 2);
  assert.equal(d.fromLocalhost, 0);
  assert.deepEqual(d.other, [
    { id: "weg", old: PUBLIC, next: null },
    { id: "ext", old: null, next: EXTERNAL },
  ]);
});
