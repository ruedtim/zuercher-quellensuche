// Die Kopie von Matcher und Register unter src/krdb/ muss dem Original in
// apps/web entsprechen: der Indexer läuft auf dem Server aus services/indexer/
// allein (kein Import aus apps/web möglich), die Web-Detailseite rechnet mit dem
// Original – weichen beide ab, passen Detailseite und Personenseiten nicht
// zusammen. Abhilfe: `npm run sync-krdb` (in services/indexer) und mitcommitten.
// Auf dem Server (ohne apps/web) übersprungen.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const COPIES: Array<[string, string]> = [
  ["./krdb/krdbMatch.ts", "../../../apps/web/src/lib/server/krdbMatch.ts"],
  ["./krdb/krdb-register.json", "../../../apps/web/src/lib/server/data/krdb-register.json"],
];

for (const [copy, original] of COPIES) {
  const copyUrl = new URL(copy, import.meta.url);
  const originalUrl = new URL(original, import.meta.url);
  const skip = existsSync(originalUrl) ? false : "apps/web nicht vorhanden (Server-Checkout)";
  test(`${copy} entspricht dem Original in apps/web`, { skip }, () => {
    assert.ok(
      readFileSync(copyUrl).equals(readFileSync(originalUrl)),
      `${copy} weicht ab – im Verzeichnis services/indexer ausführen: npm run sync-krdb`,
    );
  });
}
