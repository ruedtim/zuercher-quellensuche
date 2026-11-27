// Vorschläge der Felder Personen, Orte und Organisationen im Reiter «Archivkatalog»: die
// Namen der aktuellen Katalog-Treffermenge, ohne die Auswahl des angefragten Feldes
// (Drill-Sideways, wie /api/search/facetSearch der Dokumente). Gleiche Parameter wie die
// Suchseite plus `dim` (persons|places|organizations) und `fq` (Eingabe im Feld).

import { error, json } from "@sveltejs/kit";
import { parseCatalogFilters } from "$lib/catalog";
import { REGISTER_KINDS } from "$lib/catalogRegister";
import { parseSearchParams } from "$lib/searchParams";
import { catalogReady } from "$lib/server/catalog";
import { catalogEntitySuggestions } from "$lib/server/catalogRegister";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const info = REGISTER_KINDS.find((k) => k.formField === url.searchParams.get("dim"));
	if (!info) error(400, "dim muss persons, places oder organizations sein");
	if (!(await catalogReady())) return json({ hits: [] });
	// Suchbegriff und ODER-Begriffe (`qAny`) wie die Liste: ab zwei Begriffen die Vereinigung,
	// ein einzelner gilt als Suchbegriff (catalogLexical).
	const params = parseSearchParams(url);
	try {
		const hits = await catalogEntitySuggestions(info.kind, params, parseCatalogFilters(url), (url.searchParams.get("fq") ?? "").slice(0, 100));
		return json({ hits }, { headers: { "x-robots-tag": "noindex" } });
	} catch (err) {
		console.warn(`[catalog-register] Vorschläge ${info.formField}: ${(err as Error).message}`);
		return json({ hits: [] });
	}
};
