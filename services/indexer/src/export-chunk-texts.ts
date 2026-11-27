/**
 * Exportiert Chunk-Texte aus dem Meili-`chunks`-Index als JSONL.gz – Input für
 * den Qwen3-Embedding-Batch (services/chunker/qwen-embed/embed_chunks_qwen.py).
 *
 * Default-Filter `subset IS NULL` = nur der Staatsarchiv-Bestand (ohne die
 * born-digital-Teilbestände krp-late/rrb-late/os-late) – das Embed-Ziel für
 * das MCP-Werkzeug vector_search. Der Index ist die kanonische Quelle: die
 * exportierten IDs sind 1:1 die Import-Ziele für import-vectors.ts.
 *
 * Aufruf (auf Hetzner, neben Meili):
 *   MEILI_URL=… MEILI_MASTER_KEY=… nohup npx tsx src/export-chunk-texts.ts \
 *     --out=~/chunks-nonlate.jsonl.gz > /tmp/export-chunks.log 2>&1 &
 */

import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { createGzip } from "node:zlib";
import { MeiliSearch } from "meilisearch";

interface CliArgs {
  out: string;
  filter: string;
  limit: number | null;
  pageSize: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = { filter: "subset IS NULL", limit: null, pageSize: 10_000 };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--out=")) out.out = arg.slice(6);
    else if (arg.startsWith("--filter=")) out.filter = arg.slice(9);
    else if (arg.startsWith("--limit=")) out.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--page-size=")) out.pageSize = Number.parseInt(arg.slice(12), 10);
    else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!out.out) {
    console.error(
      'usage: --out=<chunks.jsonl.gz> [--filter="subset IS NULL"] [--limit=N] [--page-size=10000]',
    );
    process.exit(2);
  }
  return out as CliArgs;
}

/** Gzip-JSONL-Writer mit Backpressure (Muster transform-chunks.ts). */
function jsonlGzWriter(path: string) {
  const gzip = createGzip();
  gzip.pipe(createWriteStream(path));
  return {
    async write(obj: unknown) {
      if (!gzip.write(JSON.stringify(obj) + "\n")) {
        await new Promise<void>((res) => gzip.once("drain", () => res()));
      }
    },
    async close() {
      await new Promise<void>((res, rej) => {
        gzip.end(() => res());
        gzip.once("error", rej);
      });
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const env = process.env;
  const client = new MeiliSearch({
    host: env["MEILI_URL"] ?? "http://localhost:7700",
    apiKey: env["MEILI_MASTER_KEY"] ?? "dev_master_key_change_me",
  });
  const indexUid = env["MEILI_CHUNK_INDEX"] ?? "chunks";
  const index = client.index(indexUid);

  console.log("[export-chunks] config", {
    out: args.out,
    indexUid,
    filter: args.filter,
    limit: args.limit,
    pageSize: args.pageSize,
  });

  const out = jsonlGzWriter(resolve(args.out));
  const startTs = Date.now();
  let written = 0;
  let reportedTotal = 0;
  let offset = 0;

  for (;;) {
    // Mit `filter` nutzt der Client POST /documents/fetch – `total` ist die
    // exakte Grösse der gefilterten Menge (kein estimate).
    const res = (await index.getDocuments({
      fields: ["id", "chunkText"],
      filter: args.filter,
      limit: args.pageSize,
      offset,
    } as Parameters<typeof index.getDocuments>[0])) as unknown as {
      results: Array<{ id: string; chunkText?: string }>;
      total: number;
    };
    reportedTotal = res.total;
    for (const rec of res.results) {
      await out.write({ id: rec.id, chunkText: rec.chunkText ?? "" });
      written++;
      if (args.limit != null && written >= args.limit) break;
    }
    offset += res.results.length;
    const elapsed = ((Date.now() - startTs) / 1000).toFixed(0);
    console.log(`[export-chunks] ${written}/${reportedTotal} exportiert (${elapsed}s)`);
    if (args.limit != null && written >= args.limit) break;
    if (offset >= res.total || res.results.length === 0) break;
  }

  await out.close();
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[export-chunks] DONE in ${elapsed}s – ${written} Zeilen (Meili-total für Filter: ${reportedTotal})`,
  );
  if (args.limit == null && written !== reportedTotal) {
    console.warn(
      `[export-chunks] WARNUNG: geschriebene Zeilen (${written}) ≠ Meili-total (${reportedTotal})`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[export-chunks] fatal:", err);
  process.exit(1);
});
