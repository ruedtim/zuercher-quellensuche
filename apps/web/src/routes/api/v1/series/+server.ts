// GET /api/v1/series – die Serien mit Counts, Jahres-Spannen, Subsets.

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { getSeriesInfo } from "$lib/server/apiV1/series";
import { apiRoute, methodNotAllowed, ok } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	const base = apiBaseUrl(url);
	const data = (await getSeriesInfo()).map((s) => ({
		...s,
		links: {
			documents: `${base}/api/v1/documents?series=${s.abbr}`,
			about: `${base}/about/${s.abbr.toLowerCase()}`,
		},
	}));
	return ok(data, { total: data.length }, null, { "cache-control": "public, max-age=300" });
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
