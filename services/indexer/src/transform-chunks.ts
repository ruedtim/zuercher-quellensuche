/**
 * Transformiert exportierte Chunk-Zeilen (Weaviate-Export des früheren Stacks dieser Plattform
 * bzw. frisch gechunkte _late-Docs) in import-fertige Meili-Records für den
 * `chunks`-Index – inkl. Mapping auf die Doc-IDs des neuen `documents`-Index.
 *
 * Modi:
 *   Standard:      Input = export_weaviate.py-Zeilen ({identifier, stazh_ident,
 *                  chunk_text, link, vector, …}); Mapping via stazh_ident
 *                  (whitespace-normalisiert), Fallback Link-Stamm (±"_t").
 *   --enrich-only: Input hat bereits {docId, seq, chunkText, vector}
 *                  (services/chunker-Output); nur Metadaten-Anreicherung.
 *
 * Metadaten (series/title/date/dateYear/subset/stazhIdent) kommen in beiden
 * Modi aus dem NEUEN documents-Index – garantiert Filter-/Anzeige-Konsistenz.
 *
 * Aufruf (auf Hetzner, neben Meili):
 *   MEILI_URL=… MEILI_MASTER_KEY=… npx tsx src/transform-chunks.ts \
 *     --input=~/weaviate-chunks.jsonl.gz --out=~/chunks-import.jsonl.gz
 */

import { createReadStream, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip, createGzip } from "node:zlib";
import { MeiliSearch } from "meilisearch";

interface CliArgs {
  input: string;
  out: string;
  unmatchedOut: string;
  enrichOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = { enrichOnly: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--input=")) out.input = arg.slice(8);
    else if (arg.startsWith("--out=")) out.out = arg.slice(6);
    else if (arg.startsWith("--unmatched=")) out.unmatchedOut = arg.slice(12);
    else if (arg === "--enrich-only") out.enrichOnly = true;
    else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!out.input || !out.out) {
    console.error(
      "usage: --input=<export.jsonl[.gz]> --out=<chunks-import.jsonl.gz> [--unmatched=<file>] [--enrich-only]",
    );
    process.exit(2);
  }
  out.unmatchedOut ??= out.out.replace(/\.jsonl(\.gz)?$/, "") + ".unmatched.jsonl.gz";
  return out as CliArgs;
}

/** Zeile aus export_weaviate.py (Standard-Modus). */
interface ExportRecord {
  identifier?: string;
  stazh_ident?: string;
  title?: string;
  date?: string | null;
  year?: number | null;
  series?: string;
  chunk_text?: string;
  link?: string | null;
  vector?: number[];
  // --enrich-only-Modus (services/chunker-Output):
  docId?: string;
  seq?: number;
  chunkText?: string;
}

interface DocMeta {
  id: string;
  series: string;
  title: string;
  date: string | null;
  dateYear: number | null;
  stazhIdent: string | null;
  subset: string | null;
}

function normIdent(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function* readJsonl(path: string): AsyncIterable<ExportRecord> {
  const isGz = path.endsWith(".gz");
  const file = createReadStream(path);
  const stream = isGz ? file.pipe(createGunzip()) : file;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as ExportRecord;
  }
}

/** Gzip-JSONL-Writer mit Backpressure. */
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

async function buildDocLookup(client: MeiliSearch, indexUid: string) {
  const index = client.index(indexUid);
  const byStazhIdent = new Map<string, DocMeta>();
  const byId = new Map<string, DocMeta>();
  const pageSize = 20_000;
  let offset = 0;
  for (;;) {
    const res = (await index.getDocuments({
      fields: ["id", "series", "title", "date", "dateYear", "stazhIdent", "subset"],
      limit: pageSize,
      offset,
    })) as unknown as { results: DocMeta[]; total: number };
    for (const doc of res.results) {
      byId.set(doc.id, doc);
      if (doc.stazhIdent) {
        const key = normIdent(doc.stazhIdent);
        // Bei Kollisionen gewinnt der erste – Kollisionen werden gezählt.
        if (byStazhIdent.has(key)) collidedIdents++;
        else byStazhIdent.set(key, doc);
      }
    }
    offset += res.results.length;
    console.log(`[lookup] ${offset}/${res.total} Docs geladen`);
    if (offset >= res.total || res.results.length === 0) break;
  }
  return { byStazhIdent, byId };
}

let collidedIdents = 0;

async function main() {
  const args = parseArgs(process.argv);
  const env = process.env;
  const client = new MeiliSearch({
    host: env["MEILI_URL"] ?? "http://localhost:7700",
    apiKey: env["MEILI_MASTER_KEY"] ?? "dev_master_key_change_me",
  });
  const docsIndexUid = env["MEILI_INDEX"] ?? "documents";

  console.log("[transform] baue Doc-Lookup aus", docsIndexUid);
  const { byStazhIdent, byId } = await buildDocLookup(client, docsIndexUid);
  console.log(
    `[transform] Lookup: ${byId.size} Docs, ${byStazhIdent.size} stazhIdent-Keys, ${collidedIdents} Kollisionen`,
  );

  const out = jsonlGzWriter(resolve(args.out));
  const unmatchedOut = jsonlGzWriter(resolve(args.unmatchedOut));

  // Chunk-Sequenz pro Doc. Im Standard-Modus ist die Original-Reihenfolge der
  // Chunks im Weaviate-Export verloren (Iterator-Reihenfolge ist arbiträr) –
  // seq dient nur der ID-Eindeutigkeit, die Textposition liefert später das
  // Alignment. Im --enrich-only-Modus kommt die echte seq aus dem Input.
  const seqByDoc = new Map<string, number>();

  const matchedBy = { stazhIdent: 0, linkStem: 0, docId: 0 };
  const matchedBySeries = new Map<string, number>();
  const unmatchedBySeries = new Map<string, number>();
  let total = 0;
  let unmatched = 0;
  const startTs = Date.now();

  const resolveDoc = (rec: ExportRecord): DocMeta | null => {
    if (args.enrichOnly) {
      if (!rec.docId) return null;
      const doc = byId.get(rec.docId) ?? null;
      if (doc) matchedBy.docId++;
      return doc;
    }
    if (rec.stazh_ident) {
      const doc = byStazhIdent.get(normIdent(rec.stazh_ident));
      if (doc) {
        matchedBy.stazhIdent++;
        return doc;
      }
    }
    // Fallback: Link-Stamm. Alte Links wie
    // https://www.zentraleserien.zh.ch/krp/MM_24_49_KRP_1912_021_0132_t –
    // neue IDs existieren mit UND ohne "_t"-Suffix, beide Varianten probieren.
    const stem = rec.link?.split("/").pop()?.trim();
    if (stem) {
      const candidates = [stem, stem.endsWith("_t") ? stem.slice(0, -2) : `${stem}_t`];
      for (const c of candidates) {
        const doc = byId.get(c);
        if (doc) {
          matchedBy.linkStem++;
          return doc;
        }
      }
    }
    return null;
  };

  for await (const rec of readJsonl(resolve(args.input))) {
    total++;
    const chunkText = (args.enrichOnly ? rec.chunkText : rec.chunk_text)?.trim();
    const vector = rec.vector;
    const doc = resolveDoc(rec);
    if (!doc || !chunkText || !Array.isArray(vector) || vector.length !== 768) {
      unmatched++;
      const series = (rec.series ?? rec.docId?.split("_")[0] ?? "?").toUpperCase();
      unmatchedBySeries.set(series, (unmatchedBySeries.get(series) ?? 0) + 1);
      await unmatchedOut.write(rec);
      continue;
    }

    let seq: number;
    if (args.enrichOnly && typeof rec.seq === "number") {
      seq = rec.seq;
    } else {
      seq = seqByDoc.get(doc.id) ?? 0;
      seqByDoc.set(doc.id, seq + 1);
    }

    await out.write({
      id: `${doc.id}_c${String(seq).padStart(4, "0")}`,
      docId: doc.id,
      series: doc.series,
      title: doc.title,
      date: doc.date,
      dateYear: doc.dateYear,
      stazhIdent: doc.stazhIdent,
      subset: doc.subset ?? null,
      chunkText,
      // Meili verlangt bei konfiguriertem userProvided-Embedder den Key bei
      // addDocuments (ggf. null). qwen3_06b bleibt für late-Chunks bewusst
      // leer – die Qwen-Vektoren (nur Staatsarchiv-Bestand) kommen separat
      // via import-vectors.ts --embedder=qwen3_06b.
      _vectors: { jina_de: vector, qwen3_06b: null },
    });
    matchedBySeries.set(doc.series, (matchedBySeries.get(doc.series) ?? 0) + 1);

    if (total % 50_000 === 0) {
      console.log(
        `[transform] ${total} Zeilen, unmatched=${unmatched}, elapsed=${((Date.now() - startTs) / 1000).toFixed(0)}s`,
      );
    }
  }

  await out.close();
  await unmatchedOut.close();

  const pct = total > 0 ? (((total - unmatched) / total) * 100).toFixed(2) : "0";
  console.log(`\n[transform] FERTIG: ${total} Chunks, ${total - unmatched} gematcht (${pct} %)`);
  console.log("[transform] matched by:", matchedBy);
  console.log("[transform] gematcht pro Serie:", Object.fromEntries(matchedBySeries));
  console.log("[transform] unmatched pro Serie:", Object.fromEntries(unmatchedBySeries));
}

main().catch((err) => {
  console.error("[transform] fatal:", err);
  process.exit(1);
});
