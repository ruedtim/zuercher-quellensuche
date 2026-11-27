// Catch-all für unbekannte /api/dts-Pfade: JSON-404 in DTS-Fehler-Shape
// (statt SvelteKits HTML/Plaintext-Fallback). fallback deckt alle Methoden.

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { dtsError, dtsRoute } from "$lib/server/dts/serialize";

const notFound: RequestHandler = dtsRoute(async ({ url }) => {
	const base = apiBaseUrl(url);
	return dtsError(
		404,
		"not_found",
		`Unknown /api/dts endpoint. See ${base}/api/dts for the entry point and available operations.`,
	);
});

export const fallback: RequestHandler = notFound;
