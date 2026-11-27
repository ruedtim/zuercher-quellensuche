<script lang="ts">
	import { type SearchHit } from "$lib/types";
	import { oldStyleSuffix } from "$lib/format";

	let { id }: { id: string } = $props();
	let hits = $state<SearchHit[] | null>(null);
	let note = $state<string | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		loading = true;
		error = null;
		note = null;
		fetch(`/api/similar/${encodeURIComponent(id)}?limit=10`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((data: { hits: SearchHit[]; note?: string }) => {
				hits = data.hits;
				note = data.note ?? null;
				loading = false;
			})
			.catch((err) => {
				error = String(err);
				loading = false;
			});
	});
</script>

<div class="bg-white border border-zszh-200 rounded-md p-4">
	{#if loading}
		<div class="text-zszh-600 italic">Ähnliche Dokumente werden geladen …</div>
	{:else if error}
		<div class="bg-yellow-50 border border-yellow-200 text-yellow-900 px-3 py-2 rounded">
			Konnte ähnliche Dokumente nicht laden ({error}). Embed-Service evtl. nicht erreichbar.
		</div>
	{:else if note}
		<div class="bg-yellow-50 border border-yellow-200 text-yellow-900 px-3 py-2 rounded">
			{note}
		</div>
	{:else if hits && hits.length === 0}
		<div class="text-zszh-600 italic">Keine ähnlichen Dokumente gefunden.</div>
	{:else if hits}
		<ul class="space-y-3">
			{#each hits as hit (hit.id)}
				<li class="border-b border-zszh-100 pb-3 last:border-0 last:pb-0">
					<a
						href={`/documents/${hit.series}/${hit.id}`}
						class="block hover:bg-zszh-50 -mx-2 px-2 py-2 rounded"
					>
						<div class="flex items-baseline gap-2 text-xs text-zszh-600">
							<span class="badge-code">{hit.series}</span>
							{#if hit.date}<time>{hit.date}{oldStyleSuffix(hit.series, hit.date)}</time>{/if}
							{#if hit.stazhIdent}<span class="text-zszh-600 truncate">· {hit.stazhIdent}</span>{/if}
							{#if hit._rankingScore !== undefined}
								<span class="text-zszh-400 ml-auto tabular-nums">{hit._rankingScore.toFixed(2)}</span>
							{/if}
						</div>
						<h4 class="font-serif text-zszh-900 mt-1 leading-tight">{hit.title}</h4>
						{#if hit._formatted?.body}
							<p class="text-sm text-zszh-600 mt-1 leading-snug line-clamp-2">
								{hit._formatted.body}…
							</p>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
