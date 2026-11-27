<!--
	Vorschlagsliste der Filter-Felder (Facet-, Ehedaten- und Bestand-Combobox): Rollen und Ansagen
	für Screenreader an einer Stelle. Das Eingabefeld (role="combobox") bleibt fokussiert und zeigt
	mit aria-activedescendant auf die aktive Zeile (`comboboxOptionId`). Eine Liste gibt es nur mit
	Vorschlägen; «Lade …» und «keine Werte» stehen als Text daneben. Die Zahl der Vorschläge sagt
	eine Statuszeile an, die immer im Dokument steht.
-->
<script lang="ts" module>
	export const comboboxOptionId = (listId: string, i: number): string => `${listId}-${i}`;
</script>

<script lang="ts">
	import type { Snippet } from "svelte";

	type Suggestion = { value: string; count: number };

	let {
		id,
		label,
		open,
		loading,
		suggestions,
		activeIdx,
		onPick,
		isSelected,
		empty = "Keine Werte",
		check = true,
		itemClass = "items-center",
		listClass = "max-h-60",
		row,
	}: {
		id: string;
		label: string;
		open: boolean;
		loading: boolean;
		suggestions: Suggestion[];
		activeIdx: number;
		onPick: (value: string) => void;
		isSelected: (value: string) => boolean;
		empty?: string;
		/** Häkchen vor dem Wert (Mehrfachauswahl, die in der Liste sichtbar bleibt). */
		check?: boolean;
		itemClass?: string;
		listClass?: string;
		/** Eigene Darstellung des Werts (Bestand: Name und Datum). */
		row?: Snippet<[Suggestion]>;
	} = $props();

	const hasList = $derived(open && suggestions.length > 0);
	const status = $derived(
		!open || loading
			? ""
			: suggestions.length === 0
				? empty
				: suggestions.length === 1
					? "1 Vorschlag"
					: `${suggestions.length} Vorschläge`,
	);

	let listEl = $state<HTMLUListElement | null>(null);
	// Aktive Zeile in der Liste sichtbar halten (nur die Liste rollen, nicht die Seite).
	$effect(() => {
		const option = listEl?.children[activeIdx] as HTMLElement | undefined;
		if (!listEl || !option) return;
		const top = option.offsetTop;
		const bottom = top + option.offsetHeight;
		if (top < listEl.scrollTop) listEl.scrollTop = top;
		else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight;
	});
</script>

<span class="sr-only" role="status">{status}</span>

{#if hasList}
	<ul
		{id}
		bind:this={listEl}
		role="listbox"
		aria-label={`Vorschläge: ${label}`}
		aria-multiselectable="true"
		class="absolute z-10 left-0 right-0 top-full mt-1 overflow-y-auto bg-white border border-zszh-200 rounded shadow-lg {listClass}"
	>
		{#each suggestions as s, i (s.value)}
			{@const checked = isSelected(s.value)}
			<li
				id={comboboxOptionId(id, i)}
				role="option"
				tabindex="-1"
				aria-selected={checked}
				class="w-full flex {itemClass} gap-2 px-2 py-1 text-sm text-left cursor-pointer hover:bg-zszh-100"
				class:bg-zszh-100={i === activeIdx}
				onmousedown={(e) => {
					e.preventDefault();
					onPick(s.value);
				}}
			>
				{#if check}
					<span
						aria-hidden="true"
						class="flex-shrink-0 w-3.5 h-3.5 border rounded-sm text-[0.65rem] leading-[0.75rem] text-center {checked
							? 'bg-accent-500 border-accent-500 text-white'
							: 'border-zszh-300'}">{checked ? "✓" : ""}</span
					>
				{/if}
				{#if row}
					{@render row(s)}
				{:else}
					<span class="flex-1 min-w-0 truncate" title={s.value}>{s.value}</span>
				{/if}
				<span class="text-xs text-zszh-600 tabular-nums flex-shrink-0"
					>{s.count.toLocaleString("de-CH")}<span class="sr-only">&nbsp;Treffer</span></span
				>
			</li>
		{/each}
	</ul>
{:else if open}
	<!-- Für Screenreader sagt es die Statuszeile. -->
	<div
		aria-hidden="true"
		class="absolute z-10 left-0 right-0 top-full mt-1 px-2 py-1 text-xs text-zszh-600 bg-white border border-zszh-200 rounded shadow-lg"
	>
		{loading ? "Lade …" : empty}
	</div>
{/if}
