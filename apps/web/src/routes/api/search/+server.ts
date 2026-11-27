import { json } from "@sveltejs/kit";
import { listAttributes } from "$lib/server/documentResult";
import { executeSearch } from "$lib/server/search";
import { parseSearchParams } from "$lib/searchParams";
import { searchPayload } from "$lib/server/analytics/extract";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
	const params = parseSearchParams(url);

	// Gleiche Such-Logik wie die Trefferliste (inkl. Thema-Filter + strikte
	// Pflicht-Terme); die Timeline-Buckets braucht der API-Client nicht.
	const { timelineBuckets: _timeline, ...result } = await executeSearch(params, {
		lexicalStrict: true,
		attributesToRetrieve: listAttributes(params),
	});
	locals.analytics.search = searchPayload(params, result, { incremental: true });
	// Ohne Volltexte, auch wo der Server sie für den Auszug geholt hat.
	return json({ ...result, hits: result.hits.map(({ body: _body, ...hit }) => hit) });
};
