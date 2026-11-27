<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Detailseite eines Editionsstücks (Daten: +page.server.ts). Desktop: Text links, Faksimile
	// rechts (sticky); Handy: Reiter «Text» und «Faksimile». Klick auf eine Seitenzahl im Text
	// blättert das Faksimile dorthin, Klick auf einen Namen (Text, Regest, Anmerkungen,
	// Kommentar) sucht ihn im Reiter «Editionen».
	// Anmerkungen: Marke im Text, Liste darunter (textkritisch mit Buchstaben, Sachanmerkungen
	// mit Zahlen). Das HTML kommt beim Aufbau maskiert aus dem Index (editionTei.ts).
	import { tick } from "svelte";
	import CopyButton from "$lib/components/CopyButton.svelte";
	import Facsimile from "$lib/components/Facsimile.svelte";
	import { catalogPermalink, catalogUnitHref } from "$lib/catalog";
	import { EDITIONS } from "$lib/editions";
	import {
		editionCitation,
		editionCredits,
		editionDateLabel,
		editionLabel,
		editionNeighborLabel,
		editionTeiUrl,
		editionUnitPath,
	} from "$lib/editionTexts";
	import { editionRegisterHref } from "$lib/editionRegister";
	import { searchViewHref } from "$lib/searchViews";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const u = $derived(data.unit);
	const info = $derived(EDITIONS[u.edition]);
	const date = $derived(editionDateLabel(u.isoFrom, u.isoTo));
	const credits = $derived(editionCredits(u));
	const citation = $derived(editionCitation(u, data.pageUrl));
	const critical = $derived(u.notes.filter((n) => n.type === "critical"));
	const editorial = $derived(u.notes.filter((n) => n.type === "editorial"));
	const printed = $derived(u.bibl.filter((b) => b.head === "Edition"));
	const otherBibl = $derived(u.bibl.filter((b) => b.head !== "Edition"));
	const backHref = $derived(data.fromSearch ? `/search?${data.fromSearch}` : searchViewHref("editions"));
	const teiUrl = $derived(editionTeiUrl(u));
	const julian = $derived(u.calendar === "julian");
	// Vorlagen der weiteren Überlieferungen (Rechtsquellen) für den Hinweis ohne Faksimile.
	const allCatalogIds = $derived([...new Set([...u.catalogIds, ...u.witnesses.flatMap((w) => w.catalogIds)])]);

	// Namen im Text: Form → Name des Registers. Nur für Indexstände ohne `data-name` (Aufbau
	// vor 2026-11): dort zählt die angezeigte Form, die bei Abkürzungen und Gestrichenem nicht
	// trifft.
	const personByForm = $derived(new Map(u.persons.flatMap((p) => p.forms.map((f) => [f, p.name] as const))));
	const placeByForm = $derived(new Map(u.places.flatMap((p) => p.forms.map((f) => [f, p.name] as const))));
	const nameSearch = (param: "persons" | "places" | "organizations", value: string) =>
		searchViewHref("editions", { [param]: value });

	// Suche zu einem Namen: der Filterwert aus `data-name` (Name des Registers, editionTei.ts);
	// ohne ihn nur im Haupttext (`legacy`) über die Formen der Liste, sonst kein Link.
	function nameHref(entity: HTMLElement, legacy: boolean): string | null {
		const param = entity.classList.contains("ed-person") ? "persons" : entity.classList.contains("ed-place") ? "places" : "organizations";
		if (entity.dataset.name) return nameSearch(param, entity.dataset.name);
		if (!legacy) return null;
		const form = (entity.textContent ?? "").replace(/\s+/g, " ").trim();
		if (!form) return null;
		const byForm = param === "persons" ? personByForm : param === "places" ? placeByForm : null;
		return nameSearch(param, byForm?.get(form) ?? form);
	}

	// Doppel- und Dreifachklick oder eine Markierung (Namen kopieren) öffnen keinen Tab.
	function onNameClick(e: MouseEvent, legacy = false) {
		if (e.detail > 1 || window.getSelection()?.isCollapsed === false) return;
		const el = e.target as HTMLElement | null;
		const entity = el?.closest(".ed-person, .ed-place, .ed-org") as HTMLElement | null;
		if (!entity || el?.closest("a")) return;
		const href = nameHref(entity, legacy);
		if (href) window.open(href, "_blank", "noopener");
	}

	// Faksimile: nebenan ab lg, sonst als Reiter.
	let sideBySide = $state(false);
	$effect(() => {
		const mq = window.matchMedia("(min-width: 1024px)");
		const update = () => (sideBySide = mq.matches);
		update();
		mq.addEventListener("change", update);
		return () => mq.removeEventListener("change", update);
	});
	let tab = $state<"text" | "facsimile">("text");
	let facsimileVisited = $state(false);
	type PageTarget = { label: string; ordinal: number; seq: number };
	let targetPage = $state<PageTarget | null>(null);
	let seq = 0;
	let showLines = $state(false);

	$effect(() => {
		void u.id;
		tab = "text";
		facsimileVisited = false;
		targetPage = null;
	});

	function onTextClick(e: MouseEvent) {
		const el = e.target as HTMLElement | null;
		if (!el) return;
		const pb = el.closest(".ed-pb") as HTMLElement | null;
		if (pb) {
			const image = u.pages[Number(pb.dataset.page)]?.image;
			if (image == null) return;
			if (!sideBySide) {
				tab = "facsimile";
				facsimileVisited = true;
			}
			targetPage = { label: "", ordinal: image, seq: ++seq };
			return;
		}
		onNameClick(e, true);
	}


	async function showFacsimile() {
		tab = "facsimile";
		facsimileVisited = true;
		await tick();
	}

	const mapUrl = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=13/${lat}/${lon}`;
</script>

<svelte:head>
	<title>{u.title} | {info.short} | {SITE_NAME}</title>
	<meta name="robots" content="noindex, follow" />
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-6">
	<nav aria-label="Pfad und Nachbarstücke" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-6 text-zszh-600 mb-3 no-print">
		<a href={backHref} class="hover:underline">← {data.fromSearch ? "Zurück zur Trefferliste" : "Editionen"}</a>
		<span class="text-zszh-400">·</span>
		<a href={searchViewHref("editions", { edEdition: u.edition })} class="hover:underline">{info.name}</a>
		{#if data.neighbors.prev || data.neighbors.next}
			<span class="ml-auto flex gap-3">
				{#if data.neighbors.prev}<a href={editionUnitPath(u.edition, data.neighbors.prev)} class="hover:underline"
						>← {editionNeighborLabel(u.edition, data.neighbors.prev)}</a
					>{/if}
				{#if data.neighbors.next}<a href={editionUnitPath(u.edition, data.neighbors.next)} class="hover:underline"
						>{editionNeighborLabel(u.edition, data.neighbors.next)} →</a
					>{/if}
			</span>
		{/if}
	</nav>

	<header class="bg-white border border-zszh-200 rounded-md shadow-sm px-5 py-4 mb-4 min-w-0">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2.5">
			<span class="inline-block px-2 py-0.5 text-xs font-bold uppercase tracking-wider rounded bg-zszh-900 text-zszh-50" title={info.name}
				>{info.short}</span
			>
			<span class="text-xs text-zszh-600 {u.edition === 'qzh' ? 'font-mono' : 'font-medium'}">{editionLabel(u)}</span>
			{#if date}
				<time datetime={u.isoFrom ?? undefined} class="text-zszh-700 font-medium text-sm">{date}</time>
				{#if julian}<span class="text-xs text-zszh-600" title="Datum im alten Stil (julianischer Kalender), wie die Edition es angibt">(a. St.)</span>{/if}
			{/if}
			{#if u.origPlace}<span class="text-xs text-zszh-600">{u.origPlace}</span>{/if}
			<span class="text-xs text-zszh-600">{u.part}</span>
		</div>
		<h1 class="font-serif text-xl md:text-2xl text-zszh-900 leading-tight mb-2">{u.title}</h1>

		<dl class="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-x-3 sm:gap-y-1 text-xs text-zszh-700 mb-3 [overflow-wrap:anywhere]">
			{#if u.signature}
				<dt class="text-zszh-500 mt-1.5 sm:mt-0">Vorlage</dt>
				<dd>
					{u.signature}
					{#each u.catalogIds as cid (cid)}
						{#if data.catalogOwn.includes(cid)}
							<a href={catalogUnitHref(cid)} class="ml-1 text-accent-600 underline">im Archivkatalog</a>
						{:else}
							<a href={catalogPermalink(cid)} target="_blank" rel="noopener external" class="ml-1 text-accent-600 underline">im Archivkatalog ↗</a>
						{/if}
					{/each}
				</dd>
			{/if}
			{#if u.witnesses.length > 0}
				<dt class="text-zszh-500 mt-1.5 sm:mt-0">Weitere Überlieferung{u.witnesses.length > 1 ? "en" : ""}</dt>
				<dd>
					{#each u.witnesses as w, i (w.textId ?? `${w.signature}-${i}`)}
						{#if i > 0}<span class="text-zszh-400"> · </span>{/if}{w.signature || "ohne Signatur"}
						{#if w.isoFrom}<span class="text-zszh-500">({editionDateLabel(w.isoFrom, w.isoTo)})</span>{/if}
						{#each w.catalogIds as cid (cid)}
							{#if data.catalogOwn.includes(cid)}
								<a href={catalogUnitHref(cid)} class="ml-1 text-accent-600 underline">im Archivkatalog</a>
							{:else}
								<a href={catalogPermalink(cid)} target="_blank" rel="noopener external" class="ml-1 text-accent-600 underline">im Archivkatalog ↗</a>
							{/if}
						{:else}
							{#if w.sourceUrl}<a href={w.sourceUrl} target="_blank" rel="noopener external" class="ml-1 text-accent-600 underline">Katalog ↗</a>{/if}
						{/each}
					{/each}
					<span class="text-zszh-500">(nur beschrieben; ediert ist der Text oben)</span>
				</dd>
			{/if}
			{#each credits as c (c.label)}
				<dt class="text-zszh-500 mt-1.5 sm:mt-0">{c.label}</dt>
				<dd>{c.names.join(", ")}</dd>
			{/each}
			{#each printed as b (b.text)}
				<dt class="text-zszh-500 mt-1.5 sm:mt-0">Gedruckt</dt>
				<dd>{@html b.html}</dd>
			{/each}
			{#if data.rmDocs.length > 0}
				<dt class="text-zszh-500 mt-1.5 sm:mt-0">Ratsmanual</dt>
				<dd>
					{#each data.rmDocs as doc, i (doc)}
						{#if i > 0}, {/if}<a href={`/documents/RM/${encodeURIComponent(doc)}`} class="text-accent-600 underline">Sitzung auf der Plattform</a>
					{/each}
					<span class="text-zszh-500">(maschinelle Transkription mit Faksimile)</span>
				</dd>
			{/if}
		</dl>

		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-6 no-print mb-3">
			<a href={u.permalink} target="_blank" rel="noopener external" class="text-accent-600 underline">Stück in der Edition {info.short} ↗</a>
			{#if teiUrl}<a href={teiUrl} target="_blank" rel="noopener external" class="text-zszh-600 hover:text-zszh-900 hover:underline">TEI-XML ↗</a>{/if}
			{#if data.manifestUrl}
				<a href={data.manifestUrl} target="_blank" rel="noopener" class="text-zszh-600 hover:text-zszh-900 hover:underline" title="IIIF-Manifest (JSON)">IIIF</a>
			{/if}
			<CopyButton text={data.pageUrl} label="Permalink kopieren" />
		</div>

		<p class="text-xs text-zszh-700 mb-1.5 [overflow-wrap:anywhere]">
			<span class="text-zszh-500">Zitiervorschlag:</span>
			<span class="select-all">{citation}</span>
			<CopyButton text={citation} context="Zitiervorschlag" class="ml-1 text-zszh-600 hover:text-zszh-900 hover:underline no-print" />
		</p>
		<p class="text-xs text-zszh-500 leading-snug">
			Edition: {info.attribution},
			<a href={info.licenseUrl} target="_blank" rel="noopener license" class="underline">{info.license}</a>{#if info.images && u.facs.length > 0}; Abbildungen:
				<a href={info.images.url} target="_blank" rel="noopener license" class="underline">{info.images.label}</a>{/if}.
			Darstellung der Plattform, nicht die der Edition.
		</p>
	</header>

	{#if data.manifestUrl}
		<div class="lg:hidden flex gap-1 mb-3 shadow-[inset_0_-1px_0] shadow-zszh-200 no-print" role="tablist" aria-label="Ansicht">
			<button
				type="button"
				role="tab"
				aria-selected={tab === "text"}
				class="px-3 py-1.5 text-sm font-medium border-b-2 {tab === 'text' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600'}"
				onclick={() => (tab = "text")}>Text</button
			>
			<button
				type="button"
				role="tab"
				aria-selected={tab === "facsimile"}
				class="px-3 py-1.5 text-sm font-medium border-b-2 {tab === 'facsimile' ? 'border-accent-500 text-zszh-900' : 'border-transparent text-zszh-600'}"
				onclick={showFacsimile}>Faksimile ({u.facs.length})</button
			>
		</div>
	{/if}

	<div class="grid grid-cols-1 {data.manifestUrl ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : 'lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]'} gap-4 lg:gap-6">
		<article class="min-w-0 space-y-4 {tab === 'text' || sideBySide ? '' : 'hidden'}">
			{#if u.regestHtml}
				<section class="bg-zszh-50 border border-zszh-200 rounded-md px-5 py-3">
					<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-1.5">Regest</h2>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<p class="text-sm text-zszh-800 leading-relaxed" onclick={(e) => onNameClick(e)}>{@html u.regestHtml}</p>
				</section>
			{/if}

			<section class="bg-white border border-zszh-200 rounded-md p-5 md:p-6">
				<div class="flex flex-wrap items-center justify-between gap-2 mb-2 no-print">
					<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold">Text</h2>
					<label class="flex items-center gap-1.5 text-xs text-zszh-600 cursor-pointer" title="Zeilenwechsel der Vorlage als | anzeigen">
						<input type="checkbox" class="accent-accent-500" bind:checked={showLines} />
						Zeilenfall der Vorlage
					</label>
				</div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="ed-text ed-main {showLines ? 'show-lb' : ''}" onclick={onTextClick}>
					{@html u.html}
				</div>
				{#if u.textLang.length > 0 && !(u.textLang.length === 1 && u.textLang[0] === "Deutsch")}
					<p class="mt-3 text-xs text-zszh-600">Sprache: {u.textLang.join(", ")}</p>
				{/if}
			</section>

			{#if critical.length + editorial.length > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<section class="bg-white border border-zszh-200 rounded-md p-5 md:p-6 ed-notes" onclick={(e) => onNameClick(e)}>
					{#if critical.length > 0}
						<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Textkritische Anmerkungen</h2>
						<ol class="space-y-1 text-sm text-zszh-800 mb-4">
							{#each critical as n (n.key)}
								<li id={`ed-note-${n.key}`} class="flex gap-2 scroll-mt-4">
									<a href={`#ed-ref-${n.key}`} class="shrink-0 w-6 text-right italic text-accent-600 no-underline" title="zur Stelle im Text">{n.label}</a>
									<span class="min-w-0">{@html n.html}{#if n.inBack}<span class="text-xs text-zszh-500"> (im Kommentar)</span>{/if}</span>
								</li>
							{/each}
						</ol>
					{/if}
					{#if editorial.length > 0}
						<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Sachanmerkungen</h2>
						<ol class="space-y-1 text-sm text-zszh-800">
							{#each editorial as n (n.key)}
								<li id={`ed-note-${n.key}`} class="flex gap-2 scroll-mt-4">
									<a href={`#ed-ref-${n.key}`} class="shrink-0 w-6 text-right text-accent-600 no-underline" title="zur Stelle im Text">{n.label}</a>
									<span class="min-w-0">{@html n.html}{#if n.inBack}<span class="text-xs text-zszh-500"> (im Kommentar)</span>{/if}</span>
								</li>
							{/each}
						</ol>
					{/if}
				</section>
			{/if}

			{#if u.backHtml}
				<section class="bg-white border border-zszh-200 rounded-md p-5 md:p-6">
					<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Kommentar</h2>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="ed-text ed-comment text-[0.95rem]" onclick={(e) => onNameClick(e)}>{@html u.backHtml}</div>
				</section>
			{/if}

			{#if u.persons.length + u.places.length + u.orgs.length + u.keywords.length > 0}
				<section class="bg-white border border-zszh-200 rounded-md p-5 md:p-6 grid gap-4 sm:grid-cols-2">
					{#if u.persons.length > 0}
						<div>
							<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Personen ({u.persons.length})</h2>
							<ul class="space-y-1 text-sm leading-6">
								{#each u.persons as p (p.name)}
									<li>
										<a href={nameSearch("persons", p.name)} class="text-zszh-900 hover:text-accent-600 hover:underline" title="In den Editionen suchen">{p.name}</a>
										{#if p.gnd}<a href={`https://d-nb.info/gnd/${p.gnd}`} target="_blank" rel="noopener external" class="text-xs text-accent-600 hover:underline ml-1">GND ↗</a>{/if}
										{#if p.gnd && data.ratHrefs[p.gnd]}<a href={data.ratHrefs[p.gnd]} class="text-xs text-accent-600 hover:underline ml-1" title="Dieselbe GND im Register des Kleinen Rats (Staatsarchiv)">Kleiner Rat</a>{/if}
										{#if p.forms.some((f) => f !== p.name)}<span class="ed-form text-xs text-zszh-500 ml-1">({p.forms.filter((f) => f !== p.name).slice(0, 3).join(", ")})</span>{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if u.places.length > 0}
						<div>
							<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Orte ({u.places.length})</h2>
							<ul class="space-y-1 text-sm leading-6">
								{#each u.places as p (p.name)}
									<li>
										<a href={nameSearch("places", p.name)} class="text-zszh-900 hover:text-accent-600 hover:underline" title="In den Editionen suchen">{p.name}</a>
										{#if p.lat != null && p.lon != null}<a href={mapUrl(p.lat, p.lon)} target="_blank" rel="noopener external" class="text-xs text-accent-600 hover:underline ml-1">Karte ↗</a>{/if}
										{#if p.forms.some((f) => f !== p.name)}<span class="ed-form text-xs text-zszh-500 ml-1">({p.forms.filter((f) => f !== p.name).slice(0, 3).join(", ")})</span>{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if u.orgs.length > 0}
						<div>
							<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Organisationen ({u.orgs.length})</h2>
							<ul class="space-y-1 text-sm leading-6">
								{#each u.orgs as o (o)}
									<li><a href={nameSearch("organizations", o)} class="text-zszh-900 hover:text-accent-600 hover:underline">{o}</a></li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if u.keywords.length > 0}
						<div>
							<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Schlagwörter</h2>
							<ul class="flex flex-wrap gap-1.5 text-xs">
								{#each u.keywords as k (k)}
									<li>
										<a
											href={searchViewHref("editions", { edKeyword: k })}
											title={u.keywordGlosses[k] ?? undefined}
											class="inline-block px-2 py-0.5 rounded bg-zszh-100 text-zszh-800 hover:bg-zszh-200">{k}</a
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					<p class="sm:col-span-2 text-xs text-zszh-500 leading-snug">
						{#if u.entitySource === "ner"}
							Namen automatisch erkannt, nicht von der Edition ausgezeichnet und nicht geprüft; Fehler sind möglich.
						{:else}
							Namen und Orte wie im Register der Edition (Normnamen{u.edition === "qzh" ? ", GND" : ""}, Koordinaten); in Klammern die Schreibung im
							Text.
						{/if}
						Alle Namen der Editionen: <a href={editionRegisterHref("personen")} class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Register</a>.
					</p>
				</section>
			{/if}

			<section class="bg-white border border-zszh-200 rounded-md p-5 md:p-6 text-sm">
				<h2 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-2">Stückbeschreibung</h2>
				<dl class="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:gap-y-1 text-zszh-800 [overflow-wrap:anywhere]">
					{#if u.filiation}<dt class="text-zszh-500 mt-1.5 sm:mt-0">Überlieferung</dt><dd>{u.filiation}</dd>{/if}
					{#each u.physical as ph (ph)}<dt class="text-zszh-500 mt-1.5 sm:mt-0">Beschreibung</dt><dd>{ph}</dd>{/each}
					{#if u.textLang.length > 0}<dt class="text-zszh-500 mt-1.5 sm:mt-0">Sprache</dt><dd>{u.textLang.join(", ")}</dd>{/if}
					{#each otherBibl as b (b.text)}<dt class="text-zszh-500 mt-1.5 sm:mt-0">{b.head || "Literatur"}</dt><dd>{@html b.html}</dd>{/each}
					{#if u.publisher}<dt class="text-zszh-500 mt-1.5 sm:mt-0">Herausgeber</dt><dd>{u.publisher}</dd>{/if}
					{#if u.published}<dt class="text-zszh-500 mt-1.5 sm:mt-0">Online seit</dt><dd>{editionDateLabel(u.published, u.published)}</dd>{/if}
				</dl>
			</section>
		</article>

		{#if data.manifestUrl}
			{#if sideBySide}
				<aside aria-label="Faksimile" class="hidden lg:block min-w-0">
					<div class="sticky" style="top: calc(var(--sticky-top) + 1rem); height: calc(100vh - var(--sticky-top) - 2rem);">
						{#key u.id}
							<Facsimile manifestUrl={data.manifestUrl} fillHeight {targetPage} />
						{/key}
					</div>
				</aside>
			{:else if facsimileVisited}
				<div class="lg:hidden {tab === 'facsimile' ? '' : 'hidden'}">
					{#key u.id}
						<Facsimile manifestUrl={data.manifestUrl} {targetPage} />
					{/key}
				</div>
			{/if}
		{:else}
			<aside aria-label="Faksimile" class="hidden lg:block">
				<div class="bg-white border border-zszh-200 rounded-md p-4 text-sm text-zszh-600">
					Kein Faksimile in der Edition.
					{#if data.rmDocs.length > 0}
						Die <a href={`/documents/RM/${encodeURIComponent(data.rmDocs[0])}`} class="text-accent-600 underline">Ratsmanual-Sitzung</a> auf der Plattform hat eines.
					{:else if allCatalogIds.length > 0}
						Digitalisate gibt es teils im
						<a href={catalogPermalink(allCatalogIds[0])} target="_blank" rel="noopener external" class="text-accent-600 underline">Archivkatalog ↗</a>.
					{/if}
				</div>
			</aside>
		{/if}
	</div>
</div>
