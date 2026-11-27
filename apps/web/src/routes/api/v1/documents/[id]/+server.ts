// GET /api/v1/documents/{id} – Einzeldokument mit Volltext und Link-Bündel.
// Ein Meili-Ausfall ist ein 500, kein 404 (getDocument unterscheidet).

import type { RequestHandler } from "./$types";
import { getDocument } from "$lib/server/meili";
import { resolveApiRelations } from "$lib/server/relations";
import { editionLinksForDocument } from "$lib/server/editionLinks";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { apiRoute, fail, methodNotAllowed, ok, toDetailDoc } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ params, url }) => {
	const doc = await getDocument(params.id);
	if (!doc) {
		return fail(404, "not_found", `Document '${params.id}' not found.`);
	}
	const base = apiBaseUrl(url);
	const relations = await resolveApiRelations(doc, base);
	return ok(toDetailDoc(doc, base, relations, editionLinksForDocument(doc.id)), {}, null, {
		"cache-control": "public, max-age=300",
	});
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
