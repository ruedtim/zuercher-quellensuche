// GET /api/v1/editions/{edition}/{id} – ein Stück einer Edition über seine Kennung in der
// Edition (QZH: «QZH_401», Rechtsquellen: «SSRQ_ZH_NF_II_3_047»; die Kennung eines Texts wie
// «…_047_2» liefert sein Stück), mit Text, Regest, Kommentar, Anmerkungen, Personen und Orten.

import type { RequestHandler } from "./$types";
import { isIndexedEdition, INDEXED_EDITIONS } from "$lib/editionTexts";
import { editionsReady, getEditionUnit } from "$lib/server/editionTexts";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { toEditionItem } from "$lib/server/apiV1/editions";
import { apiRoute, fail, methodNotAllowed, okEditions } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ params, url }) => {
	if (!isIndexedEdition(params.edition)) return fail(404, "not_found", `Unknown edition '${params.edition}'. Available: ${INDEXED_EDITIONS.join(", ")}.`);
	if (!/^[A-Za-z0-9_-]{1,120}$/.test(params.id)) return fail(400, "invalid_parameter", "Edition piece id must look like 'QZH_401' or 'SSRQ_ZH_NF_II_3_047'.");
	if (!(await editionsReady())) return fail(503, "service_unavailable", "The editions are currently unavailable.");
	const unit = await getEditionUnit(params.edition, params.id);
	if (!unit) return fail(404, "not_found", `Edition piece '${params.edition}/${params.id}' not found.`);
	return okEditions(toEditionItem(unit, apiBaseUrl(url)), {}, null, { "cache-control": "public, max-age=300" });
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
