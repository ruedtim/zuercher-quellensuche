<script lang="ts">
	// Karte beim Namen im Protokolltext für Rats- und Regierungsmitglieder aus der
	// Kantonsratsdatenbank: Zuordnung über die Schreibung im Text (lib/server/krdb.ts),
	// Verhalten der Karte in PersonMentions.svelte.
	import KrdbCredit from "$lib/components/KrdbCredit.svelte";
	import KrdbPortrait from "$lib/components/KrdbPortrait.svelte";
	import PersonMentions from "./PersonMentions.svelte";
	import type { PageProps } from "./$types";

	type Person = PageProps["data"]["krdbPersons"][number];

	let {
		container,
		html,
		persons,
		active,
		onShowAll,
		onMarked,
	}: {
		container: HTMLElement | null;
		html: string | null;
		persons: Person[];
		active: boolean;
		onShowAll: () => void;
		onMarked: (ids: Set<number>) => void;
	} = $props();

	let inner = $state<{ reveal: (id: number) => void }>();

	/** Tab «Personen» → «im Text». */
	export function reveal(id: number) {
		inner?.reveal(id);
	}

	function searchHref(form: string): string {
		const params = new URLSearchParams();
		params.append("persons", form);
		params.set("view", "documents");
		return `/search?${params.toString()}`;
	}
</script>

{#snippet entry(p: Person)}
	<KrdbPortrait person={p} size="card" />
	<div class="min-w-0 leading-snug">
		<div class="font-medium text-zszh-900">{p.name}</div>
		{#if p.lifespan}<div class="text-xs text-zszh-500">{p.lifespan}</div>{/if}
		{#if p.role}<div class="text-xs text-zszh-600">{p.role}</div>{/if}
		<div class="mt-0.5 flex flex-wrap gap-x-2 text-xs leading-6">
			{#if p.wikidataUrl}
				<a href={p.wikidataUrl} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
					Wikidata<span class="sr-only"> zu {p.name}</span></a
				>
			{/if}
			<a href={p.krdbUrl} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
				Kantonsratsdatenbank<span class="sr-only"> zu {p.name}</span></a
			>
			{#if p.pageHref}
				<a href={p.pageHref} class="text-accent-600 underline hover:text-accent-700">
					Alle Dokumente{#if p.docCount} ({p.docCount.toLocaleString("de-CH")}){/if}<span class="sr-only"> von {p.name}</span></a
				>
			{/if}
		</div>
		{#if p.portrait}<KrdbCredit portrait={p.portrait} />{/if}
	</div>
{/snippet}

<PersonMentions
	bind:this={inner}
	{container}
	{html}
	{persons}
	{active}
	{entry}
	{searchHref}
	note="Automatisch zugeordnet"
	showAllLabel="Alle Personen"
	{onShowAll}
	{onMarked}
/>
