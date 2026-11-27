// GET /api/v1/ehedaten/{id} – ein Eheeintrag über seine Katalog-ID (wie in detail.aspx?ID=…),
// mit den übrigen Einträgen derselben Ehe aus der geprüften Liste (sameMarriage).

import type { RequestHandler } from "./$types";
import { ehedatenReady, getEhedatenEntry, sameMarriages } from "$lib/server/ehedaten";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { toEhedatenItem } from "$lib/server/apiV1/ehedaten";
import { apiRoute, fail, methodNotAllowed, okEhedaten } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ params, url }) => {
	if (!/^\d{1,9}$/.test(params.id)) return fail(400, "invalid_parameter", "Marriage record id must be a positive integer.");
	if (!(await ehedatenReady())) return fail(503, "service_unavailable", "The marriage records are currently unavailable.");
	const entry = await getEhedatenEntry(Number(params.id));
	if (!entry) return fail(404, "not_found", `Marriage record '${params.id}' not found.`);
	const related = await sameMarriages([entry]);
	return okEhedaten(toEhedatenItem(entry, apiBaseUrl(url), related.get(entry.id)), {}, null, { "cache-control": "public, max-age=300" });
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
