// Schutz für Treffer-Export und ZIP-Pakete mit Bildern: eigene Rate-Limit-Buckets
// (`export:`, `package:`) plus In-Memory-Slots für gleichzeitige Downloads. Exporte
// sind teuer (ID-Pass bis 100'000 Treffer, Volltexte bis 10'000 Dokumente), Pakete
// laden bis zu Hunderte Scans von einem fremden Bildserver, und alles läuft auf
// demselben Server wie die Live-Suche – darum global UND pro Client begrenzt.
//
// In-memory genügt: genau eine web-Replica (s. apiV1/rateLimit.ts). Client-Key
// = anonymisierte IP (IPv4 /24, IPv6 /32: ein ganzer Anbieter) – mehrere Personen
// teilen sich das Kontingent, darum pro Client mehr als ein Slot, für die kleinen
// und häufigen Pakete eigene. Pur, testbar (tsx --test).

import { checkRateLimit } from "./apiV1/rateLimit";

export type ExportKind = "table" | "text" | "package";

// Starts pro Client und Fenster (Rate-Limit)
export const EXPORT_RATE_LIMIT = 10;
export const EXPORT_RATE_WINDOW_MS = 10 * 60_000;
// Pakete sind kleiner, wer Dokument um Dokument lädt, braucht mehr davon
export const PACKAGE_RATE_LIMIT = 60;
// Gleichzeitig laufende Downloads, insgesamt und je Client (Tabellen und Volltexte zusammen)
export const EXPORT_MAX_ACTIVE: Record<ExportKind, number> = { table: 4, text: 2, package: 8 };
export const EXPORT_MAX_ACTIVE_PER_CLIENT = 2;
export const PACKAGE_MAX_ACTIVE_PER_CLIENT = 4;

const active: Record<ExportKind, number> = { table: 0, text: 0, package: 0 };
const activePerClient = new Map<string, number>();

export type GateResult =
	| { ok: true; release: () => void }
	| { ok: false; status: 429 | 503; retryAfterS: number; message: string };

/**
 * Prüft Rate-Limit und freie Slots und belegt einen Slot. `release` gibt ihn
 * genau einmal frei (weitere Aufrufe sind wirkungslos) – Aufrufer ruft es bei
 * Stream-Ende, -Abbruch und -Fehler.
 */
export function tryAcquireExport(kind: ExportKind, clientKey: string, now: number = Date.now()): GateResult {
	const isPackage = kind === "package";
	const slotKey = `${isPackage ? "package" : "export"}:${clientKey}`;
	const clientActive = activePerClient.get(slotKey) ?? 0;
	if (clientActive >= (isPackage ? PACKAGE_MAX_ACTIVE_PER_CLIENT : EXPORT_MAX_ACTIVE_PER_CLIENT)) {
		return {
			ok: false,
			status: 503,
			retryAfterS: 30,
			message:
				"Aus Ihrem Netzwerk laufen bereits Downloads. Bitte warten Sie, bis diese fertig sind, und versuchen Sie es dann erneut.",
		};
	}
	if (active[kind] >= EXPORT_MAX_ACTIVE[kind]) {
		return {
			ok: false,
			status: 503,
			retryAfterS: 30,
			message: "Gerade laufen viele Downloads. Bitte versuchen Sie es in einer halben Minute erneut.",
		};
	}
	const rate = checkRateLimit(slotKey, isPackage ? PACKAGE_RATE_LIMIT : EXPORT_RATE_LIMIT, EXPORT_RATE_WINDOW_MS, now);
	if (!rate.ok) {
		const minutes = Math.max(1, Math.ceil(rate.retryAfterS / 60));
		return {
			ok: false,
			status: 429,
			retryAfterS: rate.retryAfterS,
			message: `Zu viele Downloads in kurzer Zeit. Bitte versuchen Sie es in ${minutes} ${minutes === 1 ? "Minute" : "Minuten"} erneut.`,
		};
	}
	active[kind]++;
	activePerClient.set(slotKey, clientActive + 1);
	let released = false;
	return {
		ok: true,
		release: () => {
			if (released) return;
			released = true;
			active[kind] = Math.max(0, active[kind] - 1);
			const n = (activePerClient.get(slotKey) ?? 1) - 1;
			if (n <= 0) activePerClient.delete(slotKey);
			else activePerClient.set(slotKey, n);
		},
	};
}

/** Nur für Tests/Diagnose: laufende Exporte. */
export function activeExports(): Record<ExportKind, number> & { clients: number } {
	return { ...active, clients: activePerClient.size };
}

/** Nur für Tests: Zustand zurücksetzen. */
export function resetExportGate(): void {
	active.table = 0;
	active.text = 0;
	active.package = 0;
	activePerClient.clear();
}
