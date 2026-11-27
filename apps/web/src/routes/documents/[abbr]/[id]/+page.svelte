<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	import { tick } from "svelte";
	import { page } from "$app/state";
	import { SERIES_LABEL, isLexicalOnlySeries } from "$lib/types";
	import { formatDateDE, formatDocDateDE, isOldStyleDate, normalizeWhitespace, rmCitation } from "$lib/format";
	import { entitySurface } from "$lib/krdbMentions";
	import { rmReadingForm } from "$lib/rmText";
	import CopyButton from "$lib/components/CopyButton.svelte";
	import Facsimile from "$lib/components/Facsimile.svelte";
	import Similar from "./Similar.svelte";
	import DownloadPackage from "./DownloadPackage.svelte";
	import KrdbPersons from "./KrdbPersons.svelte";
	import RatCouncil from "./RatCouncil.svelte";
	import KrdbMentions from "./KrdbMentions.svelte";
	import RatMentions from "./RatMentions.svelte";
	import CatalogEntry from "./CatalogEntry.svelte";
	import EditionLinks from "$lib/components/EditionLinks.svelte";
	import { catalogUnitHref } from "$lib/catalog";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();


	// Sektion „Verwandte Dokumente" startet eingeklappt – spart Platz, v. a. auf
	// dem Handy.
	let relatedOpen = $state(false);

	// Nur origin+pathname: Such-Kontext (?from=&pos=) gehört nicht in einen Permalink,
	// der dauerhaft aufs Dokument zeigen soll.
	const permalink = () => `${window.location.origin}${window.location.pathname}`;

	// Bei ABl ist title vor dem Re-Index möglicherweise noch generisch
	// ("Amtsblatt des Kantons Zürich"). Dann auf stazhIdent zurückfallen.
	const seriesLabel = $derived(SERIES_LABEL[data.doc.series]);
	const titleIsGeneric = $derived(
		data.doc.title === seriesLabel ||
			data.doc.title === "Amtsblatt des Kantons Zürich" ||
			data.doc.title === "(ohne Titel)",
	);
	const stazhIdent = $derived(normalizeWhitespace(data.doc.stazhIdent));
	const displayTitle = $derived(
		titleIsGeneric && stazhIdent ? stazhIdent : normalizeWhitespace(data.doc.title),
	);
	const subTitle = $derived(titleIsGeneric ? "" : stazhIdent);
	// Ratsmanuale: Daten bis 1700 im alten Stil, mit «(a. St.)».
	const dateDE = $derived(formatDocDateDE(data.doc));
	const oldStyle = $derived(isOldStyleDate(data.doc.series, data.doc.date));

	// Ratsmanuale (RM): maschinelle Transkription, Zitiervorschlag, kein Reiter
	// «Ähnliche» (die Serie hat keine Vektoren).
	const isRm = $derived(data.doc.series === "RM");
	const hasSimilar = $derived(!isLexicalOnlySeries(data.doc.series));
	const citation = $derived(isRm ? rmCitation(data.doc, data.permalink) : "");
	// Alle Sitzungen des Bandes in Reihenfolge (Datum, dann laufende Nummer).
	const volumeHref = $derived(
		isRm && data.doc.volumeNr != null
			? `/search?${new URLSearchParams({ series: "RM", volumeNr: String(data.doc.volumeNr), sort: "date_asc", view: "documents" })}`
			: null,
	);

	// Verzeichnungseinheit im Index (Archivkatalog): Link auf ihre Seite statt in den
	// Online-Katalog; bei den Ratsmanualen die Sitzung statt des Bandes.
	const catalogUnit = $derived(data.catalog?.unit ?? null);
	const catalogLabel = $derived(isRm ? "Sitzung im Archivkatalog" : "Im Archivkatalog");

	// Born-digital Spätbestände (kein Faksimile, Text aus Original-PDF): Label der
	// Quelle je Teilbestand. null = kuratierter Altbestand → "Im Staatsarchiv-Katalog".
	const lateSourceLabel = $derived(
		data.doc.subset === "krp-late"
			? "Kantonsrat Zürich"
			: data.doc.subset === "rrb-late"
				? "Regierungsrat Zürich"
				: data.doc.subset === "os-late"
					? "Staatskanzlei Zürich"
					: null,
	);

	// Such-Kontext-Navigation: nur sichtbar wenn der Viewer aus einer
	// Trefferliste heraus geöffnet wurde (from + pos in der URL).
	const fromSearch = $derived(data.fromSearch);
	const neighbors = $derived(data.neighbors);
	const backHref = $derived(
		fromSearch ? `/search?${fromSearch}#hit-${data.doc.id}` : null,
	);
	function neighborHref(n: { id: string; series: string; pos: number }): string {
		const qs = new URLSearchParams({ from: fromSearch ?? "", pos: String(n.pos) });
		return `/documents/${n.series}/${n.id}?${qs.toString()}`;
	}

	// Ob das Layout Faksimile-nebenan zeigen soll. Auf dem Client tracken wir
	// das per matchMedia, damit wir auf Mobile die Facsimile-Komponente in der
	// Sidebar gar nicht erst initialisieren (Mirador würde sonst unnötig
	// Bandbreite ziehen – auf Mobile lebt Faksimile im Tab-Panel).
	let sideBySide = $state(false);
	$effect(() => {
		if (typeof window === "undefined") return;
		const mq = window.matchMedia("(min-width: 1024px)");
		const update = () => (sideBySide = mq.matches);
		update();
		mq.addEventListener("change", update);
		return () => mq.removeEventListener("change", update);
	});

	// Tab-State für die Doc-Ansichten (Text / Faksimile / Personen / Ähnliche / Archivkatalog).
	// Mobile: alle sind Tabs. Desktop: Faksimile sitzt rechts in der
	// sticky-Aside, der Faksimile-Tab wird via `lg:hidden` ausgeblendet.
	// «Personen» nur bei KRP-Dokumenten mit Treffern in der Kantonsratsdatenbank,
	// «Archivkatalog» nur mit Einheit oder Verweisen im Katalog-Index.
	// «Rat» nur bei Ratsmanual-Sitzungen, deren Band einen Halbjahresrat nennt.
	type TabKey = "text" | "facsimile" | "persons" | "rat" | "similar" | "catalog";
	let activeTab = $state<TabKey>("text");
	// Lazy-Mount: Faksimile (Mirador), Personen (Porträts) und Similar
	// (API-Fetch) erst mounten, wenn der Tab tatsächlich besucht wurde. Beim
	// Zurück-Wechseln bleiben die Panels via `hidden` im DOM, sodass Similar
	// nicht neu fetcht und Mirador nicht neu initialisiert.
	let facsimileVisited = $state(false);
	let personsVisited = $state(false);
	let similarVisited = $state(false);

	// Personenkarte beim Namen im Text (KrdbMentions bzw. bei den Ratsmanualen RatMentions):
	// markiert zugeordnete Namen im Text-Panel; `mentioned` steuert die «im Text»-Links im
	// Reiter «Personen» bzw. «Rat».
	let tabBar = $state<HTMLDivElement | null>(null);
	let textPanel = $state<HTMLDivElement | null>(null);
	let mentions = $state<{ reveal: (id: number) => void }>();
	let mentioned = $state.raw<Set<number>>(new Set());

	async function showTab(tab: "persons" | "rat") {
		activeTab = tab;
		if (tab === "persons") personsVisited = true;
		await tick();
		// Aus einer Karte tief im Text: Tab-Leiste zurück ins Bild holen (unter den klebenden Kopf).
		const headerHeight = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
		if (tabBar && tabBar.getBoundingClientRect().top < headerHeight) tabBar.scrollIntoView({ block: "start" });
	}
	const showPersons = () => showTab("persons");
	const showRat = () => showTab("rat");

	async function revealInText(id: number) {
		activeTab = "text";
		await tick();
		mentions?.reveal(id);
	}

	// Aus einer Personenseite (/personen/<ID>) geöffnet (?person=<ID>): zur ersten
	// Nennung springen – oder, wo der Text keine Namen markiert (Protokolle ohne
	// Namenserkennung, ab 1995), den Tab «Personen» mit dieser Person öffnen.
	const focusId = $derived.by(() => {
		const raw = page.url.searchParams.get("person");
		const id = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
		return id != null && data.krdbPersons.some((p) => p.id === id) ? id : null;
	});
	let focusDone = $state<string | null>(null);

	async function onNamesMarked(ids: Set<number>) {
		mentioned = ids;
		if (focusId == null || focusDone === data.doc.id) return;
		focusDone = data.doc.id; // je Dokument einmal
		if (ids.has(focusId)) await revealInText(focusId);
		else await showPersons();
	}

	// Click auf eine Seitenzahl [N] im TEI-Body → Mirador springt auf die
	// passende Canvas. Primär matchen wir über Label (lokale ABl-Manifeste
	// tragen pb @n als Canvas-Label, die Canvas-Reihenfolge kann dort von der
	// pb-Reihenfolge im <body> abweichen). Externe Manifeste (OS/KRP/RRB)
	// labeln ihre Canvases aber "Page 1", "Page 2", … – dort greift in
	// Facsimile der Ordinal-Fallback: Position des pb im Text = Canvas-Index.
	// seq zählt Klicks, damit ein erneuter Klick auf dieselbe Seite den
	// $effect in Facsimile wieder feuert (neue Objekt-Identität).
	type PageTarget = { label: string; ordinal: number; seq: number };
	let targetPage = $state<PageTarget | null>(null);
	let pageClickSeq = 0;

	// Doc-Wechsel: Tabs auf Text zurücksetzen und Visited-Flags löschen, damit
	// Mirador + Similar beim nächsten Tab-Klick frisch für das neue Doc laden.
	$effect(() => {
		// Trigger nur auf id-Wechsel.
		void data.doc.id;
		activeTab = "text";
		facsimileVisited = false;
		personsVisited = false;
		similarVisited = false;
		mentioned = new Set();
		targetPage = null;
	});

	const ENTITY_CLASS_TO_FACET: Record<string, "persons" | "places" | "organizations"> = {
		"tei-person": "persons",
		"tei-place": "places",
		"tei-org": "organizations",
	};

	// Click auf eine annotierte Entity → Suche im neuen Tab mit gesetztem
	// Filter. Surface-Form wird dieselbe Normalisierung wie im Indexer
	// (Whitespace-Collapse, trailing Satzzeichen weg) angewendet, damit der
	// Filter den indexierten Wert trifft (und über den Vergleichsschlüssel auch
	// andere Schreibungen desselben Namens).
	//
	// Click auf eine Seitenzahl [N] (.tei-pb) → Mirador springt auf die
	// entsprechende Canvas. Auf Mobile wechselt zusätzlich der aktive Tab,
	// damit der User nicht ins Leere klickt.
	function onTeiClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (!target) return;

		const pb = target.closest(".tei-pb") as HTMLElement | null;
		if (pb) {
			e.preventDefault();
			// Ordinal = Position dieses pb unter allen pbs im Text – Grundlage
			// für den Canvas-Fallback bei Manifesten ohne passende Labels.
			const panel = pb.closest(".tei-document-body");
			const ordinal = panel ? Array.from(panel.querySelectorAll(".tei-pb")).indexOf(pb) : -1;
			if (!sideBySide) {
				// Mobile/Tablet: Faksimile-Tab aktivieren, Mount triggern.
				activeTab = "facsimile";
				facsimileVisited = true;
			}
			targetPage = { label: pb.getAttribute("data-n") ?? "", ordinal, seq: ++pageClickSeq };
			return;
		}

		// Zugeordnete Personen (Kantonsratsdatenbank; Ratsmanuale mit Normdaten aus Transkribus) öffnen
		// stattdessen ihre Karte (PersonMentions); die Suche ist dort ein Link.
		if (target.closest("[data-mention]")) return;

		const entitySpan = target.closest(".tei-person, .tei-place, .tei-org") as HTMLElement | null;
		if (!entitySpan) return;
		const cls = ["tei-person", "tei-place", "tei-org"].find((c) =>
			entitySpan.classList.contains(c),
		);
		if (!cls) return;
		const href = entitySearchHref(ENTITY_CLASS_TO_FACET[cls], entitySpan.textContent ?? "");
		if (!href) return;
		e.preventDefault();
		window.open(href, "_blank", "noopener");
	}

	/** Suche nach einem Namen im Text; null ohne brauchbaren Text. */
	function entitySearchHref(facetField: "persons" | "places" | "organizations", raw: string): string | null {
		const text = entitySurface(raw);
		if (!text) return null;
		const params = new URLSearchParams();
		if (isRm) {
			// Ratsmanuale: die Facetten tragen vereinheitlichte Namen, nicht diese Schreibung –
			// darum Phrasensuche innerhalb RM, in der Lesefassung des Index.
			const phrase = rmReadingForm(text).replace(/"/g, "");
			if (!phrase) return null;
			params.set("q", `"${phrase}"`);
			params.set("series", "RM");
		} else {
			params.append(facetField, text);
		}
		params.set("view", "documents");
		return `/search?${params.toString()}`;
	}
</script>

<svelte:head>
	<title>{displayTitle} | {SITE_NAME}</title>
	<meta name="description" content={displayTitle} />
</svelte:head>

<div class="max-w-screen-2xl mx-auto px-4 py-6">
	{#if fromSearch && backHref}
		<!-- Result-list navigation: nur wenn aus Suche geöffnet -->
		<nav aria-label="Trefferliste" class="mb-3 flex flex-wrap items-center justify-between gap-2 no-print">
			<a
				href={backHref}
				class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zszh-300 hover:border-accent-500 text-zszh-800 text-sm font-medium rounded-md"
			>
				<span aria-hidden="true">←</span>
				Zurück zur Trefferliste
			</a>
			{#if neighbors}
				<div class="inline-flex items-center gap-1 text-sm">
					{#if neighbors.prev}
						<a
							href={neighborHref(neighbors.prev)}
							class="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-zszh-300 hover:border-accent-500 text-zszh-800 font-medium rounded-md"
							rel="prev"
						>
							<span aria-hidden="true">←</span>
							Voriges
						</a>
					{:else}
						<span class="inline-flex items-center gap-1 px-3 py-1.5 bg-zszh-50 border border-zszh-200 text-zszh-400 font-medium rounded-md cursor-not-allowed">
							<span aria-hidden="true">←</span>
							Voriges
						</span>
					{/if}
					<span class="px-2 text-xs text-zszh-600 tabular-nums">
						Treffer {neighbors.pos + 1} von {neighbors.total.toLocaleString("de-CH")}
					</span>
					{#if neighbors.next}
						<a
							href={neighborHref(neighbors.next)}
							class="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-zszh-300 hover:border-accent-500 text-zszh-800 font-medium rounded-md"
							rel="next"
						>
							Nächstes
							<span aria-hidden="true">→</span>
						</a>
					{:else}
						<span class="inline-flex items-center gap-1 px-3 py-1.5 bg-zszh-50 border border-zszh-200 text-zszh-400 font-medium rounded-md cursor-not-allowed">
							Nächstes
							<span aria-hidden="true">→</span>
						</span>
					{/if}
				</div>
			{/if}
		</nav>
	{:else}
		<!-- Breadcrumb fallback: bei Direktaufruf / Permalink -->
		<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
			<a href="/" class="hover:underline">Start</a>
			<span class="text-zszh-400" aria-hidden="true">›</span>
			<a href={`/search?series=${data.doc.series}&view=documents`} class="hover:underline">{seriesLabel}</a>
		</nav>
	{/if}

	<!-- Document Header Card -->
	<header
		class="bg-white border border-zszh-200 rounded-md shadow-sm px-5 py-4 mb-4 doc-meta-header"
	>
		<!-- Top row: Series badge + date -->
		<div class="flex flex-wrap items-center gap-3 mb-2.5">
			<span
				class="inline-block px-2 py-0.5 text-xs font-bold uppercase tracking-wider rounded bg-zszh-900 text-zszh-50"
			>
				{seriesLabel}
			</span>
			{#if dateDE}
				<time
					datetime={data.doc.date}
					class="text-zszh-700 font-medium text-sm"
					title={oldStyle
						? "Alter Stil: Zürich datierte bis 31.12.1700 nach dem julianischen Kalender. Das Datum steht wie in der Quelle, nicht umgerechnet."
						: undefined}
				>
					{dateDE}
				</time>
			{/if}
			{#if data.rmBand?.label}
				<!-- Ratsmanuale: Halbjahresrat des Bandes (Natalrat/Baptistalrat). Kommt aus dem
				     Band, nicht aus dem Datum – im Januar weichen beide auseinander. -->
				<span class="text-xs text-zszh-600" title={data.rmBand.hint}>{data.rmBand.label}</span>
			{/if}
			{#if data.doc.volumeNr}
				<span class="text-xs text-zszh-600">{isRm ? `B II ${data.doc.volumeNr}` : `Bd. ${data.doc.volumeNr}`}</span>
			{/if}
			{#if data.doc.resolutionId}
				<span class="text-xs text-zszh-600">Nr. {data.doc.resolutionId}</span>
			{/if}
		</div>

		<!-- Title -->
		<h1 class="font-serif text-xl md:text-2xl text-zszh-900 leading-tight mb-1.5">
			{displayTitle}
		</h1>

		<!-- Sub-line: stazhIdent (wenn Titel spezifisch). Die technische
		     Doc-ID steht in der URL – wir blenden sie hier aus. -->
		{#if subTitle}
			<div class="text-xs text-zszh-600 mb-3" title={data.doc.id}>
				{subTitle}
			</div>
		{:else}
			<div class="mb-3"></div>
		{/if}

		{#if isRm}
			<!-- Ratsmanuale: Textqualität, edierte Einträge der Sitzung (besser lesbar als die
			     HTR) und Zitiervorschlag (Plan E8). -->
			<div class="mb-3 space-y-1.5 text-xs text-zszh-700">
				<p class="bg-zszh-50 border border-zszh-200 rounded px-2.5 py-1.5">
					Maschinelle Transkription (HTR) – Lesefehler möglich. Personen, Orte und
					Organisationen sind automatisch erkannt.
				</p>
				<EditionLinks links={data.editions} />
				<p>
					<span class="text-zszh-500">Zitiervorschlag:</span>
					<span class="select-all">{citation}</span>
					<CopyButton text={citation} context="Zitiervorschlag" class="ml-1 text-zszh-600 hover:text-zszh-900 hover:underline no-print" />
				</p>
			</div>
		{/if}

		<!-- Action links -->
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-6 no-print">
			{#if catalogUnit}
				<a href={catalogUnitHref(catalogUnit.id)} class="inline-flex items-center gap-1 text-accent-600 underline">
					{catalogLabel}
				</a>
			{:else if data.doc.archiveLink}
				<a
					href={data.doc.archiveLink}
					target="_blank"
					rel="noopener external"
					class="inline-flex items-center gap-1 text-accent-600 underline"
				>
					{lateSourceLabel
						? `Original-PDF (${lateSourceLabel})`
						: isRm
							? "Band im Staatsarchiv-Katalog"
							: "Im Staatsarchiv-Katalog"}
					<svg
						class="w-3 h-3"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
						/>
					</svg>
				</a>
			{/if}
			{#if volumeHref}
				<a href={volumeHref} class="inline-flex items-center gap-1 text-zszh-600 hover:text-zszh-900 hover:underline">
					Alle Sitzungen dieses Bandes
				</a>
			{/if}
			{#if data.doc.manifestUrl}
				<a
					href={data.doc.manifestUrl}
					target="_blank"
					rel="noopener external"
					class="inline-flex items-center gap-1 text-zszh-600 hover:text-zszh-900 hover:underline"
					title="IIIF-Manifest (JSON)"
				>
					IIIF
				</a>
			{/if}
			<CopyButton
				text={permalink}
				label="Permalink kopieren"
				class="inline-flex items-center gap-1 text-zszh-600 hover:text-zszh-900 hover:underline"
			/>
			<DownloadPackage series={data.doc.series} docId={data.doc.id} />
		</div>
	</header>

	<!-- Verwandte Dokumente (aus <listRelation> im TEI-Header). Interner Link,
	     wenn das Ziel im Korpus liegt, sonst externer Staatsarchiv-Katalog-Link. -->
	{#if data.related && data.related.length > 0}
		<section class="bg-white border border-zszh-200 rounded-md shadow-sm px-5 py-4 mb-4">
			<button
				type="button"
				onclick={() => (relatedOpen = !relatedOpen)}
				aria-expanded={relatedOpen}
				class="flex w-full items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zszh-600 hover:text-accent-600"
			>
				<span aria-hidden="true" class="text-zszh-500">{relatedOpen ? "▾" : "▸"}</span>
				Verwandte Dokumente ({data.related.length})
			</button>
			{#if relatedOpen}
			<ul class="mt-2.5 flex flex-col gap-1.5 text-sm">
				{#each data.related as rel}
					<li class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span class="text-zszh-500 shrink-0">{rel.label}:</span>
						{#if rel.internal}
							<a
								href={`/documents/${rel.internal.series}/${rel.internal.id}`}
								class="text-accent-600 underline hover:text-accent-700 font-medium"
							>
								{normalizeWhitespace(rel.internal.title)}
							</a>
							<span class="text-xs text-zszh-500">
								{SERIES_LABEL[rel.internal.series]}{#if rel.internal.date}, {formatDateDE(rel.internal.date)}{/if}
							</span>
						{:else}
							<a
								href={rel.url}
								target="_blank"
								rel="noopener external"
								class="inline-flex items-center gap-1 text-accent-600 underline hover:text-accent-700"
							>
								Im Staatsarchiv-Katalog
								<svg
									class="w-3 h-3"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
									/>
								</svg>
							</a>
						{/if}
					</li>
				{/each}
			</ul>
			{/if}
		</section>
	{/if}

	<!--
		Tab-Bar: Text / Faksimile / Personen / Ähnliche.
		Faksimile-Tab nur auf Mobile (lg:hidden) – auf Desktop steht das
		Faksimile dauerhaft rechts in der Sidebar, dort ist ein Tab redundant.
		Auf schmalen Viewports scrollt die Leiste notfalls quer. Grundlinie als
		Inset-Schatten statt border + -mb-px: die Tabs dürfen nicht über die
		Leiste hinausragen, sonst zeigt overflow-x-auto einen Scrollbalken.
	-->
	<div
		bind:this={tabBar}
		role="tablist"
		aria-label="Dokument-Ansichten"
		class="flex overflow-x-auto shadow-[inset_0_-1px_0_var(--color-zszh-200)] mb-4 no-print"
	>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === "text"}
			aria-controls="tab-panel-text"
			id="tab-text"
			onclick={() => (activeTab = "text")}
			class="shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {activeTab === 'text' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600 hover:text-zszh-900'}"
		>
			Text
		</button>
		{#if data.doc.manifestUrl}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "facsimile"}
				aria-controls="tab-panel-facsimile"
				id="tab-facsimile"
				onclick={() => {
					activeTab = "facsimile";
					facsimileVisited = true;
				}}
				class="lg:hidden shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {activeTab === 'facsimile' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600 hover:text-zszh-900'}"
			>
				Faksimile
			</button>
		{/if}
		{#if data.krdbPersons.length > 0}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "persons"}
				aria-controls="tab-panel-persons"
				id="tab-persons"
				onclick={showPersons}
				title="Rats- und Regierungsmitglieder aus der Kantonsratsdatenbank"
				class="shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {activeTab === 'persons' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600 hover:text-zszh-900'}"
			>
				Personen <span class="text-zszh-500 font-normal tabular-nums">({data.krdbPersons.length})</span>
			</button>
		{/if}
		{#if data.ratCouncil}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "rat"}
				aria-controls="tab-panel-rat"
				id="tab-rat"
				onclick={() => (activeTab = "rat")}
				title="Wer in diesem Amtshalbjahr im Rat sass (Register des Staatsarchivs)"
				class="shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {activeTab === 'rat' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600 hover:text-zszh-900'}"
			>
				Rat <span class="text-zszh-500 font-normal tabular-nums">({data.ratCouncil.members.length})</span>
			</button>
		{/if}
		{#if hasSimilar}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "similar"}
				aria-controls="tab-panel-similar"
				id="tab-similar"
				onclick={() => {
					activeTab = "similar";
					similarVisited = true;
				}}
				class="shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {activeTab === 'similar' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600 hover:text-zszh-900'}"
			>
				Ähnliche
			</button>
		{/if}
		{#if data.catalog}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "catalog"}
				aria-controls="tab-panel-catalog"
				id="tab-catalog"
				onclick={() => (activeTab = "catalog")}
				title="Verzeichnungseinheit im Archivkatalog des Staatsarchivs"
				class="shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {activeTab === 'catalog' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600 hover:text-zszh-900'}"
			>
				Archivkatalog
			</button>
		{/if}
	</div>

	<!--
		Desktop: Text/Personen/Ähnliche im article links, Faksimile in aside rechts (sticky).
		Mobile: alles im article, der aktive Tab bestimmt das sichtbare Panel.
		Panels bleiben mit `hidden` im DOM, damit Tab-Wechsel keinen Re-Fetch /
		Mirador-Re-Init auslöst (Visited-Flags steuern initiales Mounten).
	-->
	<div class="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 lg:gap-6">
		<article class="min-w-0">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				bind:this={textPanel}
				id="tab-panel-text"
				role="tabpanel"
				aria-labelledby="tab-text"
				tabindex="0"
				class="bg-white border border-zszh-200 rounded-md p-5 md:p-6 tei-document-body {activeTab === 'text' ? '' : 'hidden'}"
				onclick={onTeiClick}
			>
				{#if data.html}
					{@html data.html}
				{:else}
					<div class="text-zszh-600 italic">
						Render-HTML fehlt (Indexer noch nicht gelaufen oder Datei nicht gefunden).
						Titel: <strong>{displayTitle}</strong>
					</div>
				{/if}
			</div>

			<!-- Karte beim Namen im Text; {#key}: offene Karte und Timer bei
			     Client-Navigation zum nächsten Dokument verwerfen. -->
			{#if data.krdbPersons.length > 0}
				{#key data.doc.id}
					<KrdbMentions
						bind:this={mentions}
						container={textPanel}
						html={data.html}
						persons={data.krdbPersons}
						active={activeTab === "text"}
						onShowAll={showPersons}
						onMarked={onNamesMarked}
					/>
				{/key}
			{:else if data.ratMentions.length > 0}
				{#key data.doc.id}
					<RatMentions
						bind:this={mentions}
						container={textPanel}
						html={data.html}
						persons={data.ratMentions}
						active={activeTab === "text"}
						searchHref={(form) => entitySearchHref("persons", form)}
						onShowAll={data.ratCouncil ? showRat : undefined}
						onMarked={onNamesMarked}
					/>
				{/key}
			{/if}

			{#if facsimileVisited && data.doc.manifestUrl}
				<div
					id="tab-panel-facsimile"
					role="tabpanel"
					aria-labelledby="tab-facsimile"
					tabindex="0"
					class="lg:hidden {activeTab === 'facsimile' ? '' : 'hidden'}"
				>
					<!--
						{#key} erzwingt vollen Re-Mount bei Doc-Wechsel. Nach
						doc.id-Effect setzt facsimileVisited=false und die Komponente
						unmountet ohnehin – der Key ist eine zusätzliche Garantie für
						Hot-Module-Reloads und Edge-Cases.
					-->
					{#key data.doc.id}
						<Facsimile manifestUrl={data.doc.manifestUrl} {targetPage} />
					{/key}
				</div>
			{/if}

			{#if personsVisited && data.krdbPersons.length > 0}
				<div
					id="tab-panel-persons"
					role="tabpanel"
					aria-labelledby="tab-persons"
					tabindex="0"
					class={activeTab === "persons" ? "" : "hidden"}
				>
					{#key data.doc.id}
						<KrdbPersons
							persons={data.krdbPersons}
							stand={data.krdbStand}
							{mentioned}
							{focusId}
							onReveal={revealInText}
						/>
					{/key}
				</div>
			{/if}

			{#if data.ratCouncil}
				<div
					id="tab-panel-rat"
					role="tabpanel"
					aria-labelledby="tab-rat"
					tabindex="0"
					class={activeTab === "rat" ? "" : "hidden"}
				>
					<RatCouncil council={data.ratCouncil} {mentioned} onReveal={revealInText} />
				</div>
			{/if}

			{#if similarVisited && hasSimilar}
				<div
					id="tab-panel-similar"
					role="tabpanel"
					aria-labelledby="tab-similar"
					tabindex="0"
					class={activeTab === "similar" ? "" : "hidden"}
				>
					<Similar id={data.doc.id} />
				</div>
			{/if}

			{#if data.catalog}
				<div
					id="tab-panel-catalog"
					role="tabpanel"
					aria-labelledby="tab-catalog"
					tabindex="0"
					class={activeTab === "catalog" ? "" : "hidden"}
				>
					{#key data.doc.id}
						<CatalogEntry catalog={data.catalog} />
					{/key}
				</div>
			{/if}
		</article>

		{#if sideBySide && data.doc.manifestUrl}
			<aside aria-label="Faksimile" class="hidden lg:block min-w-0">
				<div
					class="sticky"
					style="top: calc(var(--sticky-top) + 1rem); height: calc(100vh - var(--sticky-top) - 2rem);"
				>
					<!--
						{#key} erzwingt vollen Re-Mount bei Doc-Wechsel über
						Client-Navigation. Facsimile initialisiert Mirador nur
						in onMount – ohne Key bliebe der Viewer mit dem alten
						Manifest hängen, weil Svelte die Komponente recyclet.
					-->
					{#key data.doc.id}
						<Facsimile manifestUrl={data.doc.manifestUrl} fillHeight {targetPage} />
					{/key}
				</div>
			</aside>
		{:else if sideBySide && !data.doc.manifestUrl}
			<aside aria-label="Faksimile" class="hidden lg:block">
				<div class="bg-white border border-zszh-200 rounded-md p-4">
					{#if catalogUnit}
						<a
							href={catalogUnitHref(catalogUnit.id)}
							class="inline-flex items-center gap-2 text-accent-600 underline hover:text-accent-700 font-medium"
						>
							{catalogLabel}
						</a>
					{:else if data.doc.archiveLink}
						<a
							href={data.doc.archiveLink}
							target="_blank"
							rel="noopener external"
							class="inline-flex items-center gap-2 text-accent-600 underline hover:text-accent-700 font-medium"
						>
							<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
							</svg>
							{lateSourceLabel ? `Original-PDF öffnen (${lateSourceLabel})` : "Im Staatsarchiv-Katalog"}
						</a>
						{#if lateSourceLabel}
							<p class="mt-1.5 text-xs text-zszh-600">
								Kein Faksimile – der Text wurde aus dem Original-PDF extrahiert.
							</p>
						{/if}
					{:else}
						<span class="text-sm text-zszh-600 italic">Kein Faksimile verfügbar.</span>
					{/if}
				</div>
			</aside>
		{/if}
	</div>
</div>
