import { appendFile, appendFileSync, mkdirSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expiredLogFiles, parseRetentionDays } from "./retention";

// Async, non-blocking JSONL-Writer für Analytics-Events.
// Schreibt eine Datei pro UTC-Tag – der Dateiname (YYYY-MM-DD.jsonl) IST die
// Rotation. Keine logrotate-Konfig nötig. Aufbewahrung: der erste Flush eines
// neuen Tages löscht Tagesdateien älter als ANALYTICS_RETENTION_DAYS
// (Default 365 = die 12 Monate der Datenschutzerklärung, <= 0 = aus).

export type AnalyticsRecord = Record<string, unknown> & {
	ts: string;
	route: string;
	method: string;
	status: number;
	dur_ms: number;
};

const LOG_DIR = process.env.ANALYTICS_LOG_DIR || ".analytics";
const FLUSH_INTERVAL_MS = 500;
const RETENTION_DAYS = parseRetentionDays(process.env.ANALYTICS_RETENTION_DAYS);

let queue: string[] = [];
let dirEnsured = false;
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;
let lastErrorAt = 0;
let lastPruneDay = "";

function ensureDir(): void {
	if (dirEnsured) return;
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		dirEnsured = true;
	} catch (err) {
		// Verzeichnis nicht anlegbar (z.B. Read-only-FS). Wir loggen einmal
		// pro Minute, um nicht jeden Request mit Fehlern zu fluten, und droppen
		// dann still – Analytics darf den User-Request nie ausbremsen.
		const now = Date.now();
		if (now - lastErrorAt > 60_000) {
			lastErrorAt = now;
			console.warn(`[analytics] cannot create ${LOG_DIR}:`, err);
		}
	}
}

function currentDay(): string {
	return new Date().toISOString().slice(0, 10);
}

function currentFilePath(): string {
	return join(LOG_DIR, `${currentDay()}.jsonl`);
}

// Einmal pro UTC-Tag abgelaufene Tagesdateien löschen. Fire-and-forget wie
// der Rest: ein Fehler (z. B. fehlende Rechte) darf nie einen Request stören.
function pruneOncePerDay(): void {
	const day = currentDay();
	if (day === lastPruneDay) return;
	lastPruneDay = day;
	void pruneExpired(day);
}

async function pruneExpired(day: string): Promise<void> {
	try {
		for (const name of expiredLogFiles(await readdir(LOG_DIR), day, RETENTION_DAYS)) {
			await unlink(join(LOG_DIR, name));
		}
	} catch (err) {
		const now = Date.now();
		if (now - lastErrorAt > 60_000) {
			lastErrorAt = now;
			console.warn(`[analytics] pruning ${LOG_DIR} failed:`, err);
		}
	}
}

function scheduleFlush(): void {
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		void flush();
	}, FLUSH_INTERVAL_MS);
}

async function flush(): Promise<void> {
	if (flushing || queue.length === 0) return;
	flushing = true;
	const batch = queue;
	queue = [];
	pruneOncePerDay();
	const path = currentFilePath();
	const payload = batch.join("");
	await new Promise<void>((resolve) => {
		appendFile(path, payload, (err) => {
			if (err) {
				const now = Date.now();
				if (now - lastErrorAt > 60_000) {
					lastErrorAt = now;
					console.warn(`[analytics] append to ${path} failed:`, err);
				}
			}
			resolve();
		});
	});
	flushing = false;
	if (queue.length > 0) scheduleFlush();
}

function flushSync(): void {
	if (queue.length === 0) return;
	const batch = queue;
	queue = [];
	try {
		appendFileSync(currentFilePath(), batch.join(""));
	} catch (err) {
		console.warn("[analytics] sync flush failed:", err);
	}
}

/**
 * Fire-and-forget: schreibt einen Event-Record in die heutige JSONL-Datei.
 * Niemals throw'n, niemals blockieren – Analytics darf den Request-Pfad
 * nicht ausbremsen oder brechen.
 */
export function logEvent(rec: AnalyticsRecord): void {
	try {
		ensureDir();
		queue.push(JSON.stringify(rec) + "\n");
		scheduleFlush();
	} catch (err) {
		const now = Date.now();
		if (now - lastErrorAt > 60_000) {
			lastErrorAt = now;
			console.warn("[analytics] logEvent failed:", err);
		}
	}
}

// Synchroner Flush bei Prozess-Ende – sonst geht die letzte halbe Sekunde
// an Events verloren.
let shutdownHooksInstalled = false;
function installShutdownHooks(): void {
	if (shutdownHooksInstalled) return;
	shutdownHooksInstalled = true;
	const onExit = () => flushSync();
	process.on("beforeExit", onExit);
	process.on("SIGINT", () => {
		flushSync();
		process.exit(130);
	});
	process.on("SIGTERM", () => {
		flushSync();
		process.exit(143);
	});
}
installShutdownHooks();

// Nur für Tests: forciert einen Flush und liefert ein Promise zurück, das
// auflöst, wenn alles auf Disk ist.
export async function __flushForTests(): Promise<void> {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	await flush();
}
