// Vorschläge für das Feld «Bestand» der Feldsuche im Reiter «Archivkatalog»: die Bestände der
// aktuellen Treffermenge ohne die Bestandswahl (Drill-Sideways), passend zur Eingabe `fq`
// (catalogBestandSuggestions). Gleiche Parameter wie die Suchseite.

import { json } from "@sveltejs/kit";
import { parseCatalogFilters } from "$lib/catalog";
import { parseSearchParams } from "$lib/searchParams";
import { catalogBestandSuggestions, catalogReady } from "$lib/server/catalog";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	if (!(await catalogReady())) return json({ hits: [] });
	try {
		const hits = await catalogBestandSuggestions(parseSearchParams(url), parseCatalogFilters(url), (url.searchParams.get("fq") ?? "").slice(0, 100));
		return json({ hits }, { headers: { "x-robots-tag": "noindex" } });
	} catch (err) {
		console.warn(`[catalog] Bestandsvorschläge: ${(err as Error).message}`);
		return json({ hits: [] });
	}
};
