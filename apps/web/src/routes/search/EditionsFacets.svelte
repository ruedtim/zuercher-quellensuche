<script lang="ts">
	// Eigene Filter des Reiters «Editionen»: Edition (zuerst, Plan E4: ein Reiter für alle
	// Editionen), Teil der Edition, Schlagwort, Faksimile. Suchbegriff, Thema, Zeitraum sowie
	// Personen, Orte und Organisationen stehen in der gemeinsamen Filterspalte
	// (Facets.svelte), die alle Reiter teilen; dieser Block steht dort ausserhalb der
	// «Erweiterten Suchoptionen», also immer sichtbar.
	import { EDITIONS, type EditionKey } from "$lib/editions";
	import { topFacet, type EditionsFacetCounts, type EditionsFilterValues } from "$lib/editionTexts";

	let {
		filters,
		facets,
		onApply,
	}: {
		filters: EditionsFilterValues;
		facets: EditionsFacetCounts;
		onApply: (patch: Partial<EditionsFilterValues>) => void;
	} = $props();

	const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
	const nf = (n: number) => n.toLocaleString("de-CH");

	const editions = $derived(topFacet(facets.edition, filters.edition, 20));
	const parts = $derived(topFacet(facets.part, filters.part, 20));
	// Schlagwörter: die häufigsten, auf Wunsch alle.
	const KEYWORDS_SHORT = 12;
	let allKeywords = $state(false);
	const keywords = $derived(topFacet(facets.keywords, filters.keyword, allKeywords ? 500 : KEYWORDS_SHORT));
	const keywordCount = $derived(Object.keys(facets.keywords).length);
	const withFacs = $derived(facets.hasFacsimile.true ?? 0);
</script>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Edition</h3>
	<ul class="space-y-1.5">
		{#each editions as e (e.value)}
			{@const info = EDITIONS[e.value as EditionKey]}
			<li>
				<label class="flex items-start gap-2 text-sm cursor-pointer hover:text-accent-600">
					<input
						type="checkbox"
						class="accent-accent-500 mt-1"
						checked={filters.edition.includes(e.value as EditionKey)}
						onchange={() => onApply({ edition: toggle(filters.edition, e.value as EditionKey) })}
					/>
					<span class="flex-1 leading-snug">{info ? `${info.name} (${info.short})` : e.value}</span>
					<span class="text-xs text-zszh-600 tabular-nums mt-0.5">{nf(e.count)}</span>
				</label>
			</li>
		{/each}
	</ul>
	<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
		Weitere Editionen des Staatsarchivs folgen. <a href="/about/editionen" class="underline decoration-dotted underline-offset-2 hover:text-accent-600"
			>Über die Editionen</a
		>
	</p>
</section>

{#if parts.length > 1 || filters.part.length > 0}
	<section>
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Teil der Edition, Band</h3>
		<ul class="space-y-1.5">
			{#each parts as p (p.value)}
				<li>
					<label class="flex items-start gap-2 text-sm cursor-pointer hover:text-accent-600">
						<input
							type="checkbox"
							class="accent-accent-500 mt-1"
							checked={filters.part.includes(p.value)}
							onchange={() => onApply({ part: toggle(filters.part, p.value) })}
						/>
						<span class="flex-1 leading-snug">{p.value}</span>
						<span class="text-xs text-zszh-600 tabular-nums mt-0.5">{nf(p.count)}</span>
					</label>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if keywords.length > 0}
	<section>
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Schlagwort</h3>
		<ul class="space-y-1.5">
			{#each keywords as k (k.value)}
				<li>
					<label class="flex items-start gap-2 text-sm cursor-pointer hover:text-accent-600">
						<input
							type="checkbox"
							class="accent-accent-500 mt-1"
							checked={filters.keyword.includes(k.value)}
							onchange={() => onApply({ keyword: toggle(filters.keyword, k.value) })}
						/>
						<span class="flex-1 leading-snug">{k.value}</span>
						<span class="text-xs text-zszh-600 tabular-nums mt-0.5">{nf(k.count)}</span>
					</label>
				</li>
			{/each}
		</ul>
		{#if keywordCount > KEYWORDS_SHORT}
			<button type="button" class="mt-1.5 text-xs text-accent-600 hover:underline" onclick={() => (allKeywords = !allKeywords)}>
				{allKeywords ? "weniger" : `alle ${nf(keywordCount)} Schlagwörter`}
			</button>
		{/if}
		<p class="text-xs text-zszh-600 mt-1.5 leading-snug">Schlagwörter der Edition (Taxonomie der Rechtsquellenstiftung); mehrere gelten als oder.</p>
	</section>
{/if}

<section>
	<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
		<input type="checkbox" class="accent-accent-500" checked={filters.facs} onchange={() => onApply({ facs: !filters.facs })} />
		<span class="flex-1">nur mit Faksimile</span>
		<span class="text-xs text-zszh-600 tabular-nums">{nf(withFacs)}</span>
	</label>
</section>
