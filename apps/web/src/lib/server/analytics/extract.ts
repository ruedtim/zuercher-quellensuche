// Helfer zum Befüllen der `search` / `doc` Payload-Objekte in Analytics-Records.
// Werden von den Route-Loadern aufgerufen, damit der Hook nicht selbst
// SearchParams parsen muss.

import type { SearchParams, SearchResponse, SeriesAbbr } from "$lib/types";

export interface SearchAnalytics {
	q: string;             // lowercased + getrimmt; "" wenn leer (Browse-Modus)
	theme: string;         // Thema-Filter (semantisch), lowercased + getrimmt
	n: number;             // estimatedTotalHits
	alpha: number;         // semanticRatio (intern aus theme abgeleitet)
	sort: SearchParams["sort"];
	page: number;
	series: SeriesAbbr[];
	persons: string[];
	places: string[];
	organizations: string[];
	date_from: number | null;
	date_to: number | null;
	incremental?: boolean; // true bei /api/search (client-side typeahead)
	view?: "all" | "catalog" | "ehedaten" | "editions"; // Reiter «Alle Quellen» (n = Dokumente), «Archivkatalog», «Ehedaten» bzw. «Editionen»: n = Treffer dort
}

export interface DocAnalytics {
	abbr: SeriesAbbr;
	id: string;
	from_search: boolean;
	pos: number | null;
}

// Ein Aufruf des MCP-Servers (/api/mcp): JSON-RPC-Methode, bei tools/call das Werkzeug,
// Dauer, Trefferzahl und ob es fehlschlug. Bewusst OHNE die Argumente (Suchwörter einer
// fremden KI-Recherche) und ohne Client-Kennung. Bei einem Batch die erste Nachricht und
// `batch` = Anzahl.
export interface McpAnalytics {
	method: string;          // initialize, tools/list, tools/call, prompts/get …
	tool?: string;           // bei tools/call
	prompt?: string;         // bei prompts/get
	ms?: number;             // Dauer des Werkzeugs
	hits?: number;           // Treffer bzw. Einträge im Ergebnis (wo zählbar)
	error?: boolean;         // isError bzw. JSON-RPC-Fehler
	limited?: boolean;       // vom MCP-Kontingent abgewiesen
	batch?: number;          // Anzahl Nachrichten eines Batches
}

export interface ExportAnalytics {
	content: "table" | "text" | "iiif";  // Tabelle / + Volltexte / + IIIF-Sammlung
	format: "csv" | "xlsx";              // Tabellenformat
	n: number;                           // Dokumente im Export (nach Deckel)
	total: number;                       // Bezugsgrösse (alle Treffer)
	scope: "all" | "cap" | "pool" | "topK" | "theme"; // Grund einer Kappung
	q: string;                           // wie search.q (lowercased, getrimmt)
	theme: string;
	series: SeriesAbbr[];
}

export function searchPayload(
	params: SearchParams,
	result: Pick<SearchResponse, "estimatedTotalHits">,
	opts: { incremental?: boolean } = {},
): SearchAnalytics {
	return {
		q: params.q.trim().toLowerCase(),
		theme: params.theme.trim().toLowerCase(),
		n: result.estimatedTotalHits,
		alpha: params.semanticRatio,
		sort: params.sort,
		page: params.page,
		series: params.series,
		persons: params.persons,
		places: params.places,
		organizations: params.organizations,
		date_from: params.dateFrom,
		date_to: params.dateTo,
		...(opts.incremental ? { incremental: true } : {}),
	};
}

// Treffer-Export (/api/search/export): was, wie viel, aus welcher Suche. Bewusst
// KEIN search-Payload – sonst zählte jeder Export als Suche.
export function exportPayload(
	params: SearchParams,
	info: Pick<ExportAnalytics, "content" | "format" | "n" | "total" | "scope">,
): ExportAnalytics {
	return {
		...info,
		q: params.q.trim().toLowerCase(),
		theme: params.theme.trim().toLowerCase(),
		series: params.series,
	};
}

export function docPayload(
	abbr: SeriesAbbr,
	id: string,
	url: URL,
): DocAnalytics {
	const posRaw = url.searchParams.get("pos");
	const pos = posRaw != null ? Number.parseInt(posRaw, 10) : NaN;
	return {
		abbr,
		id,
		from_search: !!url.searchParams.get("from"),
		pos: Number.isFinite(pos) ? pos : null,
	};
}
