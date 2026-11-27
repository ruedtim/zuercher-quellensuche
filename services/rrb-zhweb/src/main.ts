/**
 * RRB-zh.ch-Fetcher.
 *
 * Holt die ab Okt. 2008 auf zh.ch publizierten Regierungsratsbeschlüsse (Serie
 * RRB) und schreibt pro Beschluss ein TEI-XML nach
 * `<out>/data/RRB/RRB_late/<id>.xml`. Danach indexiert der bestehende Indexer:
 *   cd ../indexer && ZSZH_DATA_DIR=<out> PUBLIC_BASE_URL=https://ihre-adresse.example \
 *     npx tsx src/main.ts --all --series=RRB --skip-embed
 *
 * Phasen:
 *   1. Index (zh.ch-JSON paginieren → metadata/rrb_index.jsonl + .csv)
 *   2. PDFs (nach <cache>/<year>/RRB-<year>-<NNNN>.pdf, Resume)
 *   3. TEI  (pdftotext → Absätze → TEI ohne <figure>)
 *
 * Aufruf:
 *   npx tsx src/main.ts --out=/tmp/zszh-rrb --from-year=2026 --limit=20   # Sample
 *   npx tsx src/main.ts --out=~/zszh-rrb                                  # Vollbestand
 *   npx tsx src/main.ts --out=~/zszh-rrb --tei-only \
 *     --cache=~/rrb-pdfs       # nur TEI aus vorhandenen PDFs
 *
 * Flags:
 *   --out=<dir>          Ziel-Wurzel (Pflicht). TEI landet unter <out>/data/RRB/RRB_late/.
 *   --cache=<dir>        PDF-Root (Default <out>/pdfs). Auf RRB_scrape/data/pdfs zeigbar.
 *   --from-year=<YYYY>   Frühestes Jahr (inkl.).
 *   --to-year=<YYYY>     Spätestes Jahr (inkl.).
 *   --limit=<n>          Max. Anzahl verarbeiteter Beschlüsse.
 *   --concurrency=<n>    Parallele pdftotext-Läufe (Default 4).
 *   --force              TEI auch neu schreiben, wenn es schon existiert.
 *   --scrape-only        Nur Index + PDFs, kein TEI.
 *   --tei-only           Nur TEI aus vorhandenem Index + PDFs (kein Netz).
 *   --delay=<s>          Pause zwischen PDF-Downloads (Default 0.5).
 *   --index-delay=<s>    Pause zwischen Index-Seiten (Default 0.2).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  buildIndex,
  downloadPdfs,
  loadIndex,
  resolvePdfPath,
  type RrbEntry,
} from "./scrape.ts";
import { runPdftotext, cleanToParagraphs } from "./pdftext.ts";
import { buildRrbTei, teiId } from "./tei.ts";

interface Args {
  out: string;
  cacheDir: string;
  fromYear?: number;
  toYear?: number;
  limit?: number;
  concurrency: number;
  force: boolean;
  scrapeOnly: boolean;
  teiOnly: boolean;
  pdfDelayMs: number;
  indexDelayMs: number;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function parseArgs(argv: string[]): Args {
  let out: string | undefined;
  let cache: string | undefined;
  let fromYear: number | undefined;
  let toYear: number | undefined;
  let limit: number | undefined;
  let concurrency = 4;
  let force = false;
  let scrapeOnly = false;
  let teiOnly = false;
  let pdfDelay = 0.5;
  let indexDelay = 0.2;

  for (const arg of argv.slice(2)) {
    if (arg === "--force") force = true;
    else if (arg === "--scrape-only") scrapeOnly = true;
    else if (arg === "--tei-only") teiOnly = true;
    else if (arg.startsWith("--out=")) out = arg.slice(6);
    else if (arg.startsWith("--cache=")) cache = arg.slice(8);
    else if (arg.startsWith("--from-year=")) fromYear = Number.parseInt(arg.slice(12), 10);
    else if (arg.startsWith("--to-year=")) toYear = Number.parseInt(arg.slice(10), 10);
    else if (arg.startsWith("--limit=")) limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--concurrency=")) concurrency = Number.parseInt(arg.slice(14), 10);
    else if (arg.startsWith("--delay=")) pdfDelay = Number.parseFloat(arg.slice(8));
    else if (arg.startsWith("--index-delay=")) indexDelay = Number.parseFloat(arg.slice(14));
    else {
      console.error(`unbekanntes Flag: ${arg}`);
      process.exit(2);
    }
  }

  if (!out) {
    console.error("--out=<dir> ist erforderlich");
    process.exit(2);
  }
  if (scrapeOnly && teiOnly) {
    console.error("--scrape-only und --tei-only schliessen sich aus");
    process.exit(2);
  }

  const outAbs = resolve(expandHome(out));
  return {
    out: outAbs,
    cacheDir: resolve(expandHome(cache ?? join(outAbs, "pdfs"))),
    fromYear,
    toYear,
    limit,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 4,
    force,
    scrapeOnly,
    teiOnly,
    pdfDelayMs: pdfDelay * 1000,
    indexDelayMs: indexDelay * 1000,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function buildTei(args: Args, entries: RrbEntry[]): Promise<void> {
  const teiDir = join(args.out, "data", "RRB", "RRB_late");
  await mkdir(teiDir, { recursive: true });

  const todo = args.limit ? entries.slice(0, args.limit) : entries;
  const stats = { written: 0, resumed: 0, emptyText: 0, noPdf: 0, failed: 0 };
  const startTs = Date.now();

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= todo.length) return;
      const e = todo[i];
      const id = teiId(e);
      try {
        if (!args.force && (await exists(join(teiDir, `${id}.xml`)))) {
          stats.resumed++;
          continue;
        }
        const pdfPath = await resolvePdfPath(args.cacheDir, e);
        if (!pdfPath) {
          stats.noPdf++;
          continue;
        }
        const paragraphs = cleanToParagraphs(await runPdftotext(pdfPath));
        if (paragraphs.length === 0) {
          stats.emptyText++;
          console.warn(`[rrb-zhweb] leerer Textlayer: ${id} (${e.session_date}) – TEI nur mit Metadaten`);
        }
        await writeFile(join(teiDir, `${id}.xml`), buildRrbTei(e, paragraphs), "utf-8");
        stats.written++;
        const done = stats.written + stats.resumed + stats.noPdf + stats.failed;
        if (done % 200 === 0) {
          console.log(
            `[rrb-zhweb] TEI: written=${stats.written} resumed=${stats.resumed} ` +
              `noPdf=${stats.noPdf} failed=${stats.failed} ` +
              `(${done}/${todo.length}, ${((Date.now() - startTs) / 1000).toFixed(0)}s)`,
          );
        }
      } catch (err) {
        stats.failed++;
        console.error(`[rrb-zhweb] FAIL ${id} (${e.session_date}):`, String(err));
      }
    }
  };

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  console.log(
    `[rrb-zhweb] TEI DONE in ${((Date.now() - startTs) / 1000).toFixed(1)}s – ` +
      `written=${stats.written} resumed=${stats.resumed} emptyText=${stats.emptyText} ` +
      `noPdf=${stats.noPdf} failed=${stats.failed}`,
  );
  console.log(`[rrb-zhweb] TEI-Ausgabe: ${teiDir}`);
}

async function main() {
  const args = parseArgs(process.argv);
  console.log("[rrb-zhweb] config", {
    out: args.out,
    cacheDir: args.cacheDir,
    fromYear: args.fromYear ?? "(alle)",
    toYear: args.toYear ?? "(offen)",
    limit: args.limit ?? "(alle)",
    concurrency: args.concurrency,
    force: args.force,
    mode: args.scrapeOnly ? "scrape-only" : args.teiOnly ? "tei-only" : "full",
  });

  const metaDir = join(args.out, "metadata");

  let entries: RrbEntry[];
  if (args.teiOnly) {
    entries = await loadIndex(metaDir);
    console.log(`[rrb-zhweb] Index geladen: ${entries.length} Einträge`);
    if (args.fromYear !== undefined) entries = entries.filter((e) => e.year >= args.fromYear!);
    if (args.toYear !== undefined) entries = entries.filter((e) => e.year <= args.toYear!);
  } else {
    entries = await buildIndex({
      metaDir,
      fromYear: args.fromYear,
      toYear: args.toYear,
      order: "descending",
      orderBy: "session_date",
      delayMs: args.indexDelayMs,
    });
    if (entries.length > 0) {
      await downloadPdfs(entries, {
        pdfRoot: args.cacheDir,
        metaDir,
        delayMs: args.pdfDelayMs,
        limit: args.limit,
      });
    }
  }

  if (args.scrapeOnly) {
    console.log("[rrb-zhweb] --scrape-only: TEI-Phase übersprungen.");
    return;
  }

  await buildTei(args, entries);

  console.log(
    `[rrb-zhweb] Indexieren:\n  cd ../indexer && ZSZH_DATA_DIR=${args.out} ` +
      `RENDER_OUTPUT_DIR=$(pwd)/output PUBLIC_BASE_URL=https://zentraleserien.ch ` +
      `MEILI_URL=http://localhost:7700 MEILI_MASTER_KEY=<key> MEILI_INDEX=documents ` +
      `npx tsx src/main.ts --all --series=RRB --skip-embed`,
  );
}

main().catch((err) => {
  console.error("[rrb-zhweb] fatal:", err);
  process.exit(1);
});
