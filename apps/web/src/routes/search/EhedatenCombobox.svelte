<script lang="ts">
	// Feld mit Vorschlägen im Reiter «Ehedaten» (Name, Herkunft, Kirchgemeinde, Band): die
	// Werte der aktuellen Treffermenge ohne die Auswahl dieses Feldes (/api/ehedaten/suggest).
	// Enter übernimmt einen markierten Vorschlag oder den getippten Text. Gewählte Werte
	// zeigt das Feld als Pills, ausser `pills` ist aus (Name: die Rollen zeigen ihre Chips selbst).
	import { onMount } from "svelte";
	import ComboboxList, { comboboxOptionId } from "./ComboboxList.svelte";

	let {
		dim,
		label,
		selected,
		contextSearch,
		onChange,
		help = null,
		placeholder = null,
		pills = true,
		showLabel = true,
	}: {
		dim: "persons" | "herkunft" | "kirchgemeinde" | "band";
		label: string;
		selected: string[];
		/** Querystring der aktuellen Suche (ohne ask); der Server lässt den Filter dieses Feldes weg. */
		contextSearch: string;
		onChange: (next: string[]) => void;
		help?: string | null;
		placeholder?: string | null;
		pills?: boolean;
		showLabel?: boolean;
	} = $props();

	let query = $state("");
	let open = $state(false);
	let loading = $state(false);
	let suggestions = $state<Array<{ value: string; count: number }>>([]);
	let activeIdx = $state(-1);
	const listboxId = $derived(`ehe-${dim}-listbox`);
	// Namen brauchen einen Anfang: ohne Eingabe gäbe es keine sinnvolle Liste.
	const needsInput = $derived(dim === "persons");
	const listOpen = $derived(open && (!needsInput || query.trim() !== ""));

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFetchToken = 0;

	async function fetchSuggestions(q: string) {
		const token = ++lastFetchToken;
		if (needsInput && !q.trim()) {
			suggestions = [];
			loading = false;
			return;
		}
		loading = true;
		try {
			const params = new URLSearchParams(contextSearch);
			params.set("dim", dim);
			params.set("fq", q);
			const r = await fetch(`/api/ehedaten/suggest?${params.toString()}`);
			if (!r.ok) throw new Error(`suggest ${r.status}`);
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
		const v = raw.replace(/\s+/g, " ").trim();
		if (!v) return;
		onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
		query = "";
		activeIdx = -1;
		suggestions = [];
		if (!needsInput) fetchSuggestions("");
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			if (open && activeIdx >= 0 && activeIdx < suggestions.length) commitValue(suggestions[activeIdx].value);
			else commitValue(query);
			return;
		}
		if (!open) {
			if (e.key === "ArrowDown") {
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
			case "Escape":
				open = false;
				e.preventDefault();
				break;
			case "Backspace":
				if (pills && query === "" && selected.length > 0) onChange(selected.slice(0, -1));
				break;
		}
	}

	function onBlur() {
		setTimeout(() => {
			open = false;
		}, 150);
	}

	onMount(() => () => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});
</script>

<div>
	{#if showLabel}
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">{label}</h3>
	{/if}

	{#if pills && selected.length > 0}
		<ul class="flex flex-wrap gap-1 mb-2">
			{#each selected as v (v)}
				<li>
					<button
						type="button"
						class="flex items-center gap-1 px-2 py-0.5 bg-accent-500 text-white text-xs rounded hover:bg-accent-600"
						onclick={() => onChange(selected.filter((x) => x !== v))}
						aria-label={`${label} ${v} entfernen`}
					>
						<span>{v}</span>
						<span aria-hidden="true">×</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="relative">
		<input
			type="text"
			value={query}
			oninput={onInput}
			onfocus={onFocus}
			onblur={onBlur}
			onkeydown={onKeydown}
			placeholder={placeholder ?? (selected.length > 0 ? "Weitere hinzufügen …" : "Suchen oder eingeben …")}
			aria-label={label}
			class="w-full min-w-0 px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:border-accent-500"
			role="combobox"
			aria-expanded={listOpen && suggestions.length > 0}
			aria-controls={listboxId}
			aria-activedescendant={listOpen && suggestions.length > 0 && activeIdx >= 0 ? comboboxOptionId(listboxId, activeIdx) : undefined}
			aria-autocomplete="list"
			autocomplete="off"
		/>

		<ComboboxList
			id={listboxId}
			{label}
			open={listOpen}
			{loading}
			{suggestions}
			{activeIdx}
			onPick={commitValue}
			isSelected={(v) => selected.includes(v)}
			check={false}
			empty="Keine Vorschläge – Enter übernimmt den Text."
		/>
	</div>

	{#if help}
		<p class="text-xs text-zszh-600 mt-1.5 leading-snug">{help}</p>
	{/if}
</div>
