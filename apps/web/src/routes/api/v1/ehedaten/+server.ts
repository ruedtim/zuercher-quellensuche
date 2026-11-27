// GET /api/v1/ehedaten – Eheeinträge der Ehedatenbank des Staatsarchivs (1524–1800).
//
// Rein lexikalisch wie der Reiter «Ehedaten» der Suche: Volltext (q), Namen mit Rolle,
// Herkunft, Kirchgemeinde, Herkunftsraum, Überlieferung, Art, Band und Zeitraum; Zählungen
// über `facets`. Je Eintrag die übrigen Einträge derselben Ehe aus der geprüften Liste
// (sameMarriage, eine Abfrage für alle). Envelope mit Lizenz CC BY 4.0 und Nennung (okEhedaten).

import type { RequestHandler } from "./$types";
import { ehedatenReady, queryEhedaten, sameMarriages } from "$lib/server/ehedaten";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { ehedatenFacetsMeta, parseEhedatenApiParams, toEhedatenItem } from "$lib/server/apiV1/ehedaten";
import { isParamError } from "$lib/server/apiV1/params";
import { apiRoute, fail, methodNotAllowed, okEhedaten, paginationLinks, type ApiMeta } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	const parsed = parseEhedatenApiParams(url);
	if (isParamError(parsed)) return fail(400, parsed.code, parsed.message);
	if (!(await ehedatenReady())) return fail(503, "service_unavailable", "The marriage records are currently unavailable.");

	const { q, sort, offset, limit, filters, shared, facets } = parsed;
	const result = await queryEhedaten({ q, sort, offset, limit, filters, shared, groupBy: facets });
	const related = await sameMarriages(result.entries);

	const base = apiBaseUrl(url);
	const meta: ApiMeta = { total: result.total, offset, limit, processingTimeMs: result.processingTimeMs };
	if (facets.length > 0) meta.facets = ehedatenFacetsMeta(result.counts);
	const links = paginationLinks(base, "/api/v1/ehedaten", url.searchParams, offset, limit, result.total);
	return okEhedaten(
		result.entries.map((e) => toEhedatenItem(e, base, related.get(e.id))),
		meta,
		links,
		{ "cache-control": "no-store" },
	);
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
