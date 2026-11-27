import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { diffEntityKeys, entityKeyFields, sameKeys, type StoredEntityDoc } from "./entityKeyFields.ts";

test("entityKeyFields: Varianten ergeben einen Schlüssel, ohne Dubletten, sortiert", () => {
  assert.deepEqual(
    entityKeyFields({
      persons: ["Hans Frey", "Frey, Hans", "Carl Müller", "Karl Mueller", "Hans Frei"],
      places: ["Zürich", "Fischenthal", "Stadt Zürich", "Fischental"],
      organizations: ["Regierungsrath", "Escher Wyss & Cie.", "Regierungsrat"],
    }),
    {
      personKeys: ["hans frei", "karl muler"],
      placeKeys: ["fischental", "zurich"],
      orgKeys: ["escher wis und ko", "regierungsrat"],
    },
  );
});

test("entityKeyFields: Formen ohne Schlüssel fallen weg, ohne Formen leere Listen (RM)", () => {
  assert.deepEqual(
    entityKeyFields({ persons: ["Meier", "Herr Statthalter Billeter"], places: ["12"], organizations: ["AG"] }),
    { personKeys: [], placeKeys: [], orgKeys: [] },
  );
  assert.deepEqual(entityKeyFields({ persons: [], places: [], organizations: [] }), { personKeys: [], placeKeys: [], orgKeys: [] });
  assert.deepEqual(entityKeyFields({ persons: null }), { personKeys: [], placeKeys: [], orgKeys: [] });
});

test("entityKeyFields: Fassung 2 – Staat ≠ Stadt, Zürich II ≠ Zürich I, Kanton bleibt, nur ZH fällt", () => {
  assert.deepEqual(entityKeyFields({ organizations: ["Stadt", "Staat"] }).orgKeys, ["staat", "stat"]);
  assert.deepEqual(entityKeyFields({ places: ["Zürich II", "Zürich I"] }).placeKeys, ["zurich i", "zurich ii"]);
  assert.deepEqual(entityKeyFields({ places: ["Kanton Zürich", "Kt. Zürich", "Kantons Zürich", "Zürich"] }).placeKeys, [
    "kanton zurich",
    "zurich",
  ]);
  assert.deepEqual(entityKeyFields({ places: ["Pfäffikon ZH", "Pfäffikon", "Pfäffikon SZ"] }).placeKeys, ["pfafikon", "pfafikon sz"]);
  assert.deepEqual(entityKeyFields({ places: ["Wädensweil", "Wädenswil", "Sankt Gallen", "St. Gallen"] }).placeKeys, [
    "st galen",
    "wadenswil",
  ]);
});

test("sameKeys: fehlendes Feld ≠ leere Liste, sonst exakt in der Reihenfolge", () => {
  assert.ok(!sameKeys(undefined, []));
  assert.ok(!sameKeys(null, []));
  assert.ok(sameKeys([], []));
  assert.ok(sameKeys(["a", "b"], ["a", "b"]));
  assert.ok(!sameKeys(["b", "a"], ["a", "b"]));
  assert.ok(!sameKeys(["a"], ["a", "b"]));
  assert.ok(!sameKeys(["a", "c"], ["a", "b"]));
});

test("diffEntityKeys: fehlend, abweichend, gleich – Patch nur mit id und den drei Feldern", () => {
  const docs: StoredEntityDoc[] = [
    // Nie geschrieben (auch ohne Namen: das leere Feld muss existieren).
    { id: "neu", persons: [], places: ["Fischenthal"], organizations: [] },
    { id: "leer", persons: [], places: [], organizations: [] },
    // Teilweise geschrieben.
    { id: "halb", persons: ["Hans Frey"], places: [], organizations: [], personKeys: ["hans frei"] },
    // Geschrieben, aber mit altem Schlüssel (Fassung 1 fasste «Staat» zu «stat»).
    { id: "alt", persons: [], places: [], organizations: ["Staat"], personKeys: [], placeKeys: [], orgKeys: ["stat"] },
    // Aktuell.
    { id: "ok", persons: ["Hans Frey"], places: [], organizations: [], personKeys: ["hans frei"], placeKeys: [], orgKeys: [] },
  ];
  const diff = diffEntityKeys(docs);
  assert.deepEqual(
    { missing: diff.missing, changed: diff.changed, unchanged: diff.unchanged, withKeys: diff.withKeys },
    { missing: 3, changed: 1, unchanged: 1, withKeys: 4 },
  );
  assert.deepEqual(diff.patches, [
    { id: "neu", personKeys: [], placeKeys: ["fischental"], orgKeys: [] },
    { id: "leer", personKeys: [], placeKeys: [], orgKeys: [] },
    { id: "halb", personKeys: ["hans frei"], placeKeys: [], orgKeys: [] },
    { id: "alt", personKeys: [], placeKeys: [], orgKeys: ["staat"] },
  ]);
  assert.deepEqual(diffEntityKeys([]), { patches: [], missing: 0, changed: 0, unchanged: 0, withKeys: 0 });
});

// Die Web-App bildet die Schlüssel der Filterwerte selbst (lib/entityFilter.ts) und
// filtert über DOCUMENT_KEY_FIELD – Indexer und Filter müssen dieselben Felder mit
// denselben Schlüsseln meinen. Dynamischer Import: tsc (NodeNext) folgt ihm nicht,
// die Web-Module importieren ohne Dateiendung (tsx löst das auf; entityFilter.ts
// bleibt dafür bis auf ./entityKey import-frei). Auf dem Server (ohne apps/web)
// übersprungen.
const WEB_FILTER = new URL("../../../apps/web/src/lib/entityFilter.ts", import.meta.url);
const skipWeb = existsSync(WEB_FILTER) ? false : "apps/web nicht vorhanden (Server-Checkout)";

test("entityKeyFields = Schlüssel der Web-App (entityFilter.ts)", { skip: skipWeb }, async () => {
  type Dim = "persons" | "places" | "organizations";
  const web = (await import(WEB_FILTER.href)) as {
    ENTITY_DIMS: readonly Dim[];
    DOCUMENT_KEY_FIELD: Record<Dim, string>;
    keysOf: (values: readonly string[], keyOf: (v: string) => string | null) => string[];
    documentEntityKey: (dim: Dim, value: string) => string | null;
  };
  const forms: Record<Dim, string[]> = {
    persons: [
      "Hans Frey", "Frey, Hans", "Hans Frei", "Meier", "Herr Statthalter Billeter", "Dr. Willy Hochuli",
      "W. Hochuli", "Jürg Sulser", "Carl Müller", "Karl Mueller", "Escher (v. Glas), Hans Konrad", "Leana Reich Isler",
    ],
    places: [
      "Fischenthal", "Fischental", "Stadt Zürich", "Zürich", "Kanton Zürich", "Kt. Zürich", "Kantons Zürich",
      "Wädensweil", "Wädenswil", "Pfäffikon ZH", "Pfäffikon SZ", "St. Gallen", "Sankt Gallen", "Zürich II",
      "Zürich I", "12", "Weil", "Bez. Hinweil", "Amt Grüningen", "Oetwil a. S.",
    ],
    organizations: [
      "Stadt", "Staat", "Escher Wyss & Cie.", "Escher Wyss und Co", "Regierungsrat", "Regierungsrath", "AG", "SBB",
      "Direktion des Innern", "Kantonsrat", "Schweizerische Kreditanstalt",
    ],
  };
  const fields = entityKeyFields(forms);
  const ours: Record<Dim, string[]> = { persons: fields.personKeys, places: fields.placeKeys, organizations: fields.orgKeys };
  const fieldNames: Record<Dim, keyof typeof fields> = { persons: "personKeys", places: "placeKeys", organizations: "orgKeys" };
  assert.deepEqual([...web.ENTITY_DIMS].sort(), ["organizations", "persons", "places"]);
  for (const dim of web.ENTITY_DIMS) {
    assert.equal(web.DOCUMENT_KEY_FIELD[dim], fieldNames[dim], `Feldname für ${dim}`);
    const expected = web.keysOf(forms[dim], (v) => web.documentEntityKey(dim, v)).sort();
    assert.deepEqual(ours[dim], expected, `Schlüssel für ${dim}`);
    // Jede einzelne Form findet ihren Schlüssel im Feld (so filtert die Web-App).
    for (const form of forms[dim]) {
      const key = web.documentEntityKey(dim, form);
      if (key) assert.ok(ours[dim].includes(key), `${form} → ${key}`);
    }
  }
});
