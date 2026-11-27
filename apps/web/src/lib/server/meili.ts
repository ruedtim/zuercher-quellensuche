import { createHash } from "node:crypto";
import { MeiliSearchApiError } from "meilisearch";
import { MEILI_URL, MEILI_SEARCH_KEY, MEILI_INDEX, MEILI_CHUNK_INDEX } from "./env";
import type { FacetDistribution, SearchHit, SearchParams, SearchResponse, SeriesAbbr } from "$lib/types";
import { CORPUS_CAP, DEFAULT_SEARCH, DEFAULT_TOPK, LEXICAL_ONLY_SERIES } from "$lib/types";
import { combineUnionQuery, exclusionsFirst, foldRmSharpS, foldSingleAnyTerm } from "$lib/searchParams";
import { fuzzyBranches, splitTiers, tierPlan, type TierPlan, type TierSlice } from "./tiers";
import { embedQuery } from "./embed";
import { markEntities, markTerms, cropAroundTerms } from "./highlight";
import { isDocumentId } from "$lib/documentId";
import { orNull } from "./meiliNotFound";
import { ENTITY_DIMS, documentEntityClause, variantFormsInHit } from "$lib/entityFilter";
import { resolutionIdCandidates } from "./resolutionId";
import { themeKeywords } from "./passageQuery";
import { collectHitIds, sliceClause, yearSlices, type YearSlice } from "./hitIds";
import { rankedHits, searchTwice, searchVectors, type VectorResult } from "./vectorCutoff";
import { createMeiliClient } from "./meiliClient";
import { dateWindowSort, searchByDateWindow, type DateSort } from "./dateWindow";
import { formatInGroups, idsOnly, inPageOrder, isDeepPage, pageOnly, searchDeepPage, wantsFormat, type PageHits, type PageId } from "./deepPage";
import {
	THEME_LIST_MAX,
	cachedOrder,
	themeOrderAlone,
	themeOrderWithin,
	vectorWindow,
	type Ranked,
	type ThemeOrder,
} from "./themeOrder";
import { createTtlLruCache } from "./ttlCache";

const client = createMeiliClient(MEILI_URL, MEILI_SEARCH_KEY);

// Default-Top-K, wenn der User im Semantic-Modus eine Datums-Sortierung
// wählt aber kein eigenes Limit gesetzt hat. Mit 100 sind die häufigsten
// Use-Cases ("die ähnlichsten Treffer, chronologisch") gut bedient ohne
// zu viel Speicher/Bandbreite für Re-Sort + Pagination zu brauchen.
const DEFAULT_AUTO_TOPK = 100;

export function getIndex() {
	return client.index(MEILI_INDEX);
}

let cachedEmbeddings: number | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

/** Zahl der Vektoren im documents-Index (0 = keine oder Stats nicht lesbar). */
async function embeddingCount(): Promise<number> {
	const now = Date.now();
	if (cachedEmbeddings !== null && now - cachedAt < CACHE_MS) return cachedEmbeddings;
	try {
		const stats = await getIndex().getStats();
		cachedEmbeddings = (stats as unknown as { numberOfEmbeddings?: number }).numberOfEmbeddings ?? 0;
	} catch {
		cachedEmbeddings = 0;
	}
	cachedAt = now;
	return cachedEmbeddings;
}

export async function indexHasEmbeddings(): Promise<boolean> {
	return (await embeddingCount()) > 0;
}

// Vergleichsschlüssel im documents-Index (personKeys/placeKeys/orgKeys, Fassung 2 von
// entityKey.ts; services/indexer schreibt sie, --patch-entity-keys rüstet nach). Ist ein
// Feld nicht filterbar, lehnt Meili jede Klausel darauf mit 400 ab – die Suchseite
// fiele in allen Reitern aus. Darum filtert buildFilter nur dann auch über die
// Schlüssel, wenn höchstens 10 % der Dokumente mit Namen (alle ausser RM) sie noch nicht
// tragen; gezählt wird diese Restmenge, nie nahe an maxTotalHits. 400 = nicht filterbar ⇒
// nicht bereit; andere Fehler (Netz, Neustart) lassen den letzten Stand stehen und
// fragen nach 5 s wieder. Synchron abfragbar (buildFilter ist synchron), nach 60 s im
// Hintergrund erneuert. Lehnt Meili trotzdem eine Schlüsselklausel ab (alter Indexer-Code
// hat die Settings ohne die Felder gepusht), schaltet withEntityKeyFallback sofort auf
// exakt und wiederholt die Abfrage einmal.
const KEYS_TTL_MS = 60_000;
const KEYS_RETRY_MS = 5_000;
const KEYS_MAX_MISSING = 0.1;
let keysReady = false;
let keysCheckedAt = 0;
let keysTtl = KEYS_TTL_MS;
let keysInFlight: Promise<boolean> | null = null;

/** Meili lehnt eine Klausel oder Facette auf einem Schlüsselfeld ab (nicht filterbar). */
export function isEntityKeyFilterError(err: unknown): boolean {
	if (!(err instanceof MeiliSearchApiError) || err.response?.status !== 400) return false;
	const code = (err.cause as { code?: string } | undefined)?.code;
	// Nur das Schlüsselfeld selbst: die Meldung zählt alle filterbaren Felder auf, darunter die
	// Schlüssel, auch wenn ein anderes Feld das Problem ist.
	return (
		(code === "invalid_search_filter" || code === "invalid_search_facets") &&
		/attribute `(?:personKeys|placeKeys|orgKeys)` is not filterable/i.test(err.message)
	);
}

/** true/false = bereit bzw. nicht; null = unbekannt (vorübergehender Fehler). */
async function probeEntityKeys(): Promise<boolean | null> {
	try {
		const [missing, stats] = await Promise.all([
			getIndex().search("", { limit: 0, filter: "NOT placeKeys EXISTS AND series != 'RM'" }),
			getIndex().getStats(),
		]);
		const total = stats.numberOfDocuments ?? 0;
		return total > 0 && (missing.estimatedTotalHits ?? 0) <= total * KEYS_MAX_MISSING;
	} catch (err) {
		return err instanceof MeiliSearchApiError && err.response?.status === 400 ? false : null;
	}
}

/** Trägt der documents-Index die Vergleichsschlüssel? (Probe höchstens alle 60 s.) */
export function entityKeysReady(): Promise<boolean> {
	if (Date.now() - keysCheckedAt < keysTtl) return Promise.resolve(keysReady);
	keysInFlight ??= probeEntityKeys().then((ready) => {
		if (ready !== null && ready !== keysReady) {
			console.log(`[meili] Vergleichsschlüssel im documents-Index: ${ready ? "bereit" : "nicht bereit"}`);
		}
		if (ready !== null) keysReady = ready;
		keysTtl = ready === null ? KEYS_RETRY_MS : KEYS_TTL_MS;
		keysCheckedAt = Date.now();
		keysInFlight = null;
		return keysReady;
	});
	return keysInFlight;
}

/** Letztes Ergebnis der Probe, ohne zu warten (stösst nach Ablauf eine neue an). */
export function entityKeysReadyNow(): boolean {
	void entityKeysReady();
	return keysReady;
}

// Suchtext-Stand des documents-Index (seit 2026-11-17, services/indexer searchText.ts): ß als
// ss im Text, der Titel zusätzlich gefaltet im Suchfeld `titleSearch`, und die Ranking-Regeln
// mit `exactness` vor `proximity`. Der Indexer setzt die Settings (ensureIndex) vor dem ersten
// geschriebenen Dokument; trägt also irgendein Dokument das Feld `titleSearch`
// (fieldDistribution, mit dem Such-Key lesbar), gelten auch die neuen Settings. Erst dann
// faltet die Web-App ß in Anfragen aller Serien, sucht «nur im Titel» auch in `titleSearch` und
// zieht in der Trefferliste die Grenze «ähnliche Schreibungen» (tiers.ts) – vorher bliebe ein
// `titleSearch` in attributesToSearchOn ein 400. Probe wie entityKeysReady: 60 s gecacht,
// Fehler lassen den letzten Stand stehen und fragen nach 5 s wieder.
let textReady = false;
let textCheckedAt = 0;
let textTtl = KEYS_TTL_MS;
let textInFlight: Promise<boolean> | null = null;

/** true/false = bereit bzw. nicht; null = unbekannt (vorübergehender Fehler). */
async function probeSearchText(): Promise<boolean | null> {
	try {
		const stats = await getIndex().getStats();
		return (stats.fieldDistribution?.titleSearch ?? 0) > 0;
	} catch {
		return null;
	}
}

/** Trägt der documents-Index den Suchtext-Stand (titleSearch, neue Settings)? */
export function searchTextReady(): Promise<boolean> {
	if (Date.now() - textCheckedAt < textTtl) return Promise.resolve(textReady);
	textInFlight ??= probeSearchText().then((ready) => {
		if (ready !== null && ready !== textReady) {
			console.log(`[meili] Suchtext ß→ss/titleSearch im documents-Index: ${ready ? "bereit" : "nicht bereit"}`);
		}
		if (ready !== null) textReady = ready;
		textTtl = ready === null ? KEYS_RETRY_MS : KEYS_TTL_MS;
		textCheckedAt = Date.now();
		textInFlight = null;
		return textReady;
	});
	return textInFlight;
}

/** Letztes Ergebnis, ohne zu warten (stösst nach Ablauf eine neue Probe an). */
export function searchTextReadyNow(): boolean {
	void searchTextReady();
	return textReady;
}

/** Felder von «nur im Titel» im documents-Index: der Titel, ab dem Suchtext-Stand auch titleSearch. */
export function docTitleFields(): string[] {
	return searchTextReadyNow() ? ["title", "titleSearch"] : ["title"];
}

/** Meili lehnt `titleSearch` in attributesToSearchOn ab (Feld noch nicht durchsuchbar). */
export function isTitleSearchError(err: unknown): boolean {
	return (
		err instanceof MeiliSearchApiError &&
		err.response?.status === 400 &&
		/attributes_to_search_on/i.test((err.cause as { code?: string } | undefined)?.code ?? "") &&
		/titleSearch/.test(err.message)
	);
}

/**
 * Führt `run` aus; lehnt Meili dabei `titleSearch` ab (alter Settings-Stand trotz Feld), gilt
 * der Suchtext-Stand als nicht bereit und `run` läuft einmal neu – dann nur mit `title`.
 */
export async function withSearchTextFallback<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (!isTitleSearchError(err)) throw err;
		if (textReady) console.warn("[meili] titleSearch nicht durchsuchbar – «nur im Titel» wieder nur über title");
		textReady = false;
		textCheckedAt = Date.now();
		textTtl = KEYS_TTL_MS;
		return run();
	}
}

/**
 * Führt `run` aus; lehnt Meili dabei eine Schlüsselklausel ab (Felder nicht mehr
 * filterbar), gelten die Namen ab sofort exakt und `run` läuft einmal neu – buildFilter
 * baut dann die Klauseln ohne Schlüssel.
 */
export async function withEntityKeyFallback<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (!isEntityKeyFilterError(err)) throw err;
		if (keysReady) console.warn("[meili] Vergleichsschlüssel nicht filterbar – Namensfilter wieder exakt");
		keysReady = false;
		keysCheckedAt = Date.now();
		keysTtl = KEYS_TTL_MS;
		return run();
	}
}

/**
 * Hauptsuche + Timeline-Buckets in einem Aufruf.
 *
 * Liefert sowohl die normale Treffer-Response (gefiltert nach allen Params)
 * als auch eine zweite, parallel berechnete Facet-Distribution, bei der
 * `dateFrom`/`dateTo` weggelassen sind. Damit zeigt der Zeitstrahl immer die
 * volle Spannweite (1803 bzw. mit Ratsmanualen 1484 bis heute, timelineAxis)
 * mit den Treffer-Counts der aktuellen Such-/
 * Serien-Filter – und der aktive Datums-Filter wird nur als highlighted Range
 * über das gleiche Histogramm gelegt (Drill-Sideways-Verhalten).
 *
 * Performance: zwei parallele Meili-Calls statt einem. Meili-Searches sind
 * < 30 ms lexical, der Roundtrip-Overhead ist vernachlässigbar.
 */
export async function searchWithTimeline(
	params: SearchParams,
	// extraFilter: zusätzliche Meili-Filter-Klauseln (AND) – z. B. `id IN […]`
	// für die Stufe-2-Suche innerhalb des Thema-Sets.
	// attributesToRetrieve: Payload-Hygiene für grosse Fenster (API v1 holt bis
	// zu 1000 Hits) – ohne Body bleibt _formatted.body (Crop) trotzdem erhalten.
	// countMatchAll: Zähl-/Timeline-Queries mit leerem q (reines Thema-Ranking –
	// die Treffer-Anzahl ist die Filter-Menge, nicht die lexikalische
	// Trefferzahl des als q mitlaufenden Thema-Texts).
	opts?: {
		vector?: number[] | null;
		extraFilter?: string[];
		attributesToRetrieve?: string[];
		countMatchAll?: boolean;
		// An den Haupt-Query durchgereicht (s. searchDocuments): Suchbegriff-
		// Highlight im kombinierten Thema-Modus erzwingen.
		lexicalHighlight?: boolean;
		// strict: matchingStrategy:"all" für Haupt- UND Zähl-/Timeline-Query
		// (durchgereicht an searchDocuments), damit Treffer und Counts konsistent
		// strikt sind.
		strict?: boolean;
		// attributesToSearchOn: BM25-Arm auf bestimmte Felder beschränken (Nur-
		// Titel-Suche → ["title"]). An Haupt-, Zähl- UND Timeline-Query
		// durchgereicht, damit Treffer und Counts konsistent titel-beschränkt sind.
		attributesToSearchOn?: string[];
		// highlightTerms: Begriffe, die serverseitig nachmarkiert/-gecroppt werden
		// (zweistufige ODER-Pfade – Stufe 2 sucht mit q = Thema bzw. leer, Meili
		// kennt die ODER-/UND-Begriffe nicht). Fliesst via opts nur in die
		// Haupt-Query (Zähl-/Timeline-Queries bauen eigene opts ohne Hits).
		highlightTerms?: string[];
		// lean: nur die geordnete Trefferliste (Treffer-Export) – keine Facetten,
		// kein Highlight/Crop, keine Timeline-Query. Ändert die Reihenfolge nicht
		// (all das ist Nachbearbeitung); die Zähl-Query bleibt, wo sie den
		// Zähler liefert (Hybrid).
		lean?: boolean;
		// candidates: Zahl der Dokumente, die Filter + extraFilter treffen, wenn
		// sie schon feststeht (Stufe-1-IDs) – spart dem Themen-Umfang die Zähl-Query.
		candidates?: number;
		// order: die Reihenfolge steht schon fest (Thema innerhalb der Treffer eines Worts,
		// themeDocsWithin) – der Themen-Umfang schneidet sie, statt selbst zu suchen.
		order?: ThemeOrder<string>;
		// vectorlessByKeyword: Thema allein (q = Thema-Text). Dokumente ohne Vektor
		// (Ratsmanuale) reiht das Thema nur als Stichwort-Treffer des Thema-Texts
		// (themeAloneDocs) – Zähler, Facetten und Zeitleiste zählen darum alle mit
		// Vektor plus diese Stichwort-Treffer, nicht die ganze Filtermenge.
		vectorlessByKeyword?: boolean;
		// countOnly: nur Trefferzahl, Facetten und Zeitleiste, ohne Treffer (Zahl im Reiter; Zählung
		// neben einer Reihenfolge).
		countOnly?: boolean;
		// plain, bare: wie in searchDocuments.
		plain?: boolean;
		bare?: boolean;
		// tiered: an die Haupt-Query durchgereicht (s. searchDocuments) – «genau so
		// geschrieben» zuerst; die Zähl- und Zeitleisten-Queries zählen alle Treffer.
		tiered?: boolean;
	},
): Promise<SearchResponse & { timelineBuckets: Record<string, number> }> {
	const lean = opts?.lean === true;
	// Lexikalisches ODER (>= 2 Begriffe): deduplizierte Union via Meili-Föderation.
	// Rein lexikalisch (v1) – Vektor/countMatchAll/lexicalHighlight greifen hier nicht.
	if (params.anyTerms.length >= 2) {
		// countOnly: ein Fenster ohne Treffer.
		const p = opts?.countOnly ? { ...params, page: 1, pageSize: 0 } : params;
		const res = await searchDocumentsUnion(p, params.anyTerms, {
			extraFilter: opts?.extraFilter,
			attributesToRetrieve: opts?.attributesToRetrieve,
			attributesToSearchOn: opts?.attributesToSearchOn,
			lean,
			bare: opts?.bare,
		});
		return { ...res, page: params.page, pageSize: params.pageSize };
	}
	const isSemantic = params.semanticRatio > 0;
	const hasVector = (opts?.vector?.length ?? 0) > 0;
	// Meili kann bei Hybrid-Search nicht echt nach Datum sortieren – der
	// hybrid-Score dominiert, `sort: date` greift nur als Tie-Breaker (und
	// Hybrid-Scores sind quasi nie gleich). Deshalb: wann immer der User
	// im Semantik-Modus eine Datums-Sortierung wählt, implizit Top-K=100
	// aktivieren – dann sortieren wir clientseitig korrekt nach Datum.
	const sortNeedsTopK = isSemantic && params.sort !== "relevance";
	const effectiveTopK =
		params.topK ?? (sortNeedsTopK ? DEFAULT_AUTO_TOPK : null);
	const useTopK = isSemantic && hasVector && effectiveTopK != null;

	if (useTopK) {
		return await searchTopK({ ...params, topK: effectiveTopK }, opts!);
	}

	// Lexical-Calls für korrekte Treffer-Counts und Facets:
	//   - facetsForCounts: alle Filter aktiv (inkl. dateRange) – liefert die
	//     für die UI angezeigten Serien-Counts und die "echte" Treffer-Anzahl
	//     (bei Hybrid-Search ist Meilis estimatedTotalHits korpus-weit, weil
	//     jedes Doc Vektor-Ähnlichkeit > 0 hat – als "Treffer" irreführend).
	//   - facetsForTimeline: ohne dateYear-Filter – der Zeitstrahl zeigt immer
	//     die volle Spannweite des Korpus, nur die aktive Range highlighted.
	const hasDateFilter = params.dateFrom != null || params.dateTo != null;
	const countQ = opts?.countMatchAll ? "" : params.q;
	// Die Zähl-Query nur, wo sie den Zähler liefert (Hybrid – dort ist Meilis
	// estimatedTotalHits korpus-weit). Rein lexikalisch liefert die Haupt-Query
	// Zähler und Facetten selbst (gleiche Suche, gleiche Filter). Lean (Export):
	// die Timeline-Query nie.
	const needCounts = isSemantic;
	const splitVectorless =
		needCounts && opts?.countMatchAll === true && opts?.vectorlessByKeyword === true && !!VECTOR_CANDIDATE_CLAUSE && !!VECTORLESS_CLAUSE;
	// Zähl-/Timeline-Query; bei splitVectorless getrennt: Match-all über die Dokumente mit
	// Vektor plus die Stichwort-Treffer des Thema-Texts ohne Vektor (die Liste kennt nur diese).
	const countSearch = async (p: SearchParams, o: Parameters<typeof searchDocuments>[1]): Promise<SearchResponse> => {
		if (!splitVectorless) return searchDocuments(p, o);
		const extra = o?.extraFilter ?? [];
		const [withVectors, vectorless] = await Promise.all([
			searchDocuments(p, { ...o, extraFilter: [...extra, VECTOR_CANDIDATE_CLAUSE!] }),
			params.semanticRatio < 1 && params.q.trim()
				? searchDocuments({ ...p, q: themeKeywords(params.q) }, { ...o, keywords: true, extraFilter: [...extra, VECTORLESS_CLAUSE!] })
				: Promise.resolve(null),
		]);
		return vectorless ? sumCounts(withVectors, vectorless) : withVectors;
	};
	const [main, facetsForCountsOpt, facetsForTimelineOpt] = await Promise.all([
		opts?.countOnly
			? needCounts
				? Promise.resolve(noHits(params))
				: searchDocuments({ ...params, page: 1, pageSize: 1 }, { ...opts, bare: true }).then(withoutHits)
			: searchDocuments(params, opts),
		needCounts
			? countSearch(
					{ ...params, q: countQ, semanticRatio: 0, page: 1, pageSize: 1 },
					{ vector: null, extraFilter: opts?.extraFilter, strict: opts?.strict, attributesToSearchOn: opts?.attributesToSearchOn, lean, bare: true },
				)
			: (Promise.resolve(undefined) as Promise<SearchResponse | undefined>),
		hasDateFilter && !lean && !opts?.bare
			? countSearch(
					{
						...params,
						q: countQ,
						dateFrom: null,
						dateTo: null,
						semanticRatio: 0,
						page: 1,
						pageSize: 1,
					},
					{ vector: null, extraFilter: opts?.extraFilter, strict: opts?.strict, attributesToSearchOn: opts?.attributesToSearchOn, bare: true },
				)
			: (Promise.resolve(undefined) as Promise<SearchResponse | undefined>),
	]);

	const facetsForCounts = facetsForCountsOpt ?? main;
	const timelineSource = facetsForTimelineOpt ?? facetsForCounts;
	return {
		...main,
		// Bei Semantic: echte Lexical-Trefferanzahl. Bei reinem Lexical: same as main.
		estimatedTotalHits: isSemantic
			? facetsForCounts.estimatedTotalHits
			: main.estimatedTotalHits,
		facetDistribution: facetsForCounts.facetDistribution ?? main.facetDistribution,
		timelineBuckets: timelineSource.facetDistribution?.dateYear ?? {},
	};
}

/** Nur die Zahlen: Der eine Treffer der Zählung trägt womöglich nur die Kennung (bare). */
const withoutHits = (r: SearchResponse): SearchResponse => ({ ...r, hits: [] });

/** Antwort ohne Treffer (nur Zahlen gefragt). */
function noHits(params: SearchParams): SearchResponse {
	return { hits: [], estimatedTotalHits: 0, processingTimeMs: 0, page: params.page, pageSize: params.pageSize };
}

/** Zwei Zählungen über getrennte Mengen addiert (Treffer und Facetten). */
function sumCounts(a: SearchResponse, b: SearchResponse): SearchResponse {
	const facetDistribution: FacetDistribution = {};
	for (const name of ["series", "dateYear"] as const) {
		const into: Record<string, number> = {};
		for (const src of [a.facetDistribution?.[name], b.facetDistribution?.[name]]) {
			for (const [value, n] of Object.entries(src ?? {})) into[value] = (into[value] ?? 0) + n;
		}
		if (a.facetDistribution?.[name] || b.facetDistribution?.[name]) facetDistribution[name] = into;
	}
	return { ...a, estimatedTotalHits: (a.estimatedTotalHits ?? 0) + (b.estimatedTotalHits ?? 0), facetDistribution };
}

// Serverseitiges Snippet-Post-Processing (Haupt- wie Top-K-Query, geteilt):
// `highlightTerms` sind die ODER-/UND-Begriffe der zweistufigen Union-Pfade –
// Meili kennt sie dort nicht (q = Thema bzw. leer), darum Crop um die erste
// Fundstelle + <mark class="match"> nachziehen. Reihenfolge fix: Term-Crop
// gewinnt gegen den Entity-Crop (wie beim normalen q-Pfad, wo der
// Entity-Recrop nur bei noQuery greift); Entity-Marking zuletzt –
// splitOnMarks lässt frische Term-Marks unangetastet (keine Verschachtelung).
// Ohne Fundstelle im Body (Projektion ohne body, Match nur via
// Stemming/Titel) bleibt Meilis Crop stehen.
function applySnippetMarks(hits: SearchHit[], params: SearchParams, highlightTerms: string[]): void {
	const entities = [...params.persons, ...params.places, ...params.organizations];
	if (highlightTerms.length === 0 && entities.length === 0) return;
	const noQuery = params.q.trim().length === 0;
	// Trifft der Filter über den Schlüssel, steht im Text womöglich nur eine andere
	// Schreibung («Fischenthal» zum gewählten «Fischental») – die markieren wir mit.
	const keyed = entities.length > 0 && params.entityMatch !== "exact" && entityKeysReadyNow();
	for (const hit of hits) {
		if (!hit._formatted) continue;
		let termCropped = false;
		if (highlightTerms.length > 0 && hit.body) {
			const recropped = cropAroundTerms(hit.body, highlightTerms, 30);
			if (recropped) {
				hit._formatted.body = recropped;
				termCropped = true;
			}
		}
		if (highlightTerms.length > 0) {
			if (hit._formatted.body) hit._formatted.body = markTerms(hit._formatted.body, highlightTerms, "match");
			if (hit._formatted.title) hit._formatted.title = markTerms(hit._formatted.title, highlightTerms, "match");
		}
		if (entities.length > 0) {
			const variants = keyed ? variantFormsInHit(hit, params) : [];
			const forms = variants.length > 0 ? [...entities, ...variants] : entities;
			if (noQuery && !termCropped && hit.body) {
				const recropped = cropAroundTerms(hit.body, forms, 30);
				if (recropped) hit._formatted.body = recropped;
			}
			if (hit._formatted.body) hit._formatted.body = markEntities(hit._formatted.body, forms);
			if (hit._formatted.title) hit._formatted.title = markEntities(hit._formatted.title, forms);
		}
	}
}

/** Felder der K ähnlichsten zum Ordnen nach Datum und für die Facetten. */
const TOPK_FIELDS = ["id", "series", "date", "dateYear", "startPg"];

/**
 * Top-K-Modus für die semantische Suche.
 *
 * Die top-K Treffer der Thema-Reihenfolge (themeOrder.ts) werden clientseitig nach
 * dem gewünschten Sort-Kriterium umsortiert und paginiert.
 * Anwendungsfall: "die 50 ähnlichsten Treffer zur Query, sortiert nach Datum" –
 * Thema allein (Top-K der Filter-Menge) wie kombiniert (Top-K innerhalb der
 * Suchbegriff-/Union-Treffer, `order`).
 *
 * Meili kann das nicht in einem Schritt: `sort=date` würde den gesamten Korpus
 * nach Datum ordnen und Hybrid-Score nur als Tie-Breaker nutzen – wir wollen
 * aber: erst Top-K nach Score, dann Top-K nach Datum.
 *
 * Facet-Distribution wird aus den Top-K-Hits selbst aggregiert. Bei Hybrid-
 * Search ist Meilis facetDistribution korpus-weit (Score > 0 für alle Docs),
 * d.h. unbrauchbar für „wo liegen meine top-K?".
 *
 * Ein paralleler Count liefert `topKOfTotal` (Grösse der Menge, aus der
 * geschnitten wird) fürs Zähler-Label «K ähnlichste von X Treffern»; innerhalb der
 * Treffer eines Worts kennt executeSearch die Zahl schon (`candidates`).
 */
async function searchTopK(
	params: SearchParams,
	opts: {
		vector?: number[] | null;
		extraFilter?: string[];
		attributesToRetrieve?: string[];
		strict?: boolean;
		attributesToSearchOn?: string[];
		// lexicalHighlight: q ist ein echter Suchbegriff (kombinierter Modus) →
		// Meili-Highlight/Crop um die q-Terme (stemming-tolerant), wie im
		// Haupt-Query-Pfad (searchDocuments).
		lexicalHighlight?: boolean;
		// highlightTerms: ODER-/UND-Begriffe serverseitig nachmarkieren (Union-
		// Stufe 2, wo q das Thema ist) – s. applySnippetMarks.
		highlightTerms?: string[];
		// lean: Treffer-Export – kein Highlight/Crop (Reihenfolge unverändert).
		lean?: boolean;
		// candidates: bekannte Grösse der Schnitt-Basis, ersetzt den Match-all-Count.
		candidates?: number;
		// order: die Reihenfolge innerhalb der Treffer eines Worts (themeDocsWithin).
		order?: ThemeOrder<string>;
		// plain, bare: wie in searchDocuments.
		plain?: boolean;
		bare?: boolean;
		// vectorlessByKeyword: Thema allein – «K ähnlichste von X» zählt die Dokumente
		// ohne Vektor nur als Stichwort-Treffer (s. searchWithTimeline).
		vectorlessByKeyword?: boolean;
	},
): Promise<SearchResponse & { timelineBuckets: Record<string, number> }> {
	const filter = [...buildFilter(params), ...(opts.extraFilter ?? [])];
	const topK = params.topK!;
	const lean = opts.lean === true;

	// Ausschluss-Tokens nach vorn (Issue #112) – q ist im kombinierten Modus
	// der echte Suchbegriff (inkl. möglicher `-…`-Ausschlüsse).
	const q = exclusionsFirst(params.q);
	const body: Record<string, unknown> = {
		q,
		limit: topK,
		offset: 0,
		filter,
		// Facets brauchen wir hier nicht – wir aggregieren clientseitig aus
		// den top-K Hits.
		facets: [],
		attributesToHighlight: opts.lexicalHighlight && !lean ? ["title", "body"] : [],
		attributesToCrop: lean ? [] : ["body"],
		cropLength: 30,
		highlightPreTag: '<mark class="match">',
		highlightPostTag: "</mark>",
		showRankingScore: !lean,
		hybrid: {
			embedder: "jina_de",
			semanticRatio: params.semanticRatio,
		},
		vector: opts.vector,
	};
	if (opts.attributesToRetrieve) body.attributesToRetrieve = opts.attributesToRetrieve;
	if (opts.attributesToSearchOn) body.attributesToSearchOn = opts.attributesToSearchOn;
	if (opts.strict) body.matchingStrategy = "all";

	// Grösse der Schnitt-Basis (topKOfTotal) daneben. Die K ähnlichsten nur mit den Feldern zum
	// Ordnen und Zählen; formatiert wird danach nur die Seite (wie deepPage.ts). Der Export
	// (lean) braucht alle K mit seiner Projektion.
	const started = performance.now();
	const [order, ofTotal] = await Promise.all([
		opts.order ?? themeAloneDocs(themeOf(q, body, filter), topK, Math.max(topK, THEME_LIST_MAX)),
		opts.candidates ?? (opts.vectorlessByKeyword ? countThemeRankable(q, body, filter) : countDocs(filter)),
	]);
	const top = order.hits.slice(0, topK);
	const allHits = await hydrateRanked(top, lean ? (opts.attributesToRetrieve ?? TOPK_FIELDS) : TOPK_FIELDS);
	const rankMs = Math.round(performance.now() - started);

	// Re-sortieren nach gewünschtem Kriterium (Meili-Hybrid liefert nach Score).
	// Tie-Break über `startPg:asc`, damit Datums-Sort konsistent zum Lexical-
	// Pfad (mapSort) Seiten innerhalb derselben Ausgabe in Lesereihenfolge zeigt.
	if (params.sort === "date_asc") {
		allHits.sort((a, b) => {
			const d = (a.date ?? "").localeCompare(b.date ?? "");
			if (d !== 0) return d;
			return (a.startPg ?? Number.POSITIVE_INFINITY) - (b.startPg ?? Number.POSITIVE_INFINITY);
		});
	} else if (params.sort === "date_desc") {
		allHits.sort((a, b) => {
			const d = (b.date ?? "").localeCompare(a.date ?? "");
			if (d !== 0) return d;
			return (a.startPg ?? Number.POSITIVE_INFINITY) - (b.startPg ?? Number.POSITIVE_INFINITY);
		});
	}

	// Facets clientseitig aggregieren – basis: alle top-K Treffer
	const seriesCounts: Record<string, number> = {};
	const yearCounts: Record<string, number> = {};
	for (const h of allHits) {
		seriesCounts[h.series] = (seriesCounts[h.series] ?? 0) + 1;
		if (h.dateYear != null) {
			const k = String(h.dateYear);
			yearCounts[k] = (yearCounts[k] ?? 0) + 1;
		}
	}

	// Datums-Filter clientseitig anwenden (Meili-Filter sind bereits in body,
	// aber bei Re-Sort nach Datum macht's nochmal Sinn falls vorher kein Filter
	// war).  buildFilter() respektiert dateFrom/dateTo schon, also kommen hier
	// nur top-K innerhalb der Range an.

	// Pagination innerhalb der top-K Hits
	const start = (params.page - 1) * params.pageSize;
	let paged = allHits.slice(start, start + params.pageSize);
	let formatMs = 0;
	if (!lean && !opts.bare && paged.length > 0) {
		const ranked = paged.map((h) => ({ id: h.id, score: h._rankingScore ?? 0 }));
		const page = await formatRanked(opts.vectorlessByKeyword ? themeKeywords(q) : q, body, ranked, {
			plain: opts.plain && top.length <= order.ranked,
		});
		paged = page.hits;
		formatMs = page.processingTimeMs ?? 0;
		// Nur die sichtbare Seite nachmarkieren (Marks ändern weder Sort noch Facets).
		applySnippetMarks(paged, params, opts.highlightTerms ?? []);
	}

	return {
		hits: paged,
		estimatedTotalHits: allHits.length,
		processingTimeMs: rankMs + formatMs,
		facetDistribution: { series: seriesCounts, dateYear: yearCounts },
		page: params.page,
		pageSize: params.pageSize,
		timelineBuckets: yearCounts,
		topKOfTotal: Number.isFinite(ofTotal) ? ofTotal : allHits.length,
		semanticHitCount: Math.min(order.ranked, top.length),
	};
}

interface FederatedRawResult {
	hits: SearchHit[];
	estimatedTotalHits?: number;
	processingTimeMs?: number;
	facetDistribution?: SearchResponse["facetDistribution"];
}

type MultiSearchArg = Parameters<typeof client.multiSearch>[0];

function federatedSearch(federation: Record<string, unknown>, queries: Array<Record<string, unknown>>) {
	return client.multiSearch({ federation, queries } as unknown as MultiSearchArg) as unknown as Promise<FederatedRawResult>;
}

/**
 * Lexikalische ODER-Suche: die deduplizierte Vereinigung mehrerer BM25-Suchen
 * (ein Begriff je Föderations-Query) als EINE Trefferliste. Meilis föderierte
 * Multi-Search liefert Union, Dedup, Pagination, gemergte Facetten (series +
 * dateYear) und Highlight/Crop pro Begriff nativ. Nach Relevanz direkt; nach
 * Datum über ein Fenster aus der Jahres-Facette (searchDocumentsUnionByDate,
 * dateWindow.ts) – ungedeckelt, Seite 1 zeigt die ältesten bzw. jüngsten
 * Treffer der ganzen Vereinigung. Alle übrigen Filter (Serie, Zeitraum,
 * Entitäten, Detail-Facetten) wirken über buildFilter pro Begriff.
 */
export async function searchDocumentsUnion(
	params: SearchParams,
	terms: string[],
	// lean: Treffer-Export – keine Facetten, kein Highlight/Crop, kein
	// Timeline-Call (Reihenfolge unverändert).
	// slice: Ausschnitt [offset, offset + limit) statt der Seite aus page/pageSize, ohne
	// Facetten und Zeitleiste – für die Stufe «ähnliche Schreibungen» (tiers.ts), die nicht an
	// einer Seitengrenze beginnt.
	opts?: {
		extraFilter?: string[];
		attributesToRetrieve?: string[];
		attributesToSearchOn?: string[];
		lean?: boolean;
		// bare: ohne Hervorhebung und Auszug (Nachbarn).
		bare?: boolean;
		slice?: { offset: number; limit: number };
	},
): Promise<SearchResponse & { timelineBuckets: Record<string, number> }> {
	const filter = [...buildFilter(params), ...(opts?.extraFilter ?? [])];
	const offset = opts?.slice ? Math.max(0, opts.slice.offset) : Math.max(0, (params.page - 1) * params.pageSize);
	const limit = opts?.slice ? Math.max(0, opts.slice.limit) : params.pageSize;
	const hasDateFilter = params.dateFrom != null || params.dateTo != null;
	const lean = opts?.lean === true;
	// Facetten und Zeitleiste nur für die Seite selbst, nicht für einen Ausschnitt.
	const pageFacets = !lean && !opts?.slice;

	const buildQueries = (
		queryFilter: string[],
		// format: Highlight/Crop + Ranking-Score (Trefferliste); retrieve: Projektion
		// (Default die des Aufrufers).
		{ format = !lean && !opts?.bare, retrieve = opts?.attributesToRetrieve }: { format?: boolean; retrieve?: string[] } = {},
	) =>
		terms.map((t) => {
			// Suchbegriff `q` (Pflicht-/UND-Terme) an jeden ODER-Zweig hängen →
			// (A ODER B) UND q; jeder Zweig strikt (matchingStrategy:"all", auch
			// ohne q – s. combineUnionQuery).
			const branch = combineUnionQuery(t, params.q);
			const query: Record<string, unknown> = format
				? {
						indexUid: MEILI_INDEX,
						...branch,
						filter: queryFilter,
						attributesToHighlight: ["title", "body"],
						attributesToCrop: ["body"],
						cropLength: 30,
						highlightPreTag: '<mark class="match">',
						highlightPostTag: "</mark>",
						showRankingScore: true,
					}
				: { indexUid: MEILI_INDEX, ...branch, filter: queryFilter };
			if (retrieve) query.attributesToRetrieve = retrieve;
			if (opts?.attributesToSearchOn) query.attributesToSearchOn = opts.attributesToSearchOn;
			return query;
		});
	// Facetten der Föderation: je Index berechnet, dann gemergt. Hoch genug für die
	// ganze Jahres-Spanne + alle Serien – sonst kappt Meili alphabetisch.
	const facets = (names: string[]) => ({
		facetsByIndex: { [MEILI_INDEX]: names },
		mergeFacets: { maxValuesPerFacet: 10_000 },
	});
	const formatPage = (ids: PageId[]) =>
		formatInGroups(ids, (group) => federatedSearch({ offset: 0, limit: group.length }, buildQueries([idInClause(group)])));
	// Optionaler Timeline-Call ohne Datumsfilter (volle Spannweite, wie
	// facetsForTimeline im Lexical-Pfad).
	const timeline =
		hasDateFilter && pageFacets && !opts?.bare
			? federatedSearch(
					{ offset: 0, limit: 0, ...facets(["dateYear"]) },
					buildQueries([...buildFilter(params, ["date"]), ...(opts?.extraFilter ?? [])], { format: false, retrieve: ["id"] }),
				)
			: Promise.resolve(undefined);

	if (params.sort === "date_asc" || params.sort === "date_desc") {
		return searchDocumentsUnionByDate(params, params.sort, filter, offset, {
			buildQueries,
			formatPage,
			facets,
			timeline,
			lean,
			limit,
			pageFacets,
			attributesToRetrieve: opts?.attributesToRetrieve,
		});
	}

	// Die Föderation formatiert jeden Treffer bis zum Offset, in jeder Meili-Version, und die Seite
	// Treffer um Treffer: darum zweistufig, die Seite in Gruppen (deepPage.ts) – über `id IN […]`
	// bekommt jeder Treffer die Hervorhebung des Zweigs, der ihn liefert, wie in einer Abfrage.
	const window = { offset, limit, ...(pageFacets ? facets(["series", "dateYear"]) : {}) };
	const [main, timelineOpt] = await Promise.all([
		!lean && !opts?.bare && limit > 0
			? searchDeepPage<SearchHit, FederatedRawResult>({
					ids: () => federatedSearch(window, buildQueries(filter, { format: false, retrieve: ["id"] })),
					format: formatPage,
				})
			: federatedSearch(window, buildQueries(filter)),
		timeline,
	]);
	const hits = (main.hits ?? []) as SearchHit[];
	return {
		hits,
		// Föderation liefert die deduplizierte Union-Trefferzahl (über die ganze
		// Union, unabhängig vom geholten Fenster).
		estimatedTotalHits: main.estimatedTotalHits ?? hits.length,
		processingTimeMs: main.processingTimeMs ?? 0,
		facetDistribution: main.facetDistribution,
		page: params.page,
		pageSize: params.pageSize,
		// Timeline volle Spannweite: ohne Datumsfilter, sonst aus dem Haupt-Call.
		timelineBuckets: (timelineOpt ?? main).facetDistribution?.dateYear ?? {},
	};
}

/**
 * ODER nach Datum über das Jahresfenster (searchByDateWindow, dateWindow.ts): jede
 * Abfrage des Fensters ist eine Föderation nach Relevanz; die Seite formatiert eine
 * Föderation über `id IN […]` (jeder Treffer vom Zweig, der ihn liefert – wie nach
 * Relevanz). Lean (Export): die geschnittenen Treffer sind das Ergebnis.
 */
async function searchDocumentsUnionByDate(
	params: SearchParams,
	sort: DateSort,
	filter: string[],
	offset: number,
	ctx: {
		buildQueries: (queryFilter: string[], o?: { format?: boolean; retrieve?: string[] }) => Array<Record<string, unknown>>;
		formatPage: (ids: PageId[]) => Promise<PageHits<SearchHit>>;
		facets: (names: string[]) => Record<string, unknown>;
		timeline: Promise<FederatedRawResult | undefined>;
		lean: boolean;
		/** Treffer der Seite bzw. des Ausschnitts. */
		limit: number;
		/** Facetten aller Treffer mitliefern (nicht im Export und nicht für einen Ausschnitt). */
		pageFacets: boolean;
		attributesToRetrieve?: string[];
	},
): Promise<SearchResponse & { timelineBuckets: Record<string, number> }> {
	const { buildQueries, facets, lean } = ctx;
	const [res, timelineOpt] = await Promise.all([
		searchByDateWindow<SearchHit, FacetDistribution>(
			{
				query: ({ clause, limit, facets: names, retrieve }) =>
					federatedSearch(
						{ offset: 0, limit, ...(names.length > 0 ? facets(names) : {}) },
						buildQueries(clause ? [...filter, clause] : filter, { format: false, retrieve }),
					),
				format: async (ids) => {
					const page = await ctx.formatPage(ids);
					return { hits: page.hits, processingTimeMs: page.processingTimeMs };
				},
			},
			{
				sort,
				offset,
				limit: ctx.limit,
				facets: ctx.pageFacets ? ["series", "dateYear"] : [],
				lean,
				retrieve: ctx.attributesToRetrieve,
			},
		),
		ctx.timeline,
	]);
	if (res.fallback) {
		console.warn(`[search] ODER nach Datum: Jahres-Facette passt nicht zu ${res.total} Treffern – ganze Vereinigung geholt`);
	}
	return {
		hits: res.hits,
		estimatedTotalHits: res.total,
		processingTimeMs: res.processingTimeMs,
		facetDistribution: res.facetDistribution,
		page: params.page,
		pageSize: params.pageSize,
		timelineBuckets: (timelineOpt ?? res).facetDistribution?.dateYear ?? {},
	};
}

/**
 * Nur die Doc-IDs der lexikalischen ODER-Vereinigung (dedupliziert), bis `cap`
 * (die relevantesten), plus `total` = volle Union-Trefferzahl. Leichtgewichtig
 * (keine Facetten/Bodies) – Stufe 1 für „ODER + Thema" (Thema rankt die Union per
 * `id IN […]`), Facetten-Typeahead und KI-Treffer-Scope. Spiegelt
 * searchLexicalDocIds für den ODER-Fall.
 */
export async function searchUnionDocIds(
	params: SearchParams,
	terms: string[],
	cap: number,
	// attributesToSearchOn: Nur-Titel-Suche → ["title"] (an jeden ODER-Zweig).
	attributesToSearchOn?: string[],
	// Weitere Klauseln (Thema-Reihung, themeDocsWithin).
	extraFilter: readonly string[] = [],
): Promise<{ ids: string[]; total: number }> {
	const filter = [...buildFilter(params), ...extraFilter];
	type MultiSearchArg = Parameters<typeof client.multiSearch>[0];
	const res = (await client.multiSearch({
		federation: { offset: 0, limit: cap },
		// Suchbegriff `q` an jeden ODER-Zweig hängen, jeder Zweig strikt → die
		// Union-IDs sind bereits (A ODER B) UND q, gleiche Menge wie die
		// Föderation (searchDocumentsUnion); s. combineUnionQuery.
		queries: terms.map((t) => {
			const query: Record<string, unknown> = {
				indexUid: MEILI_INDEX,
				...combineUnionQuery(t, params.q),
				filter,
				attributesToRetrieve: ["id"],
			};
			if (attributesToSearchOn) query.attributesToSearchOn = attributesToSearchOn;
			return query;
		}),
	} as unknown as MultiSearchArg)) as unknown as { hits: Array<{ id: string }>; estimatedTotalHits?: number };
	const ids = res.hits.map((h) => h.id);
	return { ids, total: res.estimatedTotalHits ?? ids.length };
}

// In-Memory-Cache der korpus-weiten dateYear-Verteilung. Quelle für den
// Landing-Zeitstrahl UND die dynamischen Jahres-Grenzen (äusserste Daten des
// Korpus). Ändert sich nur bei Index-Updates → aggressiv cachen (5 min TTL).
let corpusDistCache: { dist: Record<string, number>; expiresAt: number } | null = null;
const CORPUS_DIST_TTL_MS = 5 * 60_000;

/**
 * dateYear-Verteilung des gesamten Korpus (ungefiltert), gecached. `searchDocuments`
 * mit DEFAULT_SEARCH liefert die facetDistribution korpus-weit.
 */
export async function getCorpusYearDistribution(): Promise<Record<string, number>> {
	const now = Date.now();
	if (corpusDistCache && corpusDistCache.expiresAt > now) return corpusDistCache.dist;
	const result = await searchDocuments({ ...DEFAULT_SEARCH, semanticRatio: 0, pageSize: 1 }, { bare: true });
	const dist = result.facetDistribution?.dateYear ?? {};
	corpusDistCache = { dist, expiresAt: now + CORPUS_DIST_TTL_MS };
	return dist;
}

export async function searchDocuments(
	params: SearchParams,
	// extraFilter: zusätzliche Meili-Filter-Klauseln (AND), z. B. `id IN […]`
	// für die Korpus-Einschränkung von „Suchresultate befragen".
	// attributesToRetrieve: optionale Projektion (z. B. ohne body für API v1);
	// _formatted-Crops aus attributesToCrop bleiben davon unberührt.
	// lexicalHighlight: Wort-Hervorhebung von `params.q` auch im Hybrid-Modus
	// erzwingen – für „Suchbegriff filtert, Thema rankt": q ist der Suchbegriff
	// (highlightet/cropt), der Thema-Vektor rankt nur.
	opts?: {
		vector?: number[] | null;
		extraFilter?: string[];
		attributesToRetrieve?: string[];
		lexicalHighlight?: boolean;
		// attributesToSearchOn: lexikalische Suche auf bestimmte Felder beschränken
		// (z. B. nur ["title"]). Meili-Suchzeit-Option, KEIN Re-Index nötig. Wirkt
		// nur auf den BM25-Arm; bei Hybrid matcht der Vektor weiter den ganzen Doc.
		attributesToSearchOn?: string[];
		// strict: alle positiven Suchbegriffe müssen vorkommen (matchingStrategy:"all"
		// statt Meilis weichem Default "last"). Für die interaktive Suche –
		// „Pflicht-Terme müssen vorkommen". Public API v1 lässt es weg (weich).
		strict?: boolean;
		// keywords: q sind die Inhaltswörter eines Themas – das häufigste darf fehlen (wie vectorlessBody).
		keywords?: boolean;
		// highlightTerms: ODER-/UND-Begriffe der zweistufigen Union-Pfade – Meili
		// kennt sie in Stufe 2 nicht (q = Thema bzw. leer), darum Crop um die
		// erste Fundstelle + <mark class="match"> serverseitig nachziehen
		// (gleiches Muster wie das Entity-Marking unten).
		highlightTerms?: string[];
		// lean: Treffer-Export – keine Facetten, kein Highlight/Crop, kein
		// Ranking-Score. Alles reine Nachbearbeitung, die Reihenfolge bleibt.
		lean?: boolean;
		// bare: keine Hervorhebung, kein Auszug – Zählungen und Zeitleiste (nur Zahlen und Facetten
		// gefragt), Nachbarn (nur die Folge). Felder aus attributesToRetrieve, sonst die Kennung.
		bare?: boolean;
		// plain: der Aufrufer schneidet die Auszüge selbst aus dem Volltext (Thema) – Felder ohne
		// Hervorhebung, `_formatted` mit Titel und Textanfang.
		plain?: boolean;
		// ranked: diese Treffer in dieser Folge (Thema innerhalb der Treffer eines Worts,
		// themeDocsWithin) – nur noch Felder, Hervorhebung und Auszug.
		ranked?: Ranked<string>[];
		// tiered: Trefferliste der Suchseite – «genau so geschrieben» zuerst (tiers.ts). Nach
		// Datum zwei Stufen, nach Relevanz reiht Meili schon so, die Antwort nennt nur die
		// Grenze (exactTotal). Nur strikt, rein lexikalisch, ohne «nur im Titel».
		tiered?: boolean;
		// slice: Ausschnitt [offset, offset + limit) statt der Seite aus page/pageSize, ohne
		// Facetten (eine Stufe der zweistufigen Liste).
		slice?: TierSlice;
	},
): Promise<SearchResponse> {
	// ß als ss wie im Suchtext des Index: ab dem Suchtext-Stand für alle Serien, vorher nur
	// für die Ratsmanuale (Lesefassung) – auch für MCP und API, die direkt hierher kommen
	// (executeSearch faltet schon, zweimal falten ändert nichts).
	params = foldRmSharpS(params, searchTextReadyNow());
	const filter = [...buildFilter(params), ...(opts?.extraFilter ?? [])];
	const sort = mapSort(params.sort);
	const offset = opts?.slice ? Math.max(0, opts.slice.offset) : Math.max(0, (params.page - 1) * params.pageSize);
	const limit = opts?.slice ? Math.max(0, opts.slice.limit) : params.pageSize;

	const isSemantic = params.semanticRatio > 0;
	const lean = opts?.lean === true;
	const hybrid = !!opts?.vector && opts.vector.length > 0;

	// «Genau so geschrieben» zuerst (tiers.ts): nach Datum zwei Stufen, nach Relevanz nur die
	// Zahl der exakten Treffer für die Grenze in der Liste.
	const plan =
		opts?.tiered && opts.strict && !hybrid && !opts.attributesToSearchOn && !opts.slice ? tierPlan(params.q) : null;
	if (plan && (params.sort === "date_asc" || params.sort === "date_desc")) {
		return searchDocumentsTiered(params, opts!, plan, filter);
	}
	// Die Zählung läuft neben der Hauptsuche und fängt ihren Fehler selbst: Scheitert die Hauptsuche
	// zuerst, wartet niemand mehr auf sie, und ein unbehandelter Fehler beendet den Node-Prozess (bis
	// 2026-11 nach jedem Meili-Fehler einer Suche mit Suchwort). Ohne die Zahl fehlt nur die Grenze.
	const exactTotalPromise =
		plan && !lean
			? countStrict(plan.exactQ, filter).catch(() => {
					console.warn("[search] Zahl der genau so geschriebenen Treffer nicht lesbar");
					return null;
				})
			: null;

	// Ausschluss-Tokens nach vorn – das letzte positive Wort behält seine
	// Prefix-Expansion (Issue #112, s. exclusionsFirst).
	const q = exclusionsFirst(params.q);
	// Facetten nur für die Seite selbst, nicht für einen Ausschnitt.
	const facets = opts?.slice ? [] : ["series", "dateYear"];
	const body: Record<string, unknown> = lean
		? { q, limit, offset, filter, facets: [] }
		: opts?.bare
			? { q, limit, offset, filter, facets, attributesToRetrieve: opts.attributesToRetrieve ?? ["id"] }
			: {
				q,
				limit,
				offset,
				filter,
				facets,
				// Highlight nur bei lexikalischer Suche – bei reinem Thema-Ranking wurden
				// Treffer per Vektor-Ähnlichkeit gefunden, da wäre eine Wort-Hervorhebung
				// irreführend. Ausnahme: kombinierte Suche (Suchbegriff filtert, Thema
				// rankt) – dort IST `q` der Suchbegriff und soll hervorgehoben werden
				// (lexicalHighlight). Crop bleibt immer aktiv (Snippet statt ganzem Body).
				attributesToHighlight: isSemantic && !opts?.lexicalHighlight ? [] : ["title", "body"],
				attributesToCrop: ["body"],
				cropLength: 30,
				highlightPreTag: '<mark class="match">',
				highlightPostTag: "</mark>",
				showRankingScore: true,
			};
	if (sort.length > 0) body.sort = sort;
	if (opts?.attributesToRetrieve) body.attributesToRetrieve = opts.attributesToRetrieve;
	if (opts?.attributesToSearchOn) body.attributesToSearchOn = opts.attributesToSearchOn;
	// Pflicht-Terme strikt: alle Query-Wörter müssen matchen (sonst Meili-Default
	// "last", das fehlende Wörter tolerant fallenlässt).
	if (opts?.strict) body.matchingStrategy = "all";
	else if (opts?.keywords) body.matchingStrategy = "frequency";

	if (hybrid) {
		body.hybrid = {
			embedder: "jina_de",
			semanticRatio: params.semanticRatio,
		};
		body.vector = opts.vector;
	}

	// Tiefe Seiten einer strikten Suche nach Datum laufen über das Jahresfenster
	// (dateWindow.ts): seit Meili v1.47 bewertet `sort` jeden Treffer bis zum Offset
	// einzeln. Die übrigen zweistufig (deepPage.ts): formatiert wird nur die Seite, in Gruppen.
	const dateSort = hybrid
		? null
		: dateWindowSort({ sort: params.sort, q, strict: opts?.strict === true, offset, limit });
	const result = opts?.ranked
		? await formatRanked(q, body, opts.ranked, { lean, plain: opts.plain, bare: opts.bare })
		: dateSort
			? await searchDocumentsByDate(q, body, filter, { sort: dateSort, offset, limit, lean, facets })
			: hybrid
				? await themeDocPage(q, body, filter, { offset, limit, lean })
				: await searchDocPage(q, body);

	if (!lean) applySnippetMarks(result.hits as SearchHit[], params, opts?.highlightTerms ?? []);

	const exactTotal = exactTotalPromise ? await exactTotalPromise : null;
	return {
		hits: result.hits as SearchHit[],
		estimatedTotalHits: result.estimatedTotalHits ?? result.hits.length,
		processingTimeMs: result.processingTimeMs ?? 0,
		facetDistribution: result.facetDistribution,
		page: params.page,
		pageSize: params.pageSize,
		...semanticCount(result),
		...(exactTotal !== null ? { exactTotal } : {}),
	};
}

type SearchDocumentsOpts = NonNullable<Parameters<typeof searchDocuments>[1]>;

/** Trefferzahl einer strikten Stichwortsuche (limit 0, ohne Facetten). */
async function countStrict(q: string, filter: string[]): Promise<number> {
	const query = exclusionsFirst(q);
	const res = (await getIndex().search(query, { q: query, limit: 0, filter, matchingStrategy: "all" })) as unknown as {
		estimatedTotalHits?: number;
	};
	return res.estimatedTotalHits ?? 0;
}

/**
 * Trefferliste nach Datum in zwei Stufen (tiers.ts): erst alle Treffer, deren Wörter genau so
 * geschrieben sind (Stufe A, nach Datum), dann die übrigen (Stufe B, nach Datum). Trefferzahl,
 * Facetten und Zeitleiste zählen wie bisher alle Treffer der Anfrage; die Seite holt ihren
 * Ausschnitt aus A bzw. B, jede Stufe über dieselben Wege wie eine einfache Suche (Jahresfenster,
 * tiefe Seiten). Stufe B mit mehreren Wörtern ist eine ODER-Föderation «-Wort Anfrage» je Wort.
 */
async function searchDocumentsTiered(
	params: SearchParams,
	opts: SearchDocumentsOpts,
	plan: TierPlan,
	filter: string[],
): Promise<SearchResponse> {
	const offset = Math.max(0, (params.page - 1) * params.pageSize);
	const base: SearchDocumentsOpts = { ...opts, tiered: false };
	const [meta, exactTotal] = await Promise.all([
		// Trefferzahl und Facetten aller Treffer (limit 0).
		searchDocuments({ ...params, page: 1, pageSize: 0 }, base),
		countStrict(plan.exactQ, filter),
	]);
	const { a, b } = splitTiers(offset, params.pageSize, exactTotal);
	const branches = fuzzyBranches(plan);
	const [aRes, bRes] = await Promise.all([
		a ? searchDocuments({ ...params, q: plan.exactQ }, { ...base, slice: a }) : Promise.resolve(null),
		!b
			? Promise.resolve(null)
			: branches.length === 1
				? searchDocuments({ ...params, q: `${branches[0]} ${params.q}` }, { ...base, slice: b })
				: searchDocumentsUnion({ ...params, anyTerms: branches }, branches, {
						extraFilter: opts.extraFilter,
						attributesToRetrieve: opts.attributesToRetrieve,
						lean: opts.lean,
						slice: b,
					}),
	]);
	return {
		hits: [...(aRes?.hits ?? []), ...(bRes?.hits ?? [])],
		estimatedTotalHits: meta.estimatedTotalHits,
		processingTimeMs: meta.processingTimeMs + (aRes?.processingTimeMs ?? 0) + (bRes?.processingTimeMs ?? 0),
		facetDistribution: meta.facetDistribution,
		page: params.page,
		pageSize: params.pageSize,
		exactTotal,
	};
}

interface RawSearchResult {
	hits: SearchHit[];
	estimatedTotalHits?: number;
	processingTimeMs?: number;
	facetDistribution?: SearchResponse["facetDistribution"];
	// Nur bei Hybrid-Suchen gesetzt (Anzahl Treffer aus dem semantischen Arm).
	semanticHitCount?: number;
}

/**
 * Einzelsuche nach Datum über das Jahresfenster (searchByDateWindow, dateWindow.ts):
 * jede Abfrage des Fensters ist dieselbe Suche nach Relevanz (Suchbegriff, strikt,
 * Suchfelder, Filter) mit der Klausel des Fensters; die Seite holt eine Suche über
 * `id IN […]` mit Hervorhebung, Auszug und Projektion von `body`.
 */
async function searchDocumentsByDate(
	q: string,
	body: Record<string, unknown>,
	filter: string[],
	opts: { sort: DateSort; offset: number; limit: number; lean: boolean; facets: string[] },
): Promise<RawSearchResult> {
	const { sort: _sort, ...formatBody } = body;
	const searchOn = body.attributesToSearchOn as string[] | undefined;
	const res = await searchByDateWindow<SearchHit, FacetDistribution>(
		{
			query: async ({ clause, limit, facets, retrieve }) =>
				(await getIndex().search(q, {
					q,
					offset: 0,
					limit,
					filter: clause ? [...filter, clause] : filter,
					facets,
					matchingStrategy: "all",
					...(searchOn ? { attributesToSearchOn: searchOn } : {}),
					...(retrieve ? { attributesToRetrieve: retrieve } : {}),
				})) as unknown as RawSearchResult,
			format: async (ids) => {
				const page = await formatDocs(q, formatBody, ids);
				return { hits: page.hits, processingTimeMs: page.processingTimeMs };
			},
			direct: () => searchDocPage(q, { ...body, facets: [] }),
		},
		{
			...opts,
			facets: opts.lean ? [] : opts.facets,
			retrieve: body.attributesToRetrieve as string[] | undefined,
		},
	);
	if (res.fallback) {
		console.warn(`[search] nach Datum: Jahres-Facette passt nicht zu ${res.total} Treffern – ohne Jahresfenster geholt`);
	}
	return {
		hits: res.hits,
		estimatedTotalHits: res.total,
		processingTimeMs: res.processingTimeMs,
		facetDistribution: res.facetDistribution,
	};
}

/** Filter auf bestimmte Dokumente (Seiten der zweistufigen Pfade). */
function idInClause(ids: readonly PageId[]): string {
	return `id IN [${ids.map((id) => quoteMeili(String(id))).join(", ")}]`;
}

/**
 * Eine Stichwortsuche auf documents, zweistufig (deepPage.ts): erst die IDs der Seite mit
 * Trefferzahl, Score und Facetten, dann diese Seite mit Feldern, Hervorhebung und Auszug, in
 * Gruppen. Ohne Hervorhebung und Auszug (Zählungen, Export) eine Abfrage.
 */
async function searchDocPage(q: string, body: Record<string, unknown>): Promise<RawSearchResult> {
	const run = async (b: Record<string, unknown>) => (await getIndex().search(q, b)) as unknown as RawSearchResult;
	if (!wantsFormat(body) || Number(body.limit ?? 20) <= 0) return run(body);
	return searchDeepPage<SearchHit, RawSearchResult>({
		ids: () => run(idsOnly(body)),
		format: (ids) => formatDocs(q, body, ids),
	});
}

/** Diese Dokumente mit Feldern, Hervorhebung und Auszug der Abfrage, in Gruppen. */
function formatDocs(q: string, body: Record<string, unknown>, ids: PageId[]): Promise<PageHits<SearchHit>> {
	return formatInGroups(
		ids,
		async (group) => (await getIndex().search(q, pageOnly(body, [idInClause(group)], group.length))) as unknown as RawSearchResult,
	);
}

/** semanticHitCount nur weiterreichen, wenn Meili ihn geliefert hat (Hybrid). */
function semanticCount(result: RawSearchResult): Pick<SearchResponse, "semanticHitCount"> {
	return typeof result.semanticHitCount === "number" ? { semanticHitCount: result.semanticHitCount } : {};
}

// --- Thema (Vektorsuche auf documents) --------------------------------------

/** Anzahl Dokumente, die der Filter trifft (Platzhalter-Suche ohne Treffer, exakt). */
export async function countDocs(filter: string[]): Promise<number> {
	const result = (await getIndex().search("", { q: "", limit: 0, filter })) as unknown as {
		estimatedTotalHits?: number;
	};
	return result.estimatedTotalHits ?? Number.NaN;
}

// Serien ohne Vektoren (Ratsmanuale, LEXICAL_ONLY_SERIES): ihre Dokumente erreicht ein
// Thema nur über die Wörter seines Texts. Die Klausel trifft alle übrigen.
const VECTOR_CANDIDATE_CLAUSE =
	LEXICAL_ONLY_SERIES.length > 0 ? `series NOT IN [${LEXICAL_ONLY_SERIES.map((s) => `'${s}'`).join(", ")}]` : null;
// Gegenstück: nur die Dokumente ohne Vektor.
const VECTORLESS_CLAUSE =
	LEXICAL_ONLY_SERIES.length > 0 ? `series IN [${LEXICAL_ONLY_SERIES.map((s) => `'${s}'`).join(", ")}]` : null;

/** Ein Thema ohne Wort: was gereiht wird und womit. */
interface ThemeAlone {
	vector: number[];
	/** Anteil des Vektors (semanticRatio); mit 1 zählen die Wörter des Themas nicht. */
	ratio: number;
	/** Text des Themas; seine Inhaltswörter finden die Dokumente ohne Vektor. */
	q: string;
	filter: string[];
	attributesToSearchOn?: unknown;
}

/** Das Thema einer Suche aus ihrer Abfrage (vector, hybrid, Suchfelder). */
function themeOf(q: string, body: Record<string, unknown>, filter: string[]): ThemeAlone {
	return {
		vector: body.vector as number[],
		ratio: (body.hybrid as { semanticRatio: number }).semanticRatio,
		q,
		filter,
		attributesToSearchOn: body.attributesToSearchOn,
	};
}

/**
 * Stichwort-Suche eines Themas unter den Dokumenten ohne Vektor; null, wo es sie nicht gibt. Nach
 * seinen Inhaltswörtern, das häufigste darf fehlen – mit dem ganzen Text und «last» bestimmten die
 * ersten Wörter der Frage die Treffer («Was geschah mit den Täufern?» traf 27'774 Ratsmanuale, jetzt
 * 204; Prod 2026-11-24).
 */
function vectorlessBody(t: ThemeAlone, limit: number): ({ q: string } & Record<string, unknown>) | null {
	// Die Ratsmanuale stehen in der Lesefassung im Index (ß als ss).
	const { q } = foldRmSharpS({ q: themeKeywords(t.q), anyTerms: [], series: LEXICAL_ONLY_SERIES });
	if (!VECTORLESS_CLAUSE || t.ratio >= 1 || !q.trim()) return null;
	return {
		q,
		limit,
		filter: [...t.filter, VECTORLESS_CLAUSE],
		matchingStrategy: "frequency",
		...(t.attributesToSearchOn ? { attributesToSearchOn: t.attributesToSearchOn } : {}),
	};
}

/** Wie viele Dokumente ein Thema reihen kann: alle mit Vektor, die ohne Vektor nur als
 *  Stichwort-Treffer des Thema-Texts (wie themeAloneDocs sie in die Liste nimmt). */
async function countThemeRankable(q: string, body: Record<string, unknown>, filter: string[]): Promise<number> {
	if (!VECTOR_CANDIDATE_CLAUSE) return countDocs(filter);
	const keyword = vectorlessBody(themeOf(q, body, filter), 0);
	const [withVectors, vectorless] = await Promise.all([
		countDocs([...filter, VECTOR_CANDIDATE_CLAUSE]),
		keyword
			? (getIndex().search(keyword.q, keyword) as unknown as Promise<{ estimatedTotalHits?: number }>).then((r) => r.estimatedTotalHits ?? 0)
			: Promise.resolve(0),
	]);
	return withVectors + vectorless;
}

/** Reihenfolgen der Themen, fünf Minuten aufgehoben: Folgeseiten, Nachbarn, Sortierwechsel. */
const themeOrders = createTtlLruCache<Promise<ThemeOrder<string> | null>>({ maxEntries: 100, ttlMs: 5 * 60_000 });

/** Schlüssel einer Reihenfolge: alles, was sie bestimmt, der Vektor als Prüfsumme. */
function orderKey(vector: number[], rest: unknown): string {
	return createHash("sha1").update(Float64Array.from(vector)).update(JSON.stringify(rest)).digest("base64");
}

/**
 * Die k nächsten Dokumente unter einem Filter (wo er höchstens ein Zehntel der Vektoren trifft,
 * exakt). Dahinter hängt Meili mit Score 0 an, was der Filter sonst trifft – Dokumente ohne Vektor
 * (Ratsmanuale) –, das fällt hier weg. `watch.cut`: Meili brach die Suche ab, auch beim zweiten Mal
 * (searchTwice).
 */
async function nearestDocs(vector: number[], filter: readonly string[], k: number, watch?: { cut: boolean }): Promise<Ranked<string>[]> {
	const { result, cut } = await searchTwice(
		async () =>
			(await getIndex().search("", {
				q: "",
				vector,
				hybrid: { embedder: "jina_de", semanticRatio: 1 },
				filter: [...filter],
				limit: k,
				attributesToRetrieve: ["id"],
				showRankingScore: true,
			})) as unknown as RawSearchResult,
		"documents",
	);
	if (cut && watch) watch.cut = true;
	return rankedHits(result.hits).map((h) => ({ id: h.id, score: h._rankingScore ?? 0 }));
}

/** Trifft die Auswahl höchstens die Hälfte der Vektoren? Dann sucht Meili von sich aus breiter (themeOrder.ts). */
async function isNarrow(matches: number): Promise<boolean> {
	return matches <= (await embeddingCount()) / 2;
}

/** Reihenfolge eines Themas ohne Wort: die nächsten Dokumente, danach die ohne Vektor, die den
 *  Thema-Text als Stichwörter treffen. Lange Listen (Export) werden nicht aufgehoben. */
async function themeAloneDocs(t: ThemeAlone, need: number, max: number, narrow = false): Promise<ThemeOrder<string>> {
	const watch = { cut: false };
	const extend = (prev: ThemeOrder<string> | null) =>
		themeOrderAlone(prev, need, { max, narrow }, {
			nearest: (k) => nearestDocs(t.vector, t.filter, k, watch),
			rest: async (limit) => {
				const body = vectorlessBody(t, limit);
				if (!body) return [];
				const res = (await getIndex().search(body.q, { ...body, attributesToRetrieve: ["id"], showRankingScore: true })) as unknown as RawSearchResult;
				return res.hits.map((h) => ({ id: h.id, score: h._rankingScore ?? 0 }));
			},
		});
	if (max > THEME_LIST_MAX) return extend(null);
	const { vector, ...rest } = t;
	return cachedOrder(themeOrders, orderKey(vector, ["alone", rest]), extend, () => !watch.cut);
}

/** Reihenfolge eines Themas ohne Wort für die Trefferliste; `theme` = sein Text, `matches` = wie viele
 *  Dokumente es reihen kann (bestimmt das Suchfenster). */
export async function themeDocsAlone(
	params: SearchParams,
	opts: { vector: number[]; theme: string; matches: number; need: number; max: number },
): Promise<ThemeOrder<string>> {
	const theme: ThemeAlone = { vector: opts.vector, ratio: params.semanticRatio, q: exclusionsFirst(opts.theme), filter: buildFilter(params) };
	return themeAloneDocs(theme, opts.need, opts.max, await isNarrow(opts.matches));
}

/** So viele Kennungen nennt die Facette `id` höchstens (maxValuesPerFacet, services/indexer). */
const FACET_IDS_MAX = 1_000;
/** So viele Föderationen gleichzeitig (Kennungen der ODER-Begriffe). */
const UNION_SLICES_AT_ONCE = 8;
/** So viele Kennungen holt die gewöhnliche Suche höchstens (kalt liest sie jedes Dokument). */
const SEARCH_IDS_MAX = 20_000;

/** Reihenfolge eines Themas innerhalb der Treffer eines Worts bzw. der ODER-Begriffe (themeOrder.ts). */
export async function themeDocsWithin(
	params: SearchParams,
	opts: {
		vector: number[];
		strict: boolean;
		attributesToSearchOn?: string[];
		/** Treffer des Worts, die einen Vektor tragen. */
		withVectors: number;
		/** Treffer je Jahr (Facette der Zählung), für die Kennungen in Scheiben (hitIds.ts). */
		years: Readonly<Record<string, number>> | undefined;
		need: number;
		max: number;
	},
): Promise<ThemeOrder<string>> {
	const { vector, strict, attributesToSearchOn, withVectors, years, need, max } = opts;
	const filter = buildFilter(params);
	const union = params.anyTerms.length >= 2;
	const stage1 = async (cap: number, ...clauses: Array<string | null>): Promise<string[]> => {
		const extra = clauses.filter((c): c is string => c !== null);
		const res = union
			? await searchUnionDocIds(params, params.anyTerms, cap, attributesToSearchOn, extra)
			: await searchLexicalDocIds(params, cap, strict, attributesToSearchOn, extra);
		return res.ids;
	};
	// Alle Treffer mit Vektor über die Facette `id`, in Scheiben nach Jahren.
	const byFacet = async (slices: YearSlice[]): Promise<string[]> => {
		const filterOf = (s: YearSlice) => [...filter, ...(VECTOR_CANDIDATE_CLAUSE ? [VECTOR_CANDIDATE_CLAUSE] : []), sliceClause(s, "dateYear")];
		const searchOn = attributesToSearchOn ? { attributesToSearchOn } : {};
		if (!union) {
			const q = exclusionsFirst(params.q);
			const res = await client.multiSearch({
				queries: slices.map((s) => ({
					indexUid: MEILI_INDEX,
					q,
					limit: 0,
					filter: filterOf(s),
					facets: ["id"],
					...(strict ? { matchingStrategy: "all" as const } : {}),
					...searchOn,
				})),
			});
			return res.results.flatMap((r) => Object.keys(r.facetDistribution?.id ?? {}));
		}
		const out: string[] = [];
		for (let i = 0; i < slices.length; i += UNION_SLICES_AT_ONCE) {
			const parts = await Promise.all(
				slices.slice(i, i + UNION_SLICES_AT_ONCE).map((s) =>
					federatedSearch(
						{ offset: 0, limit: 0, facetsByIndex: { [MEILI_INDEX]: ["id"] }, mergeFacets: { maxValuesPerFacet: FACET_IDS_MAX } },
						params.anyTerms.map((t) => ({ indexUid: MEILI_INDEX, ...combineUnionQuery(t, params.q), filter: filterOf(s), ...searchOn })),
					),
				),
			);
			for (const p of parts) out.push(...Object.keys((p.facetDistribution as Record<string, Record<string, number>> | undefined)?.id ?? {}));
		}
		return out;
	};
	const allIds = (): Promise<string[] | null> =>
		years
			? collectHitIds(yearSlices(years, 0, FACET_IDS_MAX), FACET_IDS_MAX, withVectors, {
					byFacet,
					bySearch: (s) => stage1(s.count, VECTOR_CANDIDATE_CLAUSE, sliceClause(s, "dateYear")),
				})
			: Promise.resolve(null);
	const watch = { cut: false };
	const extend = (prev: ThemeOrder<string> | null) =>
		themeOrderWithin(prev, need, { withVectors, max }, {
			nearest: (k, within) => nearestDocs(vector, within ? [...filter, idInClause(within)] : filter, k, watch),
			match: (ids) => (ids.length === 0 ? Promise.resolve([]) : stage1(ids.length, idInClause(ids))),
			candidates: async (limit) =>
				(limit >= withVectors && (await allIds())) || stage1(Math.min(limit, SEARCH_IDS_MAX), VECTOR_CANDIDATE_CLAUSE),
			rest: async (limit) => (VECTORLESS_CLAUSE ? (await stage1(limit, VECTORLESS_CLAUSE)).map((id) => ({ id, score: 0 })) : []),
		});
	if (max > THEME_LIST_MAX) return extend(null);
	const key = orderKey(vector, ["within", filter, params.q, params.anyTerms, strict, attributesToSearchOn ?? null]);
	return cachedOrder(themeOrders, key, extend, () => !watch.cut);
}

/** Wie viele Treffer einer Suche einen Vektor tragen (alle ausser die der Ratsmanuale), aus ihrer Serien-Facette. */
export function hitsWithVectors(total: number, series: Record<string, number> | undefined): number {
	return LEXICAL_ONLY_SERIES.reduce((n, s) => n - (series?.[s] ?? 0), total);
}

/** Eine Seite des Themas ohne Wort: die Reihenfolge, dann nur diese Treffer formatiert. */
async function themeDocPage(
	q: string,
	body: Record<string, unknown>,
	filter: string[],
	{ offset, limit, lean }: { offset: number; limit: number; lean: boolean },
): Promise<RawSearchResult> {
	const started = performance.now();
	const end = offset + limit;
	const order = await themeAloneDocs(themeOf(q, body, filter), end, Math.max(end, THEME_LIST_MAX));
	const rankMs = Math.round(performance.now() - started);
	const page = await formatRanked(themeKeywords(q), body, order.hits.slice(offset, end), { lean });
	return {
		...page,
		estimatedTotalHits: order.hits.length,
		processingTimeMs: rankMs + (page.processingTimeMs ?? 0),
		semanticHitCount: Math.max(0, Math.min(order.ranked, end) - offset),
	};
}

/** Die Treffer einer Reihenfolge mit Feldern, Hervorhebung und Auszug der Abfrage (wie Stufe 2 in
 *  deepPage.ts); der Export (lean) braucht nur die Kennungen, wer die Auszüge selbst schneidet
 *  (plain) oder nur die Folge braucht (bare), nur die Felder. */
async function formatRanked(
	q: string,
	body: Record<string, unknown>,
	ranked: Ranked<string>[],
	{ lean, plain, bare }: { lean?: boolean; plain?: boolean; bare?: boolean },
): Promise<RawSearchResult> {
	if (lean || ranked.length === 0) return { hits: ranked.map(({ id }) => ({ id }) as SearchHit) };
	if (plain || bare) {
		const hits = await hydrateRanked(ranked, (body.attributesToRetrieve as string[] | undefined) ?? ["*"]);
		if (!bare) for (const hit of hits) hit._formatted = { title: hit.title, body: textStart(hit.body) };
		return { hits };
	}
	const page = await formatDocs(
		q,
		body,
		ranked.map((r) => r.id),
	);
	return {
		hits: inPageOrder(
			ranked.map(({ id, score }) => ({ id, _rankingScore: score })),
			page.hits,
		),
		processingTimeMs: page.processingTimeMs,
	};
}

/** Anfang eines Texts als Auszug ohne Fundstelle (rund 30 Wörter). */
function textStart(body: string | undefined): string {
	const head = (body ?? "").slice(0, 600).split(/\s+/).filter(Boolean);
	const words = head.slice(0, 30);
	return words.length === 0 ? "" : `${words.join(" ")}${head.length > words.length ? "…" : ""}`;
}

/** Die Treffer einer Reihenfolge nur mit den genannten Feldern und ihrem Score. */
async function hydrateRanked(ranked: Ranked<string>[], fields: string[]): Promise<SearchHit[]> {
	if (ranked.length === 0) return [];
	const res = (await getIndex().search("", {
		q: "",
		filter: [idInClause(ranked.map((r) => r.id))],
		limit: ranked.length,
		attributesToRetrieve: fields.includes("id") || fields.includes("*") ? fields : ["id", ...fields],
	})) as unknown as RawSearchResult;
	return inPageOrder(
		ranked.map(({ id, score }) => ({ id, _rankingScore: score })),
		res.hits,
	);
}

type SkipDimension =
	| "volumeNr"
	| "startPg"
	| "serialNr"
	| "resolutionId"
	| "years"
	| "series"
	| "date"
	| "persons"
	| "places"
	| "organizations";

export function buildFilter(p: SearchParams, skip: SkipDimension[] = []): string[] {
	const skipSet = new Set(skip);
	const clauses: string[] = [];
	const series = p.series.length > 0 ? p.series : null;
	if (series && !skipSet.has("series")) {
		const list = series.map((s) => `'${s}'`).join(", ");
		clauses.push(`series IN [${list}]`);
	}
	if (!skipSet.has("date")) {
		if (p.dateFrom != null) clauses.push(`dateYear >= ${p.dateFrom}`);
		if (p.dateTo != null) clauses.push(`dateYear <= ${p.dateTo}`);
	}
	if (!skipSet.has("volumeNr") && p.volumeNr.length > 0) {
		clauses.push(`volumeNr IN [${p.volumeNr.join(", ")}]`);
	}
	if (!skipSet.has("startPg") && p.startPg.length > 0) {
		clauses.push(`startPg IN [${p.startPg.join(", ")}]`);
	}
	if (!skipSet.has("serialNr") && p.serialNr.length > 0) {
		clauses.push(`serialNr IN [${p.serialNr.map(quoteMeili).join(", ")}]`);
	}
	if (!skipSet.has("resolutionId") && p.resolutionId.length > 0) {
		clauses.push(`resolutionId IN [${p.resolutionId.map(quoteMeili).join(", ")}]`);
	}
	if (!skipSet.has("years") && p.years.length > 0) {
		clauses.push(`dateYear IN [${p.years.join(", ")}]`);
	}
	// Namen: die Form oder derselbe Vergleichsschlüssel (lib/entityFilter.ts), solange
	// der Index die Schlüssel trägt und der Aufruf nicht exakt verlangt (API v1).
	const keyed = p.entityMatch !== "exact" && entityKeysReadyNow();
	for (const dim of ENTITY_DIMS) {
		if (skipSet.has(dim) || p[dim].length === 0) continue;
		const clause = documentEntityClause(dim, p[dim], keyed, quoteMeili);
		if (clause) clauses.push(clause);
	}
	return clauses;
}

// Meili-Filter-Syntax: einfache Anführungszeichen, eingebettete '\'-escaped.
// Backslashes selbst müssen ebenfalls escaped werden, sonst ist der Parser
// mehrdeutig.
export function quoteMeili(value: string): string {
	return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Lexikalische Treffer-IDs einer Suche (BM25, kein Vektor) bis `cap`, plus
 * `total` = echte (geschätzte) Trefferzahl unabhängig vom Deckel. Treiber des
 * kombinierten Modus „Suchbegriff filtert, Thema rankt": der Suchbegriff
 * bildet die Treffermenge, das Thema rankt darin (themeDocsWithin). Bewusst nur `id` –
 * die IDs wandern als `id IN [...]`-Filter in die Ranking-Query.
 */
export async function searchLexicalDocIds(
	params: SearchParams,
	cap: number,
	// strict: Pflicht-Terme müssen alle vorkommen (matchingStrategy:"all") – die
	// Treffermenge des Suchbegriffs ist dann striktes UND (interaktive Suche).
	strict = false,
	// attributesToSearchOn: Nur-Titel-Suche → ["title"]; die Treffermenge des
	// Suchbegriffs (die das Thema anschliessend rankt) ist dann titel-beschränkt.
	attributesToSearchOn?: string[],
	// Weitere Klauseln (Thema-Reihung, themeDocsWithin).
	extraFilter: readonly string[] = [],
): Promise<{ ids: string[]; total: number }> {
	// Ausschluss-Tokens nach vorn (Issue #112): dieselbe Query-Normalisierung
	// wie die Haupt-Query, sonst weicht die Stufe-1-ID-Menge vom Zähler ab.
	const q = exclusionsFirst(params.q);
	const body: Record<string, unknown> = {
		q,
		limit: cap,
		offset: 0,
		filter: [...buildFilter(params), ...extraFilter],
		attributesToRetrieve: ["id"],
	};
	if (strict) body.matchingStrategy = "all";
	if (attributesToSearchOn) body.attributesToSearchOn = attributesToSearchOn;
	const result = (await getIndex().search(q, body)) as unknown as {
		hits: Array<{ id: string }>;
		estimatedTotalHits?: number;
	};
	const ids = result.hits.map((h) => h.id);
	return { ids, total: result.estimatedTotalHits ?? ids.length };
}


// Aus einem resolutionId-Prefix wie "1912", "181", "1803/0003" einen
// passenden dateYear-Range-Filter ableiten – Format der resolutionId ist
// `JJJJ/NNNN`, also stehen die ersten 1–4 Ziffern für das Jahr (bzw. eine
// Jahres-Dekade/Jahrhundert wenn weniger als 4 Ziffern getippt sind).
// Beispiele:
//   "1803/0003" → dateYear = 1803
//   "1912"      → dateYear = 1912
//   "181"       → dateYear 1810..1819
//   "18"        → dateYear 1800..1899
// Liefert null wenn der Prefix nicht mit Ziffern beginnt – dann greift kein
// Year-Filter und die Suche läuft korpus-weit (vollständige Werte werden
// trotzdem über den Direct-Filter-Fallback gefunden).
function deriveYearFilter(prefix: string): string | null {
	const m = prefix.match(/^(\d{1,4})/);
	if (!m) return null;
	const digits = m[1];
	const base = Number.parseInt(digits, 10);
	const decade = 10 ** (4 - digits.length);
	const from = base * decade;
	const to = from + decade - 1;
	return from === to ? `dateYear = ${from}` : `dateYear >= ${from} AND dateYear <= ${to}`;
}

// Lexikalische Basis der Facetten-Typeaheads (searchFacetValues /
// searchStringFacetValues): dieselbe Treffermenge, die die Hauptliste
// (executeSearch) zählt – so weit ohne Thema-Auflösung möglich:
//   - `q` normalisiert (exclusionsFirst, Issue #112); `strict` schaltet
//     matchingStrategy:"all" (Pflicht-Terme, wie lexicalStrict der
//     interaktiven Suche – die öffentliche /api/v1 bleibt weich).
//   - «nur im Titel» (titleOnly) beschränkt den BM25-Arm aufs Titelfeld –
//     wie executeSearch nur, wenn es einen lexikalischen Begriff gibt.
//   - ODER-Begriffe (anyTerms): EIN Begriff wird nach q gefaltet (wie
//     executeSearch, foldSingleAnyTerm), ab 2 bildet die Stufe-1-Union die
//     Basis (`id IN […]`, ehrlich auf CORPUS_CAP gedeckelt; reale Unionen sind
//     Hunderte) – q/titleOnly stecken dann schon in den Union-Zweigen
//     (combineUnionQuery, strikt pro Zweig), die Facetten-Query läuft leer.
//     Drill-Sideways: die Union wird ohne den Filter der angefragten
//     Dimension gebildet.
// Das Thema bleibt bewusst unaufgelöst: reines Ranking ändert die Facetten-
// Mengen nicht, und der topK-Schnitt (Thema + Datums-Sort) wäre pro
// Tastendruck ein Embed+TopK-Roundtrip.
interface FacetQueryBase {
	q: string;
	extraFilter: string[];
	attributesToSearchOn?: string[];
	strict: boolean;
	// Union ohne Treffer → leere Basis; Aufrufer liefert [] ohne Facet-Call
	// (wie emptyResult der Hauptliste).
	empty: boolean;
}

export async function facetQueryBase(
	params: SearchParams,
	dimension: SkipDimension &
		("volumeNr" | "startPg" | "years" | "persons" | "places" | "organizations" | "resolutionId" | "serialNr"),
	strict: boolean,
): Promise<FacetQueryBase> {
	const { q, anyTerms } = foldRmSharpS(foldSingleAnyTerm(params), await searchTextReady());
	const hasLexical = q.trim() !== "" || anyTerms.length >= 2;
	const attributesToSearchOn = params.titleOnly && hasLexical ? docTitleFields() : undefined;

	if (anyTerms.length >= 2) {
		const { ids } = await searchUnionDocIds(
			{ ...params, q, [dimension]: [] },
			anyTerms,
			CORPUS_CAP,
			attributesToSearchOn,
		);
		if (ids.length === 0) return { q: "", extraFilter: [], strict: false, empty: true };
		return {
			q: "",
			extraFilter: [`id IN [${ids.map(quoteMeili).join(", ")}]`],
			strict: false,
			empty: false,
		};
	}

	return {
		q: exclusionsFirst(q),
		extraFilter: [],
		attributesToSearchOn,
		strict: strict && q.trim() !== "",
		empty: false,
	};
}

/**
 * Typeahead-Suche für numerische Facetten (volumeNr/startPg/years).
 * Drill-Sideways: der Filter der angefragten Dimension wird beim Counting
 * ignoriert, alle anderen aktiven Filter (Suchbegriff, Serie, Timeline-Range,
 * andere Detail-Facetten) wirken normal.
 *
 * Meili's natives `/facet-search` unterstützt nur string-Felder – diese
 * Dimensionen sind aber numerisch. Workaround: regulärer search-Call mit
 * `facets:[dim]` und `limit:0`, dann clientseitig nach prefix-Match filtern
 * und sortieren (count desc, dann numerisch aufsteigend) zurückgeben.
 *
 * facetQuery="" liefert die Top-N häufigsten Werte. facetQuery="4" liefert
 * Werte deren String-Repräsentation mit "4" beginnt, sortiert nach Count.
 *
 * Namensfilter über die Vergleichsschlüssel, sobald der Index sie trägt (Probe abwarten,
 * Rückfall auf exakt bei abgelehnter Schlüsselklausel; Rumpf in searchFacetValuesOnce).
 */
export async function searchFacetValues(...args: Parameters<typeof searchFacetValuesOnce>): ReturnType<typeof searchFacetValuesOnce> {
	await entityKeysReady();
	return withEntityKeyFallback(() => searchFacetValuesOnce(...args));
}

async function searchFacetValuesOnce(opts: {
	params: SearchParams;
	dimension: SkipDimension & ("volumeNr" | "startPg" | "years");
	facetQuery: string;
	limit?: number;
	// strict: matchingStrategy:"all" wie die interaktive Hauptliste
	// (lexicalStrict); /api/v1/facets lässt es weg (weich, wie /api/v1/documents).
	strict?: boolean;
}): Promise<Array<{ value: string; count: number }>> {
	const facetName = opts.dimension === "years" ? "dateYear" : opts.dimension;
	// Facetten-Basis = Treffermenge der Hauptliste (s. facetQueryBase).
	const base = await facetQueryBase(opts.params, opts.dimension, opts.strict ?? false);
	if (base.empty) return [];
	const filter = [...buildFilter(opts.params, [opts.dimension]), ...base.extraFilter];
	const body: Record<string, unknown> = {
		q: base.q || null,
		filter,
		facets: [facetName],
		limit: 0,
		attributesToRetrieve: [],
	};
	if (base.strict) body.matchingStrategy = "all";
	if (base.attributesToSearchOn) body.attributesToSearchOn = base.attributesToSearchOn;
	const result = (await getIndex().search(base.q, body)) as unknown as RawSearchResult;
	const dist = (result.facetDistribution?.[facetName as "series" | "dateYear"] ?? {}) as Record<string, number>;
	const prefix = opts.facetQuery.trim();
	const limit = opts.limit ?? 20;

	const entries = Object.entries(dist)
		.filter(([value]) => prefix === "" || value.startsWith(prefix));
	// Sortieren: count desc, dann numerisch aufsteigend
	entries.sort((a, b) => {
		if (b[1] !== a[1]) return b[1] - a[1];
		const na = Number.parseInt(a[0], 10);
		const nb = Number.parseInt(b[0], 10);
		return na - nb;
	});
	return entries.slice(0, limit).map(([value, count]) => ({ value, count }));
}

/**
 * Typeahead-Suche für String-Facetten:
 *   - Entity-Facetten persons/places/organizations (fuzzy, substring)
 *   - Serien-Identifier resolutionId (RRB) und serialNr (OS LS-Loseblatt)
 *     (exakter Prefix, kein Typo-Match)
 *
 * Drei Pfade je nach Dimension und Query-Status, weil Meilis Such-Primitiven
 * für die beiden Use-Cases verschieden gut funktionieren:
 *
 *   - **Empty query, alle Dimensionen**: Wir wollen die häufigsten Werte oben.
 *     `searchForFacetValues` sortiert sie bei leerem facetQuery zwar nach Anzahl,
 *     braucht dafür auf Prod aber 0,7–1,6 s (v1.57, 2026-11-24); ein regulärer
 *     search-Call mit `facets:[dim]` + Limit 0, clientseitig nach count desc, 50 ms.
 *
 *   - **Mit Query, Entity-Facetten**: `searchForFacetValues` macht substring +
 *     typo-tolerantes Matching. Bei "Mül" findet er "Müller", "Mülhauser" —
 *     genau was man bei Personennamen will.
 *
 *   - **Mit Query, resolutionId/serialNr**: Strukturierte Identifier brauchen
 *     **exaktes Prefix-Matching**. `searchForFacetValues` tokenisiert "/" als
 *     Worttrenner und sucht "1803" + "0003" separat → "1803/0003" landet nicht
 *     in den Top-Hits, dafür alle "YYYY/0003"-Varianten. Workaround: gleiche
 *     facet-distribution wie im Empty-Pfad holen und clientseitig nach Prefix
 *     filtern. Kostet einen vollen Suchcall statt facet-search, ist aber
 *     deterministisch.
 *
 * In allen Pfaden skippen wir den Filter der angefragten Dimension
 * (Drill-Sideways); die lexikalische Basis (q/strict/titleOnly/ODER-Union)
 * kommt aus facetQueryBase und spiegelt die Treffermenge der Hauptliste.
 *
 * Namensfilter über die Vergleichsschlüssel, sobald der Index sie trägt (Probe abwarten,
 * Rückfall auf exakt bei abgelehnter Schlüsselklausel; Rumpf in searchStringFacetValuesOnce).
 */
export async function searchStringFacetValues(...args: Parameters<typeof searchStringFacetValuesOnce>): ReturnType<typeof searchStringFacetValuesOnce> {
	await entityKeysReady();
	return withEntityKeyFallback(() => searchStringFacetValuesOnce(...args));
}

async function searchStringFacetValuesOnce(opts: {
	params: SearchParams;
	dimension: "persons" | "places" | "organizations" | "resolutionId" | "serialNr";
	facetQuery: string;
	limit?: number;
	// strict: matchingStrategy:"all" wie die interaktive Hauptliste
	// (lexicalStrict); /api/v1/facets lässt es weg (weich, wie /api/v1/documents).
	strict?: boolean;
}): Promise<Array<{ value: string; count: number }>> {
	const limit = opts.limit ?? 20;
	const trimmed = opts.facetQuery.trim();
	// Facetten-Basis = Treffermenge der Hauptliste (s. facetQueryBase); gilt
	// für alle drei Pfade unten.
	const base = await facetQueryBase(opts.params, opts.dimension, opts.strict ?? false);
	if (base.empty) return [];
	const filter = [...buildFilter(opts.params, [opts.dimension]), ...base.extraFilter];
	const q = base.q;
	// Gemeinsamer Query-Rumpf der Facet-Distribution-Calls (strict/titleOnly
	// müssen in JEDEM Call stecken, sonst weicht die Basis wieder ab).
	const baseBody = (): Record<string, unknown> => {
		const b: Record<string, unknown> = { q: q || null, limit: 0, attributesToRetrieve: [] };
		if (base.strict) b.matchingStrategy = "all";
		if (base.attributesToSearchOn) b.attributesToSearchOn = base.attributesToSearchOn;
		return b;
	};
	const isStructuredId = opts.dimension === "resolutionId" || opts.dimension === "serialNr";

	if (!trimmed || isStructuredId) {
		// resolutionId-Nummern-Prefix `JJJJ/<Ziffern>`: ein einzelnes Jahr hat bis
		// zu ~4700 Beschlüsse, also kappt maxValuesPerFacet=1000 alle Werte
		// ausserhalb der alphabetisch niedrigsten Nummern weg – "1958/4" fände
		// nichts, obwohl 1958/4023 existiert. Lösung: aus dem getippten Prefix die
		// passenden numerischen Voll-IDs ableiten und per `resolutionId IN [...]`
		// das Fenster aufs richtige Wertesegment verschieben. Wir vereinigen
		// dabei zwei facet-Probes:
		//   1. das Jahres-Fenster (deckt Buchstaben-Suffix-Geschwister wie
		//      "1848/0001a" in dünn besetzten Frühjahren ab, die komplett ins
		//      Fenster passen, aber nicht in der numerischen Kandidatenliste stehen),
		//   2. das numerische IN-Fenster (erreicht tiefe Nummern in dicht
		//      besetzten Jahren – der eigentliche Fix).
		const candidates =
			opts.dimension === "resolutionId" ? resolutionIdCandidates(trimmed) : null;
		if (candidates) {
			const inList = candidates.ids.map(quoteMeili).join(", ");
			const variants = [
				[...filter, `dateYear = ${candidates.year}`],
				[...filter, `dateYear = ${candidates.year}`, `resolutionId IN [${inList}]`],
			];
			const merged = new Map<string, number>();
			for (const variantFilter of variants) {
				const result = (await getIndex().search(q, {
					...baseBody(),
					filter: variantFilter,
					facets: [opts.dimension],
				})) as unknown as {
					facetDistribution?: Record<string, Record<string, number>>;
				};
				const dist = result.facetDistribution?.[opts.dimension] ?? {};
				for (const [value, count] of Object.entries(dist)) {
					if (value.startsWith(trimmed)) {
						merged.set(value, Math.max(merged.get(value) ?? 0, count));
					}
				}
			}
			// count desc, dann Wert aufsteigend (genullte Nummern sortieren
			// alphabetisch = numerisch; Suffixe wie "1848/0001a" landen direkt
			// hinter ihrer Basis "1848/0001").
			return [...merged.entries()]
				.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
				.slice(0, limit)
				.map(([value, count]) => ({ value, count }));
		}

		// Reiner Jahres-/Dekaden-Prefix ohne Slash+Ziffer (z. B. "1912", "181"):
		// daraus einen dateYear-Range ableiten und den Filter einengen – dann
		// passt der Wertebereich der einen Dekade bzw. des einen Jahres eher
		// unter 1000. (serialNr und leere Query laufen ohne Year-Filter.)
		const yearFilter =
			opts.dimension === "resolutionId" ? deriveYearFilter(trimmed) : null;
		const effectiveFilter = yearFilter ? [...filter, yearFilter] : filter;
		const body: Record<string, unknown> = {
			...baseBody(),
			filter: effectiveFilter,
			facets: [opts.dimension],
		};
		const result = (await getIndex().search(q, body)) as unknown as {
			facetDistribution?: Record<string, Record<string, number>>;
		};
		const dist = result.facetDistribution?.[opts.dimension] ?? {};
		const entries = Object.entries(dist).filter(
			([value]) => trimmed === "" || value.startsWith(trimmed),
		);
		const fromDist = entries
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit)
			.map(([value, count]) => ({ value, count }));

		// Bei strukturierten IDs (Wertbestand >> maxValuesPerFacet=1000) kann der
		// exakte Match auch mit Year-Filter aus dem Sample rausfallen
		// (z. B. wenn ein Jahr mehr als 1000 Beschlüsse hat und der Wert spät im
		// Alphabet liegt). Direkter Filter-Test als Fallback: existiert
		// resolutionId/serialNr exakt = trimmed? Wenn ja, oben rein.
		if (isStructuredId && trimmed) {
			const alreadyPresent = fromDist.some((h) => h.value === trimmed);
			if (!alreadyPresent) {
				const exactFilter = [...filter, `${opts.dimension} = ${quoteMeili(trimmed)}`];
				const exactResult = (await getIndex().search(q, {
					...baseBody(),
					filter: exactFilter,
				})) as unknown as RawSearchResult;
				const count = exactResult.estimatedTotalHits ?? 0;
				if (count > 0) {
					return [{ value: trimmed, count }, ...fromDist].slice(0, limit);
				}
			}
		}
		return fromDist;
	}

	const args: Record<string, unknown> = {
		facetName: opts.dimension,
		facetQuery: trimmed,
		q: q || null,
		filter,
	};
	// /facet-search ehrt matchingStrategy + attributesToSearchOn (Meili v1.13,
	// am Mirror verifiziert) – gleiche Basis wie die Distribution-Pfade oben.
	if (base.strict) args.matchingStrategy = "all";
	if (base.attributesToSearchOn) args.attributesToSearchOn = base.attributesToSearchOn;
	const result = (await getIndex().searchForFacetValues(
		args as Parameters<ReturnType<typeof getIndex>["searchForFacetValues"]>[0],
	)) as { facetHits?: Array<{ value: string; count: number }> };
	return (result.facetHits ?? []).slice(0, limit);
}

function mapSort(sort: SearchParams["sort"]): string[] {
	// Sekundär nach `startPg:asc`: bei Datums-Sort haben viele Docs (v. a. ABl
	// einer Ausgabe) identischen `date`-Wert. Ohne Sekundärschlüssel bricht
	// Meili über die interne Doc-Order – effektiv lexikografisch über die ID,
	// was z. B. ABl_1930__S__199_ vor ABl_1930__S__2_ einsortiert. Innerhalb
	// derselben Ausgabe ist die Lesereihenfolge immer aufsteigend, auch wenn
	// die Ausgaben absteigend nach Datum gelistet sind.
	switch (sort) {
		case "date_asc":
			return ["date:asc", "startPg:asc"];
		case "date_desc":
			return ["date:desc", "startPg:asc"];
		default:
			return [];
	}
}

export async function getDocument(id: string): Promise<SearchHit | null> {
	// Vor der Anfrage prüfen: meilisearch-js setzt die ID unkodiert in die Adresse.
	if (!isDocumentId(id)) return null;
	return orNull(getIndex().getDocument(id) as Promise<SearchHit>);
}

/** Nur der Volltext eines Dokuments. */
export async function getDocumentBody(id: string): Promise<string | null> {
	if (!isDocumentId(id)) return null;
	const doc = await orNull(getIndex().getDocument(id, { fields: ["body"] }) as Promise<Pick<SearchHit, "body">>);
	return doc?.body ?? null;
}

/**
 * Lädt Dokumente anhand ihrer Staatsarchiv-Katalog-ID (`archiveId`). Dient der
 * Auflösung von Querverweisen (`relations.targetId`) auf interne Detailseiten –
 * Ziele, die nicht im Korpus liegen, fehlen im Ergebnis (Loader fällt dann auf
 * den externen Katalog-Link zurück). Nur Metadaten, kein Body.
 */
export async function findByArchiveIds(ids: number[]): Promise<SearchHit[]> {
	const unique = [...new Set(ids.filter((n) => Number.isFinite(n)))];
	if (unique.length === 0) return [];
	const body = {
		q: "",
		filter: [`archiveId IN [${unique.join(", ")}]`],
		limit: unique.length,
		attributesToRetrieve: ["id", "series", "title", "date", "stazhIdent", "archiveId"],
	};
	const result = (await getIndex().search("", body)) as unknown as { hits: SearchHit[] };
	return result.hits;
}

/**
 * Lädt Dokumente anhand ihrer IDs (Hydrierung beim Treffer-Export: erst die
 * geordnete ID-Liste, dann die Felder batchweise). Nur Such-Berechtigung nötig
 * (`id IN […]`-Filter, Muster findByArchiveIds). Reihenfolge der Antwort ist
 * NICHT die der IDs – der Aufrufer ordnet (orderByIds); fehlende IDs (seit dem
 * ID-Pass gelöschte Docs) fehlen einfach.
 */
export async function fetchDocsByIds(
	ids: string[],
	attributesToRetrieve: string[],
	signal?: AbortSignal,
): Promise<SearchHit[]> {
	if (ids.length === 0) return [];
	const body = {
		q: "",
		filter: [`id IN [${ids.map(quoteMeili).join(", ")}]`],
		limit: ids.length,
		attributesToRetrieve,
	};
	const result = (await getIndex().search("", body, signal ? { signal } : undefined)) as unknown as {
		hits: SearchHit[];
	};
	return result.hits;
}

// --- Chunk-Index (Passagen-Ebene: MCP passage_search und vector_search) ------

export interface ChunkHit {
	id: string;
	docId: string;
	series: SeriesAbbr;
	title: string;
	date: string | null;
	dateYear: number | null;
	stazhIdent: string | null;
	subset: string | null;
	chunkText: string;
	_rankingScore?: number;
}

function getChunksIndex() {
	return client.index(MEILI_CHUNK_INDEX);
}

let cachedChunksReady: boolean | null = null;
let chunksCachedAt = 0;

/**
 * true, wenn der `chunks`-Index existiert und Embeddings enthält – sonst meldet
 * passage_search «nicht verfügbar» (Muster indexHasEmbeddings, 30-s-Cache).
 */
export async function chunkIndexReady(): Promise<boolean> {
	const now = Date.now();
	if (cachedChunksReady !== null && now - chunksCachedAt < CACHE_MS) {
		return cachedChunksReady;
	}
	try {
		const stats = await getChunksIndex().getStats();
		const s = stats as unknown as { numberOfDocuments?: number; numberOfEmbeddings?: number };
		cachedChunksReady = (s.numberOfDocuments ?? 0) > 0 && (s.numberOfEmbeddings ?? 0) > 0;
	} catch {
		cachedChunksReady = false;
	}
	chunksCachedAt = now;
	return cachedChunksReady;
}

// Chunk-Retrieval ist primär semantisch: die Frage ist ein ganzer Satz,
// dessen Füllwörter bei BM25 auf kurzen Chunks viel Rauschen erzeugen.
// 0.9 lässt exakte Wort-/Zahlen-Treffer als Tie-Breaker mitspielen.
const CHUNK_SEMANTIC_RATIO = 0.9;

export async function searchChunks(opts: {
	q: string;
	// null/leer = rein lexikalisch (BM25) – für die Stichwort-Tranche der Passagen-
	// Suche; mit Vektor hybrid mit CHUNK_SEMANTIC_RATIO.
	vector?: number[] | null;
	series?: SeriesAbbr[];
	dateFrom?: number | null;
	dateTo?: number | null;
	// Zusätzliche rohe Filterklauseln (AND).
	extraFilter?: string[];
	// Benannter Meili-Embedder für den Vektor-Arm (Default jina_de). qwen3_06b
	// nutzt das MCP-Tool vector_search (Query-Vektor kommt von aussen).
	embedder?: string;
	// Gewicht des Vektor-Arms (Default CHUNK_SEMANTIC_RATIO; 1 = pure Vektorsuche).
	semanticRatio?: number;
	// Meilis Wort-Streichung, wenn nicht alle Wörter vorkommen (Default "last":
	// vom Ende her). Die Passagen-Suche setzt "frequency" (häufigste zuerst) – bei
	// Stichwörtern aus einer Frage stünde das Thema sonst oft zuletzt und fiele
	// zuerst («meldete Cholera»). Gilt auch für den Stichwort-Arm der Hybrid-Suche.
	matchingStrategy?: "last" | "all" | "frequency";
	limit: number;
}): Promise<{ hits: ChunkHit[]; partial: boolean }> {
	const filter: string[] = [];
	if (opts.series && opts.series.length > 0) {
		filter.push(`series IN [${opts.series.map((s) => `'${s}'`).join(", ")}]`);
	}
	if (opts.dateFrom != null) filter.push(`dateYear >= ${opts.dateFrom}`);
	if (opts.dateTo != null) filter.push(`dateYear <= ${opts.dateTo}`);
	if (opts.extraFilter) filter.push(...opts.extraFilter);
	// Ausschluss-Tokens nach vorn (Issue #112).
	const q = exclusionsFirst(opts.q);
	const body: Record<string, unknown> = {
		q,
		limit: opts.limit,
		filter,
		showRankingScore: true,
	};
	if (opts.matchingStrategy) body.matchingStrategy = opts.matchingStrategy;
	const vector = opts.vector && opts.vector.length > 0 ? opts.vector : null;
	if (!vector) return { hits: (await runChunkQuery(body)).hits, partial: false };
	const embedder = opts.embedder ?? "jina_de";
	const semanticRatio = opts.semanticRatio ?? CHUNK_SEMANTIC_RATIO;
	const hasWords = q.trim() !== "";
	// semanticRatio 1 = rein semantisch (kein Stichwort-Arm).
	const vectorBody = { ...body, q: "", vector, hybrid: { embedder, semanticRatio: 1 } };
	const hybridBody = hasWords ? { ...body, vector, hybrid: { embedder, semanticRatio } } : vectorBody;
	// Abbruch erkennen und nachholen, sonst als unvollständig kennzeichnen: vectorCutoff.ts.
	return searchVectors<ChunkHit>({
		search: (signal) => runChunkQuery(hybridBody, signal),
		vectorOnly: (signal) => runChunkQuery(vectorBody, signal),
		...(hasWords ? { keywordOnly: () => runChunkQuery(body) } : {}),
	});
}

async function runChunkQuery(body: Record<string, unknown>, signal?: AbortSignal): Promise<VectorResult<ChunkHit>> {
	return (await getChunksIndex().search(
		body.q as string,
		body,
		signal ? { signal } : undefined,
	)) as unknown as VectorResult<ChunkHit>;
}

export async function findSimilar(opts: {
	id: string;
	limit: number;
	vector: number[];
}): Promise<SearchHit[]> {
	// Breiter suchen als zeigen: die Vektorsuche übersieht sonst nahe Dokumente (themeOrder.ts).
	const near = await nearestDocs(opts.vector, [`id != ${quoteMeili(opts.id)}`], vectorWindow(opts.limit));
	const body = {
		q: "",
		vector: opts.vector,
		hybrid: { embedder: "jina_de", semanticRatio: 1 },
		// Nur Metadaten + gecropte Body-Preview zurück (kein voller Body)
		attributesToRetrieve: [
			"id",
			"series",
			"title",
			"date",
			"dateYear",
			"volumeNr",
			"serialNr",
			"resolutionId",
			"startPg",
			"subset",
			"stazhIdent",
			"manifestUrl",
		],
		attributesToCrop: ["body"],
		cropLength: 40,
		showRankingScore: true,
	};
	return (await formatRanked("", body, near.slice(0, opts.limit), {})).hits;
}
