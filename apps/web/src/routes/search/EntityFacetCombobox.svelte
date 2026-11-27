<script lang="ts">
	import { onMount } from "svelte";
	import { entityKey, type EntityKind } from "$lib/entityKey";
	import { documentEntityKey } from "$lib/entityFilter";
	import ComboboxList, { comboboxOptionId } from "./ComboboxList.svelte";

	let {
		dimension,
		label,
		selected,
		contextSearch,
		onChange,
		source = "documents",
		keyed = false,
	}: {
		dimension: "persons" | "places" | "organizations";
		label: string;
		selected: string[];
		// Aktueller URL-Querystring (z.B. von `$page.url.search.slice(1)`). Wird
		// 1:1 an /api/search/facetSearch durchgereicht – der Server entfernt
		// dimensions-eigene Filter für Drill-Sideways.
		contextSearch: string;
		onChange: (next: string[]) => void;
		// Vorschläge aus den Dokumenten (/api/search/facetSearch), aus dem Archivkatalog
		// (/api/catalog/facetSearch) oder aus den Editionen (/api/editions/facetSearch): dort
		// zählt der Vergleichsschlüssel, eine gewählte Form deckt ihre Schreibvarianten ab (in
		// den Editionen gilt zusätzlich der Name selbst, auch ohne Schlüssel).
		source?: "documents" | "catalog" | "editions";
		// Dokumente: Trägt der Index die Vergleichsschlüssel (Fassung 2, entityKeysReady), gilt
		// dort dasselbe – ein Vorschlag je Schlüssel, gewählt über den Schlüssel; sonst die
		// Formen, exakt.
		keyed?: boolean;
	} = $props();

	const kind = $derived<EntityKind>(dimension === "persons" ? "person" : dimension === "places" ? "place" : "org");
	// Die letzte Antwort sagt, ob die Namensfilter gerade über die Schlüssel gelten (die
	// Bereitschaft kann seit dem Laden der Seite gewechselt haben); bis dahin gilt `keyed`.
	let keyedNow = $state<boolean | null>(null);
	const byKey = $derived(source !== "documents" || (keyedNow ?? keyed));
	// Die Dokumente speichern die Schlüssel in Fassung 2, Katalog und Editionen in Fassung 1.
	const keyOf = (v: string) => (source === "documents" ? documentEntityKey(dimension, v) : entityKey(kind, v));
	/** Gewählt? Im Katalog, in den Editionen und (mit Schlüsseln) in den Dokumenten auch über
	 *  den Schlüssel («Anna Meyer» deckt «Anna Meier» ab). */
	function isSelected(v: string): boolean {
		if (selected.includes(v)) return true;
		if (!byKey) return false;
		const k = keyOf(v);
		return k != null && selected.some((x) => keyOf(x) === k);
	}

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
			// Eigene Filter-Werte aus dem Context entfernen (Drill-Sideways).
			params.delete(dimension);
			params.set("dim", dimension);
			// `fq` (facet-query) statt `q` (= globaler Such-Text), damit der
			// globale Drill-Sideways-Filter erhalten bleibt.
			params.set("fq", q);
			const endpoint = source === "catalog" ? "/api/catalog/facetSearch" : source === "editions" ? "/api/editions/facetSearch" : "/api/search/facetSearch";
			const r = await fetch(`${endpoint}?${params.toString()}`);
			if (!r.ok) throw new Error(`facetSearch ${r.status}`);
			const data = (await r.json()) as { hits: Array<{ value: string; count: number }>; keyed?: boolean };
			if (token !== lastFetchToken) return;
			if (source === "documents" && typeof data.keyed === "boolean") keyedNow = data.keyed;
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

	function commitValue(value: string) {
		const v = value.trim();
		if (!v) return;
		if (isSelected(v)) {
			const k = keyOf(v);
			onChange(selected.filter((x) => x !== v && !(byKey && k != null && keyOf(x) === k)));
		} else {
			onChange([...selected, v].sort((a, b) => a.localeCompare(b, "de")));
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
					commitValue(query);
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
				<!-- Im Katalog filtern Formen ohne Schlüssel nicht (in den Editionen gilt der Name selbst). -->
				{@const inactive = source === "catalog" && keyOf(v) == null}
				<li>
					<button
						type="button"
						class="flex items-center gap-1 px-2 py-0.5 text-xs rounded max-w-full {inactive
							? 'bg-zszh-200 text-zszh-700 hover:bg-zszh-300'
							: 'bg-accent-500 text-white hover:bg-accent-600'}"
						onclick={() => removePill(v)}
						aria-label={`${v} entfernen`}
						title={inactive
							? kind === "person"
								? "Ohne Vornamen: filtert nur im Reiter «Zentrale Serien»"
								: "Filtert nur im Reiter «Zentrale Serien»"
							: undefined}
					>
						<span class="truncate">{v}</span>
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
			placeholder={selected.length > 0 ? "Weitere hinzufügen…" : "Tippen zum Suchen…"}
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
			{isSelected}
		/>
	</div>
</section>
