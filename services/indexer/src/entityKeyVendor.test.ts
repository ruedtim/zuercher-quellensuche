// Die Kopie der Vergleichsschlüssel unter src/vendor/ muss dem Original in
// apps/web entsprechen: der Indexer läuft auf dem Server aus services/indexer/
// allein (kein Import aus apps/web möglich), die Web-App rechnet die Schlüssel der
// Filterwerte mit dem Original – weichen beide ab, findet ein Namensfilter die
// Varianten nicht mehr (personKeys/placeKeys/orgKeys, lib/entityFilter.ts).
// Abhilfe: `npm run sync-entity-key` (in services/indexer), mitcommitten und die
// Schlüssel per --patch-entity-keys neu schreiben. Auf dem Server (ohne apps/web)
// übersprungen.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const copyUrl = new URL("./vendor/entityKey.ts", import.meta.url);
const originalUrl = new URL("../../../apps/web/src/lib/entityKey.ts", import.meta.url);
const skip = existsSync(originalUrl) ? false : "apps/web nicht vorhanden (Server-Checkout)";

test("./vendor/entityKey.ts entspricht dem Original in apps/web", { skip }, () => {
  assert.ok(
    readFileSync(copyUrl).equals(readFileSync(originalUrl)),
    "./vendor/entityKey.ts weicht ab – im Verzeichnis services/indexer ausführen: npm run sync-entity-key",
  );
});
