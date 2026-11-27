/**
 * ZSZH-Indexer-Pipeline.
 *
 * Aufruf:
 *   npx tsx src/main.ts --all
 *   npx tsx src/main.ts --limit=50          # 50 Docs pro Serie
 *   npx tsx src/main.ts --series=ABl --limit=20
 *   npx tsx src/main.ts --since=<git-sha>   # Inkrementell
 *   npx tsx src/main.ts --dry-run --limit=5  # Kein Meili/embed-Push
 *   npx tsx src/main.ts --patch-manifests --series=ABl  # nur manifestUrl + ABl-Manifeste
 *   npx tsx src/main.ts --patch-krdb         # nur krdbIds/krdbTitleIds der KRP (--dry-run: zählen)
 *   npx tsx src/main.ts --patch-entity-keys  # nur personKeys/placeKeys/orgKeys aus Meili (--dry-run: zählen)
 *   npx tsx src/main.ts --patch-synonyms     # Synonyme gegen die Wortanfang-Lücke (--dry-run: nur rechnen)
 *
 * Läufe, die IIIF auflösen (die obigen und --patch-manifests), brauchen
 * PUBLIC_BASE_URL (Prod: https://zentraleserien.ch); fehlt sie oder zeigt sie
 * auf localhost, bricht der Lauf ab – ausser mit --allow-local-base-url.
 *
 * Pipeline-Stages pro Doc:
 *   1. parse        TEI → MeiliDoc (Felder + Plaintext + PageBreaks + Surfaces)
 *   2. render       Body-Tree → HTML, brotli-komprimiert auf Disk
 *   3. iiif         (a) lokales Manifest schreiben für ABl
 *                   (b) externe Manifest-URL in MeiliDoc setzen für OS/KRP/RRB
 *                   (c) keine Aktion bei Docs ohne Faksimile
 *   4. embed (Batch) Body+Title → 768-d Vector → MeiliDoc._vectors.jina_de
 *   5. meili (Batch) MeiliDoc → POST /indexes/documents/documents
 *
 * KRP-Dokumente tragen zusätzlich krdbIds/krdbTitleIds (krdbFields.ts): die
 * zugeordneten Rats- und Regierungsmitglieder, Grundlage der Personenseiten.
 * Alle Dokumente tragen zu den erkannten Namen die Vergleichsschlüssel
 * personKeys/placeKeys/orgKeys (entityKeyFields.ts, Fassung 2 von entityKey.ts):
 * ein Namensfilter der Web-App trifft die Form ODER denselben Schlüssel.
 */

import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants, createGzip } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { MeiliSearchApiError } from "meilisearch";
import { parseTeiFile } from "./parser.ts";
import { titleSearchFor } from "./searchText.ts";
import { renderTeiHtml } from "./render.ts";
import { resolveIIIF, type IIIFLocalResult } from "./iiif.ts";
import { EmbedClient } from "./embed.ts";
import { MeiliBulkImporter } from "./meili.ts";
import {
  addMeiliWords,
  DEFAULT_MARGIN,
  MEILI_PREFIX_CAP,
  prefixGapSynonyms,
  synonymDiff,
  synonymsUnchanged,
  toSynonymSetting,
} from "./prefixSynonyms.ts";
import { diffManifestUrls, type ManifestPatch } from "./manifestPatch.ts";
import { krdbFieldsFor, requireKrdb, sameIds } from "./krdbFields.ts";
import {
  diffEntityKeys,
  entityKeyFields,
  type EntityKeyFields,
  type EntityKeyPatch,
  type StoredEntityDoc,
} from "./entityKeyFields.ts";
import type { KrdbIndexFields } from "./krdb/krdbMatch.ts";
import { ALLOW_LOCAL_BASE_URL_FLAG, isLocalUrl, resolvePublicBaseUrl } from "./publicBaseUrl.ts";
import { settleReport, TaskThrottle, type SettleResult } from "./taskSettle.ts";
import { walkData, gitChangedFiles } from "./walker.ts";
import { ALL_SERIES, UNEMBEDDED_SERIES, type DocRelation, type MeiliDoc, type SeriesAbbr } from "./types.ts";

interface CliArgs {
  all: boolean;
  limit?: number;
  since?: string;
  series?: SeriesAbbr[];
  dryRun: boolean;
  skipEmbed: boolean;
  skipMeili: boolean;
  exportCorpus?: string;
  patchTitles: boolean;
  patchBodies: boolean;
  patchEntities: boolean;
  patchRrbNumbers: boolean;
  patchManifests: boolean;
  patchKrdb: boolean;
  patchEntityKeys: boolean;
  patchSynonyms: boolean;
  /** Opt-in: fehlende/lokale PUBLIC_BASE_URL zulassen (nur lokale Tests). */
  allowLocalBaseUrl: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    all: false,
    dryRun: false,
    skipEmbed: false,
    skipMeili: false,
    patchTitles: false,
    patchBodies: false,
    patchEntities: false,
    patchRrbNumbers: false,
    patchManifests: false,
    patchKrdb: false,
    patchEntityKeys: false,
    patchSynonyms: false,
    allowLocalBaseUrl: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--all") out.all = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--skip-embed") out.skipEmbed = true;
    else if (arg === "--skip-meili") out.skipMeili = true;
    else if (arg === "--patch-titles") out.patchTitles = true;
    else if (arg === "--patch-bodies") out.patchBodies = true;
    else if (arg === "--patch-entities") out.patchEntities = true;
    else if (arg === "--patch-rrb-numbers") out.patchRrbNumbers = true;
    else if (arg === "--patch-manifests") out.patchManifests = true;
    else if (arg === "--patch-krdb") out.patchKrdb = true;
    else if (arg === "--patch-entity-keys") out.patchEntityKeys = true;
    else if (arg === "--patch-synonyms") out.patchSynonyms = true;
    else if (arg === ALLOW_LOCAL_BASE_URL_FLAG) out.allowLocalBaseUrl = true;
    else if (arg.startsWith("--limit=")) out.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--since=")) out.since = arg.slice(8);
    else if (arg.startsWith("--series=")) {
      const s = arg.slice(9).split(",") as SeriesAbbr[];
      out.series = s.filter((x) => ALL_SERIES.includes(x));
    } else if (arg.startsWith("--export-corpus=")) {
      out.exportCorpus = arg.slice(16);
    } else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (
    !out.all && !out.since && !out.limit &&
    !out.patchTitles && !out.patchBodies && !out.patchEntities && !out.patchRrbNumbers &&
    !out.patchManifests && !out.patchKrdb && !out.patchEntityKeys && !out.patchSynonyms
  ) {
    console.error(
      "must specify one of --all, --since=<sha>, --limit=<n>, --patch-titles, --patch-bodies, " +
        "--patch-entities, --patch-rrb-numbers, --patch-manifests, --patch-krdb, --patch-entity-keys, " +
        "--patch-synonyms\n" +
        "options: --series=ABl,… --dry-run --skip-embed --skip-meili --export-corpus=<file> " +
        `${ALLOW_LOCAL_BASE_URL_FLAG} (allow missing/localhost PUBLIC_BASE_URL – local tests only)`,
    );
    process.exit(2);
  }
  return out;
}

interface Env {
  dataDir: string;
  outputDir: string;
  /** Roh, ohne Default – nur über requirePublicBaseUrl() verwenden. */
  publicBaseUrl: string | undefined;
  meiliUrl: string;
  meiliMasterKey: string;
  meiliIndex: string;
  embedUrl: string;
}

function loadEnv(): Env {
  const e = process.env;
  return {
    dataDir: resolve(
      e["ZSZH_DATA_DIR"] ?? "/pfad/zum/tei-korpus",
    ),
    outputDir: resolve(e["RENDER_OUTPUT_DIR"] ?? "./output"),
    publicBaseUrl: e["PUBLIC_BASE_URL"],
    meiliUrl: e["MEILI_URL"] ?? "http://localhost:7700",
    meiliMasterKey: e["MEILI_MASTER_KEY"] ?? "dev_master_key_change_me",
    meiliIndex: e["MEILI_INDEX"] ?? "documents",
    embedUrl: e["EMBED_URL"] ?? "http://localhost:8001",
  };
}

// Env-konfigurierbar: große Bodies (z. B. KRP-Gever-Voll-Traktanden) können
// einen 5000er-Batch über Meilis Payload-Limit (Default 95 MiB) treiben → dann
// kleineren Batch via MEILI_BATCH setzen.
const MEILI_BATCH = Number.parseInt(process.env["MEILI_BATCH"] ?? "", 10) || 5_000;
// Env-konfigurierbar: der CPU-Embed-Container (Jina v2) kann bei zu grossen
// Batches/Parallelität OOM-killen. Für grosse Läufe konservativ setzen, z. B.
// EMBED_BATCH=8 EMBED_CONCURRENCY=2.
const EMBED_BATCH = Number.parseInt(process.env["EMBED_BATCH"] ?? "", 10) || 32;
const EMBED_CONCURRENCY = Number.parseInt(process.env["EMBED_CONCURRENCY"] ?? "", 10) || 4;
// So lange wartet der Indexer höchstens auf Meili-Tasks: je auf Index-Anlage
// und Settings (ensureIndex), gemeinsam auf die Batches von --all/--since/
// --limit bzw. --patch-manifests (geteilte Queue: ein laufender chunks-Import
// belegt sie leicht Dutzende Minuten).
const MEILI_TASK_WAIT_S = Number.parseInt(process.env["MEILI_TASK_WAIT_S"] ?? "", 10) || 3_600;
// --patch-entity-keys: Docs je Seite beim Lesen (POST /documents/fetch, nur die
// Namensfelder), höchstens 2000 – Meili v1.13 rechnet /documents im HTTP-Worker, eine
// Anfrage über 5 s liesse andere Verbindungen mit 408 scheitern (CLAUDE.md,
// Meili-Eigenheiten). Dazu höchstens MEILI_MAX_IN_FLIGHT Patch-Tasks zugleich in der
// Queue (TaskThrottle).
const MEILI_FETCH_PAGE = Math.min(
  2_000,
  Math.max(1, Number.parseInt(process.env["MEILI_FETCH_PAGE"] ?? "", 10) || 1_000),
);
const MEILI_MAX_IN_FLIGHT = Number.parseInt(process.env["MEILI_MAX_IN_FLIGHT"] ?? "", 10) || 4;
// --patch-synonyms liest Titel und Text (bis 1 MiB je Doc): Seiten nach Textmenge bemessen, Ziel
// TEXT_PAGE_CHARS Zeichen je Antwort, zwischen 10 und 500 Docs (s. MEILI_FETCH_PAGE: eine lange
// /documents-Anfrage belegte in Meili v1.13 einen HTTP-Worker).
const TEXT_PAGE_CHARS = 8_000_000;
const TEXT_PAGE_MIN = 10;
const TEXT_PAGE_MAX = 500;

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv();

  if (args.exportCorpus) {
    return runExportCorpus(args, env);
  }

  // Läufe, die KRP-Dokumente schreiben, brauchen das KRDB-Register (krdbIds).
  // Vorab laden: ein Abbruch nach Stunden wäre teurer als ein sofortiger.
  // --patch-entity-keys schreibt nur die Vergleichsschlüssel, --patch-synonyms nur das
  // Setting – beide ohne Register.
  if (
    args.patchKrdb ||
    (!args.patchEntityKeys &&
      !args.patchSynonyms &&
      !args.patchRrbNumbers &&
      !args.patchManifests &&
      (args.series ?? ALL_SERIES).includes("KRP"))
  ) {
    requireKrdb(args.patchKrdb ? "patch-krdb" : "indexer");
  }

  if (args.patchKrdb) {
    return runPatchKrdb(args, env);
  }

  if (args.patchEntityKeys) {
    return runPatchEntityKeys(args, env);
  }

  if (args.patchSynonyms) {
    return runPatchSynonyms(args, env);
  }

  if (args.patchTitles) {
    return runPatchTitles(args, env);
  }

  if (args.patchEntities) {
    return runPatchEntities(args, env);
  }

  if (args.patchRrbNumbers) {
    return runPatchRrbNumbers(args, env);
  }

  if (args.patchBodies) {
    return runPatchBodies(args, env);
  }

  if (args.patchManifests) {
    return runPatchManifests(args, env);
  }

  const publicBaseUrl = requirePublicBaseUrl(args, env, "indexer");

  console.log("[indexer] config", {
    dataDir: env.dataDir,
    outputDir: env.outputDir,
    publicBaseUrl,
    series: args.series ?? ALL_SERIES,
    limit: args.limit,
    since: args.since,
    dryRun: args.dryRun,
    skipEmbed: args.skipEmbed,
  });

  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });
  const embed = new EmbedClient({
    url: env.embedUrl,
    batchSize: EMBED_BATCH,
    concurrency: EMBED_CONCURRENCY,
  });

  if (!args.dryRun && !args.skipMeili) {
    console.log("[indexer] ensuring meili index + settings…");
    await meili.ensureIndex(MEILI_TASK_WAIT_S * 1000);
  }
  // Läufe nur über Serien ohne Embeddings (RM) brauchen den embed-Service nicht.
  const needsEmbed = (args.series ?? ALL_SERIES).some((s) => !UNEMBEDDED_SERIES.has(s));
  if (!args.dryRun && !args.skipEmbed && needsEmbed) {
    console.log("[indexer] checking embed-service health…");
    const h = await embed.healthz().catch((e) => ({ status: "down", error: String(e) }));
    console.log("[indexer] embed:", h);
    if ("error" in h) {
      console.error("[indexer] embed-service not reachable, aborting");
      process.exit(1);
    }
  }

  const startTs = Date.now();
  const stats = {
    parsed: 0,
    rendered: 0,
    manifests: 0,
    externalManifests: 0,
    noFacsimile: 0,
    indexed: 0,
    failed: 0,
    bytesRendered: 0,
  };

  let buffer: MeiliDoc[] = [];
  const taskUids: number[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    // Opt-out: Meili braucht jina_de:null, sonst lehnt es Docs wegen Embedder-Config
    // ab – bei --skip-embed für alle, sonst für die Serien ohne Embeddings (RM).
    const toEmbed: MeiliDoc[] = [];
    for (const d of buffer) {
      if (args.skipEmbed || UNEMBEDDED_SERIES.has(d.series)) {
        d._vectors = { jina_de: null as unknown as number[] };
      } else {
        toEmbed.push(d);
      }
    }
    if (!args.dryRun && toEmbed.length > 0) {
      await embed.encodeBatch(toEmbed);
    }
    if (!args.dryRun && !args.skipMeili) {
      const { taskUid } = await meili.upsertBatch(buffer);
      taskUids.push(taskUid);
    }
    stats.indexed += buffer.length;
    console.log(
      `[indexer] flush: indexed=${stats.indexed} rendered=${stats.rendered} ` +
        `manifests=${stats.manifests} external=${stats.externalManifests} ` +
        `noFacs=${stats.noFacsimile} failed=${stats.failed} ` +
        `elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
    buffer = [];
  };

  // File-Quelle bestimmen
  const source = args.since
    ? await sinceWalker(env.dataDir, args.since)
    : walkData({ dataDir: env.dataDir, series: args.series, limit: args.limit });

  for await (const file of source) {
    try {
      const parsed = await parseTeiFile(file);

      // IIIF auflösen – vor Render, damit manifestUrl in TeiMetadata steht
      const iiifResult = resolveIIIF(parsed, { publicBaseUrl });
      if (iiifResult.kind === "local") {
        parsed.meta.manifestUrl = iiifResult.publicUrl;
        if (!args.dryRun) await writeLocalManifest(env.outputDir, iiifResult);
        stats.manifests++;
      } else if (iiifResult.kind === "external") {
        parsed.meta.manifestUrl = iiifResult.publicUrl;
        stats.externalManifests++;
      } else {
        stats.noFacsimile++;
      }

      // Render
      const html = renderTeiHtml(parsed);
      if (!args.dryRun) {
        await writeRenderedHtml(env.outputDir, parsed.meta.series, parsed.meta.id, html);
        await writeRawXml(env.outputDir, parsed.meta.series, parsed.meta.id, parsed.rawXml);
      }
      stats.rendered++;
      stats.bytesRendered += html.length;

      // MeiliDoc bauen
      const doc: MeiliDoc = {
        ...parsed.meta,
        body: parsed.body,
        persons: parsed.persons,
        places: parsed.places,
        organizations: parsed.organizations,
        // Vergleichsschlüssel der Namen (RM: keine erkannten Namen ⇒ leere Listen).
        ...entityKeyFields(parsed),
      };
      // KRP: zugeordnete Rats-/Regierungsmitglieder (null bei anderen Serien).
      Object.assign(doc, krdbFieldsFor(doc));
      buffer.push(doc);
      stats.parsed++;

      if (buffer.length >= MEILI_BATCH) await flush();
    } catch (err) {
      stats.failed++;
      console.error(`[indexer] FAIL ${file.relPath}:`, err);
    }
  }

  await flush();
  let settled = { ok: true, summary: "" };
  if (!args.dryRun && !args.skipMeili) {
    settled = await settleRun(
      "indexer",
      meili,
      taskUids,
      "Status später per GET /tasks?uids=… prüfen.",
    );
    const meiliStats = await meili.getStats();
    console.log("[indexer] meili:", meiliStats);
  }

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[indexer] ${settled.ok ? "DONE" : "FAILED"} in ${elapsed}s – parsed=${stats.parsed} ` +
      `rendered=${stats.rendered} manifests=${stats.manifests} external=${stats.externalManifests} ` +
      `noFacs=${stats.noFacsimile} indexed=${stats.indexed} failed=${stats.failed} ` +
      `bytesRendered=${(stats.bytesRendered / 1_000_000).toFixed(1)}MB${settled.summary}`,
  );
}

/**
 * Wartet auf die Meili-Tasks eines Laufs (gemeinsame Frist MEILI_TASK_WAIT_S)
 * und prüft ihren Status (taskSettle.ts): fehlgeschlagene oder nach der Frist
 * noch anstehende Tasks ⇒ Meldung und Exit 1. Liefert Urteil und Zusatz für
 * die Schlusszeile.
 */
async function settleRun(
  tag: string,
  meili: MeiliBulkImporter,
  taskUids: number[],
  pendingHint: string,
): Promise<{ ok: boolean; summary: string }> {
  if (taskUids.length === 0) return { ok: true, summary: "" };
  console.log(
    `[${tag}] warte auf ${taskUids.length} Meili-Task(s) ` +
      `(${taskUids.join(", ")}, max. ${MEILI_TASK_WAIT_S}s)…`,
  );
  const result = await meili.settleTasks(taskUids, MEILI_TASK_WAIT_S * 1000);
  return reportSettled(tag, taskUids.length, result, pendingHint);
}

/** Meldet ein Task-Ergebnis (taskSettle.ts) und setzt bei Fehlern Exit 1. */
function reportSettled(
  tag: string,
  taskCount: number,
  result: SettleResult,
  pendingHint: string,
): { ok: boolean; summary: string } {
  const report = settleReport(tag, taskCount, result, {
    waitS: MEILI_TASK_WAIT_S,
    pendingHint,
  });
  for (const line of report.errors) console.error(line);
  for (const line of report.warnings) console.warn(line);
  if (!report.ok) process.exitCode = 1;
  return report;
}

/**
 * Patch nur title + titleSort + stazhIdent ins bestehende Meili-Index, ohne
 * Embeddings oder andere Felder anzufassen. Nutzt MeiliSearch updateDocuments
 * (PUT = merge). Schnell genug, dass alle 567k Docs in ~5–10 min durchgehen.
 */
async function runPatchTitles(args: CliArgs, env: Env): Promise<void> {
  console.log("[patch-titles] config", {
    dataDir: env.dataDir,
    series: args.series ?? ALL_SERIES,
    limit: args.limit,
  });

  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });
  await meili.ensureIndex(MEILI_TASK_WAIT_S * 1000);

  const PATCH_BATCH = 5_000;
  let buffer: Array<
    { id: string; title: string; titleSearch: string | null; titleSort: string; stazhIdent: string | null; subset: string | null } & Partial<KrdbIndexFields>
  > = [];
  const taskUids: number[] = [];
  const startTs = Date.now();
  let patched = 0;
  let failed = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const { taskUid } = await meili.patchBatch(buffer);
    taskUids.push(taskUid);
    patched += buffer.length;
    console.log(
      `[patch-titles] flush: patched=${patched} failed=${failed} ` +
        `elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
    buffer = [];
  };

  const source = args.since
    ? await sinceWalker(env.dataDir, args.since)
    : walkData({ dataDir: env.dataDir, series: args.series, limit: args.limit });

  for await (const file of source) {
    try {
      const parsed = await parseTeiFile(file);
      // stazhIdent normalisieren (XML-Whitespace bereinigen)
      const stazhIdentNorm = parsed.meta.stazhIdent ? parsed.meta.stazhIdent.replace(/\s+/g, " ").trim() : null;
      buffer.push({
        id: parsed.meta.id,
        title: parsed.meta.title.trim(),
        // Suchfeld mit ss statt ß (searchText.ts); null räumt eine veraltete Form ab.
        titleSearch: titleSearchFor(parsed.meta.title.trim()),
        titleSort: parsed.meta.titleSort,
        stazhIdent: stazhIdentNorm,
        subset: parsed.meta.subset,
        // Der Titel geht in den KRDB-Abgleich ein (krdbTitleIds).
        ...krdbFieldsFor({ ...parsed.meta, title: parsed.meta.title.trim(), body: parsed.body, persons: parsed.persons }),
      });
      // XML-Quelldatei in den Render-Output spiegeln, damit Downloads via
      // /api/document/.../package zuverlässig `document.xml` liefern können –
      // sonst hängt das davon ab, ob zuletzt --all/--patch-bodies lief.
      if (!args.dryRun) {
        await writeRawXml(env.outputDir, parsed.meta.series, parsed.meta.id, parsed.rawXml);
      }
      if (buffer.length >= PATCH_BATCH) await flush();
    } catch (err) {
      failed++;
      console.error(`[patch-titles] FAIL ${file.relPath}:`, err);
    }
  }

  await flush();
  console.log(`[patch-titles] all batches submitted (${taskUids.length} meili tasks). Background processing…`);
  // Wir warten nicht auf alle Tasks (kann minutenlang dauern) – Meili verarbeitet
  // sie zuverlässig im Hintergrund.
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[patch-titles] DONE in ${elapsed}s – patched=${patched} failed=${failed} ` +
      `(letzter taskUid=${taskUids.at(-1)})`,
  );
}

/**
 * Patch body-Feld + re-render HTML-Files. Lässt Embeddings, Title, Metadaten
 * und IIIF-Manifeste unangetastet. Nutzt MeiliSearch updateDocuments
 * (PUT = merge). Eingesetzt nach Parser-/Render-Bugfixes (z. B. mixed-content
 * Whitespace).
 */
async function runPatchBodies(args: CliArgs, env: Env): Promise<void> {
  console.log("[patch-bodies] config", {
    dataDir: env.dataDir,
    outputDir: env.outputDir,
    series: args.series ?? ALL_SERIES,
    limit: args.limit,
  });

  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });
  await meili.ensureIndex(MEILI_TASK_WAIT_S * 1000);

  const PATCH_BATCH = Number.parseInt(process.env["MEILI_BATCH"] ?? "", 10) || 5_000;
  let buffer: Array<{
    id: string;
    body: string;
    titleSearch: string | null;
    archiveLink: string | null;
    archiveId: number | null;
    relations: DocRelation[];
  } & Partial<KrdbIndexFields>> = [];
  const taskUids: number[] = [];
  const startTs = Date.now();
  let patched = 0;
  let rendered = 0;
  let failed = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const { taskUid } = await meili.patchBatch(buffer);
    taskUids.push(taskUid);
    patched += buffer.length;
    console.log(
      `[patch-bodies] flush: patched=${patched} rendered=${rendered} ` +
        `failed=${failed} elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
    buffer = [];
  };

  const source = args.since
    ? await sinceWalker(env.dataDir, args.since)
    : walkData({ dataDir: env.dataDir, series: args.series, limit: args.limit });

  for await (const file of source) {
    try {
      const parsed = await parseTeiFile(file);
      // 1) Render-HTML neu schreiben – ohne IIIF-Resolve: render.ts bettet
      //    keine Manifest-URL ein, das Frontend liest manifestUrl aus Meili.
      //    manifestUrl + ABl-Manifeste korrigiert --patch-manifests.
      const html = renderTeiHtml(parsed);
      await writeRenderedHtml(env.outputDir, parsed.meta.series, parsed.meta.id, html);
      await writeRawXml(env.outputDir, parsed.meta.series, parsed.meta.id, parsed.rawXml);
      rendered++;
      // 2) Body + archiveLink + Querverweise (archiveId/relations) in Meili
      //    patchen (merge → Embeddings + Rest bleibt). archiveId/relations
      //    kommen ohne Zusatzkosten aus demselben Parse wie das Re-Render.
      buffer.push({
        id: parsed.meta.id,
        // Suchtext (ß → ss, bis MAX_BODY_BYTES) und das passende Titel-Suchfeld aus
        // demselben Parse – so genügt ein Lauf für beide (searchText.ts).
        body: parsed.body,
        titleSearch: parsed.meta.titleSearch,
        archiveLink: parsed.meta.archiveLink,
        archiveId: parsed.meta.archiveId,
        relations: parsed.meta.relations,
        // Der Body geht in den KRDB-Abgleich ein (Vollnamen im Text).
        ...krdbFieldsFor({ ...parsed.meta, body: parsed.body, persons: parsed.persons }),
      });
      if (buffer.length >= PATCH_BATCH) await flush();
    } catch (err) {
      failed++;
      console.error(`[patch-bodies] FAIL ${file.relPath}:`, err);
    }
  }

  await flush();
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[patch-bodies] DONE in ${elapsed}s – patched=${patched} rendered=${rendered} ` +
      `failed=${failed} (letzter taskUid=${taskUids.at(-1)})`,
  );
}

/**
 * Patch nur die Named-Entity-Felder (persons/places/organizations) samt ihren
 * Vergleichsschlüsseln (personKeys/placeKeys/orgKeys, entityKeyFields.ts). Lässt
 * Body, Embeddings, Title, Metadaten und IIIF-Manifeste unangetastet.
 * Nutzt MeiliSearch updateDocuments (PUT = merge). Eingesetzt nach dem
 * Hinzufügen der Entity-Extraktion zum Parser, um den bestehenden Index
 * inkrementell zu erweitern, ohne 567k Embeddings neu zu berechnen.
 *
 * Voraussetzung: Index-Schema muss persons/places/organizations bereits als
 * filterable kennen – ensureIndex() pusht das vor dem ersten Patch-Batch.
 */
async function runPatchEntities(args: CliArgs, env: Env): Promise<void> {
  console.log("[patch-entities] config", {
    dataDir: env.dataDir,
    series: args.series ?? ALL_SERIES,
    limit: args.limit,
  });

  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });

  // Schema-Update vor dem ersten Patch: Meili braucht die Felder als
  // filterableAttributes, sonst greift der `persons IN [...]`-Filter nicht.
  console.log("[patch-entities] ensuring meili index + settings…");
  await meili.ensureIndex(MEILI_TASK_WAIT_S * 1000);

  const PATCH_BATCH = 5_000;
  let buffer: Array<{
    id: string;
    persons: string[];
    places: string[];
    organizations: string[];
  } & EntityKeyFields & Partial<KrdbIndexFields>> = [];
  const taskUids: number[] = [];
  const startTs = Date.now();
  let patched = 0;
  let failed = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const { taskUid } = await meili.patchBatch(buffer);
    taskUids.push(taskUid);
    patched += buffer.length;
    console.log(
      `[patch-entities] flush: patched=${patched} failed=${failed} ` +
        `elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
    buffer = [];
  };

  const source = args.since
    ? await sinceWalker(env.dataDir, args.since)
    : walkData({ dataDir: env.dataDir, series: args.series, limit: args.limit });

  for await (const file of source) {
    try {
      const parsed = await parseTeiFile(file);
      buffer.push({
        id: parsed.meta.id,
        persons: parsed.persons,
        places: parsed.places,
        organizations: parsed.organizations,
        ...entityKeyFields(parsed),
        // Die erkannten Personen sind Eingabe des KRDB-Abgleichs.
        ...krdbFieldsFor({ ...parsed.meta, body: parsed.body, persons: parsed.persons }),
      });
      // XML-Quelldatei in den Render-Output spiegeln (siehe runPatchTitles).
      if (!args.dryRun) {
        await writeRawXml(env.outputDir, parsed.meta.series, parsed.meta.id, parsed.rawXml);
      }
      if (buffer.length >= PATCH_BATCH) await flush();
    } catch (err) {
      failed++;
      console.error(`[patch-entities] FAIL ${file.relPath}:`, err);
    }
  }

  await flush();
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[patch-entities] all batches submitted in ${elapsed}s – patched=${patched} ` +
      `failed=${failed} (letzter taskUid=${taskUids.at(-1)}). Meili indiziert ` +
      `weiter im Hintergrund.`,
  );
}

/**
 * Patch nur die serien-spezifischen Identifier:
 *  - RRB: `resolutionId` (z. B. "1803/0003") – aus `<ident>` extrahiert, vorher
 *    fälschlich aus `<idno>` als Integer geparsed (Seitenangabe im Manualband).
 *  - OS: `serialNr` jetzt als String ("632.31"), vorher per parseInt verkürzt.
 *
 * Lässt Body, Embeddings, Title, Entities und IIIF-Manifeste unangetastet.
 * ensureIndex() pusht das neue Schema (resolutionId statt resolutionNr,
 * serialNr als string + sortFacetValuesBy count) vor dem ersten Patch-Batch.
 */
async function runPatchRrbNumbers(args: CliArgs, env: Env): Promise<void> {
  console.log("[patch-rrb-numbers] config", {
    dataDir: env.dataDir,
    series: args.series ?? ALL_SERIES,
    limit: args.limit,
  });

  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });

  console.log("[patch-rrb-numbers] ensuring meili index + settings…");
  await meili.ensureIndex(MEILI_TASK_WAIT_S * 1000);

  const PATCH_BATCH = 5_000;
  let buffer: Array<{
    id: string;
    resolutionId?: string | null;
    serialNr?: string | null;
  }> = [];
  const taskUids: number[] = [];
  const startTs = Date.now();
  let patched = 0;
  let skipped = 0;
  let failed = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const { taskUid } = await meili.patchBatch(buffer);
    taskUids.push(taskUid);
    patched += buffer.length;
    console.log(
      `[patch-rrb-numbers] flush: patched=${patched} skipped=${skipped} failed=${failed} ` +
        `elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
    buffer = [];
  };

  const source = args.since
    ? await sinceWalker(env.dataDir, args.since)
    : walkData({ dataDir: env.dataDir, series: args.series, limit: args.limit });

  for await (const file of source) {
    try {
      // Nur RRB+OS interessieren – andere Serien überspringen, sonst würde
      // updateDocuments für ABl/KRP-Docs den Patch mit leeren Feldern
      // versehen (null überschreibt nicht, aber es ist sinnloser Traffic).
      if (file.series !== "RRB" && file.series !== "OS") {
        skipped++;
        continue;
      }
      const parsed = await parseTeiFile(file);
      if (file.series === "RRB") {
        buffer.push({
          id: parsed.meta.id,
          resolutionId: parsed.meta.resolutionId,
        });
      } else {
        // OS
        buffer.push({
          id: parsed.meta.id,
          serialNr: parsed.meta.serialNr,
        });
      }
      // XML-Quelldatei in den Render-Output spiegeln (siehe runPatchTitles).
      if (!args.dryRun) {
        await writeRawXml(env.outputDir, parsed.meta.series, parsed.meta.id, parsed.rawXml);
      }
      if (buffer.length >= PATCH_BATCH) await flush();
    } catch (err) {
      failed++;
      console.error(`[patch-rrb-numbers] FAIL ${file.relPath}:`, err);
    }
  }

  await flush();
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[patch-rrb-numbers] all batches submitted in ${elapsed}s – patched=${patched} ` +
      `skipped=${skipped} failed=${failed} (letzter taskUid=${taskUids.at(-1)}). ` +
      `Meili indiziert weiter im Hintergrund.`,
  );
}

/**
 * Patch nur `manifestUrl` und schreibt die lokalen IIIF-Manifeste (ABl) unter
 * RENDER_OUTPUT_DIR/iiif/ neu. Embeddings, Body und übrige Felder bleiben
 * (updateDocuments = merge). Anlass: ein Lauf ohne PUBLIC_BASE_URL hatte
 * ABl 1930–2001 mit http://localhost:5173-Manifesten indexiert; --all hätte
 * dafür alle ABl-Embeddings neu gerechnet.
 *
 * Pro Batch wird der Ist-Stand aus Meili gelesen und nur Abweichendes
 * gepatcht. Docs ohne Meili-Eintrag werden übersprungen – updateDocuments
 * legte sie sonst als Rumpf-Doc ohne _vectors an, was Meili ablehnt (samt dem
 * ganzen Batch). --dry-run liest nur und zählt, was sich ändern würde;
 * --skip-meili schreibt nur die Manifest-Dateien.
 */
async function runPatchManifests(args: CliArgs, env: Env): Promise<void> {
  const publicBaseUrl = requirePublicBaseUrl(args, env, "patch-manifests");
  console.log("[patch-manifests] config", {
    dataDir: env.dataDir,
    outputDir: env.outputDir,
    publicBaseUrl,
    series: args.series ?? ALL_SERIES,
    limit: args.limit,
    since: args.since,
    dryRun: args.dryRun,
    skipMeili: args.skipMeili,
  });

  const meili = args.skipMeili
    ? null
    : new MeiliBulkImporter({
        url: env.meiliUrl,
        masterKey: env.meiliMasterKey,
        indexUid: env.meiliIndex,
      });
  // Kein ensureIndex(): manifestUrl ist längst displayed, ein Settings-Push
  // brächte nur Risiko. getStats() wirft, falls der Index fehlt.
  if (meili) console.log("[patch-manifests] meili:", await meili.getStats());

  const PATCH_BATCH = Number.parseInt(process.env["MEILI_BATCH"] ?? "", 10) || 5_000;
  let buffer: ManifestPatch[] = [];
  const taskUids: number[] = [];
  const startTs = Date.now();
  const stats = {
    local: 0,
    external: 0,
    none: 0,
    failed: 0,
    files: 0,
    changed: 0,
    fromLocalhost: 0,
    unchanged: 0,
    missing: 0,
  };
  const missingSample: string[] = [];
  let otherLogged = 0;

  const summary = () =>
    `local=${stats.local} external=${stats.external} none=${stats.none} ` +
    `failed=${stats.failed} files=${stats.files}` +
    (meili
      ? ` | meili: changed=${stats.changed} (localhost=${stats.fromLocalhost}) ` +
        `unchanged=${stats.unchanged} missing=${stats.missing}`
      : "");

  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    if (meili) {
      const current = await meili.fetchByIds<ManifestPatch>(
        batch.map((d) => d.id),
        ["id", "manifestUrl"],
      );
      const diff = diffManifestUrls(batch, current);
      stats.changed += diff.changes.length;
      stats.fromLocalhost += diff.fromLocalhost;
      stats.unchanged += diff.unchanged;
      stats.missing += diff.missing.length;
      missingSample.push(...diff.missing.slice(0, 10 - missingSample.length));
      // Erwartet sind nur localhost-Korrekturen – alles andere sichtbar machen.
      for (const o of diff.other) {
        if (otherLogged++ >= 10) break;
        console.log(`[patch-manifests] Änderung ohne localhost: ${o.id}: ${o.old} → ${o.next}`);
      }
      if (diff.changes.length > 0 && !args.dryRun) {
        const { taskUid } = await meili.patchBatch(diff.changes);
        taskUids.push(taskUid);
      }
    }
    console.log(
      `[patch-manifests] flush: ${summary()} ` +
        `elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`,
    );
  };

  const source = args.since
    ? await sinceWalker(env.dataDir, args.since)
    : walkData({ dataDir: env.dataDir, series: args.series, limit: args.limit });

  for await (const file of source) {
    try {
      const parsed = await parseTeiFile(file);
      const iiif = resolveIIIF(parsed, { publicBaseUrl });
      if (iiif.kind === "local") {
        if (!args.dryRun) {
          await writeLocalManifest(env.outputDir, iiif);
          stats.files++;
        }
        stats.local++;
      } else if (iiif.kind === "external") {
        stats.external++;
      } else {
        stats.none++;
      }
      buffer.push({ id: parsed.meta.id, manifestUrl: iiif.kind === "none" ? null : iiif.publicUrl });
    } catch (err) {
      stats.failed++;
      console.error(`[patch-manifests] FAIL ${file.relPath}:`, err);
    }
    // Ausserhalb des try: ein Meili-Fehler bricht den Lauf ab, statt als
    // Datei-FAIL mitsamt dem Batch unterzugehen.
    if (buffer.length >= PATCH_BATCH) await flush();
  }
  await flush();

  const settled = meili
    ? await settleRun(
        "patch-manifests",
        meili,
        taskUids,
        "Kontrolle später per --dry-run (erwartet changed=0).",
      )
    : { ok: true, summary: "" };
  if (stats.missing > 0) {
    console.warn(
      `[patch-manifests] ${stats.missing} Docs ohne Meili-Eintrag übersprungen, ` +
        `z. B. ${missingSample.join(", ")}`,
    );
  }
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[patch-manifests] ${settled.ok ? "DONE" : "FAILED"} in ${elapsed}s – ${summary()}${settled.summary}` +
      (args.dryRun ? " (dry-run: nichts geschrieben)" : ""),
  );
}

/**
 * Patch nur krdbIds/krdbTitleIds der Kantonsratsprotokolle. Liest die KRP-Docs
 * aus Meili (dieselben Felder wie die Detailseite: Titel, Datum, Text, erkannte
 * Personen), rechnet den KRDB-Abgleich neu und patcht nur Abweichendes – kein
 * Parsen des Korpus, kein Re-Embedding, Minuten statt Stunden. Nötig nach jedem
 * Register-Refresh (services/krdb) und nach Änderungen am Matcher; neue Docs
 * bringt der normale Indexlauf schon mit. `--dry-run` liest nur und zählt,
 * `--limit=<n>` begrenzt die Zahl der gelesenen Docs (Tests).
 *
 * ensureIndex() schiebt vor dem ersten Patch die Settings (krdbIds filterable +
 * displayed). Beim Ersteinrichten am 2026-10-12 dauerte der Task 0,06 s, weil
 * noch kein Doc die Felder trug; warten muss er höchstens hinter anderen Tasks
 * der Queue. Im Dry-Run entfällt er (nur lesen).
 */
async function runPatchKrdb(args: CliArgs, env: Env): Promise<void> {
  console.log("[patch-krdb] config", { meiliUrl: env.meiliUrl, index: env.meiliIndex, limit: args.limit, dryRun: args.dryRun });
  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });
  if (args.dryRun) console.log("[patch-krdb] meili:", await meili.getStats());
  else {
    console.log("[patch-krdb] ensuring meili index + settings…");
    await meili.ensureIndex(MEILI_TASK_WAIT_S * 1000);
  }

  // Body-lastige Seiten: kleiner als der übliche 5000er-Batch.
  const PAGE = Number.parseInt(process.env["MEILI_BATCH"] ?? "", 10) || 500;
  type Row = {
    id: string;
    date: string | null;
    title: string;
    body: string;
    persons?: string[];
    krdbIds?: number[];
    krdbTitleIds?: number[];
  };
  const taskUids: number[] = [];
  const startTs = Date.now();
  const stats = { docs: 0, withPersons: 0, withTitle: 0, links: 0, changed: 0, unchanged: 0 };
  const summary = () =>
    `docs=${stats.docs} mit Personen=${stats.withPersons} (Titel: ${stats.withTitle}, Zuordnungen: ${stats.links}) ` +
    `changed=${stats.changed} unchanged=${stats.unchanged}`;
  const limit = args.limit ?? Number.POSITIVE_INFINITY;

  pages: for await (const page of meili.iterateDocuments<Row>(
    "series = KRP",
    ["id", "date", "title", "body", "persons", "krdbIds", "krdbTitleIds"],
    PAGE,
  )) {
    const changes: Array<{ id: string } & KrdbIndexFields> = [];
    for (const d of page) {
      if (stats.docs >= limit) break pages;
      stats.docs++;
      const next = krdbFieldsFor({
        series: "KRP",
        date: d.date ?? null,
        title: d.title ?? "",
        body: d.body ?? "",
        persons: d.persons ?? [],
      })!;
      if (next.krdbIds.length > 0) stats.withPersons++;
      if (next.krdbTitleIds.length > 0) stats.withTitle++;
      stats.links += next.krdbIds.length;
      if (sameIds(d.krdbIds, next.krdbIds) && sameIds(d.krdbTitleIds, next.krdbTitleIds)) stats.unchanged++;
      else {
        stats.changed++;
        changes.push({ id: d.id, ...next });
      }
    }
    if (changes.length > 0 && !args.dryRun) {
      const { taskUid } = await meili.patchBatch(changes);
      taskUids.push(taskUid);
    }
    console.log(`[patch-krdb] ${summary()} elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`);
  }

  const settled = args.dryRun
    ? { ok: true, summary: "" }
    : await settleRun("patch-krdb", meili, taskUids, "Kontrolle später per --dry-run (erwartet changed=0).");
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(
    `[patch-krdb] ${settled.ok ? "DONE" : "FAILED"} in ${elapsed}s – ${summary()}${settled.summary}` +
      (args.dryRun ? " (dry-run: nichts geschrieben)" : ""),
  );
}

/** Docs ohne eines der Schlüsselfelder (EXISTS zählt auch leere Listen mit). */
const MISSING_ENTITY_KEYS = "(personKeys NOT EXISTS OR placeKeys NOT EXISTS OR orgKeys NOT EXISTS)";

/**
 * Patch nur die Vergleichsschlüssel der Namen (personKeys/placeKeys/orgKeys,
 * Fassung 2 von entityKey.ts; entityKeyFields.ts). Liest je Serie (auch RM) die
 * erkannten Formen und die gespeicherten Schlüssel aus Meili, rechnet neu und
 * patcht nur fehlende oder abweichende – kein Korpus-Parse, kein Re-Embedding.
 * Nötig einmal zum Nachrüsten und nach jeder Änderung an Fassung 2
 * (src/vendor/entityKey.ts, `npm run sync-entity-key`); neue Docs bringen die
 * Felder vom normalen Indexlauf und von --patch-entities mit.
 *
 * Lesen in Seiten à MEILI_FETCH_PAGE Docs, schreiben in Batches à MEILI_BATCH,
 * höchstens MEILI_MAX_IN_FLIGHT Tasks zugleich in der Queue (TaskThrottle). Jeder
 * Task wird geprüft: ein abgelehnter oder nach MEILI_TASK_WAIT_S noch anstehender
 * beendet das Einreichen (Exit 1). Zum Schluss die Probe je Serie, dass kein Doc
 * ohne die Felder geblieben ist – die Web-App filtert erst über die Schlüssel, wenn
 * sie `placeKeys EXISTS` bei ≥ 90 % der Docs findet; die Probe fängt auch Docs, die
 * während des Laufs dazukamen. `--dry-run` liest und zählt nur (kein ensureIndex,
 * kein Schreiben), `--series` grenzt ein, `--limit=<n>` liest n Docs je Serie (die
 * Probe ist dann nur Auskunft).
 *
 * ensureIndex() schiebt vor dem ersten Patch die Settings (Felder filterbar):
 * Settings vor den Daten, Meili pflegt die Facetten dann beim Patchen mit.
 */
async function runPatchEntityKeys(args: CliArgs, env: Env): Promise<void> {
  const tag = "patch-entity-keys";
  const seriesList = args.series ?? ALL_SERIES;
  console.log(`[${tag}] config`, {
    meiliUrl: env.meiliUrl,
    index: env.meiliIndex,
    series: seriesList,
    limit: args.limit,
    dryRun: args.dryRun,
    page: MEILI_FETCH_PAGE,
    batch: MEILI_BATCH,
    maxInFlight: MEILI_MAX_IN_FLIGHT,
  });
  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });
  // getStats() wirft, falls der Index fehlt – ensureIndex legte sonst still einen leeren an.
  console.log(`[${tag}] meili:`, await meili.getStats());
  if (!args.dryRun) {
    console.log(`[${tag}] ensuring meili index + settings…`);
    await meili.ensureIndex(MEILI_TASK_WAIT_S * 1000);
  }

  const throttle = new TaskThrottle(MEILI_MAX_IN_FLIGHT, MEILI_TASK_WAIT_S * 1000, (uids, ms) =>
    meili.settleTasks(uids, ms),
  );
  const startTs = Date.now();
  const elapsed = () => ((Date.now() - startTs) / 1000).toFixed(1);
  type Counts = { docs: number; withKeys: number; missing: number; changed: number; unchanged: number };
  const zero = (): Counts => ({ docs: 0, withKeys: 0, missing: 0, changed: 0, unchanged: 0 });
  const summary = (c: Counts) =>
    `docs=${c.docs} mit Schlüsseln=${c.withKeys} missing=${c.missing} changed=${c.changed} unchanged=${c.unchanged}`;
  const total = zero();
  const queue: EntityKeyPatch[] = [];
  let patched = 0;
  // Reicht volle Batches ein, mit `rest` auch den letzten; false = Drossel gestoppt.
  const submit = async (rest: boolean): Promise<boolean> => {
    while (queue.length >= (rest ? 1 : MEILI_BATCH)) {
      if (!(await throttle.admit())) return false;
      const batch = queue.splice(0, MEILI_BATCH);
      const { taskUid } = await meili.patchBatch(batch);
      throttle.add(taskUid);
      patched += batch.length;
      console.log(`[${tag}] flush: patched=${patched} tasks=${throttle.submitted} elapsed=${elapsed()}s`);
    }
    return true;
  };
  const limit = args.limit ?? Number.POSITIVE_INFINITY;

  for (const series of seriesList) {
    const counts = zero();
    for await (const page of meili.iterateDocuments<StoredEntityDoc>(
      `series = ${series}`,
      ["id", "persons", "places", "organizations", "personKeys", "placeKeys", "orgKeys"],
      MEILI_FETCH_PAGE,
    )) {
      const rows = page.slice(0, limit - counts.docs);
      const diff = diffEntityKeys(rows);
      counts.docs += rows.length;
      counts.withKeys += diff.withKeys;
      counts.missing += diff.missing;
      counts.changed += diff.changed;
      counts.unchanged += diff.unchanged;
      if (!args.dryRun) {
        queue.push(...diff.patches);
        if (!(await submit(false))) break;
      }
      if (counts.docs >= limit) break;
    }
    for (const k of Object.keys(total) as Array<keyof Counts>) total[k] += counts[k];
    console.log(`[${tag}] ${series}: ${summary(counts)} elapsed=${elapsed()}s`);
    if (throttle.stopped) break;
  }
  if (!args.dryRun && !throttle.stopped) await submit(true);
  if (throttle.stopped) {
    console.error(`[${tag}] Abbruch: ein Patch-Task ist abgelehnt oder noch offen – weitere Seiten nicht gelesen.`);
  }

  const result = await throttle.finish();
  const settled =
    throttle.submitted === 0
      ? { ok: true, summary: "" }
      : reportSettled(tag, throttle.submitted, result, "Kontrolle später per --dry-run (erwartet changed=0 missing=0).");

  // Probe: Docs ohne die Felder, je Serie (ohne --series auch ausserhalb der Serien).
  // Entfällt, solange Tasks offen sind – ihr Ergebnis stünde noch aus.
  let probe: string;
  let complete = true;
  if (result.pending.length > 0) probe = "nicht geprüft (Tasks offen)";
  else {
    try {
      const open: string[] = [];
      let sum = 0;
      for (const series of seriesList) {
        const n = await meili.countMatching(`series = ${series} AND ${MISSING_ENTITY_KEYS}`);
        sum += n;
        if (n > 0) open.push(`${series}=${n}`);
      }
      const other = args.series ? 0 : (await meili.countMatching(MISSING_ENTITY_KEYS)) - sum;
      if (other > 0) open.push(`andere Serien=${other}`);
      complete = open.length === 0;
      probe = complete ? "0" : open.join(" ");
    } catch (err) {
      // Vor dem ersten Lauf ohne --dry-run sind die Felder nicht filterbar.
      if (!(err instanceof MeiliSearchApiError && err.cause?.code === "invalid_search_filter")) throw err;
      probe = "nicht prüfbar (Felder nicht filterbar – Settings erst mit einem Lauf ohne --dry-run)";
      complete = false;
    }
  }
  // Nur ein vollständiger Schreiblauf muss die Probe bestehen (ein gestoppter ist ohnehin FAILED).
  const probeBinding = !args.dryRun && args.limit === undefined && !throttle.stopped;
  if (probeBinding && !complete) {
    console.error(
      `[${tag}] Docs ohne Schlüsselfelder nach dem Lauf: ${probe} – erneut laufen lassen ` +
        "(kamen während des Laufs Docs dazu, etwa per late-sync mit älterem Indexer?).",
    );
    process.exitCode = 1;
  }
  const ok = settled.ok && (!probeBinding || complete);
  console.log(
    `[${tag}] ${ok ? "DONE" : "FAILED"} in ${elapsed()}s – ${summary(total)} patched=${patched} ` +
      `| ohne Felder: ${probe}${settled.summary}` +
      (args.dryRun ? " (dry-run: nichts geschrieben)" : ""),
  );
}

/** Titel und Text eines Docs, wie --patch-synonyms sie liest. */
interface StoredTextDoc {
  id: string;
  title?: string | null;
  titleSearch?: string | null;
  body?: string | null;
}

/**
 * Synonyme gegen die Wortanfang-Lücke (prefixSynonyms.ts): liest Titel und Text aller Docs
 * aus Meili (je Serie, Seiten nach Textmenge, TEXT_PAGE_CHARS), bildet den Wortschatz wie Meili und rechnet je
 * Wort die Beugungsformen, die Meili beim letzten Suchwort hinter der 1'000er-Grenze
 * abschneidet («Gemeinde» → «Gemeinden»). Das Ergebnis ersetzt das Setting `synonyms` des Index
 * – es gehört diesem Modus, ensureIndex lässt es stehen –, ein Settings-Task ohne Neuaufbau,
 * wirksam sofort. Die Liste steht nach jedem Lauf in output/prefix-synonyms.json (Env
 * SYNONYMS_OUT).
 *
 * `--dry-run`, `--series` und `--limit` rechnen nur (ein Teil des Wortschatzes gäbe falsche
 * Ränge). Ohne Schreiben bricht der Lauf ab, wenn er weniger Docs gelesen hat, als der Index
 * hatte, oder wenn die neue Liste leer wäre und die alte nicht. Laufen lassen nach
 * --patch-bodies und nach grösseren Daten-Updates ([reindex:synonyms]); neue Docs der
 * late-sync verschieben die Ränge nur wenig.
 */
async function runPatchSynonyms(args: CliArgs, env: Env): Promise<void> {
  const tag = "patch-synonyms";
  const seriesList = args.series ?? ALL_SERIES;
  const partial = args.series !== undefined || args.limit !== undefined;
  console.log(`[${tag}] config`, {
    meiliUrl: env.meiliUrl,
    index: env.meiliIndex,
    series: seriesList,
    limit: args.limit,
    dryRun: args.dryRun,
    partial,
    pageChars: TEXT_PAGE_CHARS,
    cap: MEILI_PREFIX_CAP,
    margin: DEFAULT_MARGIN,
  });
  const meili = new MeiliBulkImporter({
    url: env.meiliUrl,
    masterKey: env.meiliMasterKey,
    indexUid: env.meiliIndex,
  });
  // getStats() wirft, falls der Index fehlt.
  const stats = await meili.getStats();
  console.log(`[${tag}] meili:`, stats);

  const startTs = Date.now();
  const elapsed = () => ((Date.now() - startTs) / 1000).toFixed(1);
  const heapMb = () => Math.round(process.memoryUsage().heapUsed / 2 ** 20);
  const vocab = new Set<string>();
  const limit = args.limit ?? Number.POSITIVE_INFINITY;
  let docs = 0;
  const read = async (filter: string, label: string) => {
    let n = 0;
    let size = 100;
    while (n < limit) {
      const want = Math.min(size, limit - n);
      const page = await meili.getDocumentsPage<StoredTextDoc>(
        filter,
        ["id", "title", "titleSearch", "body"],
        n,
        want,
      );
      let chars = 0;
      for (const d of page) {
        const parts = [d.title ?? "", d.titleSearch ?? "", d.body ?? ""];
        for (const t of parts) {
          chars += t.length;
          addMeiliWords(t, vocab);
        }
      }
      n += page.length;
      if (page.length < want) break;
      // Nächste Seite nach der Textmenge dieser bemessen.
      const perDoc = Math.max(1, chars / page.length);
      size = Math.min(TEXT_PAGE_MAX, Math.max(TEXT_PAGE_MIN, Math.floor(TEXT_PAGE_CHARS / perDoc)));
    }
    docs += n;
    console.log(`[${tag}] ${label}: docs=${n} Wortschatz=${vocab.size} heap=${heapMb()} MB elapsed=${elapsed()}s`);
  };
  for (const series of seriesList) await read(`series = ${series}`, series);
  // Docs ausserhalb der Serien (Prod: keine) – ihre Wörter stehen ebenso in Meilis Wortschatz.
  if (!args.series) await read(`NOT series IN [${ALL_SERIES.join(", ")}]`, "ohne Serie");
  if (!partial && docs < stats.numberOfDocuments) {
    console.error(
      `[${tag}] FAILED: nur ${docs} von ${stats.numberOfDocuments} Docs gelesen – Wortschatz unvollständig, ` +
        "nichts geschrieben (wurden während des Laufs Docs gelöscht? erneut laufen lassen).",
    );
    process.exitCode = 1;
    return;
  }

  const sorted = [...vocab].sort();
  vocab.clear();
  const gaps = prefixGapSynonyms(sorted);
  const next = toSynonymSetting(gaps);
  const forms = gaps.reduce((n, g) => n + g.forms.length, 0);
  console.log(
    `[${tag}] Wortschatz ${sorted.length} Wörter ab 5 Zeichen – ${gaps.length} Stämme mit Formen hinter ` +
      `der Grenze, ${forms} Formen, elapsed=${elapsed()}s`,
  );
  for (const g of [...gaps].sort((a, b) => b.extensions - a.extensions).slice(0, 25)) {
    console.log(`[${tag}]   ${g.stem} (${g.extensions} Fortsetzungen) → ${g.forms.join(", ")}`);
  }
  const outFile = resolve(process.env["SYNONYMS_OUT"] ?? "output/prefix-synonyms.json");
  await mkdir(dirname(outFile), { recursive: true });
  const lines = Object.entries(next).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  await writeFile(
    outFile,
    `{\n "meta": ${JSON.stringify({ cap: MEILI_PREFIX_CAP, margin: DEFAULT_MARGIN, docs, words: sorted.length, stems: gaps.length, forms, partial })},\n` +
      ` "synonyms": {\n${lines.join(",\n")}\n }\n}\n`,
    "utf-8",
  );
  console.log(`[${tag}] Liste: ${outFile}`);

  if (args.dryRun || partial) {
    console.log(
      `[${tag}] DONE in ${elapsed()}s – ${gaps.length} Stämme, ${forms} Formen ` +
        `(${args.dryRun ? "dry-run" : "--series/--limit"}: nichts geschrieben)`,
    );
    return;
  }
  const current = await meili.getSynonyms();
  const diff = synonymDiff(current, next);
  const diffText = `neu=${diff.added} geändert=${diff.changed} entfernt=${diff.removed} gleich=${diff.unchanged}`;
  if (synonymsUnchanged(diff)) {
    console.log(`[${tag}] DONE in ${elapsed()}s – Synonyme unverändert (${diffText})`);
    return;
  }
  if (gaps.length === 0 && Object.keys(current).length > 0) {
    console.error(
      `[${tag}] FAILED: die neue Liste ist leer, der Index hat ${Object.keys(current).length} Synonyme – ` +
        "nichts geschrieben (Wortschatz gelesen? Ausgabe oben prüfen).",
    );
    process.exitCode = 1;
    return;
  }
  const taskUid = await meili.setSynonyms(next, MEILI_TASK_WAIT_S * 1000);
  console.log(`[${tag}] DONE in ${elapsed()}s – Synonyme geschrieben (Task ${taskUid}): ${diffText}`);
}

async function runExportCorpus(args: CliArgs, env: Env): Promise<void> {
  const outPath = resolve(args.exportCorpus!);
  console.log("[export-corpus] config", {
    dataDir: env.dataDir,
    outPath,
    series: args.series ?? ALL_SERIES,
    limit: args.limit,
  });
  await mkdir(dirname(outPath), { recursive: true });

  const gzip = outPath.endsWith(".gz");
  const startTs = Date.now();
  let count = 0;
  let failed = 0;
  let bytes = 0;

  const source = args.since
    ? await sinceWalker(env.dataDir, args.since)
    : walkData({ dataDir: env.dataDir, series: args.series, limit: args.limit });

  // Stream-Pipeline: async-iter → gzip → file
  async function* lines(): AsyncIterable<string> {
    for await (const file of source) {
      try {
        const parsed = await parseTeiFile(file);
        // Gleicher Embedding-Eingabe-Aufbau wie services/indexer/src/embed.ts:
        // Titel + erste 1500 Zeichen Body.
        const head = parsed.meta.title.trim();
        const body = parsed.body.slice(0, 1500);
        const text = head ? `${head}\n\n${body}` : body;
        const line = JSON.stringify({ id: parsed.meta.id, series: parsed.meta.series, text }) + "\n";
        bytes += Buffer.byteLength(line, "utf-8");
        count++;
        if (count % 10000 === 0) {
          console.log(
            `[export-corpus] ${count} docs, ${(bytes / 1_000_000).toFixed(0)} MB raw, elapsed ${((Date.now() - startTs) / 1000).toFixed(1)}s`,
          );
        }
        yield line;
      } catch (err) {
        failed++;
        console.error(`[export-corpus] FAIL ${file.relPath}:`, err);
      }
    }
  }

  const fileStream = createWriteStream(outPath);
  if (gzip) {
    await pipeline(lines(), createGzip(), fileStream);
  } else {
    await pipeline(lines(), fileStream);
  }

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(`[export-corpus] DONE: ${count} docs, ${failed} failed, ${(bytes / 1_000_000).toFixed(1)} MB raw → ${outPath} in ${elapsed}s`);
}

/**
 * PUBLIC_BASE_URL für IIIF-auflösende Läufe (Hauptpfad, --patch-manifests):
 * fehlt sie oder zeigt sie auf localhost, Abbruch vor dem ersten Schreiben –
 * ausser mit --allow-local-base-url.
 */
function requirePublicBaseUrl(args: CliArgs, env: Env, tag: string): string {
  let base: string;
  try {
    base = resolvePublicBaseUrl(env.publicBaseUrl, { allowLocal: args.allowLocalBaseUrl });
  } catch (err) {
    console.error(`[${tag}] ${(err as Error).message}`);
    process.exit(2);
  }
  if (isLocalUrl(base)) {
    console.warn(
      `[${tag}] ACHTUNG: lokale Manifest-Basis ${base} (${ALLOW_LOCAL_BASE_URL_FLAG}) – ` +
        "nur für lokale Tests, nie gegen Prod.",
    );
  }
  return base;
}

async function writeLocalManifest(outputDir: string, iiif: IIIFLocalResult): Promise<void> {
  const out = join(outputDir, iiif.outputPath);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(iiif.manifest));
}

async function writeRenderedHtml(
  outputDir: string,
  series: SeriesAbbr,
  id: string,
  html: string,
): Promise<void> {
  const out = join(outputDir, "render", series, `${id}.html`);
  const outBr = `${out}.br`;
  await mkdir(dirname(out), { recursive: true });
  // Sowohl Klartext (für SvelteKit-Server-Read) als auch brotli (für Caddy precompressed)
  const buf = Buffer.from(html, "utf-8");
  const br = brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    },
  });
  await Promise.all([writeFile(out, buf), writeFile(outBr, br)]);
}

async function writeRawXml(
  outputDir: string,
  series: SeriesAbbr,
  id: string,
  xml: string,
): Promise<void> {
  const out = join(outputDir, "xml", series, `${id}.xml`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, xml, "utf-8");
}

async function* sinceWalker(
  dataDir: string,
  sinceRef: string,
): AsyncIterable<{ absPath: string; relPath: string; series: SeriesAbbr }> {
  const changed = await gitChangedFiles({ dataDir, sinceRef });
  for (const rel of changed) {
    // rel = "data/<series>/<file>.xml" oder "data/RRB/<MM_x_y>/<file>.xml"
    const parts = rel.split("/");
    if (parts.length < 3 || parts[0] !== "data") continue;
    const series = parts[1] as SeriesAbbr;
    if (!ALL_SERIES.includes(series)) continue;
    yield {
      absPath: join(dataDir, rel),
      relPath: rel,
      series,
    };
  }
}

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
