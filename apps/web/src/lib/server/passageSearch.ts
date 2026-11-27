// Passagen-Suche für das MCP-Werkzeug passage_search: die passendsten
// Textstellen zu einer Anfrage, eine je Dokument im Originalwortlaut
// (alignChunk), aus dem Passagen-Index `chunks` (Dokumente der Zentralen Serien
// ohne die Ratsmanuale). Externe KI-Assistenten brauchen Textstellen statt
// ganzer Dokumente (Volltexte bis 100 KiB). Ablauf wie die frühere erste
// Quellen-Tranche der KI-Antwort (bis 2026-11, Branch archiv/ki-antwort):
// Hybrid-Suche (Vektor der Anfrage + Stichwort-Arm mit der bereinigten
// BM25-Query) und eine reine Stichwortsuche gemischt (passageMerge.ts, für
// seltene Namen); ohne Embed-Service nur die Stichwortsuche.

import type { SeriesAbbr } from "$lib/types";
import { embedQuery } from "./embed";
import { alignPassages, retrievePassages, type PassageCandidate, type PassageSource } from "./passageRetrieval";
import { mergeLexicalPage } from "./passageMerge";
import { extractLexicalQuery } from "./passageQuery";
import { PASSAGE_WINDOW_MAX } from "./searchTools";

/** Längere Anfragen werden gekürzt (Embedding-Text). */
const QUERY_MAX = 1000;

export interface Passage {
	docId: string;
	series: SeriesAbbr;
	title: string;
	date: string | null;
	dateYear: number | null;
	stazhIdent: string | null;
	/** Originalwortlaut der Passage (alignChunk), sonst der bereinigte Chunk-Text. */
	text: string;
	/** true = Originalwortlaut, false = bereinigter Chunk-Text. */
	aligned: boolean;
	/** Meilis Score der Passage (0–1). */
	score: number | null;
}

function toPassage(s: PassageSource): Passage {
	return {
		docId: s.hit.id,
		series: s.hit.series,
		title: s.hit.title,
		date: s.hit.date ?? null,
		dateYear: s.hit.dateYear ?? null,
		stazhIdent: s.hit.stazhIdent ?? null,
		text: s.alignedText ?? s.chunkText,
		aligned: s.alignedText != null,
		score: typeof s.hit._rankingScore === "number" ? s.hit._rankingScore : null,
	};
}

/** Textstellen zur Anfrage mit den Filtern des Clients (keine Erkennung aus der
 *  Anfrage). `offset` blättert: gesucht wird das ganze Fenster offset + topK, der
 *  Offset greift erst NACH der Gruppierung je Dokument und nach dem Mischen
 *  (mergeLexicalPage) – sonst entstünden Lücken oder Doppelte. */
export async function searchPassages(a: {
	query: string;
	series: SeriesAbbr[];
	dateFrom: number | null;
	dateTo: number | null;
	topK: number;
	offset?: number;
}): Promise<{ passages: Passage[]; ranking: "semantic" | "keyword"; partial: boolean }> {
	const query = a.query.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
	if (!query) return { passages: [], ranking: "keyword", partial: false };
	const offset = Math.max(0, a.offset ?? 0);
	const lexicalQuery = extractLexicalQuery(query, []);
	const vector = await embedQuery(query);
	const opts = {
		series: a.series.length > 0 ? a.series : undefined,
		dateFrom: a.dateFrom,
		dateTo: a.dateTo,
		// Häufigste Wörter zuerst streichen, nicht die letzten (das Thema steht oft am Ende).
		matchingStrategy: "frequency" as const,
		// Blättern: das ganze Fenster holen, erst danach den Offset abschneiden.
		// Ab der zweiten Seite ist das Fenster FEST (PASSAGE_WINDOW_MAX), nicht
		// offset + topK: Die Kandidatenlisten hängen an der Fenstergrösse (der
		// Chunk-Pool wächst mit, und mergeLexicalSources rechnet die lexikalische
		// Reserve gegen die ganze semantische Liste), ein wachsendes Fenster
		// reiht also um. Mit festem Fenster sind alle Folgeseiten Schnitte EINER
		// Liste – lückenlos und ohne Doppelte. Die erste Seite bleibt beim
		// kleinen Fenster: sie ist der Normalfall und soll schnell bleiben.
		topK: offset > 0 ? PASSAGE_WINDOW_MAX : a.topK,
	};
	let found: PassageCandidate[];
	let partial = false;
	if (!vector) {
		const { found: all } = await retrievePassages({ q: lexicalQuery || query, vector: null, ...opts });
		found = offset > 0 ? all.slice(offset, offset + a.topK) : all;
	} else {
		const [sem, lex] = await Promise.all([
			retrievePassages({ q: lexicalQuery || query, vector, ...opts }),
			lexicalQuery ? retrievePassages({ q: lexicalQuery, vector: null, ...opts }) : null,
		]);
		found = mergeLexicalPage(sem.found, lex?.found ?? [], offset, a.topK);
		partial = sem.partial;
	}
	const passages = (await alignPassages(found)).map(toPassage);
	return { passages, ranking: vector ? "semantic" : "keyword", partial };
}
