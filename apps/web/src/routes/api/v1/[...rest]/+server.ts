// Catch-all für unbekannte /api/v1-Pfade: JSON-404 in v1-Shape (statt
// SvelteKits HTML/Plaintext-Fallback). fallback deckt alle HTTP-Methoden.

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { DOCS_PATH } from "$lib/server/apiV1/constants";
import { apiRoute, fail } from "$lib/server/apiV1/respond";

const notFound: RequestHandler = apiRoute(async ({ url }) => {
	const base = apiBaseUrl(url);
	return fail(
		404,
		"not_found",
		`Unknown /api/v1 endpoint. See ${base}/api/v1 for available endpoints or the documentation at ${base}${DOCS_PATH}.`,
	);
});

export const fallback: RequestHandler = notFound;
