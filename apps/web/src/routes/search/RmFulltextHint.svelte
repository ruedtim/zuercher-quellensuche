<script lang="ts">
	// Hinweis auf den Volltext der Ratsmanuale zu den Namensfiltern (lib/server/rmNames.ts): die
	// Filter finden RM über die vereinheitlichten Namen (Personen mit Vor- und Nachnamen, Orte aus
	// dem Ortsverzeichnis), der Volltext auch die übrigen Schreibungen. Gestreamt, erscheint erst,
	// wenn die Zählung da ist; ohne Treffer nichts.
	import type { RmFulltextHint } from "$lib/rmNames";

	let { hints }: { hints: Promise<RmFulltextHint[]> | null } = $props();

	const n = (x: number) => x.toLocaleString("de-CH");
	const span = (r: { from: number | null; to: number | null }) =>
		r.from != null && r.to != null ? `${r.from}–${r.to}` : r.from != null ? `ab ${r.from}` : `bis ${r.to}`;
</script>

{#if hints}
	{#await hints then list}
		{#if list.length > 0}
			<div class="mb-4 rounded-md border border-dashed border-zszh-300 bg-zszh-50 px-3 py-2 text-sm text-zszh-700">
				<p class="font-medium text-zszh-800">
					Im Volltext der Ratsmanuale
					<span
						class="cursor-help text-zszh-500"
						title="Der Namensfilter findet die Ratsmanuale (1484–1798) über automatisch erkannte, vereinheitlichte Namen. Gesucht wird hier zusätzlich der Text mit den Schreibungen aus dem Register der Editionen – das sind Volltext-Treffer, nicht geprüfte Nennungen dieser Person bzw. dieses Ortes. Personen nur in der Zeit der Editionsstücke mit ihnen (± 10 Jahre), weil Vor- und Familiennamen sich wiederholen; Namensvettern bleiben möglich."
						>ⓘ</span
					>
				</p>
				<ul class="mt-1 space-y-0.5">
					{#each list as h (h.kind + h.value)}
						<li>
							«{h.variants[0]}»{#if h.variants.length > 1}{" "}<span class="text-zszh-600"
									>(auch {#each h.variants.slice(1) as v, i (v)}{i > 0 ? ", " : ""}«{v}»{/each})</span
								>{/if}
							{#if h.range}<span class="text-zszh-600">, {span(h.range)},</span>{/if}
							in <strong class="tabular-nums">{n(h.total)}</strong>
							{h.total === 1 ? "Sitzung" : "Sitzungen"} –
							<a href={h.href} class="text-zszh-800 underline hover:text-zszh-900">anzeigen</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/await}
{/if}
