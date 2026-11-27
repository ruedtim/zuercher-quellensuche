// GET /api/v1/facets/{dim} – Facetten-Werte mit Counts, optional per fq
// eingeschränkt, plus dieselben Filter wie die Suche. Drill-Sideways kommt
// aus den internen Funktionen gratis (die angefragte Dimension wird beim
// Zählen aus dem Filter genommen). theme wird hier ignoriert (Parität zur
// internen facetSearch, die das Thema ebenfalls nie auflöst). Bewusst KEIN
// strict-Flag: q bleibt weich (Meili-Default "last"), konsistent zur
// /api/v1/documents-Suche; qAny/titleOnly kennt der v1-Parser nicht. Namensfilter wie
// dort (persons/places/organizations exakt, person/place/organization mit Schlüssel);
// die Werte selbst bleiben Formen, nicht nach Schlüssel zusammengefasst.

import type { RequestHandler } from "./$types";
import { entityKeysReady, searchFacetValues, searchStringFacetValues } from "$lib/server/meili";
import {
	ALL_FACET_DIMS,
	ENTITY_KEYS_PENDING_WARNING,
	ENTITY_PARAMS,
	FACET_LIMIT_DEFAULT,
	FACET_LIMIT_MAX,
	NUMERIC_FACET_DIMS,
	type NumericFacetDim,
	type StringFacetDim,
} from "$lib/server/apiV1/constants";
import { intParam, isParamError, parsePublicSearchParams } from "$lib/server/apiV1/params";
import { apiRoute, fail, methodNotAllowed, ok } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ params, url }) => {
	const dim = params.dim;
	if (!(ALL_FACET_DIMS as string[]).includes(dim)) {
		return fail(
			400,
			"invalid_parameter",
			`Unknown facet dimension '${dim}'. Allowed values: ${ALL_FACET_DIMS.join(", ")}.`,
		);
	}

	// limit gehört hier zur Facetten-Liste (1–50) – für den Filter-Parser
	// entfernen, damit nicht dessen Suche-Deckel (1–100) die Meldung stellt.
	const limit = intParam(url, "limit", 1, FACET_LIMIT_MAX, FACET_LIMIT_DEFAULT);
	if (isParamError(limit)) return fail(400, limit.code, limit.message);

	const filterUrl = new URL(url);
	filterUrl.searchParams.delete("limit");
	filterUrl.searchParams.delete("offset");
	filterUrl.searchParams.delete("facets");
	filterUrl.searchParams.delete("fq");
	const parsed = parsePublicSearchParams(filterUrl);
	if (isParamError(parsed)) return fail(400, parsed.code, parsed.message);

	const facetQuery = (url.searchParams.get("fq") ?? "").trim();
	// Einzahl-Namensfilter der übrigen Dimensionen (die angefragte bleibt beim Zählen
	// ungefiltert). Anders als vor der Suche wartet hier niemand auf die Probe –
	// buildFilter fragt sie synchron ab, beim ersten Aufruf sonst noch ohne Ergebnis.
	const keyed =
		parsed.keyedEntities && ENTITY_PARAMS.some((p) => p.dim !== dim && parsed.params[p.dim].length > 0);
	const keysPending = keyed && !(await entityKeysReady());

	const hits = (NUMERIC_FACET_DIMS as readonly string[]).includes(dim)
		? await searchFacetValues({
				params: parsed.params,
				dimension: dim as NumericFacetDim,
				facetQuery,
				limit,
			})
		: await searchStringFacetValues({
				params: parsed.params,
				dimension: dim as StringFacetDim,
				facetQuery,
				limit,
			});

	return ok(
		hits,
		{ total: hits.length, limit, ...(keysPending ? { warnings: [ENTITY_KEYS_PENDING_WARNING] } : {}) },
		null,
		{ "cache-control": "no-store" },
	);
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
