/**
 * KRP-Gever-Fetcher.
 *
 * Holt Kantonsratsprotokolle ab Mai 1995 aus dem Gever-Web-Service und schreibt
 * pro Sitzung ein TEI-XML nach `<out>/data/KRP/<id>.xml`. Danach indexiert der
 * bestehende Indexer:
 *   cd ../indexer && ZSZH_DATA_DIR=<out> PUBLIC_BASE_URL=https://ihre-adresse.example \
 *     npx tsx src/main.ts --all --series=KRP --skip-embed
 *
 * Aufruf:
 *   npx tsx src/main.ts --out=/tmp/zszh-krp-gever --year=1995 --limit=5   # Sample
 *   npx tsx src/main.ts --out=~/zszh-krp-gever                            # Voller Lückenschluss
 *
 * Flags:
 *   --out=<dir>          Ziel-Wurzel (Pflicht). TEI landet unter <out>/data/KRP/.
 *   --since=<YYYY-MM-DD> Startdatum (Default 1995-05-01).
 *   --until=<YYYY-MM-DD> Enddatum (optional).
 *   --year=<YYYY>        Setzt since/until aufs Jahr (für Sampling).
 *   --limit=<n>          Max. Anzahl verarbeiteter Sitzungen.
 *   --cache=<dir>        PDF-Cache (Default <out>/.cache-pdf).
 *   --concurrency=<n>    Parallele Downloads/Extraktionen (Default 4).
 *   --force              TEI auch neu schreiben, wenn es schon existiert.
 *   --index-only         Nur Sitzungen listen + Metadaten-Artefakte schreiben
 *                        (keine PDFs/TEI) – für Änderungs-Erkennung/Bootstrap.
 *
 * Metadaten-Artefakte (pro Lauf überschrieben, unter <out>/metadata/):
 *   krp_index.jsonl      Eine Zeile pro gesehene Sitzung inkl. pdfVersion
 *                        (CDWS-Versionsnummer = Änderungssignal).
 *   krp_noprotocol.csv   Sitzungen ohne Protokoll-Dokument.
 *   krp_failures.csv     Verarbeitungsfehler dieses Laufs (id, datum, fehler).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { listProtocolSessions } from "./cdws.ts";
import { ensurePdf } from "./download.ts";
import { runPdftotext, cleanToParagraphs } from "./pdftext.ts";
import { segmentProtocol } from "./segment.ts";
import { buildTei, buildTraktandumTei, teiId, teiItemId } from "./tei.ts";

const DEFAULT_SINCE = "1995-05-01";

interface Args {
  out: string;
  since: string;
  until?: string;
  limit?: number;
  cacheDir: string;
  concurrency: number;
  force: boolean;
  segment: boolean;
  late: boolean;
  indexOnly: boolean;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function parseArgs(argv: string[]): Args {
  let out: string | undefined;
  let since = DEFAULT_SINCE;
  let until: string | undefined;
  let limit: number | undefined;
  let cache: string | undefined;
  let concurrency = 4;
  let force = false;
  let segment = true;
  let late = false;
  let indexOnly = false;

  for (const arg of argv.slice(2)) {
    if (arg === "--force") force = true;
    else if (arg === "--no-segment") segment = false;
    else if (arg === "--late") late = true;
    else if (arg === "--index-only") indexOnly = true;
    else if (arg.startsWith("--out=")) out = arg.slice(6);
    else if (arg.startsWith("--since=")) since = arg.slice(8);
    else if (arg.startsWith("--until=")) until = arg.slice(8);
    else if (arg.startsWith("--cache=")) cache = arg.slice(8);
    else if (arg.startsWith("--limit=")) limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--concurrency=")) concurrency = Number.parseInt(arg.slice(14), 10);
    else if (arg.startsWith("--year=")) {
      const y = Number.parseInt(arg.slice(7), 10);
      since = y === 1995 ? DEFAULT_SINCE : `${y}-01-01`;
      until = `${y}-12-31`;
    } else {
      console.error(`unbekanntes Flag: ${arg}`);
      process.exit(2);
    }
  }

  if (!out) {
    console.error("--out=<dir> ist erforderlich");
    process.exit(2);
  }

  const outAbs = resolve(expandHome(out));
  return {
    out: outAbs,
    since,
    until,
    limit,
    cacheDir: resolve(expandHome(cache ?? join(outAbs, ".cache-pdf"))),
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 4,
    force,
    segment,
    late,
    indexOnly,
  };
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  console.log("[krp-gever] config", {
    out: args.out,
    since: args.since,
    until: args.until ?? "(offen)",
    limit: args.limit ?? "(alle)",
    cacheDir: args.cacheDir,
    concurrency: args.concurrency,
    force: args.force,
    segment: args.segment,
    late: args.late,
  });

  const krpDir = args.late
    ? join(args.out, "data", "KRP", "KRP_late")
    : join(args.out, "data", "KRP");
  await mkdir(krpDir, { recursive: true });
  await mkdir(args.cacheDir, { recursive: true });

  console.log("[krp-gever] liste Sitzungen…");
  const noProtocolRows: string[] = ["date,session_title"];
  let sessions = await listProtocolSessions({
    since: args.since,
    until: args.until,
    onProgress: (loaded, total) => {
      if (loaded % 400 === 0 || loaded === total)
        console.log(`[krp-gever]   geladen ${loaded}/${total}`);
    },
    onSkipNoProtocol: (sessionTitle, date) => {
      noProtocolRows.push([date ?? "", sessionTitle].map(csvCell).join(","));
    },
  });
  const noProtocol = noProtocolRows.length - 1;
  console.log(
    `[krp-gever] ${sessions.length} Sitzungen mit Protokoll (${noProtocol} ohne Protokoll übersprungen)`,
  );

  // Metadaten-Artefakte: vollständige Sicht des Laufs (vor --limit), damit
  // Änderungs-Erkennung/Bootstrap die pdfVersion aller Sitzungen sehen.
  const metaDir = join(args.out, "metadata");
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    join(metaDir, "krp_index.jsonl"),
    sessions.map((s) => JSON.stringify(s) + "\n").join(""),
    "utf-8",
  );
  await writeFile(join(metaDir, "krp_noprotocol.csv"), noProtocolRows.join("\n") + "\n", "utf-8");
  console.log(`[krp-gever] Index-Artefakt: ${join(metaDir, "krp_index.jsonl")}`);

  if (args.indexOnly) {
    console.log("[krp-gever] --index-only: keine PDFs/TEI, fertig.");
    return;
  }

  if (args.limit !== undefined) sessions = sessions.slice(0, args.limit);

  const stats = { segmented: 0, fallback: 0, items: 0, resumed: 0, emptyText: 0, failed: 0 };
  const failureRows: string[] = ["id,date,error"];
  const startTs = Date.now();

  // Einfacher Worker-Pool mit begrenzter Parallelität.
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= sessions.length) return;
      const s = sessions[i];
      const wholeId = teiId(s);
      try {
        // Resume: bereits erzeugt (Ganz-Sitzung ODER erstes Traktandum)?
        if (
          !args.force &&
          ((await exists(join(krpDir, `${wholeId}.xml`))) ||
            (await exists(join(krpDir, `${teiItemId(s, 1)}.xml`))))
        ) {
          stats.resumed++;
          continue;
        }
        const pdfPath = await ensurePdf(s, { cacheDir: args.cacheDir });
        const rawText = await runPdftotext(pdfPath);

        const seg = args.segment ? segmentProtocol(rawText) : { ok: false as const };
        if (seg.ok && seg.items.length > 0) {
          await Promise.all(
            seg.items.map((t) =>
              writeFile(join(krpDir, `${teiItemId(s, t.nr)}.xml`), buildTraktandumTei(s, t), "utf-8"),
            ),
          );
          stats.segmented++;
          stats.items += seg.items.length;
        } else {
          // Fallback: ein Dokument pro Sitzung.
          const paragraphs = cleanToParagraphs(rawText);
          if (paragraphs.length === 0) {
            stats.emptyText++;
            console.warn(`[krp-gever] leerer Textlayer: ${wholeId} (${s.date}) – TEI nur mit Metadaten`);
          }
          await writeFile(join(krpDir, `${wholeId}.xml`), buildTei(s, paragraphs), "utf-8");
          stats.fallback++;
          stats.items += 1;
        }
        const done = stats.segmented + stats.fallback + stats.resumed + stats.failed;
        if (done % 50 === 0)
          console.log(
            `[krp-gever] fortschritt: seg=${stats.segmented} fallback=${stats.fallback} ` +
              `items=${stats.items} resumed=${stats.resumed} failed=${stats.failed} ` +
              `(${done}/${sessions.length}, ${((Date.now() - startTs) / 1000).toFixed(0)}s)`,
          );
      } catch (err) {
        stats.failed++;
        failureRows.push([wholeId, s.date, String(err)].map(csvCell).join(","));
        console.error(`[krp-gever] FAIL ${wholeId} (${s.date}):`, String(err));
      }
    }
  };

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  await writeFile(join(metaDir, "krp_failures.csv"), failureRows.join("\n") + "\n", "utf-8");
  if (stats.failed > 0)
    console.log(`[krp-gever] Fehlerprotokoll: ${join(metaDir, "krp_failures.csv")}`);

  console.log(
    `[krp-gever] DONE in ${((Date.now() - startTs) / 1000).toFixed(1)}s – ` +
      `segmented=${stats.segmented} fallback=${stats.fallback} items=${stats.items} ` +
      `resumed=${stats.resumed} emptyText=${stats.emptyText} failed=${stats.failed} noProtocol=${noProtocol}`,
  );
  console.log(`[krp-gever] TEI-Ausgabe: ${krpDir}`);
  console.log(
    `[krp-gever] Indexieren:\n  cd ../indexer && ZSZH_DATA_DIR=${args.out} ` +
      `RENDER_OUTPUT_DIR=$(pwd)/output PUBLIC_BASE_URL=https://zentraleserien.ch ` +
      `MEILI_URL=http://localhost:7700 MEILI_MASTER_KEY=<key> ` +
      `npx tsx src/main.ts --all --series=KRP --skip-embed`,
  );
}

main().catch((err) => {
  console.error("[krp-gever] fatal:", err);
  process.exit(1);
});
