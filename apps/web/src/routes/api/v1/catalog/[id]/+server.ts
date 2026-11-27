// GET /api/v1/catalog/{id} – eine Verzeichnungseinheit (ID des Online-Katalogs,
// wie in detail.aspx?ID=…). Liefert auch Einheiten, die ein Plattform-Dokument
// abbilden; `document` verweist dann darauf. `editions`: Stücke der QZH und der
// Zürcher Rechtsquellen zu dieser Vorlage bzw. Ratsmanual-Sitzung.

import type { RequestHandler } from "./$types";
import { catalogReady, getCatalogUnit } from "$lib/server/catalog";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { toCatalogItem } from "$lib/server/apiV1/catalog";
import { editionLinksForCatalog } from "$lib/server/editionLinks";
import { apiRoute, fail, methodNotAllowed, okCatalog } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ params, url }) => {
	if (!/^\d{1,9}$/.test(params.id)) return fail(400, "invalid_parameter", "Catalogue id must be a positive integer.");
	if (!(await catalogReady())) return fail(503, "service_unavailable", "The archive catalogue is currently unavailable.");
	const unit = await getCatalogUnit(Number(params.id));
	if (!unit) return fail(404, "not_found", `Catalogue unit '${params.id}' not found.`);
	const editions = editionLinksForCatalog(unit.id, unit.onPlatform === true && unit.docSeries === "RM" ? unit.docId : null);
	return okCatalog(toCatalogItem(unit, apiBaseUrl(url), { full: true, editions }), {}, null, {
		"cache-control": "public, max-age=300",
	});
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
