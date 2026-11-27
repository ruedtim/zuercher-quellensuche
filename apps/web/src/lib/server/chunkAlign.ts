/**
 * Rekonstruiert den ORIGINAL-Dokument-Text zu einem Chunk aus dem
 * `chunks`-Index. Hintergrund: die Chunk-Pipeline (machinelearningZH/ai-search_staatsarchiv) hat den Text
 * vor dem Chunking gecleant (generic_text_cleaning: Interpunktion `;«»„“:()[]`
 * entfernt, `&`→„und", `§`→„Paragraph", `=`→„gleich" usw.) – chunkText liest
 * sich dadurch leicht verstümmelt. Da das Cleaning deterministisch und (fast)
 * zeichenlokal ist, lässt sich der Chunk per Offset-Mapping im Original-Body
 * lokalisieren und die unverfälschte Passage in den LLM-Prompt geben.
 *
 * WICHTIG: der Passagen-Index wurde NUR mit generic_text_cleaning gebaut –
 * das digit-entfernende semantic_text_cleaning aus dem 06a-Notebook war NICHT
 * aktiv (empirisch verifiziert am Weaviate-Export: 95 % der Chunks enthalten
 * Ziffern, alle generic-Marker fehlen). Die Kette hier muss exakt dem
 * deployten Stand entsprechen, sonst findet die Anker-Suche nichts.
 *
 * Verfahren: Body mit der identischen Cleaning-Kette transformieren, dabei die
 * Ersetzungen für den Weg zurück merken; ein Anker-Fenster aus
 * der Chunk-Mitte (umgeht den vorangestellten Titel, der im Body fehlt) per
 * indexOf finden; Chunk-Spanne auf Original-Offsets zurückmappen.
 *
 * Eigenheit verbatim übernommen: unescapte Punkte in der Römisch-Ziffern-
 * Regex (= any char).
 */

/** Ein Durchgang der Kette: wo im Text ersetzt wurde (alle Stellen mit demselben Ersatz). */
interface Step {
	/** Anfang der Stelle im Eingang … */
	from: number[];
	/** … und im Ergebnis. */
	to: number[];
	/** Länge der Stelle im Eingang. */
	length: number[];
	/** Länge des Ersatzes. */
	by: number;
}

export interface Cleaned {
	text: string;
	/** Offset im Original zum Zeichen i des bereinigten Texts. */
	at(i: number): number;
}

// Nur die Ersetzungen merken statt eines Offsets je Zeichen: Protokolle sind bis 1 MB gross, und eine
// Anfrage richtet bis 50 Passagen aus (je Zeichen rund zehn Durchgänge, der Webprozess hat einen Thread).
function replaceTracked(text: string, re: RegExp, by: string): { text: string; step: Step } {
	const step: Step = { from: [], to: [], length: [], by: by.length };
	let shift = 0;
	const out = text.replace(re, (match: string, ...rest: unknown[]) => {
		const index = rest[rest.length - 2] as number;
		step.from.push(index);
		step.to.push(index + shift);
		step.length.push(match.length);
		shift += by.length - match.length;
		return by;
	});
	return { text: out, step };
}

/** Offset vor dem Durchgang; Zeichen eines Ersatzes stehen für den Anfang der ersetzten Stelle. */
function offsetBefore(step: Step, i: number): number {
	let lo = 0;
	let hi = step.to.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (step.to[mid] <= i) lo = mid + 1;
		else hi = mid;
	}
	if (lo === 0) return i;
	const inside = i - step.to[lo - 1];
	return inside < step.by ? step.from[lo - 1] : step.from[lo - 1] + step.length[lo - 1] + inside - step.by;
}

// generic_text_cleaning (staatsarchiv_utils.py)
const ESCAPE_SEQS =
	/(\x04|\x1a|\xa0|\x00|\ue83a|\x19|\uf06c|\x10|\x17|\x13|\x11|<space>|\x16|\x18|\x1b|\x15|\t\x08|\f)/g;
// Unescapte Punkte wie im Original (I. matcht "I"+beliebiges Zeichen).
const ROMAN_NUMERALS = /(?<=\s)(I.|II.|III.|IV.|V.|VI.|VII.|VIII.|IX.|X.|XI.|XII.|XIII.|XIV.|XV.)(?=\s)/g;

/** Cleaning-Kette des Chunk-Index (NUR generic_text_cleaning, siehe Modul-Kommentar – kein
 *  semantic_text_cleaning), in dieser Reihenfolge. */
const CLEANING: [RegExp, string][] = [
	[ESCAPE_SEQS, " "],
	[/[;«»„“:()\[\]]/g, " "],
	[/\.{2,}/g, " "],
	[ROMAN_NUMERALS, " "],
	[/&/g, " und "],
	[/§/g, " Paragraph "],
	[/=/g, " gleich "],
	// ß wie im Suchtext des documents-Index (seit 2026-11-17 mit ss, services/indexer
	// searchText.ts), die Chunks behalten ß: auf beiden Seiten angleichen, dann passt der Anker
	// mit und ohne gefalteten Body.
	[/ß/g, "ss"],
	[/ẞ/g, "SS"],
	// = /\s+/g, ohne die einzelnen Leerzeichen, die bleiben, wie sie sind.
	[/\s{2,}|[^\S ]/g, " "],
];

/** Der bereinigte Text mit dem Weg zurück zum Original. */
export function cleanWithMap(original: string): Cleaned {
	const lead = original.length - original.trimStart().length;
	let text = original.trim();
	const steps: Step[] = [];
	for (const [re, by] of CLEANING) {
		const r = replaceTracked(text, re, by);
		text = r.text;
		if (r.step.from.length > 0) steps.push(r.step);
	}
	const cut = text.length - text.trimStart().length;
	return {
		text: text.trim(),
		at: (i) => steps.reduceRight((pos, step) => offsetBefore(step, pos), i + cut) + lead,
	};
}

export interface AlignedChunk {
	start: number;
	end: number;
	text: string;
}

/** Maximale Länge des rekonstruierten Original-Exzerpts (Zeichen). */
export const ALIGNED_TEXT_CAP = 2200;

/**
 * Lokalisiert chunkText im Original-Body und liefert die Original-Textspanne
 * (mit Ziffern). null wenn kein verlässlicher Match (Fallback: chunkText).
 */
export function alignChunk(body: string, chunkText: string): AlignedChunk | null {
	if (!body || !chunkText) return null;
	const cleaned = cleanWithMap(body);
	if (cleaned.text.length === 0) return null;

	const chunk = chunkText.replace(/ß/g, "ss").replace(/ẞ/g, "SS").replace(/\s+/g, " ").trim();
	if (chunk.length < 24) return null;

	// Anker-Fenster: Mitte zuerst (umgeht den Titel-Präfix des ersten Chunks),
	// dann 1/3 und 2/3 als Ausweichpositionen.
	const win = Math.min(64, Math.max(24, Math.floor(chunk.length / 3)));
	const positions = [
		Math.max(0, Math.floor(chunk.length / 2) - Math.floor(win / 2)),
		Math.max(0, Math.floor(chunk.length / 3) - Math.floor(win / 2)),
		Math.max(0, Math.floor((2 * chunk.length) / 3) - Math.floor(win / 2)),
	];

	for (const anchorStart of positions) {
		const anchor = chunk.slice(anchorStart, anchorStart + win);
		if (anchor.length < 24) continue;
		const found = cleaned.text.indexOf(anchor);
		if (found < 0) continue;

		// Chunk-Spanne in den gecleanten Koordinaten schätzen und clampen.
		const cleanStart = Math.max(0, found - anchorStart);
		const cleanEnd = Math.min(cleaned.text.length, cleanStart + chunk.length);

		const origStart = cleaned.at(cleanStart);
		const origEnd = cleaned.at(cleanEnd - 1) + 1;
		if (origEnd <= origStart) continue;

		let text = body.slice(origStart, origEnd);
		if (text.length > ALIGNED_TEXT_CAP) {
			const cut = text.slice(0, ALIGNED_TEXT_CAP);
			const lastSpace = cut.lastIndexOf(" ");
			text = (lastSpace > ALIGNED_TEXT_CAP * 0.8 ? cut.slice(0, lastSpace) : cut) + " …";
		}
		return { start: origStart, end: origEnd, text };
	}
	return null;
}
