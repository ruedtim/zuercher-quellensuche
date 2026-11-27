/**
 * Gefaltete Suchfelder (ß als ss, $lib/sharpS.ts) der Indizes `catalog` und `ehedaten`: Schalter
 * je Index und das Zurückübertragen der Formatierung. Unit-getestet in foldedSearch.test.ts.
 *
 * Der Schalter: Der Aufbau (services/catalog) legt zu jedem durchsuchten Feld mit ß ein
 * gefaltetes Suchfeld an. Erst wenn der Index solche Felder trägt (Zahl der Dokumente je Feld in
 * den Stats, mit dem Such-Key lesbar) und durchsucht (eine Probesuche in ihnen), faltet die Web-App
 * die Anfrage und sucht «nur im Titel» bzw. die Feldsuche auch in den gefalteten Feldern – die
 * Web-App lässt sich also vor dem Import deployen; auf einem Index ohne die Felder bleiben die
 * Suchbegriffe, wie sie sind. Der Import tauscht den ganzen Index (Settings und Dokumente zugleich).
 */

import { MeiliSearchApiError } from "meilisearch";
import { foldedField, unfoldFormatted, type FormatMarks } from "$lib/sharpS";

/** Felder samt ihren gefalteten: ["title"] ⇒ ["title", "titleSearch"]. */
export function withFolded(fields: readonly string[]): string[] {
	return fields.flatMap((f) => [f, foldedField(f)]);
}

/**
 * Treffer mit der Formatierung der gefalteten Felder: Wo Meili das gefaltete Feld formatiert hat
 * (es gibt es nur bei Einträgen mit ß), gelten dessen Hervorhebung und Auszug, gezeigt am
 * Original. Alle anderen Treffer bleiben, wie sie sind.
 */
export function unfoldHit<H extends { _formatted?: object }>(hit: H, fields: readonly string[], marks: FormatMarks): H {
	const formatted = hit._formatted as Record<string, unknown> | undefined;
	if (!formatted) return hit;
	let out: Record<string, unknown> | null = null;
	for (const field of fields) {
		const folded = formatted[foldedField(field)];
		const original = (hit as Record<string, unknown>)[field];
		if (typeof folded !== "string" || typeof original !== "string") continue;
		const text = unfoldFormatted(folded, original, marks);
		if (text !== null) (out ??= { ...formatted })[field] = text;
	}
	return out ? ({ ...hit, _formatted: out } as H) : hit;
}

/** So lange sucht die Web-App ohne Faltung, nachdem Meili ein gefaltetes Feld abgelehnt hat. */
const BLOCK_MS = 60_000;

/** Meili lehnt eines der gefalteten Felder in attributesToSearchOn ab (nicht durchsuchbar). */
export function isFoldedFieldError(err: unknown, fields: readonly string[]): boolean {
	return (
		err instanceof MeiliSearchApiError &&
		err.response?.status === 400 &&
		/attributes_to_search_on/i.test((err.cause as { code?: string } | undefined)?.code ?? "") &&
		fields.some((f) => err.message.includes(foldedField(f)))
	);
}

export interface FoldSwitch {
	/** Faltet die Web-App Anfragen an diesen Index? (Stand der letzten Prüfung.) */
	readonly on: boolean;
	/** Stand aus den Stats des Index; ohne Stats (nicht lesbar) gilt er als nicht gefaltet. */
	update(fieldDistribution: Readonly<Record<string, number>> | null | undefined): Promise<void>;
	/** Führt `run` aus; lehnt Meili dabei ein gefaltetes Feld ab (ein seit der letzten Prüfung
	 *  zurückgetauschter Index), läuft `run` einmal ohne Faltung neu. */
	withFallback<T>(run: () => Promise<T>): Promise<T>;
}

/**
 * Schalter für einen Index; `fields` = die durchsuchten Felder, die ein gefaltetes haben können.
 * `probe` sucht in den genannten Feldern: Meili lehnt ab, wenn es eines nicht durchsucht (Felder im
 * Index, aber alte Settings) – eine gewöhnliche Suche merkte das nicht, sie fände mit «Strasse»
 * statt «Straße» nur keine Einheit mit ß mehr.
 */
export function createFoldSwitch(
	label: string,
	fields: readonly string[],
	probe: (searchOn: string[]) => Promise<unknown>,
	now: () => number = Date.now,
): FoldSwitch {
	const folded = fields.map(foldedField);
	let on = false;
	let blockedUntil = 0;
	const set = (next: boolean) => {
		if (next !== on) console.log(`[${label}] Suche mit ß als ss: ${next ? "an" : "aus"}`);
		on = next;
	};
	return {
		get on() {
			return on;
		},
		async update(fieldDistribution) {
			if (now() < blockedUntil || !folded.some((f) => (fieldDistribution?.[f] ?? 0) > 0)) return set(false);
			try {
				await probe(folded);
				set(true);
			} catch (err) {
				// Andere Fehler (Meili gerade nicht erreichbar) ändern den Stand nicht.
				if (isFoldedFieldError(err, fields)) set(false);
			}
		},
		async withFallback(run) {
			try {
				return await run();
			} catch (err) {
				if (!isFoldedFieldError(err, fields)) throw err;
				console.warn(`[${label}] gefaltetes Suchfeld nicht durchsuchbar, Suche ohne Faltung: ${(err as Error).message}`);
				blockedUntil = now() + BLOCK_MS;
				set(false);
				return run();
			}
		},
	};
}
