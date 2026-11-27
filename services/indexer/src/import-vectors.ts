/**
 * Importiert Embeddings (z. B. aus Colab/MPS/Hetzner-Batch) in einen
 * bestehenden Meilisearch-Index.
 *
 * Eingabe: JSONL (optional gzipped) mit `{id, vector: [floats]}` pro Zeile
 *          (alternativ `vectors.<embedder>` / `_vectors.<embedder>`).
 * Aktion: Partial-Update via PUT /indexes/.../documents – Meili merget die
 *         `_vectors.<embedder>`-Property in die existierenden Docs; andere
 *         Embedder (z. B. jina_de) bleiben unangetastet.
 *
 * Schutz (importGuards.ts): Ein Vorab-Check liest alle Input-IDs, gleicht sie
 * batchweise gegen den Index ab (`id IN […]` über POST /documents/fetch) und
 * bricht ab, bevor etwas geschrieben ist, wenn IDs fehlen – updateDocuments
 * legte für sie Rumpf-Docs an bzw. liesse ganze Batches scheitern.
 * `--allow-new-ids` überspringt ihn. Jeder Task wird auf `succeeded` geprüft –
 * waitForTask wirft nur bei Timeout, ein abgelehnter Batch liefe sonst still
 * bis «DONE» durch.
 *
 * Aufruf:
 *   npx tsx src/import-vectors.ts --input=./vectors.jsonl.gz
 *   npx tsx src/import-vectors.ts --input=./qwen3-chunk-vectors.jsonl.gz \
 *     --embedder=qwen3_06b --index=chunks --dims=1024 --max-in-flight=4
 */

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { MeiliSearch } from "meilisearch";
import { assertTaskSucceeded, findMissingIds } from "./importGuards.ts";
import { MeiliBulkImporter } from "./meili.ts";

// Wie import-chunks: Meili arbeitet Tasks global nacheinander ab, ein Batch
// wartet also auch hinter fremden Tasks (Indexer-Lauf, Chunk-Import).
const TASK_WAIT_MS = 6 * 3_600_000;

// IDs pro Abfrage im Vorab-Check (≈ 150 KB Filter; auf 300k Docs < 0,1 s).
const ID_CHECK_BATCH = 5_000;

interface CliArgs {
  input: string;
  batch: number;
  embedder: string;
  index: string | null;
  dims: number | null;
  maxInFlight: number;
  allowNewIds: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = {
    batch: 5000,
    embedder: "jina_de",
    index: null,
    dims: null,
    maxInFlight: 4,
    allowNewIds: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--input=")) out.input = arg.slice(8);
    else if (arg.startsWith("--batch=")) out.batch = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--embedder=")) out.embedder = arg.slice(11);
    else if (arg.startsWith("--index=")) out.index = arg.slice(8);
    else if (arg.startsWith("--dims=")) out.dims = Number.parseInt(arg.slice(7), 10);
    else if (arg.startsWith("--max-in-flight=")) out.maxInFlight = Number.parseInt(arg.slice(16), 10);
    else if (arg === "--allow-new-ids") out.allowNewIds = true;
    else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!out.input) {
    console.error(
      "usage: --input=<vectors.jsonl[.gz]> [--batch=5000] [--embedder=jina_de] [--index=<uid>] [--dims=N] [--max-in-flight=4] [--allow-new-ids]",
    );
    process.exit(2);
  }
  return out as CliArgs;
}

interface InputRecord {
  id: string;
  vector?: number[];
  vectors?: Record<string, number[] | undefined>;
  _vectors?: Record<string, number[] | undefined>;
}

interface MeiliPatch {
  id: string;
  _vectors: Record<string, number[]>;
}

interface SkipStats {
  skipped: number;
  dimMismatch: number;
}

function extractVector(rec: InputRecord, embedder: string): number[] | null {
  if (Array.isArray(rec.vector)) return rec.vector;
  if (rec.vectors?.[embedder]) return rec.vectors[embedder] ?? null;
  if (rec._vectors?.[embedder]) return rec._vectors[embedder] ?? null;
  return null;
}

async function* readJsonl(path: string): AsyncIterable<InputRecord> {
  const isGz = path.endsWith(".gz");
  const file = createReadStream(path);
  const stream = isGz ? file.pipe(createGunzip()) : file;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as InputRecord;
  }
}

/** Die Patches, die der Import schreibt – Vorab-Check und Import lesen beide hierüber. */
async function* readPatches(path: string, args: CliArgs, stats: SkipStats): AsyncIterable<MeiliPatch> {
  for await (const rec of readJsonl(path)) {
    const vec = extractVector(rec, args.embedder);
    if (!rec.id || !vec) {
      stats.skipped++;
      continue;
    }
    if (args.dims != null && vec.length !== args.dims) {
      stats.dimMismatch++;
      stats.skipped++;
      continue;
    }
    yield { id: rec.id, _vectors: { [args.embedder]: vec } };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = resolve(args.input);

  const env = process.env;
  const meiliUrl = env["MEILI_URL"] ?? "http://localhost:7700";
  const masterKey = env["MEILI_MASTER_KEY"] ?? "dev_master_key_change_me";
  const indexUid = args.index ?? env["MEILI_INDEX"] ?? "documents";

  console.log("[import-vectors] config", {
    inputPath,
    meiliUrl,
    indexUid,
    embedder: args.embedder,
    dims: args.dims,
    batchSize: args.batch,
    maxInFlight: args.maxInFlight,
    allowNewIds: args.allowNewIds,
  });

  const client = new MeiliSearch({ host: meiliUrl, apiKey: masterKey });
  const index = client.index(indexUid);

  // Wartet auf einen Task und bricht ab, wenn er nicht `succeeded` ist.
  const settle = async (uid: number) => {
    assertTaskSucceeded(await client.waitForTask(uid, { timeOutMs: TASK_WAIT_MS, intervalMs: 1000 }));
  };

  // Wirft bei fehlendem Index – updateDocuments legte ihn sonst still an
  // (Tippfehler in --index), auch mit --allow-new-ids.
  const docsBefore = (await index.getStats()).numberOfDocuments;

  if (args.allowNewIds) {
    console.log("[import-vectors] kein Vorab-Check (--allow-new-ids): fehlende IDs werden neue Docs");
  } else {
    const meili = new MeiliBulkImporter({ url: meiliUrl, masterKey, indexUid });
    const checkStart = Date.now();
    let batches = 0;
    let seen = 0;
    const report = await findMissingIds(
      readPatches(inputPath, args, { skipped: 0, dimMismatch: 0 }),
      async (ids) => {
        const found = await meili.fetchByIds<{ id: string }>(ids, ["id"]);
        seen += ids.length;
        if (++batches % 20 === 0) console.log(`[import-vectors] Vorab-Check: ${seen} IDs geprüft…`);
        return found;
      },
      { batchSize: ID_CHECK_BATCH },
    );
    if (report.missing > 0) {
      console.error(
        `[import-vectors] ${report.missing} von ${report.checked} IDs fehlen im Index ${indexUid} ` +
          `(z. B. ${report.sample.join(", ")}) – Abbruch, nichts geschrieben. updateDocuments legte ` +
          "für sie Rumpf-Docs {id, _vectors} an bzw. liesse bei mehreren userProvided-Embeddern " +
          "ganze Batches scheitern. Erst die Docs importieren (Chunks: import-chunks.ts) oder " +
          "bewusst --allow-new-ids.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[import-vectors] Vorab-Check: alle ${report.checked} IDs im Index ` +
        `(${((Date.now() - checkStart) / 1000).toFixed(1)}s)`,
    );
  }

  const startTs = Date.now();
  const stats: SkipStats = { skipped: 0, dimMismatch: 0 };
  let buffer: MeiliPatch[] = [];
  let total = 0;
  // Drossel wie import-chunks: die arroy-Vektorindexierung ist langsam –
  // hunderte gequeuete Tasks (= GB an Update-Files auf Disk) bringen nichts.
  const inFlight: number[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    while (inFlight.length >= args.maxInFlight) {
      const uid = inFlight.shift();
      if (uid != null) await settle(uid);
    }
    const task = await index.updateDocuments(buffer, { primaryKey: "id" });
    inFlight.push(task.taskUid);
    total += buffer.length;
    console.log(
      `[import-vectors] flush: total=${total} skipped=${stats.skipped} inFlight=${inFlight.length} elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
    buffer = [];
  };

  for await (const patch of readPatches(inputPath, args, stats)) {
    buffer.push(patch);
    if (buffer.length >= args.batch) await flush();
  }
  await flush();

  console.log("[import-vectors] waiting for tasks to settle…");
  for (const uid of inFlight) {
    await settle(uid);
  }

  const after = await index.getStats();
  const numEmbeddings = (after as unknown as { numberOfEmbeddings?: number }).numberOfEmbeddings ?? 0;
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[import-vectors] DONE in ${elapsed}s – total=${total}, skipped=${stats.skipped}` +
      (stats.dimMismatch > 0 ? ` (davon ${stats.dimMismatch} Dimensions-Mismatch)` : "") +
      `, numberOfEmbeddings=${numEmbeddings}, numberOfDocuments=${after.numberOfDocuments} (vorher ${docsBefore})`,
  );
}

main().catch((err) => {
  console.error("[import-vectors] fatal:", err);
  process.exit(1);
});
