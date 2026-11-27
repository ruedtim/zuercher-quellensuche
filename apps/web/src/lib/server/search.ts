import {
	docTitleFields,
	entityKeysReady,
	hitsWithVectors,
	searchDocuments,
	searchTextReady,
	searchTextReadyNow,
	searchWithTimeline,
	themeDocsAlone,
	themeDocsWithin,
	withEntityKeyFallback,
	withSearchTextFallback,
} from "./meili";
import { embedQuery, isEmbedderHealthy } from "./embed";
import { effectiveSort, foldRmSharpS, foldSingleAnyTerm, unionHighlightTerms } from "$lib/searchParams";
import { CORPUS_CAP, DEFAULT_TOPK, type SearchParams, type SearchResponse } from "$lib/types";
import { BROWSE_LIMIT, beyondBrowseLimit, browseLimitOf, pageWithin } from "./browseLimit";
import { THEME_LIST_MAX } from "./themeOrder";
import { extractLexicalQuery, themeKeywords } from "./passageQuery";
import { cropAtBestWindow } from "./highlight";

export type ExecutedSearch = SearchResponse & { timelineBuckets: Record<string, number> };

export interface ExecuteSearchOptions {
	semanticAvailable?: boolean;
	// Optionale Projektion für die Meili-Hits (API v1 holt grosse Fenster ohne
	// Bodies) – wird in alle Pfade durchgereicht.
	attributesToRetrieve?: string[];
	// relevance-Sort nicht auf date_asc defaulten (öffentliche API behält ihren
	// dokumentierten Default – sonst Einfüge-Reihenfolge bei q="").
	rawSort?: boolean;
	// Positive Suchbegriffe müssen alle vorkommen (matchingStrategy "all"). Die
	// interaktive Suche (/search, /api/search, Nachbar-Navigation, Export) setzt
	// es; die öffentliche API v1 lässt es weg (weiches "last", rückwärtskompatibel).
	// ODER-Zweige (anyTerms, nur interaktiv) laufen unabhängig davon immer strikt.
	lexicalStrict?: boolean;
	// Treffer-Export: nur die geordnete Trefferliste (keine Facetten, kein
	// Highlight/Crop, keine Timeline) – gleiche Routing-Zweige, gleiche
	// Reihenfolge wie die Trefferliste. Nur mit page 1 (ein grosses Fenster).
	lean?: boolean;
	// Deckel fürs Fenster des Thema-allein-Rankings (Export): pageSize wird dort
	// darauf geklemmt. Die übrigen Thema-Zweige sind durch CORPUS_CAP bzw. topK
	// ohnehin begrenzt.
	hybridLimit?: number;
	// Nur die Folge der Treffer (Felder aus attributesToRetrieve), ohne Hervorhebung, Auszüge und
	// Zeitleiste: Nachbar-Navigation.
	bare?: boolean;
	// Nur Trefferzahl, Facetten und Zeitleiste (Zahl im Reiter, wenn ein anderer offen
	// ist). Nach Relevanz reiht das Thema nur – dann entfällt die Reihung; alle übrigen
	// Suchen laufen wie sonst.
	countOnly?: boolean;
}

/**
 * Führt eine Suche gemäss SearchParams aus – die eine Stelle, die den
 * Thema-Filter auflöst (auch für Nachbar-Navigation und /api/search, damit
 * die Hit-Reihenfolge überall identisch ist):
 * - theme + q (oder ODER-Union), Relevanz: der Suchbegriff bildet die Treffermenge,
 *   das Thema rankt sie (themeOrder.ts). Zähler, Facetten und Zeitleiste = dieselbe Suche
 *   ohne Thema.
 * - theme + q (oder ODER-Union), Datums-Sortierung: das Thema wählt die topK
 *   ähnlichsten der Suchbegriff-/Union-Treffer («Themen-Umfang»), diese K
 *   werden nach Datum sortiert (searchTopK) – ohne den Schnitt wäre das Thema
 *   bei Datums-Sort wirkungslos (bis 2026-07 wurde es hier still ignoriert).
 * - nur theme, Sortierung Relevanz: reines Ranking – Hybrid-Suche über ALLE
 *   Filter-Treffer, kein Top-K-Schnitt (die Treffer-Anzahl ist die
 *   Filter-Menge; ein gesetztes topK ist hier wirkungslos).
 * - nur theme, Datums-Sortierung: Top-K ähnlichste, clientseitig sortiert –
 *   ohne den Schnitt wäre das Thema bei nativem Datums-Sort wirkungslos.
 * - sonst: rein lexikalisch.
 * Ohne Suchbegriff UND Thema ist Relevanz bedeutungslos → effektiver Default
 * "älteste zuerst" (date_asc) statt Meilis Einfüge-Reihenfolge (effectiveSort);
 * die öffentliche API behält ihren relevance-Default via opts.rawSort.
 * Embed-Service down → Thema wird ignoriert (lexikalischer Fallback).
 * Mutiert params.topK im Thema-allein-Datums-Sort-Modus auf den Default-Umfang,
 * damit UI und Suche konsistent vom selben Wert sprechen.
 */
export async function executeSearch(
	params: SearchParams,
	opts?: ExecuteSearchOptions,
): Promise<ExecutedSearch> {
	if (opts?.lean === true && params.page !== 1) {
		throw new Error("executeSearch: lean verlangt page 1 (ein Fenster ab Treffer 1)");
	}
	// Namensfilter über die Vergleichsschlüssel, sobald der Index sie trägt: die Probe
	// einmal abwarten, damit buildFilter (synchron) schon beim ersten Aufruf richtig filtert;
	// lehnt Meili eine Schlüsselklausel ab, läuft die Suche einmal exakt neu.
	if (params.persons.length + params.places.length + params.organizations.length > 0) await entityKeysReady();
	// Suchtext-Stand des Index (ß → ss, titleSearch, exakte Treffer zuerst): die Probe einmal
	// abwarten; lehnt Meili `titleSearch` trotzdem ab, läuft die Suche einmal ohne.
	await searchTextReady();
	return withEntityKeyFallback(() => withSearchTextFallback(() => runSearch(params, opts)));
}

async function runSearch(params: SearchParams, opts?: ExecuteSearchOptions): Promise<ExecutedSearch> {
	const lean = opts?.lean === true;
	const countOnly = opts?.countOnly === true;
	const bare = opts?.bare === true;
	const theme = params.theme.trim();
	const semanticOk = theme ? (opts?.semanticAvailable ?? (await isEmbedderHealthy())) : false;
	// Thema-Vektor lazy + memoized statt eager: so läuft der Embed-Roundtrip
	// parallel zur Stufe-1-ID-Beschaffung (Promise.all in den Zweigen) statt
	// davor. Geroutet wird über themeExpected (Health-Check, 30 s gecacht);
	// scheitert der Embed-Call danach trotzdem (embedQuery fängt intern,
	// rejected nie), fällt der jeweilige Zweig wie bisher lexikalisch zurück.
	const themeExpected = !!(theme && semanticOk);
	let themeVectorPromise: Promise<number[] | null> | null = null;
	const getThemeVector = () => (themeVectorPromise ??= embedQuery(theme));
	// Umfang («Themen-Umfang») in allen Thema+Datums-Sort-Modi defaulten – dort
	// schneidet topK (Top-K ähnlichste, clientseitig nach Datum sortiert; mit
	// Suchbegriff/ODER innerhalb von DEREN Treffern – die Treffermenge bildet
	// weiter der Suchbegriff, nicht das Thema). Bei Relevanz rankt das Thema
	// ohne Schnitt (topK wirkungslos).
	// themeExpected statt Vektor-Erfolg: scheitert der Embed-Call später, wird
	// topK kosmetisch gesetzt, obwohl lexikalisch zurückgefallen wird
	// (seltener UI-only-Fall, betrifft nur die «Umfang»-Anzeige).
	// VOR dem Ein-Begriff-Fold unten (der ersetzt params durch eine lokale
	// Kopie): die Mutation muss die Roh-Params der UI treffen, sonst zeigt der
	// «Themen-Umfang» im transienten Ein-ODER-Begriff-Zustand keinen aktiven
	// Wert, obwohl der Schnitt läuft. topKMode hängt nicht an q/anyTerms.
	const topKMode = themeExpected && params.sort !== "relevance";
	if (topKMode && params.topK == null) params.topK = DEFAULT_TOPK;
	// Ein einzelner ODER-Begriff ist keine Union (der ODER-Zweig verlangt >= 2) –
	// als normaler Suchbegriff behandeln (an q anhängen), sonst würde er
	// ignoriert und die Suche liefe leer (= ganzer Korpus). Passiert im
	// Term-Adder transient beim ersten «oder»-Begriff, bevor der zweite dazukommt.
	// Lokale Kopie: die Roh-Params der UI (ODER-Chip) bleiben unangetastet.
	// Derselbe Fold gilt für Facetten-Typeahead und KI-Treffer-Scope.
	params = foldRmSharpS(foldSingleAnyTerm(params), searchTextReadyNow());
	const attributesToRetrieve = opts?.attributesToRetrieve;
	// Mit dem Volltext schneidet der Server die Auszüge eines Themas selbst (Thema allein, ODER +
	// Thema); ohne ihn (API) bleibt Meilis Auszug.
	const ownExcerpts = !lean && !bare && (!attributesToRetrieve || attributesToRetrieve.includes("body"));
	const strict = opts?.lexicalStrict ?? false;
	// Nur-Titel-Suche: den BM25-Arm aufs Titelfeld beschränken – aber nur, wenn
	// es überhaupt einen lexikalischen Begriff gibt (Suchbegriff oder ODER). Bei
	// Thema-allein rankt der Vektor den ganzen Doc, eine Titel-Restriktion wäre
	// dort bedeutungslos (der als q mitlaufende Thema-Text ist kein Suchbegriff).
	const hasLexical = params.q.trim() !== "" || params.anyTerms.length > 0;
	const searchOn = params.titleOnly && hasLexical ? docTitleFields() : undefined;
	// Effektive Sortierung des rein lexikalischen Pfads: ohne Suchbegriff/Thema
	// fällt relevance auf date_asc (s. effectiveSort). Die Thema-Pfade sind per
	// Definition rankbar (effectiveSort === params.sort), greifen das also nicht.
	const sort = opts?.rawSort ? params.sort : effectiveSort(params);

	// Listen ohne Thema: nach Datum ist jede Seite billig (Jahresfenster, dateWindow.ts), nach
	// Relevanz nicht – dort endet das Blättern am Deckel. Der Export (lean) holt ein Fenster ab
	// Treffer 1.
	const listPage = (run: (p: SearchParams) => Promise<ExecutedSearch>) =>
		sort === "relevance" && !lean ? withBrowseLimit(params, run) : run(params);
	// Rein lexikalischer Pfad – Standard-Route ohne (wirksames) Thema und
	// Fallback, wenn der Embed-Call trotz gesundem Health-Check scheitert.
	// tiered: «genau so geschrieben» zuerst, dann «ähnliche Schreibungen» (tiers.ts) – ab dem
	// Suchtext-Stand des Index (dort gelten die Ranking-Regeln, die nach Relevanz so reihen).
	const lexicalSearch = () =>
		listPage((p) =>
			searchWithTimeline(
				{ ...p, sort, semanticRatio: 0 },
				{
					vector: null,
					attributesToRetrieve,
					strict,
					attributesToSearchOn: searchOn,
					lean,
					tiered: searchTextReadyNow() && !countOnly,
					countOnly,
					bare,
				},
			),
		);
	// Föderation (pure ODER-Union): die Zweige laufen immer strikt
	// (combineUnionQuery), unabhängig vom opts-Flag.
	const federationSearch = () =>
		listPage((p) =>
			searchWithTimeline(
				{ ...p, sort, semanticRatio: 0 },
				{ vector: null, attributesToRetrieve, attributesToSearchOn: searchOn, lean, countOnly, bare },
			),
		);
	const emptyResult = (): ExecutedSearch => ({
		hits: [],
		estimatedTotalHits: 0,
		processingTimeMs: 0,
		facetDistribution: { series: {}, dateYear: {} },
		page: 1,
		pageSize: params.pageSize,
		timelineBuckets: {},
	});

	// Lexikalisches ODER (>= 2 Begriffe): deduplizierte Vereinigung.
	const union = params.anyTerms.length >= 2;

	// Suchbegriff bzw. ODER-Begriffe mit Thema: sie bilden die Treffermenge (nur-Titel wirkt hier),
	// das Thema reiht darin (themeDocsWithin). Zähler, Facetten und Zeitleiste sind die derselben
	// Suche ohne Thema und laufen neben dem Embedding.
	if (themeExpected && (union || params.q.trim())) {
		const [themeVector, counts] = await Promise.all([
			getThemeVector(),
			searchWithTimeline(
				{ ...params, sort: "relevance", semanticRatio: 0, page: 1, pageSize: 1 },
				{ vector: null, strict, attributesToSearchOn: searchOn, countOnly: true },
			),
		]);
		// Embed-Fehler VOR der Trefferzahl: ohne Vektor gilt die Suche ohne Thema – 0 Treffer
		// dürfen hier keine synthetische Leer-Antwort erzeugen.
		if (!themeVector) return union ? await federationSearch() : await lexicalSearch();
		const total = counts.estimatedTotalHits;
		if (total === 0) return emptyResult();
		const max = Math.min(total, lean ? CORPUS_CAP : THEME_LIST_MAX);
		const started = performance.now();
		const orderFor = (need: number) =>
			themeDocsWithin(params, {
				vector: themeVector,
				strict,
				attributesToSearchOn: searchOn,
				withVectors: hitsWithVectors(total, counts.facetDistribution?.series),
				years: counts.facetDistribution?.dateYear,
				need,
				max: lean ? CORPUS_CAP : THEME_LIST_MAX,
			});
		// Die Seite sucht bei ODER mit q = Thema und kennt die ODER-/UND-Begriffe nicht mehr –
		// Highlight + Crop werden serverseitig nachgezogen (applySnippetMarks). Sonst bleibt q der
		// Suchbegriff (Wort-Highlight + Crop um den Treffer, lexicalHighlight erzwingt die
		// Hervorhebung trotz Vektor).
		const pageParams = { ...params, anyTerms: [], q: union ? theme : params.q };
		const pageOpts = {
			vector: themeVector,
			attributesToRetrieve,
			attributesToSearchOn: searchOn,
			lean,
			bare,
			...(union
				? { highlightTerms: unionHighlightTerms(params.anyTerms, params.q), plain: ownExcerpts }
				: { lexicalHighlight: true, strict }),
		};
		if (sort !== "relevance") {
			// Datums-Sortierung: das Thema wählt die topK ähnlichsten der Treffer
			// («Themen-Umfang»), sortiert werden diese K nach Datum (searchTopK). Bewusst die
			// UMGEKEHRTE Richtung des 2026-06 entfernten Alt-Schnitts: die Treffermenge bildet der
			// Suchbegriff, das Thema schneidet nur darin. Zähler-Basis = echte Trefferzahl.
			const order = await orderFor(params.topK ?? DEFAULT_TOPK);
			return await searchWithTimeline({ ...pageParams, sort }, { ...pageOpts, order, candidates: total });
		}
		const counted = {
			estimatedTotalHits: total,
			facetDistribution: counts.facetDistribution,
			page: params.page,
			pageSize: params.pageSize,
			timelineBuckets: counts.timelineBuckets,
			...(total > max ? { rankedPool: max } : {}),
		};
		// Relevanz: Treffer ohne Vektor (Ratsmanuale) stehen am Ende. Durchblätterbar sind die
		// ersten `max` (rankedPool, #113), dahinter sucht niemand.
		if (countOnly || beyondBrowseLimit(params, max)) return { ...counted, hits: [], processingTimeMs: 0 };
		const offset = (params.page - 1) * params.pageSize;
		const end = Math.min(offset + params.pageSize, max);
		const order = await orderFor(end);
		const rankMs = Math.round(performance.now() - started);
		const main = await searchDocuments({ ...pageParams, topK: null }, { ...pageOpts, ranked: order.hits.slice(offset, end) });
		return {
			...counted,
			hits: main.hits,
			processingTimeMs: rankMs + main.processingTimeMs,
			semanticHitCount: Math.max(0, Math.min(order.ranked, end) - offset),
		};
	}
	// ODER ohne (wirksames) Thema → Föderation direkt: nach Relevanz nach Föderations-Score (bis zum
	// Deckel fürs Blättern), nach Datum über ein Jahresfenster der ganzen Vereinigung (dateWindow.ts).
	// searchWithTimeline verzweigt bei anyTerms>=2 auf searchDocumentsUnion.
	if (union) return await federationSearch();

	if (themeExpected) {
		// Thema allein. Zähler, Facetten und Zeitleiste laufen als Match-all über die Filter
		// (countMatchAll) neben dem Embedding – die Treffer-Anzahl ist die Filter-Menge, nicht die
		// lexikalische Trefferzahl des Fragetexts.
		const byRelevance = params.sort === "relevance";
		const [themeVector, counts] = await Promise.all([
			getThemeVector(),
			byRelevance
				? searchWithTimeline(
						{ ...params, q: theme, topK: null },
						{ vector: null, countMatchAll: true, vectorlessByKeyword: true, countOnly: true, lean },
					)
				: null,
		]);
		if (themeVector && counts) {
			// Reines Ranking aller Filter-Treffer (topK wirkungslos), durchblätterbar sind die ersten
			// THEME_LIST_MAX; der Export (lean) reicht bis hybridLimit. themeRankedAll markiert den
			// Zweig für den Export-Zähler.
			const total = counts.estimatedTotalHits;
			const max = lean ? Math.min(params.pageSize, opts?.hybridLimit ?? params.pageSize) : THEME_LIST_MAX;
			const base = {
				estimatedTotalHits: total,
				facetDistribution: counts.facetDistribution,
				page: params.page,
				pageSize: params.pageSize,
				timelineBuckets: counts.timelineBuckets,
				themeRankedAll: true,
				...(lean ? {} : browseLimitOf(total, THEME_LIST_MAX)),
			};
			if (countOnly || beyondBrowseLimit(params, Math.min(max, total))) return { ...base, hits: [], processingTimeMs: 0 };
			const offset = (params.page - 1) * params.pageSize;
			const end = Math.min(offset + params.pageSize, max);
			const started = performance.now();
			const order = await themeDocsAlone(params, { vector: themeVector, theme, matches: total, need: end, max });
			const rankMs = Math.round(performance.now() - started);
			const ranked = order.hits.slice(offset, end);
			// Auszüge um die Wörter des Themas: aus dem Volltext (themeExcerpts), sonst von Meili – auch
			// wo die Seite Stichworttreffer zeigt (Ratsmanuale, das Wort oft in alter Schreibung).
			const main = await searchDocuments(
				{ ...params, q: themeKeywords(theme), topK: null },
				{
					vector: themeVector,
					attributesToRetrieve,
					lean,
					plain: ownExcerpts && offset + ranked.length <= order.ranked,
					bare,
					ranked,
				},
			);
			const res = {
				...base,
				hits: main.hits,
				processingTimeMs: rankMs + main.processingTimeMs,
				semanticHitCount: Math.max(0, Math.min(order.ranked, end) - offset),
			};
			return themeExcerpts(res, theme, lean);
		}
		if (themeVector) {
			// Datums-Sortierung: Top-K ähnlichste, clientseitig sortiert (searchTopK
			// via sortNeedsTopK/topK).
			const res = await searchWithTimeline(
				{ ...params, q: theme },
				{ vector: themeVector, vectorlessByKeyword: true, attributesToRetrieve, lean, plain: ownExcerpts, bare },
			);
			return themeExcerpts(res, theme, lean);
		}
		// Embed-Fehler → lexikalischer Fallback (wie themeActive=false bisher).
	}
	return await lexicalSearch();
}

/**
 * Deckel fürs Blättern: nach Relevanz ohne Thema, weil Meili jede Seite mit allem davor berechnet
 * (browseLimit.ts), mit Thema, weil die Liste so lang ist (themeOrder.ts). Nach Datum sortiert
 * bleibt alles erreichbar. Hinter dem Deckel nur Zahlen und Facetten.
 */
async function withBrowseLimit(
	params: SearchParams,
	run: (p: SearchParams) => Promise<ExecutedSearch>,
	limit: number = BROWSE_LIMIT,
): Promise<ExecutedSearch> {
	const res = await pageWithin(params, limit, run);
	return { ...res, ...browseLimitOf(res.estimatedTotalHits, limit) };
}

/**
 * Auszüge der Thema-Suche ohne Suchbegriff (Thema allein, auch die Frage von der
 * Startseite): Meili croppt um den ganzen Thema-Text samt Füllwörtern, das Fenster
 * lag so oft auf einer Stelle ohne das Thema. Stattdessen die Stelle mit den
 * meisten Inhaltswörtern des Themas (extractLexicalQuery ohne Frage-Rahmen,
 * cropAtBestWindow), markiert. Ohne Fundstelle bzw. ohne Body (Projektion der API)
 * bleibt Meilis Auszug; im Export (lean) gibt es keine Auszüge.
 */
function themeExcerpts<T extends SearchResponse>(res: T, theme: string, lean: boolean): T {
	if (lean) return res;
	const words = themeWords(theme);
	if (words.length === 0) return res;
	for (const hit of res.hits) {
		if (!hit.body || !hit._formatted) continue;
		const crop = cropAtBestWindow(hit.body, words, 30);
		if (crop) hit._formatted.body = crop;
	}
	return res;
}

/** Inhaltswörter eines Themas für den Auszug (ohne Operatoren und Anführungszeichen), höchstens 30. */
export function themeWords(theme: string): string[] {
	return extractLexicalQuery(theme, [])
		.split(/\s+/)
		.map((w) => w.replace(/^[-"„“«»]+|["„“«»]+$/g, ""))
		.filter((w) => w.length >= 3)
		.slice(0, 30);
}
