<script lang="ts">
	// Startansicht des Reiters «Archivkatalog» ohne Suche und Filter (catalogShowsTree): der
	// Archivbaum ab der Wurzel, die Hauptabteilungen schon aufgeklappt, statt aller Einheiten
	// nach Datum. Ein Suchbegriff, ein Filter, ein Klick in die Zeitleiste oder «als Liste»
	// führen zur Trefferliste.
	import { CATALOG_IN_PROGRESS, CATALOG_ROOT_ID, type CatalogTreeStart } from "$lib/catalog";
	import CatalogTree from "$lib/components/CatalogTree.svelte";

	let { tree, total, onList }: { tree: CatalogTreeStart; total: number; onList: () => void } = $props();

	const nf = (n: number) => n.toLocaleString("de-CH");
</script>

<div class="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm text-zszh-700 mb-4">
	<div>
		<strong>Archivplan</strong> des Staatsarchivs ·
		<span class="tabular-nums">{nf(total)}</span>
		{total === 1 ? "Verzeichnungseinheit" : "Verzeichnungseinheiten"}
		{#if CATALOG_IN_PROGRESS}
			<span class="text-zszh-600">
				·
				<a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600"
					>Katalog noch im Aufbau</a
				>
			</span>
		{/if}
	</div>
	<button type="button" class="text-accent-600 underline hover:text-accent-700" onclick={onList}>
		Alle Einheiten als Liste nach Datum
	</button>
</div>

<div class="bg-white border border-zszh-200 rounded-md p-4">
	<CatalogTree parentId={CATALOG_ROOT_ID} initial={tree.root} expanded={tree.open} />
</div>
<p class="mt-3 text-xs text-zszh-600 leading-snug">
	Suchbegriff, Filter oder ein Klick in die Zeitleiste zeigen die passenden Einheiten als Trefferliste.
</p>
