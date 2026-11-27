<script lang="ts">
	// Reiter «Archivkatalog» der Dokumentseite: die Verzeichnungseinheit, die das Dokument
	// abbildet, im Archivplan-Kontext (Zentrale Serien über die Katalog-ID, Ratsmanuale über
	// die Sitzung), dazu eigene Einheiten, die per Weblink auf das Dokument verweisen.
	import CatalogContext from "$lib/components/CatalogContext.svelte";
	import {
		CATALOG_COMPLETE_BY,
		CATALOG_IN_PROGRESS,
		catalogPermalink,
		catalogUnitHref,
		formatCatalogDate,
		shortTreeName,
		treeNodeName,
		type DocumentCatalog,
	} from "$lib/catalog";

	let { catalog }: { catalog: DocumentCatalog } = $props();

	const known = $derived(new Set(catalog.known));
</script>

<div class="bg-white border border-zszh-200 rounded-md p-5 md:p-6 space-y-6">
	{#if catalog.unit}
		{@const unit = catalog.unit}
		<section aria-labelledby="katalogeintrag">
			<h2 id="katalogeintrag" class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Katalogeintrag</h2>
			<CatalogContext path={unit.path} {known} {unit} neighbors={null} unitHref={catalogUnitHref(unit.id)} />
			<p class="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
				<a href={catalogUnitHref(unit.id)} class="text-accent-600 underline hover:text-accent-700">Verzeichnungseinheit öffnen</a>
				<a href={catalogPermalink(unit.id)} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700"
					>Im Archivkatalog des Staatsarchivs ↗</a
				>
			</p>
		</section>
	{/if}

	{#if catalog.references.length > 0}
		<section aria-labelledby="katalogverweise">
			<h2 id="katalogverweise" class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-1">Verweise im Archivkatalog</h2>
			<p class="text-xs text-zszh-600 mb-2">Verzeichnungseinheiten, die per Weblink auf dieses Dokument verweisen.</p>
			<ul class="space-y-1.5 text-sm">
				{#each catalog.references as ref (ref.id)}
					{@const name = treeNodeName(ref)}
					<li>
						<a href={catalogUnitHref(ref.id)} title={shortTreeName(name) !== name ? name : undefined} class="text-zszh-900 hover:text-accent-600 hover:underline"
							>{shortTreeName(name)}</a
						>
						{#if ref.dateText}<span class="text-zszh-600 whitespace-nowrap">· {formatCatalogDate(ref.dateText)}</span>{/if}
						{#if ref.level}<span class="text-xs text-zszh-500">{ref.level}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p class="text-xs text-zszh-500">
		Beschreibung aus dem Online-Archivkatalog des Staatsarchivs Zürich.
		{#if CATALOG_IN_PROGRESS}
			<a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600"
				>Katalog noch im Aufbau</a
			>, vollständig {CATALOG_COMPLETE_BY}.
		{/if}
	</p>
</div>
