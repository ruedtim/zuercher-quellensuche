/**
 * Schreibt `_vectors.<embedder>: null` (Opt-out) auf eine ID-Liste – der
 * Pflicht-Backfill, BEVOR ein neuer userProvided-Embedder per Settings-PATCH
 * konfiguriert wird: Meili lehnt den Settings-Task ab, solange auch nur ein
 * Bestands-Doc den `_vectors.<embedder>`-Key nicht trägt (empirisch v1.13,
 * »no vectors provided for document …«). Rohe `_vectors`-Payloads dürfen
 * dagegen schon VOR der Konfiguration geschrieben werden und mergen per
 * Embedder (jina_de bleibt unangetastet).
 *
 * Typischer Einsatz (qwen3_06b, chunks): echte Vektoren für non-late via
 * import-vectors.ts, Null-Opt-out für die late-Chunks hierüber, DANN der
 * Settings-PATCH (ein einziger arroy-Build).
 *
 * Eingabe: JSONL (optional gzipped), pro Zeile ein Objekt mit `id` –
 * z. B. der Output von export-chunk-texts.ts --filter="subset IS NOT NULL".
 *
 * Schutz (importGuards.ts, wie import-vectors.ts): Ein Vorab-Check gleicht
 * alle IDs batchweise gegen den Index ab (`id IN […]` über
 * POST /documents/fetch) und bricht ab, bevor etwas geschrieben ist, wenn
 * IDs fehlen – updateDocuments legte für sie Rumpf-Docs an bzw. liesse ganze
 * Batches scheitern, sobald der Index einen weiteren userProvided-Embedder
 * hat (so auch beim Backfill vor dem Settings-PATCH). `--allow-new-ids`
 * überspringt ihn. Jeder Task wird auf `succeeded` geprüft – waitForTask
 * wirft nur bei Timeout, ein abgelehnter Batch liefe sonst still bis «DONE»
 * durch.
 *
 * Aufruf:
 *   npx tsx src/patch-null-vectors.ts --ids=./late-chunk-ids.jsonl.gz \
 *     --embedder=qwen3_06b --index=chunks
 */

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { MeiliSearch } from "meilisearch";
import { assertTaskSucceeded, findMissingIds } from "./importGuards.ts";
import { MeiliBulkImporter } from "./meili.ts";

// Wie import-vectors.ts: Meili arbeitet Tasks global nacheinander ab, ein
// Batch wartet also auch hinter fremden Tasks (Indexer-Lauf, Chunk-Import).
const TASK_WAIT_MS = 6 * 3_600_000;

// IDs pro Abfrage im Vorab-Check (wie import-vectors.ts).
const ID_CHECK_BATCH = 5_000;

interface CliArgs {
  ids: string;
  embedder: string;
  index: string | null;
  batch: number;
  maxInFlight: number;
  allowNewIds: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = { batch: 5000, maxInFlight: 4, index: null, allowNewIds: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--ids=")) out.ids = arg.slice(6);
    else if (arg.startsWith("--embedder=")) out.embedder = arg.slice(11);
    else if (arg.startsWith("--index=")) out.index = arg.slice(8);
    else if (arg.startsWith("--batch=")) out.batch = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--max-in-flight=")) out.maxInFlight = Number.parseInt(arg.slice(16), 10);
    else if (arg === "--allow-new-ids") out.allowNewIds = true;
    else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!out.ids || !out.embedder) {
    console.error(
      "usage: --ids=<ids.jsonl[.gz]> --embedder=<name> [--index=<uid>] [--batch=5000] [--max-in-flight=4] [--allow-new-ids]",
    );
    process.exit(2);
  }
  return out as CliArgs;
}

interface NullPatch {
  id: string;
  _vectors: Record<string, null>;
}

async function* readJsonl(path: string): AsyncIterable<{ id?: string }> {
  const isGz = path.endsWith(".gz");
  const file = createReadStream(path);
  const stream = isGz ? file.pipe(createGunzip()) : file;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as { id?: string };
  }
}

/** Die Patches, die der Lauf schreibt – Vorab-Check und Patch lesen beide hierüber. */
async function* readPatches(path: string, embedder: string, stats: { skipped: number }): AsyncIterable<NullPatch> {
  for await (const rec of readJsonl(path)) {
    if (!rec.id) {
      stats.skipped++;
      continue;
    }
    yield { id: rec.id, _vectors: { [embedder]: null } };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const idsPath = resolve(args.ids);
  const env = process.env;
  const meiliUrl = env["MEILI_URL"] ?? "http://localhost:7700";
  const masterKey = env["MEILI_MASTER_KEY"] ?? "dev_master_key_change_me";
  const indexUid = args.index ?? env["MEILI_INDEX"] ?? "documents";

  console.log("[patch-null-vectors] config", {
    ids: args.ids,
    meiliUrl,
    indexUid,
    embedder: args.embedder,
    batch: args.batch,
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
    console.log("[patch-null-vectors] kein Vorab-Check (--allow-new-ids): fehlende IDs werden neue Docs");
  } else {
    const meili = new MeiliBulkImporter({ url: meiliUrl, masterKey, indexUid });
    const checkStart = Date.now();
    let batches = 0;
    let seen = 0;
    const report = await findMissingIds(
      readPatches(idsPath, args.embedder, { skipped: 0 }),
      async (ids) => {
        const found = await meili.fetchByIds<{ id: string }>(ids, ["id"]);
        seen += ids.length;
        if (++batches % 20 === 0) console.log(`[patch-null-vectors] Vorab-Check: ${seen} IDs geprüft…`);
        return found;
      },
      { batchSize: ID_CHECK_BATCH },
    );
    if (report.missing > 0) {
      console.error(
        `[patch-null-vectors] ${report.missing} von ${report.checked} IDs fehlen im Index ${indexUid} ` +
          `(z. B. ${report.sample.join(", ")}) – Abbruch, nichts geschrieben. updateDocuments legte ` +
          "für sie Rumpf-Docs {id, _vectors} an bzw. liesse ganze Batches scheitern, sobald der Index " +
          "einen weiteren userProvided-Embedder hat. ID-Liste aus demselben Index exportieren " +
          "(export-chunk-texts.ts) oder bewusst --allow-new-ids.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[patch-null-vectors] Vorab-Check: alle ${report.checked} IDs im Index ` +
        `(${((Date.now() - checkStart) / 1000).toFixed(1)}s)`,
    );
  }

  const startTs = Date.now();
  const stats = { skipped: 0 };
  let buffer: NullPatch[] = [];
  let total = 0;
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
      `[patch-null-vectors] flush: total=${total} elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
    buffer = [];
  };

  for await (const patch of readPatches(idsPath, args.embedder, stats)) {
    buffer.push(patch);
    if (buffer.length >= args.batch) await flush();
  }
  await flush();

  console.log("[patch-null-vectors] waiting for tasks to settle…");
  for (const uid of inFlight) {
    await settle(uid);
  }
  const docsAfter = (await index.getStats()).numberOfDocuments;
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[patch-null-vectors] DONE in ${elapsed}s – total=${total}, skipped=${stats.skipped}` +
      `, numberOfDocuments=${docsAfter} (vorher ${docsBefore})`,
  );
}

main().catch((err) => {
  console.error("[patch-null-vectors] fatal:", err);
  process.exit(1);
});
