/**
 * Scraper für die ab 1999 auf ZH-Lex (zh.ch) publizierte **Offizielle
 * Gesetzessammlung** (Serie OS) des Kantons Zürich. Analog zu
 * `services/rrb-zhweb/src/scrape.ts`, aber für den ZH-Lex-OS-Endpoint.
 *
 * Die ZH-Lex-Suchmaske ist eine clientseitige AEM-Komponente, die im Hintergrund
 * ein server-gecachtes JSON liefert. Wir sprechen diesen Endpoint direkt an und
 * paginieren über alle Trefferseiten.
 *
 *   Index-Endpoint (JSON), Selektor `zhweb-zhlex-os` (chronologische OS):
 *     .../gesetzessammlung/_jcr_content/main/{COMPONENT_ID}.zhweb-zhlex-os.zhweb-cache.json?page=N
 *
 * Achtung – zwei Eigenheiten gegenüber RRB:
 *   1. `numberOfResults`/`numberOfResultPages` sind auf 150/10 GEDECKELT
 *      (`moreSearchResultsThanAllowed:true`). Der Deckel ist kosmetisch: `page=11,
 *      20,50,…` liefern weiter Daten (rückwärts chronologisch). Wir paginieren
 *      daher bis eine Seite leer ist bzw. komplett unter `fromYear` (Frühabbruch),
 *      NICHT bis `numberOfResultPages`.
 *   2. Es gibt keine ableitbare PDF-URL. Pro Erlass muss die Detailseite geholt
 *      werden, um die Lotus-Notes-`docid` zu lesen; das PDF liegt dann unter dem
 *      kanonischen Notes-Attachment-Form (NOTES_BASE/<docid>/$FILE/<file>).
 *
 * Wird sowohl als eigenständiges CLI (`tsx src/scrape.ts …`) als auch als
 * Bibliothek von `main.ts` genutzt.
 */

import { mkdir, writeFile, rename, stat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const BASE = "https://www.zh.ch";

// AEM-Komponenten-ID der ZH-Lex-Suchliste. Einziger fragiler Teil: ändert sich
// nur, falls der Kanton die Seite neu aufbaut. Neu ermitteln über Browser-DevTools
// → Tab "Network" → nach Laden der Gesetzessammlung-Seite den Request auf
// "...zhweb-zhlex-os.zhweb-cache.json" suchen; die ID steht im Pfad davor.
export const COMPONENT_ID = "lawcollectionsearch_312548694";

export const INDEX_URL =
  `${BASE}/de/politik-staat/gesetze-beschluesse/gesetzessammlung` +
  `/_jcr_content/main/${COMPONENT_ID}.zhweb-zhlex-os.zhweb-cache.json`;

// Kanonisches Notes-Attachment-Form: die `OpenAttachment`-URL aus der Detailseite
// liefert nur eine winzige HTML-JS-Weiterleitung; dieses Form lädt das PDF direkt.
export const NOTES_VIEW = "https://www.notes.zh.ch/appl/zhlex_r.nsf/0";

// Nur ASCII (HTTP-Header). Kein Behördenname: archivquellen.ch ist ein inoffizieller
// Prototyp, kein Angebot des Staatsarchivs (Muster: krp-gever/src/cdws.ts).
export const USER_AGENT =
  "zszh-os-zhlex/1.0 (+https://archivquellen.ch; Gesetzessammlung-Indexierung)";

const PDF_MAGIC = Buffer.from("%PDF");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ein normalisierter Index-Datensatz einer OS-Erlass-Publikation. */
export interface OsEntry {
  /** Eindeutige Doc-ID `OS_<YYYY>_<slugCore>`, z. B. `OS_2025_131_1-81-75`. */
  id: string;
  /** Ordnungsnummer (LS-Systematik), z. B. "131.1". */
  reference_number: string;
  title: string;
  /** Erlassdatum "DD.MM.YYYY" (kann leer sein). */
  enactment_date: string;
  /** Inkraftsetzungsdatum "DD.MM.YYYY" (kann leer sein). */
  entry_into_force_date: string;
  /**
   * Datum fürs TEI `<date>` (DD.MM.YYYY): enactment_date, falls dessen Jahr
   * plausibel ist (1803..maxYear) – sonst entry_into_force_date. So landet bei
   * einem Datums-Tippfehler (z. B. "26.08.2104") nicht das Unsinns-Jahr im Index.
   */
  chosen_date: string;
  /**
   * Zuordnungsjahr für den 1999-Cutoff = Jahr von entry_into_force_date (wann der
   * Erlass in ZH in Kraft trat), Fallback enactment_date. So werden alt-erlassene,
   * aber nach 1999 in Kraft gesetzte Erlasse korrekt aufgenommen.
   */
  year: number;
  /** OS-Bandnummer aus dem Slug (z. B. 81), oder null. */
  band: number | null;
  /**
   * Auffälligkeit (z. B. unplausibles enactment_date-Jahr = vermutlich Tippfehler)
   * oder null. Wird in `metadata/anomalies.csv` protokolliert; der Eintrag wird
   * trotzdem aufgenommen, damit nichts unter den Tisch fällt.
   */
  anomaly: string | null;
  /** zh.ch-Erlass-Detailseite (volle URL). */
  page_url: string;
}

// --------------------------------------------------------------------------- //
// URL-/Slug-Helfer
// --------------------------------------------------------------------------- //
function pageUrl(link: string): string {
  return link.startsWith("/") ? `${BASE}${link}` : link;
}

/** Jahr aus "DD.MM.YYYY" (oder null). */
function yearOf(de: string): number | null {
  const m = de.match(/\.(\d{4})$/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Slug-Kern + Band aus dem Erlass-Link extrahieren.
 *   /…/zhlex-os/erlass-131_1-81-75.html → { core: "131_1-81-75", band: 81 }
 * Der Kern ist der eindeutige Site-Slug (Ordnungsnummer_Band_Seq); die letzten
 * zwei numerischen Bindestrich-Tokens sind Band und laufende Nummer.
 */
function parseSlug(link: string): { core: string; band: number | null } {
  const base = (link.split("/").pop() ?? "").replace(/\.html?$/i, "");
  const core = base.replace(/^erlass-/, "");
  const m = core.match(/^(.+)-(\d+)-(\d+)$/);
  return { core, band: m ? Number.parseInt(m[2], 10) : null };
}

// --------------------------------------------------------------------------- //
// HTTP
// --------------------------------------------------------------------------- //
/** GET mit Retry + exp. Backoff. Response bei 200/204, null bei 404, retry bei transient. */
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
      // 204 = Ende der Pagination: ZH-Lex liefert nach der letzten Datenseite ein
      // "No Content" (nicht eine leere data[]). Als gültige Antwort durchreichen,
      // der Aufrufer bricht darauf ab – NICHT als Fehler retryen.
      if (res.status === 200 || res.status === 204) return res;
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
  link?: unknown;
  referenceNumber?: unknown;
  enactmentTitle?: unknown;
  enactmentDate?: unknown;
  entryIntoForceDate?: unknown;
}

/** Ergebnis von normalizeEntry: gültiger Eintrag oder Verwurf mit Begründung. */
type NormResult = { ok: true; entry: OsEntry } | { ok: false; reason: string };

function normalizeEntry(item: AemItem, maxYear: number): NormResult {
  const link = typeof item.link === "string" ? item.link : "";
  const reference = typeof item.referenceNumber === "string" ? item.referenceNumber : "";
  if (!link) return { ok: false, reason: "kein link" };
  if (!reference) return { ok: false, reason: "keine referenceNumber" };
  const enactment = typeof item.enactmentDate === "string" ? item.enactmentDate : "";
  const eif = typeof item.entryIntoForceDate === "string" ? item.entryIntoForceDate : "";
  const enactYear = yearOf(enactment);
  const eifYear = yearOf(eif);
  // Zuordnungsjahr (für den 1999-Cutoff): wann in ZH in Kraft = entryIntoForceDate;
  // Fallback enactment_date. So bleiben alt-erlassene, nach 1999 in Kraft gesetzte
  // Erlasse drin, statt am enactment-Jahr rauszufallen.
  const year = eifYear ?? enactYear;
  if (year === null) {
    return { ok: false, reason: `Jahr nicht parsebar (enact="${enactment}", eif="${eif}")` };
  }
  // enactment_date plausibel? Sonst (z. B. Tippfehler "2104") fürs Datum/die ID
  // aufs In-Kraft-Datum ausweichen und flaggen – Eintrag NICHT verwerfen.
  const enactPlausible = enactYear !== null && enactYear >= 1803 && enactYear <= maxYear;
  const chosenDate = enactPlausible ? enactment : eif || enactment;
  const idYear = enactPlausible ? enactYear : (eifYear ?? enactYear);
  const anomaly =
    enactYear !== null && !enactPlausible
      ? `enactment_date "${enactment}" (Jahr ${enactYear}) unplausibel – Tippfehler? Nutze eif "${eif}".`
      : null;
  const { core, band } = parseSlug(link);
  return {
    ok: true,
    entry: {
      id: `OS_${idYear}_${core.replace(/[^A-Za-z0-9_-]/g, "-")}`,
      reference_number: reference,
      title: typeof item.enactmentTitle === "string" ? item.enactmentTitle : "",
      enactment_date: enactment,
      entry_into_force_date: eif,
      chosen_date: chosenDate,
      year,
      band,
      anomaly,
      page_url: pageUrl(link),
    },
  };
}

/**
 * Paginiert den OS-Endpoint. Bricht ab, sobald eine Seite leer ist ODER (bei
 * gesetztem `fromYear`) eine komplette Seite unter `fromYear` liegt. `maxPages`
 * ist nur eine Notbremse gegen eine kaputte API.
 */
async function* iterIndexPages(opts: {
  delayMs: number;
  maxPages: number;
}): AsyncIterable<{ page: number; items: AemItem[] }> {
  for (let page = 1; page <= opts.maxPages; page++) {
    const res = await fetchWithRetry(`${INDEX_URL}?page=${page}`);
    if (res === null) throw new Error(`Index-Seite ${page} konnte nicht geladen werden.`);
    if (res.status === 204) break; // No Content = keine weiteren Seiten (res.json() würde werfen)
    const payload = (await res.json()) as { data?: unknown };
    const items = Array.isArray(payload.data) ? (payload.data as AemItem[]) : [];
    yield { page, items };
    if (items.length === 0) break;
    if (opts.delayMs) await sleep(opts.delayMs);
  }
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_FIELDS = [
  "id",
  "reference_number",
  "title",
  "enactment_date",
  "entry_into_force_date",
  "chosen_date",
  "year",
  "band",
  "anomaly",
  "page_url",
] as const;

/**
 * Paginiert den Endpoint, schreibt `metadata/oslate_index.jsonl` + `.csv` und gibt
 * die deduplizierten Einträge zurück (Zuordnungsjahr = entryIntoForceDate ≥ fromYear).
 *
 * Sichtbarkeits-Garantie: JEDER verworfene Eintrag landet mit Grund in
 * `metadata/skipped.csv`, jede Auffälligkeit in `metadata/anomalies.csv`, dazu eine
 * Reconciliation-Summary auf der Konsole (raw → indexiert → verworfen). So fällt
 * nichts mehr lautlos unter den Tisch.
 */
export async function buildIndex(opts: {
  metaDir: string;
  fromYear: number;
  toYear?: number;
  delayMs: number;
  maxPages?: number;
}): Promise<OsEntry[]> {
  await mkdir(opts.metaDir, { recursive: true });
  const jsonlPath = join(opts.metaDir, "oslate_index.jsonl");
  const csvPath = join(opts.metaDir, "oslate_index.csv");
  const skippedPath = join(opts.metaDir, "skipped.csv");
  const anomaliesPath = join(opts.metaDir, "anomalies.csv");

  // Plausibilitätsgrenze fürs enactment_date-Jahr: toYear, sonst „nächstes Jahr".
  const maxYear = opts.toYear ?? new Date().getUTCFullYear() + 1;

  const entries: OsEntry[] = [];
  const seen = new Set<string>();
  const jsonlChunks: string[] = [];
  const csvLines: string[] = [CSV_FIELDS.join(",")];
  const skipLines: string[] = ["reason,referenceNumber,enactmentDate,entryIntoForceDate,title,link"];
  const anomalyLines: string[] = ["id,referenceNumber,anomaly,enactmentDate,entryIntoForceDate"];
  let rawCount = 0;
  const skipReasons = new Map<string, number>();
  const logSkip = (reason: string, item: AemItem) => {
    const key = reason.replace(/\s*\(.*$/, "").replace(/\d+/g, "N");
    skipReasons.set(key, (skipReasons.get(key) ?? 0) + 1);
    skipLines.push(
      [
        reason,
        String(item.referenceNumber ?? ""),
        String(item.enactmentDate ?? ""),
        String(item.entryIntoForceDate ?? ""),
        String(item.enactmentTitle ?? ""),
        String(item.link ?? ""),
      ]
        .map(csvCell)
        .join(","),
    );
  };

  console.log("Phase 1: Index aufbauen …");
  for await (const { page, items } of iterIndexPages({
    delayMs: opts.delayMs,
    maxPages: opts.maxPages ?? 1000,
  })) {
    let pageAllBelow = items.length > 0;
    for (const item of items) {
      rawCount++;
      const res = normalizeEntry(item, maxYear);
      if (!res.ok) {
        logSkip(res.reason, item);
        pageAllBelow = false;
        continue;
      }
      const e = res.entry;
      if (e.year >= opts.fromYear) pageAllBelow = false;
      if (e.year < opts.fromYear) {
        logSkip(`Jahr ${e.year} < ${opts.fromYear}`, item);
        continue;
      }
      if (opts.toYear !== undefined && e.year > opts.toYear) {
        logSkip(`Jahr ${e.year} > ${opts.toYear}`, item);
        continue;
      }
      if (seen.has(e.id)) {
        logSkip(`Duplikat ${e.id}`, item);
        continue;
      }
      seen.add(e.id);
      jsonlChunks.push(JSON.stringify(e) + "\n");
      csvLines.push(CSV_FIELDS.map((k) => csvCell(e[k] ?? "")).join(","));
      if (e.anomaly) {
        anomalyLines.push(
          [e.id, e.reference_number, e.anomaly, e.enactment_date, e.entry_into_force_date]
            .map(csvCell)
            .join(","),
        );
      }
      entries.push(e);
    }
    if (page % 25 === 0) {
      console.log(`    Seite ${page} – bisher ${entries.length} passende Einträge`);
    }
    // Frühabbruch: ganze Seite älter als fromYear (rückwärts unter 1999 angekommen).
    if (pageAllBelow) {
      console.log(`    (Frühabbruch auf Seite ${page}: Seite komplett < ${opts.fromYear}.)`);
      break;
    }
  }

  await writeFile(jsonlPath, jsonlChunks.join(""), "utf-8");
  await writeFile(csvPath, csvLines.join("\n") + "\n", "utf-8");
  await writeFile(skippedPath, skipLines.join("\n") + "\n", "utf-8");
  await writeFile(anomaliesPath, anomalyLines.join("\n") + "\n", "utf-8");

  const skipped = rawCount - entries.length;
  console.log(`  Reconciliation: ${rawCount} von API → ${entries.length} indexiert, ${skipped} verworfen`);
  for (const [reason, n] of [...skipReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${n}× ${reason}`);
  }
  if (anomalyLines.length > 1) {
    console.log(`  ⚠ ${anomalyLines.length - 1} Auffälligkeit(en) → ${anomaliesPath}`);
  }
  console.log(`  Index geschrieben: ${entries.length} Einträge`);
  console.log(`    → ${jsonlPath}`);
  console.log(`    → ${csvPath} · ${skippedPath} · ${anomaliesPath}`);
  return entries;
}

/** Liest einen zuvor geschriebenen `oslate_index.jsonl` zurück. */
export async function loadIndex(metaDir: string): Promise<OsEntry[]> {
  const raw = await readFile(join(metaDir, "oslate_index.jsonl"), "utf-8");
  const out: OsEntry[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t) as OsEntry);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Phase 2: PDFs herunterladen
// --------------------------------------------------------------------------- //
function isPdf(buf: Buffer): boolean {
  return buf.length >= 1024 && buf.subarray(0, 4).equals(PDF_MAGIC);
}

/** Lokaler Dateiname: nach unserer eindeutigen ID (mehrere Änderungen derselben
 * Ordnungsnummer teilen denselben `file=NNN.pdf`-Namen → nicht kollisionssicher). */
function pdfFilename(e: OsEntry): string {
  return `${e.id}.pdf`;
}

/**
 * Cache-Unterordner = Jahr aus der Doc-ID (`OS_<idYear>_…`), nicht aus `e.year`.
 * `e.year` ist das eif-basierte Zuordnungsjahr und kann vom ID-Jahr abweichen
 * (z. B. erlassen 2025 / in Kraft 2026) – dann würde `e.year` den Cache
 * invalidieren. Das ID-Jahr ist stabil → Cache bleibt über Re-Runs gültig.
 */
function pdfYearDir(e: OsEntry): string {
  const m = e.id.match(/^OS_(\d+)_/);
  return m ? m[1] : String(e.year);
}

/** Pfad zum (gecachten) PDF im PDF-Root `<root>/<idYear>/<id>.pdf`, oder null. */
export async function resolvePdfPath(pdfRoot: string, e: OsEntry): Promise<string | null> {
  const p = join(pdfRoot, pdfYearDir(e), pdfFilename(e));
  try {
    const st = await stat(p);
    if (st.size > 0) return p;
  } catch {
    /* nicht vorhanden */
  }
  return null;
}

/**
 * Liest aus der Erlass-Detailseite die Notes-`docid` + den Dateinamen des
 * angehängten PDFs. Quelle ist der `OpenAttachment`-Link:
 *   https://www.notes.zh.ch/appl/zhlex_r.nsf/OpenAttachment?Open&docid=<UNID>&file=<name>.pdf
 */
function parsePdfRef(html: string): { docid: string; file: string } | null {
  const m = html.match(
    /OpenAttachment\?Open&(?:amp;)?docid=([0-9A-Fa-f]+)&(?:amp;)?file=([^"'&\s]+)/,
  );
  if (!m) return null;
  return { docid: m[1], file: decodeURIComponent(m[2]) };
}

/** Kanonische Notes-Attachment-URL (lädt das PDF direkt, kein HTML-Redirect). */
function notesPdfUrl(docid: string, file: string): string {
  return `${NOTES_VIEW}/${docid}/$FILE/${file}`;
}

type TryResult = "ok" | "notfound" | "error";

/** Versucht, EINE URL als PDF nach `dest` zu speichern. */
async function tryOneUrl(url: string, dest: string, retries = 3): Promise<TryResult> {
  const tmp = dest + ".part";
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/pdf,*/*" },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 404) return "notfound";
      if (res.status !== 200) {
        lastErr = `HTTP ${res.status}`;
      } else {
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

/** Holt die Detailseite, extrahiert docid+file, lädt das PDF nach `dest`. */
async function downloadErlass(
  e: OsEntry,
  dest: string,
  delayMs: number,
): Promise<{ status: "downloaded" | "missing"; url: string }> {
  const res = await fetchWithRetry(e.page_url);
  if (res === null) return { status: "missing", url: e.page_url };
  const ref = parsePdfRef(await res.text());
  if (!ref) return { status: "missing", url: e.page_url };
  const url = notesPdfUrl(ref.docid, ref.file);
  if ((await tryOneUrl(url, dest)) === "ok") {
    if (delayMs) await sleep(delayMs);
    return { status: "downloaded", url };
  }
  return { status: "missing", url };
}

/**
 * Lädt alle (noch nicht gecachten) PDFs nach `<pdfRoot>/<year>/<id>.pdf` und
 * schreibt ein Lückenprotokoll `metadata/missing.csv`.
 */
export async function downloadPdfs(
  entries: OsEntry[],
  opts: { pdfRoot: string; metaDir: string; delayMs: number; limit?: number },
): Promise<{ downloaded: number; skipped: number; missing: number }> {
  await mkdir(opts.metaDir, { recursive: true });
  const missingPath = join(opts.metaDir, "missing.csv");
  const todo = opts.limit ? entries.slice(0, opts.limit) : entries;
  const total = todo.length;
  const stats = { downloaded: 0, skipped: 0, missing: 0 };
  const missingLines: string[] = ["id,reference_number,page_url,status"];

  console.log(`Phase 2: PDFs herunterladen … (${total} Erlasse)`);
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    const yearDir = join(opts.pdfRoot, pdfYearDir(e));
    await mkdir(yearDir, { recursive: true });
    const dest = join(yearDir, pdfFilename(e));

    if (await resolvePdfPath(opts.pdfRoot, e)) {
      stats.skipped++;
    } else {
      let result: { status: "downloaded" | "missing"; url: string };
      try {
        result = await downloadErlass(e, dest, opts.delayMs);
      } catch (err) {
        result = { status: "missing", url: e.page_url };
        console.error(`    ! Unerwarteter Fehler bei ${e.id}: ${String(err)}`);
      }
      stats[result.status]++;
      if (result.status === "missing") {
        missingLines.push(
          [e.id, e.reference_number, result.url, "missing"]
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
  let fromYear = 1999;
  let toYear: number | undefined;
  let limit: number | undefined;
  let delay = 0.3;
  let indexDelay = 0.2;
  let indexOnly = false;

  for (const arg of argv.slice(2)) {
    if (arg === "--index-only") indexOnly = true;
    else if (arg.startsWith("--out=")) out = arg.slice(6);
    else if (arg.startsWith("--from-year=")) fromYear = Number.parseInt(arg.slice(12), 10);
    else if (arg.startsWith("--to-year=")) toYear = Number.parseInt(arg.slice(10), 10);
    else if (arg.startsWith("--limit=")) limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--delay=")) delay = Number.parseFloat(arg.slice(8));
    else if (arg.startsWith("--index-delay=")) indexDelay = Number.parseFloat(arg.slice(14));
    else {
      console.error(`unbekanntes Flag: ${arg}`);
      return 2;
    }
  }

  const outDir = expandHome(out);
  const metaDir = join(outDir, "metadata");
  const entries = await buildIndex({ metaDir, fromYear, toYear, delayMs: indexDelay * 1000 });

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
      console.error("[os-zhlex/scrape] fatal:", err);
      process.exit(1);
    });
}
