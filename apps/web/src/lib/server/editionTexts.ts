/**
 * Meili-Index `editions`: Texte der Editionen (Aufbau: services/catalog, editionsBuild.ts;
 * erste Edition QZH). Eine Abfrage-Schicht für den Reiter «Editionen» der Suchseite, die
 * Detailseiten /editionen/<edition>/<id>, die Querverweise von Katalog- und RM-Seiten und
 * (PR 2) API und MCP; Filter und Anzeige pur in $lib/editionTexts.ts.
 *
 * Wie die interaktive Dokumentsuche strikt (`matchingStrategy: "all"`, Ausschlüsse vorn),
 * ODER-Begriffe als föderierte Suche wie im Archivkatalog (catalogUnion.ts). Suchbegriffe
 * gehen im Suchtext der Editionen an Meili (editionSearchForm: «daß» → «dass», ů → u).
 * Das Thema reiht über die jina-Vektoren aus Titel, Schlagwörtern, Regest und Kommentar:
 * zuerst die Stücke mit Vektor nach Ähnlichkeit (reine Vektorsuche in der Treffermenge),
 * dann die übrigen.
 */

import { createHash } from "node:crypto";
import { MEILI_EDITIONS_INDEX, MEILI_SEARCH_KEY, MEILI_URL } from "./env";
import { embedQuery } from "./embed";
import { sanitizeMarks } from "./krdbPeople";
import { createTtlLruCache } from "./ttlCache";
import { catalogLexical, isCatalogUnion, markUnionTerms, unionFacets, unionSearchBody, type CatalogLexical, type CatalogUnion } from "./catalogUnion";
import { createMeiliClient } from "./meiliClient";
import { idsOnly, isDeepPage, pageOnly, searchDeepPage, type PageId } from "./deepPage";
import { editionSearchForm } from "$lib/rmText";
import { catalogThemeMode } from "$lib/catalog";
import {
	editionNeighborsIn,
	editionsFilter,
	isIndexedEdition,
	type EditionHit,
	type EditionsFacetCounts,
	type EditionsFilterValues,
	type EditionsResult,
	type EditionsShared,
	type EditionsTimeline,
	type EditionUnit,
} from "$lib/editionTexts";
import { EDITIONS, pieceIdOf, type EditionKey } from "$lib/editions";
import type { EditionRegisterPiece } from "$lib/editionRegister";
import { CORPUS_CAP, DEFAULT_TOPK, type SearchParams } from "$lib/types";

const client = createMeiliClient(MEILI_URL, MEILI_SEARCH_KEY);
const index = () => client.index(MEILI_EDITIONS_INDEX);

const READY_MS = 30_000;
let ready: boolean | null = null;
let withVectors = false;
let readyAt = 0;

/** Index vorhanden, gefüllt und für den Such-Key lesbar? (30 s gecacht) */
export async function editionsReady(): Promise<boolean> {
	if (ready !== null && Date.now() - readyAt < READY_MS) return ready;
	try {
		const stats = (await index().getStats()) as { numberOfDocuments: number; numberOfEmbeddedDocuments?: number };
		ready = stats.numberOfDocuments > 0;
		withVectors = ready && (stats.numberOfEmbeddedDocuments ?? 0) > 0;
	} catch (err) {
		// 403 (Such-Key deckt `editions` nicht ab) oder Index fehlt: Reiter aus.
		if (ready !== false) console.warn(`[editions] Index ${MEILI_EDITIONS_INDEX} nicht lesbar: ${(err as Error).message}`);
		ready = false;
		withVectors = false;
	}
	readyAt = Date.now();
	return ready;
}

/** Trägt der Index Vektoren (Thema im Reiter)? Stand der letzten Prüfung von editionsReady(). */
export function editionsHaveVectors(): boolean {
	return ready === true && withVectors;
}

/** Felder eines Treffers der Liste (ohne HTML und Volltext). */
const HIT_FIELDS = [
	"id",
	"edition",
	"localId",
	"label",
	"displayTitle",
	"title",
	"permalink",
	"part",
	"signature",
	"isoFrom",
	"isoTo",
	"dateFrom",
	"dateTo",
	"keywords",
	"hasFacsimile",
	"embedded",
];
const DETAIL_FIELDS = [
	"id",
	"edition",
	"localId",
	"label",
	"nr",
	"permalink",
	"displayTitle",
	"part",
	"editors",
	"transcription",
	"tagging",
	"publisher",
	"published",
	"signature",
	"sourceUrl",
	"catalogIds",
	"textLang",
	"filiation",
	"physical",
	"origPlace",
	"witnesses",
	"sourceFile",
	"isoFrom",
	"isoTo",
	"calendar",
	"dateFrom",
	"dateTo",
	"bibl",
	"keywords",
	"keywordGlosses",
	"entitySource",
	"regestHtml",
	"html",
	"backHtml",
	"notes",
	"personList",
	"placeList",
	"orgs",
	"pages",
	"facs",
	"text",
	"comment",
];
const MARKS = { highlightPreTag: '<mark class="match">', highlightPostTag: "</mark>" };
const CROP_LENGTH = 40;
const FACETS = ["edition", "part", "keywords", "hasFacsimile"];
/** Wie `maxValuesPerFacet` des Index (services/catalog editionsSettings.ts). */
const FACET_VALUES_MAX = 2000;
/** So viele Treffer reiht ein Thema höchstens (es gibt weniger Stücke). */
const THEME_POOL = CORPUS_CAP;

interface RawHit {
	id: string;
	edition: EditionKey;
	localId: string;
	label?: string;
	displayTitle?: string;
	title: string;
	permalink?: string;
	part?: string;
	signature?: string;
	isoFrom?: string | null;
	isoTo?: string | null;
	dateFrom?: number | null;
	dateTo?: number | null;
	keywords?: string[];
	hasFacsimile?: boolean;
	embedded?: boolean;
	_formatted?: Partial<Record<"title" | "text" | "regest" | "comment", string>>;
}

const hasMark = (s: string | undefined) => !!s && s.includes("<mark");

function toHit(h: RawHit, highlighted: boolean): EditionHit {
	const f = h._formatted ?? {};
	// Auszug: wo die Wörter stehen – Quellentext, sonst Regest, sonst Kommentar; ohne
	// Suchbegriff das Regest bzw. der Anfang des Texts.
	const snippet = highlighted
		? ([f.text, f.regest, f.comment].find(hasMark) ?? f.regest ?? f.text ?? "")
		: (f.regest || f.text || f.comment || "");
	const titleHtml = highlighted && hasMark(f.title) ? sanitizeMarks(f.title ?? "") : sanitizeMarks(h.displayTitle ?? h.title);
	return {
		id: h.id,
		edition: h.edition,
		localId: h.localId,
		label: h.label || h.localId,
		title: h.displayTitle ?? h.title,
		titleHtml,
		textHtml: sanitizeMarks(snippet),
		permalink: h.permalink ?? "",
		part: h.part ?? "",
		signature: h.signature ?? "",
		isoFrom: h.isoFrom ?? null,
		isoTo: h.isoTo ?? null,
		dateFrom: h.dateFrom ?? null,
		dateTo: h.dateTo ?? null,
		keywords: h.keywords ?? [],
		hasFacsimile: h.hasFacsimile === true,
	};
}

/** Suchbegriff, ODER-Begriffe und «nur im Titel» wie im Katalog, im Suchtext der Editionen. */
export function editionsLexical(params: Pick<SearchParams, "q" | "titleOnly"> & { anyTerms?: readonly string[] }): CatalogLexical {
	return catalogLexical({ q: editionSearchForm(params.q), anyTerms: (params.anyTerms ?? []).map(editionSearchForm), titleOnly: params.titleOnly });
}

function sortRules(sort: SearchParams["sort"], lex: Pick<CatalogLexical, "q" | "terms">): string[] | undefined {
	if (sort === "date_desc") return ["sortDate:desc"];
	if (sort === "date_asc" || (lex.q === "" && lex.terms === null)) return ["sortDate:asc", "nr:asc"];
	return undefined;
}

function lexicalOptions(lex: CatalogLexical) {
	return { matchingStrategy: "all" as const, ...(lex.q && lex.searchOn ? { attributesToSearchOn: lex.searchOn } : {}) };
}

function formatOptions(highlight: boolean) {
	return {
		attributesToRetrieve: HIT_FIELDS,
		attributesToHighlight: highlight ? ["title", "text", "regest", "comment"] : [],
		attributesToCrop: ["text", "regest", "comment"],
		cropLength: CROP_LENGTH,
		...MARKS,
	};
}

interface FederatedResult {
	hits: RawHit[];
	estimatedTotalHits?: number;
	processingTimeMs?: number;
	facetDistribution?: Record<string, Record<string, number>>;
	facetStats?: Record<string, { min: number; max: number }>;
}
type MultiSearchArg = Parameters<typeof client.multiSearch>[0];

async function federate(lex: CatalogUnion, filter: string, federation: Record<string, unknown>, perBranch?: Record<string, unknown>) {
	const body = unionSearchBody(lex, MEILI_EDITIONS_INDEX, filter, federation, perBranch);
	return (await client.multiSearch(body as unknown as MultiSearchArg)) as unknown as FederatedResult;
}

function facetCounts(distribution: unknown): EditionsFacetCounts {
	const fd = (distribution ?? {}) as Record<string, Record<string, number>>;
	return { edition: fd.edition ?? {}, part: fd.part ?? {}, keywords: fd.keywords ?? {}, hasFacsimile: fd.hasFacsimile ?? {} };
}

/** Eine Seite der Treffermenge mit Facetten (lexikalisch bzw. ODER). */
async function lexicalPage(
	lex: CatalogLexical,
	filter: string,
	sort: SearchParams["sort"],
	window: { offset: number; limit: number },
	facets: string[],
): Promise<{ hits: RawHit[]; total: number; ms: number; distribution: Record<string, Record<string, number>> }> {
	const rules = sortRules(sort, lex);
	const highlight = !!(lex.q || lex.terms);
	const format = { ...formatOptions(highlight), ...(rules ? { sort: rules } : {}) };
	// Tiefe Seiten zweistufig wie in den anderen Reitern (deepPage.ts): Meili holte und formatierte
	// sonst jedes Stück bis zum Offset samt Volltext (Prod 2026-11-24, letzte Seite von 1'687
	// Stücken: 577 ms, nur IDs 35 ms). Einen Deckel braucht der kleine Index nicht.
	const deep = isDeepPage(window.offset, window.limit);
	if (isCatalogUnion(lex)) {
		const federation = { ...window, ...(facets.length > 0 ? unionFacets(MEILI_EDITIONS_INDEX, facets, FACET_VALUES_MAX) : {}) };
		const res = deep
			? await searchDeepPage<RawHit, FederatedResult>({
					ids: () => federate(lex, filter, federation, idsOnly(format)),
					format: (ids) => federate(lex, idInClause(ids), { offset: 0, limit: ids.length }, format),
				})
			: await federate(lex, filter, federation, format);
		return { hits: res.hits, total: res.estimatedTotalHits ?? res.hits.length, ms: res.processingTimeMs ?? 0, distribution: res.facetDistribution ?? {} };
	}
	const body = { filter: filter || undefined, ...window, facets: facets.length > 0 ? facets : undefined, ...format, ...lexicalOptions(lex) };
	const run = async (b: Record<string, unknown>) => (await index().search(lex.q, b)) as unknown as FederatedResult;
	const res = deep
		? await searchDeepPage<RawHit, FederatedResult>({
				ids: () => run(idsOnly(body)),
				format: (ids) => run(pageOnly(body, idInClause(ids), ids.length)),
			})
		: await run(body);
	return { hits: res.hits, total: res.estimatedTotalHits ?? res.hits.length, ms: res.processingTimeMs ?? 0, distribution: res.facetDistribution ?? {} };
}

/** Zeitleiste ohne Zeitraumfilter (Anfangs- und Endjahre, Zählung nach Berührung). */
async function timeline(lex: CatalogLexical, filters: EditionsFilterValues, shared: EditionsShared): Promise<EditionsTimeline | null> {
	const filter = editionsFilter(filters, { ...shared, dateFrom: null, dateTo: null });
	const undatedFilter = [filter, "dated = false"].filter(Boolean).join(" AND ");
	try {
		const facetQuery = { facets: ["dateFrom", "dateTo"] };
		const [res, undated] = isCatalogUnion(lex)
			? await Promise.all([
					federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_EDITIONS_INDEX, facetQuery.facets, FACET_VALUES_MAX) }),
					federate(lex, undatedFilter, { offset: 0, limit: 0 }),
				])
			: await Promise.all([
					index().search(lex.q, { filter: filter || undefined, limit: 0, ...facetQuery, ...lexicalOptions(lex) }),
					index().search(lex.q, { filter: undatedFilter, limit: 0, ...lexicalOptions(lex) }),
				]);
		const fd = (res.facetDistribution ?? {}) as Record<string, Record<string, number>>;
		const stats = (res.facetStats ?? {}) as Record<string, { min: number; max: number }>;
		return {
			from: fd.dateFrom ?? {},
			to: fd.dateTo ?? {},
			min: stats.dateFrom?.min ?? null,
			max: stats.dateTo?.max ?? null,
			undated: undated.estimatedTotalHits ?? 0,
		};
	} catch (err) {
		console.warn(`[editions] Zeitleiste nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

type PageParams = Pick<
	SearchParams,
	"q" | "anyTerms" | "titleOnly" | "theme" | "topK" | "sort" | "page" | "pageSize" | "dateFrom" | "dateTo" | "persons" | "places" | "organizations"
>;

/** Facetten der Filterspalte und der Filter, den ihre Auswahl setzt (Drill-Sideways). */
const SIDEWAYS: ReadonlyArray<{ facet: keyof EditionsFacetCounts; clear: (f: EditionsFilterValues) => EditionsFilterValues; set: (f: EditionsFilterValues) => boolean }> = [
	{ facet: "edition", clear: (f) => ({ ...f, edition: [] }), set: (f) => f.edition.length > 0 },
	{ facet: "part", clear: (f) => ({ ...f, part: [] }), set: (f) => f.part.length > 0 },
	{ facet: "keywords", clear: (f) => ({ ...f, keyword: [] }), set: (f) => f.keyword.length > 0 },
	{ facet: "hasFacsimile", clear: (f) => ({ ...f, facs: false }), set: (f) => f.facs },
];

async function sidewaysFacet(lex: CatalogLexical, filter: string, facet: string): Promise<Record<string, number>> {
	try {
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_EDITIONS_INDEX, [facet], FACET_VALUES_MAX) })
			: await index().search(lex.q, { filter: filter || undefined, limit: 0, facets: [facet], ...lexicalOptions(lex) });
		return ((res.facetDistribution ?? {}) as Record<string, Record<string, number>>)[facet] ?? {};
	} catch {
		return {};
	}
}

// --- Thema ----------------------------------------------------------------------

/** Die Menge, die ein Thema reiht: ohne Suchbegriff alle Stücke der Filter, mit Suchbegriff
 *  bzw. ODER-Begriffen deren Treffer (als IDs); dazu, wie viele davon einen Vektor tragen. */
async function themeSet(lex: CatalogLexical, filter: string): Promise<{ total: number; ids: string[] | null; withVectors: number; facets: EditionsFacetCounts }> {
	if (isCatalogUnion(lex) || lex.q) {
		const retrieve = { attributesToRetrieve: ["id", "embedded"] };
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: THEME_POOL, ...unionFacets(MEILI_EDITIONS_INDEX, FACETS, FACET_VALUES_MAX) }, retrieve)
			: ((await index().search(lex.q, { filter: filter || undefined, limit: THEME_POOL, facets: FACETS, ...retrieve, ...lexicalOptions(lex) })) as unknown as FederatedResult);
		const hits = res.hits as Array<{ id: string; embedded?: boolean }>;
		return {
			total: res.estimatedTotalHits ?? hits.length,
			ids: hits.map((h) => h.id),
			withVectors: hits.filter((h) => h.embedded === true).length,
			facets: facetCounts(res.facetDistribution),
		};
	}
	const [all, embedded] = await Promise.all([
		index().search("", { filter: filter || undefined, limit: 0, facets: FACETS }),
		index().search("", { filter: [filter, "embedded = true"].filter(Boolean).join(" AND "), limit: 0 }),
	]);
	return { total: all.estimatedTotalHits ?? 0, ids: null, withVectors: embedded.estimatedTotalHits ?? 0, facets: facetCounts(all.facetDistribution) };
}

const quoteId = (id: string) => `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** Filter auf bestimmte Stücke (Seiten der zweistufigen Liste). */
const idInClause = (ids: readonly PageId[]) => `id IN [${ids.map((id) => quoteId(String(id))).join(", ")}]`;
const idFilter = (filter: string, ids: readonly string[] | null) =>
	ids ? [filter, `id IN [${ids.map(quoteId).join(", ")}]`].filter(Boolean).join(" AND ") : filter;

/** Reihenfolge der Stücke mit Vektor nach Ähnlichkeit, 5 Minuten aufgehoben (Blättern). */
const themeOrders = createTtlLruCache<string[]>({ maxEntries: 100, ttlMs: 5 * 60_000 });

async function themeOrder(set: Awaited<ReturnType<typeof themeSet>>, filter: string, vector: number[], key: string): Promise<string[]> {
	const cached = themeOrders.get(key);
	if (cached) return cached;
	const res = await index().search("", {
		vector,
		hybrid: { embedder: "jina_de", semanticRatio: 1 },
		filter: [idFilter(filter, set.ids), "embedded = true"].filter(Boolean).join(" AND "),
		limit: Math.min(set.withVectors, THEME_POOL),
		attributesToRetrieve: ["id"],
	});
	const order = (res.hits as Array<{ id: string }>).map((h) => h.id);
	themeOrders.set(key, order);
	return order;
}

/** Stücke in der Reihenfolge `ids`, formatiert wie die Liste. */
async function hydrate(ids: string[], lex: CatalogLexical, filter: string): Promise<RawHit[]> {
	if (ids.length === 0) return [];
	const highlight = !!(lex.q || lex.terms);
	const res = await index().search(lex.q, {
		filter: idFilter(filter, ids),
		limit: ids.length,
		...formatOptions(highlight),
		...lexicalOptions(lex),
	});
	const byId = new Map((res.hits as unknown as RawHit[]).map((h) => [h.id, h]));
	return markUnionTerms(
		ids.map((id) => byId.get(id)).filter((h): h is RawHit => h !== undefined),
		lex.highlight,
		{ recrop: false, cropLength: CROP_LENGTH },
	);
}

/** Thema-Reihenfolge der ganzen Menge: Stücke mit Vektor nach Ähnlichkeit, dann die übrigen
 *  (mit Suchbegriff in dessen Reihenfolge, sonst chronologisch). */
async function themeRanking(lex: CatalogLexical, filter: string, vector: number[], theme: string, set: Awaited<ReturnType<typeof themeSet>>): Promise<string[]> {
	const key = createHash("sha256").update(JSON.stringify([filter, lex.q, lex.terms, lex.searchOn ?? null, theme])).digest("hex");
	const ranked = await themeOrder(set, filter, vector, key);
	const seen = new Set(ranked);
	if (set.ids) return [...ranked, ...set.ids.filter((id) => !seen.has(id))];
	const rest = await index().search("", {
		filter: [filter, "NOT embedded = true"].filter(Boolean).join(" AND "),
		sort: ["sortDate:asc", "nr:asc"],
		limit: THEME_POOL,
		attributesToRetrieve: ["id"],
	});
	return [...ranked, ...(rest.hits as Array<{ id: string }>).map((h) => h.id).filter((id) => !seen.has(id))];
}

function sortByDate(hits: RawHit[], dir: "date_asc" | "date_desc"): RawHit[] {
	const key = (h: RawHit) => h.isoFrom ?? (dir === "date_asc" ? "9999" : "0000");
	return [...hits].sort((a, b) => (dir === "date_asc" ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));
}

function facetsOf(hits: RawHit[]): EditionsFacetCounts {
	const out: EditionsFacetCounts = { edition: {}, part: {}, keywords: {}, hasFacsimile: {} };
	const inc = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
	for (const h of hits) {
		inc(out.edition, h.edition);
		if (h.part) inc(out.part, h.part);
		for (const k of h.keywords ?? []) inc(out.keywords, k);
		inc(out.hasFacsimile, String(h.hasFacsimile === true));
	}
	return out;
}

// --- Reiter -----------------------------------------------------------------------

/**
 * Reiter «Editionen»: eine Seite mit Hervorhebung, Facetten und Zeitleiste. Mit Thema
 * (semantic: embed-Service gesund, Index mit Vektoren) wie im Archivkatalog: nach Relevanz
 * reiht es die ganze Treffermenge, nach Datum wählt es die K ähnlichsten und sortiert sie.
 */
export async function searchEditions(
	params: PageParams,
	filters: EditionsFilterValues,
	opts: { semantic?: boolean; overview?: boolean } = {},
): Promise<EditionsResult> {
	const lex = editionsLexical(params);
	const filter = editionsFilter(filters, params);
	const window = { offset: (params.page - 1) * params.pageSize, limit: params.pageSize };
	// overview: Block im Reiter «Alle Quellen» – ohne Zeitleiste und Drill-Sideways.
	const tl = opts.overview ? Promise.resolve<EditionsTimeline | null>(null) : timeline(lex, filters, params);
	const mode = catalogThemeMode(params, opts.semantic === true);
	const vector = mode === "none" ? null : await embedQuery(params.theme.trim());
	if (vector) {
		try {
			const themed = await themePage(params, lex, filter, vector, mode === "rank" ? "rank" : "topK");
			if (themed) return { ...themed, timeline: await tl };
		} catch (err) {
			console.warn(`[editions] Thema-Suche gescheitert, Liste ohne Thema: ${(err as Error).message}`);
		}
	}
	const sideways = opts.overview ? [] : SIDEWAYS.filter((s) => s.set(filters));
	const [res, ...side] = await Promise.all([
		lexicalPage(lex, filter, params.sort, window, FACETS),
		...sideways.map((s) => sidewaysFacet(lex, editionsFilter(s.clear(filters), params), s.facet)),
	]);
	const facets = facetCounts(res.distribution);
	sideways.forEach((s, i) => (facets[s.facet] = side[i]));
	const highlighted = !!(lex.q || lex.terms);
	return {
		hits: markUnionTerms(res.hits, lex.highlight, { recrop: false, cropLength: CROP_LENGTH }).map((h) => toHit(h, highlighted)),
		total: res.total,
		processingTimeMs: res.ms,
		page: params.page,
		pageSize: params.pageSize,
		facets,
		timeline: await tl,
		...(params.theme.trim() && vector ? { themeWithoutVectors: true } : {}),
	};
}

async function themePage(
	params: PageParams,
	lex: CatalogLexical,
	filter: string,
	vector: number[],
	mode: "rank" | "topK",
): Promise<Omit<EditionsResult, "timeline"> | null> {
	const started = Date.now();
	const set = await themeSet(lex, filter);
	if (set.withVectors === 0) return null;
	const order = await themeRanking(lex, filter, vector, params.theme.trim(), set);
	const highlighted = !!(lex.q || lex.terms);
	const offset = (params.page - 1) * params.pageSize;
	if (mode === "rank") {
		const pool = Math.min(set.total, THEME_POOL);
		const hits = await hydrate(order.slice(offset, offset + params.pageSize), lex, filter);
		return {
			hits: hits.map((h) => toHit(h, highlighted)),
			total: set.total,
			processingTimeMs: Date.now() - started,
			page: params.page,
			pageSize: params.pageSize,
			facets: set.facets,
			theme: { mode: "rank", ...(set.total > pool ? { rankedPool: pool } : {}) },
		};
	}
	const k = params.topK ?? DEFAULT_TOPK;
	const nearest = await hydrate(order.slice(0, Math.min(k, set.withVectors)), lex, filter);
	const sorted = sortByDate(nearest, params.sort === "date_desc" ? "date_desc" : "date_asc");
	return {
		hits: sorted.slice(offset, offset + params.pageSize).map((h) => toHit(h, highlighted)),
		total: sorted.length,
		processingTimeMs: Date.now() - started,
		page: params.page,
		pageSize: params.pageSize,
		facets: facetsOf(sorted),
		theme: { mode: "topK", topK: k, topKOfTotal: set.total },
	};
}

/** Trefferzahl fürs Reiter-Label in den anderen Reitern; null bei Fehler. Mit Thema und
 *  Datums-Sortierung höchstens K (wie die Liste). */
export async function countEditions(
	params: Pick<SearchParams, "q" | "anyTerms" | "titleOnly" | "theme" | "topK" | "sort" | "dateFrom" | "dateTo" | "persons" | "places" | "organizations">,
	filters: EditionsFilterValues,
	opts: { semantic?: boolean } = {},
): Promise<number | null> {
	const lex = editionsLexical(params);
	const filter = editionsFilter(filters, params);
	try {
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: 0 })
			: await index().search(lex.q, { filter: filter || undefined, limit: 0, ...lexicalOptions(lex) });
		const total = res.estimatedTotalHits ?? 0;
		return catalogThemeMode(params, opts.semantic === true) === "topK" ? Math.min(total, params.topK ?? DEFAULT_TOPK) : total;
	} catch {
		return null;
	}
}

// --- Stück ------------------------------------------------------------------------

type RawUnit = Omit<EditionUnit, "title" | "persons" | "places"> & { displayTitle: string; personList?: EditionUnit["persons"]; placeList?: EditionUnit["places"] };

function toUnit(r: RawUnit): EditionUnit {
	const { displayTitle, personList, placeList, ...rest } = r;
	return {
		...rest,
		title: displayTitle,
		persons: personList ?? [],
		places: placeList ?? [],
		orgs: r.orgs ?? [],
		notes: r.notes ?? [],
		pages: r.pages ?? [],
		facs: r.facs ?? [],
		bibl: r.bibl ?? [],
		keywords: r.keywords ?? [],
		catalogIds: r.catalogIds ?? [],
		label: r.label || r.localId,
		witnesses: r.witnesses ?? [],
		sourceFile: r.sourceFile ?? null,
		calendar: r.calendar ?? null,
		keywordGlosses: r.keywordGlosses ?? {},
		entitySource: r.entitySource ?? null,
	};
}

/** Ein Stück über Edition und Kennung; null, wenn es fehlt oder der Index nicht lesbar ist. */
/**
 * Ein Stück über seine Kennung. Bei den Rechtsquellen auch über die Kennung eines seiner Texte
 * («SSRQ_ZH_NF_II_3_047_1», «…_047_2» ⇒ Stück «SSRQ_ZH_NF_II_3_047»; pieceIdOf) – so führen
 * Kennungen aus der Edition, den Querverweisen und älteren Links auf das Stück. Ob das Stück
 * unter einer anderen Kennung gefunden wurde, zeigt `unit.localId`.
 */
export async function getEditionUnit(edition: string, localId: string): Promise<EditionUnit | null> {
	if (!/^[a-z]+$/.test(edition) || !/^[A-Za-z0-9_.-]{1,80}$/.test(localId)) return null;
	const ids = [...new Set([localId, isIndexedEdition(edition) ? pieceIdOf(edition, localId) : localId])];
	try {
		const res = await index().search("", {
			filter: `edition = ${quoteId(edition)} AND localId IN [${ids.map(quoteId).join(", ")}]`,
			limit: ids.length,
			attributesToRetrieve: DETAIL_FIELDS,
		});
		const hits = res.hits as unknown as RawUnit[];
		const hit = hits.find((h) => h.localId === localId) ?? hits[0];
		return hit ? toUnit(hit) : null;
	} catch {
		return null;
	}
}

/** Stücke je Abfrage beim Lesen des ganzen Registers. */
const REGISTER_PAGE = 1000;

/**
 * Was alle Stücke zum Register der Editionen beitragen (Personen, Orte, Organisationen mit
 * Edition und Jahren; $lib/editionRegister.ts). Liest den ganzen Index in Seiten zu
 * REGISTER_PAGE (QZH: 790 Stücke, eine Abfrage); wirft bei einem Fehler.
 */
export async function editionRegisterPieces(): Promise<EditionRegisterPiece[]> {
	const out: EditionRegisterPiece[] = [];
	for (let offset = 0; ; offset += REGISTER_PAGE) {
		const res = await index().search("", {
			offset,
			limit: REGISTER_PAGE,
			attributesToRetrieve: ["edition", "dateFrom", "dateTo", "personList", "placeList", "orgs"],
		});
		const hits = res.hits as unknown as Array<Partial<Pick<RawUnit, "edition" | "dateFrom" | "dateTo" | "personList" | "placeList" | "orgs">>>;
		for (const h of hits) {
			out.push({
				edition: h.edition ?? "",
				dateFrom: h.dateFrom ?? null,
				dateTo: h.dateTo ?? null,
				persons: h.personList ?? [],
				places: h.placeList ?? [],
				orgs: h.orgs ?? [],
			});
		}
		if (hits.length < REGISTER_PAGE || offset + REGISTER_PAGE >= (res.estimatedTotalHits ?? 0)) break;
	}
	return out;
}

/** Welche dieser Stücke («qzh-QZH_401») liegen im Index? Leer, wenn er nicht lesbar ist. */
export async function existingEditionIds(ids: readonly string[]): Promise<Set<string>> {
	if (ids.length === 0 || !(await editionsReady())) return new Set();
	try {
		const res = await index().search("", { filter: `id IN [${ids.map(quoteId).join(", ")}]`, limit: ids.length, attributesToRetrieve: ["id"] });
		return new Set((res.hits as Array<{ id: string }>).map((h) => h.id));
	} catch {
		return new Set();
	}
}

/** Laufnummern je Edition bzw. je Teil (nach `nr`; Rechtsquellen zählen je Band), für «voriges /
 *  nächstes Stück»; 10 Minuten aufgehoben. */
const editionOrders = createTtlLruCache<Array<{ localId: string; nr: number }>>({ maxEntries: 40, ttlMs: 10 * 60_000 });

async function editionOrder(edition: string, part: string | null): Promise<Array<{ localId: string; nr: number }>> {
	const key = `${edition}\u0000${part ?? ""}`;
	const cached = editionOrders.get(key);
	if (cached) return cached;
	const out: Array<{ localId: string; nr: number }> = [];
	for (let offset = 0; ; offset += REGISTER_PAGE) {
		const res = await index().search("", {
			filter: part == null ? `edition = ${quoteId(edition)}` : `edition = ${quoteId(edition)} AND part = ${quoteId(part)}`,
			sort: ["nr:asc"],
			offset,
			limit: REGISTER_PAGE,
			attributesToRetrieve: ["localId", "nr"],
		});
		const hits = res.hits as Array<{ localId?: string; nr?: number | null }>;
		for (const h of hits) if (h.localId && typeof h.nr === "number") out.push({ localId: h.localId, nr: h.nr });
		if (hits.length < REGISTER_PAGE || offset + REGISTER_PAGE >= (res.estimatedTotalHits ?? 0)) break;
	}
	editionOrders.set(key, out);
	return out;
}

/** Nachbarn eines Stücks in der Edition bzw. im Band (nach Laufnummer), für «voriges / nächstes
 *  Stück». `nr` ist nur sortierbar: die Reihenfolge kommt aus einer sortierten Liste. */
export async function editionNeighbors(unit: Pick<EditionUnit, "edition" | "nr" | "part">): Promise<{ prev: string | null; next: string | null }> {
	if (unit.nr == null) return { prev: null, next: null };
	try {
		const byPart = EDITIONS[unit.edition]?.numbering === "part";
		return editionNeighborsIn(await editionOrder(unit.edition, byPart ? unit.part : null), unit.nr);
	} catch (err) {
		console.error("[editions] Nachbarn nicht lesbar:", err);
		return { prev: null, next: null };
	}
}

// --- Vorschläge der Namensfelder ------------------------------------------------------

export type EditionsEntityDim = "persons" | "places" | "organizations";

const DIM_FACET: Record<EditionsEntityDim, string> = { persons: "persons", places: "places", organizations: "orgs" };
const SUGGEST_MAX = 30;

/** Namensverteilungen je Auswahl, 5 Minuten aufgehoben (Tippen im Feld). */
const entityDists = createTtlLruCache<Record<string, number>>({ maxEntries: 100, ttlMs: 5 * 60_000 });

/**
 * Vorschläge der Felder Personen, Orte und Organisationen im Reiter: die Namen der aktuellen
 * Treffermenge ohne die Auswahl des Feldes selbst (Drill-Sideways), passend zur Eingabe
 * (Wortanfang irgendeines Wortes; Meilis Facettensuche vergleicht nur den Anfang des Namens).
 */
export async function editionEntitySuggestions(
	dim: EditionsEntityDim,
	params: Pick<SearchParams, "q" | "anyTerms" | "titleOnly" | "dateFrom" | "dateTo" | "persons" | "places" | "organizations">,
	filters: EditionsFilterValues,
	fq: string,
): Promise<Array<{ value: string; count: number }>> {
	const lex = editionsLexical(params);
	const shared: EditionsShared = {
		dateFrom: params.dateFrom,
		dateTo: params.dateTo,
		persons: dim === "persons" ? [] : params.persons,
		places: dim === "places" ? [] : params.places,
		organizations: dim === "organizations" ? [] : params.organizations,
	};
	const filter = editionsFilter(filters, shared);
	const facet = DIM_FACET[dim];
	const key = createHash("sha256").update(JSON.stringify([facet, lex.q, lex.terms, lex.searchOn ?? null, filter])).digest("hex");
	let dist = entityDists.get(key);
	if (!dist) {
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_EDITIONS_INDEX, [facet], FACET_VALUES_MAX) })
			: await index().search(lex.q, { filter: filter || undefined, limit: 0, facets: [facet], ...lexicalOptions(lex) });
		dist = ((res.facetDistribution ?? {}) as Record<string, Record<string, number>>)[facet] ?? {};
		entityDists.set(key, dist);
	}
	const words = fq
		.toLocaleLowerCase("de")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.split(/\s+/)
		.filter(Boolean);
	const fold = (s: string) =>
		s
			.toLocaleLowerCase("de")
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.split(/[\s,.()-]+/)
			.filter(Boolean);
	return Object.entries(dist)
		.filter(([name]) => words.length === 0 || words.every((w) => fold(name).some((x) => x.startsWith(w))))
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de"))
		.slice(0, SUGGEST_MAX);
}

// --- Abfragen für API und MCP --------------------------------------------------------------

export interface EditionsQuery {
	/** Suchbegriff (strikt, alle Wörter; im Suchtext der Editionen angeglichen). */
	q: string;
	/** ODER-Begriffe, ab zwei als Vereinigung wie im Reiter. */
	anyTerms?: string[];
	/** Suchbegriff und ODER-Begriffe nur im Titel. */
	titleOnly?: boolean;
	/** Nach Bedeutung: Vektor des Themas; reiht die Stücke mit Vektor nach Ähnlichkeit (ein
	 *  Suchbegriff bildet dann die Menge). Stücke ohne Vektor fallen weg. */
	vector?: number[] | null;
	sort: SearchParams["sort"];
	offset: number;
	limit: number;
	filters: EditionsFilterValues;
	shared: EditionsShared;
	/** Zählungen der ganzen Treffermenge (API `facets`). */
	facets?: ReadonlyArray<keyof EditionsFacetCounts>;
}

export interface EditionsQueryResult {
	hits: EditionHit[];
	/** Treffer der Abfrage; nach Bedeutung die Menge, die gereiht wurde. */
	total: number;
	processingTimeMs: number;
	/** Nach Bedeutung: Stücke mit Vektor in der Menge (0 ⇒ keine Treffer). */
	withVectors?: number;
	/** Die angefragten Zählungen (`facets`); nach Bedeutung über die ganze Menge. */
	counts: Partial<EditionsFacetCounts>;
}

/** Eine Abfrage für /api/v1/editions, und MCP (edition_search). */
export async function queryEditions(query: EditionsQuery): Promise<EditionsQueryResult> {
	const started = Date.now();
	const lex = editionsLexical({ q: query.q, anyTerms: query.anyTerms, titleOnly: query.titleOnly === true });
	const filter = editionsFilter(query.filters, query.shared);
	const highlighted = !!(lex.q || lex.terms);
	const wanted = query.facets ?? [];
	const pick = (all: EditionsFacetCounts) => Object.fromEntries(wanted.map((f) => [f, all[f]])) as Partial<EditionsFacetCounts>;
	if (query.vector) {
		const set = await themeSet(lex, filter);
		const counts = pick(set.facets);
		if (set.withVectors === 0) return { hits: [], total: set.total, processingTimeMs: Date.now() - started, withVectors: 0, counts };
		const key = createHash("sha256").update(JSON.stringify(["api", filter, lex.q, lex.terms, lex.searchOn ?? null, query.vector])).digest("hex");
		const ranked = await themeOrder(set, filter, query.vector, key);
		const ids = ranked.slice(query.offset, query.offset + query.limit);
		const hits = await hydrate(ids, lex, filter);
		return { hits: hits.map((h) => toHit(h, highlighted)), total: set.total, processingTimeMs: Date.now() - started, withVectors: set.withVectors, counts };
	}
	const res = await lexicalPage(lex, filter, query.sort, { offset: query.offset, limit: query.limit }, [...wanted]);
	return {
		hits: markUnionTerms(res.hits, lex.highlight, { recrop: false, cropLength: CROP_LENGTH }).map((h) => toHit(h, highlighted)),
		total: res.total,
		processingTimeMs: res.ms || Date.now() - started,
		counts: pick(facetCounts(res.distribution)),
	};
}
