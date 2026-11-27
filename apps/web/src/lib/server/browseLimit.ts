// Deckel fürs Blättern (pur, unit-getestet in browseLimit.test.ts). Genutzt von der Dokumentsuche
// (search.ts, auch Nachbar-Navigation und /api/search) und den Reitern «Archivkatalog»
// (catalog.ts) und «Ehedaten» (ehedaten.ts).
//
// Seit Meili v1.47 kostet jede Seite so viel wie alles davor (`make_hit` für jeden Treffer bis
// zum Offset, auch wenn nur IDs gefragt sind). Prod 2026-11-24, eine Seite à 20 über `page=`:
// Archivkatalog ohne Wort 26 s (Seite 63'183), «Gemeinde» nach Relevanz 5,9 s (Seite 6'230),
// Ehedaten ohne Wort 3,8 s (Seite 14'815). Solche Listen enden darum bei BROWSE_LIMIT; die
// Trefferzahl zählt weiter alle, und mit engeren Filtern sind auch die übrigen erreichbar. Nach
// Datum sortiert reicht die Dokumentsuche bis zum letzten Treffer (Jahresfenster, dateWindow.ts).
// Der Treffer-Export ist nicht betroffen.

import { CORPUS_CAP } from "$lib/types";

/** So viele Treffer lassen sich in einer Liste durchblättern, deren Seiten mit der Tiefe teurer werden. */
export const BROWSE_LIMIT = CORPUS_CAP;

export interface PageParams {
	page: number;
	pageSize: number;
}

/** Beginnt die Seite hinter dem Deckel? */
export function beyondBrowseLimit({ page, pageSize }: PageParams, limit: number = BROWSE_LIMIT): boolean {
	return (page - 1) * pageSize >= limit;
}

/** Fenster der Seite; hinter dem Deckel leer – die Abfrage liefert dann nur Trefferzahl und Facetten. */
export function browseWindow(params: PageParams): { offset: number; limit: number } {
	if (beyondBrowseLimit(params)) return { offset: 0, limit: 0 };
	return { offset: (params.page - 1) * params.pageSize, limit: params.pageSize };
}

/** Feld `browseLimit` der Antwort: nur, wenn die Liste vor dem letzten Treffer endet. */
export function browseLimitOf(total: number, limit: number = BROWSE_LIMIT): { browseLimit?: number } {
	return total > limit ? { browseLimit: limit } : {};
}

/**
 * Eine Seite, sofern sie vor `limit` beginnt. Dahinter gibt es keine Treffer zu holen: nur ein
 * Treffer ab Position 0 für Zahlen, Facetten und Zeitleiste, die Liste bleibt leer.
 */
export async function pageWithin<P extends PageParams, R extends { hits: unknown[]; page: number; pageSize: number }>(
	params: P,
	limit: number,
	run: (params: P) => Promise<R>,
): Promise<R> {
	if (!beyondBrowseLimit(params, limit)) return run(params);
	const head = await run({ ...params, page: 1, pageSize: 1 });
	return { ...head, hits: [], page: params.page, pageSize: params.pageSize };
}
