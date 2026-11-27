/**
 * Vorschläge der Namensfelder im Reiter «Zentrale Serien» (und «Alle Quellen»), sobald der
 * documents-Index die Vergleichsschlüssel trägt (entityKeysReady): ein Eintrag je Schlüssel
 * mit der Zahl, die seine Wahl liefert (Logik pur in $lib/entitySuggestions.ts). Nur für
 * /api/search/facetSearch – /api/v1/facets/{dim} bleibt bei den Formen
 * (searchStringFacetValues, meili.ts).
 *
 * - Auswahl: dieselbe Basis wie die Vorschläge je Form (facetQueryBase + buildFilter ohne die
 *   Auswahl des Feldes, Drill-Sideways). Ihre Facetten Form + Schlüssel in einer Abfrage,
 *   5 min aufgehoben (Hash über Suchbegriff, strikt, Suchfelder, Filter) – beim Tippen fragt
 *   nur noch die Facettensuche.
 * - Mit Eingabe: Meilis Facettensuche über die Formen (wie bisher, tippfehlertolerant);
 *   Schlüssel, die die gekappte Verteilung der Auswahl nicht kennt, zählt eine multiSearch
 *   nach (`limit: 0`, höchstens RECOUNT_MAX, in der Auswahl aufgehoben) – nur, wenn sie noch
 *   unter die ersten 20 kämen.
 * - Anzeigeform: die häufigste Form des Schlüssels in der Facette der Auswahl oder unter den
 *   Treffern der Facettensuche; fehlt sie dort, eine multiSearch (Formen-Facette und einige
 *   Dokumente des Schlüssels in der Auswahl). Sie benennt den Eintrag nur – jede Form des
 *   Schlüssels wählt dieselben Dokumente –, darum je Schlüssel 1 h aufgehoben, gleich in
 *   welcher Auswahl bestimmt.
 */

import { createHash } from "node:crypto";
import { MEILI_INDEX, MEILI_SEARCH_KEY, MEILI_URL } from "./env";
import { buildFilter, facetQueryBase, getIndex, quoteMeili } from "./meili";
import { createMeiliClient } from "./meiliClient";
import { createTtlLruCache } from "./ttlCache";
import { DOCUMENT_KEY_FIELD, type EntityDim } from "$lib/entityFilter";
import {
	keyedSuggestions,
	pickKeyForm,
	suggestionQueryWords,
	type EntitySuggestion,
	type FacetCounts,
	type SuggestionLookups,
} from "$lib/entitySuggestions";
import type { SearchParams } from "$lib/types";

const client = createMeiliClient(MEILI_URL, MEILI_SEARCH_KEY);

/** Vorschläge je Feld (wie die Vorschläge je Form). */
const SUGGEST_MAX = 20;
/** Höchstens so viele Schlüssel aus der Facettensuche werden nachgezählt. */
const RECOUNT_MAX = 20;
/** Dokumente je Schlüssel, deren Formen die Anzeigeform liefern, wenn die Facette keine kennt. */
const FORM_SAMPLE = 3;

interface Context {
	keyDist: FacetCounts;
	formDist: FacetCounts;
	/** Nachgezählte Schlüssel in dieser Auswahl. */
	counts: Map<string, number>;
}

const contexts = createTtlLruCache<Context>({ maxEntries: 200, ttlMs: 5 * 60_000 });
const contextsLoading = new Map<string, Promise<Context>>();
const displayForms = createTtlLruCache<string | null>({ maxEntries: 20_000, ttlMs: 60 * 60_000 });

type Facets = Record<string, Record<string, number>>;

/** Facetten der Auswahl, aufgehoben; gleichzeitige Anfragen teilen sich eine Abfrage. */
function loadContext(key: string, load: () => Promise<Omit<Context, "counts">>): Promise<Context> {
	const cached = contexts.get(key);
	if (cached) return Promise.resolve(cached);
	let loading = contextsLoading.get(key);
	if (!loading) {
		loading = load()
			.then((dists) => {
				const ctx = { ...dists, counts: new Map<string, number>() };
				contexts.set(key, ctx);
				return ctx;
			})
			.finally(() => contextsLoading.delete(key));
		contextsLoading.set(key, loading);
	}
	return loading;
}

/** Formen der Dokumente eines Treffers (Feld `dim`). */
function hitForms(hits: unknown[], dim: EntityDim): string[] {
	return hits.flatMap((h) => {
		const v = (h as Record<string, unknown>)[dim];
		return Array.isArray(v) ? v.filter((f): f is string => typeof f === "string") : [];
	});
}

/**
 * Vorschläge eines Namensfelds je Schlüssel (Fassung 2): Drill-Sideways über die Auswahl der
 * Suchseite, mit `facetQuery` auf passende Namen eingegrenzt (s. Kopf). `strict` wie die
 * Liste (matchingStrategy "all").
 */
export async function documentEntitySuggestions(opts: {
	params: SearchParams;
	dimension: EntityDim;
	facetQuery: string;
	limit?: number;
	strict?: boolean;
}): Promise<EntitySuggestion[]> {
	const { params, dimension: dim } = opts;
	const base = await facetQueryBase(params, dim, opts.strict ?? false);
	if (base.empty) return [];
	const filter = [...buildFilter(params, [dim]), ...base.extraFilter];
	const keyField = DOCUMENT_KEY_FIELD[dim];
	// strict/titleOnly in JEDER Abfrage, sonst weicht die Basis von der Liste ab.
	const lexical: { matchingStrategy?: "all"; attributesToSearchOn?: string[] } = {};
	if (base.strict) lexical.matchingStrategy = "all";
	if (base.attributesToSearchOn) lexical.attributesToSearchOn = base.attributesToSearchOn;
	const ctxKey = createHash("sha256")
		.update(JSON.stringify([dim, base.q, base.strict, base.attributesToSearchOn ?? null, filter]))
		.digest("hex");
	const fq = opts.facetQuery.trim();

	const [ctx, hits] = await Promise.all([
		loadContext(ctxKey, async () => {
			const res = (await getIndex().search(base.q, {
				q: base.q || null,
				filter,
				facets: [dim, keyField],
				limit: 0,
				attributesToRetrieve: [],
				...lexical,
			})) as unknown as { facetDistribution?: Facets };
			const fd = res.facetDistribution ?? {};
			return { keyDist: fd[keyField] ?? {}, formDist: fd[dim] ?? {} };
		}),
		fq
			? getIndex()
					.searchForFacetValues({ facetName: dim, facetQuery: fq, q: base.q || null, filter, ...lexical } as Parameters<
						ReturnType<typeof getIndex>["searchForFacetValues"]
					>[0])
					.then((r) => (r as { facetHits?: Array<{ value: string; count: number }> }).facetHits ?? [])
			: Promise.resolve(undefined),
	]);

	// Je Schlüssel eine Abfrage in der Auswahl (multiSearch), aus den Caches, was schon bekannt
	// ist. Fehler: ohne diese Schlüssel (sie fallen weg).
	const perKey = (keys: string[], extra: { limit: number; facets?: string[]; attributesToRetrieve?: string[] }) =>
		client.multiSearch({
			queries: keys.map((key) => ({
				indexUid: MEILI_INDEX,
				q: base.q,
				filter: [...filter, `${keyField} = ${quoteMeili(key)}`],
				...extra,
				...lexical,
			})),
		});
	const lookups: SuggestionLookups = {
		async count(keys) {
			const missing = keys.filter((k) => !ctx.counts.has(k));
			if (missing.length > 0) {
				try {
					const res = await perKey(missing, { limit: 0 });
					res.results.forEach((r, i) => ctx.counts.set(missing[i], r.estimatedTotalHits ?? 0));
				} catch (err) {
					console.warn(`[entity-suggest] ${dim}: ${missing.length} Schlüssel nicht nachgezählt: ${(err as Error).message}`);
				}
			}
			return ctx.counts;
		},
		async form(keys) {
			const out = new Map<string, string | null>();
			const missing: string[] = [];
			for (const key of keys) {
				const form = displayForms.get(`${dim}:${key}`);
				if (form !== undefined) out.set(key, form);
				else missing.push(key);
			}
			if (missing.length === 0) return out;
			try {
				const res = await perKey(missing, { limit: FORM_SAMPLE, facets: [dim], attributesToRetrieve: [dim] });
				res.results.forEach((r, i) => {
					const key = missing[i];
					const facet = Object.entries(((r.facetDistribution ?? {}) as Facets)[dim] ?? {});
					const form =
						pickKeyForm(dim, key, facet) ?? pickKeyForm(dim, key, hitForms(r.hits, dim).map((f) => [f, 1] as const));
					if (!form) console.warn(`[entity-suggest] ${dim} «${key}»: keine passende Anzeigeform`);
					displayForms.set(`${dim}:${key}`, form);
					out.set(key, form);
				});
			} catch (err) {
				console.warn(`[entity-suggest] ${dim}: Anzeigeform für ${missing.length} Schlüssel: ${(err as Error).message}`);
			}
			return out;
		},
	};

	return keyedSuggestions(
		{ dim, keyDist: ctx.keyDist, formDist: ctx.formDist, hits, words: fq ? suggestionQueryWords(dim, fq) : undefined },
		lookups,
		{ limit: opts.limit ?? SUGGEST_MAX, recountMax: RECOUNT_MAX },
	);
}
