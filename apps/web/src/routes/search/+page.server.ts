import { redirect } from "@sveltejs/kit";
import { entityKeysReady, getCorpusYearDistribution } from "$lib/server/meili";
import { documentResultView, listAttributes } from "$lib/server/documentResult";
import { isEmbedderHealthy } from "$lib/server/embed";
import { executeSearch } from "$lib/server/search";
import { askRedirectTarget, RETIRED_ASK_PARAMS } from "$lib/server/askRedirect";
import { overviewIsLanding } from "$lib/overview";
import { foldSingleAnyTerm, parseSearchParams } from "$lib/searchParams";
import { searchPayload } from "$lib/server/analytics/extract";
import { catalogHasVectors, catalogReady, countCatalog, getCatalogTreeStart, searchCatalog } from "$lib/server/catalog";
import { catalogShowsTree, catalogTimelineAxis, parseCatalogFilters } from "$lib/catalog";
import { countEhedaten, ehedatenReady, searchEhedaten } from "$lib/server/ehedaten";
import { EHEDATEN_YEAR_MAX, EHEDATEN_YEAR_MIN, parseEhedatenFilters } from "$lib/ehedaten";
import { countEditions, editionsHaveVectors, editionsReady, searchEditions } from "$lib/server/editionTexts";
import { editionsTimelineAxis, parseEditionsFilters } from "$lib/editionTexts";
import { parseSearchView } from "$lib/searchViews";
import { yearBoundsFromDistribution } from "$lib/types";
import { timelineAxis } from "$lib/timelineBins";
import { rmFulltextHints } from "$lib/server/rmNames";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
	// Legacy-Redirects:
	// - ask=X (Frage von der Startseite, alte Links der KI-Antwort bis 2026-11) → Thema X im
	//   Reiter der Adresse, ein Zeitraum aus der Frage als Filter (askRedirect.ts); die übrigen
	//   Parameter der KI-Antwort (allSources, sources, model, confidential, noai) fallen weg.
	// - mode=rag&q=X (Drei-Modus-Welt) → wie ask=X.
	// - alpha>0&q=X → Thema-Filter (theme=X) – reproduziert die alte
	//   semantische Suche.
	{
		const legacy = new URL(url.href);
		if (legacy.searchParams.get("mode") === "rag") {
			legacy.searchParams.delete("mode");
			legacy.searchParams.delete("alpha");
			const q = (legacy.searchParams.get("q") ?? "").trim();
			legacy.searchParams.delete("q");
			legacy.searchParams.set("ask", q);
		}
		if (RETIRED_ASK_PARAMS.some((k) => legacy.searchParams.has(k))) {
			const target = askRedirectTarget(legacy, { semantic: await isEmbedderHealthy() });
			if (target) redirect(302, target);
		}
	}
	{
		const alphaRaw = Number.parseFloat(url.searchParams.get("alpha") ?? "");
		if (Number.isFinite(alphaRaw)) {
			const target = new URL(url.href);
			target.searchParams.delete("alpha");
			const q = (target.searchParams.get("q") ?? "").trim();
			if (alphaRaw > 0 && q && !target.searchParams.get("theme")) {
				target.searchParams.delete("q");
				target.searchParams.set("theme", q);
			}
			redirect(301, `${target.pathname}${target.search}`);
		}
	}

	const params = parseSearchParams(url);
	const view = parseSearchView(url.searchParams);
	const catalogFilters = parseCatalogFilters(url);
	const ehedatenFilters = parseEhedatenFilters(url);
	const editionsFilters = parseEditionsFilters(url);

	// Embedder-Status unabhängig vom Thema prüfen, damit das Thema-Feld in der
	// UI überhaupt sichtbar wird (Henne-Ei sonst; ohne Embed-Service degradiert die
	// Suche lexikalisch). Ohne lesbaren Katalog-Index (fehlt, Such-Key ohne `catalog`)
	// entfällt der Reiter «Archivkatalog», ohne den Index `ehedaten` der Reiter «Ehedaten»,
	// ohne `editions` der Reiter «Editionen». Trägt der documents-Index die
	// Vergleichsschlüssel, wählen die Namensfelder der Dokumente über sie.
	const [semanticAvailable, catalogAvailable, ehedatenAvailable, editionsAvailable, entityKeysAvailable] = await Promise.all([
		isEmbedderHealthy(),
		catalogReady(),
		ehedatenReady(),
		editionsReady(),
		entityKeysReady(),
	]);
	// Thema im Katalog-Reiter: Embed-Service gesund und Katalog-Index mit Vektoren.
	const catalogSemantic = semanticAvailable && catalogAvailable && catalogHasVectors();
	// Thema im Reiter «Editionen»: Vektoren aus Titel, Schlagwörtern, Regest und Kommentar.
	const editionsSemantic = semanticAvailable && editionsAvailable && editionsHaveVectors();

	// Reiter «Archivkatalog» bzw. «Ehedaten»: deren Suche; die Dokumentsuche läuft dann nur
	// für ihre Trefferzahl (Reiter-Label) mit einem Treffer pro Seite. Fehlt der
	// Index des gewählten Reiters, gilt die Dokumentsuche. Ohne Thema hängt die Zahl nicht
	// an der Sortierung – nach Relevanz spart sie bei ODER nach Datum das Jahresfenster
	// (dateWindow.ts; Prod 2026-10-31: 45 statt 140–240 ms).
	const catalogTab = catalogAvailable && view === "catalog";
	const ehedatenTab = ehedatenAvailable && view === "ehedaten";
	const editionsTab = editionsAvailable && view === "editions";
	// Reiter «Alle Quellen» (Standard, docs/alle-quellen-plan.md): je Quelle ein Block mit
	// Trefferzahl und den ersten OVERVIEW_HITS Treffern, ohne Facetten und Zeitleisten
	// (Option `overview`). Ohne jede Eingabe der Landeplatz: nur die Zählungen. Fehlen alle
	// Zusatzindizes, gilt die Dokumentsuche.
	const allTab = view === "all" && (catalogAvailable || ehedatenAvailable || editionsAvailable);
	const documentsTab = !catalogTab && !ehedatenTab && !editionsTab && !allTab;
	const landing = allTab && overviewIsLanding(params, catalogFilters, catalogFilters, ehedatenFilters, editionsFilters);
	const overviewSearch = allTab && !landing;
	const OVERVIEW_HITS = 5;
	const documentCountParams = {
		...params,
		page: 1,
		pageSize: 1,
		...(params.theme.trim() ? {} : { sort: "relevance" as const }),
	};
	const documentOverviewParams = { ...params, page: 1, pageSize: OVERVIEW_HITS };
	// ODER-Begriffe gelten auch im Katalog (Vereinigung, catalogUnion.ts); ein einzelner
	// gilt wie in der Dokumentsuche als Suchbegriff.
	const catalogParams = foldSingleAnyTerm(params);
	// Ohne Suche und Filter zeigt der Katalog-Reiter den Archivbaum statt der Liste nach Datum
	// (catalogShowsTree); Trefferzahl, Facetten und Zeitleiste kommen weiter aus searchCatalog.
	const catalogTreeWanted = catalogTab && catalogShowsTree(catalogParams, catalogFilters, catalogSemantic);
	// Editionen: Zeitraum wie im Katalog ab 700 (QZH ab 1275), nicht ab 1483 gekappt.
	const editionsParams = { ...params, dateFrom: catalogFilters.dateFrom, dateTo: catalogFilters.dateTo };
	// Blöcke von «Alle Quellen»: ein Fehler einer Zusatzquelle (Meili 400/408, Key ohne Scope)
	// zeigt den Block als «nicht zählbar», statt die ganze Suchseite zur 500-Seite zu machen –
	// wie die Zählungen (count*) in den übrigen Reitern.
	const overviewBlock = <T,>(label: string, run: Promise<T>): Promise<T | null> =>
		run.catch((err) => {
			console.error(`[search] Block «${label}» in «Alle Quellen» nicht lesbar:`, err);
			return null;
		});
	// Suche ausführen – executeSearch löst den Thema-Filter auf (zweistufig
	// bei Thema + Suchbegriff) und fällt ohne embed-Service lexikalisch zurück.
	const [{ timelineBuckets, ...result }, catalog, catalogCount, ehedaten, ehedatenCount, editions, editionsCount, catalogTree, ovCatalog, ovEhedaten, ovEditions] =
		await Promise.all([
			executeSearch(documentsTab ? params : overviewSearch ? documentOverviewParams : documentCountParams, {
				semanticAvailable,
				lexicalStrict: true,
				attributesToRetrieve: listAttributes(params),
				// In den übrigen Reitern interessiert nur die Zahl.
				countOnly: !documentsTab && !overviewSearch,
			}),
			catalogTab ? searchCatalog(catalogParams, catalogFilters, { semantic: catalogSemantic }) : Promise.resolve(null),
			!catalogTab && !overviewSearch && catalogAvailable ? countCatalog(catalogParams, catalogFilters, { semantic: catalogSemantic }) : Promise.resolve(null),
			// Ehedaten: Suchbegriff, ODER-Begriffe, Zeitraum, Personen und Orte (Herkunft) wie die
			// anderen Reiter, dazu die eigenen Filter (auch in den anderen Reitern fürs Label).
			ehedatenTab ? searchEhedaten(params, ehedatenFilters) : Promise.resolve(null),
			!ehedatenTab && !overviewSearch && ehedatenAvailable ? countEhedaten(params, ehedatenFilters) : Promise.resolve(null),
			// Editionen: geteilte Felder wie der Katalog, dazu die eigenen Filter (Edition, Teil …).
			editionsTab ? searchEditions(editionsParams, editionsFilters, { semantic: editionsSemantic }) : Promise.resolve(null),
			!editionsTab && !overviewSearch && editionsAvailable ? countEditions(editionsParams, editionsFilters, { semantic: editionsSemantic }) : Promise.resolve(null),
			catalogTreeWanted ? getCatalogTreeStart() : Promise.resolve(null),
			// Blöcke des Reiters «Alle Quellen»: dieselben Suchen wie in den Reitern, erste Seite
			// mit OVERVIEW_HITS Treffern, ohne Zeitleiste und Drill-Sideways.
			overviewSearch && catalogAvailable
				? overviewBlock("Archivkatalog", searchCatalog({ ...catalogParams, page: 1, pageSize: OVERVIEW_HITS }, catalogFilters, { semantic: catalogSemantic, overview: true }))
				: Promise.resolve(null),
			overviewSearch && ehedatenAvailable
				? overviewBlock("Ehedaten", searchEhedaten({ ...params, page: 1, pageSize: OVERVIEW_HITS }, ehedatenFilters, { overview: true }))
				: Promise.resolve(null),
			overviewSearch && editionsAvailable
				? overviewBlock("Editionen", searchEditions({ ...editionsParams, page: 1, pageSize: OVERVIEW_HITS }, editionsFilters, { semantic: editionsSemantic, overview: true }))
				: Promise.resolve(null),
		]);
	// Themen-Umfang wie in der Dokumentsuche (executeSearch setzt dort den Default): die
	// Buttons der Filterspalte zeigen den Wert, mit dem der Katalog geschnitten hat.
	if (catalog?.theme?.topK != null && params.topK == null) params.topK = catalog.theme.topK;
	if (editions?.theme?.topK != null && params.topK == null) params.topK = editions.theme.topK;

	locals.analytics.search = catalog
		? { ...searchPayload(params, { estimatedTotalHits: catalog.total }), view: "catalog" }
		: ehedaten
			? { ...searchPayload(params, { estimatedTotalHits: ehedaten.total }), view: "ehedaten" }
			: editions
				? { ...searchPayload(params, { estimatedTotalHits: editions.total }), view: "editions" }
				: allTab
					? { ...searchPayload(params, result), view: "all" }
					: searchPayload(params, result);

	// Stabile Zeitstrahl-Achse: äusserste Korpus-Jahre (ungefiltert, gecached),
	// nicht die query-gefilterten Buckets – sonst springt die Achse pro Suche.
	// dateBounds (Eingabefelder) = ganzer Korpus; die Achse beginnt erst bei
	// Treffern oder Filtern vor 1803 mit den Ratsmanualen (timelineAxis).
	const dateBounds = yearBoundsFromDistribution(await getCorpusYearDistribution());
	const timelineBounds = timelineAxis(dateBounds, timelineBuckets, params);
	// Katalog-Zeitleiste: Spannweite der Treffer (ohne Zeitraumfilter), ab 700 bis heute.
	const catalogTimelineBounds = catalog?.timeline
		? catalogTimelineAxis(catalog.timeline, catalogFilters, new Date().getFullYear())
		: null;

	return {
		params,
		// Maskiert und ohne Volltexte (documentResult.ts).
		result: documentResultView(result),
		timelineBuckets,
		// Namensfilter finden die Ratsmanuale nicht (keine Entitätsfelder): Hinweis auf ihren
		// Volltext mit den Schreibungen aus dem Register der Editionen (rmNames.ts), gestreamt.
		rmFulltext: documentsTab ? rmFulltextHints(params) : null,
		// Reiter «Alle Quellen»: Blöcke je Quelle (null = ein anderer Reiter). Die Dokumente
		// stehen in `result` (erste OVERVIEW_HITS Treffer bzw. beim Landeplatz nur die Zahl).
		overview: allTab
			? {
					landing,
					catalog: ovCatalog,
					ehedaten: ovEhedaten,
					editions: ovEditions,
				}
			: null,
		catalogAvailable,
		catalogSemantic,
		catalogFilters,
		catalog,
		// Archivbaum als Startansicht des Katalog-Reiters (null = Trefferliste).
		catalogTree,
		// Katalogtreffer zu Suchbegriff und Zeitraum fürs Reiter-Label, auch ohne Suchbegriff.
		catalogCount: catalog ? catalog.total : ovCatalog ? ovCatalog.total : catalogCount,
		ehedatenAvailable,
		ehedatenFilters,
		ehedaten,
		ehedatenCount: ehedaten ? ehedaten.total : ovEhedaten ? ovEhedaten.total : ehedatenCount,
		// Feste Achse der Ehedaten (1524–1800): die Zeitleiste zoomt mit dem Zeitraum.
		ehedatenTimelineBounds: { min: EHEDATEN_YEAR_MIN, max: EHEDATEN_YEAR_MAX },
		editionsAvailable,
		editionsSemantic,
		editionsFilters,
		editions,
		editionsCount: editions ? editions.total : ovEditions ? ovEditions.total : editionsCount,
		// Achse der Editionen: Spannweite der Treffer ohne Zeitraumfilter (QZH 1275–1795).
		editionsTimelineBounds: editions?.timeline ? editionsTimelineAxis(editions.timeline, catalogFilters) : null,
		semanticAvailable,
		entityKeysAvailable,
		dateBounds,
		timelineBounds,
		catalogTimelineBounds,
	};
};
