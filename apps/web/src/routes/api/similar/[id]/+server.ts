import { error, json } from "@sveltejs/kit";
import { findSimilar, getDocument, indexHasEmbeddings } from "$lib/server/meili";
import { embedQuery, isEmbedderHealthy } from "$lib/server/embed";
import { isLexicalOnlySeries } from "$lib/types";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, url }) => {
	const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "10", 10) || 10));

	const doc = await getDocument(params.id);
	if (!doc) {
		throw error(404, "Dokument nicht gefunden");
	}

	// Ratsmanuale (RM): ohne Vektoren – ein Embedding der HTR-Lesefassung fände
	// nur zufällige Nachbarn in den modernen Serien.
	if (isLexicalOnlySeries(doc.series)) {
		return json({
			hits: [],
			note: "Für die Ratsmanuale gibt es keine Ähnlichkeitssuche: diese Serie ist nur über die Stichwortsuche erschlossen (keine Vektoren).",
		});
	}

	if (!(await indexHasEmbeddings())) {
		return json({
			hits: [],
			note:
				"Semantische Ähnlichkeit ist nicht verfügbar – der Index wurde ohne Embeddings aufgebaut. Für diese Funktion muss der Indexer mit aktivem Embed-Service neu durchlaufen werden.",
		});
	}

	if (!(await isEmbedderHealthy())) {
		return json({ hits: [], note: "Embed-Service nicht erreichbar." });
	}

	const text = `${doc.title}\n\n${(doc.body ?? "").slice(0, 1500)}`;
	const vector = await embedQuery(text);
	if (!vector) {
		return json({ hits: [], note: "Embedding fehlgeschlagen." });
	}

	const hits = await findSimilar({ id: params.id, limit, vector });
	return json({ hits });
};
