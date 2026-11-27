<script lang="ts">
	// Text eines Katalogfelds mit seinen Verweisen. Lange Texte (Bestandsgeschichte,
	// Geschichte des Aktenbildners: bis über 20'000 Zeichen) stehen zuerst gekürzt da,
	// damit Untereinheiten und Zitiervorschlag erreichbar bleiben.
	import type { CatalogFieldLine } from "$lib/catalog";

	let { lines, long }: { lines: CatalogFieldLine[]; long: boolean } = $props();
	let expanded = $state(false);
</script>

<div class={long && !expanded ? "line-clamp-12" : ""}>
	{#each lines as line, i (i)}
		{#if i > 0}<br />{/if}
		{#if line.href && line.external}
			<a href={line.href} target="_blank" rel="noopener" class="text-accent-700 hover:underline">{line.text} ↗</a>
		{:else if line.href}
			<a href={line.href} class="text-accent-700 hover:underline">{line.text}</a>
		{:else if line.note}
			{line.text} <span class="text-zszh-500">({line.note})</span>
		{:else}
			{line.text}
		{/if}
	{/each}
</div>
{#if long}
	<button type="button" class="mt-1 text-xs text-accent-600 underline hover:text-accent-700 no-print" onclick={() => (expanded = !expanded)}>
		{expanded ? "Weniger anzeigen" : "Ganzen Text anzeigen"}
	</button>
{/if}
