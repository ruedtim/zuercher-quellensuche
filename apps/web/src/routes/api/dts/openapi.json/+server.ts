// GET /api/dts/openapi.json – maschinenlesbare OpenAPI-3.1-Spec der DTS-API.
// Beschreibt die DTS-Endpoints, ist selbst aber simples JSON – darum die
// apiV1/respond-Helfer (wie die v1-Spec-Route), nicht die DTS-JSON-LD-Helfer.
// Spezifische Route schlägt die [...rest]-Catch-all der DTS-API.

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { apiRoute, jsonResponse, methodNotAllowed } from "$lib/server/apiV1/respond";
import { dtsOpenApiDocument } from "$lib/server/dts/openapi";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	// servers dynamisch: in Dev zeigt "Try it out" sonst auf Prod.
	const doc = {
		...dtsOpenApiDocument,
		servers: [{ url: `${apiBaseUrl(url)}/api/dts` }],
	};
	return jsonResponse(doc, 200, { "cache-control": "public, max-age=3600" });
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
