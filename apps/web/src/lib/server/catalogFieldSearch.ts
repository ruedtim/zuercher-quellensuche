/**
 * Feldsuche im Reiter «Archivkatalog» ausführen ($lib/catalogFields.ts plant): Meili kennt je
 * Abfrage nur eine Suche und ein Suchfeld-Set. Steht die Feldsuche allein mit einem Feld, sucht
 * die Abfrage direkt darin. Sonst zählt resolveFieldSet die Treffer jeder Bedingung (Suchbegriff
 * und je Feld eine) und schneidet die übrigen zu einer ID-Menge – kleinste zuerst, jede weitere
 * nur noch innerhalb der bisherigen IDs –, die eine Bedingung bleibt die Abfrage (Reihung,
 * Hervorhebung, Facetten, Zeitleiste). Gemessen auf Prod (2026-10-30, 373'410 eigene Treffer):
 * Zählen 1–5 ms je Bedingung, 10'000 IDs holen 0,3–0,9 s, `id IN` mit 10'000 IDs 16–37 ms.
 *
 * Die Abfragen sind injiziert (catalog.ts reicht Meili durch), dazu das Nachmarkieren der
 * Wörter, die Meili nicht selbst hervorhebt. Unit-getestet in catalogFieldSearch.test.ts.
 */

import { planFieldSearch } from "$lib/catalogFields";
import { cropAroundTerms, markTerms } from "./highlight";

export interface FieldSetDeps {
	/** Trefferzahlen aller Kandidaten unter dem Grundfilter (Reihenfolge wie die Kandidaten). */
	counts(): Promise<number[]>;
	/** IDs eines Kandidaten unter dem Grundfilter, mit `within` nur unter diesen IDs. */
	ids(candidate: number, within: readonly number[] | null, limit: number): Promise<number[]>;
}

export interface FieldSet {
	/** Kandidat, der die Abfrage bleibt. */
	main: number;
	/** Die übrigen Bedingungen geschnitten; null = keine Einschränkung (Abfrage allein). */
	ids: number[] | null;
	/** Jede Bedingung trifft mehr als `cap` Einheiten: keine Treffer, Hinweis im Reiter. */
	tooBroad: boolean;
}

/**
 * Löst `n` Kandidaten auf (`mainIndex` = der Suchbegriff, sonst null): ein Kandidat allein ohne
 * Abfrage, sonst Zählen und die Kette aus planFieldSearch. Die erste Menge wird bis `cap` geholt
 * (die Zählung kann schätzen), jede weitere höchstens so gross wie die bisherige.
 */
export async function resolveFieldSet(n: number, mainIndex: number | null, cap: number, deps: FieldSetDeps): Promise<FieldSet> {
	if (n <= 1) return { main: 0, ids: null, tooBroad: false };
	const plan = planFieldSearch(await deps.counts(), { mainIndex, cap });
	switch (plan.kind) {
		case "none":
			return { main: 0, ids: null, tooBroad: false };
		case "native":
			return { main: plan.main, ids: null, tooBroad: false };
		case "empty":
			return { main: mainIndex ?? 0, ids: [], tooBroad: false };
		case "tooBroad":
			return { main: mainIndex ?? 0, ids: [], tooBroad: true };
		case "chain": {
			let ids = await deps.ids(plan.chain[0], null, cap);
			for (const c of plan.chain.slice(1)) {
				if (ids.length === 0) break;
				ids = await deps.ids(c, ids, ids.length);
			}
			return { main: plan.main, ids, tooBroad: false };
		}
	}
}

type Formatted = { title?: string; text?: string };

/**
 * Wörter der Feldsuche, die als ID-Menge wirken, in Titel bzw. Auszug nachmarkieren (Meili
 * hebt nur die Wörter der Abfrage hervor); exakte Wortgrenzen wie markUnionTerms. `recrop`
 * schneidet den Auszug um die erste Fundstelle der Wörter für «Inhalt und Form» neu – wenn die
 * Abfrage den Text nicht selbst durchsucht (sonst bliebe Meilis Auszug ohne diese Wörter).
 */
export function markFieldTerms<T extends { title: string; text?: string; _formatted?: Formatted }>(
	hits: T[],
	marks: { title: readonly string[]; text: readonly string[] },
	opts: { recrop: boolean; cropLength: number },
): T[] {
	if (marks.title.length === 0 && marks.text.length === 0) return hits;
	return hits.map((hit) => {
		const formatted: Formatted = { ...hit._formatted };
		if (marks.title.length > 0) formatted.title = markTerms(hit._formatted?.title ?? hit.title ?? "", [...marks.title], "match");
		if (marks.text.length > 0 && hit.text) {
			const recropped = opts.recrop ? cropAroundTerms(hit.text, [...marks.text], opts.cropLength, "…") : null;
			formatted.text = markTerms(recropped ?? hit._formatted?.text ?? hit.text, [...marks.text], "match");
		}
		return { ...hit, _formatted: formatted };
	});
}
