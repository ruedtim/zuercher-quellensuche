// Treffer-Export («Alle Treffer herunterladen»): Obergrenzen + wie viele
// Dokumente ein Export tatsächlich enthält. Pur und env-frei – dieselbe Logik
// rechnet die Zahl im Popup (Client) und den Deckel im Endpoint (Server), damit
// beide dieselbe Zahl nennen. Nur relative Imports (läuft unter `tsx --test`).

import { CORPUS_CAP, type SearchResponse } from "./types";

export type ExportContent = "table" | "text" | "iiif";
export type ExportFormat = "csv" | "xlsx";

export const EXPORT_CONTENTS: ExportContent[] = ["table", "text", "iiif"];
export const EXPORT_FORMATS: ExportFormat[] = ["csv", "xlsx"];

// Tabellen sind billig (nur Metadaten), Volltexte teuer (bis 100 KiB pro Doc).
export const EXPORT_TABLE_CAP = 100_000;
export const EXPORT_TEXT_CAP = 10_000;

export function exportCap(content: ExportContent): number {
	return content === "table" ? EXPORT_TABLE_CAP : EXPORT_TEXT_CAP;
}

export function parseExportContent(raw: string | null | undefined): ExportContent | null {
	return EXPORT_CONTENTS.includes(raw as ExportContent) ? (raw as ExportContent) : null;
}

export function parseExportFormat(raw: string | null | undefined): ExportFormat | null {
	return EXPORT_FORMATS.includes(raw as ExportFormat) ? (raw as ExportFormat) : null;
}

/**
 * Warum der Export weniger als alle Treffer enthält:
 * - "all":   alle Treffer
 * - "cap":   Obergrenze des gewählten Inhalts (Tabelle/Volltexte)
 * - "pool":  Thema mit Suchbegriff oder ODER-Begriffen – höchstens CORPUS_CAP Treffer, zuerst
 *            die dem Thema nächsten
 * - "topK":  Thema + Datums-Sortierung – die K ähnlichsten («Themen-Umfang»)
 * - "theme": Thema allein – die CORPUS_CAP ähnlichsten der Filtermenge
 */
export type ExportScope = "all" | "cap" | "pool" | "topK" | "theme";

export interface ExportCount {
	// Dokumente im Export
	count: number;
	// Bezugsgrösse fürs Label «die ersten N von M»
	total: number;
	scope: ExportScope;
}

export type ExportResultInfo = Pick<
	SearchResponse,
	"estimatedTotalHits" | "rankedPool" | "topKOfTotal" | "themeRankedAll"
>;

export function exportableCount(content: ExportContent, result: ExportResultInfo): ExportCount {
	const cap = exportCap(content);
	const hits = Math.max(0, result.estimatedTotalHits);
	// Top-K-Modus: die Trefferliste IST der Schnitt (estimatedTotalHits = K),
	// Bezug «K ähnlichste von X Treffern».
	if (result.topKOfTotal != null) {
		const count = Math.min(hits, cap);
		return count < hits
			? { count, total: hits, scope: "cap" }
			: { count, total: Math.max(result.topKOfTotal, hits), scope: "topK" };
	}
	let available = hits;
	let limited: ExportScope = "all";
	// Die Trefferliste endet früher (rankedPool), der Export reiht bis CORPUS_CAP.
	if (result.rankedPool != null && CORPUS_CAP < available) {
		available = CORPUS_CAP;
		limited = "pool";
	}
	if (result.themeRankedAll && CORPUS_CAP < available) {
		available = CORPUS_CAP;
		limited = "theme";
	}
	if (cap < available) return { count: cap, total: hits, scope: "cap" };
	return { count: available, total: hits, scope: limited };
}

/** Anzeige-Zahl im Schweizer Format (Apostroph als Tausendertrenner). */
export function formatCount(n: number): string {
	return n.toLocaleString("de-CH");
}

/** Kurztext zur Anzahl, z. B. «2'544 Dokumente» oder «die ersten 10'000 von 46'586 Treffern». */
export function exportCountLabel(c: ExportCount): string {
	const docs = c.count === 1 ? "1 Dokument" : `${formatCount(c.count)} Dokumente`;
	switch (c.scope) {
		case "all":
			return docs;
		case "cap":
		case "pool":
			return `die ersten ${formatCount(c.count)} von ${formatCount(c.total)} Treffern`;
		case "topK":
			return c.total > c.count
				? `die ${formatCount(c.count)} ähnlichsten von ${formatCount(c.total)} Treffern`
				: docs;
		case "theme":
			return `die ${formatCount(c.count)} ähnlichsten von ${formatCount(c.total)} Treffern`;
	}
}
