<script lang="ts">
	// Filterspalte der Suchseite für ALLE Reiter: +page.svelte rendert genau eine
	// Instanz, die den Reiterwechsel überlebt – Suchbegriff, Thema, Zeitraum und «nur im
	// Titel» gelten in allen Reitern, halb getippte Eingaben bleiben im Feld stehen.
	// Im Reiter «Archivkatalog» (view="catalog") fallen die Abschnitte weg, die nur die
	// Dokumente kennen (Serie, Serien-Filter); an ihrer Stelle stehen die Katalog-Filter
	// (Snippet `catalogSection`), wie in den Dokumenten in den erweiterten Suchoptionen –
	// ausserhalb steht nur die lexikalische Suche. ODER-Begriffe sowie Personen, Orte und
	// Organisationen gelten in beiden Reitern, die Namensfelder schlagen die Namen des
	// jeweiligen Reiters vor.
	// Im Reiter «Ehedaten» (view="ehedaten") stehen statt der Namensfelder, des Zeitraums und
	// der Serien die Felder der Ehedaten (Snippet `ehedatenSection`: Name mit Rolle,
	// Herkunft = Orte, Jahr = Zeitraum …); kein Thema (keine Vektoren).
	// Im Reiter «Editionen» (view="editions") gilt alles ausser den Serien; dazu stehen die
	// Filter der Editionen (Snippet `editionsSection`: Edition, Teil, Schlagwort, Faksimile)
	// ausserhalb der erweiterten Suchoptionen.
	import type { Snippet } from "svelte";
	import { ALL_SERIES, SERIES_LABEL, DATE_BOUNDS, TOPK_OPTIONS, FACETS_BY_SERIES, FACET_DIMENSION_LABEL, STRING_FACET_DIMENSIONS, ENTITY_FACETS, ENTITY_FACET_LABEL, type FacetDimension, type SeriesAbbr } from "$lib/types";
	import { autoOpensAdvanced, dateRangeLabel, parseFieldInput, parseQueryTokens } from "$lib/searchParams";
	import { catalogAutoOpensAdvanced, type CatalogFilters } from "$lib/catalog";
	import type { EhedatenFilterValues } from "$lib/ehedaten";
	import { editionsAutoOpensAdvanced, NO_EDITIONS_FILTERS, type EditionsFilterValues } from "$lib/editionTexts";
	import { editionRegisterHref } from "$lib/editionRegister";
	import { allAutoOpensAdvanced, foreignFilters } from "$lib/overview";
	import type { SearchView } from "$lib/searchViews";
	import { autogrow } from "$lib/autogrow";
	import FilterChips, { type FilterChip } from "./FilterChips.svelte";
	import FacetCombobox from "./FacetCombobox.svelte";
	import FacetTextCombobox from "./FacetTextCombobox.svelte";
	import EntityFacetCombobox from "./EntityFacetCombobox.svelte";

	let {
		q = $bindable(""),
		anyTerms = $bindable([]),
		series = $bindable([]),
		dateFrom = $bindable(null),
		dateTo = $bindable(null),
		theme = $bindable(""),
		topK = $bindable(null),
		volumeNr = $bindable([]),
		startPg = $bindable([]),
		serialNr = $bindable([]),
		resolutionId = $bindable([]),
		years = $bindable([]),
		persons = $bindable([]),
		places = $bindable([]),
		organizations = $bindable([]),
		titleOnly = $bindable(false),
		seriesCounts = {},
		semanticAvailable = false,
		entityKeysAvailable = false,
		dateBounds = DATE_BOUNDS,
		contextSearch = "",
		onApply,
		onReset = undefined,
		topKApplies = false,
		view = "documents",
		catalogSection = undefined,
		catalogFilters = { level: [], bestand: [], digital: false },
		ehedatenFilters = { mann: [], frau: [], kirche: [], raum: [], quelle: [], art: null, band: [] },
		editionsFilters = NO_EDITIONS_FILTERS,
		onClearForeign = undefined,
		ehedatenSection = undefined,
		editionsSection = undefined,
	}: {
		q: string;
		anyTerms: string[];
		series: SeriesAbbr[];
		dateFrom: number | null;
		dateTo: number | null;
		theme: string;
		topK: number | null;
		volumeNr: number[];
		startPg: number[];
		serialNr: string[];
		resolutionId: string[];
		years: number[];
		persons: string[];
		places: string[];
		organizations: string[];
		titleOnly: boolean;
		seriesCounts: Record<string, number>;
		semanticAvailable: boolean;
		// Trägt der documents-Index die Vergleichsschlüssel? Dann schlagen die Namensfelder der
		// Dokumente je Schlüssel vor und wählen über ihn (EntityFacetCombobox `keyed`).
		entityKeysAvailable?: boolean;
		dateBounds?: { min: number; max: number };
		contextSearch: string;
		onApply: () => void;
		// «Filter zurücksetzen»: leert zusätzlich, was nicht hier gebunden ist (Katalog-Filter).
		onReset?: () => void;
		// Themen-Umfang (topK) nur zeigen, wenn er wirkt: Thema aktiv + Datums-
		// Sortierung (das Thema wählt die K ähnlichsten – mit Suchbegriff/ODER
		// innerhalb von deren Treffern –, sortiert werden diese K nach Datum).
		// Bei Relevanz rankt das Thema ohne Schnitt.
		topKApplies?: boolean;
		// Aktiver Reiter: Dokumente (alle Abschnitte), Archivkatalog oder Ehedaten.
		view?: SearchView;
		// Katalog-Filter (Stufe, Feldsuche, Digitalisat), nur im Reiter «Archivkatalog».
		catalogSection?: Snippet;
		// Ihre Werte: klappen im Reiter «Archivkatalog» die erweiterten Suchoptionen auf.
		catalogFilters?: Pick<CatalogFilters, "level" | "bestand" | "digital" | "fields">;
		// Werte der Ehedaten- und Editionsfilter: für die Zeile der fremden Filter (foreignFilters).
		ehedatenFilters?: EhedatenFilterValues;
		editionsFilters?: EditionsFilterValues;
		// «entfernen» in der Zeile der fremden Filter: leert die Filter des genannten Reiters.
		onClearForeign?: (view: Exclude<SearchView, "all">) => void;
		// Felder der Ehedaten (Name mit Rolle, Herkunft, Kirchgemeinde, Jahr …), nur im Reiter «Ehedaten».
		ehedatenSection?: Snippet;
		// Filter der Editionen (Edition, Teil, Schlagwort, Faksimile), nur im Reiter «Editionen».
		editionsSection?: Snippet;
	} = $props();

	const isAll = $derived(view === "all");
	const isCatalog = $derived(view === "catalog");
	const isEhedaten = $derived(view === "ehedaten");
	const isEditions = $derived(view === "editions");
	// Was in der URL steht, aber im aktuellen Reiter nicht wirkt (bleibt stehen und gilt im
	// Reiter, der es kennt, wieder) – als Zeile unter den Optionen, in jedem Reiter (#221).
	const foreignGroups = $derived(
		foreignFilters(
			view,
			{ q, anyTerms, theme, topK, sort: "relevance", series, persons, places, organizations, volumeNr, startPg, serialNr, resolutionId, years },
			catalogFilters,
			ehedatenFilters,
			editionsFilters,
			semanticAvailable,
		),
	);

	function toggleSeries(s: SeriesAbbr) {
		if (series.includes(s)) {
			series = series.filter((x) => x !== s);
		} else {
			series = [...series, s];
		}
		// Bei Wechsel der einzigen Serie: alte Detail-Facetten resetten – sie
		// gelten ja nur für die alte Serie und würden sonst Ghost-Filter bleiben.
		// Pragmatisch: bei JEDER Serien-Änderung Detail-Facetten leeren, außer der
		// neue Stand ist „eine Serie selektiert" und die Filter passen noch.
		if (series.length !== 1) {
			volumeNr = [];
			startPg = [];
			serialNr = [];
			resolutionId = [];
			years = [];
		} else {
			const allowed = new Set(FACETS_BY_SERIES[series[0]]);
			if (!allowed.has("volumeNr")) volumeNr = [];
			if (!allowed.has("startPg")) startPg = [];
			if (!allowed.has("serialNr")) serialNr = [];
			if (!allowed.has("resolutionId")) resolutionId = [];
			if (!allowed.has("dateYear")) years = [];
		}
		onApply();
	}

	let dateFromInput = $state(dateFrom?.toString() ?? "");
	let dateToInput = $state(dateTo?.toString() ?? "");
	// Adder-Feld: startet leer und spiegelt `q` nicht – die Chips darunter
	// zeigen die committeten Begriffe.
	let qInput = $state("");
	let themeInput = $state(theme);

	// Suchbegriff-Feld ist ein Term-Adder: jeder OK/Enter hängt den Feldtext als
	// Token an `q` an (Meili-Syntax). Die Hebel beziehen sich auf den Feldtext:
	// „exakt" → Phrase ("…"), „ausschliessen" → -wort. Nach dem Übernehmen
	// springen beide Checkboxen zurück. Das Feld spiegelt `q` NICHT (die
	// Chips darunter zeigen die Tokens).
	let qExact = $state(false);
	let qExclude = $state(false);
	// Anführungszeichen im Feld haken „exakt" automatisch an (bis OK).
	const exactEffective = $derived(qExact || qInput.includes('"'));

	// Advanced-Felder (nur ausgeklappt, „voller Advanced-Satz"): „Alle diese
	// Wörter" (Pflicht → q, strikt UND), „Irgendeines dieser Wörter" (ODER →
	// anyTerms), „Ohne diese Wörter" (Ausschluss → q, -…). Jedes mit eigenem
	// „exakt"-Kästchen.
	let allInput = $state("");
	let allExact = $state(false);
	let anyInput = $state("");
	let anyExact = $state(false);
	let noneInput = $state("");
	let noneExact = $state(false);

	$effect(() => {
		dateFromInput = dateFrom?.toString() ?? "";
		dateToInput = dateTo?.toString() ?? "";
	});
	$effect(() => {
		themeInput = theme;
	});

	// Fügt Begriffe der ODER-Menge hinzu (case-insensitiv dedupliziert), OHNE den
	// Suchbegriff `q` zu leeren – so koexistieren ODER-Alternativen und
	// Pflicht-/UND-Terme: (A ODER B) UND q.
	function addAnyTerms(terms: string[]) {
		let next = anyTerms;
		for (const t of terms) {
			const term = t.trim();
			if (!term) continue;
			if (!next.some((x) => x.toLowerCase() === term.toLowerCase())) next = [...next, term];
		}
		anyTerms = next;
	}

	// Übernimmt die Eingabe eines Wortfelds (Logik in parseFieldInput): Tokens
	// an die rohe Meili-Query `q` anhängen (Wort/Phrase/Ausschluss; mehrwortige
	// Nicht-Phrasen bleiben Einzel-Terme, strikt UND via matchingStrategy),
	// Alternativen zu anyTerms. Ein getipptes „A OR B" zerlegt parseFieldInput
	// in jedem Feld – als ODER-Alternativen bzw. beim Ausschluss als `-A -B`.
	// false = nichts Verwertbares (Feld bleibt stehen).
	function commitField(input: string, opts: { exact: boolean; exclude?: boolean; alternative?: boolean }): boolean {
		const entry = parseFieldInput(input, opts);
		if (!entry.q && entry.anyTerms.length === 0) return false;
		if (entry.q) q = q.trim() ? `${q.trim()} ${entry.q}` : entry.q;
		if (entry.anyTerms.length > 0) addAnyTerms(entry.anyTerms);
		return true;
	}

	// Einfaches Feld (eingeklappt): Begriff → q („exakt"/„ausschliessen"); ein
	// getipptes „A OR B" bleibt als ODER-Shortcut erhalten (→ anyTerms, mit
	// „ausschliessen" → -A -B).
	function commitSimple() {
		const txt = qInput.trim();
		if (!txt) return;
		if (txt.toLowerCase() === "schabernack")
			window.dispatchEvent(new CustomEvent("schabernack:trigger"));
		if (!commitField(txt, { exact: qExact, exclude: qExclude })) return;
		qInput = "";
		qExact = false;
		qExclude = false;
		onApply();
	}

	// Advanced „Alle diese Wörter" → Pflicht-Terme (q, strikt UND); „exakt" → Phrase.
	// Ein getipptes „A OR B" landet als ODER-Alternativen in anyTerms.
	function commitAll() {
		if (!commitField(allInput, { exact: allExact })) return;
		allInput = "";
		allExact = false;
		onApply();
	}

	// Advanced „Irgendeines dieser Wörter" → ODER-Alternativen (anyTerms); „exakt"
	// → Phrase-Alternative(n).
	function commitAny() {
		if (!commitField(anyInput, { exact: anyExact, alternative: true })) return;
		anyInput = "";
		anyExact = false;
		onApply();
	}

	// Advanced „Ohne diese Wörter" → Ausschlüsse (q, -wort / -"phrase").
	function commitNone() {
		if (!commitField(noneInput, { exact: noneExact, exclude: true })) return;
		noneInput = "";
		noneExact = false;
		onApply();
	}

	// Committete q-Tokens als Chips unter dem Suchbegriff-Feld – das Adder-Feld
	// leert sich nach jedem OK, hier ist die einzige Anzeige der Begriffe.
	// Entfernen schreibt q tokenweise neu und wendet die Suche an.
	const qChips = $derived.by(() => {
		const tokens = parseQueryTokens(q);
		return tokens.map((tok, i): FilterChip => {
			const rest = tokens
				.filter((_, j) => j !== i)
				.map((t) => t.raw)
				.join(" ");
			return {
				label: tok.exclude ? `− ${tok.text}` : tok.phrase ? `„${tok.text}"` : tok.text,
				kind: tok.exclude ? "exclude" : tok.phrase ? "phrase" : "term",
				remove: () => {
					q = rest;
					onApply();
				},
			};
		});
	});

	// Für den Advanced-Satz nach Art gruppiert: Pflicht/Phrase unter „Alle Wörter",
	// Ausschlüsse unter „Ohne Wörter". Filtert nur die Anzeige – die remove-Closures
	// schreiben `q` unverändert korrekt (Indizes beziehen sich auf die volle Liste).
	const qRequiredChips = $derived(qChips.filter((c) => c.kind !== "exclude"));
	const qExcludeChips = $derived(qChips.filter((c) => c.kind === "exclude"));

	// ODER-Begriffe als entfernbare Chips. Entfernen: bleibt >= 2 übrig → ODER
	// bleibt; bei genau 1 kollabiert es zum normalen Suchbegriff (q); bei 0 leer.
	const orChips = $derived.by(() =>
		anyTerms.map((term, i): FilterChip => ({
			label: term,
			kind: "term",
			remove: () => {
				const rest = anyTerms.filter((_, j) => j !== i);
				if (rest.length >= 2) {
					anyTerms = rest;
				} else if (rest.length === 1) {
					anyTerms = [];
					q = q.trim() ? `${q.trim()} ${rest[0]}` : rest[0];
				} else {
					anyTerms = [];
				}
				onApply();
			},
		})),
	);

	function commitTheme() {
		theme = themeInput.trim();
		onApply();
	}

	function clearTheme() {
		themeInput = "";
		theme = "";
		onApply();
	}

	function commitDates() {
		const f = dateFromInput ? Number.parseInt(dateFromInput, 10) : null;
		const t = dateToInput ? Number.parseInt(dateToInput, 10) : null;
		dateFrom = f && Number.isFinite(f) ? f : null;
		dateTo = t && Number.isFinite(t) ? t : null;
		onApply();
	}

	function clearDates() {
		dateFrom = null;
		dateTo = null;
		onApply();
	}

	const dateLabel = $derived(dateRangeLabel(dateFrom, dateTo));

	function reset() {
		q = "";
		anyTerms = [];
		qInput = "";
		qExact = false;
		qExclude = false;
		allInput = "";
		allExact = false;
		anyInput = "";
		anyExact = false;
		noneInput = "";
		noneExact = false;
		series = [];
		dateFrom = null;
		dateTo = null;
		theme = "";
		themeInput = "";
		topK = null;
		dateFromInput = "";
		dateToInput = "";
		volumeNr = [];
		startPg = [];
		serialNr = [];
		resolutionId = [];
		years = [];
		persons = [];
		places = [];
		organizations = [];
		titleOnly = false;
		onReset?.();
		onApply();
	}

	function applyEntity(field: "persons" | "places" | "organizations", next: string[]) {
		if (field === "persons") persons = next;
		else if (field === "places") places = next;
		else organizations = next;
		onApply();
	}

	function selectedEntity(dim: "persons" | "places" | "organizations"): string[] {
		if (dim === "persons") return persons;
		if (dim === "places") return places;
		return organizations;
	}

	function topKLabel(v: number): string {
		return String(v);
	}

	const activeFacets = $derived(series.length === 1 ? FACETS_BY_SERIES[series[0]] : []);
	const singleSeries = $derived(series.length === 1 ? series[0] : null);

	type NumericFacetDim = "volumeNr" | "startPg" | "dateYear";
	type StringFacetDim = "serialNr" | "resolutionId";

	function applyNumericMulti(dim: NumericFacetDim, next: number[]) {
		if (dim === "volumeNr") volumeNr = next;
		else if (dim === "startPg") startPg = next;
		else if (dim === "dateYear") years = next;
		onApply();
	}

	function applyStringMulti(dim: StringFacetDim, next: string[]) {
		if (dim === "serialNr") serialNr = next;
		else if (dim === "resolutionId") resolutionId = next;
		onApply();
	}

	function selectedNumeric(dim: NumericFacetDim): number[] {
		switch (dim) {
			case "volumeNr": return volumeNr;
			case "startPg": return startPg;
			case "dateYear": return years;
		}
	}

	function selectedString(dim: StringFacetDim): string[] {
		return dim === "serialNr" ? serialNr : resolutionId;
	}

	function paramFieldFor(dim: NumericFacetDim): "volumeNr" | "startPg" | "years" {
		return dim === "dateYear" ? "years" : dim;
	}

	function helpFor(dim: FacetDimension): string | null {
		if (dim === "serialNr") return "Nur Gesetzessammlung, erst ab 1981.";
		if (dim === "resolutionId") return "Format: JJJJ/NNNN, z. B. 1803/0003.";
		if (dim === "volumeNr" && singleSeries === "RM") return "Nummer des Bandes in StAZH B II, z. B. 441.";
		return null;
	}

	function isStringDim(dim: FacetDimension): dim is StringFacetDim {
		return STRING_FACET_DIMENSIONS.includes(dim);
	}

	// „Erweiterte Suchoptionen": alles unter dem Suchbegriff ist standardmässig
	// eingeklappt. Sind Filter aktiv, die nur dort zu sehen wären (beim Laden via
	// geteiltem Link oder nach einer Filter-Änderung), öffnet sich die Sektion
	// automatisch – nur öffnen, nie automatisch schliessen, damit solche Filter
	// nie unsichtbar sind (manuelles Zuklappen bleibt möglich). Der Zeitraum
	// zählt nicht (autoOpensAdvanced): Er kommt meist von der Zeitleiste und
	// steht eingeklappt als Pill unter dem Schalter. Im Katalog-Reiter
	// (catalogAutoOpensAdvanced) zählen zusätzlich die Katalog-Filter (Stufe, Bestand,
	// Digitalisat, Feldsuche), Serie und Serien-Filter dagegen nicht: Sie wirken dort
	// nicht (Hinweis documentsOnly).
	// Reiterwechsel: dieselbe Instanz, die Sektion bleibt, wie sie ist, und öffnet
	// sich, wenn im neuen Reiter etwas gesetzt ist, das nur darin stünde.
	function anyAdvancedActive(): boolean {
		// Ehedaten: Namen, Herkunft und Jahr stehen ausserhalb der Sektion (ehedatenSection).
		if (isEhedaten) return anyTerms.length > 0;
		if (isAll) return allAutoOpensAdvanced({ anyTerms, theme, topK, persons, places, organizations }, semanticAvailable);
		if (isEditions) return editionsAutoOpensAdvanced({ anyTerms, theme, topK, persons, places, organizations }, semanticAvailable);
		if (isCatalog) return catalogAutoOpensAdvanced({ anyTerms, theme, topK, persons, places, organizations }, catalogFilters, semanticAvailable);
		return autoOpensAdvanced({
			anyTerms,
			theme,
			series,
			persons,
			places,
			organizations,
			volumeNr,
			startPg,
			serialNr,
			resolutionId,
			years,
			topK,
		});
	}
	const advancedActive = $derived(anyAdvancedActive());
	let advancedOpen = $state(anyAdvancedActive());
	$effect(() => {
		if (advancedActive) advancedOpen = true;
	});
</script>

<aside class="space-y-6" aria-label="Filter">
	<h2 class="sr-only">Filter</h2>
	<!-- Prominenter Reset: ersetzt den alten Mini-Textlink (die Suche läuft
	     ohne «Suchen»-Knopf automatisch, hier ist der sichtbare Aktions-Knopf).
	     reset() leert nur die Filter und navigiert weich. Das harte «alles
	     zurück» liegt auf dem Recherche-Link in der Navigation. -->
	<button
		type="button"
		onclick={reset}
		class="w-full px-3 py-2 text-sm font-semibold rounded-md border border-zszh-300 bg-white text-zszh-700 hover:border-accent-500 hover:text-accent-600 transition-colors"
	>
		Filter zurücksetzen
	</button>

	{#if !advancedOpen}
	<section>
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Suchbegriff (lexikalisch)</h3>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				commitSimple();
			}}
			class="flex gap-1"
		>
			<!-- type=text: kein natives Clear-⊗; das Feld fügt Begriffe hinzu,
			     entfernt wird über die Chips darunter. -->
			<input
				type="text"
				bind:value={qInput}
				aria-label="Suchbegriff"
				class="w-full min-w-0 px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:ring-1 focus:ring-accent-500"
				autocomplete="off"
			/>
			<button
				type="submit"
				title="Begriff hinzufügen"
				class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-700 hover:border-accent-500 shrink-0"
			>
				OK
			</button>
		</form>
		<div class="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
			<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer" title="Exakte Wortfolge (Phrase) – auch via Anführungszeichen">
				<input type="checkbox" class="accent-accent-500" checked={exactEffective} onchange={(e) => (qExact = e.currentTarget.checked)} />
				exakt
			</label>
			<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer" title="Begriff ausschliessen (NICHT)">
				<input type="checkbox" class="accent-accent-500" bind:checked={qExclude} />
				ausschliessen
			</label>
			<!-- Nur-Titel: persistenter Such-Scope (springt NICHT zurück wie
			     „exakt"/„ausschliessen") – wirkt sofort auf die ganze Suche. -->
			<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer" title="Suche auf das Titelfeld beschränken – findet ein bestimmtes Dokument über seinen Titel. Bleibt aktiv, bis wieder abgewählt.">
				<input type="checkbox" class="accent-accent-500" checked={titleOnly} onchange={(e) => { titleOnly = e.currentTarget.checked; onApply(); }} />
				nur im Titel
			</label>
		</div>
		<FilterChips chips={qChips} class="flex mt-2" />
			{#if anyTerms.length > 0}
				<div class="mt-2">
					<p class="text-xs text-zszh-600 mb-1">ODER-Begriffe (Vereinigung der Treffer):</p>
					<FilterChips chips={orChips} class="flex" />
				</div>
			{/if}
		{#if isAll}
			<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
				In allen Quellen: Volltexte der Zentralen Serien, Titel und Beschreibungen des Archivkatalogs, Namen und Herkunft der
				Ehedaten, Texte der Editionen.
			</p>
		{:else if isCatalog}
			<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
				Im Archivkatalog: Titel, Signatur, Inhalt und Form (Regest) und Provenienz – einzelne Felder über die Feldsuche in den
				erweiterten Suchoptionen.
			</p>
		{:else if isEhedaten}
			<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
				In den Ehedaten: Namen, Herkunft, Zusatzinfo (Originalschreibung, Beruf), Kirchgemeinde und Signatur; «nur im Titel» = Namen
				und Herkunft.
			</p>
		{:else if isEditions}
			<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
				In den Editionen: Titel, Regest, Schlagwörter, Quellentext, Kommentar und Anmerkungen. Der Quellentext ist frühneuhochdeutsch
				(«daß» findet auch «dass», «zů» auch «zu»).
			</p>
		{/if}
	</section>
	{/if}

	<!-- Erweiterte Suchoptionen: alles unter dem Suchbegriff ist standardmässig
	     eingeklappt (öffnet automatisch bei aktiven Filtern, s. advancedOpen), im
	     Katalog-Reiter auch dessen Filter. -->
	<div>
		<button
			type="button"
			onclick={() => (advancedOpen = !advancedOpen)}
			aria-expanded={advancedOpen}
			aria-controls="advanced-search-options"
			class="group flex w-full items-center gap-x-2 text-left"
		>
			<span aria-hidden="true" class="text-zszh-400 transition-transform {advancedOpen ? 'rotate-90' : ''}">▶</span>
			<span class="text-xs uppercase tracking-wider text-zszh-700 font-bold group-hover:text-accent-600">Erweiterte Suchoptionen</span>
			{#if !advancedOpen && advancedActive}
				<span class="text-[0.7rem] font-semibold normal-case tracking-normal text-accent-600">• aktiv</span>
			{/if}
		</button>
		<!-- Der Zeitraum klappt die Sektion nicht auf (meist von der Zeitleiste
		     gesetzt) – eingeklappt bleibt er hier sichtbar und mit einem Klick
		     aufhebbar. -->
		{#if !advancedOpen && dateLabel && !isEhedaten}
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 pl-5">
				<span class="text-xs text-zszh-600">Zeitraum</span>
				<button
					type="button"
					onclick={clearDates}
					aria-label={`Zeitraum ${dateLabel} entfernen`}
					class="flex items-center gap-1 px-2 py-0.5 bg-accent-500 text-white text-xs rounded hover:bg-accent-600 tabular-nums"
				>
					{dateLabel}
					<span aria-hidden="true">×</span>
				</button>
			</div>
		{/if}
	</div>

	{#if advancedOpen}
	<div id="advanced-search-options" class="space-y-6">
	<section>
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Suchbegriff (lexikalisch)</h3>

		<!-- Nur-Titel: persistenter Scope-Toggle über ALLE drei Wortfelder unten
		     (anders als die per-Feld-Häkchen „exakt", die nach OK zurückspringen). -->
		<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer mb-3" title="Suche auf das Titelfeld beschränken – findet ein bestimmtes Dokument über seinen Titel. Gilt für alle Wortfelder unten und bleibt aktiv, bis wieder abgewählt.">
			<input type="checkbox" class="accent-accent-500" checked={titleOnly} onchange={(e) => { titleOnly = e.currentTarget.checked; onApply(); }} />
			nur im Titel suchen
		</label>

		<!-- Alle diese Wörter → Pflicht-Terme (q, strikt UND) -->
		<label for="adv-all" class="block text-xs font-medium text-zszh-600 mb-1">Alle diese Wörter <span class="text-zszh-400">(müssen vorkommen)</span></label>
		<form onsubmit={(e) => { e.preventDefault(); commitAll(); }} class="flex gap-1">
			<input id="adv-all" type="text" bind:value={allInput} class="w-full min-w-0 px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:ring-1 focus:ring-accent-500" autocomplete="off" />
			<button type="submit" title="Begriff hinzufügen" class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-700 hover:border-accent-500 shrink-0">OK</button>
		</form>
		<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer mt-1" title="Exakte Wortfolge (Phrase) – auch via Anführungszeichen">
			<input type="checkbox" class="accent-accent-500" checked={allExact || allInput.includes('"')} onchange={(e) => (allExact = e.currentTarget.checked)} />
			exakt
		</label>
		{#if qRequiredChips.length > 0}<FilterChips chips={qRequiredChips} class="flex mt-2" />{/if}

		<!-- Irgendeines dieser Wörter → ODER-Vereinigung (anyTerms), in beiden Reitern -->
		<label for="adv-any" class="block text-xs font-medium text-zszh-600 mb-1 mt-4">Irgendeines dieser Wörter <span class="text-zszh-400">(ODER)</span></label>
		<form onsubmit={(e) => { e.preventDefault(); commitAny(); }} class="flex gap-1">
			<input id="adv-any" type="text" bind:value={anyInput} class="w-full min-w-0 px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:ring-1 focus:ring-accent-500" autocomplete="off" />
			<button type="submit" title="Alternative hinzufügen" class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-700 hover:border-accent-500 shrink-0">OK</button>
		</form>
		<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer mt-1" title="Exakte Wortfolge (Phrase)">
			<input type="checkbox" class="accent-accent-500" checked={anyExact || anyInput.includes('"')} onchange={(e) => (anyExact = e.currentTarget.checked)} />
			exakt
		</label>
		{#if orChips.length > 0}<FilterChips chips={orChips} class="flex mt-2" />{/if}

		<!-- Ohne diese Wörter → Ausschlüsse (q, -…) -->
		<label for="adv-none" class="block text-xs font-medium text-zszh-600 mb-1 mt-4">Ohne diese Wörter <span class="text-zszh-400">(dürfen nicht vorkommen)</span></label>
		<form onsubmit={(e) => { e.preventDefault(); commitNone(); }} class="flex gap-1">
			<input id="adv-none" type="text" bind:value={noneInput} class="w-full min-w-0 px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:ring-1 focus:ring-accent-500" autocomplete="off" />
			<button type="submit" title="Ausschluss hinzufügen" class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-700 hover:border-accent-500 shrink-0">OK</button>
		</form>
		<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer mt-1" title="Exakte Wortfolge (Phrase)">
			<input type="checkbox" class="accent-accent-500" checked={noneExact || noneInput.includes('"')} onchange={(e) => (noneExact = e.currentTarget.checked)} />
			exakt
		</label>
		{#if qExcludeChips.length > 0}<FilterChips chips={qExcludeChips} class="flex mt-2" />{/if}
		{#if isAll}
			<p class="text-xs text-zszh-600 mt-3 leading-snug">In allen Quellen: Volltexte, Katalogtitel und -beschreibungen, Namen der Ehedaten, Editionstexte.</p>
		{:else if isCatalog}
			<p class="text-xs text-zszh-600 mt-3 leading-snug">Im Archivkatalog: Titel, Signatur, Inhalt und Form (Regest) und Provenienz – einzelne Felder über die Feldsuche unten.</p>
		{:else if isEhedaten}
			<p class="text-xs text-zszh-600 mt-3 leading-snug">In den Ehedaten: Namen, Herkunft, Zusatzinfo, Kirchgemeinde und Signatur.</p>
		{:else if isEditions}
			<p class="text-xs text-zszh-600 mt-3 leading-snug">In den Editionen: Titel, Regest, Schlagwörter, Quellentext, Kommentar und Anmerkungen.</p>
		{/if}
	</section>

	{#if semanticAvailable}
		<section>
			<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Thema (semantisch)</h3>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					commitTheme();
				}}
				class="flex gap-1 items-end"
			>
				<!-- textarea statt input: Themen sind oft ganze Sätze – das Feld
				     wächst zeilenweise mit (autogrow), Enter committet,
				     Shift+Enter bricht um. -->
				<textarea
					rows="1"
					bind:value={themeInput}
					use:autogrow={{ value: themeInput, maxRows: 4 }}
					enterkeyhint="search"
					placeholder="z. B. Tierhaltung in Städten"
					aria-label="Thema"
					class="w-full min-w-0 px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded resize-none overflow-y-auto focus:outline-none focus:ring-1 focus:ring-accent-500"
					autocomplete="off"
				></textarea>
				{#if theme}
					<button
						type="button"
						onclick={clearTheme}
						title="Thema-Filter entfernen"
						aria-label="Thema-Filter entfernen"
						class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-600 hover:border-accent-500 shrink-0"
					>
						×
					</button>
				{/if}
				<button
					type="submit"
					class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-700 hover:border-accent-500 shrink-0"
				>
					OK
				</button>
			</form>
			<p class="text-xs text-zszh-600 mt-2 leading-snug">
				Sortiert nach thematischer Ähnlichkeit, findet auch Synonyme und Verwandtes. Mit einem Suchbegriff reiht es dessen Treffer.
			</p>
			{#if isCatalog}
				<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
					Personendossiers, Ehedaten und Firmen reiht das Thema nicht; sie stehen am Ende der Liste.
				</p>
			{:else if isEditions}
				<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
					In den Editionen reiht das Thema nach Titel, Schlagwörtern, Regest und Kommentar, nicht nach dem Quellentext.
				</p>
			{:else if series.includes("RM")}
				<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
					Die Ratsmanuale haben keine Vektoren: Dort wirkt das Thema nur als
					Stichwortsuche.
				</p>
			{/if}
		</section>

		{#if topKApplies}
			<section>
				<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Themen-Umfang</h3>
				<div class="flex flex-wrap gap-1">
					{#each TOPK_OPTIONS as opt (opt)}
						{@const active = topK === opt}
						<button
							type="button"
							onclick={() => {
								topK = opt;
								onApply();
							}}
							class="px-2.5 py-1 text-xs font-medium rounded border tabular-nums transition-colors"
							class:bg-accent-500={active}
							class:text-white={active}
							class:border-accent-500={active}
							class:bg-white={!active}
							class:text-zszh-700={!active}
							class:border-zszh-300={!active}
							class:hover:border-accent-500={!active}
							aria-pressed={active}
						>
							{topKLabel(opt)}
						</button>
					{/each}
				</div>
				<p class="text-xs text-zszh-600 mt-2 leading-snug">
					Die <em>K</em> thematisch nächsten {isCatalog ? "Verzeichnungseinheiten" : isEditions ? "Stücke" : "Dokumente"} – mit
					Suchbegriff innerhalb von dessen Treffern – werden anschliessend nach Datum sortiert.
				</p>
			</section>
		{/if}
	{/if}

	{#if !isEhedaten}
	<section>
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Zeitraum</h3>
		<div class="flex items-center gap-2">
			<input
				type="number"
				min={dateBounds.min}
				max={dateBounds.max}
				placeholder="von"
				aria-label="Jahr von"
				class="w-20 px-2 py-1 text-sm bg-white border border-zszh-300 rounded"
				bind:value={dateFromInput}
				onblur={commitDates}
				onkeydown={(e) => e.key === "Enter" && commitDates()}
			/>
			<span class="text-zszh-400">–</span>
			<input
				type="number"
				min={dateBounds.min}
				max={dateBounds.max}
				placeholder="bis"
				aria-label="Jahr bis"
				class="w-20 px-2 py-1 text-sm bg-white border border-zszh-300 rounded"
				bind:value={dateToInput}
				onblur={commitDates}
				onkeydown={(e) => e.key === "Enter" && commitDates()}
			/>
			{#if dateLabel}
				<button
					type="button"
					onclick={clearDates}
					title="Zeitraum entfernen"
					aria-label="Zeitraum entfernen"
					class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-600 hover:border-accent-500 shrink-0"
				>
					×
				</button>
			{/if}
		</div>
	</section>
	{/if}

	{#if !isCatalog && !isEhedaten && !isEditions && !isAll}
	<section>
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Serie</h3>
		<ul class="space-y-1.5">
			{#each ALL_SERIES as s (s)}
				{@const count = seriesCounts[s] ?? 0}
				{@const checked = series.includes(s)}
				<li>
					<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
						<input
							type="checkbox"
							class="accent-accent-500"
							{checked}
							onchange={() => toggleSeries(s)}
						/>
						<span class="flex-1">{SERIES_LABEL[s]}</span>
						<span class="text-xs text-zszh-600 tabular-nums">{count.toLocaleString("de-CH")}</span>
					</label>
				</li>
			{/each}
		</ul>
	</section>

	{/if}

	<!-- Personen, Orte, Organisationen gelten in allen Reitern ausser den Ehedaten (geteilte
	     Parameter); die Vorschläge kommen aus dem jeweiligen Reiter, neu beim Wechsel ({#key}). -->
	{#if !isEhedaten}
	{#key view}
	<div class="space-y-5">
		{#each ENTITY_FACETS as dim (dim)}
			<EntityFacetCombobox
				dimension={dim}
				label={ENTITY_FACET_LABEL[dim]}
				selected={selectedEntity(dim)}
				{contextSearch}
				onChange={(next) => applyEntity(dim, next)}
				source={isCatalog ? "catalog" : isEditions ? "editions" : "documents"}
				keyed={entityKeysAvailable}
			/>
		{/each}
		{#if isCatalog}
			<p class="text-xs text-zszh-600 leading-snug">
				Namen der Verzeichnungseinheiten, über die Schreibung hinweg (Meier und Meyer). Sie gelten auch in den
				Dokumenten, dort {entityKeysAvailable ? "samt gleichwertigen Schreibungen (ein Nachname allein genau so)" : "in genau dieser Schreibung"}.
				<a href="/archivkatalog/register" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Register</a>
			</p>
		{:else if isEditions}
			<p class="text-xs text-zszh-600 leading-snug">
				Namen aus den Registern der Editionen.
				<a href={editionRegisterHref("personen")} class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Register</a>
			</p>
		{:else}
			<p class="text-xs text-zszh-600 leading-snug">
				Personen, Orte und Organisationen nach Quellen:
				<a href="/register" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Register</a>
			</p>
		{/if}
	</div>
	{/key}
	{/if}

	{#if !isCatalog && !isEhedaten && !isEditions && !isAll && singleSeries && activeFacets.length > 0}
		<div class="space-y-5 pl-3 border-l-2 border-accent-200">
			{#each activeFacets as dim (dim)}
				{#if isStringDim(dim)}
					<FacetTextCombobox
						dimension={dim}
						label={FACET_DIMENSION_LABEL[dim]}
						selected={selectedString(dim)}
						{contextSearch}
						onChange={(next) => applyStringMulti(dim, next)}
						help={helpFor(dim)}
					/>
				{:else}
					<FacetCombobox
						dimension={paramFieldFor(dim)}
						label={FACET_DIMENSION_LABEL[dim]}
						selected={selectedNumeric(dim)}
						{contextSearch}
						onChange={(next) => applyNumericMulti(dim, next)}
						help={helpFor(dim)}
					/>
				{/if}
			{/each}
		</div>
	{/if}
	{#if isCatalog}
		{@render catalogSection?.()}
	{/if}
	</div>
	{/if}

	<!-- Ausserhalb der Sektion, also auch eingeklappt sichtbar: im Reiter «Ehedaten» bzw.
	     «Editionen» dessen Felder, dann in jedem Reiter die Zeile der fremden Filter – was in
	     der URL steht, hier nicht wirkt, aber die Zahl des genannten Reiters einschränkt (#221).
	     «entfernen» leert die Filter dieses Reiters; Thema und Namen bleiben. -->
	{#if isEhedaten}
		{@render ehedatenSection?.()}
	{:else if isEditions}
		{@render editionsSection?.()}
	{/if}
	{#if foreignGroups.length > 0}
		<div class="text-xs text-zszh-600 leading-snug border-l-2 border-zszh-200 pl-3 space-y-1">
			<p>Gesetzt, wirkt hier nicht:</p>
			{#each foreignGroups as g (g.view)}
				<p>
					<span class="text-zszh-700">{g.items.join(", ")}</span>
					<span class="text-zszh-500">– gilt im Reiter «{g.label}»</span>
					{#if onClearForeign}
						<button
							type="button"
							onclick={() => onClearForeign?.(g.view)}
							title={`Diese Filter des Reiters «${g.label}» entfernen (Thema und Namen bleiben)`}
							class="ml-1 underline decoration-dotted underline-offset-2 hover:text-accent-600"
						>
							entfernen
						</button>
					{/if}
				</p>
			{/each}
		</div>
	{/if}
</aside>
