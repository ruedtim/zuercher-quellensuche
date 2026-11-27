/**
 * Importiert import-fertige Chunk-Records (Output von transform-chunks.ts)
 * in den Meili-Index `chunks` – legt den Index inkl. Settings an, falls er
 * fehlt, und lädt via addDocuments in Batches.
 *
 * Im Unterschied zu import-vectors.ts: gedrosselte Task-Pipeline (max. 4
 * Batches in-flight) – die arroy-Vektorindexierung ist langsam, hunderte
 * gequeuete Tasks würden Meili nur Memory kosten, ohne schneller zu sein.
 * Gemessen 2026-09-25 (1.6M Chunks, zwei Embedder): jeder Meili-Batch kostet
 * ~7,5 min fix plus ~10 ms pro Chunk (2'000 → 452 s, 8'000 → 521 s) – für
 * Nachläufe von Zehntausenden Chunks darum `--batch=10000` o. ä. wählen.
 *
 * Settings gehen nur bei echter Abweichung raus (settingsDrift.ts), und jeder
 * Task wird auf `succeeded` geprüft – waitForTask wirft nur bei Timeout, ein
 * fehlgeschlagener Batch liefe sonst still durch.
 *
 * Aufruf (auf Hetzner):
 *   MEILI_URL=… MEILI_MASTER_KEY=… nohup npx tsx src/import-chunks.ts \
 *     --input=~/chunks-import.jsonl.gz > ~/import-chunks.log 2>&1 &
 */

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { MeiliSearch } from "meilisearch";
import { CHUNK_INDEX_SETTINGS } from "./meili.ts";
import { settingsDrift } from "./settingsDrift.ts";

// Grosszügig: Meili arbeitet Tasks global nacheinander ab, ein Batch wartet
// also auch hinter fremden Tasks (Indexer-Lauf, Löschungen); eine echte
// Settings-Änderung indexiert den ganzen Chunk-Index neu (Stunden).
const TASK_WAIT_MS = 6 * 3_600_000;

interface CliArgs {
  input: string;
  batch: number;
  maxInFlight: number;
  skip: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = { batch: 2000, maxInFlight: 4, skip: 0 };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--input=")) out.input = arg.slice(8);
    else if (arg.startsWith("--batch=")) out.batch = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--max-in-flight=")) out.maxInFlight = Number.parseInt(arg.slice(16), 10);
    else if (arg.startsWith("--skip=")) out.skip = Number.parseInt(arg.slice(7), 10);
    else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!out.input) {
    console.error(
      "usage: --input=<chunks-import.jsonl[.gz]> [--batch=2000] [--max-in-flight=4] [--skip=N]",
    );
    process.exit(2);
  }
  return out as CliArgs;
}

async function* readJsonl(path: string): AsyncIterable<Record<string, unknown>> {
  const isGz = path.endsWith(".gz");
  const file = createReadStream(path);
  const stream = isGz ? file.pipe(createGunzip()) : file;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as Record<string, unknown>;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const env = process.env;
  const meiliUrl = env["MEILI_URL"] ?? "http://localhost:7700";
  const masterKey = env["MEILI_MASTER_KEY"] ?? "dev_master_key_change_me";
  const indexUid = env["MEILI_CHUNK_INDEX"] ?? "chunks";

  console.log("[import-chunks] config", {
    input: args.input,
    meiliUrl,
    indexUid,
    batch: args.batch,
    maxInFlight: args.maxInFlight,
  });

  const client = new MeiliSearch({ host: meiliUrl, apiKey: masterKey });

  // Wartet auf einen Task und bricht ab, wenn er nicht `succeeded` ist.
  const settle = async (uid: number, intervalMs = 1000) => {
    const task = await client.waitForTask(uid, { timeOutMs: TASK_WAIT_MS, intervalMs });
    if (task.status !== "succeeded") {
      throw new Error(`Task ${uid} (${task.type}) ${task.status}: ${task.error?.message ?? "ohne Fehlermeldung"}`);
    }
  };

  const open = await client.getTasks({ statuses: ["enqueued", "processing"], limit: 1 });
  if (open.total > 0) {
    console.log(`[import-chunks] Hinweis: ${open.total} offene Meili-Tasks – die Batches reihen sich dahinter ein`);
  }

  // Index + Settings sicherstellen (idempotent).
  const indexes = await client.getIndexes({ limit: 100 });
  if (!indexes.results.some((i) => i.uid === indexUid)) {
    const task = await client.createIndex(indexUid, { primaryKey: "id" });
    await settle(task.taskUid);
    console.log("[import-chunks] Index angelegt:", indexUid);
  }
  const index = client.index(indexUid);
  // Auch ein No-op-Settings-Task wartet hinter allen offenen Tasks – am
  // 2026-06-26 brach daran (damals 10-min-Timeout) der ganze Import ab.
  const drift = settingsDrift(await index.getSettings(), CHUNK_INDEX_SETTINGS);
  if (drift.length === 0) {
    console.log("[import-chunks] Settings unverändert – kein Settings-Task");
  } else {
    console.log("[import-chunks] Settings weichen ab:", drift.join(", "));
    const settingsTask = await index.updateSettings(CHUNK_INDEX_SETTINGS);
    await settle(settingsTask.taskUid, 10_000);
    console.log("[import-chunks] Settings angewendet");
  }

  const startTs = Date.now();
  let buffer: Record<string, unknown>[] = [];
  let total = 0;
  const inFlight: number[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    // Drossel: warten bis < maxInFlight Tasks offen sind.
    while (inFlight.length >= args.maxInFlight) {
      const uid = inFlight.shift();
      if (uid != null) await settle(uid);
    }
    const task = await index.addDocuments(buffer, { primaryKey: "id" });
    inFlight.push(task.taskUid);
    total += buffer.length;
    const rate = total / ((Date.now() - startTs) / 1000);
    console.log(
      `[import-chunks] enqueued total=${total} (${rate.toFixed(0)}/s submit), inFlight=${inFlight.length}`,
    );
    buffer = [];
  };

  // --skip=N: Resume nach Unterbruch – die ersten N Zeilen überspringen
  // (addDocuments ist idempotent, ein kleiner Überlapp am Resume-Punkt
  // schadet nicht; N am besten = numberOfDocuments minus Sicherheitsmarge).
  let lineNo = 0;
  let skipped = 0;
  for await (const rec of readJsonl(resolve(args.input))) {
    lineNo++;
    if (lineNo <= args.skip) {
      skipped++;
      if (skipped % 200_000 === 0) console.log(`[import-chunks] übersprungen: ${skipped}`);
      continue;
    }
    // Backfill: ältere transform-Outputs (vor dem qwen3_06b-Embedder) tragen
    // den Key noch nicht – Meili lehnt addDocuments ohne alle konfigurierten
    // userProvided-Embedder-Keys ab.
    const vectors = rec["_vectors"] as Record<string, unknown> | undefined;
    if (vectors && !("qwen3_06b" in vectors)) vectors["qwen3_06b"] = null;
    buffer.push(rec);
    if (buffer.length >= args.batch) await flush();
  }
  if (skipped > 0) console.log(`[import-chunks] insgesamt übersprungen: ${skipped}`);
  await flush();

  console.log("[import-chunks] warte auf verbleibende Tasks…");
  for (const uid of inFlight) {
    await settle(uid);
  }

  const stats = (await index.getStats()) as unknown as {
    numberOfDocuments: number;
    numberOfEmbeddings?: number;
    isIndexing: boolean;
  };
  const elapsed = ((Date.now() - startTs) / 60_000).toFixed(1);
  console.log(
    `[import-chunks] DONE in ${elapsed}min – numberOfDocuments=${stats.numberOfDocuments}, numberOfEmbeddings=${stats.numberOfEmbeddings}, isIndexing=${stats.isIndexing}`,
  );
}

main().catch((err) => {
  console.error("[import-chunks] fatal:", err);
  process.exit(1);
});
