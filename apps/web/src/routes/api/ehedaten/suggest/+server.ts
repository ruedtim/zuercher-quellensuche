// Vorschläge der Felder im Reiter «Ehedaten» (Name, Herkunft, Kirchgemeinde, Band): Werte der
// aktuellen Treffermenge ohne die Auswahl des angefragten Feldes (Drill-Sideways, wie
// /api/search/facetSearch der Dokumente). Gleiche Parameter wie die Suchseite plus `dim`
// (persons|herkunft|kirchgemeinde|band) und `fq` (Eingabe im Feld).

import { error, json } from "@sveltejs/kit";
import { parseEhedatenFilters } from "$lib/ehedaten";
import { parseSearchParams } from "$lib/searchParams";
import { ehedatenReady, ehedatenSuggestions, type EhedatenSuggestDim } from "$lib/server/ehedaten";
import type { RequestHandler } from "./$types";

const DIMS: readonly EhedatenSuggestDim[] = ["persons", "herkunft", "kirchgemeinde", "band"];

export const GET: RequestHandler = async ({ url }) => {
	const dim = url.searchParams.get("dim") as EhedatenSuggestDim;
	if (!DIMS.includes(dim)) error(400, "dim muss persons, herkunft, kirchgemeinde oder band sein");
	if (!(await ehedatenReady())) return json({ hits: [] });
	try {
		const hits = await ehedatenSuggestions(dim, url.searchParams.get("fq") ?? "", parseSearchParams(url), parseEhedatenFilters(url));
		return json({ hits }, { headers: { "x-robots-tag": "noindex" } });
	} catch (err) {
		console.warn(`[ehedaten] Vorschläge ${dim}: ${(err as Error).message}`);
		return json({ hits: [] });
	}
};
