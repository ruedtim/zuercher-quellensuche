<script lang="ts">
	// Querverweise auf Editionen des Staatsarchivs (QZH, Zürcher Rechtsquellen) auf Katalog-
	// und Ratsmanual-Seiten: «Ediert in QZH: QZH_401» bzw. «Rechtsquellen: SSRQ ZH NF II/3
	// Nr. 40» mit Link auf das Stück; bei Ratsmanual-Sitzungen mit dem Titel des Stücks
	// (welcher Eintrag der Sitzung ediert ist). Liegt das Stück im Reiter «Editionen» der
	// Plattform (`own`), führt der Verweis dorthin und der Permalink der Edition steht daneben.
	// Darunter Nennung und Lizenz je Edition – die Editionen tragen CC-Lizenzen, nicht die
	// Public Domain Mark der Plattform.
	import { EDITIONS, editionsOf, type EditionLink } from "$lib/editions";

	let { links }: { links: EditionLink[] } = $props();

	const editions = $derived(editionsOf(links));
</script>

{#if links.length > 0}
	<div class="text-xs text-zszh-700 space-y-1">
		<ul class="space-y-0.5">
			{#each links as link (link.id)}
				<li class="leading-snug">
					<span class="text-zszh-500">{EDITIONS[link.edition].heading}:</span>
					{#if link.own}
						<a href={link.own} class="text-accent-600 underline font-medium">{link.label}</a>
						<a href={link.url} target="_blank" rel="noopener external" class="text-zszh-600 hover:text-accent-600 underline"
							>in der Edition ↗</a
						>
					{:else}
						<a href={link.url} target="_blank" rel="noopener external" class="text-accent-600 underline font-medium">{link.label} ↗</a>
					{/if}
					{#if link.witness}
						<span
							class="text-zszh-600"
							title="Das Stück ist aus einer anderen Vorlage ediert; die Edition führt diese als weitere Überlieferung."
							>(weitere Überlieferung)</span
						>
					{/if}
					{#if link.title}<span class="text-zszh-800">– {link.title}</span>{/if}
				</li>
			{/each}
		</ul>
		<p class="text-zszh-500 leading-snug">
			{#each editions as key, i (key)}
				{#if i > 0}<span aria-hidden="true"> · </span>{/if}
				<span>
					Edition: {EDITIONS[key].attribution},
					<a href={EDITIONS[key].licenseUrl} target="_blank" rel="noopener license" class="underline">{EDITIONS[key].license}</a>
				</span>
			{/each}
		</p>
	</div>
{/if}
