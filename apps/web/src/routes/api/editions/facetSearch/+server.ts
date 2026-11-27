// Vorschläge der Felder Personen, Orte und Organisationen im Reiter «Editionen»: die Namen der
// aktuellen Treffermenge, ohne die Auswahl des angefragten Feldes (Drill-Sideways, wie
// /api/search/facetSearch der Dokumente). Gleiche Parameter wie die Suchseite plus `dim`
// (persons|places|organizations) und `fq` (Eingabe im Feld).

import { error, json } from "@sveltejs/kit";
import { parseCatalogFilters } from "$lib/catalog";
import { parseEditionsFilters } from "$lib/editionTexts";
import { parseSearchParams } from "$lib/searchParams";
import { editionEntitySuggestions, editionsReady, type EditionsEntityDim } from "$lib/server/editionTexts";
import type { RequestHandler } from "./$types";

const DIMS: readonly EditionsEntityDim[] = ["persons", "places", "organizations"];

export const GET: RequestHandler = async ({ url }) => {
	const dim = url.searchParams.get("dim") as EditionsEntityDim | null;
	if (!dim || !DIMS.includes(dim)) error(400, "dim muss persons, places oder organizations sein");
	if (!(await editionsReady())) return json({ hits: [] });
	const params = parseSearchParams(url);
	// Zeitraum wie im Reiter ab 700 (nicht ab 1483 gekappt).
	const { dateFrom, dateTo } = parseCatalogFilters(url);
	const { active: _active, ...filters } = parseEditionsFilters(url);
	try {
		const hits = await editionEntitySuggestions(dim, { ...params, dateFrom, dateTo }, filters, (url.searchParams.get("fq") ?? "").slice(0, 100));
		return json({ hits }, { headers: { "x-robots-tag": "noindex" } });
	} catch (err) {
		console.warn(`[editions] Vorschläge ${dim}: ${(err as Error).message}`);
		return json({ hits: [] });
	}
};
