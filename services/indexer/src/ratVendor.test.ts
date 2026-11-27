// Die Kopie des Registers «Kleiner Rat» unter src/rat/ muss dem Original in apps/web entsprechen: Der
// Indexer läuft auf dem Server aus services/indexer allein (kein Import aus apps/web möglich) und nimmt
// daraus die Namen der GND-Personen der Ratsmanuale (rmGnd.ts); die Web-Detailseite verlinkt dieselben
// GND mit dem Original. Weichen beide ab, passen Facette und Personenkarte nicht zusammen. Abhilfe:
// `npm run sync-rat` (in services/indexer) und mitcommitten. Auf dem Server (ohne apps/web) übersprungen.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const copyUrl = new URL("./rat/rat-register.json", import.meta.url);
const originalUrl = new URL("../../../apps/web/src/lib/server/data/rat-register.json", import.meta.url);
const skip = existsSync(originalUrl) ? false : "apps/web nicht vorhanden (Server-Checkout)";

test("./rat/rat-register.json entspricht dem Original in apps/web", { skip }, () => {
  assert.ok(
    readFileSync(copyUrl).equals(readFileSync(originalUrl)),
    "./rat/rat-register.json weicht ab – im Verzeichnis services/indexer ausführen: npm run sync-rat",
  );
});
