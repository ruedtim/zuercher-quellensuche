/**
 * Scraper für die ab 1. Okt. 2008 auf zh.ch publizierten ("freigegebenen")
 * Regierungsratsbeschlüsse (RRB) des Kantons Zürich. Port von
 * `RRB_scrape/scrape_rrb.py` (Python → tsx, nur native `fetch`, keine Deps).
 *
 * Die zh.ch-Suchmaske ist eine clientseitige AEM-Komponente, die im Hintergrund
 * ein server-gecachtes JSON liefert. Wir sprechen diesen Endpoint direkt an,
 * paginieren über alle Trefferseiten und leiten die PDF-URL nach festem Schema ab.
 *
 *   Index-Endpoint (JSON):
 *     .../jcr:content/main/{COMPONENT_ID}.zhweb-dgc.zhweb-cache.json?page=N&order=...&orderBy=...
 *   PDF-Schema (Beispiel RRB 534/2026):
 *     .../regierungsratsbeschluss-unterlagen./2026/534/RRB-2026-0534.pdf
 *     (Ordner-Nr. ungepaddet, Dateiname 4-stellig genullt; der Punkt in
 *      "...unterlagen./" ist eine AEM-Eigenheit und muss exakt so bleiben.)
 *
 * Wird sowohl als eigenständiges CLI (`tsx src/scrape.ts …`) als auch als
 * Bibliothek von `main.ts` genutzt (buildIndex/downloadPdfs/loadIndex/resolvePdfPath).
 */

import { mkdir, writeFile, rename, stat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const BASE = "https://www.zh.ch";

// AEM-Komponenten-ID der RRB-Suchliste. Einziger fragiler Teil: ändert sich nur,
// falls der Kanton die Seite neu aufbaut. Neu ermitteln über Browser-DevTools →
// Tab "Network" → nach Laden der Suchseite den Request auf
// "...zhweb-dgc.zhweb-cache.json" suchen; die ID steht im Pfad vor ".zhweb-dgc".
export const COMPONENT_ID = "governmentdecisionss_381608543";

export const INDEX_URL =
  `${BASE}/de/politik-staat/gesetze-beschluesse/beschluesse-des-regierungsrates` +
  `/jcr:content/main/${COMPONENT_ID}.zhweb-dgc.zhweb-cache.json`;

export const PUBLISH_BASE = `${BASE}/bin/zhweb/publish/regierungsratsbeschluss-unterlagen.`;

// Nur ASCII (HTTP-Header). Kein Behördenname: archivquellen.ch ist ein inoffizieller
// Prototyp, kein Angebot des Staatsarchivs (Muster: krp-gever/src/cdws.ts).
export const USER_AGENT =
  "zszh-rrb-zhweb/1.0 (+https://archivquellen.ch; Regierungsratsbeschluesse-Indexierung)";

const PDF_MAGIC = Buffer.from("%PDF");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ein normalisierter Index-Datensatz (entspricht 1:1 dem Python-`rrb_index.jsonl`). */
export interface RrbEntry {
  year: number;
  decision_number: number;
  /** Sitzungsdatum "DD.MM.YYYY" (kann leer sein). */
  session_date: string;
  title: string;
  page_url: string;
  pdf_url: string;
  pdf_filename: string;
  /** Volltext-Auszug aus dem AEM-Treffer (kurz). */
  text: string;
}

// --------------------------------------------------------------------------- //
// URL-/Pfad-Helfer
// --------------------------------------------------------------------------- //
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** PDF-URL, Nummer 4-stellig genullt (Schema der meisten Jahrgänge). */
export function pdfUrl(year: number, number: number): string {
  return `${PUBLISH_BASE}/${year}/${number}/RRB-${year}-${pad4(number)}.pdf`;
}

/** PDF-URL, Nummer ohne führende Nullen (z. B. Jahrgang 2017: RRB-2017-248.pdf). */
export function pdfUrlUnpadded(year: number, number: number): string {
  return `${PUBLISH_BASE}/${year}/${number}/RRB-${year}-${number}.pdf`;
}

/** Lokaler Dateiname (immer 4-stellig genullt). */
export function pdfFilename(year: number, number: number): string {
  return `RRB-${year}-${pad4(number)}.pdf`;
}

function pageUrl(link: string): string {
  return link.startsWith("/") ? `${BASE}${link}` : link;
}

// --------------------------------------------------------------------------- //
// HTTP
// --------------------------------------------------------------------------- //
/** GET mit Retry + exp. Backoff. Response bei 200, null bei 404, retry bei transient. */
async function fetchWithRetry(
  url: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<Response | null> {
  const retries = opts.retries ?? 3;
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      if (res.status === 200) return res;
      if (res.status === 404) return null;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.name : String(err);
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  if (lastErr) console.error(`    ! Fehlgeschlagen (${lastErr}): ${url}`);
  return null;
}

// --------------------------------------------------------------------------- //
// Phase 1: Index aufbauen
// --------------------------------------------------------------------------- //
interface AemItem {
  year?: unknown;
  decisionNumber?: unknown;
  sessionDate?: unknown;
  title?: unknown;
  link?: unknown;
  text?: unknown;
}

function normalizeEntry(item: AemItem): RrbEntry | null {
  const year = Number(item.year);
  const number = Number(item.decisionNumber);
  if (!Number.isInteger(year) || !Number.isInteger(number)) return null;
  return {
    year,
    decision_number: number,
    session_date: typeof item.sessionDate === "string" ? item.sessionDate : "",
    title: typeof item.title === "string" ? item.title : "",
    page_url: pageUrl(typeof item.link === "string" ? item.link : ""),
    pdf_url: pdfUrl(year, number),
    pdf_filename: pdfFilename(year, number),
    text: typeof item.text === "string" ? item.text : "",
  };
}

async function* iterIndexPages(opts: {
  order: string;
  orderBy: string;
  delayMs: number;
}): AsyncIterable<{ page: number; totalPages: number; items: AemItem[] }> {
  let page = 1;
  let totalPages: number | null = null;
  while (true) {
    const url =
      `${INDEX_URL}?page=${page}&order=${encodeURIComponent(opts.order)}` +
      `&orderBy=${encodeURIComponent(opts.orderBy)}`;
    const res = await fetchWithRetry(url);
    if (res === null) throw new Error(`Index-Seite ${page} konnte nicht geladen werden.`);
    const payload = (await res.json()) as {
      numberOfResultPages?: unknown;
      numberOfResults?: unknown;
      data?: unknown;
    };
    if (totalPages === null) {
      totalPages = Number(payload.numberOfResultPages) || 1;
      const totalHits = Number(payload.numberOfResults) || 0;
      console.log(
        `  Index: ${totalHits} Beschlüsse auf ${totalPages} Seiten ` +
          `(Sortierung: ${opts.orderBy} ${opts.order}).`,
      );
    }
    const items = Array.isArray(payload.data) ? (payload.data as AemItem[]) : [];
    yield { page, totalPages, items };
    if (page >= totalPages || items.length === 0) break;
    page++;
    if (opts.delayMs) await sleep(opts.delayMs);
  }
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_FIELDS = [
  "year",
  "decision_number",
  "session_date",
  "title",
  "page_url",
  "pdf_url",
  "pdf_filename",
] as const;

/**
 * Paginiert den Endpoint, schreibt `metadata/rrb_index.jsonl` + `.csv` und gibt
 * die Einträge zurück. Bei descending + `fromYear` + `orderBy=session_date` wird
 * abgebrochen, sobald eine ganze Seite unter `fromYear` liegt (Frühabbruch).
 * Roh-Einträge ohne parsebares Jahr/Nummer landen in `metadata/dropped.csv`
 * (statt still zu verschwinden – solche Metadatenfehler upstream sind die
 * plausibelste Ursache für im Korpus fehlende Beschlüsse).
 */
export async function buildIndex(opts: {
  metaDir: string;
  fromYear?: number;
  toYear?: number;
  order: string;
  orderBy: string;
  delayMs: number;
}): Promise<RrbEntry[]> {
  await mkdir(opts.metaDir, { recursive: true });
  const jsonlPath = join(opts.metaDir, "rrb_index.jsonl");
  const csvPath = join(opts.metaDir, "rrb_index.csv");
  const droppedPath = join(opts.metaDir, "dropped.csv");

  const entries: RrbEntry[] = [];
  const jsonlChunks: string[] = [];
  const csvLines: string[] = [CSV_FIELDS.join(",")];
  const droppedLines: string[] = ["reason,year_raw,decision_number_raw,title,link"];
  let rawCount = 0;

  const descending = opts.order.toLowerCase().startsWith("desc");
  // Frühabbruch ist nur bei session_date korrekt (year == Sitzungsjahr, streng
  // monoton). Bei publication_date verschachteln sich Jahreswechsel-Beschlüsse.
  const canEarlyStop = descending && opts.fromYear !== undefined && opts.orderBy === "session_date";
  if (opts.fromYear !== undefined && opts.orderBy !== "session_date" && descending) {
    console.log(
      `    Hinweis: Jahresfilter mit Sortierung nach '${opts.orderBy}' ` +
        `→ kein Frühabbruch, vollständige Paginierung nötig.`,
    );
  }

  console.log("Phase 1: Index aufbauen …");
  for await (const { page, totalPages, items } of iterIndexPages({
    order: opts.order,
    orderBy: opts.orderBy,
    delayMs: opts.delayMs,
  })) {
    rawCount += items.length;
    const pageEntries: RrbEntry[] = [];
    for (const item of items) {
      const e = normalizeEntry(item);
      if (e === null) {
        droppedLines.push(
          [
            "Jahr/Nummer nicht parsebar",
            String(item.year ?? ""),
            String(item.decisionNumber ?? ""),
            typeof item.title === "string" ? item.title : "",
            typeof item.link === "string" ? item.link : "",
          ]
            .map(csvCell)
            .join(","),
        );
        continue;
      }
      pageEntries.push(e);
    }
    for (const e of pageEntries) {
      if (opts.fromYear !== undefined && e.year < opts.fromYear) continue;
      if (opts.toYear !== undefined && e.year > opts.toYear) continue;
      jsonlChunks.push(JSON.stringify(e) + "\n");
      csvLines.push(CSV_FIELDS.map((k) => csvCell(e[k])).join(","));
      entries.push(e);
    }
    if (page % 25 === 0 || page === totalPages) {
      console.log(`    Seite ${page}/${totalPages} – bisher ${entries.length} passende Einträge`);
    }
    if (
      canEarlyStop &&
      pageEntries.length > 0 &&
      Math.max(...pageEntries.map((e) => e.year)) < opts.fromYear!
    ) {
      console.log("    (Frühabbruch: Seiten unterhalb des Startjahres erreicht.)");
      break;
    }
  }

  await writeFile(jsonlPath, jsonlChunks.join(""), "utf-8");
  await writeFile(csvPath, csvLines.join("\n") + "\n", "utf-8");
  await writeFile(droppedPath, droppedLines.join("\n") + "\n", "utf-8");
  const dropped = droppedLines.length - 1;
  console.log(
    `  Index geschrieben: ${rawCount} Roh-Einträge gesehen → ` +
      `${entries.length} im Jahresfenster übernommen, ${dropped} nicht parsebar`,
  );
  console.log(`    → ${jsonlPath}`);
  console.log(`    → ${csvPath}`);
  if (dropped > 0) console.log(`    Verworfene Roh-Einträge: ${droppedPath}`);
  return entries;
}

/** Liest einen zuvor geschriebenen `rrb_index.jsonl` zurück. */
export async function loadIndex(metaDir: string): Promise<RrbEntry[]> {
  const raw = await readFile(join(metaDir, "rrb_index.jsonl"), "utf-8");
  const out: RrbEntry[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t) as RrbEntry);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Phase 2: PDFs herunterladen
// --------------------------------------------------------------------------- //
function isPdf(buf: Buffer): boolean {
  return buf.length >= 1024 && buf.subarray(0, 4).equals(PDF_MAGIC);
}

/**
 * Liefert den Pfad zum bereits gecachten PDF eines Beschlusses, oder null.
 * Prüft gepaddeten UND ungepaddeten Dateinamen – Jahrgang 2017 nutzt teils
 * `RRB-2017-248.pdf` (ungepaddet); ohne diese Prüfung würde der ganze 2017er-
 * Vintage erneut geladen.
 */
async function findCached(yearDir: string, e: RrbEntry): Promise<string | null> {
  const names = [...new Set([e.pdf_filename, `RRB-${e.year}-${e.decision_number}.pdf`])];
  for (const name of names) {
    const p = join(yearDir, name);
    try {
      const st = await stat(p);
      if (st.size > 0) return p;
    } catch {
      /* nicht vorhanden */
    }
  }
  return null;
}

/** Pfad zum (gecachten) PDF im PDF-Root `<root>/<year>/<file>`, oder null. */
export async function resolvePdfPath(pdfRoot: string, e: RrbEntry): Promise<string | null> {
  return findCached(join(pdfRoot, String(e.year)), e);
}

type TryResult = "ok" | "notfound" | "error";

/** Versucht, EINE URL als PDF nach `dest` zu speichern. */
async function tryOneUrl(url: string, dest: string, retries = 3): Promise<TryResult> {
  const tmp = dest + ".part";
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 404) return "notfound";
      if (res.status !== 200) {
        lastErr = `HTTP ${res.status}`;
      } else {
        const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
        if (!ctype.includes("pdf") && !ctype.includes("octet-stream")) return "notfound";
        const buf = Buffer.from(await res.arrayBuffer());
        if (!isPdf(buf)) return "notfound";
        await writeFile(tmp, buf);
        await rename(tmp, dest);
        return "ok";
      }
    } catch (err) {
      lastErr = err instanceof Error ? `stream:${err.name}` : String(err);
    }
    await rm(tmp, { force: true }).catch(() => {});
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  if (lastErr) console.error(`    ! Download fehlgeschlagen (${lastErr}): ${url}`);
  return "error";
}

/** Fallback: echten PDF-Link aus der HTML-Seite des Beschlusses lesen. */
async function resolveFromHtml(
  pageUrlStr: string,
  year: number,
  number: number,
): Promise<string | null> {
  if (!pageUrlStr) return null;
  const res = await fetchWithRetry(pageUrlStr);
  if (res === null) return null;
  const html = await res.text();
  // Doppelte Endung .pdf.pdf kommt auf der Website vereinzelt vor → mit erfassen.
  // Retro-publizierte Beschlüsse (2021–2024) verlinken auf `….PDF` → case-insensitiv.
  const links = [...html.matchAll(/\/bin\/zhweb\/publish\/[^"'\s]+?\.pdf(?:\.pdf)?/gi)].map(
    (m) => m[0],
  );
  if (links.length === 0) return null;
  const folder = `/${year}/${number}/`;
  const inFolder = links.filter((l) => l.includes(folder));
  const pool = inFolder.length > 0 ? inFolder : links;
  for (const token of [`RRB-${year}-${pad4(number)}`, `RRB-${year}-${number}`]) {
    for (const link of pool) {
      const last = link.split("/").pop() ?? "";
      if (last.includes(token)) return BASE + link;
    }
  }
  if (inFolder.length === 1) return BASE + inFolder[0];
  return null;
}

/** Lädt das Haupt-PDF: gepaddet → ungepaddet → HTML-Seite parsen. */
async function downloadDecision(
  e: RrbEntry,
  dest: string,
  delayMs: number,
): Promise<{ status: "downloaded" | "missing"; url: string }> {
  const { year, decision_number: number } = e;
  const candidates = [pdfUrl(year, number)];
  const unp = pdfUrlUnpadded(year, number);
  if (unp !== candidates[0]) candidates.push(unp);

  for (const url of candidates) {
    if ((await tryOneUrl(url, dest)) === "ok") {
      if (delayMs) await sleep(delayMs);
      return { status: "downloaded", url };
    }
  }
  const real = await resolveFromHtml(e.page_url, year, number);
  if (real && !candidates.includes(real)) {
    if ((await tryOneUrl(real, dest)) === "ok") {
      if (delayMs) await sleep(delayMs);
      return { status: "downloaded", url: real };
    }
  }
  return { status: "missing", url: candidates[0] };
}

/**
 * Lädt alle (noch nicht gecachten) PDFs nach `<pdfRoot>/<year>/<file>` und
 * schreibt ein Lückenprotokoll `metadata/missing.csv`.
 */
export async function downloadPdfs(
  entries: RrbEntry[],
  opts: { pdfRoot: string; metaDir: string; delayMs: number; limit?: number },
): Promise<{ downloaded: number; skipped: number; missing: number }> {
  await mkdir(opts.metaDir, { recursive: true });
  const missingPath = join(opts.metaDir, "missing.csv");
  const todo = opts.limit ? entries.slice(0, opts.limit) : entries;
  const total = todo.length;
  const stats = { downloaded: 0, skipped: 0, missing: 0 };
  const missingLines: string[] = ["year,decision_number,pdf_url,status"];

  console.log(`Phase 2: PDFs herunterladen … (${total} Beschlüsse)`);
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    const yearDir = join(opts.pdfRoot, String(e.year));
    await mkdir(yearDir, { recursive: true });
    const dest = join(yearDir, e.pdf_filename);

    if (await findCached(yearDir, e)) {
      stats.skipped++;
    } else {
      let result: { status: "downloaded" | "missing"; url: string };
      try {
        result = await downloadDecision(e, dest, opts.delayMs);
      } catch (err) {
        result = { status: "missing", url: e.pdf_url };
        console.error(`    ! Unerwarteter Fehler bei ${e.pdf_filename}: ${String(err)}`);
      }
      stats[result.status]++;
      if (result.status === "missing") {
        missingLines.push(
          [e.year, e.decision_number, result.url, "missing"]
            .map((x) => csvCell(x as string | number))
            .join(","),
        );
      }
    }
    if ((i + 1) % 50 === 0 || i + 1 === total) {
      console.log(
        `    ${i + 1}/${total} | geladen ${stats.downloaded}, ` +
          `übersprungen ${stats.skipped}, fehlend ${stats.missing}`,
      );
    }
  }

  await writeFile(missingPath, missingLines.join("\n") + "\n", "utf-8");
  console.log("  Download abgeschlossen.");
  console.log(
    `    geladen=${stats.downloaded} übersprungen=${stats.skipped} fehlend=${stats.missing}`,
  );
  if (stats.missing) console.log(`    Lückenprotokoll: ${missingPath}`);
  return stats;
}

// --------------------------------------------------------------------------- //
// Eigenständiges CLI (nur bei direktem Aufruf `tsx src/scrape.ts …`)
// --------------------------------------------------------------------------- //
function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

async function scrapeCli(argv: string[]): Promise<number> {
  let out = "data";
  let fromYear: number | undefined;
  let toYear: number | undefined;
  let limit: number | undefined;
  let delay = 0.5;
  let indexDelay = 0.2;
  let order = "descending";
  let orderBy = "session_date";
  let indexOnly = false;

  for (const arg of argv.slice(2)) {
    if (arg === "--index-only") indexOnly = true;
    else if (arg.startsWith("--out=")) out = arg.slice(6);
    else if (arg.startsWith("--from-year=")) fromYear = Number.parseInt(arg.slice(12), 10);
    else if (arg.startsWith("--to-year=")) toYear = Number.parseInt(arg.slice(10), 10);
    else if (arg.startsWith("--limit=")) limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--delay=")) delay = Number.parseFloat(arg.slice(8));
    else if (arg.startsWith("--index-delay=")) indexDelay = Number.parseFloat(arg.slice(14));
    else if (arg.startsWith("--order=")) order = arg.slice(8);
    else if (arg.startsWith("--order-by=")) orderBy = arg.slice(11);
    else {
      console.error(`unbekanntes Flag: ${arg}`);
      return 2;
    }
  }

  const outDir = expandHome(out);
  const metaDir = join(outDir, "metadata");
  const entries = await buildIndex({ metaDir, fromYear, toYear, order, orderBy, delayMs: indexDelay * 1000 });

  if (indexOnly) {
    console.log("Nur Index gewünscht – Phase 2 übersprungen.");
    return 0;
  }
  if (entries.length === 0) {
    console.log("Keine passenden Einträge – nichts herunterzuladen.");
    return 0;
  }
  await downloadPdfs(entries, {
    pdfRoot: join(outDir, "pdfs"),
    metaDir,
    delayMs: delay * 1000,
    limit,
  });
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  scrapeCli(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[rrb-zhweb/scrape] fatal:", err);
      process.exit(1);
    });
}
