<script lang="ts">
	// Render-Komponente für die q-Token-Chips unter dem Suchbegriff-Feld. Die
	// Daten (inkl. remove-Closures) kommen aus Facets.svelte; hier nur
	// Darstellung. kind steuert das Styling (normal / exakt / ausschliessen).
	export type ChipKind = "term" | "phrase" | "exclude";
	export interface FilterChip {
		label: string;
		kind: ChipKind;
		remove: () => void;
	}

	let { chips, class: className = "" }: { chips: FilterChip[]; class?: string } = $props();

	const CHIP_BASE = "inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 border rounded-sm text-xs";
	function chipClass(kind: ChipKind): string {
		if (kind === "exclude") return `${CHIP_BASE} bg-red-50 border-red-200 text-red-800`;
		if (kind === "phrase") return `${CHIP_BASE} bg-zszh-100 border-accent-500 text-zszh-700 italic`;
		return `${CHIP_BASE} bg-zszh-100 border-zszh-200 text-zszh-700`;
	}
</script>

{#if chips.length > 0}
	<div class="flex-wrap items-center gap-1.5 {className}">
		<!-- Index-Key: identische Begriffe («hund hund») sind erlaubt – ein
		     Label-Key würde dann mit each_key_duplicate crashen. -->
		{#each chips as chip, i (i)}
			<span class={chipClass(chip.kind)}>
				{chip.label}
				<button
					type="button"
					onclick={chip.remove}
					aria-label={`Suchbegriff entfernen: ${chip.label}`}
					title={`Suchbegriff entfernen: ${chip.label}`}
					class="hover:text-accent-600 text-sm leading-none {chip.kind === 'exclude' ? 'text-red-500' : 'text-zszh-500'}"
				>
					×
				</button>
			</span>
		{/each}
	</div>
{/if}
