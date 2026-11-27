// ID-Pass des Treffer-Exports mit Schutz gegen Meilis stillen Suchabbruch.
//
// Meili bricht eine Suche nach `searchCutoffMs` (10 s, s. INDEX_SETTINGS) ab und
// liefert den Rest ungerankt – bei Hybrid-Suchen fällt der semantische Arm ganz
// weg (`semanticHitCount: 0`), ohne Fehler. Auf Prod passiert das bei KALTEM
// Cache (der Index ist grösser als Meilis Speicher): die erste grosse Suche
// eines Begriffs liest von der Platte (gemessen 15–23 s, ein Mal nur 8 % der
// Top-100 wie in der Trefferliste), die Wiederholung kurz danach ist schnell und
// korrekt (gemessen 0,6–3,3 s). Darum:
//   1. ID-Pass langsam (≥ SLOW_ID_PASS_MS) ⇒ einmal wiederholen (Cache ist warm)
//   2. auch der zweite Lauf langsam UND Thema-Ranking ohne semantische Treffer
//      ⇒ abbrechen (503) statt einer Liste in falscher Reihenfolge
// Ein langsamer rein lexikalischer zweiter Lauf wird geliefert (ob Meili dort
// abgeschnitten hat, verrät die Antwort nicht – nur geloggt).
// Pur (Runner injiziert), testbar mit tsx --test.

import type { SearchResponse } from "../types";

// Unter Meilis Cutoff (10 s): ein abgebrochener Lauf ist immer mindestens so lang.
export const SLOW_ID_PASS_MS = 8_000;

export interface IdPassRun {
	result: Pick<SearchResponse, "hits" | "semanticHitCount">;
	// Wanduhr-Zeit des ganzen ID-Passes (inkl. Stufe 1 und Embedding)
	ms: number;
}

export type IdPassOutcome<R extends IdPassRun> =
	| { ok: true; run: R; retried: boolean; firstMs: number }
	| { ok: false; reason: "degraded"; firstMs: number; secondMs: number };

/** Thema-Ranking ohne einen einzigen semantischen Treffer (bei vorhandenen Treffern). */
export function semanticDropped(run: IdPassRun): boolean {
	return run.result.hits.length > 0 && run.result.semanticHitCount === 0;
}

export async function runIdPass<R extends IdPassRun>(
	run: () => Promise<R>,
	slowMs: number = SLOW_ID_PASS_MS,
): Promise<IdPassOutcome<R>> {
	const first = await run();
	if (first.ms < slowMs) return { ok: true, run: first, retried: false, firstMs: first.ms };
	const second = await run();
	if (second.ms >= slowMs && semanticDropped(second)) {
		return { ok: false, reason: "degraded", firstMs: first.ms, secondMs: second.ms };
	}
	return { ok: true, run: second, retried: true, firstMs: first.ms };
}
