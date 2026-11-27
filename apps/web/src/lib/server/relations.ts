// I/O-Schicht für die API-Auflösung von Dokument-Querverweisen: löst die
// `relations.targetId`s eines Dokuments per einer Batch-Query (`archiveId IN
// [...]`) auf interne Korpus-Dokumente auf und übergibt sie an den puren
// Mapper `toApiRelations`. Gemeinsam genutzt von /api/v1 (Detail) und MCP
// (`fetch`), damit beide identische Relations-Objekte liefern.

import { findByArchiveIds } from "./meili";
import { toApiRelations } from "./apiV1/respond";
import type { ApiRelation } from "$lib/relations";
import type { SearchHit } from "$lib/types";

export async function resolveApiRelations(doc: SearchHit, base: string): Promise<ApiRelation[]> {
	const relations = doc.relations ?? [];
	if (relations.length === 0) return [];
	const ids = relations
		.map((r) => r.targetId)
		.filter((n): n is number => typeof n === "number");
	const found = ids.length ? await findByArchiveIds(ids).catch(() => []) : [];
	const byArchiveId = new Map<number, SearchHit>();
	for (const h of found) {
		if (typeof h.archiveId === "number") byArchiveId.set(h.archiveId, h);
	}
	return toApiRelations(relations, base, byArchiveId, doc.id);
}
