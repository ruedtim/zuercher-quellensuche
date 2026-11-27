// GET /api/v1/stats – Korpus-Statistik (gesamt, pro Serie, pro Jahr).
// Beide Quellen sind serverseitig 5 min gecacht (series.ts / corpusDistCache).

import type { RequestHandler } from "./$types";
import { getCorpusYearDistribution } from "$lib/server/meili";
import { getSeriesInfo } from "$lib/server/apiV1/series";
import { apiRoute, methodNotAllowed, ok } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async () => {
	const [series, byYear] = await Promise.all([getSeriesInfo(), getCorpusYearDistribution()]);
	const bySeries = Object.fromEntries(series.map((s) => [s.abbr, s.documents]));
	const documents = series.reduce((sum, s) => sum + s.documents, 0);
	return ok({ documents, bySeries, byYear }, {}, null, {
		"cache-control": "public, max-age=300",
	});
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
