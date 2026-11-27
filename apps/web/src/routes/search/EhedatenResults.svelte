<script lang="ts">
	// Trefferliste des Reiters «Ehedaten»: kompakte Tabelle (Datum, Bräutigam, Braut,
	// Kirchgemeinde, Signatur), auf dem Handy als Karten. Jeder Eintrag führt auf die Seite
	// seiner Katalog-Einheit (/archivkatalog/<ID>, mit Ehe-Karte und ?from= für «Zurück zur
	// Trefferliste»). Namen, Herkunft und Zusatzinfo kommen serverseitig maskiert.
	import { onMount } from "svelte";
	import { catalogUnitHref } from "$lib/catalog";
	import {
		ART_LABEL,
		EHEDATEN_AS_OF,
		EHEDATEN_ATTRIBUTION,
		EHEDATEN_LICENSE,
		EHEDATEN_LICENSE_URL,
		EHEDATEN_SOURCE_URL,
		ehedatenDateLabel,
		isJulian,
		type EhedatenHit,
		type EhedatenResult,
	} from "$lib/ehedaten";
	import type { SearchParams } from "$lib/types";
	import ListEnd from "./ListEnd.svelte";

	let {
		result,
		sort,
		hasQuery,
		contextSearch,
		onSort,
		onPage,
	}: {
		result: EhedatenResult;
		sort: SearchParams["sort"];
		hasQuery: boolean;
		/** Querystring der aktuellen Suche (ohne ask) für den Rückweg vom Eintrag. */
		contextSearch: string;
		onSort: (sort: SearchParams["sort"]) => void;
		onPage: (page: number) => void;
	} = $props();

	const nf = (n: number) => n.toLocaleString("de-CH");
	const entryHref = (id: number) => `${catalogUnitHref(id)}${contextSearch ? `?from=${encodeURIComponent(contextSearch)}` : ""}`;
	// Grosse Listen enden am browseLimit (die Zahl zählt alle).
	const browsable = $derived(Math.min(result.total, result.browseLimit ?? Number.POSITIVE_INFINITY));
	const totalPages = $derived(Math.max(1, Math.ceil(browsable / result.pageSize)));
	const signatur = (h: EhedatenHit) => [h.signatur, h.seite].filter(Boolean).join(", ");
	// «Zurück zur Trefferliste» springt zu #ehe-<id> (Tabellenzeile); auf dem Handy ist die
	// Tabelle ausgeblendet, dann zur Karte desselben Eintrags.
	onMount(() => {
		const m = /^#ehe-(\d+)$/.exec(location.hash);
		const row = m ? document.getElementById(`ehe-${m[1]}`) : null;
		if (m && row && row.offsetParent === null) document.querySelector(`[data-ehe="${m[1]}"]`)?.scrollIntoView();
	});

	// Zweite Zeile der Datumsspalte: alter Stil und Verkündung (hält die Spalte schmal).
	const dateNote = (h: EhedatenHit) => [isJulian(h) ? "a. St." : "", h.art === "verkuendung" ? ART_LABEL.verkuendung : ""].filter(Boolean).join(" · ");
</script>

{#snippet person(name: string, herkunft: string, zusatz: string)}
	<span class="font-medium text-zszh-900 kwic">{@html name}</span>{#if herkunft}<span class="text-zszh-600 kwic">, {@html herkunft}</span>{/if}
	{#if zusatz}
		<span class="block text-xs text-zszh-600 leading-snug line-clamp-2 kwic" title="Zusatzinfo">{@html zusatz}</span>
	{/if}
{/snippet}

<div class="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm text-zszh-700 mb-4">
	<div>
		<strong class="tabular-nums">{nf(result.total)}</strong>
		{result.total === 1 ? "Eheeintrag" : "Eheeinträge"}
		{#if result.browseLimit != null}
			<span
				title="Durchblättern lassen sich die ersten {nf(result.browseLimit)} Einträge der Liste – die Zahl zählt alle. Mit engeren Filtern, etwa einem Zeitraum oder einer Kirchgemeinde, sind auch die übrigen erreichbar."
				>(davon {nf(result.browseLimit)} durchblätterbar)</span
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
				{#if hasQuery}
					<option value="relevance">Relevanz</option>
				{/if}
				<option value="date_asc">Datum aufsteigend</option>
				<option value="date_desc">Datum absteigend</option>
			</select>
		</label>
	</div>
</div>

{#if result.hits.length === 0 && result.total > 0 && result.page > totalPages}
	<ListEnd lastPage={totalPages} {onPage} />
{:else if result.hits.length === 0}
	<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
		Keine Eheeinträge gefunden. Versuche es mit anderen Namen oder weniger Filtern – Namen gelten mit allen Wörtern.
	</div>
{:else}
	<!-- Ab sm eine Tabelle, darunter Karten (gleiche Angaben, untereinander). -->
	<div class="hidden sm:block overflow-x-auto bg-white border border-zszh-200 rounded-md">
		<table class="w-full text-sm">
			<thead class="text-xs uppercase tracking-wider text-zszh-600 text-left border-b border-zszh-200">
				<tr>
					<th scope="col" class="px-3 py-2 font-semibold">Datum</th>
					<th scope="col" class="px-3 py-2 font-semibold">Bräutigam</th>
					<th scope="col" class="px-3 py-2 font-semibold">Braut</th>
					<th scope="col" class="px-3 py-2 font-semibold">Kirchgemeinde</th>
					<th scope="col" class="px-3 py-2 font-semibold">Signatur</th>
				</tr>
			</thead>
			<tbody>
				{#each result.hits as hit (hit.id)}
					<tr id={`ehe-${hit.id}`} class="border-b border-zszh-100 last:border-b-0 align-top hover:bg-zszh-50 scroll-mt-4">
						<td class="px-3 py-2 whitespace-nowrap tabular-nums">
							<a href={entryHref(hit.id)} class="text-accent-700 hover:underline">{hit.datum}</a>
							{#if dateNote(hit)}
								<span class="block text-xs text-zszh-600" title={isJulian(hit) ? "alter Stil: julianischer Kalender (Zürich bis 1700)" : undefined}
									>{dateNote(hit)}</span
								>
							{/if}
						</td>
						<td class="px-3 py-2 min-w-[9rem]">{@render person(hit.html.mannName, hit.html.mannHerkunft, hit.html.mannZusatz)}</td>
						<td class="px-3 py-2 min-w-[9rem]">{@render person(hit.html.frauName, hit.html.frauHerkunft, hit.html.frauZusatz)}</td>
						<td class="px-3 py-2">{hit.kirchgemeinde}</td>
						<td class="px-3 py-2 text-xs text-zszh-600 min-w-[7rem]">
							<a href={entryHref(hit.id)} class="hover:underline hover:text-accent-700">{signatur(hit)}</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<ul class="sm:hidden">
		{#each result.hits as hit (hit.id)}
			<li data-ehe={hit.id} class="hit-row scroll-mt-4">
				<div class="py-3">
					<div class="flex flex-wrap items-baseline gap-x-2 text-xs text-zszh-600 mb-1">
						<span class="tabular-nums font-medium text-zszh-800">{ehedatenDateLabel(hit)}</span>
						{#if hit.art === "verkuendung"}<span>· {ART_LABEL.verkuendung}</span>{/if}
						<span>· {hit.kirchgemeinde}</span>
					</div>
					<a href={entryHref(hit.id)} class="hit-link block">
						<span class="block text-sm leading-snug">{@render person(hit.html.mannName, hit.html.mannHerkunft, hit.html.mannZusatz)}</span>
						<span class="block text-sm leading-snug mt-1">
							<span class="text-zszh-500" aria-hidden="true">⚭</span><span class="sr-only">getraut mit</span>
							{@render person(hit.html.frauName, hit.html.frauHerkunft, hit.html.frauZusatz)}
						</span>
					</a>
					<p class="text-xs text-zszh-600 mt-1 break-words">{signatur(hit)}</p>
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

<p class="mt-6 text-xs text-zszh-600 leading-snug">
	Daten: {EHEDATEN_ATTRIBUTION}, aus dem
	<a href={EHEDATEN_SOURCE_URL} target="_blank" rel="noopener external" class="underline decoration-dotted underline-offset-2 hover:text-accent-600"
		>Online-Archivkatalog</a
	>
	(Stand {EHEDATEN_AS_OF}),
	<a href={EHEDATEN_LICENSE_URL} target="_blank" rel="noopener license" class="underline decoration-dotted underline-offset-2 hover:text-accent-600"
		>{EHEDATEN_LICENSE}</a
	>. Namen vereinheitlicht, Daten bis 1700 im alten Stil.
	<a href="/about/ehedaten" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Mehr zu den Ehedaten</a>
</p>
