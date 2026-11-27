/**
 * Meili-Index `catalog`: Verzeichnungseinheiten des Online-Archivkatalogs des
 * Staatsarchivs (Aufbau: services/catalog). Lexikalisch; der Reiter der Suchseite
 * reiht mit einem Thema zusätzlich über die jina-Vektoren der Einheiten (Embedder
 * `jina_de` wie im Index `documents`, seit 2026-10-30; searchCatalog), ebenso die
 * Suche nach Bedeutung des MCP-Werkzeugs catalog_search (nearestCatalogUnits), und kennt
 * ODER-Begriffe als föderierte Suche (catalogUnion.ts) sowie die Feldsuche
 * (Suchbegriffe nur in einem Feld, withFieldSearch).
 *
 * Gesucht wird nur in Einheiten, die nicht selbst ein Plattform-Dokument
 * abbilden (`onPlatform = false`: keine Dubletten der Zentralen Serien und
 * Ratsmanual-Sitzungen) – ausser bei einer Suche im Feld «Signatur» (searchesSignature): die
 * findet auch sie, mit Link auf das Dokument. Wie die interaktive Dokumentsuche strikt
 * (`matchingStrategy: "all"`, Ausschlüsse vorn – sonst trifft eine Signatur
 * wie «Z 1114.734» zehntausende Einheiten). Titel und Auszüge kommen maskiert
 * zurück (sanitizeMarks), die Katalogtexte können `<` und `&` enthalten.
 *
 * Archivplan-Stufen, die bisher nur aus Pfaden bekannt sind (`stub`), tragen kein
 * `onPlatform` und fallen so aus allen Abfragen mit `onPlatform = false`; sie
 * erscheinen nur im Archivbaum und als Detailseite.
 *
 * ß und ss gelten als gleich, sobald der Index gefaltete Suchfelder trägt (foldedSearch.ts):
 * Alle Abfragen mit Suchbegriff bauen ihn über lexicalOf bzw. fieldLexical, die Treffer zeigen
 * das Original (unfoldHit).
 */

import { createHash } from "node:crypto";
import { MEILI_CATALOG_INDEX, MEILI_SEARCH_KEY, MEILI_URL } from "./env";
import { embedQuery } from "./embed";
import { rankedHits, searchTwice } from "./vectorCutoff";
import { createTtlLruCache } from "./ttlCache";
import { foldSharpS } from "$lib/sharpS";
import {
	CATALOG_ROOT_ID,
	CATALOG_TREE_PAGE,
	catalogAncestors,
	catalogDateClauses,
	catalogFacetsOf,
	catalogThemeMode,
	catalogTimelineLevels,
	catalogTimelineOf,
	digitalLinks,
	documentCatalogFilter,
	DOCUMENT_REFERENCES_MAX,
	personCatalogFilter,
	pickDocumentCatalog,
	sortByCatalogDate,
	type CatalogChildren,
	type CatalogFacetCounts,
	type CatalogFilters,
	type CatalogHit,
	type CatalogNeighbors,
	type CatalogResult,
	type CatalogTimeline,
	type CatalogTreeNode,
	type CatalogTreeStart,
	type CatalogUnitRef,
	type CatalogUnitSection,
	type DocumentCatalog,
} from "$lib/catalog";
import { entityFilterClauses } from "$lib/catalogRegister";
import {
	bestandSuggestions,
	CATALOG_SEARCH_FIELDS,
	catalogFieldConditions,
	catalogFieldInfo,
	catalogFieldMarks,
	searchesSignature,
	type CatalogFieldCondition,
} from "$lib/catalogFields";
import { CORPUS_CAP, DEFAULT_TOPK, type SearchParams } from "$lib/types";
import { sanitizeMarks } from "./krdbPeople";
import { browseLimitOf, browseWindow } from "./browseLimit";
import { collectHitIds, sliceClause, yearSlices, type YearSlice } from "./hitIds";
import { THEME_LIST_MAX, cachedOrder, themeOrderAlone, themeOrderWithin, type Ranked, type ThemeOrder } from "./themeOrder";
import { markFieldTerms, resolveFieldSet, type FieldSet } from "./catalogFieldSearch";
import { createFoldSwitch, unfoldHit, withFolded } from "./foldedSearch";
import {
	catalogLexical,
	catalogSortRules,
	isCatalogUnion,
	lexicalSearchOn,
	markUnionTerms,
	unionFacets,
	unionSearchBody,
	type CatalogLexical,
	type CatalogUnion,
} from "./catalogUnion";
import { createMeiliClient } from "./meiliClient";
import { idsOnly, inPageOrder, isDeepPage, pageOnly, searchDeepPage, type PageId } from "./deepPage";

const client = createMeiliClient(MEILI_URL, MEILI_SEARCH_KEY);
const index = () => client.index(MEILI_CATALOG_INDEX);

const READY_MS = 30_000;
let ready: boolean | null = null;
let withVectors = false;
// Einheiten mit Vektor im ganzen Index.
let embeddedTotal = 0;
let readyAt = 0;

/** Gefaltete Suchfelder im Index (ß als ss): Stand der letzten Prüfung von catalogReady(). */
const folding = createFoldSwitch(
	"catalog",
	CATALOG_SEARCH_FIELDS.map((f) => f.key),
	(searchOn) => index().search("", { limit: 0, attributesToSearchOn: searchOn }),
);

/** Index vorhanden, gefüllt und für den Such-Key lesbar? (30 s gecacht) */
export async function catalogReady(): Promise<boolean> {
	if (ready !== null && Date.now() - readyAt < READY_MS) return ready;
	try {
		const stats = (await index().getStats()) as {
			numberOfDocuments: number;
			numberOfEmbeddedDocuments?: number;
			fieldDistribution?: Record<string, number>;
		};
		ready = stats.numberOfDocuments > 0;
		// Seit Meili 1.13 in den Stats; ohne Vektoren (älterer Index, lokaler Spiegel) kein Thema.
		embeddedTotal = stats.numberOfEmbeddedDocuments ?? 0;
		withVectors = ready && embeddedTotal > 0;
		await folding.update(stats.fieldDistribution);
	} catch (err) {
		// 403 (Such-Key deckt `catalog` nicht ab) oder Index fehlt: Reiter aus.
		if (ready !== false) console.warn(`[catalog] Index ${MEILI_CATALOG_INDEX} nicht lesbar: ${(err as Error).message}`);
		ready = false;
		withVectors = false;
		embeddedTotal = 0;
		await folding.update(null);
	}
	readyAt = Date.now();
	return ready;
}

/** Suchbegriff wie in den Abfragen des Katalogs: mit ss statt ß, sobald der Index gefaltete
 *  Suchfelder trägt (catalogRegister.ts sucht damit selbst). */
export async function catalogSpelling(q: string): Promise<string> {
	await catalogReady();
	return folding.on ? foldSharpS(q) : q;
}

/** Suchbegriff, ODER-Begriffe und «nur im Titel» einer Abfrage, in der Schreibung des Index. */
export function lexicalOf(params: Parameters<typeof catalogLexical>[0]): CatalogLexical {
	return catalogLexical(params, folding.on);
}

/** Abfragen ausserhalb dieses Moduls mit lexicalOf: lehnt Meili ein gefaltetes Suchfeld ab,
 *  laufen sie einmal ohne Faltung neu (foldedSearch.ts). */
export const withCatalogFallback = folding.withFallback;

/** Trägt der Index Vektoren (Thema im Reiter)? Stand der letzten Prüfung von catalogReady(). */
export function catalogHasVectors(): boolean {
	return ready === true && withVectors;
}

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Katalog-Filter mit dem Ergebnis der Feldsuche (withFieldSearch; nie aus der URL): `ids` der
 *  übrigen Bedingungen, `platform` = samt den Einheiten der Plattform-Dokumente (Signatursuche). */
export type ScopedCatalogFilters = CatalogFilters & { ids?: readonly number[]; platform?: boolean };

export function filterOf(f: ScopedCatalogFilters): string {
	// Einheiten, deren Entstehungszeitraum den gewählten Zeitraum berührt.
	// Stufen nur aus Pfaden (`stub`) tragen kein `onPlatform`.
	const parts = [f.platform ? "onPlatform EXISTS" : "onPlatform = false", ...catalogDateClauses(f.dateFrom, f.dateTo)];
	if (f.level.length > 0) parts.push(`level IN [${f.level.map(quote).join(", ")}]`);
	if (f.bestand.length > 0) parts.push(`bestand IN [${f.bestand.map(quote).join(", ")}]`);
	if (f.digital) parts.push("hasDigitization = true");
	// Personen, Orte, Organisationen über die filterbaren Vergleichsschlüssel.
	parts.push(...entityFilterClauses(f.entities));
	// Feldsuche als ID-Menge (withFieldSearch); `id IN []` trifft nichts.
	if (f.ids) parts.push(`id IN [${f.ids.join(", ")}]`);
	return parts.join(" AND ");
}

/** Katalog-Dokument, wie Suchseite, API und MCP es lesen (Teilmenge der Index-Felder). */
export interface CatalogUnitRaw {
	id: number;
	signature: string;
	title: string;
	text?: string;
	level: string;
	dateText: string;
	dateFrom?: number | null;
	dateTo?: number | null;
	bestand: string | null;
	path?: Array<{ id: number; label: string }>;
	provenienz?: string;
	hasDigitization: boolean;
	files?: Array<{ name: string; url: string; kind: string }>;
	fileCount?: number;
	url: string;
	onPlatform?: boolean;
	docId?: string;
	docSeries?: string;
	stub?: boolean;
	_formatted?: { title?: string; text?: string };
}
type RawHit = CatalogUnitRaw & { _rankingScore?: number };

/** Alles, was die Detailseite braucht (fehlt im Index vor dem Neuaufbau teilweise). */
export interface CatalogUnitDetailRaw extends CatalogUnitRaw {
	parentId?: number | null;
	childCount?: number;
	/** Position unter den Geschwistern ab 1 (services/catalog tree.ts `SiblingOrder`). */
	sigPos?: number;
	sections?: CatalogUnitSection[];
	/** Anzeigeformen der erkannten Namen (Register) und gesichert zugeordnete KRDB-Personen. */
	persons?: string[];
	places?: string[];
	organizations?: string[];
	krdbIds?: number[];
}

const RETRIEVE = [
	"id",
	"signature",
	"title",
	"text",
	"level",
	"dateText",
	"dateFrom",
	"dateTo",
	"bestand",
	"path",
	"provenienz",
	"hasDigitization",
	"files",
	"fileCount",
	"url",
	"onPlatform",
	"docId",
	"docSeries",
	"stub",
];
const DETAIL_FIELDS = [...RETRIEVE, "parentId", "childCount", "sigPos", "sections", "persons", "places", "organizations", "krdbIds"];
const NODE_FIELDS = ["id", "signature", "title", "level", "dateText", "childCount", "stub", "hasDigitization", "onPlatform", "docId", "docSeries"];
/** Kurze Listen der Dokument- und Personenseite (`path` für den Bestand bzw. den Archivplan). */
const REF_FIELDS = ["id", "signature", "title", "level", "dateText", "bestand", "path", "hasDigitization", "onPlatform", "docId", "stub"];

export interface CatalogQuery {
	q: string;
	/** ODER-Begriffe (Suchseite): ab zwei die
	 *  Vereinigung, `q` hängt an jedem Zweig (catalogUnion.ts); ein einzelner gilt als Teil
	 *  des Suchbegriffs. */
	anyTerms?: readonly string[];
	sort: SearchParams["sort"];
	offset: number;
	limit: number;
	/** Verteilungen nach Stufe, Bestand und Digitalisat mitliefern; als Liste nur diese
	 *  (Reiter: TAB_FACETS ohne Bestand). */
	facets?: boolean | readonly string[];
	/** `<mark class="match">` in Titel und Auszug (Suchseite) statt nur Crop (API, MCP). */
	highlight?: boolean;
	/** Letztes Suchwort ganz statt als Wortanfang (Meili sucht das letzte Wort als
	 *  Präfix, ausser die Suche endet mit einem Leerzeichen). Früher (Recherche-Modus der Website, bis 2026-11) bei
	 *  Signatur-Kürzeln am Ende («C», «II», «12»: catalogExactLast); nur ohne
	 *  ODER-Begriffe. */
	exactLast?: boolean;
	/** Suchbegriff nur in diesen Feldern (Reiter: «nur im Titel» ⇒ ["title"]). */
	attributesToSearchOn?: string[];
}

const FACETS = ["level", "bestand", "hasDigitization"];

/** Facetten der Filterspalte im Reiter: ohne Bestand – den wählt die Feldsuche aus Vorschlägen
 *  (catalogBestandSuggestions); die Facette kostete je Abfrage 20–50 ms (Prod 2026-10-30). */
const TAB_FACETS = ["level", "hasDigitization"];

/** Höchstzahl Werte je Facette wie die Einstellung des Index (services/catalog settings.ts). */
const FACET_VALUES_MAX = 2000;

/** Länge der Auszüge in Wörtern (Meili-Crop und Nachschnitt bei ODER). */
const CROP_LENGTH = 40;

function facetCounts(distribution: unknown): CatalogFacetCounts {
	const fd = (distribution ?? {}) as Record<string, Record<string, number>>;
	return { level: fd.level ?? {}, bestand: fd.bestand ?? {}, digital: fd.hasDigitization?.true ?? 0 };
}

interface CatalogPage {
	hits: CatalogUnitRaw[];
	total: number;
	processingTimeMs: number;
	facets: CatalogFacetCounts;
}

/** Eine Abfrage für API und MCP: nur eigene Treffer (`onPlatform = false`); ab zwei ODER-Begriffen
 *  ihre Vereinigung (unionQuery). */
export function queryCatalog(query: CatalogQuery, filters: CatalogFilters): Promise<CatalogPage> {
	return folding.withFallback(async () => {
		// Suchbegriff und ODER-Begriffe wie im Reiter (catalogLexical: ein einzelner ODER-Begriff gilt
		// als Suchbegriff); «nur im Titel» kommt als Suchfeld.
		const lex: CatalogLexical = {
			...lexicalOf({ q: query.q, anyTerms: query.anyTerms, titleOnly: false }),
			searchOn: query.attributesToSearchOn,
		};
		// Feldsuche (früher auch der Recherche-Modus im Katalog-Reiter): bleiben Suchbegriff bzw. ODER-Begriffe die
		// Abfrage, gilt «letztes Wort ganz» weiter; sonst sucht die Abfrage in einem Feld.
		const scope = await withFieldSearch(lex, filters);
		if (scope.tooBroad) return { hits: [], total: 0, processingTimeMs: 0, facets: facetCounts(undefined) };
		return runQuery(scope.lex, { ...query, exactLast: query.exactLast && scope.lex === lex }, scope.filters);
	});
}

/** Eine Seite für Suchseite, API und MCP; die Feldsuche ist aufgelöst (withFieldSearch). */
async function runQuery(
	lex: CatalogLexical,
	query: Pick<CatalogQuery, "sort" | "offset" | "limit" | "facets" | "highlight" | "exactLast">,
	filters: ScopedCatalogFilters,
): Promise<CatalogPage> {
	if (isCatalogUnion(lex)) return unionQuery(lex, query, filters);
	const q = lex.q;
	// Ohne Suchbegriff gibt es keine Relevanz: chronologisch wie die Dokumentsuche.
	const sort = catalogSortRules(query.sort, lex);
	const res = await searchPage(q && query.exactLast ? `${q} ` : q, {
		filter: filterOf(filters),
		limit: query.limit,
		offset: query.offset,
		sort,
		facets: query.facets === true ? FACETS : query.facets ? [...query.facets] : undefined,
		...formatOptions(lex, query.highlight === true && q !== ""),
		...lexicalOptions(lex),
	});
	return {
		hits: shownHits(res.hits, lex),
		total: res.estimatedTotalHits ?? res.hits.length,
		processingTimeMs: res.processingTimeMs ?? 0,
		facets: facetCounts(res.facetDistribution),
	};
}

/** Antwort einer Suche bzw. der Föderation (ein Index, Facetten gemergt). */
interface FederatedResult {
	hits: CatalogUnitRaw[];
	estimatedTotalHits?: number;
	processingTimeMs?: number;
	facetDistribution?: Record<string, Record<string, number>>;
	facetStats?: Record<string, { min: number; max: number }>;
}

/** Filter auf bestimmte Einheiten (Seiten der zweistufigen Pfade). */
const idInClause = (ids: readonly PageId[]) => `id IN [${ids.join(", ")}]`;

/**
 * Eine Suche im Katalog; tiefe Seiten zweistufig (deepPage.ts): Meili v1.56 holte und
 * formatierte sonst jede Einheit bis zum Offset (~0,03 ms je Einheit; Stichprobe ×20,
 * «Kirche» Offset 20'000: 0,63 s, zweistufig 0,16 s).
 */
async function searchPage(q: string, body: Record<string, unknown>): Promise<FederatedResult> {
	const run = async (b: Record<string, unknown>) => (await index().search(q, b)) as unknown as FederatedResult;
	if (!isDeepPage(Number(body.offset ?? 0), Number(body.limit ?? 20))) return run(body);
	return searchDeepPage<CatalogUnitRaw, FederatedResult>({
		ids: () => run(idsOnly(body)),
		format: (ids) => run(pageOnly(body, idInClause(ids), ids.length)),
	});
}

type MultiSearchArg = Parameters<typeof client.multiSearch>[0];

/** ODER-Suche: Vereinigung der Zweige als eine föderierte Suche, dedupliziert (catalogUnion.ts). */
async function federate(
	lex: CatalogUnion,
	filter: string,
	federation: Record<string, unknown>,
	perBranch?: Record<string, unknown>,
): Promise<FederatedResult> {
	const body = unionSearchBody(lex, MEILI_CATALOG_INDEX, filter, federation, perBranch);
	return (await client.multiSearch(body as unknown as MultiSearchArg)) as unknown as FederatedResult;
}

/** Strikte Suche mit Suchbegriff (ohne ODER), auf Wunsch nur im Titel. */
function lexicalOptions(lex: CatalogLexical) {
	const searchOn = lexicalSearchOn(lex);
	return { matchingStrategy: "all" as const, ...(lex.q && searchOn ? { attributesToSearchOn: searchOn } : {}) };
}

const MARKS = { highlightPreTag: '<mark class="match">', highlightPostTag: "</mark>" };

/** Felder der Trefferliste, die Meili formatiert: Titel und Text (Auszug). */
const SHOWN = ["title", "text"];

/** Felder und Formatierung der Treffer: Wörter des Suchbegriffs auf Wunsch hervorgehoben (eine
 *  Feldsuche nur in ihrem Feld, `highlightOn`), Auszug aus dem Text; mit Faltung ebenso an den
 *  gefalteten Feldern (shownHits). */
function formatOptions(lex: Pick<CatalogLexical, "highlightOn" | "fold">, highlight: boolean) {
	const marked = highlight ? (lex.highlightOn ?? SHOWN) : [];
	const cropped = ["text"];
	return {
		attributesToRetrieve: RETRIEVE,
		attributesToHighlight: lex.fold ? withFolded(marked) : marked,
		attributesToCrop: lex.fold ? withFolded(cropped) : cropped,
		cropLength: CROP_LENGTH,
		...MARKS,
	};
}

/** Treffer, wie sie gezeigt werden: Hervorhebung und Auszug der gefalteten Felder am Original. */
function shownHits<H extends CatalogUnitRaw>(hits: H[], lex: Pick<CatalogLexical, "fold">): H[] {
	if (!lex.fold) return hits;
	return hits.map((h) => unfoldHit(h, SHOWN, { pre: MARKS.highlightPreTag, post: MARKS.highlightPostTag }));
}

/** Feldsuche aufgelöst (withFieldSearch): was die Abfrage sucht und welche IDs sie einschränken. */
interface FieldScope {
	/** Die Abfrage: Suchbegriff bzw. ODER-Begriffe, ohne beide eine Feldbedingung. */
	lex: CatalogLexical;
	/** Filter ohne Feldsuche, mit den IDs der übrigen Bedingungen (`ids`). */
	filters: ScopedCatalogFilters;
	/** Wörter der Bedingungen, die nur als ID-Menge wirken – Meili hebt sie nicht hervor. */
	marks: { title: string[]; text: string[] };
	/** Jede Bedingung trifft mehr als FIELD_IDS_MAX Einheiten: keine Treffer. */
	tooBroad: boolean;
}

/** So viele IDs holt die Feldsuche höchstens für die erste Bedingung der Kette, wie die
 *  zweistufigen Pfade der Dokumentsuche (10'000 IDs 0,3–0,9 s auf Prod). */
const FIELD_IDS_MAX = CORPUS_CAP;

const NO_MARKS = { title: [], text: [] };

/** Eine Feldbedingung als Abfrage: strikt, nur in ihrem Feld, Hervorhebung nur dort. */
function fieldLexical(c: CatalogFieldCondition): CatalogLexical {
	return { ...lexicalOf({ q: c.q, titleOnly: false }), searchOn: [c.field], highlightOn: catalogFieldInfo(c.field).marked ? [c.field] : [] };
}

/** Trefferzahlen und IDs der Kandidaten (resolveFieldSet) unter dem Grundfilter. */
function fieldSetDeps(candidates: CatalogLexical[], filter: string) {
	const within = (ids: readonly number[] | null) => (ids ? `${filter} AND id IN [${ids.join(", ")}]` : filter);
	return {
		async counts(): Promise<number[]> {
			const plain = candidates.flatMap((c, i) => (isCatalogUnion(c) ? [] : [{ c, i }]));
			const [multi, unions] = await Promise.all([
				plain.length > 0
					? client.multiSearch({ queries: plain.map(({ c }) => ({ indexUid: MEILI_CATALOG_INDEX, q: c.q, filter, limit: 0, ...lexicalOptions(c) })) })
					: null,
				Promise.all(candidates.map((c) => (isCatalogUnion(c) ? federate(c, filter, { offset: 0, limit: 0 }) : null))),
			]);
			const counts = unions.map((u) => u?.estimatedTotalHits ?? 0);
			plain.forEach(({ i }, j) => (counts[i] = multi?.results[j]?.estimatedTotalHits ?? 0));
			return counts;
		},
		async ids(i: number, ids: readonly number[] | null, limit: number): Promise<number[]> {
			const c = candidates[i];
			const res = isCatalogUnion(c)
				? await federate(c, within(ids), { offset: 0, limit }, { attributesToRetrieve: ["id"] })
				: await index().search(c.q, { filter: within(ids), limit, attributesToRetrieve: ["id"], ...lexicalOptions(c) });
			return (res.hits as unknown as Array<{ id: number }>).map((h) => h.id);
		},
	};
}

/** Aufgelöste Feldsuche je Abfrage und Filter, 5 Minuten aufgehoben (Blättern, Sortieren,
 *  Reiterwechsel); gleichzeitige Anfragen (Liste und Zeitleiste) teilen sich eine Auflösung. */
const fieldSets = createTtlLruCache<FieldSet>({ maxEntries: 50, ttlMs: 5 * 60_000 });
const fieldSetsRunning = new Map<string, Promise<FieldSet>>();

/**
 * Feldsuche ($lib/catalogFields.ts) für eine Abfrage auflösen: Kandidaten sind der Suchbegriff
 * bzw. die ODER-Begriffe (`lex`, falls gesetzt) und je Feld eine Bedingung. Ohne Feldsuche
 * bleibt alles, wie es ist; eine Feldbedingung allein wird selbst die Abfrage, sonst schneidet
 * resolveFieldSet die übrigen Bedingungen zu IDs (`filters.ids`). Jede Abfrage des Reiters
 * löst unter ihrem eigenen Filter auf (die Zeitleiste ohne Zeitraum).
 */
async function withFieldSearch(lex: CatalogLexical, filters: ScopedCatalogFilters): Promise<FieldScope> {
	const conditions = catalogFieldConditions(filters.fields);
	const base: ScopedCatalogFilters = { ...filters, fields: [], ...(searchesSignature(filters.fields) ? { platform: true } : {}) };
	if (conditions.length === 0) return { lex, filters: base, marks: NO_MARKS, tooBroad: false };
	const general = lex.q !== "" || lex.terms !== null;
	const candidates = [...(general ? [lex] : []), ...conditions.map(fieldLexical)];
	const filter = filterOf(base);
	const key = createHash("sha256")
		.update(JSON.stringify([candidates.map((c) => [c.q, c.terms, lexicalSearchOn(c) ?? null]), filter]))
		.digest("hex");
	let set = fieldSets.get(key);
	if (!set) {
		let running = fieldSetsRunning.get(key);
		if (!running) {
			running = resolveFieldSet(candidates.length, general ? 0 : null, FIELD_IDS_MAX, fieldSetDeps(candidates, filter))
				.then((v) => {
					fieldSets.set(key, v);
					return v;
				})
				.finally(() => fieldSetsRunning.delete(key));
			fieldSetsRunning.set(key, running);
		}
		set = await running;
	}
	const offset = general ? 1 : 0;
	const main = set.main;
	return {
		lex: candidates[main],
		filters: set.ids ? { ...base, ids: set.ids } : base,
		marks: catalogFieldMarks(conditions.filter((_, i) => i + offset !== main)),
		tooBroad: set.tooBroad,
	};
}

/**
 * Suchbegriff und Feldsuche für Abfragen ausserhalb der Liste (Vorschläge der Namensfelder,
 * catalogRegister.ts): die Abfrage und der Filter, wie der Reiter sie stellt. `tooBroad` = keine
 * Treffer (s. withFieldSearch).
 */
export async function catalogFieldScope(
	lex: CatalogLexical,
	filters: CatalogFilters,
): Promise<{ lex: CatalogLexical; filter: string; tooBroad: boolean }> {
	const scope = await withFieldSearch(lex, filters);
	return { lex: scope.lex, filter: filterOf(scope.filters), tooBroad: scope.tooBroad };
}

/**
 * ODER ohne Thema (queryCatalog): eine Seite der Vereinigung, auf Wunsch mit den Facetten der
 * ganzen Vereinigung, nach Relevanz oder – Sortierung je Zweig – nach Datum (catalogUnion.ts).
 * Meili markiert in jedem Treffer nur den Begriff seines Zweigs, die übrigen markiert
 * markUnionTerms nach (Suchseite, `highlight`).
 */
async function unionQuery(
	lex: CatalogUnion,
	query: Pick<CatalogQuery, "sort" | "offset" | "limit" | "facets" | "highlight">,
	filters: CatalogFilters,
): Promise<{ hits: CatalogUnitRaw[]; total: number; processingTimeMs: number; facets: CatalogFacetCounts }> {
	const rules = catalogSortRules(query.sort, lex);
	const facets = query.facets === true ? FACETS : query.facets ? [...query.facets] : null;
	const window = { offset: query.offset, limit: query.limit, ...(facets ? unionFacets(MEILI_CATALOG_INDEX, facets, FACET_VALUES_MAX) : {}) };
	const perBranch = { ...formatOptions(lex, query.highlight === true), ...(rules ? { sort: rules } : {}) };
	// Die Föderation formatiert jeden Treffer bis zum Offset, in jeder Meili-Version: tiefe
	// Seiten zweistufig (deepPage.ts), die Seite formatiert der Zweig, der sie liefert.
	const res = isDeepPage(query.offset, query.limit)
		? await searchDeepPage<CatalogUnitRaw, FederatedResult>({
				ids: () => federate(lex, filterOf(filters), window, idsOnly(perBranch)),
				format: (ids) => federate(lex, idInClause(ids), { offset: 0, limit: ids.length }, perBranch),
			})
		: await federate(lex, filterOf(filters), window, perBranch);
	const hits = shownHits(res.hits, lex);
	return {
		hits: query.highlight ? markUnionTerms(hits, lex.highlight, { recrop: false, cropLength: CROP_LENGTH }) : hits,
		total: res.estimatedTotalHits ?? res.hits.length,
		processingTimeMs: res.processingTimeMs ?? 0,
		facets: facetCounts(res.facetDistribution),
	};
}

/**
 * Facetten der Treffermenge aus Suchbegriff bzw. ODER-Begriffen (Vereinigung, gemergt) und
 * Filter, bis FACET_VALUES_MAX Werte je Facette, die häufigsten (Index-Einstellung `count`).
 * Vorschläge der Namensfelder (catalogRegister.ts).
 */
export async function catalogFacetDistribution(
	lex: CatalogLexical,
	filter: string,
	facets: string[],
): Promise<Record<string, Record<string, number>>> {
	const res = isCatalogUnion(lex)
		? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_CATALOG_INDEX, facets, FACET_VALUES_MAX) })
		: await index().search(lex.q, { filter, limit: 0, facets, ...lexicalOptions(lex) });
	return (res.facetDistribution ?? {}) as Record<string, Record<string, number>>;
}

/**
 * Trefferzahlen der Treffermenge aus Suchbegriff bzw. ODER-Begriffen je Filter: ohne ODER eine
 * multiSearch für alle, mit ODER je Filter eine Föderation (sie zählt die Vereinigung
 * dedupliziert; mehrere Föderationen kennt eine Anfrage nicht). Nachzählung seltener Namen
 * (catalogRegister.ts).
 */
export async function countCatalogSets(lex: CatalogLexical, filters: readonly string[]): Promise<number[]> {
	if (filters.length === 0) return [];
	if (isCatalogUnion(lex)) {
		const res = await Promise.all(filters.map((filter) => federate(lex, filter, { offset: 0, limit: 0 })));
		return res.map((r) => r.estimatedTotalHits ?? 0);
	}
	const res = await client.multiSearch({
		queries: filters.map((filter) => ({ indexUid: MEILI_CATALOG_INDEX, q: lex.q, filter, limit: 0, ...lexicalOptions(lex) })),
	});
	return res.results.map((r) => r.estimatedTotalHits ?? 0);
}

/** Alle Verzeichnungseinheiten, auch die der Dokumente auf der Plattform (`onPlatform`), ohne
 *  Stufen nur aus Pfaden (`stub`, sie tragen kein `onPlatform`). Reiter, API und MCP zählen
 *  nur die eigenen Treffer (`countCatalog`). */
export async function countCatalogUnits(): Promise<number | null> {
	try {
		const res = await index().search("", { filter: "onPlatform EXISTS", limit: 0 });
		return res.estimatedTotalHits ?? null;
	} catch {
		return null;
	}
}

/** Einzelne Einheit (auch eine ZS- oder RM-Einheit, keine Stufe nur aus Pfaden) für API
 *  und MCP; null, wenn sie fehlt oder der Index nicht lesbar ist. */
export async function getCatalogUnit(id: number): Promise<CatalogUnitRaw | null> {
	try {
		const unit = (await index().getDocument(id, { fields: RETRIEVE })) as unknown as CatalogUnitRaw;
		return unit.stub ? null : unit;
	} catch {
		return null;
	}
}

/** Einheit oder Archivplan-Stufe mit allen angezeigten Feldern (Detailseite). */
export async function getCatalogDetail(id: number): Promise<CatalogUnitDetailRaw | null> {
	try {
		return (await index().getDocument(id, { fields: DETAIL_FIELDS })) as unknown as CatalogUnitDetailRaw;
	} catch {
		return null;
	}
}

function toTreeNode(h: CatalogUnitRaw & { childCount?: number }): CatalogTreeNode {
	return {
		id: h.id,
		signature: h.signature ?? "",
		title: h.title ?? "",
		level: h.level ?? "",
		dateText: h.dateText ?? "",
		childCount: h.childCount ?? 0,
		stub: h.stub === true,
		hasDigitization: !!h.hasDigitization,
		// Nur Einheiten, die das Dokument abbilden; ein Verweis (Urkunde → RRB) steht auf ihrer Seite.
		doc: platformDoc(h),
	};
}

/**
 * Untereinheiten in der Reihenfolge des Archivplans (`sigSort`), auch Plattform-Einheiten
 * und Stufen aus Pfaden. null, solange der Index den Baum nicht trägt (`parentId` erst
 * mit dem Neuaufbau filterbar).
 */
export async function getCatalogChildren(parentId: number, offset: number, limit: number): Promise<CatalogChildren | null> {
	try {
		const res = await index().search("", {
			filter: `parentId = ${Math.trunc(parentId)}`,
			sort: ["sigSort:asc"],
			offset,
			limit,
			attributesToRetrieve: NODE_FIELDS,
		});
		return { total: res.estimatedTotalHits ?? res.hits.length, items: (res.hits as unknown as CatalogUnitRaw[]).map(toTreeNode) };
	} catch (err) {
		console.warn(`[catalog] Untereinheiten von ${parentId} nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

const treeStarts = createTtlLruCache<CatalogTreeStart>({ maxEntries: 1, ttlMs: 10 * 60_000 });

/**
 * Startansicht des Reiters ohne Suche und Filter (catalogShowsTree): die Stufen unter der
 * Wurzel (Hauptabteilungen) mit ihren Untereinheiten, 10 min gecacht – ändert sich nur mit
 * einem Import. null bei Fehler (der Reiter zeigt dann die Liste).
 */
export async function getCatalogTreeStart(): Promise<CatalogTreeStart | null> {
	const cached = treeStarts.get("root");
	if (cached) return cached;
	const root = await getCatalogChildren(CATALOG_ROOT_ID, 0, CATALOG_TREE_PAGE);
	if (!root) return null;
	const subs = await Promise.all(
		root.items.filter((n) => n.childCount > 0).map(async (n) => [n.id, await getCatalogChildren(n.id, 0, CATALOG_TREE_PAGE)] as const),
	);
	const open: Record<number, CatalogChildren> = {};
	for (const [id, sub] of subs) if (sub) open[id] = sub;
	const start = { root, open };
	treeStarts.set("root", start);
	return start;
}

/**
 * Vorige und nächste Einheit derselben Stufe (Position `sigPos`, gleiche Reihenfolge wie
 * `getCatalogChildren`) und die Zahl der Geschwister. Nur für Einheiten mit `sigPos`
 * (Index ab dem Neuaufbau mit Position); null bei einem Fehler.
 */
export async function getCatalogNeighbors(parentId: number, pos: number): Promise<CatalogNeighbors | null> {
	const parent = Math.trunc(parentId);
	try {
		const [near, all] = await Promise.all([
			index().search("", {
				filter: `parentId = ${parent} AND sigPos IN [${pos - 1}, ${pos + 1}]`,
				limit: 2,
				attributesToRetrieve: [...NODE_FIELDS, "sigPos"],
			}),
			index().search("", { filter: `parentId = ${parent}`, limit: 0 }),
		]);
		const hits = near.hits as unknown as Array<CatalogUnitRaw & { childCount?: number; sigPos?: number }>;
		const at = (p: number) => {
			const hit = hits.find((h) => h.sigPos === p);
			return hit ? toTreeNode(hit) : null;
		};
		return { prev: at(pos - 1), next: at(pos + 1), pos, total: all.estimatedTotalHits ?? 0 };
	} catch (err) {
		console.warn(`[catalog] Nachbarn von Position ${pos} unter ${parentId} nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

/** Welche dieser IDs liegen im Index (interne Verweise auf Pfad und verwandte Einheiten)? */
export async function existingCatalogIds(ids: readonly number[]): Promise<Set<number>> {
	const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
	if (unique.length === 0) return new Set();
	try {
		const res = await index().search("", {
			filter: `id IN [${unique.join(", ")}]`,
			limit: unique.length,
			attributesToRetrieve: ["id"],
		});
		return new Set((res.hits as Array<{ id: number }>).map((h) => h.id));
	} catch {
		return new Set();
	}
}

/**
 * Zeitleiste des Reiters: Anfangs- und Endjahre der Treffer ohne Zeitraumfilter (die
 * Zeitleiste zeigt den gewählten Zeitraum im Umfeld), dazu die Treffer ohne Datum – ohne
 * Stufenwahl nur die der unteren Stufen (catalogTimelineLevels); mit
 * ODER-Begriffen die der ganzen Vereinigung, mit Feldsuche ohne Zeitraum aufgelöst. Meili
 * zählt Facetten bis `maxValuesPerFacet` (2'000, services/catalog/src/settings.ts). null bei
 * Fehler oder zu breiter Feldsuche.
 */
export async function catalogTimeline(searchLex: CatalogLexical, filters: CatalogFilters): Promise<CatalogTimeline | null> {
	try {
		const scope = await withFieldSearch(searchLex, {
			...filters,
			dateFrom: null,
			dateTo: null,
			level: catalogTimelineLevels(filters.level),
		});
		if (scope.tooBroad) return null;
		const lex = scope.lex;
		const filter = filterOf(scope.filters);
		const undatedFilter = `${filter} AND dateFrom IS NULL`;
		const [dist, undated] = isCatalogUnion(lex)
			? await Promise.all([
					federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_CATALOG_INDEX, ["dateFrom", "dateTo"], FACET_VALUES_MAX) }),
					federate(lex, undatedFilter, { offset: 0, limit: 0 }),
				])
			: await Promise.all([
					index().search(lex.q, { filter, limit: 0, facets: ["dateFrom", "dateTo"], ...lexicalOptions(lex) }),
					index().search(lex.q, { filter: undatedFilter, limit: 0, ...lexicalOptions(lex) }),
				]);
		const fd = (dist.facetDistribution ?? {}) as Record<string, Record<string, number>>;
		const stats = (dist.facetStats ?? {}) as Record<string, { min: number; max: number }>;
		return {
			from: fd.dateFrom ?? {},
			to: fd.dateTo ?? {},
			min: stats.dateFrom?.min ?? null,
			max: stats.dateTo?.max ?? null,
			undated: undated.estimatedTotalHits ?? 0,
		};
	} catch (err) {
		console.warn(`[catalog] Zeitleiste nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

/**
 * Stufen-Facette ohne die eigene Stufenwahl (Drill-Sideways): Sonst zeigte die Filterspalte nach
 * einer Wahl – etwa der unteren Stufen, die ein Klick in die Zeitleiste setzt – nur noch die
 * gewählten Stufen, und obere liessen sich erst nach dem Abwählen dazunehmen. Ohne Stufenwahl
 * null (die Facette der Liste gilt); bei Fehler oder zu breiter Feldsuche ebenso.
 */
async function levelFacetSideways(searchLex: CatalogLexical, filters: CatalogFilters): Promise<Record<string, number> | null> {
	if (filters.level.length === 0) return null;
	try {
		const scope = await withFieldSearch(searchLex, { ...filters, level: [] });
		if (scope.tooBroad) return null;
		const lex = scope.lex;
		const filter = filterOf(scope.filters);
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_CATALOG_INDEX, ["level"], FACET_VALUES_MAX) })
			: await index().search(lex.q, { filter, limit: 0, facets: ["level"], ...lexicalOptions(lex) });
		return ((res.facetDistribution ?? {}) as Record<string, Record<string, number>>).level ?? {};
	} catch (err) {
		console.warn(`[catalog] Stufen-Facette nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

/** Facetten mit der Stufen-Facette ohne die eigene Stufenwahl (levelFacetSideways). */
function withLevelSideways(facets: CatalogFacetCounts, sideways: Record<string, number> | null): CatalogFacetCounts {
	return sideways ? { ...facets, level: sideways } : facets;
}

/** Das Plattform-Dokument, das die Einheit abbildet. */
function platformDoc(h: Pick<CatalogUnitRaw, "onPlatform" | "docId" | "docSeries">): { series: string; id: string } | null {
	return h.onPlatform === true && h.docId && h.docSeries ? { series: h.docSeries, id: h.docId } : null;
}

function toHit(h: RawHit): CatalogHit {
	const parent = h.path && h.path.length > 0 ? h.path[h.path.length - 1].label : null;
	return {
		id: h.id,
		signature: h.signature,
		titleHtml: sanitizeMarks(h._formatted?.title ?? h.title),
		textHtml: h.text ? sanitizeMarks(h._formatted?.text ?? h.text) : "",
		level: h.level,
		dateText: h.dateText,
		bestand: h.bestand,
		parent: parent && parent !== h.bestand ? parent : null,
		hasDigitization: h.hasDigitization,
		files: digitalLinks(h.files ?? []),
		fileCount: h.fileCount ?? h.files?.length ?? 0,
		url: h.url,
		doc: platformDoc(h),
	};
}

/** Gewicht des Vektor-Arms der Thema-Reihung, wie in der Dokumentsuche (parseSearchParams). */
const THEME_SEMANTIC_RATIO = 0.7;

/** Suchbegriff, ODER-Begriffe und «nur im Titel» teilt der Reiter mit der Dokumentsuche
 *  (catalogLexical: ein einzelner ODER-Begriff gilt als Suchbegriff, «nur im Titel» wirkt nur
 *  mit Suchbegriff oder ODER-Begriffen und dann auf beide). */
type CatalogPageParams = Pick<SearchParams, "q" | "anyTerms" | "sort" | "page" | "pageSize" | "theme" | "topK" | "titleOnly">;

/** Thema-Pfade: Auszug um die erste Fundstelle der ODER-Begriffe bzw. des Suchbegriffs neu
 *  schneiden (markUnionTerms). */
const RECROP = { recrop: true, cropLength: CROP_LENGTH };

/**
 * Eine Seite des Reiters. Wörter der Feldsuche, die Meili nicht selbst hervorhebt (`scope.marks`),
 * markiert der Server nach; durchsucht die Abfrage den Text nicht (Feldbedingung bzw. «nur im
 * Titel»), schneidet er den Auszug um sie neu.
 */
function pageResult(
	params: CatalogPageParams,
	page: { hits: RawHit[]; total: number; ms: number; facets: CatalogFacetCounts; timeline: CatalogTimeline | null; scope?: FieldScope },
	extra: Pick<CatalogResult, "theme" | "themeWithoutVectors" | "fieldsTooBroad" | "browseLimit"> = {},
): CatalogResult {
	const searchOn = page.scope?.lex.searchOn;
	const hits = page.scope
		? markFieldTerms(page.hits, page.scope.marks, { recrop: !!searchOn && !searchOn.includes("text"), cropLength: CROP_LENGTH })
		: page.hits;
	return {
		hits: hits.map(toHit),
		total: page.total,
		processingTimeMs: page.ms,
		page: params.page,
		pageSize: params.pageSize,
		facets: page.facets,
		timeline: page.timeline,
		...extra,
	};
}

/** Feldsuche zu breit (withFieldSearch): keine Treffer, der Reiter erklärt es. */
function tooBroadPage(params: CatalogPageParams, timeline: CatalogTimeline | null): CatalogResult {
	return pageResult(params, { hits: [], total: 0, ms: 0, facets: facetCounts(undefined), timeline }, { fieldsTooBroad: true });
}

/**
 * Reiter «Archivkatalog» der Suchseite: eine Seite mit Hervorhebungen und Facetten. Mit
 * Thema wie die Dokumentsuche (catalogThemeMode): bei Relevanz reiht es die Treffermenge,
 * bei Datums-Sortierung wählt es die K ähnlichsten. `semantic` = Embed-Service gesund und
 * Index mit Vektoren (catalogHasVectors); Embed-Fehler ⇒ ohne Thema. ODER-Begriffe bilden
 * die Treffermenge als Vereinigung (catalogUnion.ts): ohne Thema eine föderierte Suche, mit
 * Thema deren Reihenfolge (themeOrder.ts).
 */
export function searchCatalog(
	params: CatalogPageParams,
	filters: CatalogFilters,
	opts: { semantic?: boolean; overview?: boolean } = {},
): Promise<CatalogResult> {
	return folding.withFallback(() => tabPage(params, filters, opts));
}

async function tabPage(
	params: CatalogPageParams,
	filters: CatalogFilters,
	opts: { semantic?: boolean; overview?: boolean },
): Promise<CatalogResult> {
	// overview: Block im Reiter «Alle Quellen» – ohne Zeitleiste und Drill-Sideways der
	// Stufen-Facette (beides eigene Abfragen), die Liste selbst wie im Reiter.
	const overview = opts.overview === true;
	const mode = catalogThemeMode(params, opts.semantic === true);
	const vector = mode === "none" ? null : await embedQuery(params.theme.trim());
	if (mode === "none" || !vector) return lexicalPage(params, filters, {}, overview);
	try {
		return mode === "rank"
			? await themeRankedPage(params, filters, vector, overview)
			: await themeTopKPage(params, filters, vector, overview);
	} catch (err) {
		// z. B. ein Index ohne Embedder (älterer Aufbau): Liste ohne Thema statt Fehlerseite.
		console.warn(`[catalog] Thema-Suche gescheitert, Liste ohne Thema: ${(err as Error).message}`);
		return lexicalPage(params, filters, {}, overview);
	}
}

/** Liste ohne Thema, bis zum Deckel fürs Blättern (browseLimit.ts; dahinter nur Zahlen und Facetten). */
async function lexicalPage(
	params: CatalogPageParams,
	filters: CatalogFilters,
	extra: Pick<CatalogResult, "themeWithoutVectors"> = {},
	overview = false,
): Promise<CatalogResult> {
	const searchLex = lexicalOf(params);
	const window = browseWindow(params);
	// Die Zeitleiste löst die Feldsuche ohne Zeitraum selbst auf und läuft daneben.
	const timeline = overview ? Promise.resolve<CatalogTimeline | null>(null) : catalogTimeline(searchLex, filters);
	const levels = overview ? Promise.resolve<Record<string, number> | null>(null) : levelFacetSideways(searchLex, filters);
	const scope = await withFieldSearch(searchLex, filters);
	if (scope.tooBroad) return tooBroadPage(params, await timeline);
	const lex = scope.lex;
	const [res, tl, sideways] = await Promise.all([
		runQuery(lex, { sort: params.sort, ...window, facets: TAB_FACETS, highlight: true }, scope.filters),
		timeline,
		levels,
	]);
	const facets = withLevelSideways(res.facets, sideways);
	return pageResult(
		params,
		{ hits: res.hits, total: res.total, ms: res.processingTimeMs, facets, timeline: tl, scope },
		{ ...extra, ...browseLimitOf(res.total) },
	);
}

/** Kennungen der Treffer des Suchbegriffs bzw. der ODER-Begriffe (ohne beide alle Einheiten des Filters). */
async function lexicalUnits(lex: CatalogLexical, filter: string, limit: number, facets?: string[]): Promise<FederatedResult> {
	const retrieve = { attributesToRetrieve: ["id"] };
	if (isCatalogUnion(lex)) {
		return federate(
			lex,
			filter,
			{ offset: 0, limit, ...(facets ? unionFacets(MEILI_CATALOG_INDEX, facets, FACET_VALUES_MAX) : {}) },
			retrieve,
		);
	}
	return (await index().search(lex.q, { filter, limit, facets, ...retrieve, ...lexicalOptions(lex) })) as unknown as FederatedResult;
}

/** Grösse der Menge, die ein Thema reiht (ohne Suchbegriff alle Einheiten der Filter, sonst die
 *  Treffer des Suchbegriffs bzw. der ODER-Begriffe), mit ihren Facetten. */
async function themeTotals(lex: CatalogLexical, filter: string, withFacets: boolean): Promise<{ total: number; facets: CatalogFacetCounts }> {
	const all = await lexicalUnits(lex, filter, 0, withFacets ? TAB_FACETS : undefined);
	return { total: all.estimatedTotalHits ?? 0, facets: facetCounts(all.facetDistribution) };
}

/** Wie viele davon einen Vektor tragen (0 ⇒ das Thema reiht nichts), mit Wort auch je Anfangsjahr. */
async function embeddedHits(lex: CatalogLexical, filter: string): Promise<EmbeddedHits> {
	const word = lex.q !== "" || isCatalogUnion(lex);
	const res = await lexicalUnits(lex, `${filter} AND ${EMBEDDED}`, 0, word ? ["dateFrom"] : undefined);
	const years = (res.facetDistribution as Record<string, Record<string, number>> | undefined)?.dateFrom;
	return { count: res.estimatedTotalHits ?? 0, ...(years ? { years } : {}) };
}

interface EmbeddedHits {
	count: number;
	years?: Record<string, number>;
}

/** Einheiten mit Vektor. */
const EMBEDDED = "embedded = true";

/** So viele Föderationen gleichzeitig (Kennungen der ODER-Begriffe). */
const UNION_SLICES_AT_ONCE = 8;
/** So viele Kennungen holt die gewöhnliche Suche höchstens (kalt liest sie jede Einheit). */
const SEARCH_IDS_MAX = 20_000;

/** Reihenfolgen der Themen, fünf Minuten aufgehoben (Folgeseiten, Sortierwechsel). */
const themeOrders = createTtlLruCache<Promise<ThemeOrder<number> | null>>({ maxEntries: 100, ttlMs: 5 * 60_000 });

/** Reihenfolge eines Themas (themeOrder.ts): zuerst die Einheiten mit Vektor nach Ähnlichkeit, dann
 *  die übrigen (mit Suchbegriff bzw. ODER-Begriffen in deren Reihenfolge). */
function themeOrderOf(lex: CatalogLexical, vector: number[], filter: string, embedded: EmbeddedHits, need: number): Promise<ThemeOrder<number>> {
	const withVectors = embedded.count;
	const idsOf = (res: FederatedResult) => (res.hits as Array<{ id: number }>).map((h) => h.id);
	// Alle Treffer mit Vektor über die Facette `id`, in Scheiben nach Anfangsjahren (hitIds.ts).
	const byFacet = async (slices: YearSlice[]): Promise<number[]> => {
		const filterOf = (s: YearSlice) => `${filter} AND ${EMBEDDED} AND ${sliceClause(s, "dateFrom")}`;
		const keys = (fd: unknown) => Object.keys((fd as Record<string, Record<string, number>> | undefined)?.id ?? {}).map(Number);
		if (!isCatalogUnion(lex)) {
			const res = await client.multiSearch({
				queries: slices.map((s) => ({ indexUid: MEILI_CATALOG_INDEX, q: lex.q, limit: 0, filter: filterOf(s), facets: ["id"], ...lexicalOptions(lex) })),
			});
			return res.results.flatMap((r) => keys(r.facetDistribution));
		}
		const out: number[] = [];
		for (let i = 0; i < slices.length; i += UNION_SLICES_AT_ONCE) {
			const parts = await Promise.all(
				slices.slice(i, i + UNION_SLICES_AT_ONCE).map((s) =>
					federate(lex, filterOf(s), { offset: 0, limit: 0, ...unionFacets(MEILI_CATALOG_INDEX, ["id"], FACET_VALUES_MAX) }),
				),
			);
			for (const p of parts) out.push(...keys(p.facetDistribution));
		}
		return out;
	};
	const allIds = (): Promise<number[] | null> => {
		if (!embedded.years) return Promise.resolve(null);
		const dated = Object.values(embedded.years).reduce((a, n) => a + n, 0);
		return collectHitIds(yearSlices(embedded.years, Math.max(0, withVectors - dated), FACET_VALUES_MAX), FACET_VALUES_MAX, withVectors, {
			byFacet,
			bySearch: async (s) => idsOf(await lexicalUnits(lex, `${filter} AND ${EMBEDDED} AND ${sliceClause(s, "dateFrom")}`, s.count)),
		});
	};
	let cutShort = false;
	const nearest = async (k: number, within?: readonly number[]): Promise<Ranked<number>[]> => {
		const { result, cut } = await searchTwice(
			async () =>
				(await index().search("", {
					vector,
					hybrid: { embedder: "jina_de", semanticRatio: 1 },
					filter: idFilter(`${filter} AND ${EMBEDDED}`, within ?? null),
					limit: k,
					attributesToRetrieve: ["id"],
					showRankingScore: true,
				})) as unknown as { hits: RawHit[]; processingTimeMs?: number },
			"catalog",
		);
		if (cut) cutShort = true;
		return rankedHits(result.hits).map((h) => ({ id: h.id, score: h._rankingScore ?? 0 }));
	};
	const rest = async (limit: number): Promise<Ranked<number>[]> =>
		idsOf(await lexicalUnits(lex, `${filter} AND NOT ${EMBEDDED}`, limit)).map((id) => ({ id, score: 0 }));
	const extend = (prev: ThemeOrder<number> | null) =>
		!lex.q && !isCatalogUnion(lex)
			? themeOrderAlone(prev, need, { max: THEME_LIST_MAX, narrow: withVectors <= embeddedTotal / 2 }, { nearest, rest })
			: themeOrderWithin(prev, need, { withVectors, max: THEME_LIST_MAX }, {
					nearest,
					rest,
					match: async (ids) => (ids.length === 0 ? [] : idsOf(await lexicalUnits(lex, idFilter(filter, ids), ids.length))),
					candidates: async (limit) =>
						(limit >= withVectors && (await allIds())) ||
						idsOf(await lexicalUnits(lex, `${filter} AND ${EMBEDDED}`, Math.min(limit, SEARCH_IDS_MAX))),
				});
	const key = createHash("sha1")
		.update(Float64Array.from(vector))
		.update(JSON.stringify([filter, lex.q, lex.terms, lexicalSearchOn(lex) ?? null]))
		.digest("base64");
	return cachedOrder(themeOrders, key, extend, () => !cutShort);
}

type Window = { offset: number; limit: number };

const idFilter = (filter: string, ids: readonly number[] | null) => (ids ? `${filter} AND id IN [${ids.join(", ")}]` : filter);

/** Ein Fenster der Thema-Reihenfolge, formatiert: Der Suchbegriff wird hervorgehoben und bestimmt den
 *  Auszug (bei ODER nur der Teil, der an jedem Zweig hängt). */
async function themeWindow(lex: CatalogLexical, vector: number[], filter: string, embedded: EmbeddedHits, window: Window): Promise<RawHit[]> {
	if (window.limit <= 0) return [];
	const end = window.offset + window.limit;
	const order = await themeOrderOf(lex, vector, filter, embedded, end);
	return formatRanked(lex, vector, order.hits.slice(window.offset, end));
}

async function formatRanked(lex: CatalogLexical, vector: number[], ranked: Ranked<number>[]): Promise<RawHit[]> {
	if (ranked.length === 0) return [];
	const page = (await index().search(lex.q, {
		vector,
		hybrid: { embedder: "jina_de", semanticRatio: THEME_SEMANTIC_RATIO },
		filter: idInClause(ranked.map((r) => r.id)),
		limit: ranked.length,
		...formatOptions(lex, lex.q !== ""),
		...(lex.q ? lexicalOptions(lex) : {}),
	})) as unknown as { hits: RawHit[] };
	return inPageOrder(
		ranked.map(({ id, score }) => ({ id, _rankingScore: score })),
		shownHits(page.hits, lex),
	);
}

/** Thema + Relevanz: die Treffermenge nach Ähnlichkeit gereiht; Facetten und
 *  Zeitleiste zählen die ganze Menge wie ohne Thema. */
async function themeRankedPage(params: CatalogPageParams, filters: CatalogFilters, vector: number[], overview = false): Promise<CatalogResult> {
	const started = Date.now();
	const searchLex = lexicalOf(params);
	const timelineRun = overview ? Promise.resolve<CatalogTimeline | null>(null) : catalogTimeline(searchLex, filters);
	const levelsRun = overview ? Promise.resolve<Record<string, number> | null>(null) : levelFacetSideways(searchLex, filters);
	const scope = await withFieldSearch(searchLex, filters);
	if (scope.tooBroad) return tooBroadPage(params, await timelineRun);
	const lex = scope.lex;
	const filter = filterOf(scope.filters);
	const offset = (params.page - 1) * params.pageSize;
	const ranked = async () => {
		const embedded = await embeddedHits(lex, filter);
		const window = { offset, limit: embedded.count === 0 ? 0 : Math.min(params.pageSize, THEME_LIST_MAX - offset) };
		return { withVectors: embedded.count, raw: await themeWindow(lex, vector, filter, embedded, window) };
	};
	const [{ withVectors, raw }, set, timeline, sideways] = await Promise.all([
		ranked(),
		themeTotals(lex, filter, true),
		timelineRun,
		levelsRun,
	]);
	if (withVectors === 0) return lexicalPage(params, filters, { themeWithoutVectors: set.total > 0 }, overview);
	const pool = Math.min(set.total, THEME_LIST_MAX);
	const hits = markUnionTerms(raw, lex.highlight, RECROP);
	return pageResult(
		params,
		{ hits, total: set.total, ms: Date.now() - started, facets: withLevelSideways(set.facets, sideways), timeline, scope },
		{ theme: { mode: "rank", ...(set.total > pool ? { rankedPool: pool } : {}) } },
	);
}

/** Thema + Datums-Sortierung: die K ähnlichsten der Treffermenge, nach Datum sortiert;
 *  Facetten und Zeitleiste zählen diese K (die Zeitleiste ohne Stufenwahl nur die unteren) –
 *  ausser bei gewählten Stufen die Stufen-Facette: sie zählt die ganze Treffermenge ohne die
 *  Stufenwahl (levelFacetSideways), sonst stünden die übrigen Stufen nicht zur Wahl. */
async function themeTopKPage(params: CatalogPageParams, filters: CatalogFilters, vector: number[], overview = false): Promise<CatalogResult> {
	const started = Date.now();
	const searchLex = lexicalOf(params);
	const levelsRun = overview ? Promise.resolve<Record<string, number> | null>(null) : levelFacetSideways(searchLex, filters);
	const scope = await withFieldSearch(searchLex, filters);
	if (scope.tooBroad) return tooBroadPage(params, null);
	const lex = scope.lex;
	const filter = filterOf(scope.filters);
	const k = params.topK ?? DEFAULT_TOPK;
	const [set, embedded] = await Promise.all([themeTotals(lex, filter, false), embeddedHits(lex, filter)]);
	if (embedded.count === 0) return lexicalPage(params, filters, { themeWithoutVectors: set.total > 0 }, overview);
	const order = await themeOrderOf(lex, vector, filter, embedded, k);
	// Einheiten ohne Vektor sind nicht ähnlich, ausser sie tragen den Suchbegriff.
	const nearest = await formatRanked(lex, vector, order.hits.slice(0, lex.q ? k : Math.min(k, order.ranked)));
	const sorted = sortByCatalogDate(nearest, params.sort === "date_desc" ? "date_desc" : "date_asc");
	const timelineLevels = new Set(catalogTimelineLevels(filters.level));
	const sideways = await levelsRun;
	const offset = (params.page - 1) * params.pageSize;
	return pageResult(
		params,
		{
			hits: markUnionTerms(sorted.slice(offset, offset + params.pageSize), lex.highlight, RECROP),
			total: sorted.length,
			ms: Date.now() - started,
			facets: withLevelSideways(catalogFacetsOf(sorted), sideways),
			timeline: catalogTimelineOf(sorted.filter((h) => timelineLevels.has(h.level))),
			scope,
		},
		{ theme: { mode: "topK", topK: k, topKOfTotal: set.total } },
	);
}

/**
 * MCP-Werkzeug catalog_search mit `semantic`: die `limit` Einheiten, die dem Thema am
 * nächsten sind, gereiht wie das Thema im Reiter (themeWindow): Ein Suchbegriff
 * bzw. ODER-Begriffe bilden die Menge (im Katalog-Reiter die des Nutzers), ohne beide alle
 * Einheiten der Filter. Nur Einheiten mit Vektor –
 * Personendossiers, Ehedaten und Firmen erreicht nur die wörtliche Suche. `withVectors` =
 * Einheiten mit Vektor in der Menge (0 ⇒ keine Vektorsuche, keine Treffer). Die Feldsuche der
 * Auswahl grenzt die Menge ein wie im Reiter (withFieldSearch).
 */
export function nearestCatalogUnits(
	query: { q: string; anyTerms?: readonly string[]; theme: string; vector: number[]; limit: number; attributesToSearchOn?: string[] },
	filters: CatalogFilters,
): Promise<{ hits: CatalogUnitRaw[]; withVectors: number }> {
	return folding.withFallback(async () => {
		const searchLex = lexicalOf({ q: query.q, anyTerms: query.anyTerms, titleOnly: query.attributesToSearchOn?.includes("title") === true });
		const scope = await withFieldSearch(searchLex, filters);
		if (scope.tooBroad) return { hits: [], withVectors: 0 };
		const lex = scope.lex;
		const filter = filterOf(scope.filters);
		const embedded = await embeddedHits(lex, filter);
		if (embedded.count === 0) return { hits: [], withVectors: 0 };
		// Nicht über die Einheiten mit Vektor hinaus: themeWindow hängte sonst die übrigen an.
		const window = { offset: 0, limit: Math.min(query.limit, embedded.count) };
		return { hits: await themeWindow(lex, query.vector, filter, embedded, window), withVectors: embedded.count };
	});
}

/** Facettenverteilung der Bestände je Auswahl, 5 Minuten aufgehoben (Tippen im Feld «Bestand»). */
const bestandDists = createTtlLruCache<Record<string, number>>({ maxEntries: 100, ttlMs: 5 * 60_000 });

/**
 * Vorschläge für das Feld «Bestand» der Feldsuche: die Bestände der aktuellen Treffermenge
 * (Suchbegriff, ODER-Begriffe, Feldsuche, Zeitraum und Filter) ohne die Bestandswahl selbst
 * (Drill-Sideways wie die Namensfelder), passend zur Eingabe (bestandSuggestions). Die Facette
 * zählt bis 2'000 Bestände (Index-Einstellung `maxValuesPerFacet`, Prod 2026-10-30: 1'512).
 */
export function catalogBestandSuggestions(
	params: Pick<SearchParams, "q" | "anyTerms" | "titleOnly">,
	filters: CatalogFilters,
	fq: string,
): Promise<Array<{ value: string; count: number }>> {
	return folding.withFallback(async () => {
		const scope = await withFieldSearch(lexicalOf(params), { ...filters, bestand: [] });
		if (scope.tooBroad) return [];
		const lex = scope.lex;
		const filter = filterOf(scope.filters);
		const key = createHash("sha256").update(JSON.stringify([lex.q, lex.terms, lexicalSearchOn(lex) ?? null, filter])).digest("hex");
		let dist = bestandDists.get(key);
		if (!dist) {
			const res = isCatalogUnion(lex)
				? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_CATALOG_INDEX, ["bestand"], FACET_VALUES_MAX) })
				: await index().search(lex.q, { filter, limit: 0, facets: ["bestand"], ...lexicalOptions(lex) });
			dist = ((res.facetDistribution ?? {}) as Record<string, Record<string, number>>).bestand ?? {};
			bestandDists.set(key, dist);
		}
		return bestandSuggestions(dist, fq);
	});
}

/** Höchstens so lange warten die Dokument- und die Personenseite auf den Katalog (ms). */
const PAGE_BUDGET_MS = 1500;

/** `work` mit Zeitbudget: danach null, die Seite erscheint ohne Katalog. */
async function withinBudget<T>(what: string, work: Promise<T>): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			console.warn(`[catalog] ${what}: über ${PAGE_BUDGET_MS} ms, ohne Katalog`);
			resolve(null);
		}, PAGE_BUDGET_MS);
	});
	try {
		return await Promise.race([work, late]);
	} finally {
		clearTimeout(timer);
	}
}

type RefHit = CatalogUnitRaw;

function toUnitRef(h: RefHit): CatalogUnitRef {
	return {
		id: h.id,
		signature: h.signature ?? "",
		title: h.title ?? "",
		level: h.level ?? "",
		dateText: h.dateText ?? "",
		bestand: h.bestand ?? null,
		bestandId: h.bestand ? (h.path?.find((n) => n.label === h.bestand)?.id ?? null) : null,
		hasDigitization: !!h.hasDigitization,
	};
}

/**
 * Katalogeintrag eines Plattform-Dokuments (Reiter «Archivkatalog» der Dokumentseite): die
 * Einheit, die es abbildet (Zentrale Serien über `archiveId`, Ratsmanuale über `docId`), mit
 * Archivplan, und eigene Einheiten, die per Weblink darauf verweisen. Eine Abfrage plus der
 * Abgleich der Archivplan-Stufen. null, wenn der Index nicht lesbar ist, nichts trägt oder das
 * Zeitbudget überschritten ist – dann bleibt es beim Link in den Online-Katalog.
 */
export async function documentCatalog(doc: { id: string; archiveId?: number | null }): Promise<DocumentCatalog | null> {
	if (!(await catalogReady())) return null;
	return withinBudget(
		`Katalogeintrag von ${doc.id}`,
		(async (): Promise<DocumentCatalog | null> => {
			const res = await index().search("", {
				filter: documentCatalogFilter(doc),
				limit: DOCUMENT_REFERENCES_MAX + 5,
				attributesToRetrieve: REF_FIELDS,
			});
			const { unit, references } = pickDocumentCatalog(res.hits as unknown as RefHit[], doc);
			if (!unit && references.length === 0) return null;
			const path = unit ? catalogAncestors(unit.id, unit.path) : [];
			const known = path.length > 0 ? await existingCatalogIds(path.map((n) => n.id)) : new Set<number>();
			return {
				unit: unit ? { ...toUnitRef(unit), path } : null,
				known: [...known],
				references: references.map(toUnitRef),
			};
		})().catch((err) => {
			console.warn(`[catalog] Katalogeintrag von ${doc.id} nicht lesbar: ${(err as Error).message}`);
			return null;
		}),
	);
}

/**
 * Einheiten einer KRDB-Person (Personenseite, alle ihre IDs): gesichert (`krdbIds`) bzw.
 * Vorschläge gleichen Namens (`krdbNameIds`), nur eigene Treffer, chronologisch. Mit
 * `limit` 0 nur die Zahl. null, wenn der Index nicht lesbar ist oder die Felder (noch) nicht
 * filterbar sind.
 */
export async function personCatalogUnits(
	ids: readonly number[],
	kind: "secured" | "names",
	limit: number,
): Promise<{ total: number; units: CatalogUnitRef[] } | null> {
	if (!(await catalogReady())) return null;
	return withinBudget(
		`Einheiten der Person ${ids[0]}`,
		index()
			.search("", {
				filter: personCatalogFilter(ids, kind),
				sort: ["dateFrom:asc"],
				limit,
				attributesToRetrieve: REF_FIELDS,
			})
			.then((res) => ({ total: res.estimatedTotalHits ?? res.hits.length, units: (res.hits as unknown as RefHit[]).map(toUnitRef) }))
			.catch((err) => {
				console.warn(`[catalog] Einheiten der Person ${ids[0]} nicht lesbar: ${(err as Error).message}`);
				return null;
			}),
	);
}

/**
 * Trefferzahl für den Reiter-Titel in der Dokumentsuche, dieselbe Zahl wie im Katalog-Reiter:
 * Suchbegriff, ODER-Begriffe, Feldsuche und Katalog-Filter (die im Dokument-Reiter stehen
 * bleiben), ohne Suchbegriff und ODER-Begriffe alle eigenen Einheiten der Filter; mit Thema und
 * Datums-Sortierung höchstens die K ähnlichsten. null bei Fehler oder zu breiter Feldsuche.
 */
export async function countCatalog(
	params: Pick<SearchParams, "q" | "anyTerms" | "theme" | "sort" | "topK" | "titleOnly">,
	filters: CatalogFilters,
	opts: { semantic?: boolean } = {},
): Promise<number | null> {
	try {
		return await folding.withFallback(async () => {
			const scope = await withFieldSearch(lexicalOf(params), filters);
			if (scope.tooBroad) return null;
			const lex = scope.lex;
			const filter = filterOf(scope.filters);
			const res = isCatalogUnion(lex)
				? await federate(lex, filter, { offset: 0, limit: 0 })
				: await index().search(lex.q, { filter, limit: 0, ...lexicalOptions(lex) });
			const total = res.estimatedTotalHits ?? 0;
			return catalogThemeMode(params, opts.semantic === true) === "topK" ? Math.min(total, params.topK ?? DEFAULT_TOPK) : total;
		});
	} catch {
		return null;
	}
}
