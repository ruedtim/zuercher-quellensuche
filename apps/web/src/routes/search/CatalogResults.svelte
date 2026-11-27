<script lang="ts">
	// Trefferliste des Reiters «Archivkatalog». Jede Einheit führt auf ihre Seite
	// auf der Plattform (/archivkatalog/<ID>, mit ?from= für «Zurück zur
	// Trefferliste»); der Online-Katalog des Staatsarchivs und die Digitalisate
	// stehen als eigene Links darunter, bei Eheeinträgen der Ehedatenbank dieselbe
	// Suche im Reiter «Ehedaten». Titel und Auszug kommen serverseitig maskiert.
	import { CATALOG_IN_PROGRESS, catalogPermalink, catalogUnitHref, formatCatalogDate, type CatalogResult } from "$lib/catalog";
	import { signatureEntryOf, writeCatalogFields } from "$lib/catalogFields";
	import { isEhedatenSignature } from "$lib/ehedaten";
	import ListEnd from "./ListEnd.svelte";
	import { searchViewHref } from "$lib/searchViews";
	import { CORPUS_CAP, type SearchParams } from "$lib/types";

	let {
		result,
		sort,
		hasQuery,
		themed = false,
		contextSearch,
		onSort,
		onPage,
	}: {
		result: CatalogResult;
		sort: SearchParams["sort"];
		hasQuery: boolean;
		/** Ein Thema ist gesetzt und der Katalog kann es reihen (Vektoren, Embed-Service). */
		themed?: boolean;
		/** Querystring der aktuellen Suche (ohne ask) für den Rückweg von der Einheit. */
		contextSearch: string;
		onSort: (sort: SearchParams["sort"]) => void;
		onPage: (page: number) => void;
	} = $props();

	const unitHref = (id: number) => `${catalogUnitHref(id)}${contextSearch ? `?from=${encodeURIComponent(contextSearch)}` : ""}`;
	// Eheeinträge: dieselbe Suche im Reiter «Ehedaten» (Namen mit Rolle, Kirchgemeinde, Herkunft).
	const ehedatenTabHref = $derived.by(() => {
		const sp = new URLSearchParams(contextSearch);
		sp.delete("page");
		return searchViewHref("ehedaten", sp);
	});

	// Suchbegriff wie «MM 3.56 RRB 1938/1585» ohne Treffer: dieselbe Eingabe im Feld «Signatur»,
	// das auch die Einheiten der Zentralen Serien findet.
	const signatureHref = $derived.by(() => {
		const sp = new URLSearchParams(contextSearch);
		const entry = signatureEntryOf(sp.get("q") ?? "");
		if (!entry || sp.has("catSig")) return null;
		for (const key of ["q", "qAny", "titleOnly", "page"]) sp.delete(key);
		writeCatalogFields(sp, [entry]);
		return searchViewHref("catalog", sp);
	});

	const nf = (n: number) => n.toLocaleString("de-CH");
	const units = (n: number) => (n === 1 ? "Verzeichnungseinheit" : "Verzeichnungseinheiten");
	// Thema-Reihung: gereiht und durchblätterbar sind höchstens rankedPool Treffer; ohne Thema
	// endet die Liste am browseLimit.
	const browsable = $derived(
		Math.min(result.total, result.theme?.rankedPool ?? Number.POSITIVE_INFINITY, result.browseLimit ?? Number.POSITIVE_INFINITY),
	);
	const totalPages = $derived(Math.max(1, Math.ceil(browsable / result.pageSize)));
	const topKOf = $derived(result.theme?.mode === "topK" ? (result.theme.topKOfTotal ?? null) : null);
</script>

<div class="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm text-zszh-700 mb-4">
	<div>
		<strong class="tabular-nums">{nf(result.total)}</strong>
		{#if topKOf != null && topKOf > result.total}
			ähnlichste von {nf(topKOf)} {units(topKOf)}
		{:else if topKOf != null}
			ähnlichste {units(result.total)}
		{:else}
			{units(result.total)}
		{/if}
		{#if result.theme?.rankedPool != null}
			<span
				title="Mit einem Thema lassen sich {nf(result.theme.rankedPool)} Einheiten durchblättern, zuerst die dem Thema nächsten – die Zahl zählt alle."
				>(davon {nf(result.theme.rankedPool)} durchblätterbar)</span
			>
		{:else if result.browseLimit != null}
			<span
				title="Durchblättern lassen sich die ersten {nf(result.browseLimit)} Einheiten der Liste – die Zahl zählt alle. Mit engeren Filtern, etwa einem Zeitraum oder einem Bestand, sind auch die übrigen erreichbar."
				>(davon {nf(result.browseLimit)} durchblätterbar)</span
			>
		{/if}
		<span class="text-zszh-600">in {result.processingTimeMs} ms</span>
		{#if CATALOG_IN_PROGRESS && result.total > 0}
			<span class="text-zszh-600">
				·
				<a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600"
					>Katalog noch im Aufbau</a
				>
			</span>
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-zszh-600">
		{#if totalPages > 1}
			<span class="flex items-center gap-1.5">
				<button
					type="button"
					class="px-2 py-0.5 border border-zszh-300 rounded text-sm disabled:opacity-50"
					disabled={result.page <= 1}
					aria-label="Vorherige Seite"
					onclick={() => onPage(result.page - 1)}
				>
					←
				</button>
				<span class="tabular-nums">{result.page} / {totalPages.toLocaleString("de-CH")}</span>
				<button
					type="button"
					class="px-2 py-0.5 border border-zszh-300 rounded text-sm disabled:opacity-50"
					disabled={result.page >= totalPages}
					aria-label="Nächste Seite"
					onclick={() => onPage(result.page + 1)}
				>
					→
				</button>
			</span>
		{/if}
		<label class="flex items-center gap-1.5">
			<span class="sr-only">Sortierung</span>
			<select
				value={sort}
				onchange={(e) => onSort(e.currentTarget.value as SearchParams["sort"])}
				class="px-2 py-1 bg-white border border-zszh-300 rounded text-sm"
			>
				{#if hasQuery || themed}
					<option value="relevance">{themed ? "Ähnlichkeit" : "Relevanz"}</option>
				{/if}
				<option value="date_asc">Datum aufsteigend</option>
				<option value="date_desc">Datum absteigend</option>
			</select>
		</label>
	</div>
</div>

{#if result.themeWithoutVectors}
	<p class="text-xs text-zszh-600 mb-3 leading-snug">
		Das Thema reiht diese Auswahl nicht (Personendossiers, Ehedaten und Firmen tragen nur Namen).
	</p>
{/if}

{#if result.fieldsTooBroad}
	<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
		Die Feldsuche ist zu breit: Jedes Feld – und der Suchbegriff, falls gesetzt – trifft für sich mehr als
		{nf(CORPUS_CAP)} Einheiten, so grosse Mengen gleicht die Suche nicht miteinander ab. Fasse einen Eintrag enger
		(etwa mit «exakt») oder grenze mit einem Filter ein.
	</div>
{:else if result.hits.length === 0 && result.total > 0 && result.page > totalPages}
	<ListEnd lastPage={totalPages} {onPage} />
{:else if result.hits.length === 0}
	<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
		Keine Verzeichnungseinheiten gefunden. Versuche es mit anderen Suchbegriffen oder weniger Filtern.
		{#if signatureHref}
			<a href={signatureHref} class="text-accent-600 underline">Als Signatur suchen</a> (auch in den Zentralen Serien).
		{/if}
		{#if CATALOG_IN_PROGRESS}
			Der Katalog ist noch im Aufbau, es fehlen noch Einheiten.
		{/if}
	</div>
{:else}
	<ul>
		{#each result.hits as hit (hit.id)}
			<li id={`cat-${hit.id}`} class="hit-row">
				<!-- Getrennte Links: der Titel zur Seite der Einheit (deckt die Zeile) und
				     darüber liegend Online-Katalog und Digitalisate. -->
				<div class="pt-3.5 pb-2">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
						<span class="badge-code">{hit.level}</span>
						{#if hit.dateText}
							<span class="text-xs text-zszh-600">{formatCatalogDate(hit.dateText)}</span>
						{/if}
						{#if hit.signature}<span class="text-xs text-zszh-600">· {hit.signature}</span>{/if}
						{#if isEhedatenSignature(hit.signature)}
							<span class="text-xs text-accent-700" title="Eintrag der Ehedatenbank: Ehe-Karte auf der Seite der Einheit, eigene Suche im Reiter «Ehedaten»"
								>· Eheeintrag</span
							>
						{/if}
						{#if hit.hasDigitization && hit.files.length === 0}
							<span class="text-xs text-accent-700" title="Im Online-Katalog als Digitalisat einsehbar">· Digitalisat</span>
						{/if}
					</div>
					<h3 class="font-serif text-lg font-semibold text-zszh-900 leading-tight whitespace-pre-line kwic"
						><a href={unitHref(hit.id)} class="hit-link">{@html hit.titleHtml}</a></h3
					>
					{#if hit.textHtml}
						<p class="text-sm text-zszh-700 mt-2 leading-relaxed kwic">{@html hit.textHtml}</p>
					{/if}
					<p class="text-xs text-zszh-600 mt-2">
						{hit.bestand ?? ""}{#if hit.parent}{" "}<span class="text-zszh-400" aria-hidden="true">›</span>{" "}{hit.parent}{/if}
					</p>
				</div>
				<!-- Einheiten der Zentralen Serien (nur bei der Suche nach Signatur): zuerst das Dokument. -->
				<div class="hit-more pb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs leading-6 w-fit">
					{#if hit.doc}
						<a href={`/documents/${hit.doc.series}/${encodeURIComponent(hit.doc.id)}`} class="text-accent-600 hover:underline">Dokument mit Volltext</a>
						<span class="text-zszh-600">·</span>
					{/if}
					<a href={catalogPermalink(hit.id)} target="_blank" rel="noopener" class="text-accent-600 hover:underline">
						Im Archivkatalog des Staatsarchivs ↗
					</a>
					{#if isEhedatenSignature(hit.signature)}
						<span class="text-zszh-600">·</span>
						<a href={ehedatenTabHref} class="text-accent-600 hover:underline" title="Dieselbe Suche im Reiter «Ehedaten»: Namen mit Rolle, Kirchgemeinde, Herkunft"
							>Suche im Reiter «Ehedaten»</a
						>
					{/if}
					{#if hit.files.length > 0}
						<span class="text-zszh-600">· Digitalisat:</span>
						{#each hit.files as file (file.url)}
							<a href={file.url} target="_blank" rel="noopener" title={file.title} class="text-accent-700 hover:underline">
								{file.label} ↗
							</a>
						{/each}
						{#if hit.fileCount > hit.files.length}
							<span class="text-zszh-600">und {hit.fileCount - hit.files.length} weitere im Katalog</span>
						{/if}
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#if totalPages > 1}
		<nav aria-label="Seiten" class="mt-8 flex justify-center gap-2">
			<button
				type="button"
				class="px-3 py-1 border border-zszh-300 rounded text-sm disabled:opacity-50"
				disabled={result.page <= 1}
				onclick={() => onPage(result.page - 1)}
			>
				← Zurück
			</button>
			<span class="px-3 py-1 text-sm text-zszh-700">{result.page} / {totalPages.toLocaleString("de-CH")}</span>
			<button
				type="button"
				class="px-3 py-1 border border-zszh-300 rounded text-sm disabled:opacity-50"
				disabled={result.page >= totalPages}
				onclick={() => onPage(result.page + 1)}
			>
				Weiter →
			</button>
		</nav>
	{/if}
{/if}
