// GET /api/v1/documents/{id}/similar – Embedding-basierte Ähnlichkeitssuche
// (keine Textgenerierung). Degradiert wie die interne /api/similar-Route:
// Embeddings/Embedder nicht verfügbar → 200 mit leerer Liste + meta.warnings.

import type { RequestHandler } from "./$types";
import { findSimilar, getDocument, indexHasEmbeddings } from "$lib/server/meili";
import { embedQuery, isEmbedderHealthy } from "$lib/server/embed";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import {
	SIMILAR_LIMIT_DEFAULT,
	SIMILAR_LIMIT_MAX,
} from "$lib/server/apiV1/constants";
import { intParam, isParamError } from "$lib/server/apiV1/params";
import { apiRoute, fail, methodNotAllowed, ok, toListHit } from "$lib/server/apiV1/respond";
import { isLexicalOnlySeries } from "$lib/types";

export const GET: RequestHandler = apiRoute(async ({ params, url }) => {
	const limit = intParam(url, "limit", 1, SIMILAR_LIMIT_MAX, SIMILAR_LIMIT_DEFAULT);
	if (isParamError(limit)) return fail(400, limit.code, limit.message);

	const doc = await getDocument(params.id);
	if (!doc) {
		return fail(404, "not_found", `Document '${params.id}' not found.`);
	}

	const degraded = (warning: string) =>
		ok([], { warnings: [warning] }, null, { "cache-control": "no-store" });

	// Ratsmanuale (RM): ohne Vektoren – ein Embedding der HTR-Lesefassung fände
	// nur zufällige Nachbarn in den modernen Serien.
	if (isLexicalOnlySeries(doc.series)) {
		return degraded(`Similarity search is not available for series ${doc.series} (no embeddings).`);
	}
	if (!(await indexHasEmbeddings())) {
		return degraded("Similarity search is unavailable: the index was built without embeddings.");
	}
	if (!(await isEmbedderHealthy())) {
		return degraded("Similarity search is currently unavailable: embedding service unreachable.");
	}

	const text = `${doc.title}\n\n${(doc.body ?? "").slice(0, 1500)}`;
	const vector = await embedQuery(text);
	if (!vector) {
		return degraded("Similarity search is currently unavailable: embedding failed.");
	}

	const base = apiBaseUrl(url);
	const hits = await findSimilar({ id: params.id, limit, vector });
	return ok(
		hits.map((h) => toListHit(h, base)),
		{ total: hits.length, limit },
		null,
		{ "cache-control": "no-store" },
	);
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
