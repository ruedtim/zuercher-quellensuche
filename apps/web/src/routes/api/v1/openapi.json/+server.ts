// GET /api/v1/openapi.json – maschinenlesbare OpenAPI-3.1-Spec.

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { openApiDocument } from "$lib/server/apiV1/openapi";
import { apiRoute, jsonResponse, methodNotAllowed } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	// servers dynamisch: in Dev zeigt "Try it out" sonst auf Prod.
	const doc = {
		...openApiDocument,
		servers: [{ url: `${apiBaseUrl(url)}/api/v1` }],
	};
	return jsonResponse(doc, 200, { "cache-control": "public, max-age=3600" });
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
