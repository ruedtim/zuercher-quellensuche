<script lang="ts">
	import { onMount } from "svelte";
	import ComboboxList, { comboboxOptionId } from "./ComboboxList.svelte";

	let {
		dimension,
		label,
		selected,
		contextSearch,
		onChange,
		help = null,
		placeholder = null,
	}: {
		dimension: "resolutionId" | "serialNr";
		label: string;
		selected: string[];
		// Aktueller URL-Querystring (z.B. von `$page.url.search.slice(1)`). Wird
		// 1:1 an /api/search/facetSearch durchgereicht – der Server entfernt
		// dimensions-eigene Filter für Drill-Sideways.
		contextSearch: string;
		onChange: (next: string[]) => void;
		help?: string | null;
		placeholder?: string | null;
	} = $props();

	let query = $state("");
	let open = $state(false);
	let loading = $state(false);
	let suggestions = $state<Array<{ value: string; count: number }>>([]);
	let activeIdx = $state(-1);
	let inputEl = $state<HTMLInputElement | null>(null);
	const listboxId = $derived(`facet-${dimension}-listbox`);

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFetchToken = 0;

	async function fetchSuggestions(q: string) {
		const token = ++lastFetchToken;
		loading = true;
		try {
			const params = new URLSearchParams(contextSearch);
			params.delete(dimension);
			params.set("dim", dimension);
			// `fq` (facet-query) statt `q` (= globaler Such-Text), damit der
			// globale Drill-Sideways-Filter erhalten bleibt.
			params.set("fq", q);
			const r = await fetch(`/api/search/facetSearch?${params.toString()}`);
			if (!r.ok) throw new Error(`facetSearch ${r.status}`);
			const data = (await r.json()) as { hits: Array<{ value: string; count: number }> };
			if (token !== lastFetchToken) return;
			suggestions = data.hits;
			activeIdx = -1;
		} catch (e) {
			console.error(e);
			if (token === lastFetchToken) suggestions = [];
		} finally {
			if (token === lastFetchToken) loading = false;
		}
	}

	function scheduleFetch(q: string) {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => fetchSuggestions(q), 150);
	}

	function onFocus() {
		open = true;
		if (suggestions.length === 0) fetchSuggestions(query);
	}

	function onInput(e: Event) {
		query = (e.target as HTMLInputElement).value;
		open = true;
		scheduleFetch(query);
	}

	function commitValue(raw: string) {
		const v = raw.trim();
		if (!v) return;
		if (selected.includes(v)) {
			onChange(selected.filter((x) => x !== v));
		} else {
			onChange([...selected, v].sort());
		}
		query = "";
		activeIdx = -1;
		fetchSuggestions("");
	}

	function removePill(v: string) {
		onChange(selected.filter((x) => x !== v));
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === "ArrowDown" || e.key === "Enter") {
				open = true;
				if (suggestions.length === 0) fetchSuggestions(query);
				e.preventDefault();
			}
			return;
		}
		switch (e.key) {
			case "ArrowDown":
				activeIdx = Math.min(suggestions.length - 1, activeIdx + 1);
				e.preventDefault();
				break;
			case "ArrowUp":
				activeIdx = Math.max(0, activeIdx - 1);
				e.preventDefault();
				break;
			case "Enter": {
				e.preventDefault();
				if (activeIdx >= 0 && activeIdx < suggestions.length) {
					commitValue(suggestions[activeIdx].value);
				} else if (query.trim()) {
					commitValue(query.trim());
				}
				break;
			}
			case "Escape":
				open = false;
				e.preventDefault();
				break;
			case "Backspace":
				if (query === "" && selected.length > 0) {
					removePill(selected[selected.length - 1]);
				}
				break;
		}
	}

	function onBlur() {
		setTimeout(() => {
			open = false;
		}, 150);
	}

	onMount(() => {
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});
</script>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">
		{label}
	</h3>

	{#if selected.length > 0}
		<ul class="flex flex-wrap gap-1 mb-2">
			{#each selected as v (v)}
				<li>
					<button
						type="button"
						class="flex items-center gap-1 px-2 py-0.5 bg-accent-500 text-white text-xs rounded hover:bg-accent-600"
						onclick={() => removePill(v)}
						aria-label={`${label} ${v} entfernen`}
					>
						<span class="tabular-nums">{v}</span>
						<span aria-hidden="true">×</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="relative">
		<input
			bind:this={inputEl}
			type="text"
			value={query}
			oninput={onInput}
			onfocus={onFocus}
			onblur={onBlur}
			onkeydown={onKeydown}
			placeholder={placeholder ?? (selected.length > 0 ? "Weitere hinzufügen…" : "Suchen oder Wert eingeben…")}
			class="w-full px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:border-accent-500"
			aria-label={label}
			role="combobox"
			aria-expanded={open && suggestions.length > 0}
			aria-controls={listboxId}
			aria-activedescendant={open && suggestions.length > 0 && activeIdx >= 0 ? comboboxOptionId(listboxId, activeIdx) : undefined}
			aria-autocomplete="list"
			autocomplete="off"
		/>

		<ComboboxList
			id={listboxId}
			{label}
			{open}
			{loading}
			{suggestions}
			{activeIdx}
			onPick={commitValue}
			isSelected={(v) => selected.includes(v)}
		/>
	</div>

	{#if help}
		<p class="text-xs text-zszh-600 mt-1.5 leading-snug">{help}</p>
	{/if}
</section>
