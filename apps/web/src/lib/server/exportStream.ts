// Streams des Treffer-Exports: CSV (pull-basiert), XLSX (Arbeitsblatt Zeile für
// Zeile) und ZIP mit Volltexten. Speicher bleibt begrenzt – es wird nur so
// schnell aus Meili nachgeladen, wie der Client liest (Backpressure):
//   - CSV: ReadableStream mit pull(), ein Batch pro pull.
//   - XLSX: sheet1.xml als PassThrough-Eintrag im archiver, Schreiben mit drain.
//   - ZIP: Batch-Barriere über archivers `entry`-Events. Das drosselt NUR mit
//     Kompression (deflate): ein Eintrag gilt erst als verarbeitet, wenn seine
//     komprimierten Bytes abgeflossen sind (store-Einträge liefen sofort durch).
// Kein $env – Meili-Zugriff (fetchDocs), Abbruch-Signal und Slot-Freigabe
// werden injiziert (testbar mit tsx --test).

import archiver from "archiver";
import { once } from "node:events";
import { PassThrough, type Writable } from "node:stream";
import { Buffer } from "node:buffer";
import type { SearchHit } from "../types";
import type { ExportContent, ExportFormat } from "../exportLimits";
import {
	CSV_BOM,
	EXPORT_META_FIELDS,
	EXPORT_TEXT_FIELDS,
	buildExportReadme,
	buildIiifCollection,
	csvHeader,
	csvRow,
	docToCells,
	exportColumns,
	iiifItemLabel,
	orderByIds,
	tableEntryName,
	textEntryName,
	type CellValue,
	type ExportColumn,
	type ExportReadmeInput,
	type IiifItem,
} from "./exportFormat";
import {
	XLSX_SHEET_PATH,
	XLSX_STATIC_PARTS,
	XLSX_WORKBOOK_PATH,
	xlsxHeaderRow,
	xlsxRow,
	xlsxSheetEnd,
	xlsxSheetStart,
	xlsxWorkbook,
} from "./xlsx";
import { buildPlainText } from "./packageDownload";
import { responseBody } from "./responseBody";
import { normalizeManifestUrlForUser } from "../manifestUrl";

// Dokumente pro Meili-Abruf: Metadaten sind klein, Volltexte bis 100 KiB.
export const TABLE_BATCH = 1000;
export const TEXT_BATCH = 100;
// Obergrenze Rohtext pro ZIP (Schutz vor Ausreissern: 10'000 × 100 KiB = 1 GB)
export const TEXT_BUDGET_BYTES = 300 * 1024 * 1024;
// Kein Fortschritt so lange ⇒ Export abbrechen (Client hängt/pausiert)
export const IDLE_TIMEOUT_MS = 5 * 60_000;
const RETRY_DELAY_MS = 500;
const ZIP_LEVEL = 5;

export type FetchDocs = (ids: string[], fields: string[], signal: AbortSignal) => Promise<SearchHit[]>;

export interface ExportStats {
	exported: number;
	missing: number;
	textBytes: number;
	stoppedByBudget: boolean;
	error?: string;
}

export interface ExportStreamDeps {
	fetchDocs: FetchDocs;
	// Abbruch durch den Client (request.signal)
	signal: AbortSignal;
	// Gate-Slot freigeben – wird genau einmal aufgerufen (Ende, Abbruch, Fehler)
	release: () => void;
	// Abschluss-Hook (Logging)
	onFinish?: (stats: ExportStats) => void;
	idleTimeoutMs?: number;
	retryDelayMs?: number;
}

export interface ExportJob {
	// Geordnete, deduplizierte IDs (bereits auf den Deckel gekürzt)
	ids: string[];
	content: ExportContent;
	format: ExportFormat;
	baseUrl: string;
	// Ordnername im ZIP (= Dateiname ohne Endung)
	rootName: string;
	// README-Angaben, die schon vor dem Streamen feststehen
	readme: Omit<ExportReadmeInput, "exported" | "missing" | "stoppedByBudget" | "budgetMb" | "withFacsimile" | "withRm">;
	// IIIF-Sammlung (nur content "iiif")
	collection?: { id: string; label: string; summary: string };
}

// --- Gemeinsames ---------------------------------------------------------------

/** Einmal-Abschluss: Slot frei, Hook, Watchdog weg – egal auf welchem Weg. */
function finisher(deps: ExportStreamDeps, stats: ExportStats, cleanup: () => void) {
	let done = false;
	return (error?: unknown) => {
		if (done) return;
		done = true;
		cleanup();
		if (error) stats.error = error instanceof Error ? error.message : String(error);
		try {
			deps.release();
		} finally {
			deps.onFinish?.(stats);
		}
	};
}

/** Internes AbortController, das dem Client-Signal folgt. */
export function linkedAbort(signal: AbortSignal): AbortController {
	const ac = new AbortController();
	if (signal.aborted) ac.abort(signal.reason);
	else signal.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
	return ac;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
		const t = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(t);
			reject(signal.reason ?? new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/** Meili-Abruf mit einem Retry – danach Fehler (nie still abgeschnittene Datei). */
async function fetchWithRetry(
	deps: ExportStreamDeps,
	ids: string[],
	fields: string[],
	signal: AbortSignal,
): Promise<SearchHit[]> {
	try {
		return await deps.fetchDocs(ids, fields, signal);
	} catch (err) {
		if (signal.aborted) throw err;
		await sleep(deps.retryDelayMs ?? RETRY_DELAY_MS, signal);
		return await deps.fetchDocs(ids, fields, signal);
	}
}

/** In einen Node-Writable schreiben und bei vollem Puffer auf drain warten. */
async function writeWithDrain(stream: Writable, chunk: string, signal: AbortSignal): Promise<void> {
	if (signal.aborted) throw signal.reason ?? new Error("aborted");
	if (!stream.write(chunk)) await once(stream, "drain", { signal });
}

/**
 * Zählt archivers `entry`-Events; `waitProcessed(n)` wartet, bis n Einträge
 * verarbeitet sind – bricht aber auch bei Abbruch, close und error ab (sonst
 * hinge der Produzent nach einem Client-Abbruch für immer).
 */
export function trackEntries(zip: archiver.Archiver) {
	let processed = 0;
	let failure: Error | null = null;
	const waiters = new Set<() => void>();
	const wake = () => {
		for (const w of [...waiters]) w();
	};
	zip.on("entry", () => {
		processed++;
		wake();
	});
	zip.on("close", () => {
		failure ??= new Error("Export-Stream geschlossen");
		wake();
	});
	zip.on("error", (err: Error) => {
		failure ??= err;
		wake();
	});
	return {
		waitProcessed(n: number, signal: AbortSignal): Promise<void> {
			return new Promise((resolve, reject) => {
				const check = () => {
					if (processed >= n) return settle(resolve);
					if (signal.aborted) return settle(() => reject(signal.reason ?? new Error("aborted")));
					if (failure) return settle(() => reject(failure));
				};
				const settle = (fn: () => void) => {
					waiters.delete(check);
					signal.removeEventListener("abort", check);
					fn();
				};
				waiters.add(check);
				signal.addEventListener("abort", check);
				check();
			});
		},
	};
}

/** Watchdog für archiver: kein Byte-Fortschritt (pointer) über `idleMs` ⇒ onIdle. */
export function progressWatchdog(zip: archiver.Archiver, idleMs: number, onIdle: () => void): () => void {
	let last = zip.pointer();
	let lastChange = Date.now();
	const tick = Math.min(30_000, Math.max(1_000, Math.floor(idleMs / 4)));
	const timer = setInterval(() => {
		const p = zip.pointer();
		if (p !== last) {
			last = p;
			lastChange = Date.now();
		} else if (Date.now() - lastChange >= idleMs) {
			clearInterval(timer);
			onIdle();
		}
	}, tick);
	timer.unref?.();
	return () => clearInterval(timer);
}

function newArchive(): archiver.Archiver {
	const zip = archiver("zip", { zlib: { level: ZIP_LEVEL } });
	zip.on("warning", (err) => console.warn(`[export] archiver warning: ${err.message}`));
	return zip;
}

/** archiver-Stream als Web-Stream; Slot-Freigabe hängt am Lebensende des Archivs. */
function archiveResponseStream(zip: archiver.Archiver, finish: (error?: unknown) => void): ReadableStream<Uint8Array> {
	zip.on("end", () => finish());
	zip.on("close", () => finish());
	zip.on("error", (err: Error) => finish(err));
	return responseBody(zip);
}

const noop = () => {};

// --- CSV -----------------------------------------------------------------------------

/** Tabelle als CSV (UTF-8 mit BOM), ein Meili-Batch pro pull(). */
export function createCsvStream(job: ExportJob, deps: ExportStreamDeps): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const columns = exportColumns(false);
	const stats: ExportStats = { exported: 0, missing: 0, textBytes: 0, stoppedByBudget: false };
	const ac = linkedAbort(deps.signal);
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	const finish = finisher(deps, stats, () => {
		if (idleTimer) clearTimeout(idleTimer);
	});
	let offset = 0;
	let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
	const armIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			const err = new Error("Export abgebrochen: keine Daten mehr abgeholt");
			ac.abort(err);
			finish(err);
			try {
				controllerRef?.error(err);
			} catch {
				/* bereits geschlossen */
			}
		}, deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS);
		idleTimer.unref?.();
	};

	return new ReadableStream<Uint8Array>({
		start(controller) {
			controllerRef = controller;
			controller.enqueue(encoder.encode(CSV_BOM + csvHeader(columns)));
			armIdle();
		},
		async pull(controller) {
			armIdle();
			if (offset >= job.ids.length) {
				controller.close();
				finish();
				return;
			}
			const chunk = job.ids.slice(offset, offset + TABLE_BATCH);
			try {
				const docs = await fetchWithRetry(deps, chunk, EXPORT_META_FIELDS, ac.signal);
				const { ordered, missing } = orderByIds(chunk, docs, offset);
				let out = "";
				for (const { rank, doc } of ordered) out += csvRow(docToCells(doc, rank, job.baseUrl));
				stats.exported += ordered.length;
				stats.missing += missing;
				offset += chunk.length;
				controller.enqueue(encoder.encode(out));
			} catch (err) {
				finish(err);
				controller.error(err);
			}
		},
		cancel(reason) {
			ac.abort(reason);
			finish();
		},
	});
}

// --- XLSX (nur Tabelle) --------------------------------------------------------------

/** Tabelle als Excel-Datei; das Arbeitsblatt wird Zeile für Zeile gestreamt. */
export function createXlsxStream(job: ExportJob, deps: ExportStreamDeps): ReadableStream<Uint8Array> {
	const columns = exportColumns(false);
	const stats: ExportStats = { exported: 0, missing: 0, textBytes: 0, stoppedByBudget: false };
	const zip = newArchive();
	const ac = linkedAbort(deps.signal);
	let stopWatchdog = noop;
	const finish = finisher(deps, stats, () => stopWatchdog());
	const body = archiveResponseStream(zip, finish);
	zip.on("close", () => ac.abort(new Error("Export-Stream geschlossen")));
	stopWatchdog = progressWatchdog(zip, deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS, () =>
		zip.destroy(new Error("Export abgebrochen: keine Daten mehr abgeholt")),
	);

	const sheet = new PassThrough();
	for (const [name, content] of XLSX_STATIC_PARTS) zip.append(content, { name });
	zip.append(sheet, { name: XLSX_SHEET_PATH });

	void (async () => {
		const signal = ac.signal;
		await writeWithDrain(sheet, xlsxSheetStart(columns) + xlsxHeaderRow(columns), signal);
		let row = 1;
		for (let offset = 0; offset < job.ids.length; offset += TABLE_BATCH) {
			const chunk = job.ids.slice(offset, offset + TABLE_BATCH);
			const docs = await fetchWithRetry(deps, chunk, EXPORT_META_FIELDS, signal);
			const { ordered, missing } = orderByIds(chunk, docs, offset);
			let out = "";
			for (const { rank, doc } of ordered) {
				row++;
				out += xlsxRow(row, docToCells(doc, rank, job.baseUrl), columns);
			}
			stats.exported += ordered.length;
			stats.missing += missing;
			await writeWithDrain(sheet, out, signal);
		}
		await writeWithDrain(sheet, xlsxSheetEnd(row, columns.length), signal);
		sheet.end();
		zip.append(xlsxWorkbook(row, columns.length), { name: XLSX_WORKBOOK_PATH });
		zip.finalize().catch(noop);
	})().catch((err) => {
		sheet.destroy();
		if (!zip.destroyed) zip.destroy(err instanceof Error ? err : new Error(String(err)));
	});

	return body;
}

/** Kleines XLSX komplett im Speicher (Tabelle im Volltext-ZIP, ≤ 10'000 Zeilen). */
export async function buildXlsxBuffer(rows: CellValue[][], columns: ExportColumn[]): Promise<Buffer> {
	const zip = newArchive();
	const chunks: Buffer[] = [];
	zip.on("data", (c: Buffer) => chunks.push(c));
	const done = new Promise<void>((resolve, reject) => {
		zip.on("end", () => resolve());
		zip.on("error", reject);
	});
	for (const [name, content] of XLSX_STATIC_PARTS) zip.append(content, { name });
	let sheet = xlsxSheetStart(columns) + xlsxHeaderRow(columns);
	rows.forEach((cells, i) => {
		sheet += xlsxRow(i + 2, cells, columns);
	});
	sheet += xlsxSheetEnd(rows.length + 1, columns.length);
	zip.append(sheet, { name: XLSX_SHEET_PATH });
	zip.append(xlsxWorkbook(rows.length + 1, columns.length), { name: XLSX_WORKBOOK_PATH });
	zip.finalize().catch(noop);
	await done;
	return Buffer.concat(chunks);
}

// --- ZIP mit Volltexten (+ IIIF-Sammlung) ---------------------------------------

/**
 * ZIP: `texte/<rang>_<signatur>.txt` pro Dokument, danach Tabelle (CSV/XLSX),
 * optional `iiif-collection.json` und `README.txt` – alles im Ordner `rootName/`.
 * Tabellenzeilen werden gesammelt (≤ 10'000, klein) und am Ende geschrieben,
 * damit das README die tatsächlichen Zahlen nennen kann.
 */
export function createZipStream(job: ExportJob, deps: ExportStreamDeps): ReadableStream<Uint8Array> {
	const columns = exportColumns(true);
	const stats: ExportStats = { exported: 0, missing: 0, textBytes: 0, stoppedByBudget: false };
	const zip = newArchive();
	const ac = linkedAbort(deps.signal);
	let stopWatchdog = noop;
	const finish = finisher(deps, stats, () => stopWatchdog());
	const tracker = trackEntries(zip);
	const body = archiveResponseStream(zip, finish);
	zip.on("close", () => ac.abort(new Error("Export-Stream geschlossen")));
	stopWatchdog = progressWatchdog(zip, deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS, () =>
		zip.destroy(new Error("Export abgebrochen: keine Daten mehr abgeholt")),
	);
	const root = job.rootName;
	const withIiif = job.content === "iiif";
	const origin = new URL(job.baseUrl);

	void (async () => {
		const signal = ac.signal;
		const rows: CellValue[][] = [];
		const manifests: IiifItem[] = [];
		let rmDocs = 0;
		let appended = 0;
		let previousBatchEnd = 0;
		for (let offset = 0; offset < job.ids.length && !stats.stoppedByBudget; offset += TEXT_BATCH) {
			// Höchstens zwei Batches unterwegs: vor dem Nachladen muss der
			// vorletzte verarbeitet (= komprimiert zum Client abgeflossen) sein.
			// So überlappen Meili-Abruf und Kompression, der Speicher bleibt klein.
			await tracker.waitProcessed(previousBatchEnd, signal);
			previousBatchEnd = appended;
			const chunk = job.ids.slice(offset, offset + TEXT_BATCH);
			const docs = await fetchWithRetry(deps, chunk, EXPORT_TEXT_FIELDS, signal);
			const { ordered, missing } = orderByIds(chunk, docs, offset);
			stats.missing += missing;
			for (const { rank, doc } of ordered) {
				const text = buildPlainText(doc);
				const size = Buffer.byteLength(text, "utf8");
				if (stats.exported > 0 && stats.textBytes + size > TEXT_BUDGET_BYTES) {
					stats.stoppedByBudget = true;
					break;
				}
				stats.textBytes += size;
				const name = textEntryName(rank, job.ids.length, doc);
				zip.append(text, { name: `${root}/${name}` });
				appended++;
				rows.push(docToCells(doc, rank, job.baseUrl, name));
				if (doc.series === "RM") rmDocs++;
				if (withIiif && doc.manifestUrl) {
					manifests.push({
						manifestUrl: normalizeManifestUrlForUser(doc.manifestUrl, origin),
						label: iiifItemLabel(doc),
						series: doc.series,
					});
				}
				stats.exported++;
			}
		}
		await tracker.waitProcessed(appended, signal);

		const table =
			job.format === "xlsx"
				? await buildXlsxBuffer(rows, columns)
				: CSV_BOM + csvHeader(columns) + rows.map(csvRow).join("");
		zip.append(table, { name: `${root}/${tableEntryName(job.format)}` });
		if (withIiif && job.collection) {
			zip.append(buildIiifCollection({ ...job.collection, items: manifests }), {
				name: `${root}/iiif-collection.json`,
			});
		}
		zip.append(
			buildExportReadme({
				...job.readme,
				exported: stats.exported,
				missing: stats.missing,
				stoppedByBudget: stats.stoppedByBudget,
				budgetMb: Math.round(TEXT_BUDGET_BYTES / (1024 * 1024)),
				withFacsimile: manifests.length,
				withRm: rmDocs,
			}),
			{ name: `${root}/README.txt` },
		);
		zip.finalize().catch(noop);
	})().catch((err) => {
		if (!zip.destroyed) zip.destroy(err instanceof Error ? err : new Error(String(err)));
	});

	return body;
}

/** Passenden Stream für Inhalt + Format wählen. */
export function createExportStream(job: ExportJob, deps: ExportStreamDeps): ReadableStream<Uint8Array> {
	if (job.content !== "table") return createZipStream(job, deps);
	return job.format === "xlsx" ? createXlsxStream(job, deps) : createCsvStream(job, deps);
}
