/**
 * Importiert die Katalog-Dokumente (output/catalog-docs.jsonl.gz) in den
 * Meili-Index `catalog` – bzw. mit `--index=ehedaten` die Eheeinträge
 * (ehedaten-docs.jsonl.gz, Settings aus ehedatenSettings.ts), mit `--index=editions` die
 * Texte der Editionen (editions-docs.jsonl.gz, editionsSettings.ts) –, ohne dass die
 * Suche je einen halben Index sieht:
 * neuer Index `<index>_new`, Settings, Dokumente in Batches (höchstens
 * MAX_IN_FLIGHT Tasks offen), Status jedes Tasks prüfen (meilisearch-js'
 * waitForTask wirft nur bei Timeout, ein abgelehnter Batch verwirft auch seine
 * gültigen Docs), Dokumentzahl abgleichen, dann `swapIndexes` und den alten
 * Index löschen. Bei einem Fehler bleibt der bisherige Index unangetastet.
 *
 * Die Zeilen gehen ungeparst als NDJSON an Meili, in Batches bis --batch Dokumente
 * und --batch-mb Megabyte (Meili nimmt höchstens 100 MB pro Anfrage; eine Einheit
 * mit Vektor wiegt rund 8 KB). Hat der Index einen Embedder, braucht jedes Dokument
 * `_vectors`: fehlt der Schlüssel (Aufbau ohne `refresh.sh embed`), setzt der Import
 * `null` ein und meldet es – die Einheiten sind dann nur lexikalisch zu finden. Ebenso ergänzt
 * er die gefalteten Suchfelder (ß als ss, searchText.ts), wenn die Datei älter ist als sie.
 *
 * Läuft auf Hetzner aus services/catalog allein (keine Imports aus apps/web
 * oder services/krdb):
 *
 *   MEILI_URL=http://localhost:7700 MEILI_MASTER_KEY=… \
 *     npx tsx src/import.ts --input=output/catalog-docs.jsonl.gz [--index=catalog] [--batch=10000] [--batch-mb=40]
 *   MEILI_URL=… MEILI_MASTER_KEY=… npx tsx src/import.ts --input=ehedaten-docs.jsonl.gz --index=ehedaten
 *   MEILI_URL=… MEILI_MASTER_KEY=… npx tsx src/import.ts --input=editions-docs.jsonl.gz --index=editions
 *
 * Welche Settings gelten, sagt `--settings` (catalog | ehedaten | editions); Default ist der
 * Name des Index.
 */

import { MeiliSearch, MeiliSearchApiError, type EnqueuedTask, type Settings } from "meilisearch";
import { readLines } from "./load.ts";
import { EHEDATEN_INDEX_SETTINGS } from "./ehedatenSettings.ts";
import { EDITIONS_INDEX_SETTINGS } from "./editionsSettings.ts";
import { CATALOG_FOLDED_FIELDS, EHEDATEN_FOLDED_FIELDS, foldLine } from "./searchText.ts";
import { CATALOG_INDEX_SETTINGS } from "./settings.ts";

const MAX_IN_FLIGHT = 4;
const SETTINGS: Record<string, Settings> = {
  catalog: CATALOG_INDEX_SETTINGS,
  ehedaten: EHEDATEN_INDEX_SETTINGS,
  editions: EDITIONS_INDEX_SETTINGS,
};
/** Felder mit gefaltetem Suchfeld je Settings; die Editionen falten ihren ganzen Suchtext. */
const FOLDED: Record<string, readonly string[]> = { catalog: CATALOG_FOLDED_FIELDS, ehedaten: EHEDATEN_FOLDED_FIELDS };
const WAIT_MS = Number(process.env.MEILI_TASK_WAIT_S ?? 3600) * 1000;

function arg(name: string, fallback?: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  const v = hit ? hit.slice(name.length + 3) : fallback;
  if (v === undefined) throw new Error(`--${name}=… fehlt`);
  return v;
}

async function main() {
  const host = process.env.MEILI_URL ?? "http://localhost:7700";
  const apiKey = process.env.MEILI_MASTER_KEY;
  if (!apiKey) throw new Error("MEILI_MASTER_KEY fehlt");
  const input = arg("input");
  const uid = arg("index", "catalog");
  const batchSize = Number(arg("batch", "10000"));
  const batchBytes = Number(arg("batch-mb", "40")) * 1024 * 1024;
  const settingsName = arg("settings", uid);
  const settings = SETTINGS[settingsName];
  if (!settings) throw new Error(`--settings=${settingsName}: unbekannt (${Object.keys(SETTINGS).join(" | ")})`);
  const embedders = Object.keys(settings.embedders ?? {});
  const tmp = `${uid}_new`;
  const client = new MeiliSearch({ host, apiKey });

  const settle = async (task: EnqueuedTask | Promise<EnqueuedTask>, what: string) => {
    const t = await client.waitForTask((await task).taskUid, { timeOutMs: WAIT_MS, intervalMs: 500 });
    if (t.status !== "succeeded") {
      throw new Error(`${what}: Task ${t.uid} ${t.status}${t.error ? ` – ${t.error.code}: ${t.error.message}` : ""}`);
    }
    return t;
  };
  const exists = async (name: string) => {
    try {
      await client.getIndex(name);
      return true;
    } catch (err) {
      if (err instanceof MeiliSearchApiError && err.cause?.code === "index_not_found") return false;
      throw err;
    }
  };

  if (await exists(tmp)) await settle(client.deleteIndex(tmp), `Alten ${tmp} löschen`);
  await settle(client.createIndex(tmp, { primaryKey: "id" }), `${tmp} anlegen`);
  await settle(client.index(tmp).updateSettings(settings), "Settings");
  console.log(`[import] ${tmp} angelegt, Settings «${settingsName}» gesetzt`);

  const t0 = Date.now();
  let written = 0;
  let withVector = 0;
  let filledNull = 0;
  let filledFolded = 0;
  let batch: string[] = [];
  let bytes = 0;
  let nextLog = 100_000;
  const inFlight: Array<Promise<unknown>> = [];
  const send = async () => {
    if (batch.length === 0) return;
    const ndjson = batch.join("\n");
    const from = written;
    written += batch.length;
    batch = [];
    bytes = 0;
    inFlight.push(settle(client.index(tmp).addDocumentsFromString(ndjson, "application/x-ndjson"), `Docs ${from}–${written}`));
    if (inFlight.length >= MAX_IN_FLIGHT) await inFlight.shift();
    if (written >= nextLog) {
      console.log(`[import] ${written} gesendet …`);
      nextLog += 100_000;
    }
  };
  try {
    for await (let line of readLines(input)) {
      if (embedders.length > 0 && !line.includes('"_vectors"')) {
        const doc = JSON.parse(line) as Record<string, unknown>;
        doc._vectors = Object.fromEntries(embedders.map((e) => [e, null]));
        doc.embedded = false;
        line = JSON.stringify(doc);
        filledNull++;
      } else if (line.includes('"embedded":true')) withVector++;
      const folded = foldLine(line, FOLDED[settingsName] ?? []);
      if (folded !== line) filledFolded++;
      line = folded;
      batch.push(line);
      bytes += Buffer.byteLength(line) + 1;
      if (batch.length >= batchSize || bytes >= batchBytes) await send();
    }
    await send();
    await Promise.all(inFlight);
  } catch (err) {
    console.error(`[import] Abbruch, ${uid} bleibt unverändert: ${(err as Error).message}`);
    await settle(client.deleteIndex(tmp), `${tmp} aufräumen`).catch(() => undefined);
    throw err;
  }

  const stats = await client.index(tmp).getStats();
  if (stats.numberOfDocuments !== written) {
    await settle(client.deleteIndex(tmp), `${tmp} aufräumen`).catch(() => undefined);
    throw new Error(`Dokumentzahl stimmt nicht: ${stats.numberOfDocuments} im Index, ${written} gelesen – ${uid} bleibt unverändert`);
  }
  if (!(await exists(uid))) await settle(client.createIndex(uid, { primaryKey: "id" }), `${uid} anlegen`);
  await settle(client.swapIndexes([{ indexes: [uid, tmp] }]), "Indexe tauschen");
  await settle(client.deleteIndex(tmp), "Alten Index löschen");
  console.log(`[import] DONE ${written} Dokumente in ${uid} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (filledFolded > 0) console.log(`[import] gefaltete Suchfelder (ß als ss) ergänzt: ${filledFolded} Dokumente`);
  if (embedders.length > 0) {
    console.log(`[import] Vektoren: ${withVector} Einheiten mit Vektor${filledNull > 0 ? `, ${filledNull} ohne _vectors (null ergänzt)` : ""}`);
    if (withVector === 0) console.warn("[import] WARNUNG: keine Vektoren – vor dem Import refresh.sh embed laufen lassen");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
