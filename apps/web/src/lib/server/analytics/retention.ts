// Aufbewahrungsfrist des Nutzungs-Logs (Datenschutzerklärung §7: 12 Monate).
// Pure Auswahl-Logik ohne Dateisystem, damit sie tsx-testbar ist; das Löschen
// selbst erledigt log.ts beim ersten Flush eines neuen UTC-Tags.

export const DEFAULT_RETENTION_DAYS = 365;

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_MS = 86_400_000;

// ANALYTICS_RETENTION_DAYS: leer/ungültig → Default, <= 0 schaltet das
// Aufräumen ab.
export function parseRetentionDays(raw: string | undefined): number {
	if (raw == null || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
	const n = Number(raw);
	return Number.isFinite(n) ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

/**
 * Tagesdateien (`YYYY-MM-DD.jsonl`), die älter als `retentionDays` Tage sind –
 * gemessen am UTC-Tag `today` (`YYYY-MM-DD`). Fremde Dateinamen bleiben
 * unangetastet; `retentionDays <= 0` oder ein ungültiges `today` löschen nichts.
 */
export function expiredLogFiles(names: string[], today: string, retentionDays: number): string[] {
	if (!Number.isFinite(retentionDays) || retentionDays <= 0) return [];
	const todayMs = Date.parse(`${today}T00:00:00Z`);
	if (Number.isNaN(todayMs)) return [];
	const cutoff = new Date(todayMs - retentionDays * DAY_MS).toISOString().slice(0, 10);
	return names.filter((name) => {
		const m = DAY_FILE.exec(name);
		return m !== null && m[1] < cutoff;
	});
}
