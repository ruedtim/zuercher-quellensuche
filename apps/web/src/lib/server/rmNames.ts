/**
 * Namensfilter und Volltext der Ratsmanuale (Logik pur in $lib/rmNames.ts): je gefiltertem Name
 * die Schreibungen aus dem Register der Editionen (Index `editions`, `personList`/`placeList`
 * der Stücke mit diesem Namen) und die Zahl der RM-Sitzungen, die eine davon als Phrase
 * enthalten (föderierte Multi-Search mit `limit: 0`, dedupliziert wie die ODER-Suche).
 *
 * Die Suchseite lädt das gestreamt nach (Hinweiszeile im Reiter «Zentrale Serien»); fehlt der
 * Editionen-Index, gilt nur der Filterwert. Zeitbudget RM_HINT_BUDGET_MS, sonst kein Hinweis.
 */

import { MEILI_EDITIONS_INDEX, MEILI_INDEX, MEILI_SEARCH_KEY, MEILI_URL } from "./env";
import { createMeiliClient } from "./meiliClient";
import { createTtlLruCache } from "./ttlCache";
import { editionsReady } from "./editionTexts";
import type { EntityKind } from "$lib/entityKey";
import { personKey, placeKey } from "$lib/entityKey";
import { isQualifiedPersonName } from "$lib/entityFilter";
import {
	rmBranchQueries,
	rmFilter,
	rmFilterNames,
	rmFulltextApplies,
	rmFulltextHref,
	rmNameVariants,
	rmSearchRange,
	type RegisterEntry,
	type RmFulltextHint,
} from "$lib/rmNames";
import type { SearchParams } from "$lib/types";

export type { RmFulltextHint };

const client = createMeiliClient(MEILI_URL, MEILI_SEARCH_KEY);

const RM_HINT_BUDGET_MS = 2500;

const quote = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

interface Register {
	entries: RegisterEntry[];
	/** Beginn und Ende der Stücke mit dem Namen (für den Zeitraum der Personen). */
	years: number[];
}
const EMPTY: Register = { entries: [], years: [] };

const registerCache = createTtlLruCache<Register>({ maxEntries: 500, ttlMs: 60 * 60_000, maxKeyLen: 400 });

/** Einträge des Editionen-Registers zu einem Namen und die Jahre der Stücke: alle Stücke mit
 *  dem Namen oder seinem Vergleichsschlüssel. */
async function register(kind: EntityKind, value: string): Promise<Register> {
	if (kind === "org") return EMPTY;
	const key = kind === "person" ? personKey(value) : placeKey(value);
	if (!key) return EMPTY;
	const cacheKey = `${kind}:${value}`;
	const hit = registerCache.get(cacheKey);
	if (hit) return hit;
	if (!(await editionsReady())) return EMPTY;
	const [field, keyField, list] = kind === "person" ? ["persons", "personKeys", "personList"] : ["places", "placeKeys", "placeList"];
	const res = await client.index(MEILI_EDITIONS_INDEX).search("", {
		// Namensvettern mit Lebensjahren nur exakt (sonst kämen Stücke und Jahre des Namensvetters mit).
		filter: kind === "person" && isQualifiedPersonName(value) ? `${field} = ${quote(value)}` : `${field} = ${quote(value)} OR ${keyField} = ${quote(key)}`,
		limit: 1000,
		attributesToRetrieve: [list, "dateFrom", "dateTo"],
	});
	const hits = res.hits as Array<Record<string, unknown>>;
	const out: Register = {
		entries: hits.flatMap((h) => (h[list] as RegisterEntry[] | undefined) ?? []),
		years: hits.flatMap((h) => [h.dateFrom, h.dateTo]).filter((y): y is number => typeof y === "number"),
	};
	registerCache.set(cacheKey, out);
	return out;
}

const countCache = createTtlLruCache<number>({ maxEntries: 500, ttlMs: 10 * 60_000, maxKeyLen: 2000 });

/** RM-Sitzungen mit mindestens einer Schreibung: Föderation, ein Zweig je Schreibung, nur gezählt. */
async function countRm(variants: readonly string[], params: SearchParams): Promise<number> {
	const filter = rmFilter(params);
	const queries = rmBranchQueries(variants, params.q).map((b) => ({ indexUid: MEILI_INDEX, ...b, filter, attributesToRetrieve: ["id"] }));
	const cacheKey = JSON.stringify(queries);
	const hit = countCache.get(cacheKey);
	if (hit != null) return hit;
	type Arg = Parameters<typeof client.multiSearch>[0];
	const res = (await client.multiSearch({ federation: { offset: 0, limit: 0 }, queries } as unknown as Arg)) as unknown as {
		estimatedTotalHits?: number;
	};
	const total = res.estimatedTotalHits ?? 0;
	countCache.set(cacheKey, total);
	return total;
}

async function hintFor(kind: EntityKind, value: string, params: SearchParams): Promise<RmFulltextHint | null> {
	const reg = await register(kind, value).catch((err) => {
		console.warn(`[rm-names] Register ${kind} «${value}»: ${(err as Error).message}`);
		return EMPTY;
	});
	const range = rmSearchRange(kind, params, reg.years);
	const variants = rmNameVariants(kind, value, reg.entries);
	if (!range || variants.length === 0) return null;
	const scoped = { ...params, dateFrom: range.from, dateTo: range.to };
	const total = await countRm(variants, scoped);
	if (total === 0) return null;
	return { kind, value, variants, total, range: kind === "person" ? range : null, href: rmFulltextHref(variants, scoped) };
}

/**
 * Hinweise auf den RM-Volltext zu den Namensfiltern der Auswahl (leer, wenn die Auswahl die
 * Ratsmanuale nicht berührt, nichts trifft oder das Zeitbudget überschritten ist).
 */
export async function rmFulltextHints(params: SearchParams): Promise<RmFulltextHint[]> {
	if (!rmFulltextApplies(params)) return [];
	const names = rmFilterNames(params);
	if (names.length === 0) return [];
	const started = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), RM_HINT_BUDGET_MS);
	});
	const work: Promise<Array<RmFulltextHint | null>> = Promise.all(names.map(({ kind, value }) => hintFor(kind, value, params))).catch((err) => {
		console.warn(`[rm-names] ${(err as Error).message}`);
		return [];
	});
	const out = await Promise.race([work, timeout]);
	clearTimeout(timer);
	if (out == null) {
		console.warn(`[rm-names] über ${RM_HINT_BUDGET_MS} ms – kein Hinweis`);
		return [];
	}
	const hints = out.filter((h): h is RmFulltextHint => !!h);
	if (Date.now() - started > 1000) console.log(`[rm-names] ${names.length} Namen in ${Date.now() - started} ms`);
	return hints;
}
