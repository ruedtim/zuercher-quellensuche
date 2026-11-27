// GET /api/v1/editions – Stücke der Editionen des Staatsarchivs (Quellen zur Zürcher Geschichte
// 1275–1795, Zürcher Rechtsquellen 1180–1800).
//
// Rein lexikalisch wie der Reiter «Editionen» der Suche: Volltext (q, im Suchtext der Editionen
// angeglichen), Edition, Teil, Schlagwort, Personen, Orte, Organisationen, Zeitraum und
// Faksimile; Zählungen über `facets`. Lizenz und Nennung an jedem Stück (okEditions).

import type { RequestHandler } from "./$types";
import { editionsReady, queryEditions } from "$lib/server/editionTexts";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { EDITIONS_FACET_FIELD, editionsFacetsMeta, parseEditionsApiParams, toEditionListItem } from "$lib/server/apiV1/editions";
import { isParamError } from "$lib/server/apiV1/params";
import { apiRoute, fail, methodNotAllowed, okEditions, paginationLinks, type ApiMeta } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	const parsed = parseEditionsApiParams(url);
	if (isParamError(parsed)) return fail(400, parsed.code, parsed.message);
	if (!(await editionsReady())) return fail(503, "service_unavailable", "The editions are currently unavailable.");

	const { q, sort, offset, limit, filters, shared, facets } = parsed;
	const result = await queryEditions({ q, sort, offset, limit, filters, shared, facets: facets.map((f) => EDITIONS_FACET_FIELD[f]) });

	const base = apiBaseUrl(url);
	const meta: ApiMeta = { total: result.total, offset, limit, processingTimeMs: result.processingTimeMs };
	if (facets.length > 0) meta.facets = editionsFacetsMeta(result.counts, facets);
	const links = paginationLinks(base, "/api/v1/editions", url.searchParams, offset, limit, result.total);
	return okEditions(
		result.hits.map((h) => toEditionListItem(h, base)),
		meta,
		links,
		{ "cache-control": "no-store" },
	);
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
