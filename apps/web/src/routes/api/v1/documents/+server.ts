// GET /api/v1/documents – öffentliche Suche.
//
// Holt intern die Seite bzw. das Fenster [0, offset+limit) über executeSearch (ein Codepfad
// für lexikalisch/Thema/Top-K) und sliced auf die angefragte Seite. Bodies
// werden nie mitgeholt (attributesToRetrieve) – Listen führen nur Excerpts.

import type { RequestHandler } from "./$types";
import { executeSearch } from "$lib/server/search";
import { entityKeysReady, indexHasEmbeddings } from "$lib/server/meili";
import { isEmbedderHealthy } from "$lib/server/embed";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { ENTITY_KEYS_PENDING_WARNING } from "$lib/server/apiV1/constants";
import { isParamError, parsePublicSearchParams } from "$lib/server/apiV1/params";
import {
	apiRoute,
	fail,
	LIST_HIT_ATTRIBUTES,
	methodNotAllowed,
	ok,
	paginationLinks,
	toListHit,
	type ApiMeta,
} from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	const parsed = parsePublicSearchParams(url);
	if (isParamError(parsed)) return fail(400, parsed.code, parsed.message);
	const { params, offset, limit, facets } = parsed;

	const warnings: string[] = [];
	// Einzahl-Namensfilter: ohne Schlüssel im Index filtert buildFilter nur die Form.
	if (parsed.keyedEntities && !(await entityKeysReady())) warnings.push(ENTITY_KEYS_PENDING_WARNING);
	let semanticAvailable = false;
	if (params.theme) {
		semanticAvailable = (await indexHasEmbeddings()) && (await isEmbedderHealthy());
		if (!semanticAvailable) {
			warnings.push(
				"theme was ignored: semantic search is currently unavailable (lexical fallback).",
			);
		}
	}

	// Beginnt das Fenster an einer Seitengrenze, nur diese Seite holen: formatiert würde sonst auch
	// alles davor.
	const aligned = offset % limit === 0;
	const result = await executeSearch(aligned ? { ...params, page: offset / limit + 1, pageSize: limit } : params, {
		semanticAvailable,
		attributesToRetrieve: LIST_HIT_ATTRIBUTES,
		// Öffentliche API: dokumentierter sort-Default ist "relevance" – nicht
		// auf date_asc umbiegen (das ist ein UI-Default der Trefferliste).
		rawSort: true,
	});

	const base = apiBaseUrl(url);
	const data = (aligned ? result.hits : result.hits.slice(offset, offset + limit)).map((h) => toListHit(h, base));

	const meta: ApiMeta = {
		total: result.estimatedTotalHits,
		offset,
		limit,
		processingTimeMs: result.processingTimeMs,
	};
	if (warnings.length > 0) meta.warnings = warnings;
	if (facets.length > 0) {
		const dist = result.facetDistribution ?? {};
		meta.facets = Object.fromEntries(
			facets.map((f) => [f, (dist as Record<string, Record<string, number>>)[f] ?? {}]),
		);
	}

	const links = paginationLinks(
		base,
		"/api/v1/documents",
		url.searchParams,
		offset,
		limit,
		result.estimatedTotalHits,
	);

	return ok(data, meta, links, { "cache-control": "no-store" });
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
