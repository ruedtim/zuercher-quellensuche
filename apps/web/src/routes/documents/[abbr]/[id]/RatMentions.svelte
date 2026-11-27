<script lang="ts">
	// Karte beim Namen im Text einer Ratsmanual-Sitzung: Personen, die in der Transkription
	// mit Normdaten ausgezeichnet sind (meist der Vorsitz im Sitzungskopf, «Prnt. Herr Holtzhalb»).
	// Zuordnung exakt über `data-gnd` bzw. `data-ssrq` (Indexer, aus `persName/@ref`) und das
	// Register des Kleinen Rats (lib/server/rat.ts `ratMentionsFor`). Wen das Register nicht
	// kennt, der bekommt eine Karte mit der Schreibung im Text und den Normdaten allein.
	// Verhalten der Karte in PersonMentions.svelte.
	import PersonMentions from "./PersonMentions.svelte";
	import type { PageProps } from "./$types";

	type Person = PageProps["data"]["ratMentions"][number];

	let {
		container,
		html,
		persons,
		active,
		searchHref,
		onShowAll,
		onMarked,
	}: {
		container: HTMLElement | null;
		html: string | null;
		persons: Person[];
		active: boolean;
		/** Phrasensuche in den Ratsmanualen, wie ein Klick auf einen anderen Namen. */
		searchHref: (form: string) => string | null;
		/** Reiter «Rat» öffnen; fehlt, wo der Band keinen Halbjahresrat nennt. */
		onShowAll?: () => void;
		onMarked: (ids: Set<number>) => void;
	} = $props();

	let inner = $state<{ reveal: (id: number) => void }>();

	/** Reiter «Rat» → «im Text». */
	export function reveal(id: number) {
		inner?.reveal(id);
	}

	const link = "text-accent-600 underline hover:text-accent-700";
</script>

{#snippet entry(p: Person, form: string)}
	{@const name = p.name || form}
	<div class="min-w-0 leading-snug">
		<div class="font-medium text-zszh-900">{name}</div>
		{#if p.lifespan}<div class="text-xs text-zszh-500 tabular-nums">{p.lifespan}</div>{/if}
		{#if p.role}<div class="text-xs text-zszh-600">{p.role}</div>{/if}
		{#if !p.pageHref}<div class="text-xs text-zszh-600">Nicht im Register des Kleinen Rats</div>{/if}
		<div class="mt-0.5 flex flex-wrap gap-x-2 text-xs leading-6">
			{#if p.pageHref}
				<a href={p.pageHref} class={link}>Personenseite<span class="sr-only"> von {name}</span></a>
			{/if}
			{#if p.gndUrl}
				<a href={p.gndUrl} target="_blank" rel="noopener external" class={link}>GND<span class="sr-only"> zu {name}</span></a>
			{/if}
			{#if p.hlsUrl}
				<a href={p.hlsUrl} target="_blank" rel="noopener external" class={link}>HLS<span class="sr-only"> zu {name}</span></a>
			{/if}
			{#if p.ssrqUrl}
				<a
					href={p.ssrqUrl}
					target="_blank"
					rel="noopener external"
					class={link}
					title="Personendatenbank der Sammlung Schweizerischer Rechtsquellen">SSRQ<span class="sr-only"> zu {name}</span></a
				>
			{/if}
		</div>
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
	note="In der Transkription mit Normdaten ausgezeichnet"
	showAllLabel={onShowAll ? "Rat dieses Halbjahrs" : undefined}
	{onShowAll}
	{onMarked}
/>
