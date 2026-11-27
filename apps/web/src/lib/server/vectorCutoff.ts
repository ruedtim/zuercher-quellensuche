// Abgebrochene Vektorsuchen erkennen (pur, ohne Imports, unit-getestet in vectorCutoff.test.ts).
//
// Meili bricht eine Suche nach `searchCutoffMs` ab, ohne Fehler und ohne Kennzeichen. Bei einer
// Vektorsuche (v1.57, hannoy) gibt es zwei Formen:
// - Die Frist läuft im Scan ab: Trifft der Filter höchstens ein Zehntel der Vektoren, liest hannoy
//   jeden Kandidaten; beim ersten Mal (kalter Cache) kostet das je Kandidat eine Seite der Platte.
//   Meili liefert dann die besten der bis dahin gelesenen Kandidaten, mit normalen Scores und
//   vollem semanticHitCount – zu erkennen nur an der Dauer. Prod 2026-11-24 (`chunks`, damals mit
//   der Vorgabe 1'500 ms): 70'674 Passagen mit dem Vektor einer von ihnen gesucht, fünf Läufe zu
//   1'502–1'513 ms ohne sie, der sechste 156 ms, Platz 1. Jeder Lauf wärmt, was er las; mit 10 s
//   reicht der erste.
// - Die Frist war schon vorher verbraucht (der Stichwort-Arm einer Hybrid-Suche läuft zuerst):
//   kein Treffer des Vektor-Arms, oder ungerankte Auffüllung mit Score 0.
// In beiden Fällen holt searchVectors die reine Vektorsuche nach (warm) und kennzeichnet das
// Ergebnis als unvollständig, wenn auch sie nicht fertig wird.

/** Frist der Suchen auf `chunks`: searchCutoffMs des Index (services/indexer/src/meili.ts,
 *  CHUNK_INDEX_SETTINGS; der Test gleicht beide ab). */
export const CHUNK_CUTOFF_MS = 10_000;

/** So lange wartet die Web-App auf eine Suche in `chunks` – länger als Meilis Frist, damit die
 *  Antwort einer abgebrochenen Suche noch ankommt. */
export const CHUNK_BUDGET_MS = CHUNK_CUTOFF_MS + 3_000;

/** Meilis Antwort auf eine Vektorsuche, soweit sie ausgewertet wird. */
export interface VectorResult<T> {
	hits: T[];
	semanticHitCount?: number;
	processingTimeMs?: number;
}

/**
 * Treffer ohne die, die Meili nicht gereiht hat (Score 0): Auffüllung nach der Frist bzw. Dokumente
 * ohne Vektor und ohne Stichwort, die Meili hinter die Treffer hängt. Ein echter Vektor-Score ist
 * (1 + cos) / 2 > 0.
 */
export function rankedHits<T extends { _rankingScore?: number }>(hits: T[]): T[] {
	return hits.filter((h) => h._rankingScore !== 0);
}

/**
 * true, wenn der Vektor-Arm fehlt: bei semanticHitCount 0 füllte der Stichwort-Arm alle Plätze,
 * Treffer mit Score 0 sind ungerankte Auffüllung. Ohne Treffer gibt es nichts zu retten.
 */
export function vectorArmLost(result: VectorResult<{ _rankingScore?: number }>): boolean {
	if (result.hits.length === 0) return false;
	if (result.semanticHitCount === 0) return true;
	return result.hits.some((h) => h._rankingScore === 0);
}

/** Hat Meili die Suche abgebrochen? Nach der Frist (Teilliste) oder ohne Vektor-Arm. */
export function cutShort(result: VectorResult<{ _rankingScore?: number }>, cutoffMs: number = CHUNK_CUTOFF_MS): boolean {
	return (result.processingTimeMs ?? 0) >= cutoffMs || vectorArmLost(result);
}

/** Frist der Suchen auf `documents` und `catalog`: searchCutoffMs der Indizes (services/indexer,
 *  services/catalog; der Test gleicht ab). */
export const SEARCH_CUTOFF_MS = 10_000;

/**
 * Eine Vektorsuche für die Reihenfolge eines Themas (themeOrder.ts): an der Frist abgebrochen, läuft
 * sie noch einmal, dann sind die gelesenen Seiten warm. `cut` = auch die zweite wurde nicht fertig;
 * die Liste ist womöglich unvollständig und wird nicht aufgehoben.
 */
export async function searchTwice<R extends { processingTimeMs?: number }>(
	run: () => Promise<R>,
	label: string,
	warn: (message: string) => void = (message) => console.warn(message),
): Promise<{ result: R; cut: boolean }> {
	const isCut = (r: R) => (r.processingTimeMs ?? 0) >= SEARCH_CUTOFF_MS;
	const first = await run();
	if (!isCut(first)) return { result: first, cut: false };
	const second = await run();
	warn(`[${label}] Vektorsuche abgebrochen (${first.processingTimeMs} ms), wiederholt in ${second.processingTimeMs} ms`);
	return { result: second, cut: isCut(second) };
}

export type VectorOutcome = "complete" | "retried" | "partial" | "keyword";

/**
 * Eine Hybrid- bzw. reine Vektorsuche (I/O injiziert), vollständig oder als unvollständig
 * gekennzeichnet:
 *  - fertig ⇒ ihr Ergebnis;
 *  - abgebrochen (cutShort) ⇒ die reine Vektorsuche nachgeholt, deren Seiten jetzt warm sind; wird
 *    auch sie nicht fertig, ihr gerankter Teil (sonst der der ersten) mit `partial`;
 *  - keine Antwort in CHUNK_BUDGET_MS ⇒ Stichwort-Suche (`partial`); die Suche läuft in Meili zu Ende.
 *    Ohne Stichwörter (reine Vektorsuche) geht der Fehler an den Aufrufer.
 */
export async function searchVectors<T extends { _rankingScore?: number }>(deps: {
	search: (signal: AbortSignal) => Promise<VectorResult<T>>;
	vectorOnly: (signal: AbortSignal) => Promise<VectorResult<T>>;
	keywordOnly?: () => Promise<VectorResult<T>>;
	budget?: (ms: number) => AbortSignal;
	warn?: (message: string) => void;
}): Promise<{ hits: T[]; partial: boolean; outcome: VectorOutcome }> {
	const budget = deps.budget ?? ((ms: number) => AbortSignal.timeout(ms));
	const warn = deps.warn ?? ((message: string) => console.warn(message));

	// Nachholen ist Zugabe: ein Fehler oder Abbruch liefert bloss nichts.
	const retryVector = async (): Promise<{ hits: T[]; complete: boolean; detail: string }> => {
		const signal = budget(CHUNK_BUDGET_MS);
		const started = Date.now();
		try {
			const retry = await deps.vectorOnly(signal);
			const complete = !cutShort(retry);
			const ms = Date.now() - started;
			return { hits: rankedHits(retry.hits), complete, detail: complete ? `${ms} ms` : `wieder abgebrochen, ${ms} ms` };
		} catch (err) {
			const detail = signal.aborted ? `über ${CHUNK_BUDGET_MS} ms` : String(err).slice(0, 200);
			return { hits: [], complete: false, detail };
		}
	};

	const signal = budget(CHUNK_BUDGET_MS);
	let first: VectorResult<T>;
	try {
		first = await deps.search(signal);
	} catch (err) {
		if (!signal.aborted || !deps.keywordOnly) throw err;
		warn(`[chunks] Suche über ${CHUNK_BUDGET_MS} ms – Stichwort-Reihung`);
		return { hits: rankedHits((await deps.keywordOnly()).hits), partial: true, outcome: "keyword" };
	}
	if (!cutShort(first)) return { hits: first.hits, partial: false, outcome: "complete" };

	const cut = `[chunks] Vektorsuche abgebrochen (${first.processingTimeMs ?? "?"} ms)`;
	const retry = await retryVector();
	if (retry.complete) {
		warn(`${cut} – in ${retry.detail} nachgeholt`);
		return { hits: retry.hits, partial: false, outcome: "retried" };
	}
	warn(`${cut}, Nachholen unvollständig (${retry.detail})`);
	return { hits: retry.hits.length > 0 ? retry.hits : rankedHits(first.hits), partial: true, outcome: "partial" };
}
