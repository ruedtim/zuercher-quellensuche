// GET /api/v1/catalog – Verzeichnungseinheiten des Online-Archivkatalogs.
//
// Rein lexikalisch, nur Einheiten, die die Plattform nicht selbst als Dokument
// führt (wie der Reiter «Archivkatalog» der Suche). Listen tragen einen Auszug,
// den Text (bis 2'000 Zeichen) liefert /catalog/{id}. Envelope ohne Lizenz, mit Quelle und
// Zitierhinweis (okCatalog).

import type { RequestHandler } from "./$types";
import { topFacetValues } from "$lib/catalog";
import { catalogReady, queryCatalog } from "$lib/server/catalog";
import { CATALOG_FACET_VALUES_MAX } from "$lib/server/apiV1/constants";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { parseCatalogApiParams, toCatalogItem } from "$lib/server/apiV1/catalog";
import { isParamError } from "$lib/server/apiV1/params";
import { apiRoute, fail, methodNotAllowed, okCatalog, paginationLinks, type ApiMeta } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	const parsed = parseCatalogApiParams(url);
	if (isParamError(parsed)) return fail(400, parsed.code, parsed.message);
	if (!(await catalogReady())) return fail(503, "service_unavailable", "The archive catalogue is currently unavailable.");

	const { q, sort, offset, limit, filters, facets } = parsed;
	const result = await queryCatalog({ q, sort, offset, limit, facets: facets.length > 0 }, filters);

	const base = apiBaseUrl(url);
	const meta: ApiMeta = { total: result.total, offset, limit, processingTimeMs: result.processingTimeMs };
	if (facets.length > 0) {
		const all: Record<string, Record<string, number>> = {
			level: result.facets.level,
			// Der Index liefert seit der Zeitleiste bis zu 2'000 Werte; die API bleibt beim bisherigen Deckel.
			bestand: topFacetValues(result.facets.bestand, CATALOG_FACET_VALUES_MAX),
			digital: { true: result.facets.digital },
		};
		meta.facets = Object.fromEntries(facets.map((f) => [f, all[f]]));
	}
	const links = paginationLinks(base, "/api/v1/catalog", url.searchParams, offset, limit, result.total);
	return okCatalog(
		result.hits.map((h) => toCatalogItem(h, base, { full: false })),
		meta,
		links,
		{ "cache-control": "no-store" },
	);
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
