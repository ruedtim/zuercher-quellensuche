/**
 * Suchbegriff und ODER-Begriffe im Reiter «Archivkatalog» (pur, unit-getestet in
 * catalogUnion.test.ts; Abfragen in catalog.ts). Mindestens zwei ODER-Begriffe (`qAny`)
 * laufen wie in der Dokumentsuche (searchDocumentsUnion, meili.ts) als föderierte
 * Multi-Search: je Begriff ein Zweig, der Suchbegriff hängt an jedem (combineUnionQuery:
 * strikt, (A ODER B) UND q). Meili liefert die Vereinigung dedupliziert – Trefferzahl und
 * gemergte Facetten samt facetStats zählen jede Einheit einmal (Prod 2026-10-30: «Mühle»
 * 5'549 und «Säge» 406 Einheiten, Vereinigung 5'895, ebenso die Summe der
 * Digitalisat-Facette).
 *
 * Datums-Sortierung: Mit `sort` je Zweig mischt die Föderation nach Datum. Strikt haben
 * alle Treffer denselben words-Score, danach vergleicht Meili die Sortierwerte (Ranking-Regel
 * `sort` an zweiter Stelle, services/catalog settings.ts). Gemessen dieselbe Jahresfolge wie
 * die nach Datum gemischten Einzellisten, auch bei 57'262 Treffern («Schule ODER Kirche»).
 * Die Dokumentsuche nimmt dafür ein Jahresfenster (dateWindow.ts): Die Föderation bewertet
 * jeden Treffer bis zum Offset, und `date` bildet dort einen Sortier-Bucket je Tag (`dateFrom`
 * hier eine Jahreszahl).
 *
 * Mit Thema holt catalog.ts die IDs der Vereinigung (bis 10'000) und reiht darin; die
 * Abfrage dort kennt nur noch den Suchbegriff, die ODER-Begriffe markiert markUnionTerms nach.
 *
 * ß und ss gelten als gleich, sobald der Index gefaltete Suchfelder trägt (`fold`,
 * foldedSearch.ts): Suchbegriff und ODER-Begriffe stehen dann mit ss, «nur im Titel» sucht auch
 * im gefalteten Titel (lexicalSearchOn).
 */

import { combineUnionQuery, exclusionsFirst, foldSingleAnyTerm, unionHighlightTerms } from "$lib/searchParams";
import { foldSharpS } from "$lib/sharpS";
import type { SearchParams } from "$lib/types";
import { withFolded } from "./foldedSearch";
import { cropAroundTerms, markTerms } from "./highlight";

/** Was die Treffermenge des Reiters lexikalisch bildet. */
export interface CatalogLexical {
	/** Suchbegriff für Meili (Ausschlüsse vorn, exclusionsFirst); bei ODER der Teil, der an
	 *  jedem Zweig hängt. */
	q: string;
	/** ODER-Begriffe, mindestens zwei, sonst null (ein einzelner steht in `q`). */
	terms: string[] | null;
	/** «nur im Titel»: Suchbegriff und ODER-Begriffe nur im Titel; ohne beide wirkungslos. Die
	 *  Felder des Originals – was Meili bekommt, sagt lexicalSearchOn. */
	searchOn: string[] | undefined;
	/** Begriffe, die nachmarkiert werden (unionHighlightTerms); leer ohne ODER. */
	highlight: string[];
	/** Wo Meili die Wörter hervorhebt; fehlt = Titel und Auszug. Eine Feldsuche als Abfrage
	 *  hebt nur in ihrem Feld hervor (Meili markiert sonst auch Wörter ausserhalb des
	 *  durchsuchten Feldes; catalog.ts withFieldSearch). */
	highlightOn?: string[];
	/** Der Index trägt gefaltete Suchfelder: Suchbegriff und ODER-Begriffe stehen mit ss. */
	fold?: true;
}

export type CatalogUnion = CatalogLexical & { terms: string[] };

/** Suchbegriff, ODER-Begriffe und «nur im Titel» des Reiters; ein einzelner ODER-Begriff gilt
 *  wie in der Dokumentsuche als Suchbegriff (foldSingleAnyTerm). `fold` = der Index trägt
 *  gefaltete Suchfelder (foldedSearch.ts). */
export function catalogLexical(
	params: Pick<SearchParams, "q" | "titleOnly"> & { anyTerms?: readonly string[] },
	fold = false,
): CatalogLexical {
	const spell = fold ? foldSharpS : (text: string) => text;
	// Beide Schreibungen als ODER-Begriffe («Straße», «Strasse») sind gefaltet einer.
	const p = foldSingleAnyTerm({ q: spell(params.q), anyTerms: [...new Set((params.anyTerms ?? []).map(spell))] });
	const q = exclusionsFirst(p.q.trim());
	const terms = p.anyTerms.length >= 2 ? p.anyTerms : null;
	return {
		q,
		terms,
		searchOn: params.titleOnly && (q !== "" || terms !== null) ? ["title"] : undefined,
		highlight: terms ? unionHighlightTerms(terms, p.q) : [],
		...(fold ? { fold: true as const } : {}),
	};
}

/** Suchfelder einer Abfrage (attributesToSearchOn): mit Faltung auch die gefalteten. */
export function lexicalSearchOn(lex: Pick<CatalogLexical, "searchOn" | "fold">): string[] | undefined {
	return lex.searchOn && lex.fold ? withFolded(lex.searchOn) : lex.searchOn;
}

export function isCatalogUnion(lex: CatalogLexical): lex is CatalogUnion {
	return lex.terms !== null;
}

/** Meili-Sortierung der Liste: nach Datum, sonst nach Relevanz – die braucht einen Suchbegriff
 *  oder ODER-Begriffe, ohne beide chronologisch wie die Dokumentsuche (effectiveSort). */
export function catalogSortRules(sort: SearchParams["sort"], lex: Pick<CatalogLexical, "q" | "terms">): string[] | undefined {
	if (sort === "date_desc") return ["dateFrom:desc"];
	if (sort === "date_asc" || (lex.q === "" && lex.terms === null)) return ["dateFrom:asc"];
	return undefined;
}

/**
 * Anfrage der Föderation für eine ODER-Suche: je Begriff ein Zweig mit dem Suchbegriff
 * (combineUnionQuery), demselben Filter und «nur im Titel»; `perBranch` trägt Felder,
 * Hervorhebung und Sortierung, `federation` Fenster und Facetten (unionFacets).
 */
export function unionSearchBody(
	lex: CatalogUnion,
	indexUid: string,
	filter: string,
	federation: Record<string, unknown>,
	perBranch: Record<string, unknown> = {},
): { federation: Record<string, unknown>; queries: Array<Record<string, unknown>> } {
	const searchOn = lexicalSearchOn(lex);
	return {
		federation,
		queries: lex.terms.map((term) => ({
			indexUid,
			...combineUnionQuery(term, lex.q),
			filter,
			...(searchOn ? { attributesToSearchOn: searchOn } : {}),
			...perBranch,
		})),
	};
}

/** Facetten der Föderation: je Index berechnet und gemergt. `maxValues` wie die Einstellung
 *  des Index – mergeFacets kappt sonst bei 100 Werten. */
export function unionFacets(indexUid: string, facets: string[], maxValues: number) {
	return { facetsByIndex: { [indexUid]: facets }, mergeFacets: { maxValuesPerFacet: maxValues } };
}

type Formatted = { title?: string; text?: string };

/**
 * ODER-Begriffe in Titel und Auszug nachmarkieren (exakte Wortgrenzen, highlight.ts): Die
 * Föderation formatiert jeden Treffer nur mit dem Zweig, der ihn geliefert hat; die
 * Thema-Pfade suchen zuletzt nur noch mit dem Suchbegriff. `recrop` schneidet den Auszug um
 * die erste Fundstelle neu (Thema-Pfade; ohne Fundstelle im Text bleibt Meilis Auszug).
 * Bestehende Marken bleiben, wie sie sind.
 */
export function markUnionTerms<T extends { title: string; text?: string; _formatted?: Formatted }>(
	hits: T[],
	terms: readonly string[],
	opts: { recrop: boolean; cropLength: number },
): T[] {
	if (terms.length === 0) return hits;
	const list = [...terms];
	return hits.map((hit) => {
		const recropped = opts.recrop && hit.text ? cropAroundTerms(hit.text, list, opts.cropLength, "…") : null;
		const text = recropped ?? hit._formatted?.text ?? hit.text;
		return {
			...hit,
			_formatted: {
				...hit._formatted,
				title: markTerms(hit._formatted?.title ?? hit.title ?? "", list, "match"),
				...(text ? { text: markTerms(text, list, "match") } : {}),
			},
		};
	});
}
