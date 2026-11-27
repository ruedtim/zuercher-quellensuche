// GET /api/dts – DTS-1.0-Entry-Point. Beschreibt die API und verlinkt die
// drei Operationen (Collection/Navigation/Document) als RFC-6570-URI-Templates.
// Spec: https://dtsapi.org/specifications/versions/v1.0/

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { collectionTemplate, documentTemplate, navigationTemplate } from "$lib/server/dts/ids";
import { dtsMethodNotAllowed, dtsRoute, jsonld, ldEnvelope } from "$lib/server/dts/serialize";

export const GET: RequestHandler = dtsRoute(async ({ url }) => {
	const base = apiBaseUrl(url);
	return jsonld(
		{
			...ldEnvelope(),
			"@id": `${base}/api/dts`,
			"@type": "EntryPoint",
			collection: collectionTemplate(base),
			navigation: navigationTemplate(base),
			document: documentTemplate(base),
		},
		{ "cache-control": "public, max-age=3600" },
	);
});

export const fallback: RequestHandler = dtsRoute(async () => dtsMethodNotAllowed());
