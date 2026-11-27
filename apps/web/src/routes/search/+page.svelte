<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	import { goto } from "$app/navigation";
	import { navigating, page } from "$app/state";
	import { searchParamsToUrl, effectiveSort, relevanceSortApplicable } from "$lib/searchParams";
	import type { SeriesAbbr } from "$lib/types";
	import { oldStyleSuffix } from "$lib/format";
	import CopyButton from "$lib/components/CopyButton.svelte";
	import Timeline from "$lib/components/Timeline.svelte";
	import Facets from "./Facets.svelte";
	import SearchExport from "./SearchExport.svelte";
	import RmFulltextHint from "./RmFulltextHint.svelte";
	import CatalogFacets from "./CatalogFacets.svelte";
	import CatalogResults from "./CatalogResults.svelte";
	import ListEnd from "./ListEnd.svelte";
	import CatalogTreeStart from "./CatalogTreeStart.svelte";
	import AllSourcesResults from "./AllSourcesResults.svelte";
	import EhedatenFacets, { type EhedatenPatch } from "./EhedatenFacets.svelte";
	import EhedatenResults from "./EhedatenResults.svelte";
	import EditionsFacets from "./EditionsFacets.svelte";
	import EditionsResults from "./EditionsResults.svelte";
	import {
		carriedYear,
		CATALOG_YEAR_MAX,
		CATALOG_YEAR_MIN,
		catalogTimelineClickLevels,
		writeCatalogParams,
		type CatalogFilters,
	} from "$lib/catalog";
	import { catalogFieldsRankable, type CatalogFieldEntry } from "$lib/catalogFields";
	import { EHEDATEN_YEAR_MAX, EHEDATEN_YEAR_MIN, writeEhedatenParams, type EhedatenFilterValues } from "$lib/ehedaten";
	import { NO_EDITIONS_FILTERS, writeEditionsParams, type EditionsFilterValues } from "$lib/editionTexts";
	import { SEARCH_VIEWS, searchViewUrl, unappliedNote, unappliedSharedFilters, writeSearchView, type SearchView } from "$lib/searchViews";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// Reiter (searchViews.ts): «Archivkatalog», «Ehedaten» bzw. «Editionen» nur mit lesbarem
	// Index (data.catalog, data.ehedaten bzw. data.editions null ⇒ Dokumentsuche, auch wenn
	// ?view=… in der URL steht). Alle Reiter teilen die Filterspalte (eine Facets-Instanz) und die URL:
	// Suchbegriff, ODER-Begriffe, Zeitraum, «nur im Titel» sowie Personen und Orte gelten in
	// allen, die Filter der anderen Reiter bleiben stehen und gelten beim Zurückwechseln wieder.
	const catalogView = $derived(data.catalog !== null);
	const ehedatenView = $derived(data.ehedaten !== null);
	const editionsView = $derived(data.editions !== null);
	// Reiter «Alle Quellen» (Standard): je Quelle ein Block (AllSourcesResults).
	const allView = $derived(data.overview !== null);
	type View = SearchView;
	const view = $derived<View>(
		allView ? "all" : catalogView ? "catalog" : ehedatenView ? "ehedaten" : editionsView ? "editions" : "documents",
	);
	// Zeitraum wie im Katalog ab Jahr 700 (Alle Quellen, Katalog, Editionen), sonst ab 1483 gekappt.
	const unclampedYears = $derived(allView || catalogView || editionsView);

	// Läuft gerade eine Such-Navigation (Filter/Sortierung/Seite)? Dann die
	// Ergebnis-Sektion dimmen, statt kommentarlos die alte Liste stehen zu
	// lassen. Auf die Such-Route gegated – der Klick auf ein Dokument soll
	// die Liste nicht ausbleichen.
	const searching = $derived(navigating.to?.route?.id === "/search");

	let q = $state(data.params.q);
	let anyTerms = $state<string[]>(data.params.anyTerms);
	let theme = $state(data.params.theme);
	let series = $state<SeriesAbbr[]>(data.params.series);
	// Zeitraum: in den Reitern «Archivkatalog» und «Editionen» ab 700 (parseCatalogFilters),
	// in der Dokumentsuche ab 1483 gekappt (parseSearchParams); carriedYear hält ein früheres
	// Jahr in der URL, solange es im Dokument-Reiter niemand ändert.
	let dateFrom = $state<number | null>(data.catalog || data.editions || data.overview ? data.catalogFilters.dateFrom : data.params.dateFrom);
	let dateTo = $state<number | null>(data.catalog || data.editions || data.overview ? data.catalogFilters.dateTo : data.params.dateTo);
	let sort = $state(data.params.sort);
	let topK = $state<number | null>(data.params.topK);
	let volumeNr = $state<number[]>(data.params.volumeNr);
	let startPg = $state<number[]>(data.params.startPg);
	let serialNr = $state<string[]>(data.params.serialNr);
	let resolutionId = $state<string[]>(data.params.resolutionId);
	let years = $state<number[]>(data.params.years);
	let persons = $state<string[]>(data.params.persons);
	let places = $state<string[]>(data.params.places);
	let organizations = $state<string[]>(data.params.organizations);
	let titleOnly = $state(data.params.titleOnly);
	// Katalog-Filter (Stufe, Bestand, Digitalisat, Feldsuche), auch im Dokument-Reiter gehalten.
	let catLevel = $state<string[]>(data.catalogFilters.level);
	let catBestand = $state<string[]>(data.catalogFilters.bestand);
	let catDigital = $state(data.catalogFilters.digital);
	let catFields = $state<CatalogFieldEntry[]>(data.catalogFilters.fields ?? []);
	// Ehedaten-Filter (Rollen, Kirchgemeinde, Raum …), ebenfalls in allen Reitern gehalten.
	const eheValues = (): EhedatenFilterValues => {
		const { active: _active, ...values } = data.ehedatenFilters;
		return values;
	};
	let ehe = $state<EhedatenFilterValues>(eheValues());
	// Filter der Editionen (Edition, Teil, Schlagwort, Faksimile), ebenso in allen Reitern gehalten.
	const edValues = (): EditionsFilterValues => {
		const { active: _active, ...values } = data.editionsFilters;
		return values;
	};
	let ed = $state<EditionsFilterValues>(edValues());

	$effect(() => {
		q = data.params.q;
		anyTerms = data.params.anyTerms;
		theme = data.params.theme;
		series = data.params.series;
		dateFrom = data.catalog || data.editions || data.overview ? data.catalogFilters.dateFrom : data.params.dateFrom;
		dateTo = data.catalog || data.editions || data.overview ? data.catalogFilters.dateTo : data.params.dateTo;
		catLevel = data.catalogFilters.level;
		catBestand = data.catalogFilters.bestand;
		catDigital = data.catalogFilters.digital;
		catFields = data.catalogFilters.fields ?? [];
		ehe = eheValues();
		ed = edValues();
		sort = data.params.sort;
		topK = data.params.topK;
		volumeNr = data.params.volumeNr;
		startPg = data.params.startPg;
		serialNr = data.params.serialNr;
		resolutionId = data.params.resolutionId;
		years = data.params.years;
		persons = data.params.persons;
		places = data.params.places;
		organizations = data.params.organizations;
		titleOnly = data.params.titleOnly;
	});

	type CatalogPatch = Partial<Pick<CatalogFilters, "level" | "bestand" | "digital" | "fields">>;

	// Such-URL aus dem Zustand der Filterspalte: alle Parameter der Dokumentsuche (die
	// geteilten Felder eingeschlossen), die Filter von Katalog, Ehedaten und Editionen und der
	// Reiter (`target`).
	function stateUrl(
		extra: Partial<typeof data.params> = {},
		catalogPatch: CatalogPatch = {},
		target: View = view,
		ehePatch: Partial<EhedatenFilterValues> = {},
		edPatch: Partial<EditionsFilterValues> = {},
	): URL {
		const url = searchParamsToUrl({
			q,
			anyTerms,
			theme,
			series,
			dateFrom: carriedYear(view, dateFrom, data.params.dateFrom, data.catalogFilters.dateFrom),
			dateTo: carriedYear(view, dateTo, data.params.dateTo, data.catalogFilters.dateTo),
			sort,
			topK,
			volumeNr,
			startPg,
			serialNr,
			resolutionId,
			years,
			persons,
			places,
			organizations,
			titleOnly,
			page: 1,
			pageSize: data.params.pageSize,
			...extra,
		});
		writeSearchView(url, target);
		writeCatalogParams(url, { level: catLevel, bestand: catBestand, digital: catDigital, fields: catFields, ...catalogPatch });
		writeEhedatenParams(url, { ...ehe, ...ehePatch });
		writeEditionsParams(url, { ...ed, ...edPatch });
		return url;
	}

	function applyAndNavigate(
		extra: Partial<typeof data.params> = {},
		catalogPatch: CatalogPatch = {},
		ehePatch: Partial<EhedatenFilterValues> = {},
		edPatch: Partial<EditionsFilterValues> = {},
	) {
		const url = stateUrl(extra, catalogPatch, view, ehePatch, edPatch);
		goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
	}

	// Felder des Reiters «Ehedaten»: Namen ohne Rolle und Herkunft sind die geteilten
	// Personen und Orte, das Jahr der geteilte Zeitraum.
	function applyEhedaten(patch: EhedatenPatch) {
		if (patch.persons) persons = patch.persons;
		if (patch.places) places = patch.places;
		if (patch.dates) {
			dateFrom = patch.dates.from;
			dateTo = patch.dates.to;
		}
		applyAndNavigate({}, {}, patch.filters ?? {});
	}

	// Blättern: nur die Seite der angezeigten Suche ändert sich (beide Reiter).
	function changePage(newPage: number) {
		const url = new URL(page.url);
		if (newPage > 1) url.searchParams.set("page", String(newPage));
		else url.searchParams.delete("page");
		// Wie bisher nach oben; Tastatur und Screenreader fahren bei den Treffern fort.
		void goto(url.pathname + url.search).then(() => document.getElementById("treffer")?.focus({ preventScroll: true }));
	}

	// Zeile «gesetzt, wirkt hier nicht» der Filterspalte (foreignFilters): entfernt die Filter
	// des genannten Reiters – Serie und Serien-Filter der Dokumente, Stufe/Bestand/Digitalisat/
	// Feldsuche des Katalogs, die Felder der Ehedaten bzw. Editionen. Thema und Namen bleiben.
	function clearForeign(target: Exclude<View, "all">) {
		if (target === "documents") {
			series = [];
			volumeNr = [];
			startPg = [];
			serialNr = [];
			resolutionId = [];
			years = [];
		} else if (target === "catalog") {
			catLevel = [];
			catBestand = [];
			catDigital = false;
			catFields = [];
		} else if (target === "ehedaten") {
			ehe = { mann: [], frau: [], kirche: [], raum: [], quelle: [], art: null, band: [] };
		} else {
			ed = { ...NO_EDITIONS_FILTERS };
		}
		applyAndNavigate();
	}

	// Reiterwechsel aus dem Zustand der Filterspalte statt aus dem href: ein Zeitraum,
	// den das Verlassen des Felds (blur) eben erst übernimmt, geht so nicht verloren.
	// Mit Modifier-Taste (neuer Tab) gilt der href.
	function switchView(target: View, e: MouseEvent) {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		if (target === view) return;
		const url = stateUrl({}, {}, target);
		goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
	}

	// Durchblätterbare Treffer: Thema mit Suchbegriff oder ODER-Begriffen endet bei rankedPool,
	// nach Relevanz und mit Thema allein endet die Liste am browseLimit; der Zähler nennt die
	// echte Treffermenge (#113) – die Seitenzahl endet ehrlich dort statt in leeren Seiten. Ohne
	// beides ist alles durchblätterbar.
	const browsableHits = $derived(
		Math.min(
			data.result.estimatedTotalHits,
			data.result.rankedPool ?? Number.POSITIVE_INFINITY,
			data.result.browseLimit ?? Number.POSITIVE_INFINITY,
		),
	);
	// Ende einer Liste, die ein Thema reiht.
	const themeListEnd = $derived(data.result.rankedPool ?? (data.result.themeRankedAll ? data.result.browseLimit : undefined));
	const totalPages = $derived(Math.max(1, Math.ceil(browsableHits / data.result.pageSize)));
	const seriesCounts = $derived(data.result.facetDistribution?.series ?? {});
	// Kontext für Doc-Links (?from=): die Such-URL der Trefferliste.
	const contextSearch = $derived(new URLSearchParams(page.url.search).toString());

	// Top-K (Themen-Umfang) wirkt in allen Thema+Datums-Sort-Modi: das Thema
	// wählt die K ähnlichsten (mit Suchbegriff/ODER innerhalb von deren
	// Treffern), sortiert werden diese K nach Datum. Bei Relevanz rankt das
	// Thema ohne Schnitt – Control ausgeblendet.
	const topKApplies = $derived(!!data.params.theme.trim() && data.params.sort !== "relevance");

	// Sort-Dropdown: "Relevanz/Ähnlichkeit" nur anbieten, wenn ein
	// Ranking-Signal da ist (Suchbegriff oder Thema). Sonst zeigt die Liste den
	// Effektiv-Sort (date_asc, älteste zuerst); sortChoice spiegelt ihn fürs
	// Dropdown, ohne die Zustands-`sort` zu ändern – die bleibt "relevance",
	// damit eine danach getippte Suche wieder nach Relevanz sortiert.
	const relevanceApplicable = $derived(relevanceSortApplicable(data.params));
	const sortChoice = $derived(effectiveSort(data.params));

	// Rollt die Reiterleiste, falls sie auf schmalen Bildschirmen breiter ist als ihr Platz,
	// so, dass der aktive Reiter zu sehen ist (nur seitlich, die Seite bleibt stehen).
	let tablistEl = $state<HTMLElement | null>(null);
	$effect(() => {
		const el = tablistEl;
		const active = el?.querySelector<HTMLElement>(`[data-view="${view}"]`);
		if (!el || !active || el.scrollWidth <= el.clientWidth) return;
		el.scrollLeft = Math.max(0, active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2);
	});

	// Reiterleiste: verfügbare Reiter mit Trefferzahl; href für «in neuem Tab öffnen», der
	// Klick läuft über switchView.
	const available: Record<View, boolean> = $derived({
		all: data.catalogAvailable || data.ehedatenAvailable || data.editionsAvailable,
		documents: true,
		catalog: data.catalogAvailable,
		ehedaten: data.ehedatenAvailable,
		editions: data.editionsAvailable,
	});
	const counts: Record<View, number | null> = $derived({
		all: null,
		documents: data.result.estimatedTotalHits,
		catalog: data.catalogCount,
		ehedaten: data.ehedatenCount,
		editions: data.editionsCount,
	});
	// Wirkt ein geteiltes Feld (Name, Thema) in einem Reiter nicht, gälte seine Zahl für eine
	// andere Auswahl: «–» mit dem Grund im Tooltip (unappliedSharedFilters).
	const tabs = $derived(
		SEARCH_VIEWS.filter((v) => available[v.id]).map((v) => {
			const u = searchViewUrl(page.url, v.id);
			const unapplied = unappliedSharedFilters(v.id, data.params, { catalogSemantic: data.catalogSemantic, editionsSemantic: data.editionsSemantic });
			return {
				...v,
				href: u.pathname + u.search,
				count: counts[v.id],
				unapplied,
				title: unapplied.length > 0 ? `${v.title}. ${unappliedNote(unapplied)}` : v.title,
			};
		}),
	);
	const viewLabel = $derived(SEARCH_VIEWS.find((v) => v.id === view)?.label ?? "");
	// Für Screenreader: was nach einer Änderung der Suche zu hören ist.
	const statusText = $derived.by(() => {
		if (searching) return "";
		const zahl = (n: number) => n.toLocaleString("de-CH");
		if (view !== "all") {
			const n = counts[view];
			const seite = data.params.page > 1 ? `, Seite ${zahl(data.params.page)}` : "";
			return n == null ? "" : `${viewLabel}: ${zahl(n)} Treffer${seite}`;
		}
		return tabs.flatMap((t) => (t.id !== "all" && t.count != null ? [`${t.label} ${zahl(t.count)}`] : [])).join(", ");
	});
	// Blöcke im Reiter «Alle Quellen»: dieselbe Regel wie die Reiterleiste.
	const unappliedBySource = $derived(
		Object.fromEntries(
			(["documents", "catalog", "ehedaten", "editions"] as const).map((id) => [
				id,
				unappliedSharedFilters(id, data.params, { catalogSemantic: data.catalogSemantic, editionsSemantic: data.editionsSemantic }),
			]),
		) as Record<Exclude<View, "all">, string[]>,
	);
	// Links der Blöcke im Reiter «Alle Quellen» in den Reiter der Quelle.
	const tabHrefs = $derived.by(() => {
		const out = {} as Record<Exclude<View, "all">, string>;
		for (const id of ["documents", "catalog", "ehedaten", "editions"] as const) {
			const u = searchViewUrl(page.url, id);
			out[id] = u.pathname + u.search;
		}
		return out;
	});
	// Katalog: Relevanz braucht einen Suchbegriff, ODER-Begriffe, ein Wort der Feldsuche oder
	// ein Thema, das der Katalog reihen kann – sonst chronologisch.
	const catalogHasQuery = $derived(
		relevanceSortApplicable({ ...data.params, theme: "" }) || catalogFieldsRankable(data.catalogFilters.fields),
	);
	const catalogRankable = $derived(catalogHasQuery || (data.catalogSemantic && data.params.theme.trim() !== ""));
	const catalogSort = $derived(catalogRankable || data.params.sort !== "relevance" ? data.params.sort : "date_asc");
	// Zeitleiste des Katalogs: ohne Stufenwahl zählen nur Dossiers, Subdossiers und Dokumente
	// (catalogTimelineLevels); ein Klick setzt diese Stufen (catalogTimelineClickLevels).
	const catalogTimelineCaption = $derived.by(() => {
		const lower = data.catalogFilters.level.length === 0;
		const what = data.catalog?.theme?.mode === "topK" ? "der ähnlichsten Einheiten" : "";
		const levels = lower
			? "zählt nur Dossiers, Subdossiers und Dokumente (obere Stufen über «Stufe» in den erweiterten Suchoptionen)"
			: `zählt die gewählten Stufen (${data.catalogFilters.level.join(", ")})`;
		return `Verteilung ${what ? `${what} ` : ""}über den Entstehungszeitraum – ${levels}, eine Einheit in jedem Jahr, das ihr Zeitraum berührt; Klick filtert ein Jahr, Ziehen einen Bereich${lower ? " (mit diesen Stufen)" : ""}`;
	});
	// Zeitraum-Felder des Katalogs: ab Jahr 700 (Urkunden), nicht erst ab 1483.
	const catalogDateBounds = { min: CATALOG_YEAR_MIN, max: Math.min(CATALOG_YEAR_MAX, new Date().getFullYear()) };
	// Ehedaten: Relevanz braucht einen Suchbegriff oder ODER-Begriffe (kein Thema).
	const ehedatenHasQuery = $derived(relevanceSortApplicable({ ...data.params, theme: "" }));
	const ehedatenSort = $derived(ehedatenHasQuery || data.params.sort !== "relevance" ? data.params.sort : "date_asc");
	// Editionen: Relevanz braucht einen Suchbegriff, ODER-Begriffe oder ein Thema mit Vektoren.
	const editionsRankable = $derived(ehedatenHasQuery || (data.editionsSemantic && data.params.theme.trim() !== ""));
	const editionsSort = $derived(editionsRankable || data.params.sort !== "relevance" ? data.params.sort : "date_asc");

	// Permalink zur Resultateliste: die Such-URL trägt den kompletten Zustand
	// (q, Modus, Filter, Facetten) – kopieren reicht.
	const listLink = () => `${window.location.origin}${window.location.pathname}${window.location.search}`;
</script>

<svelte:head>
	<title>Recherche | {SITE_NAME}</title>
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-8">
	<h1 class="sr-only">Recherche: {viewLabel}</h1>
	<a href="#treffer" class="skip-link">Zu den Treffern springen</a>
	<!-- Trefferzahl nach jeder Änderung ansagen (Screenreader); während der Suche leer. -->
	<p class="sr-only" role="status">{statusText}</p>
	<!-- Seit 2026-11 ohne eigene KI-Antwort: eine Frage (Startseite) wird zum Thema der Suche,
	     ausformulierte Antworten mit Belegen liefert ein eigener KI-Assistent über den
	     MCP-Server (Anleitung /about/ai). -->
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-7 text-xs text-zszh-600">
		<a
			href="/about/suchhilfe"
			class="hover:text-accent-600 underline underline-offset-2"
			title="Wie die Suche funktioniert: Wortanfänge, Tippfehler-Toleranz, Phrasen, Thema, Filterlogik"
		>
			Suchhilfe
		</a>
		<a
			href="/about/ai"
			class="hover:text-accent-600 underline underline-offset-2"
			title="Claude, ChatGPT, Apertus und andere KI-Assistenten über die MCP-Schnittstelle mit dem Archiv verbinden – für ausformulierte Antworten mit Quellenangaben"
		>
			Eigene KI anbinden
		</a>
	</div>

	{#if tabs.length > 1}
		<!-- Reiter: Dokumente (Volltexte der Plattform) | Archivkatalog (Verzeichnungs-
		     einheiten des Staatsarchivs) | Ehedaten (Eheeinträge der Kirchenbücher). Links statt
		     Knöpfe: Zustand steckt in der URL. Auf dem Handy steht die Zahl unter dem Namen (drei
		     Reiter passen auf 343 px); reicht es trotzdem nicht, rollt die Leiste seitlich und
		     zeigt den aktiven Reiter (scrollActiveTab). -->
		<!-- Auf dem Handy Kurzlabels («Alle», «Katalog», «Serien») und ein Verlauf am rechten
		     Rand als Hinweis, dass die Leiste weitergeht. -->
		<div class="relative mb-6">
		<nav
			bind:this={tablistEl}
			aria-label="Suchbereich"
			class="flex gap-0.5 sm:gap-1 shadow-[inset_0_-1px_0] shadow-zszh-200 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none]"
		>
			{#each tabs as tab (tab.id)}
				{@const selected = tab.id === view}
				<a
					aria-current={selected ? "page" : undefined}
					data-view={tab.id}
					href={tab.href}
					onclick={(e) => switchView(tab.id, e)}
					data-sveltekit-noscroll
					title={tab.title}
					class="shrink-0 px-2.5 sm:px-4 py-1.5 sm:py-2 text-sm font-medium leading-tight sm:leading-normal border-b-2 {selected ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600 hover:text-zszh-900'}"
				>
					<span class="sm:hidden">{tab.mobileLabel}</span><span class="hidden sm:inline">{tab.label}</span>
					{#if tab.count != null && tab.unapplied.length > 0}
						<span class="block sm:inline text-zszh-500 font-normal tabular-nums text-xs sm:text-sm"
							>(–)<span class="sr-only">, {unappliedNote(tab.unapplied)}</span></span
						>
					{:else if tab.count != null}
						<span class="block sm:inline text-zszh-500 font-normal tabular-nums text-xs sm:text-sm">({tab.count.toLocaleString("de-CH")})</span>
					{/if}
				</a>
			{/each}
		</nav>
		<div aria-hidden="true" class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-zszh-50 to-transparent sm:hidden"></div>
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">
		<!-- Eine Filterspalte für beide Reiter: dieselbe Instanz bleibt beim Wechsel
		     stehen (samt halb getippter Eingaben und aufgeklappter Optionen). -->
		<Facets
			bind:q
			bind:anyTerms
			bind:series
			bind:dateFrom
			bind:dateTo
			bind:theme
			bind:topK
			bind:volumeNr
			bind:startPg
			bind:serialNr
			bind:resolutionId
			bind:years
			bind:persons
			bind:places
			bind:organizations
			bind:titleOnly
			{seriesCounts}
			semanticAvailable={catalogView ? data.catalogSemantic : ehedatenView ? false : editionsView ? data.editionsSemantic : data.semanticAvailable}
			entityKeysAvailable={data.entityKeysAvailable}
			dateBounds={unclampedYears ? catalogDateBounds : ehedatenView ? { min: EHEDATEN_YEAR_MIN, max: EHEDATEN_YEAR_MAX } : data.dateBounds}
			{contextSearch}
			onApply={() => applyAndNavigate()}
			onReset={() => {
				catLevel = [];
				catBestand = [];
				catDigital = false;
				catFields = [];
				ehe = { mann: [], frau: [], kirche: [], raum: [], quelle: [], art: null, band: [] };
				ed = { ...NO_EDITIONS_FILTERS };
			}}
			{topKApplies}
			{view}
			catalogFilters={data.catalogFilters}
			ehedatenFilters={ehe}
			editionsFilters={ed}
			onClearForeign={clearForeign}
		>
			{#snippet catalogSection()}
				{#if data.catalog}
					<CatalogFacets
						filters={data.catalogFilters}
						facets={data.catalog.facets}
						{contextSearch}
						onApply={(patch) => applyAndNavigate({}, patch)}
					/>
				{/if}
			{/snippet}
			{#snippet editionsSection()}
				{#if data.editions}
					<EditionsFacets filters={edValues()} facets={data.editions.facets} onApply={(patch) => applyAndNavigate({}, {}, {}, patch)} />
				{/if}
			{/snippet}
			{#snippet ehedatenSection()}
				{#if data.ehedaten}
					<EhedatenFacets
						filters={data.ehedatenFilters}
						persons={data.params.persons}
						places={data.params.places}
						dateFrom={data.params.dateFrom}
						dateTo={data.params.dateTo}
						facets={data.ehedaten.facets}
						{contextSearch}
						onApply={applyEhedaten}
					/>
				{/if}
			{/snippet}
		</Facets>

		<h2 id="treffer" tabindex="-1" class="sr-only">Treffer</h2>
		{#if data.overview}
			<section
				aria-busy={searching}
				class="min-w-0 transition-opacity {searching ? 'opacity-50 duration-300 delay-150' : 'duration-100'}"
			>
				<AllSourcesResults
					landing={data.overview.landing}
					documents={data.result}
					catalog={data.overview.catalog}
					ehedaten={data.overview.ehedaten}
					editions={data.overview.editions}
					counts={{ documents: counts.documents, catalog: counts.catalog, ehedaten: counts.ehedaten, editions: counts.editions }}
					unapplied={unappliedBySource}
					hrefs={tabHrefs}
					available={{ documents: true, catalog: data.catalogAvailable, ehedaten: data.ehedatenAvailable, editions: data.editionsAvailable }}
					{contextSearch}
					documentBounds={data.dateBounds}
				/>
			</section>
		{:else if data.catalog}
			<section
				aria-busy={searching}
				class="transition-opacity {searching ? 'opacity-50 duration-300 delay-150' : 'duration-100'}"
			>
				{#if data.catalog.timeline && data.catalogTimelineBounds}
					<div class="mb-6">
						<Timeline
							spans={data.catalog.timeline}
							min={data.catalogTimelineBounds.min}
							max={data.catalogTimelineBounds.max}
							dateFrom={data.catalogFilters.dateFrom}
							dateTo={data.catalogFilters.dateTo}
							zoomSplit={null}
							note={data.catalog.timeline.undated > 0
								? `${data.catalog.timeline.undated.toLocaleString("de-CH")} ohne Datum`
								: undefined}
							onApply={(from, to) => {
								// Balken = Treffer nach Klick: ohne Stufenwahl die gezählten unteren Stufen setzen.
								dateFrom = from;
								dateTo = to;
								catLevel = catalogTimelineClickLevels(catLevel, from, to);
								applyAndNavigate({ dateFrom: from, dateTo: to });
							}}
							caption={catalogTimelineCaption}
						/>
					</div>
				{/if}
				{#if data.catalogTree}
					<CatalogTreeStart
						tree={data.catalogTree}
						total={data.catalog.total}
						onList={() => {
							sort = "date_asc";
							applyAndNavigate();
						}}
					/>
				{:else}
					<CatalogResults
						result={data.catalog}
						sort={catalogSort}
						hasQuery={catalogHasQuery}
						themed={data.catalogSemantic && !!data.params.theme.trim()}
						{contextSearch}
						onSort={(s) => {
							sort = s;
							applyAndNavigate();
						}}
						onPage={changePage}
					/>
				{/if}
			</section>
		{:else if data.ehedaten}
			<!-- min-w-0: sonst hält die Tabelle die Grid-Spalte breit und die Seite rollt seitlich. -->
			<section
				aria-busy={searching}
				class="min-w-0 transition-opacity {searching ? 'opacity-50 duration-300 delay-150' : 'duration-100'}"
			>
				{#if data.ehedaten.timeline}
					<div class="mb-6">
						<Timeline
							spans={data.ehedaten.timeline}
							min={data.ehedatenTimelineBounds.min}
							max={data.ehedatenTimelineBounds.max}
							dateFrom={data.params.dateFrom}
							dateTo={data.params.dateTo}
							zoomSplit={null}
							onApply={(from, to) => {
								dateFrom = from;
								dateTo = to;
								applyAndNavigate({ dateFrom: from, dateTo: to });
							}}
							caption="Eheeinträge je Jahr (1524–1800) – Klick filtert ein Jahr, Ziehen einen Bereich"
						/>
					</div>
				{/if}
				<EhedatenResults
					result={data.ehedaten}
					sort={ehedatenSort}
					hasQuery={ehedatenHasQuery}
					{contextSearch}
					onSort={(s) => {
						sort = s;
						applyAndNavigate();
					}}
					onPage={changePage}
				/>
			</section>
		{:else if data.editions}
			<section
				aria-busy={searching}
				class="min-w-0 transition-opacity {searching ? 'opacity-50 duration-300 delay-150' : 'duration-100'}"
			>
				{#if data.editions.timeline && data.editionsTimelineBounds}
					<div class="mb-6">
						<Timeline
							spans={data.editions.timeline}
							min={data.editionsTimelineBounds.min}
							max={data.editionsTimelineBounds.max}
							dateFrom={data.catalogFilters.dateFrom}
							dateTo={data.catalogFilters.dateTo}
							zoomSplit={null}
							note={data.editions.timeline.undated > 0
								? `${data.editions.timeline.undated.toLocaleString("de-CH")} ohne Datum`
								: undefined}
							onApply={(from, to) => {
								dateFrom = from;
								dateTo = to;
								applyAndNavigate({ dateFrom: from, dateTo: to });
							}}
							caption={data.editions.theme?.mode === "topK"
								? "Verteilung der ähnlichsten Stücke über die Jahre – Klick filtert ein Jahr, Ziehen einen Bereich"
								: "Stücke je Jahr – ein Stück zählt in jedem Jahr, das sein Datum berührt; Klick filtert ein Jahr, Ziehen einen Bereich"}
						/>
					</div>
				{/if}
				<EditionsResults
					result={data.editions}
					sort={editionsSort}
					hasQuery={ehedatenHasQuery}
					themed={data.editionsSemantic && !!data.params.theme.trim()}
					{contextSearch}
					onSort={(s) => {
						sort = s;
						applyAndNavigate();
					}}
					onPage={changePage}
				/>
			</section>
		{:else}

		<!-- Dim-Verzögerung nur beim Eintritt (150 ms): schnelle Antworten
		     flackern nicht, das Aufhellen danach kommt sofort. -->
		<section
			aria-busy={searching}
			class="transition-opacity {searching ? 'opacity-50 duration-300 delay-150' : 'duration-100'}"
		>
			<div class="mb-6">
				<Timeline
					buckets={data.timelineBuckets}
					min={data.timelineBounds.min}
					max={data.timelineBounds.max}
					{dateFrom}
					{dateTo}
					onApply={(from, to) => {
						dateFrom = from;
						dateTo = to;
						applyAndNavigate({ dateFrom: from, dateTo: to });
					}}
					caption="Treffer-Verteilung über die Jahre – Klick filtert ein Jahr, Ziehen einen Bereich; die Zeitleiste zoomt mit"
				/>
			</div>

			<div class="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm text-zszh-700 mb-4">
				<div>
					<strong class="tabular-nums">{data.result.estimatedTotalHits.toLocaleString("de-CH")}</strong>
					<!-- topKOfTotal signalisiert: der Top-K-Schnitt ist WIRKLICH gelaufen
					     (nicht nur laut Params fällig) – bei Embed-Ausfall fällt die Suche
					     lexikalisch zurück und das Label bleibt schlicht «Treffer». -->
					{#if data.result.topKOfTotal != null && data.result.topKOfTotal > data.result.estimatedTotalHits}
						ähnlichste von {data.result.topKOfTotal.toLocaleString("de-CH")} Treffern
					{:else if data.result.topKOfTotal != null}
						ähnlichste Treffer
					{:else}
						Treffer
					{/if}
					<!-- exactTotal: so viele Treffer enthalten alle Wörter genau so geschrieben; sie
					     stehen zuerst, danach die ähnlichen Schreibungen (server/tiers.ts). -->
					{#if data.result.exactTotal != null && data.result.exactTotal < data.result.estimatedTotalHits}
						<span
							title="Zuerst die Treffer, in denen alle Wörter genau so geschrieben stehen, danach ähnliche Schreibungen: Wortanfang («Pause» auch «Pausen»), ein Tippfehler bei längeren Wörtern oder ein zerlegtes Wort («Seehof» auch «See Hof»)."
							>(davon {data.result.exactTotal.toLocaleString("de-CH")} genau so geschrieben)</span
						>
					{/if}
					<!-- Der Zähler nennt die echte Treffermenge, durchblätterbar sind davon nur so
					     viele (#113); mit einem Thema zuerst die ähnlichsten. -->
					{#if themeListEnd != null && themeListEnd < data.result.estimatedTotalHits}
						<span
							title="Mit einem Thema lassen sich {themeListEnd.toLocaleString(
								'de-CH',
							)} Treffer durchblättern, zuerst die ähnlichsten – die Trefferzahl zählt alle."
							>(davon {themeListEnd.toLocaleString("de-CH")} durchblätterbar)</span
						>
					{:else if data.result.browseLimit != null && data.result.browseLimit < data.result.estimatedTotalHits}
						<span
							title="In dieser Reihung lassen sich die ersten {data.result.browseLimit.toLocaleString(
								'de-CH',
							)} Treffer durchblättern – die Trefferzahl zählt alle. Nach Datum sortiert oder mit engeren Filtern erreichen Sie auch die übrigen."
							>(davon {data.result.browseLimit.toLocaleString("de-CH")} durchblätterbar)</span
						>
					{/if}
					<span class="text-zszh-600">in {data.result.processingTimeMs} ms</span>
				</div>
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-zszh-600">
					{#if data.result.hits.length > 0}
						<CopyButton
							text={listLink}
							label="Link zur Trefferliste kopieren"
							title="Kopiert die URL dieser Trefferliste inkl. aller Filter"
							class="hover:text-zszh-900 hover:underline"
						/>
						<SearchExport params={data.params} result={data.result} disabled={searching} />
					{/if}
					{#if totalPages > 1}
						<span class="flex items-center gap-1.5">
							<button
								type="button"
								class="px-2 py-0.5 border border-zszh-300 rounded text-sm disabled:opacity-50"
								disabled={data.result.page <= 1}
								aria-label="Vorherige Seite"
								onclick={() => changePage(data.result.page - 1)}
							>
								←
							</button>
							<span class="tabular-nums">{data.result.page} / {totalPages}</span>
							<button
								type="button"
								class="px-2 py-0.5 border border-zszh-300 rounded text-sm disabled:opacity-50"
								disabled={data.result.page >= totalPages}
								aria-label="Nächste Seite"
								onclick={() => changePage(data.result.page + 1)}
							>
								→
							</button>
						</span>
					{:else}
						<span>Seite {data.result.page} von {totalPages}</span>
					{/if}
					<label class="flex items-center gap-1.5">
						<span class="sr-only">Sortierung</span>
						<select
							value={sortChoice}
							onchange={(e) => {
								sort = e.currentTarget.value as typeof sort;
								applyAndNavigate();
							}}
							class="px-2 py-1 bg-white border border-zszh-300 rounded text-sm"
						>
							{#if relevanceApplicable}
								<option value="relevance">
									{data.params.theme.trim() ? "Ähnlichkeit" : "Relevanz"}
								</option>
							{/if}
							<option value="date_asc">Datum aufsteigend</option>
							<option value="date_desc">Datum absteigend</option>
						</select>
					</label>
				</div>
			</div>

			<RmFulltextHint hints={data.rmFulltext} />

			{#if data.result.hits.length === 0 && data.result.estimatedTotalHits > 0 && data.result.page > totalPages}
				<ListEnd lastPage={totalPages} onPage={changePage} />
			{:else if data.result.hits.length === 0}
				<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
					Keine Treffer gefunden. Versuche es mit anderen Suchbegriffen oder weniger Filtern.
				</div>
			{:else}
				<ul>
					{#each data.result.hits as hit, i (hit.id)}
						{@const globalPos = (data.result.page - 1) * data.result.pageSize + i}
						{@const hitHref = `/documents/${hit.series}/${hit.id}?${new URLSearchParams({ from: contextSearch, pos: String(globalPos) }).toString()}`}
						{@const exactTotal = data.result.exactTotal}
						{@const fuzzy = exactTotal != null && exactTotal < data.result.estimatedTotalHits && globalPos >= exactTotal}
						{#if fuzzy && globalPos === exactTotal}
							<li class="pt-2 pb-1 text-sm text-zszh-700 border-t border-dashed border-zszh-300">
								<strong>Ähnliche Schreibungen</strong>
								<span class="text-zszh-600">
									– {exactTotal === 0 ? "kein Treffer enthält alle Wörter genau so;" : "ab hier"} Wortanfang, Tippfehler oder zerlegtes
									Wort. Mit «exakt» bzw. Anführungszeichen nur die genaue Schreibung.
								</span>
							</li>
						{/if}
						<li
							id={`hit-${hit.id}`}
							class="hit-row pt-3.5 pb-5 scroll-mt-4"
							class:hit-fuzzy={fuzzy}
						>
							<div class="flex items-baseline gap-3 mb-1">
								<span class="badge-code">
									{hit.series}
								</span>
								{#if hit.date}
									<time class="text-xs text-zszh-600">{hit.date}{oldStyleSuffix(hit.series, hit.date)}</time>
								{/if}
								{#if hit.stazhIdent}
									<span class="text-xs text-zszh-600">· {hit.stazhIdent}</span>
								{/if}
							</div>
							<h3 class="font-serif text-lg font-semibold text-zszh-900 leading-tight">
								<a href={hitHref} class="hit-link">{@html hit.titleHtml}</a>
							</h3>
							{#if hit.textHtml}
								<p class="text-sm text-zszh-700 mt-2 leading-relaxed kwic">
									…{@html hit.textHtml}…
								</p>
							{/if}
						</li>
					{/each}
				</ul>

				{#if totalPages > 1}
					<nav aria-label="Seiten" class="mt-8 flex justify-center gap-2">
						<button
							type="button"
							class="px-3 py-1 border border-zszh-300 rounded text-sm disabled:opacity-50"
							disabled={data.result.page <= 1}
							onclick={() => changePage(data.result.page - 1)}
						>
							← Zurück
						</button>
						<span class="px-3 py-1 text-sm text-zszh-700">
							{data.result.page} / {totalPages}
						</span>
						<button
							type="button"
							class="px-3 py-1 border border-zszh-300 rounded text-sm disabled:opacity-50"
							disabled={data.result.page >= totalPages}
							onclick={() => changePage(data.result.page + 1)}
						>
							Weiter →
						</button>
					</nav>
				{/if}
			{/if}
		</section>
		{/if}
	</div>
</div>

<style>
	:global(.kwic mark, .kwic em.match) {
		background-color: #ffd9e6;
		font-style: normal;
		font-weight: 500;
		padding: 0 2px;
		border-radius: 2px;
	}
	/* Ähnliche Schreibungen (nach der Grenze exactTotal): die Fundstelle gepunktet statt
	   gefüllt – sie ist nicht genau das gesuchte Wort. */
	.hit-fuzzy :global(mark.match) {
		background-color: transparent;
		padding: 0;
		text-decoration: underline dotted rgb(202 138 4);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
	:global(.kwic mark.entity-match),
	:global(mark.entity-match) {
		background-color: rgb(191 219 254);
		color: inherit;
		font-style: normal;
		font-weight: 500;
		padding: 0 2px;
		border-radius: 2px;
	}
</style>
