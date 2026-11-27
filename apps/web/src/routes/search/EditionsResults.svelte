<script lang="ts">
	// Trefferliste des Reiters «Editionen»: jedes Stück führt auf seine Detailseite
	// (/editionen/<edition>/<id>, mit ?from= für «Zurück zur Trefferliste»), der Permalink
	// der Edition steht dort. Titel und Auszug kommen serverseitig maskiert; der Auszug zeigt
	// den Suchtext (frühneuhochdeutsche Zeichen vereinheitlicht wie in der Suche).
	import { editionDateLabel, editionLabel, editionShort, editionUnitPath, type EditionsResult } from "$lib/editionTexts";
	import type { SearchParams } from "$lib/types";

	let {
		result,
		sort,
		hasQuery,
		themed = false,
		contextSearch,
		onSort,
		onPage,
	}: {
		result: EditionsResult;
		sort: SearchParams["sort"];
		hasQuery: boolean;
		/** Ein Thema ist gesetzt und der Index kann es reihen (Vektoren, Embed-Service). */
		themed?: boolean;
		contextSearch: string;
		onSort: (sort: SearchParams["sort"]) => void;
		onPage: (page: number) => void;
	} = $props();

	const unitHref = (edition: string, localId: string, pos: number) =>
		`${editionUnitPath(edition, localId)}?${new URLSearchParams({ ...(contextSearch ? { from: contextSearch } : {}), pos: String(pos) })}`;

	const nf = (n: number) => n.toLocaleString("de-CH");
	const units = (n: number) => (n === 1 ? "Stück" : "Stücke");
	const browsable = $derived(Math.min(result.total, result.theme?.rankedPool ?? Number.POSITIVE_INFINITY));
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
			<span title="Mit einem Thema werden die {nf(result.theme.rankedPool)} relevantesten Stücke thematisch gereiht und sind durchblätterbar – die Zahl zählt alle."
				>(davon {nf(result.theme.rankedPool)} durchblätterbar)</span
			>
		{/if}
		<span class="text-zszh-600">in {result.processingTimeMs} ms</span>
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
				<span class="tabular-nums">{result.page} / {nf(totalPages)}</span>
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
	<p class="text-xs text-zszh-600 mb-3 leading-snug">Das Thema reiht diese Auswahl nicht: Keines der Stücke hat einen Vektor.</p>
{/if}

{#if result.hits.length === 0}
	<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
		Keine Stücke gefunden. Versuche es mit anderen Suchbegriffen oder weniger Filtern – der Quellentext ist frühneuhochdeutsch
		(«töuffer», «zů»), Titel, Regest und Kommentar sind modernes Deutsch.
	</div>
{:else}
	<ul>
		{#each result.hits as hit, i (hit.id)}
			{@const date = editionDateLabel(hit.isoFrom, hit.isoTo)}
			<li class="hit-row">
				<div class="pt-3.5 pb-5">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
						<span class="badge-code" title={hit.part}>{editionShort(hit.edition)}</span>
						<span class="text-xs text-zszh-600 {hit.edition === 'qzh' ? 'font-mono' : ''}">{editionLabel(hit)}</span>
						{#if date}<time class="text-xs text-zszh-600" datetime={hit.isoFrom ?? undefined}>{date}</time>{/if}
						{#if hit.signature}<span class="text-xs text-zszh-600">· {hit.signature}</span>{/if}
						{#if hit.hasFacsimile}<span class="text-xs text-accent-700">· Faksimile</span>{/if}
					</div>
					<h3 class="font-serif text-lg font-semibold text-zszh-900 leading-tight kwic">
						<a href={unitHref(hit.edition, hit.localId, (result.page - 1) * result.pageSize + i)} class="hit-link">{@html hit.titleHtml}</a>
					</h3>
					{#if hit.textHtml}
						<p class="text-sm text-zszh-700 mt-2 leading-relaxed kwic">{@html hit.textHtml}</p>
					{/if}
					<p class="text-xs text-zszh-600 mt-2">
						{hit.part}{#if hit.keywords.length > 0}<span class="text-zszh-400">{" · "}</span>{hit.keywords.slice(0, 4).join(", ")}{/if}
					</p>
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
			<span class="px-3 py-1 text-sm text-zszh-700">{result.page} / {nf(totalPages)}</span>
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
