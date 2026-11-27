import { error, json } from "@sveltejs/kit";
import { entityKeysReady, entityKeysReadyNow, searchFacetValues, searchStringFacetValues } from "$lib/server/meili";
import { documentEntitySuggestions } from "$lib/server/documentEntitySuggestions";
import { ENTITY_DIMS, type EntityDim } from "$lib/entityFilter";
import { parseSearchParams } from "$lib/searchParams";
import type { RequestHandler } from "./$types";

const NUMERIC_DIMS = ["volumeNr", "startPg", "years"] as const;
const STRING_DIMS = ["persons", "places", "organizations", "resolutionId", "serialNr"] as const;
type NumericDim = (typeof NUMERIC_DIMS)[number];
type StringDim = (typeof STRING_DIMS)[number];

export const GET: RequestHandler = async ({ url }) => {
	const dim = url.searchParams.get("dim");
	const isNumeric = dim && NUMERIC_DIMS.includes(dim as NumericDim);
	const isString = dim && STRING_DIMS.includes(dim as StringDim);
	if (!isNumeric && !isString) {
		throw error(
			400,
			`dim muss eine von ${[...NUMERIC_DIMS, ...STRING_DIMS].join(", ")} sein`,
		);
	}
	// `fq` = facetQuery (Prefix für die Werte-Liste), `q` = globaler Such-Text
	// aus dem Such-Form (drill-sideways). Beide werden vom Frontend explizit
	// getrennt gesetzt, damit die facet-distribution nicht zusätzlich auf den
	// Tippstand des facet-Inputs eingeschränkt wird.
	const facetQuery = url.searchParams.get("fq") ?? "";
	const params = parseSearchParams(url);
	// Personen, Orte, Organisationen: Trägt der Index die Vergleichsschlüssel, filtert die
	// Wahl eines Namens nach Form oder Schlüssel – dann ein Vorschlag je Schlüssel mit der
	// Zahl, die die Wahl liefert (documentEntitySuggestions.ts). Sonst, bei einem Fehler und
	// für die Serien-Identifier die Formen (wie /api/v1/facets).
	if (ENTITY_DIMS.includes(dim as EntityDim) && (await entityKeysReady())) {
		try {
			const hits = await documentEntitySuggestions({
				params,
				dimension: dim as EntityDim,
				facetQuery,
				limit: 20,
				strict: true,
			});
			return json({ hits, keyed: true });
		} catch (err) {
			console.warn(`[facetSearch] Vorschläge je Schlüssel (${dim}): ${(err as Error).message}`);
		}
	}
	// strict: Pflicht-Terme wie die Hauptliste (lexicalStrict in
	// +page.server.ts / /api/search) – sonst zählt der Typeahead eine weichere
	// (grössere) Treffermenge als die Trefferliste daneben.
	const hits = isString
		? await searchStringFacetValues({
				params,
				dimension: dim as StringDim,
				facetQuery,
				limit: 20,
				strict: true,
			})
		: await searchFacetValues({
				params,
				dimension: dim as NumericDim,
				facetQuery,
				limit: 20,
				strict: true,
			});
	// keyed: ob die Namensfilter gerade über die Schlüssel gelten (die Combobox wählt danach).
	return json({ hits, keyed: entityKeysReadyNow() });
};
