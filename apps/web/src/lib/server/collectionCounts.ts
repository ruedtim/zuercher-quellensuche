// Grösse der Bestände neben den Dokumenten (Startseite), 5 min gecacht; null = Index nicht bereit.
import { catalogReady, countCatalogUnits } from "./catalog";
import { countEhedaten, ehedatenReady } from "./ehedaten";
import { countEditions, editionsReady } from "./editionTexts";
import { NO_EHEDATEN_FILTERS } from "$lib/ehedaten";
import { NO_EDITIONS_FILTERS } from "$lib/editionTexts";
import { DEFAULT_SEARCH } from "$lib/types";
import { createTtlLruCache } from "./ttlCache";

export interface CollectionCounts {
	/** Ganzer Katalog, samt den Einheiten der Dokumente (Tim 2026-11-25); der Reiter zählt weniger. */
	catalog: number | null;
	ehedaten: number | null;
	editions: number | null;
}

const cache = createTtlLruCache<CollectionCounts>({ maxEntries: 1, ttlMs: 5 * 60_000 });

export async function collectionCounts(): Promise<CollectionCounts> {
	const cached = cache.get("all");
	if (cached) return cached;
	const [catalog, ehedaten, editions] = await Promise.all([
		catalogReady().then((ok) => (ok ? countCatalogUnits() : null)),
		ehedatenReady().then((ok) => (ok ? countEhedaten(DEFAULT_SEARCH, NO_EHEDATEN_FILTERS) : null)),
		editionsReady().then((ok) => (ok ? countEditions(DEFAULT_SEARCH, NO_EDITIONS_FILTERS) : null)),
	]);
	const counts = { catalog, ehedaten, editions };
	// Einen Ausfall nicht merken, beim nächsten Aufruf neu zählen.
	if (catalog !== null && ehedaten !== null && editions !== null) cache.set("all", counts);
	return counts;
}
