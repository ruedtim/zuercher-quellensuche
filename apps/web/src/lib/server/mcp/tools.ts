// I/O-Adapter des MCP-Servers: runMcpTool bildet jedes Tool auf die bestehenden
// Retrieval-Funktionen ab (searchDocuments/getDocument/getCorpusYearDistribution/
// findSimilar/searchPassages/queryCatalog …) und formt SAUBERES strukturiertes
// JSON. Dokument-Objekte gehen durch dieselben Allowlist-Mapper wie /api/v1
// (toListHit/toDetailDoc) ⇒ byte-identische Ausgabe, eine Allowlist zu
// auditieren, kein Leak interner Felder. Wo eine Suche leer bleibt oder eine
// Zahl täuschen kann, liefern die Werkzeuge Hinweise fürs Modell (`hint`,
// `caveat`, `note`) – das Wissen des früheren Recherche-Modus der Website (bis
// 2026-11, Branch archiv/ki-antwort). Reine Bausteine (Normalizer, Hinweistexte)
// kommen aus searchTools.ts; dieses Modul zieht über meili/embed den `$env`-Pfad
// und ist daher nicht direkt tsx-testbar – die Logik ist bewusst dünn.

import {
	docTitleFields,
	searchDocuments,
	getDocument,
	getCorpusYearDistribution,
	findSimilar,
	indexHasEmbeddings,
	searchChunks,
	chunkIndexReady,
} from "../meili";
import { alignChunk, ALIGNED_TEXT_CAP } from "../chunkAlign";
import { embedQuery } from "../embed";
import { SERIES_LABEL, isLexicalOnlySeries, type SearchHit, type SeriesAbbr } from "$lib/types";
import { LIST_HIT_ATTRIBUTES, toApiEditions, toListHit, toDetailDoc } from "../apiV1/respond";
import { mapConcurrent } from "../concurrent";
import { editionLinksForCatalog, editionLinksForDocument } from "../editionLinks";
import { resolveApiRelations } from "../relations";
import {
	aggregateSearch,
	aggregateYearDist,
	asString,
	catalogExactLast,
	catalogPrefixNote,
	clampCatalogYear,
	clampListLimit,
	clampOffset,
	clampPassageOffset,
	clampTopK,
	clampYear,
	countAggregate,
	exactProbeQuery,
	exactWrap,
	fieldAttrs,
	fetchText,
	FETCH_TEXT_MAX,
	inflationHint,
	isLexicalOnlyScope,
	lexicalQuery,
	mergeRoundRobin,
	mergeRoundRobinPage,
	normalizeSeries,
	normalizeSort,
	normalizeTerms,
	PAGE_WINDOW_MAX,
	PASSAGE_WINDOW_MAX,
	preModernTimelineNote,
	queryWords,
	rankingSearch,
	semanticCatalogText,
	timelineCoverageCaveat,
	topYearsByCount,
	zeroHitHint,
	type ZeroHitProbe,
} from "../searchTools";
import { searchPassages } from "../passageSearch";
import {
	alternativesCountOutput,
	alternativesSearchOutput,
	mcpCatalogFilters,
	parseDocumentUri,
	type McpResourceContents,
	type McpToolOutput,
} from "./protocol";
import { buildCoverage, COVERAGE_URI, yearRuns, type CoverageReport, type CoverageSeries } from "./coverage";
import { getSeriesInfo, getSeriesYearDistributions } from "../apiV1/series";
import { type EditionKey } from "../../editions";
import {
	catalogFetchText,
	editionFetchText,
	ehedatenFetchText,
	federatedFetchDoc,
	federatedId,
	federatedSearchOutput,
	leanCatalogResult,
	parseFederatedId,
	type FederatedBlock,
	type FederatedCollection,
} from "./federated";
import { catalogHasVectors, catalogReady, getCatalogUnit, nearestCatalogUnits, queryCatalog } from "../catalog";
import { toCatalogItem } from "../apiV1/catalog";
import { CATALOG_NOTE, CATALOG_SOURCE, EDITIONS_NOTE, EHEDATEN_NOTE } from "../apiV1/constants";
import { ehedatenReady, getEhedatenEntry, queryEhedaten, sameMarriages } from "../ehedaten";
import { namesakeNote, normalizeEhedatenArgs } from "../ehedatenTool";
import { ehedatenFacetsMeta, toEhedatenItem } from "../apiV1/ehedaten";
import { ART_LABEL, EHEDATEN_ATTRIBUTION, EHEDATEN_LICENSE, EHEDATEN_LICENSE_URL, EHEDATEN_SOURCE_URL } from "../../ehedaten";
import { INDEXED_EDITIONS, isIndexedEdition } from "../../editionTexts";
import { editionsHaveVectors, editionsReady, getEditionUnit, queryEditions } from "../editionTexts";
import { normalizeEditionArgs } from "../editionTool";
import { toEditionItem, toEditionListItem } from "../apiV1/editions";
import {
	editionRights,
	leanCatalogItem,
	leanEditionItem,
	leanEhedatenItem,
	leanListHit,
	MCP_CATALOG_NOTE,
	MCP_EDITIONS_NOTE,
	MCP_EHEDATEN_NOTE,
} from "./lean";

// Treffer-Decken: grosszügiger als der single-shot-RAG, aber unter dem
// /api/v1-LIMIT_MAX (100). Default 10, hart bei 25.
const RESULT_LIMIT_DEFAULT = 10;
const RESULT_LIMIT_MAX = 25;
const SIMILAR_LIMIT_MAX = 50;
// overview: nur eine kleine Vorschau der Top-Treffer (Schwerpunkt sind die
// Aggregate total/bySeries/byYear). fetch_many: Batch-Decke gegen Kostenexplosion.
const OVERVIEW_TOP_N = 5;
const FETCH_MANY_MAX = 10;
// vector_search (für Partner-Systeme): Passagen-Suche per extern
// berechnetem Qwen3-Embedding-0.6B-Query-Vektor im chunks-Index, beschränkt
// auf den Staatsarchiv-Bestand (subset IS NULL = ohne krp-/rrb-/os-late).
const QWEN_EMBEDDER = "qwen3_06b";
const QWEN_DIM = 1024;
const VECTOR_LIMIT_MAX = 50;
// Volltexte, die ein Aufruf gleichzeitig lädt (Ausrichten der Passagen).
const PARENT_CONCURRENCY = 6;
const NON_LATE_FILTER = "subset IS NULL";

/** Facetten-Verteilung ohne Nullwerte (Meili listet auch leere Werte). */
function positiveCounts(dist: Record<string, number> | undefined): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, c] of Object.entries(dist ?? {})) if (c > 0) out[k] = c;
	return out;
}

function webUrl(hit: SearchHit, base: string): string {
	return `${base}/documents/${hit.series}/${encodeURIComponent(hit.id)}`;
}

// Reicher Treffer fürs MCP: /api/v1-Allowlist (toListHit, mit score/excerpt/
// date/series) PLUS top-level `url` (ChatGPT-Konvention). Nur noch vector_search
// liefert diese volle Form (s. toolVectorSearch).
function fullListHit(hit: SearchHit, base: string): Record<string, unknown> {
	return { ...toListHit(hit, base), url: webUrl(hit, base) };
}

// Schlanke Form für die LLM-Werkzeuge: Projektion über dieselbe Allowlist
// (leanListHit in lean.ts – ohne /api/v1-Links, ohne das doppelte `url`, ohne
// leere Felder, Score gerundet). search/semantic_search/keyword_search/
// similar_documents/overview liefern damit weiterhin EINE gemeinsame Form.
function listHit(hit: SearchHit, base: string): Record<string, unknown> {
	return leanListHit(fullListHit(hit, base));
}

// Volltext-Dokument (fetch/fetch_many): identische Form, eine Definition.
async function buildFetchDoc(doc: SearchHit, base: string): Promise<Record<string, unknown>> {
	// Link-Bündel via /api/v1-Mapper (html/xml/iiif/zip/similar), Rest ChatGPT-Form.
	const detail = toDetailDoc(doc, base) as { links: Record<string, unknown> };
	// Querverweise wie in /api/v1 auflösen (identische Objekte) – interner Link,
	// wenn das Ziel im Korpus liegt, sonst externer Katalog-Link.
	const relations = await resolveApiRelations(doc, base);
	// Ratsmanuale: edierte Einträge der Sitzung (QZH, Zürcher Rechtsquellen) wie in /api/v1.
	const editions = toApiEditions(editionLinksForDocument(doc.id));
	const { text, truncated } = fetchText(doc.body ?? "");
	return {
		id: doc.id,
		title: doc.title,
		text,
		...(truncated
			? {
					note:
						`Text nach ${FETCH_TEXT_MAX.toLocaleString("de-CH")} Zeichen gekürzt (Dokument hat ${truncated.toLocaleString("de-CH")}). ` +
						"Den ganzen Text liefern links.xml (TEI) und links.html; gezielte Stellen findet passage_search.",
				}
			: {}),
		url: webUrl(doc, base),
		metadata: {
			// Welcher Bestand – `fetch` löst auch Katalogeinheiten, Eheeinträge und
			// Editionsstücke auf (mcp/federated.ts).
			collection: "documents",
			series: doc.series,
			seriesLabel: SERIES_LABEL[doc.series],
			date: doc.date ?? null,
			dateYear: doc.dateYear ?? null,
			// Signatur des Staatsarchivs fürs Zitat («StAZH MM 3.161 RRB 1981/0243»).
			stazhIdent: doc.stazhIdent ?? null,
			persons: doc.persons ?? [],
			places: doc.places ?? [],
			organizations: doc.organizations ?? [],
			relations,
			editions,
			links: detail.links,
		},
	};
}

// Vektor nur, wenn semantisch gewünscht UND der Index Embeddings hat (sonst
// würde Meili den Hybrid-Call ablehnen); embed-Service down ⇒ null ⇒ BM25.
async function maybeVector(text: string, want: boolean): Promise<number[] | null> {
	if (!want || !text.trim()) return null;
	if (!(await indexHasEmbeddings())) return null;
	return embedQuery(text);
}

async function docSearch(
	query: string,
	opts: {
		series: SeriesAbbr[];
		dateFrom: number | null;
		dateTo: number | null;
		sort: "relevance" | "date_asc" | "date_desc";
		topK: number;
		semantic: boolean;
		// Paginierung: erst offset+topK holen, dann offset abschneiden (Muster
		// apiV1/params.ts). offset+topK ist auf PAGE_WINDOW_MAX gedeckelt.
		offset?: number;
		// field=title ⇒ ["title"] (nur Titel durchsuchen); sonst undefined.
		attributesToSearchOn?: string[];
	},
): Promise<{ hits: SearchHit[]; total: number }> {
	// Nur Ratsmanuale im Filter (Serie RM bzw. Zeitraum vor 1803): keine Vektoren –
	// semantisch heisst dort lexikalisch, ohne Embedding-Aufruf.
	const vector = await maybeVector(query, opts.semantic && !isLexicalOnlyScope(opts.series, opts.dateTo));
	const offset = opts.offset ?? 0;
	const pageSize = Math.min(offset + opts.topK, PAGE_WINDOW_MAX);
	// keyword_search verlangt alle Wörter (rankingSearch) – auch für total.
	const [params, searchOpts] = rankingSearch({
		kind: opts.semantic ? "semantic" : "keyword",
		q: query,
		vector,
		sort: opts.sort,
		pageSize,
		series: opts.series,
		dateFrom: opts.dateFrom,
		dateTo: opts.dateTo,
		attributesToSearchOn: opts.attributesToSearchOn,
	});
	// Ohne Volltexte: Das Fenster umfasst bis 1000 Dokumente, die Treffer brauchen nur Angaben und Auszug.
	const res = await searchDocuments(params, { ...searchOpts, attributesToRetrieve: LIST_HIT_ATTRIBUTES });
	return { hits: offset > 0 ? res.hits.slice(offset) : res.hits, total: res.estimatedTotalHits };
}

// --- Gegenproben bei 0 Treffern ------------------------------------------------

interface ProbeFilters {
	series: SeriesAbbr[];
	dateFrom: number | null;
	dateTo: number | null;
}

/** Doc-Level-Zählung (BM25, ohne Bodies, alle Wörter) samt Serien-Verteilung. */
function countHits(q: string, f: ProbeFilters, attributesToSearchOn?: string[]): Promise<{ total: number; bySeries: Record<string, number> }> {
	return countAggregate(searchDocuments, { q, ...f, attributesToSearchOn });
}

/** Gegenproben für eine Suche ohne Treffer: dieselbe Suche OHNE Serie, Phrase bzw.
 *  Zeitraum gezählt (billige Zählungen, parallel), dazu jedes Wort einzeln. Bei der
 *  Suche nach Bedeutung heisst «leer» nur «die Filter enthalten keine Dokumente» – dort
 *  zählt die Probe den Filter allein. Bei Zählung und Zeitleiste ("count") sind Serie und
 *  Zeitraum meist gewollt (0 ist dann die Antwort) – dort nur Phrase und Wörter. Fehler
 *  einzelner Proben werden verschluckt (die Diagnose ist ein Zusatz). Muster: der frühere
 *  Recherche-Modus der Website (bis 2026-11, Branch archiv/ki-antwort). */
async function zeroHitProbes(
	kind: "semantic" | "keyword" | "list" | "count",
	query: string,
	phrase: boolean,
	exact: boolean,
	f: ProbeFilters,
	attributesToSearchOn?: string[],
): Promise<ZeroHitProbe[]> {
	const q = lexicalQuery(query, phrase, exact);
	const hasDates = f.dateFrom != null || f.dateTo != null;
	const filterProbes = kind !== "count";
	const tasks: Array<Promise<ZeroHitProbe>> = [];
	if (kind === "semantic") {
		if (f.series.length > 0 || hasDates) tasks.push(countHits("", f).then((r) => ({ kind: "filters", total: r.total })));
	} else {
		if (filterProbes && f.series.length > 0) {
			tasks.push(countHits(q, { ...f, series: [] }, attributesToSearchOn).then((r) => ({ kind: "series", ...r })));
		}
		// Lockerung der exakten Schreibung: greift für phrase UND exact, sobald die
		// Hauptsuche eine andere Query schickt als die getippte («"Veloweg"» 0, aber
		// «Veloweg» findet «Velowege»). Bis 2026-11 nur bei mehrwortigen Phrasen –
		// einwortige waren ein No-op.
		if (q !== query.trim()) {
			tasks.push(countHits(query, f, attributesToSearchOn).then((r) => ({ kind: "phrase", total: r.total })));
		}
		if (filterProbes && hasDates) {
			tasks.push(countHits(q, { ...f, dateFrom: null, dateTo: null }, attributesToSearchOn).then((r) => ({ kind: "dates", ...r })));
		}
		// Bei exact=true zählt jedes Wort einzeln ebenfalls exakt – sonst stünden im
		// Hinweis die toleranten Zahlen einer Suche, die exakt 0 Treffer hatte.
		const words = queryWords(query).map((w) => exactWrap(w, exact));
		if (words.length > 1) {
			tasks.push(
				Promise.all(words.map((word) => countHits(word, f, attributesToSearchOn).then((r) => ({ word, total: r.total })))).then(
					(counts): ZeroHitProbe => ({ kind: "words", total: 0, words: counts }),
				),
			);
		}
	}
	const settled = await Promise.allSettled(tasks);
	return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
}

/** Hinweis-Text bei 0 Treffern ("" = nichts zu melden). */
async function zeroHint(
	kind: Parameters<typeof zeroHitProbes>[0],
	query: string,
	phrase: boolean,
	exact: boolean,
	f: ProbeFilters,
	attributesToSearchOn?: string[],
): Promise<string> {
	return zeroHitHint(await zeroHitProbes(kind, query, phrase, exact, f, attributesToSearchOn));
}

// --- Gegenprobe «genau so geschrieben» (Treffer-Inflation) --------------------

/** Zählt dieselbe Suche mit Wort-für-Wort zitierter Query und denselben Filtern –
 *  derselbe billige Zählpfad wie die Null-Treffer-Proben. Die Aufrufer starten sie
 *  PARALLEL zur Hauptsuche (Promise.all, nie seriell): es ist eine eigene
 *  Meili-Query und bei kaltem Cache nicht billig (CLAUDE.md «Meili-Eigenheiten»).
 *  Leeres `probeQ` (nichts zu prüfen) oder ein Fehler ⇒ null ⇒ kein `exactTotal`
 *  und kein Hinweis; das Hauptergebnis darf daran nie scheitern. */
function exactCount(probeQ: string, f: ProbeFilters, attributesToSearchOn?: string[]): Promise<number | null> {
	if (!probeQ) return Promise.resolve(null);
	return countHits(probeQ, f, attributesToSearchOn).then(
		(r) => r.total,
		(err: unknown) => {
			console.warn(`[mcp] Exakte Gegenprobe gescheitert: ${(err as Error).message}`);
			return null;
		},
	);
}

/** `exactTotal` (immer, wenn die Gegenprobe lief) plus `hint`, wenn der
 *  Unterschied wesentlich ist (inflationHint). Nur bei Treffern – 0 Treffer sind
 *  Sache des Null-Treffer-Hinweises, die beiden Fälle schliessen sich aus. */
function exactFields(total: number, exactTotal: number | null): Record<string, unknown> {
	if (exactTotal == null || total <= 0) return {};
	const hint = inflationHint(total, exactTotal);
	return { exactTotal, ...(hint ? { hint } : {}) };
}

// --- search: föderierter Einstieg über alle Bestände -------------------------

// Treffer je Bestand und Arm: bewusst klein. `search` ist der Einstieg und zeigt, WO
// etwas liegt (dazu `totals` mit den Grössenordnungen); vertieft wird mit den Werkzeugen
// des Bestands. Zusammen höchstens 24 Treffer.
const FED_DOC_KEYWORD = 5;
const FED_DOC_SEMANTIC = 5;
const FED_CATALOG_KEYWORD = 5;
const FED_CATALOG_SEMANTIC = 3;
const FED_EHEDATEN = 3;
const FED_EDITIONS = 3;

/** Katalog-Filter ohne jede Einschränkung: `search` filtert nicht (Zeitraum, Stufe,
 *  Namen kennt catalog_search). Frisches Objekt je Abfrage. */
function fedCatalogFilters() {
	return {
		active: true,
		dateFrom: null,
		dateTo: null,
		level: [] as string[],
		bestand: [] as string[],
		digital: false,
		entities: { person: [] as string[], place: [] as string[], org: [] as string[] },
	};
}

/** Eine Abfrage von `search`: ein Ausfall (Meili 400/408, Suchschlüssel ohne Scope) fällt
 *  als null heraus und macht höchstens ihren Bestand zu `unavailable`, statt den
 *  Werkzeug-Aufruf scheitern zu lassen – wie `overviewBlock` im Reiter «Alle Quellen». */
async function fedBlock<T>(label: string, run: Promise<T>): Promise<T | null> {
	try {
		return await run;
	} catch (err) {
		console.error(`[mcp] search: ${label} nicht lesbar:`, err);
		return null;
	}
}

const fedFailed = (collection: FederatedCollection): FederatedBlock => ({ collection, total: null, results: [], unavailable: "failed" });
const fedMissing = (collection: FederatedCollection): FederatedBlock => ({ collection, total: null, results: [], unavailable: "not_available" });

/** Dokumente (Zentrale Serien samt Ratsmanualen), beide Arme: wörtlich (BM25, alle Wörter –
 *  `total` ist die echte Trefferzahl) und nach Bedeutung (Hybrid 0.7, ohne Trefferzahl, weil
 *  Meilis Schätzung dort korpus-weit ist). Ein Dokument, das beide Arme liefern, bleibt
 *  wörtlich. */
async function fedDocuments(query: string, base: string): Promise<FederatedBlock> {
	const common = { series: [] as SeriesAbbr[], dateFrom: null, dateTo: null, sort: "relevance" as const };
	const [lex, sem] = await Promise.all([
		fedBlock("Dokumente wörtlich", docSearch(query, { ...common, topK: FED_DOC_KEYWORD, semantic: false })),
		fedBlock("Dokumente nach Bedeutung", docSearch(query, { ...common, topK: FED_DOC_SEMANTIC, semantic: true })),
	]);
	if (!lex && !sem) return fedFailed("documents");
	const seen = new Set<string>();
	const results: Array<Record<string, unknown>> = [];
	for (const h of lex?.hits ?? []) {
		seen.add(h.id);
		results.push({ collection: "documents", ranking: "keyword", ...listHit(h, base) });
	}
	for (const h of sem?.hits ?? []) {
		if (seen.has(h.id)) continue;
		results.push({ collection: "documents", ranking: "semantic", ...listHit(h, base) });
	}
	const block: FederatedBlock = { collection: "documents", total: lex ? lex.total : null, results };
	// Beide Arme leer: dieselben Gegenproben wie in keyword_search (jedes Wort einzeln).
	if (results.length === 0) {
		const hint = await zeroHint("keyword", query, false, false, { series: [], dateFrom: null, dateTo: null });
		if (hint) block.hint = hint;
	}
	return block;
}

/** Archivkatalog, beide Arme: wörtlich (alle Wörter, `total` = Trefferzahl) und – wo der
 *  Index Vektoren hat und der embed-Service läuft – nach Bedeutung über Titel und
 *  Beschreibung. Der Query-Vektor ist derselbe wie für die Dokumente (embedQuery teilt
 *  laufende Anfragen und cacht sie). */
async function fedCatalog(query: string, base: string): Promise<FederatedBlock> {
	const theme = semanticCatalogText(query);
	const semanticArm = async () => {
		const vector = theme && catalogHasVectors() ? await embedQuery(theme) : null;
		if (!vector) return null;
		return nearestCatalogUnits({ q: "", theme, vector, limit: FED_CATALOG_SEMANTIC }, fedCatalogFilters());
	};
	const [lex, sem] = await Promise.all([
		fedBlock(
			"Archivkatalog wörtlich",
			queryCatalog({ q: query, sort: "relevance", offset: 0, limit: FED_CATALOG_KEYWORD, exactLast: catalogExactLast(query) }, fedCatalogFilters()),
		),
		fedBlock("Archivkatalog nach Bedeutung", semanticArm()),
	]);
	if (!lex && !sem) return fedFailed("catalog");
	const seen = new Set<number>();
	const results: Array<Record<string, unknown>> = [];
	for (const h of lex?.hits ?? []) {
		seen.add(h.id);
		results.push({ collection: "catalog", ranking: "keyword", ...leanCatalogResult(toCatalogItem(h, base, { full: false })), id: federatedId("catalog", h.id) });
	}
	for (const h of sem?.hits ?? []) {
		if (seen.has(h.id)) continue;
		results.push({ collection: "catalog", ranking: "semantic", ...leanCatalogResult(toCatalogItem(h, base, { full: false })), id: federatedId("catalog", h.id) });
	}
	const block: FederatedBlock = { collection: "catalog", total: lex ? lex.total : null, results };
	// «Pest» trifft «Pestalozzi»: das letzte Suchwort gilt im Katalog auch als Wortanfang.
	const prefixHint = lex && lex.hits.length > 0 ? catalogPrefixNote(query, lex.hits.map((h) => ({ signature: h.signature, title: h.title, text: h.text }))) : "";
	if (prefixHint) block.hint = prefixHint;
	return block;
}

/** Ehedaten: rein lexikalisch (Namen, Herkunft, Zusatzinfo, Kirchgemeinde, Signatur).
 *  Ohne die übrigen Einträge derselben Ehe (sameMarriages) – die kostet eine zweite
 *  Abfrage und steht in ehedaten_search und fetch. */
async function fedEhedaten(query: string, base: string): Promise<FederatedBlock> {
	const q = normalizeEhedatenArgs({ query, topK: FED_EHEDATEN });
	const res = await fedBlock(
		"Ehedaten",
		queryEhedaten({ q: q.q, sort: q.sort, offset: 0, limit: q.limit, filters: q.filters, shared: q.shared, groupBy: [] }),
	);
	if (!res) return fedFailed("ehedaten");
	const results = res.entries.map((e) => ({ collection: "ehedaten", ranking: "keyword", ...toEhedatenItem(e, base), id: federatedId("ehedaten", e.id) }));
	// Gleicher Name Jahrzehnte auseinander: verschiedene Personen (Vater, Sohn, Enkel).
	const namesakes = namesakeNote(res.entries);
	return { collection: "ehedaten", total: res.total, results, ...(namesakes ? { hint: namesakes } : {}) };
}

/** Editionen: wörtlich im Suchtext der Stücke (Titel, Regest, Text, Kommentar,
 *  Anmerkungen). Nach Bedeutung geht über edition_search mit semantic=true. */
async function fedEditions(query: string, base: string): Promise<FederatedBlock> {
	const q = normalizeEditionArgs({ query, topK: FED_EDITIONS });
	const res = await fedBlock(
		"Editionen",
		queryEditions({ q: q.q, vector: null, sort: q.sort, offset: 0, limit: q.limit, filters: q.filters, shared: q.shared }),
	);
	if (!res) return fedFailed("editions");
	const results = res.hits.map((h) => ({
		collection: "editions",
		ranking: "keyword",
		...toEditionListItem(h, base),
		id: federatedId("editions", h.localId),
	}));
	return { collection: "editions", total: res.total, results };
}

/**
 * `search`: der föderierte Einstieg. Fragt alle verfügbaren Bestände PARALLEL ab – wie der
 * Reiter «Alle Quellen» der Website (dort kosten die vier Suchen gegenüber einer nichts
 * Messbares) – und liefert eine flache `results`-Liste (ChatGPT-Konvention `{id,title,url}`,
 * dazu `collection` und `ranking` je Treffer) plus `totals` je Bestand. Bis 2026-11 suchte
 * `search` trotz der Beschreibung «Durchsucht das Archiv» nur in den vier Serien der
 * Volltexte, als einziges Werkzeug rein nach Bedeutung: `search("Pause")` lieferte zehn
 * Nachbarn über Urlaub und Ausstand, während 83 Katalogeinheiten und 841 Dokumente das Wort
 * führen.
 */
async function toolSearch(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	const query = asString(raw.query);
	if (!query) return { structuredContent: { error: "missing_query", results: [] }, isError: true };
	// Verfügbarkeit wie in den Reitern der Website: fehlender Index bzw. Suchschlüssel ohne
	// Scope blendet den Bestand aus (gecacht), statt die Abfrage scheitern zu lassen.
	const [catalogOk, ehedatenOk, editionsOk] = await Promise.all([catalogReady(), ehedatenReady(), editionsReady()]);
	const blocks = await Promise.all([
		fedDocuments(query, base),
		catalogOk ? fedCatalog(query, base) : Promise.resolve(fedMissing("catalog")),
		ehedatenOk ? fedEhedaten(query, base) : Promise.resolve(fedMissing("ehedaten")),
		editionsOk ? fedEditions(query, base) : Promise.resolve(fedMissing("editions")),
	]);
	return {
		structuredContent: federatedSearchOutput(query, blocks),
		// Nur wenn KEIN Bestand abgefragt werden konnte, ist der Aufruf selbst gescheitert.
		...(blocks.every((b) => b.unavailable) ? { isError: true } : {}),
	};
}

// --- fetch/fetch_many (ChatGPT-Konvention, jede id aus `search`) -------------

/**
 * Löst eine id aus `search` auf: nackt ein Dokument (rückwärtskompatibel), mit Präfix eine
 * Katalogeinheit (`catalog:669821`), ein Eheeintrag (`ehe:4505350`) oder ein Editionsstück
 * (`edition:QZH_401`). Liefert die Form von `fetch` – `{id,title,text,url,metadata}` – oder
 * ein `{error}`-Objekt; die Angaben kommen aus denselben Mappern wie /api/v1.
 */
async function fetchFederated(ref: { collection: FederatedCollection; id: string }, base: string): Promise<Record<string, unknown>> {
	switch (ref.collection) {
		case "catalog": {
			if (!/^\d{1,9}$/.test(ref.id)) {
				return { error: `invalid_id: catalog:${ref.id}`, message: "Eine Katalog-ID ist eine positive Zahl (wie in detail.aspx?ID=…)." };
			}
			if (!(await catalogReady())) return { error: "catalog_unavailable" };
			const unit = await getCatalogUnit(Number(ref.id));
			if (!unit) return { error: `not_found: catalog:${ref.id}` };
			// Wie /api/v1/catalog/{id}, inkl. der edierten Stücke zu dieser Vorlage.
			const editions = editionLinksForCatalog(unit.id, unit.onPlatform === true && unit.docSeries === "RM" ? unit.docId : null);
			return federatedFetchDoc(
				"catalog",
				unit.id,
				{
					title: unit.signature ? `${unit.signature} – ${unit.title}` : unit.title,
					text: catalogFetchText({ ...unit, path: (unit.path ?? []).map((n) => n.label) }),
					url: unit.url || null,
				},
				{ ...toCatalogItem(unit, base, { full: true, editions }), source: CATALOG_SOURCE, note: CATALOG_NOTE },
			);
		}
		case "ehedaten": {
			if (!/^\d{1,9}$/.test(ref.id)) {
				return { error: `invalid_id: ehe:${ref.id}`, message: "Die id eines Eheeintrags ist seine Katalog-ID, eine positive Zahl." };
			}
			if (!(await ehedatenReady())) return { error: "ehedaten_unavailable" };
			const entry = await getEhedatenEntry(Number(ref.id));
			if (!entry) return { error: `not_found: ehe:${ref.id}` };
			const related = await sameMarriages([entry]);
			const item = toEhedatenItem(entry, base, related.get(entry.id));
			return federatedFetchDoc(
				"ehedaten",
				entry.id,
				{
					title: entry.titel,
					text: ehedatenFetchText({
						title: entry.titel,
						typeLabel: ART_LABEL[entry.art],
						date: entry.datum,
						parish: entry.kirchgemeinde,
						signature: entry.signatur,
						notes: [entry.mann.zusatz, entry.frau.zusatz],
					}),
					// Permalink des Online-Katalogs (toEhedatenItem.url).
					url: typeof item.url === "string" ? item.url : null,
				},
				{
					...item,
					// `source` des Eintrags ist sein Kirchenbuch (E III/TAI) – Lizenz und Nennung
					// des Datensatzes darum als eigener Block.
					dataset: {
						license: EHEDATEN_LICENSE,
						licenseUrl: EHEDATEN_LICENSE_URL,
						attribution: EHEDATEN_ATTRIBUTION,
						source: EHEDATEN_SOURCE_URL,
						note: EHEDATEN_NOTE,
					},
				},
			);
		}
		case "editions": {
			if (!/^[A-Za-z0-9_-]{1,120}$/.test(ref.id)) return { error: `invalid_id: edition:${ref.id}` };
			if (!(await editionsReady())) return { error: "editions_unavailable" };
			for (const edition of INDEXED_EDITIONS) {
				const unit = await getEditionUnit(edition, ref.id);
				if (!unit) continue;
				// Ohne `html`: die Lesefassung (`text`) genügt einem Modell, wie in edition_search.
				const { html: _html, ...piece } = toEditionItem(unit, base);
				return federatedFetchDoc(
					"editions",
					unit.localId,
					{
						title: `${unit.label} – ${unit.title}`,
						text: editionFetchText({ regest: piece.regest as string | null, text: piece.text as string | null }),
						url: unit.permalink || null,
					},
					{ ...piece, note: EDITIONS_NOTE },
				);
			}
			return { error: `not_found: edition:${ref.id}` };
		}
		default: {
			const doc = await getDocument(ref.id);
			if (!doc) return { error: `not_found: ${ref.id}` };
			return buildFetchDoc(doc, base);
		}
	}
}

async function toolFetch(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	const ref = parseFederatedId(raw.id);
	if (!ref) return { structuredContent: { error: "missing_id" }, isError: true };
	const out = await fetchFederated(ref, base);
	return { structuredContent: out, ...("error" in out ? { isError: true } : {}) };
}

async function toolFetchMany(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	const ids = Array.isArray(raw.ids)
		? raw.ids.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((s) => s.trim())
		: [];
	if (ids.length === 0) return { structuredContent: { error: "missing_ids", documents: [] }, isError: true };
	const capped = ids.slice(0, FETCH_MANY_MAX);
	const documents: Record<string, unknown>[] = [];
	const notFound: string[] = [];
	for (const id of capped) {
		const ref = parseFederatedId(id);
		const doc = ref ? await fetchFederated(ref, base) : { error: "missing_id" };
		if ("error" in doc) {
			notFound.push(id);
			continue;
		}
		documents.push(doc);
	}
	const out: Record<string, unknown> = { documents, notFound };
	if (ids.length > FETCH_MANY_MAX) out.warning = `Nur die ersten ${FETCH_MANY_MAX} von ${ids.length} ids geladen.`;
	return { structuredContent: out };
}

// --- semantic_search / keyword_search (reiche /api/v1-Treffer) ---------------

async function toolRichSearch(raw: Record<string, unknown>, base: string, semantic: boolean): Promise<McpToolOutput> {
	const query = asString(raw.query);
	if (!query) return { structuredContent: { error: "missing_query", results: [] }, isError: true };
	const series = normalizeSeries(raw.series);
	const dateFrom = clampYear(raw.dateFrom);
	const dateTo = clampYear(raw.dateTo);
	const topK = clampTopK(raw.topK, RESULT_LIMIT_DEFAULT, RESULT_LIMIT_MAX);
	const sort = semantic ? "relevance" : normalizeSort(raw.sort);
	// field/phrase sind nur lexikalisch (BM25-Arm). phrase wrappt die Query in
	// "…"; Meili erhält q roh und parst die Phrase selbst (bei semantic egal).
	// offset blättert in beiden Fällen: docSearch holt offset + topK und
	// schneidet ab, wie /api/v1 (Fenster ≤ PAGE_WINDOW_MAX).
	const offset = clampOffset(raw.offset);
	const attributesToSearchOn = semantic ? undefined : fieldAttrs(raw.field, docTitleFields());
	const phrase = !semantic && raw.phrase === true;
	// exact zitiert jedes Wort einzeln (ohne Nachbarschaftszwang); phrase gewinnt.
	const exact = !semantic && raw.exact === true;

	// keyword_search mit Synonymen (alternatives): jeden Begriff einzeln als BM25
	// suchen, fair zusammenführen (ODER). Semantik deckt Synonyme übers Embedding ab.
	if (!semantic) {
		const terms = normalizeTerms(query, raw.alternatives);
		if (terms.length > 1) {
			// Jede Variante holt das ganze Blätter-Fenster; gemischt und
			// geschnitten wird erst danach – einzeln geschnittene Listen
			// verlören die von der Dedup-Runde verdrängten Treffer.
			const window = Math.min(offset + topK, PAGE_WINDOW_MAX);
			const lists = await Promise.all(
				terms.map((t) => docSearch(lexicalQuery(t, phrase, exact), { series, dateFrom, dateTo, sort, topK: window, semantic: false, attributesToSearchOn })),
			);
			const merged = mergeRoundRobinPage(
				lists.map((l) => l.hits.map((h) => ({ hit: h }))),
				offset,
				topK,
			);
			const results = merged.map((m) => listHit(m.hit, base));
			return { structuredContent: alternativesSearchOutput(terms, lists.map((l) => l.total), results) };
		}
	}

	const q = lexicalQuery(query, phrase, exact);
	// Gegenprobe parallel: wie viele Treffer die Suchwörter genau so enthalten
	// (exactProbeQuery "" ⇒ die Suche zählt schon exakt bzw. ist semantisch).
	const [{ hits, total }, exactTotal] = await Promise.all([
		docSearch(q, { series, dateFrom, dateTo, sort, topK, offset, semantic, attributesToSearchOn }),
		semantic ? Promise.resolve(null) : exactCount(exactProbeQuery(q), { series, dateFrom, dateTo }, attributesToSearchOn),
	]);
	// Bei Hybrid-/Semantik ist estimatedTotalHits korpus-weit (jeder Doc hat
	// Vektor-Ähnlichkeit > 0) – als „total" irreführend. Dann die Treffer-Anzahl
	// melden; nur die lexikalische BM25-Suche hat eine echte Treffermenge (die
	// Dokumente mit allen Wörtern).
	const out: Record<string, unknown> = {
		results: hits.map((h) => listHit(h, base)),
		total: semantic ? hits.length : total,
		...exactFields(total, exactTotal),
	};
	// Blättern nach Bedeutung: Die Folgeseiten sind Ausschnitte einer Liste, die der Server fünf
	// Minuten aufhebt (themeOrder.ts). Danach entsteht sie neu, und wo der Filter mehr als ein Zehntel
	// der Vektoren trifft, ist die Reihung eine Näherung, die am Fenster hängt. Vor 2026-11-24 hing sie
	// bei jeder Seite daran (8 bis 12 Doppelte auf 50 Treffern über fünf Seiten).
	if (semantic && offset > 0) {
		out.note =
			"Blättern nach Bedeutung: Die Seiten sind Ausschnitte derselben Liste, solange sie innert fünf Minuten aufeinander folgen. Später kann bei einer Auswahl von mehr als rund 60'000 Dokumenten ein Treffer erneut erscheinen (erkennbar an id).";
	}
	if (semantic && isLexicalOnlyScope(series, dateTo)) {
		out.warning = "Die Ratsmanuale (RM) haben keine Vektoren – diese Suche lief als Stichwortsuche. Für alte Schreibweisen keyword_search mit alternatives nutzen.";
	}
	if (hits.length === 0 && offset === 0) {
		const hint = await zeroHint(semantic ? "semantic" : "keyword", query, phrase, exact, { series, dateFrom, dateTo }, attributesToSearchOn);
		if (hint) out.hint = hint;
	}
	return { structuredContent: out };
}

// --- list_documents (Titel-Überblick, viele Titel ohne Volltext) -------------

// list_documents, count_documents, timeline und overview verlangen alle Wörter
// der query (aggregateSearch): sie zählen bzw. listen
// die ganze Treffermenge, nicht nur die bestgerankten Treffer.
async function toolList(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	const query = asString(raw.query);
	if (!query) return { structuredContent: { error: "missing_query", results: [] }, isError: true };
	const limit = clampListLimit(raw.limit); // Default 40, max AGENT_LIST_MAX (60)
	const offset = clampOffset(raw.offset);
	const phrase = raw.phrase === true;
	const exact = raw.exact === true;
	const f = { series: normalizeSeries(raw.series), dateFrom: clampYear(raw.dateFrom), dateTo: clampYear(raw.dateTo) };
	const attrs = fieldAttrs(raw.field, docTitleFields());
	// alternatives (Synonyme, alte Schreibweisen): je Variante eine eigene
	// Suche, Titel fair gemischt – ein einziger moderner Begriff ergäbe sonst
	// einen schiefen Überblick. phrase ⇒ mehrwortige Eigennamen als exakte Phrase;
	// exact ⇒ jedes Wort genau so (phrase gewinnt, lexicalQuery).
	const terms = normalizeTerms(query, raw.alternatives);
	const qs = terms.map((term) => lexicalQuery(term, phrase, exact));
	const [lists, exactTotal] = await Promise.all([
		Promise.all(
			qs.map((q) =>
				searchDocuments(
					...aggregateSearch({
						q,
						...f,
						sort: normalizeSort(raw.sort),
						pageSize: Math.min(offset + limit, PAGE_WINDOW_MAX),
						// Bewusst ohne Body/excerpt – der Titel-Überblick soll günstig und breit sein.
						attributesToRetrieve: ["id", "series", "title", "date", "dateYear"],
						attributesToSearchOn: attrs,
					}),
				),
			),
		),
		// Gegenprobe parallel (Treffer-Inflation durch Tippfehler-Toleranz/Wortanfänge),
		// nur ohne Varianten: mit alternatives fasst `total` mehrere Suchen zusammen.
		terms.length === 1 ? exactCount(exactProbeQuery(qs[0]), f, attrs) : Promise.resolve(null),
	]);
	const res = lists[0];
	const page =
		terms.length > 1
			? mergeRoundRobinPage(
					lists.map((l) => l.hits.map((h) => ({ hit: h }))),
					offset,
					limit,
				).map((m) => m.hit)
			: offset > 0
				? res.hits.slice(offset)
				: res.hits;
	const results = page.map((h) => ({
		id: h.id,
		series: h.series,
		title: h.title,
		date: h.date ?? null,
		dateYear: h.dateYear ?? null,
		url: webUrl(h, base),
	}));
	// Mit Varianten zählt Meili die Vereinigung nicht: Trefferzahl je Variante,
	// `total` die grösste davon (untere Grenze) – wie bei keyword_search.
	if (terms.length > 1) {
		return { structuredContent: alternativesSearchOutput(terms, lists.map((l) => l.estimatedTotalHits), results) };
	}
	const out: Record<string, unknown> = {
		total: res.estimatedTotalHits,
		count: results.length,
		results,
		...exactFields(res.estimatedTotalHits, exactTotal),
	};
	if (res.estimatedTotalHits === 0) {
		const hint = await zeroHint("list", query, phrase, exact, f, attrs);
		if (hint) out.hint = hint;
	}
	return { structuredContent: out };
}

// --- count_documents ---------------------------------------------------------

async function toolCount(raw: Record<string, unknown>): Promise<McpToolOutput> {
	// phrase ⇒ mehrwortige Eigennamen exakt zählen (ohne Phrase genügen die
	// Namensteile irgendwo im Dokument – die 19.-Jh.-Masse bläht die Zahl auf).
	const query = asString(raw.query);
	const f = { series: normalizeSeries(raw.series), dateFrom: clampYear(raw.dateFrom), dateTo: clampYear(raw.dateTo) };
	const attrs = fieldAttrs(raw.field, docTitleFields());
	const phrase = raw.phrase === true;
	const exact = raw.exact === true;
	// alternatives: jede Variante eine eigene Zählung (ohne query eine einzige
	// über die Filter-Menge).
	const terms = query ? normalizeTerms(query, raw.alternatives) : [""];
	const qs = terms.map((term) => lexicalQuery(term, phrase, exact));
	// Gegenprobe parallel und nur ohne Varianten: wie viele Dokumente die Suchwörter
	// genau so enthalten. Ohne sie wanderte die tolerante Zahl als Fakt in die Antwort
	// des Modells (Prod 2026-11-17 vor der Tippfehler-Schwelle 7: «Pause» 8'066 statt 841).
	const [counts, exactTotal] = await Promise.all([
		Promise.all(qs.map((q) => countAggregate(searchDocuments, { q, ...f, attributesToSearchOn: attrs }))),
		terms.length === 1 ? exactCount(exactProbeQuery(qs[0]), f, attrs) : Promise.resolve(null),
	]);
	if (terms.length > 1) {
		return {
			structuredContent: alternativesCountOutput(
				terms.map((term, i) => ({ term, total: counts[i].total, bySeries: positiveCounts(counts[i].bySeries) })),
			),
		};
	}
	const { total, bySeries: fd } = counts[0];
	const out: Record<string, unknown> = { total, bySeries: positiveCounts(fd), ...exactFields(total, exactTotal) };
	if (total === 0 && query) {
		const hint = await zeroHint("count", query, phrase, exact, f, attrs);
		if (hint) out.hint = hint;
	}
	return { structuredContent: out };
}

// --- timeline ----------------------------------------------------------------

async function toolTimeline(raw: Record<string, unknown>): Promise<McpToolOutput> {
	const query = asString(raw.query);
	const series = normalizeSeries(raw.series);
	const f = { series, dateFrom: clampYear(raw.dateFrom), dateTo: clampYear(raw.dateTo) };
	const phrase = raw.phrase === true;
	const exact = raw.exact === true;
	const terms = query ? normalizeTerms(query, raw.alternatives) : [];
	const attrs = fieldAttrs(raw.field, docTitleFields());
	// Gegenprobe nur für EINEN Begriff (wie die Null-Treffer-Proben): mit
	// alternatives ist `total` die Summe über alle Begriffe, eine Zahl zur query
	// allein wäre irreführend.
	const probeQ = terms.length === 1 ? exactProbeQuery(lexicalQuery(terms[0], phrase, exact)) : "";

	// Mehrere Begriffe: je eine eigene Suche, Verteilungen aufsummiert.
	const [dist, exactTotal] = await Promise.all([
		terms.length === 0 && series.length === 0 && f.dateFrom == null && f.dateTo == null
			? getCorpusYearDistribution()
			: aggregateYearDist(
					searchDocuments,
					terms.map((t) => lexicalQuery(t, phrase, exact)),
					{ ...f, attributesToSearchOn: attrs },
				),
		exactCount(probeQ, f, attrs),
	]);

	const years = Object.entries(dist)
		.filter(([, c]) => c > 0)
		.map(([y, c]) => [Number(y), c] as [number, number])
		.filter(([y]) => Number.isFinite(y))
		.sort((a, b) => a[0] - b[0]);
	// Lücken-Vorbehalt (ABl, RRB): ein Einbruch kann eine Digitalisierungslücke sein.
	const caveat = timelineCoverageCaveat(series);
	if (years.length === 0) {
		// Gegenproben nur für einen einzelnen Begriff – mit alternatives beträfen sie bloss die query.
		const hint = terms.length === 1 ? await zeroHint("count", terms[0], phrase, exact, f, attrs) : "";
		return { structuredContent: { total: 0, years: {}, ...(hint ? { hint } : {}), ...(caveat ? { caveat } : {}) } };
	}

	const total = years.reduce((s, [, c]) => s + c, 0);
	const yearsObj: Record<string, number> = {};
	for (const [y, c] of years) yearsObj[String(y)] = c;
	// Spitzenjahre vorberechnet: Modelle lasen Peaks sonst falsch aus der langen Liste (Issue #75).
	const peakYears = topYearsByCount(years, 10).map(([year, count]) => ({ year, count }));
	const note = preModernTimelineNote(years[0][0], years[years.length - 1][0]);
	return {
		structuredContent: {
			total,
			from: years[0][0],
			to: years[years.length - 1][0],
			years: yearsObj,
			peakYears,
			...(caveat ? { caveat } : {}),
			...(note ? { note } : {}),
			// Verteilung und Spitzenjahre folgen `total`; exactTotal/hint sagen, wie
			// viel davon nur über Tippfehler-Toleranz und Wortanfänge zustande kommt.
			// `total` ist die Summe der Jahres-Facette (Dokumente MIT Jahr), exactTotal
			// die Dokumentzahl der exakten Variante – praktisch dasselbe (lokal für
			// «Pause» beides 11'478); läge exactTotal darüber, schweigt inflationHint.
			...exactFields(total, exactTotal),
		},
	};
}

// --- overview (Kombi: Anzahl + Serien-/Jahresverteilung + Top-Treffer) --------

async function toolOverview(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	// EIN Call liefert alles: Facetten (series + dateYear) kommen immer mit,
	// estimatedTotalHits = Gesamtzahl, die ersten Treffer = Top-Vorschau.
	const query = asString(raw.query);
	const f = { series: normalizeSeries(raw.series), dateFrom: clampYear(raw.dateFrom), dateTo: clampYear(raw.dateTo) };
	const attrs = fieldAttrs(raw.field, docTitleFields());
	const phrase = raw.phrase === true;
	const exact = raw.exact === true;
	// alternatives: je Variante ein eigener Überblick (ohne query einer über die
	// Filter-Menge).
	const terms = query ? normalizeTerms(query, raw.alternatives) : [""];
	const qs = terms.map((term) => lexicalQuery(term, phrase, exact));
	const [searches, exactTotal] = await Promise.all([
		Promise.all(
			qs.map((q) =>
				searchDocuments(
					...aggregateSearch({
						q,
						...f,
						pageSize: OVERVIEW_TOP_N,
						attributesToSearchOn: attrs,
						attributesToRetrieve: LIST_HIT_ATTRIBUTES,
					}),
				),
			),
		),
		// Gegenprobe parallel und nur ohne Varianten; bySeries/byYear zählen weiterhin
		// alle Treffer (`total`).
		terms.length === 1 ? exactCount(exactProbeQuery(qs[0]), f, attrs) : Promise.resolve(null),
	]);
	if (terms.length > 1) {
		// Zahlen wie bei count_documents (grösste Variante als untere Grenze,
		// Verteilungen summiert), die Top-Treffer fair gemischt.
		const top = mergeRoundRobin(
			searches.map((s) => s.hits.map((h) => ({ hit: h }))),
			OVERVIEW_TOP_N,
		).map((m) => listHit(m.hit, base));
		return {
			structuredContent: {
				...alternativesCountOutput(
					terms.map((term, i) => ({
						term,
						total: searches[i].estimatedTotalHits,
						bySeries: positiveCounts(searches[i].facetDistribution?.series),
						byYear: positiveCounts(searches[i].facetDistribution?.dateYear),
					})),
				),
				top,
			},
		};
	}
	const res = searches[0];
	const out: Record<string, unknown> = {
		total: res.estimatedTotalHits,
		bySeries: positiveCounts(res.facetDistribution?.series),
		byYear: positiveCounts(res.facetDistribution?.dateYear),
		top: res.hits.map((h) => listHit(h, base)),
		...exactFields(res.estimatedTotalHits, exactTotal),
	};
	if (res.estimatedTotalHits === 0 && query) {
		const hint = await zeroHint("list", query, phrase, exact, f, attrs);
		if (hint) out.hint = hint;
	}
	return { structuredContent: out };
}

// --- passage_search ------------------------------------------------------------

const PASSAGE_TOPK_DEFAULT = 8;
const PASSAGE_TOPK_MAX = 20;

// Textstellen im Originalwortlaut aus dem Passagen-Index (searchPassages): je Dokument die
// passendste Passage, mit den Metadaten des Dokuments und seiner URL.
/** Meili brach die Vektorsuche nach der Frist ab (vectorCutoff.ts). */
const PARTIAL_WARNING =
	"Die Suche nach Bedeutung wurde nach einigen Sekunden abgebrochen (grosse Auswahl, kalter Zwischenspeicher) – die Liste ist womöglich unvollständig. Dieselbe Anfrage noch einmal ist meist vollständig; engere Filter helfen ebenfalls.";

async function toolPassageSearch(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	const query = asString(raw.query);
	if (!query) return { structuredContent: { error: "missing_query", results: [] }, isError: true };
	const askedSeries = normalizeSeries(raw.series);
	const series = askedSeries.filter((s) => !isLexicalOnlySeries(s));
	const dateFrom = clampYear(raw.dateFrom);
	const dateTo = clampYear(raw.dateTo);
	const topK = clampTopK(raw.topK, PASSAGE_TOPK_DEFAULT, PASSAGE_TOPK_MAX);
	// Blättern: der Offset greift erst nach der Gruppierung je Dokument
	// (searchPassages), das Fenster offset + topK ist eng gedeckelt.
	const askedOffset = clampOffset(raw.offset);
	const offset = clampPassageOffset(raw.offset, topK);
	if (isLexicalOnlyScope(askedSeries, dateTo)) {
		return {
			structuredContent: {
				results: [],
				count: 0,
				hint: "Die Ratsmanuale (RM, vor 1803) haben keine Passagen – suche dort mit keyword_search (series=['RM'], alte Schreibweisen in alternatives).",
			},
		};
	}
	if (!(await chunkIndexReady())) {
		return {
			structuredContent: { error: "passages_unavailable", results: [], hint: "Der Passagen-Index ist gerade nicht verfügbar – nutze semantic_search oder keyword_search." },
			isError: true,
		};
	}
	const { passages, ranking, partial } = await searchPassages({ query, series, dateFrom, dateTo, topK, offset });
	const results = passages.map((p) => ({
		docId: p.docId,
		text: p.text,
		aligned: p.aligned,
		score: p.score,
		title: p.title,
		series: p.series,
		date: p.date,
		dateYear: p.dateYear,
		stazhIdent: p.stazhIdent,
		url: `${base}/documents/${p.series}/${encodeURIComponent(p.docId)}`,
	}));
	const out: Record<string, unknown> = { results, count: results.length, ranking };
	if (partial) {
		out.partial = true;
		out.warning = PARTIAL_WARNING;
	}
	if (ranking === "keyword") out.warning = "Die Suche nach Bedeutung ist gerade nicht verfügbar – die Textstellen stammen aus einer Stichwortsuche.";
	if (offset > 0) {
		// Ehrlicher Vorbehalt statt stiller Lücke: Die Folgeseiten sind Schnitte
		// EINER Liste (festes Fenster, s. searchPassages), die erste Seite sucht
		// bewusst nur ihr eigenes kleines Fenster – eine Passage von dort kann
		// darum ein zweites Mal erscheinen (Prod 2026-11-17: eine von 56 über
		// sieben Seiten).
		const gekappt =
			offset < askedOffset
				? `Das Blätter-Fenster reicht bis ${PASSAGE_WINDOW_MAX} Passagen (offset + topK): gezeigt sind die Passagen ab ${offset} statt ab ${askedOffset}; tiefer blättern keyword_search und list_documents. `
				: "";
		out.note = `${gekappt}Die Passagen ab Offset ${offset} setzen die Liste fort; nur eine Passage der ERSTEN Seite kann erneut erscheinen (sie sucht ein kleineres Fenster) – erkennbar an docId.`;
	}
	if (results.length === 0) {
		if (offset > 0) {
			out.hint = `Keine weiteren Textstellen ab Offset ${offset} – die Liste ist zu Ende. Für mehr Treffer andere Begriffe, weitere Filter oder keyword_search mit alternatives.`;
		} else {
			const hint = await zeroHint("semantic", query, false, false, { series, dateFrom, dateTo });
			out.hint = hint || "Keine Textstellen gefunden – versuche andere Begriffe, semantic_search oder keyword_search mit alternatives.";
		}
	}
	return { structuredContent: out };
}

// --- similar_documents -------------------------------------------------------

async function toolSimilar(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	const id = asString(raw.id);
	if (!id) return { structuredContent: { error: "missing_id", results: [] }, isError: true };
	const limit = clampTopK(raw.limit, RESULT_LIMIT_DEFAULT, SIMILAR_LIMIT_MAX);
	const doc = await getDocument(id);
	if (!doc) return { structuredContent: { error: `not_found: ${id}`, results: [] }, isError: true };
	// Ratsmanuale (RM): keine Vektoren – keine semantischen Nachbarn.
	if (isLexicalOnlySeries(doc.series)) return { structuredContent: { results: [], warning: "no_embeddings_for_series" } };
	if (!(await indexHasEmbeddings())) return { structuredContent: { results: [], warning: "embeddings_unavailable" } };
	const text = `${doc.title}\n\n${(doc.body ?? "").slice(0, 1500)}`;
	const vector = await embedQuery(text);
	if (!vector) return { structuredContent: { results: [], warning: "embedding_failed" } };
	const hits = await findSimilar({ id, limit, vector });
	return { structuredContent: { results: hits.map((h) => listHit(h, base)), total: hits.length } };
}

// --- vector_search -----------------------------------------------------------

/** chunkText-Fallback auf die Länge des alignChunk-Exzerpts kappen. */
function capPassage(text: string): string {
	if (text.length <= ALIGNED_TEXT_CAP) return text;
	const cut = text.slice(0, ALIGNED_TEXT_CAP);
	const lastSpace = cut.lastIndexOf(" ");
	return (lastSpace > ALIGNED_TEXT_CAP * 0.8 ? cut.slice(0, lastSpace) : cut) + " …";
}

async function toolVectorSearch(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	const vec = raw.vector;
	const valid =
		Array.isArray(vec) && vec.length === QWEN_DIM && vec.every((x) => typeof x === "number" && Number.isFinite(x));
	if (!valid) {
		return {
			structuredContent: { error: `invalid_vector: expected ${QWEN_DIM} finite numbers`, results: [] },
			isError: true,
		};
	}
	const limit = clampTopK(raw.limit, RESULT_LIMIT_DEFAULT, VECTOR_LIMIT_MAX);

	let chunks;
	let partial;
	try {
		({ hits: chunks, partial } = await searchChunks({
			q: "",
			vector: vec as number[],
			embedder: QWEN_EMBEDDER,
			semanticRatio: 1,
			extraFilter: [NON_LATE_FILTER],
			limit,
		}));
	} catch (err) {
		// Embedder noch nicht konfiguriert/befüllt (Rollout-Reihenfolge) oder
		// Meili-Fehler: als sauberes Tool-Ergebnis melden, kein 500. Bewusst
		// KEIN Settings-Probe – der Prod-Web-Container läuft mit Search-Key.
		console.error("[mcp] vector_search:", err);
		return { structuredContent: { error: "vector_search_unavailable", results: [] }, isError: true };
	}

	// Doc-Join für Metadaten-Allowlist + Original-Passage (alignChunk gegen den
	// Body; Fallback = gecleanter chunkText). Orphan-Chunks (~0.05 %) skippen.
	// Je Dokument laden, ausrichten und den Volltext wieder loslassen: alle auf
	// einmal wären bis 50 Volltexte (je bis 1 MB) im Speicher.
	const chunksByDoc = new Map<string, typeof chunks>();
	for (const chunk of chunks) chunksByDoc.set(chunk.docId, [...(chunksByDoc.get(chunk.docId) ?? []), chunk]);
	const alignedText = new Map<string, string>();
	const docIds = [...chunksByDoc.keys()];
	const docs = await mapConcurrent(docIds, PARENT_CONCURRENCY, async (id) => {
		const doc = await getDocument(id);
		if (!doc) return null;
		const { body, ...meta } = doc;
		for (const chunk of chunksByDoc.get(id) ?? []) {
			const aligned = body ? alignChunk(body, chunk.chunkText) : null;
			if (aligned) alignedText.set(chunk.id, aligned.text);
		}
		return meta as SearchHit;
	});
	const byId = new Map(docIds.map((id, i) => [id, docs[i]]));

	const results: Record<string, unknown>[] = [];
	for (const chunk of chunks) {
		const parent = byId.get(chunk.docId);
		if (!parent) continue;
		results.push({
			id: chunk.id,
			docId: chunk.docId,
			text: alignedText.get(chunk.id) ?? capPassage(chunk.chunkText),
			score: chunk._rankingScore ?? null,
			// Bewusst die VOLLE Dokument-Form: vector_search ist die Schnittstelle
			// für Partner-Systeme mit fester Integration – eine stillschweigende Formänderung bräche dort womöglich
			// Anzeige oder Quellenangabe (Entscheid Tim 2026-11-17: so lassen).
			document: fullListHit(parent, base),
		});
	}
	return {
		structuredContent: { results, count: results.length, ...(partial ? { partial: true, warning: PARTIAL_WARNING } : {}) },
	};
}

// --- catalog_search ----------------------------------------------------------

/** Exakte Gegenprobe im Katalog: dieselben Filter, `limit: 0` (nur die
 *  Trefferzahl). Wie bei den Dokumenten parallel zur Hauptsuche und fehlertolerant
 *  – ein Fehler kostet nur den Hinweis, nicht das Ergebnis. */
function catalogExactCount(probeQ: string, filters: Parameters<typeof queryCatalog>[1]): Promise<number | null> {
	if (!probeQ) return Promise.resolve(null);
	return queryCatalog({ q: probeQ, sort: "relevance", offset: 0, limit: 0 }, filters).then(
		(r) => r.total,
		(err: unknown) => {
			console.warn(`[mcp] Exakte Gegenprobe im Katalog gescheitert: ${(err as Error).message}`);
			return null;
		},
	);
}

async function toolCatalogSearch(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	if (!(await catalogReady())) return { structuredContent: { error: "catalog_unavailable", results: [] }, isError: true };
	const limit = clampTopK(raw.limit, RESULT_LIMIT_DEFAULT, RESULT_LIMIT_MAX);
	const offset = Math.min(clampOffset(raw.offset), PAGE_WINDOW_MAX - limit);
	// Trefferform: schlank (Default, lean.ts) oder die volle /api/v1-Struktur.
	const verbose = raw.verbose === true;
	const note = verbose ? CATALOG_NOTE : MCP_CATALOG_NOTE;
	const item = (h: Parameters<typeof toCatalogItem>[0]): Record<string, unknown> => {
		const full = toCatalogItem(h, base, { full: false });
		return verbose ? full : leanCatalogItem(full);
	};
	// Namen aus dem Register (erkannte Entitäten): nur Formen mit Vergleichsschlüssel; Stufe geprüft.
	const checked = mcpCatalogFilters(raw);
	if ("error" in checked) return { structuredContent: { ...checked, results: [] }, isError: true };
	const query = asString(raw.query);
	const named = checked.entities.person.length + checked.entities.place.length + checked.entities.org.length > 0;
	if (!query && !named) {
		return {
			structuredContent: { error: "missing_query", message: "query oder ein Name (person, place, organization) ist nötig.", results: [] },
			isError: true,
		};
	}
	const filters = {
		active: true,
		dateFrom: clampCatalogYear(raw.dateFrom),
		dateTo: clampCatalogYear(raw.dateTo),
		level: checked.level,
		bestand: [],
		digital: raw.digital === true,
		entities: checked.entities,
	};

	// Nach Bedeutung (wie das Thema im Reiter «Archivkatalog»): nur Einheiten mit Vektor, nach
	// Ähnlichkeit, ohne Trefferzahl (jede Einheit hätte eine Ähnlichkeit). Ohne Vektoren bzw.
	// ohne Embed-Service wörtlich mit Hinweis.
	let fallback: string | null = null;
	if (raw.semantic === true) {
		const text = semanticCatalogText(query);
		const vector = text && catalogHasVectors() ? await embedQuery(text) : null;
		if (vector) {
			try {
				const found = await nearestCatalogUnits({ q: "", theme: text, vector, limit: Math.min(offset + limit, PAGE_WINDOW_MAX) }, filters);
				const hits = found.hits.slice(offset);
				return {
					structuredContent: {
						results: hits.map(item),
						ranking: "semantic",
						source: CATALOG_SOURCE,
						note: `${note} Nach Ähnlichkeit geordnet, ohne Trefferzahl; nicht alle Einheiten betreffen das Thema.`,
						...(hits.length === 0
							? { hint: "Keine Einheit mit Vektor in dieser Auswahl – Personendossiers, Ehedaten und Firmen erreicht die Suche nach Bedeutung nicht; suche wörtlich." }
							: {}),
						...(checked.warning ? { warning: checked.warning } : {}),
					},
				};
			} catch (err) {
				console.warn(`[mcp] Katalogsuche nach Bedeutung gescheitert, wörtlich: ${(err as Error).message}`);
			}
		}
		fallback = "Die Suche nach Bedeutung ist gerade nicht verfügbar – gesucht wurde wörtlich (alle Wörter).";
	}

	// exact zitiert jedes Wort einzeln (der Katalog kennt kein phrase): keine
	// Tippfehler-Toleranz, kein Wortanfang (Prod 2026-11-17: «Pause» 663 statt 83).
	const q = exactWrap(query, raw.exact === true);
	const [res, exactTotal] = await Promise.all([
		queryCatalog(
			// Endet die Suche auf ein Signatur-Kürzel oder eine Zahl («C», «12»), gilt das letzte Wort ganz.
			// Zitiert zählt ohnehin nur das ganze Wort, dann greift exactLast nicht mehr.
			{ q, sort: normalizeSort(raw.sort), offset, limit, exactLast: catalogExactLast(q) },
			filters,
		),
		catalogExactCount(exactProbeQuery(q), filters),
	]);
	// Das letzte Suchwort trifft als Wortanfang oft ganz andere Wörter («Pest» → «Pestalozzi»).
	const prefixHint = q ? catalogPrefixNote(q, res.hits.map((h) => ({ signature: h.signature, title: h.title, text: h.text }))) : "";
	// Der Inflations-Hinweis nennt dieselbe Ursache mit Zahlen und geht darum vor
	// dem Wortanfang-Hinweis (der dafür ein Beispielwort der Treffer zeigt).
	const inflation = exactTotal != null && res.total > 0 ? inflationHint(res.total, exactTotal) : "";
	const zeroHint =
		res.total === 0 && query
			? `${raw.exact === true ? "Mit exact=true zählt nur die genaue Schreibung – ohne exact fängt die Suche Schreibvarianten und Wortanfänge auf. " : ""}` +
				"Keine Einheit mit allen Wörtern – versuche weniger oder andere Wörter, nur den Nachnamen mit einem Sachwort, ältere Schreibweisen oder semantic=true."
			: "";
	const warning = [fallback, checked.warning].filter(Boolean).join(" ");
	return {
		structuredContent: {
			results: res.hits.map(item),
			total: res.total,
			...(exactTotal != null && res.total > 0 ? { exactTotal } : {}),
			ranking: "keyword",
			source: CATALOG_SOURCE,
			note,
			...(warning ? { warning } : {}),
			...(inflation || prefixHint || zeroHint ? { hint: inflation || prefixHint || zeroHint } : {}),
		},
	};
}

// --- ehedaten_search ---------------------------------------------------------

// Argumente aus ehedatenTool.ts (normalizeEhedatenArgs), Treffer in der Form von
// /api/v1/ehedaten (toEhedatenItem, mit den übrigen Einträgen derselben Ehe aus der geprüften
// Liste), dazu Lizenz und Nennung des Datensatzes (CC BY 4.0).
async function toolEhedatenSearch(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	if (!(await ehedatenReady())) return { structuredContent: { error: "ehedaten_unavailable", results: [] }, isError: true };
	const query = normalizeEhedatenArgs(raw);
	const offset = Math.min(clampOffset(raw.offset), Math.max(0, PAGE_WINDOW_MAX - query.limit));
	const res = await queryEhedaten({
		q: query.q,
		sort: query.sort,
		offset,
		limit: query.limit,
		filters: query.filters,
		shared: query.shared,
		groupBy: query.groupBy,
	});
	const related = await sameMarriages(res.entries);
	// Gleicher Name Jahrzehnte auseinander: verschiedene Personen (Vater, Sohn, Enkel).
	const namesakes = namesakeNote(res.entries);
	// Trefferform: schlank (Default, lean.ts) oder die volle /api/v1-Struktur.
	const verbose = raw.verbose === true;
	return {
		structuredContent: {
			total: res.total,
			...(namesakes ? { hint: namesakes } : {}),
			offset,
			criteria: query.criteria,
			results: res.entries.map((e) => {
				const full = toEhedatenItem(e, base, related.get(e.id));
				return verbose ? full : leanEhedatenItem(full);
			}),
			...(query.groupBy.length > 0 ? { counts: ehedatenFacetsMeta(res.counts) } : {}),
			license: EHEDATEN_LICENSE,
			licenseUrl: EHEDATEN_LICENSE_URL,
			attribution: EHEDATEN_ATTRIBUTION,
			source: EHEDATEN_SOURCE_URL,
			note: verbose ? EHEDATEN_NOTE : MCP_EHEDATEN_NOTE,
		},
	};
}

// --- edition_search ----------------------------------------------------------

// Argumente aus editionTool.ts (normalizeEditionArgs), Treffer in der Form von
// /api/v1/editions (toEditionListItem, Lizenz und Nennung je Stück). `id` lädt ein Stück
// vollständig (toEditionItem ohne html – die Lesefassung genügt einem Modell). Nach Bedeutung
// über den embed-Service; fehlt er bzw. haben die Stücke keine Vektoren, wörtlich mit Hinweis.
async function toolEditionSearch(raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	if (!(await editionsReady())) return { structuredContent: { error: "editions_unavailable", results: [] }, isError: true };
	const id = asString(raw.id).trim();
	if (id) {
		if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return { structuredContent: { error: `invalid_id: ${id}` }, isError: true };
		for (const edition of isIndexedEdition(raw.edition) ? [raw.edition] : INDEXED_EDITIONS) {
			const unit = await getEditionUnit(edition, id);
			if (!unit) continue;
			const { html: _html, ...piece } = toEditionItem(unit, base);
			return { structuredContent: { piece, note: EDITIONS_NOTE } };
		}
		return { structuredContent: { error: `not_found: ${id}` }, isError: true };
	}
	const query = normalizeEditionArgs(raw);
	const offset = Math.min(clampOffset(raw.offset), Math.max(0, PAGE_WINDOW_MAX - query.limit));
	let vector: number[] | null = null;
	let fallback: string | null = null;
	if (query.semantic) {
		if (!editionsHaveVectors()) fallback = "Suche nach Bedeutung zurzeit nicht verfügbar – wörtlich gesucht.";
		else {
			try {
				vector = await embedQuery(query.q);
			} catch {
				vector = null;
			}
			if (!vector) fallback = "Suche nach Bedeutung zurzeit nicht verfügbar – wörtlich gesucht.";
		}
	}
	const res = await queryEditions({
		q: vector ? "" : query.q,
		vector,
		sort: vector ? "relevance" : query.sort,
		offset,
		limit: query.limit,
		filters: query.filters,
		shared: query.shared,
	});
	// Trefferform: schlank (Default, lean.ts) oder die volle /api/v1-Struktur. Schlank
	// trägt jedes Stück `license` und `attribution` seiner Edition, die Lizenz-URLs und
	// der Name der Edition stehen einmal in `rights`.
	const verbose = raw.verbose === true;
	const full = res.hits.map((h) => toEditionListItem(h, base));
	return {
		structuredContent: {
			total: res.total,
			offset,
			criteria: query.criteria,
			ranking: vector ? "semantic" : "keyword",
			...(fallback ? { warning: fallback } : {}),
			results: verbose ? full : full.map(leanEditionItem),
			...(verbose ? {} : { rights: editionRights(res.hits.map((h) => h.edition)) }),
			note: verbose ? EDITIONS_NOTE : MCP_EDITIONS_NOTE,
		},
	};
}

// --- coverage (Selbstbeschreibung: Bestände, Umfang, Lücken, Suche, Lizenz) ---

/** Serien mit Umfang, Jahres-Spanne und Jahresläufen; eine Abfrage-Runde, 5 min gecacht
 *  (getSeriesInfo/getSeriesYearDistributions teilen sie). null = Index nicht lesbar. */
async function coverageSeries(): Promise<CoverageSeries[] | null> {
	try {
		const [info, dists] = await Promise.all([getSeriesInfo(), getSeriesYearDistributions()]);
		return info.map((s) => ({
			abbr: s.abbr,
			name: s.name,
			description: s.description,
			documents: s.documents,
			years: s.years,
			runs: yearRuns(dists[s.abbr]),
		}));
	} catch (err) {
		console.warn(`[mcp] coverage: Serien nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

/** Umfang der drei Zusatz-Indizes; je eine `limit: 0`-Abfrage. null = nicht lesbar. */
async function coverageCatalog(): Promise<{ units: number } | null> {
	try {
		if (!(await catalogReady())) return null;
		// Wie jede Katalogabfrage nur die eigenen Treffer (`onPlatform = false`, filterOf).
		const res = await queryCatalog(
			{ q: "", sort: "relevance", offset: 0, limit: 0 },
			{ active: true, dateFrom: null, dateTo: null, level: [], bestand: [], digital: false },
		);
		return { units: res.total };
	} catch (err) {
		console.warn(`[mcp] coverage: Katalog nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

async function coverageEhedaten(): Promise<{ entries: number } | null> {
	try {
		if (!(await ehedatenReady())) return null;
		const empty = normalizeEhedatenArgs({});
		const res = await queryEhedaten({ q: "", sort: "relevance", offset: 0, limit: 0, filters: empty.filters, shared: empty.shared, groupBy: [] });
		return { entries: res.total };
	} catch (err) {
		console.warn(`[mcp] coverage: Ehedaten nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

async function coverageEditions(): Promise<{ pieces: number; byEdition: Partial<Record<EditionKey, number>> } | null> {
	try {
		if (!(await editionsReady())) return null;
		const empty = normalizeEditionArgs({});
		const res = await queryEditions({
			q: "",
			sort: "relevance",
			offset: 0,
			limit: 0,
			filters: empty.filters,
			shared: empty.shared,
			facets: ["edition"],
		});
		const byEdition: Partial<Record<EditionKey, number>> = {};
		for (const [key, count] of Object.entries(res.counts.edition ?? {})) {
			if (isIndexedEdition(key)) byEdition[key] = count;
		}
		return { pieces: res.total, byEdition };
	} catch (err) {
		console.warn(`[mcp] coverage: Editionen nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

/** Die vier Quellen parallel; jede einzeln ausfallsicher (null ⇒ im Bericht `error`). */
async function coverageData(): Promise<CoverageReport> {
	const [series, catalog, ehedaten, editions] = await Promise.all([
		coverageSeries(),
		coverageCatalog(),
		coverageEhedaten(),
		coverageEditions(),
	]);
	return buildCoverage({ series, catalog, ehedaten, editions });
}

// --- Resources ---------------------------------------------------------------

/** Löst `zszh://coverage` in den Bericht und eine `zszh://document/<id>`-URI in den
 *  Volltext auf (null = ungültige URI oder Dokument fehlt). Vom Route-Handler an
 *  handleRpc durchgereicht. */
export async function readMcpResource(uri: string): Promise<McpResourceContents | null> {
	if (uri === COVERAGE_URI) {
		return { uri, mimeType: "application/json", text: JSON.stringify(await coverageData(), null, 2) };
	}
	const id = parseDocumentUri(uri);
	if (!id) return null;
	const doc = await getDocument(id);
	if (!doc) return null;
	const text = `${doc.title}\n\n${doc.body ?? ""}`.trim();
	return { uri, mimeType: "text/plain", text };
}

// --- Dispatcher --------------------------------------------------------------

export async function runMcpTool(name: string, raw: Record<string, unknown>, base: string): Promise<McpToolOutput> {
	switch (name) {
		case "search":
			return toolSearch(raw, base);
		case "fetch":
			return toolFetch(raw, base);
		case "fetch_many":
			return toolFetchMany(raw, base);
		case "passage_search":
			return toolPassageSearch(raw, base);
		case "semantic_search":
			return toolRichSearch(raw, base, true);
		case "keyword_search":
			return toolRichSearch(raw, base, false);
		case "list_documents":
			return toolList(raw, base);
		case "count_documents":
			return toolCount(raw);
		case "timeline":
			return toolTimeline(raw);
		case "overview":
			return toolOverview(raw, base);
		case "similar_documents":
			return toolSimilar(raw, base);
		case "vector_search":
			return toolVectorSearch(raw, base);
		case "catalog_search":
			return toolCatalogSearch(raw, base);
		case "ehedaten_search":
			return toolEhedatenSearch(raw, base);
		case "edition_search":
			return toolEditionSearch(raw, base);
		case "coverage":
			return { structuredContent: await coverageData() };
		default:
			return { structuredContent: { error: `unknown_tool: ${name}` }, isError: true };
	}
}
