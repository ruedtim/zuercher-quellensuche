import type { SearchHit, SeriesAbbr } from "$lib/types";
import { searchChunks, fetchDocsByIds, getDocumentBody, type ChunkHit } from "./meili";
import { alignChunk } from "./chunkAlign";
import { mapConcurrent } from "./concurrent";

// Volltexte (je bis 1 MB), die eine Suche gleichzeitig lädt.
const PARENT_CONCURRENCY = 6;

/** Angaben zum Dokument einer Passage, ohne Volltext. */
const PARENT_ATTRIBUTES = ["id", "series", "title", "date", "dateYear", "stazhIdent"];

/** Die Fundstelle: das Parent-Dokument (Metadaten) und der gematchte Chunk. */
export interface PassageCandidate {
	hit: SearchHit;
	chunkId: string;
	chunkText: string;
}

/**
 * Eine Textstelle auf Chunk-Basis. `alignedText` ist die im echten
 * Body lokalisierte Original-Passage (unverfälschte Interpunktion); null wenn
 * das Alignment scheitert – dann dient der gecleante chunkText als Fallback
 * (inhaltlich vollwertig, Ziffern sind darin erhalten).
 */
export interface PassageSource extends PassageCandidate {
	alignedText: string | null;
}

/**
 * Passagen-Retrieval: Top-Chunks suchen, nach Parent-Dokument gruppieren
 * (bester Chunk pro Doc), Angaben zu den Parents laden. Reihenfolge =
 * Chunk-Ranking. Die Volltexte lädt erst alignPassages, nur für die gezeigten.
 * `partial` = Meili brach die Suche ab, die Liste ist womöglich unvollständig.
 * Genutzt vom MCP-Werkzeug passage_search (passageSearch.ts).
 */
export async function retrievePassages(opts: {
	q: string;
	// null = rein lexikalisches Chunk-Retrieval (Stichwort-Tranche).
	vector?: number[] | null;
	series?: SeriesAbbr[];
	dateFrom?: number | null;
	dateTo?: number | null;
	// Wort-Streichung der Stichwort-Suche (searchChunks); die Passagen-Suche nutzt "frequency".
	matchingStrategy?: "last" | "all" | "frequency";
	topK: number;
}): Promise<{ found: PassageCandidate[]; partial: boolean }> {
	const topK = opts.topK;
	// Pool deutlich grösser als topK: lange Dokumente liefern oft mehrere
	// Top-Chunks, nach der Doc-Gruppierung braucht es Diversität im Rest.
	const { hits: pool, partial } = await searchChunks({
		q: opts.q,
		vector: opts.vector,
		series: opts.series,
		dateFrom: opts.dateFrom,
		dateTo: opts.dateTo,
		matchingStrategy: opts.matchingStrategy,
		limit: Math.max(48, topK * 8),
	});

	// Bester Chunk pro Dokument, Reihenfolge des ersten Auftretens (= Ranking).
	const bestByDoc = new Map<string, ChunkHit>();
	for (const chunk of pool) {
		if (!bestByDoc.has(chunk.docId)) bestByDoc.set(chunk.docId, chunk);
	}

	// Parents (bis topK + ein paar Reserve für verwaiste Chunks, deren Parent nicht im Index liegt).
	const candidates = [...bestByDoc.values()].slice(0, topK + 4);
	const parents = await fetchDocsByIds(
		candidates.map((chunk) => chunk.docId),
		PARENT_ATTRIBUTES,
	);
	const byId = new Map(parents.map((doc) => [doc.id, doc]));
	const found: PassageCandidate[] = [];
	for (const chunk of candidates) {
		const doc = byId.get(chunk.docId);
		if (!doc) continue;
		found.push({
			hit: { ...doc, _rankingScore: chunk._rankingScore },
			chunkId: chunk.id,
			chunkText: chunk.chunkText,
		});
	}
	return { found: found.slice(0, topK), partial };
}

/** Die Passagen im Originalwortlaut: je Dokument den Volltext laden, ausrichten und wieder loslassen. */
export function alignPassages(candidates: PassageCandidate[]): Promise<PassageSource[]> {
	return mapConcurrent(candidates, PARENT_CONCURRENCY, async (candidate) => {
		const body = await getDocumentBody(candidate.hit.id);
		return { ...candidate, alignedText: (body ? alignChunk(body, candidate.chunkText) : null)?.text ?? null };
	});
}
