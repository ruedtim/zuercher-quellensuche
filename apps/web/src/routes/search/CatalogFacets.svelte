<script lang="ts">
	// Katalog-eigene Filter des Reiters «Archivkatalog»: Stufe, Feldsuche, Digitalisat.
	// Suchbegriff, Thema, Zeitraum sowie Personen, Orte und Organisationen stehen darüber
	// in der gemeinsamen Filterspalte (Facets.svelte), die beide Reiter teilen; sie rendert
	// diese Filter wie alles ausser dem Suchbegriff in den «Erweiterten Suchoptionen». Die
	// Feldsuche (Vorbild: «Feldsuche» im Online-Katalog des Staatsarchivs) sucht nur in
	// einem Feld (catalogFields.ts); den Bestand wählt sie als weiteres Feld aus
	// Vorschlägen der aktuellen Treffer (/api/catalog/bestandSearch, `catBestand`).
	import { onMount } from "svelte";
	import { splitCatalogLabel, type CatalogFacetCounts, type CatalogFilters } from "$lib/catalog";
	import {
		addCatalogField,
		CATALOG_SEARCH_FIELDS,
		catalogFieldChip,
		catalogFieldExactByDefault,
		catalogFieldValue,
		type CatalogFieldKey,
	} from "$lib/catalogFields";
	import { REGISTER_KINDS, registerHref } from "$lib/catalogRegister";
	import ComboboxList, { comboboxOptionId } from "./ComboboxList.svelte";
	import FilterChips, { type FilterChip } from "./FilterChips.svelte";

	type CatalogPatch = Partial<Pick<CatalogFilters, "level" | "bestand" | "digital" | "fields">>;

	let {
		filters,
		facets,
		contextSearch,
		onApply,
	}: {
		filters: CatalogFilters;
		facets: CatalogFacetCounts;
		/** Querystring der aktuellen Suche (ohne ask): Kontext der Bestandsvorschläge. */
		contextSearch: string;
		onApply: (patch: CatalogPatch) => void;
	} = $props();

	const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	const levels = $derived(
		[...new Set([...Object.keys(facets.level), ...filters.level])].sort((a, b) => (facets.level[b] ?? 0) - (facets.level[a] ?? 0)),
	);

	// --- Feldsuche -------------------------------------------------------------------
	type FieldChoice = CatalogFieldKey | "bestand";
	const PLACEHOLDER: Record<FieldChoice, string> = {
		signature: "z. B. C II 12",
		title: "z. B. Mühle",
		text: "z. B. Konkurs",
		provenienz: "z. B. Bezirksgericht",
		bestand: "Bestand suchen …",
	};

	// Wie im Online-Katalog steht die Signatur zuerst; dort ist «exakt» voreingestellt.
	let field = $state<FieldChoice>("signature");
	let input = $state("");
	let exact = $state(catalogFieldExactByDefault("signature"));
	let exclude = $state(false);
	const isBestand = $derived(field === "bestand");
	// Anführungszeichen im Feld haken «exakt» an (wie beim Suchbegriff).
	const exactEffective = $derived(exact || input.includes('"'));

	const fields = $derived(filters.fields ?? []);

	function commitField() {
		if (field === "bestand") return commitBestand();
		const value = catalogFieldValue(input, { exact, exclude });
		if (!value) return;
		input = "";
		exact = catalogFieldExactByDefault(field);
		exclude = false;
		onApply({ fields: addCatalogField(fields, { field, value }) });
	}

	// Einträge und gewählte Bestände als Chips, entfernbar.
	const chips = $derived<FilterChip[]>([
		...fields.map((entry, i): FilterChip => {
			const chip = catalogFieldChip(entry);
			return { ...chip, remove: () => onApply({ fields: fields.filter((_, j) => j !== i) }) };
		}),
		...filters.bestand.map(
			(b): FilterChip => ({
				label: `Bestand: ${splitCatalogLabel(b).name}`,
				kind: "term",
				remove: () => onApply({ bestand: filters.bestand.filter((x) => x !== b) }),
			}),
		),
	]);

	// --- Bestand: Vorschläge der aktuellen Treffer (ohne die Bestandswahl) --------------
	let suggestions = $state<Array<{ value: string; count: number }>>([]);
	let open = $state(false);
	let loading = $state(false);
	let activeIdx = $state(-1);
	const BESTAND_LIST = "catalog-bestand-listbox";
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFetch = 0;

	async function fetchSuggestions(fq: string) {
		const token = ++lastFetch;
		loading = true;
		try {
			const params = new URLSearchParams(contextSearch);
			params.delete("catBestand");
			params.set("fq", fq);
			const r = await fetch(`/api/catalog/bestandSearch?${params}`);
			if (!r.ok) throw new Error(`bestandSearch ${r.status}`);
			const data = (await r.json()) as { hits: Array<{ value: string; count: number }> };
			if (token !== lastFetch) return;
			suggestions = data.hits;
			activeIdx = -1;
		} catch (e) {
			console.error(e);
			if (token === lastFetch) suggestions = [];
		} finally {
			if (token === lastFetch) loading = false;
		}
	}

	function scheduleFetch() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => fetchSuggestions(input), 150);
	}

	function pickBestand(value: string) {
		input = "";
		open = false;
		activeIdx = -1;
		onApply({ bestand: toggle(filters.bestand, value) });
	}

	function commitBestand() {
		const pick = suggestions[activeIdx] ?? (input.trim() ? suggestions[0] : undefined);
		if (pick) pickBestand(pick.value);
	}

	function onInput() {
		if (!isBestand) return;
		open = true;
		scheduleFetch();
	}

	function onFocus() {
		if (!isBestand) return;
		open = true;
		fetchSuggestions(input);
	}

	function onBlur() {
		setTimeout(() => (open = false), 150);
	}

	function onKeydown(e: KeyboardEvent) {
		if (!isBestand || !open) return;
		if (e.key === "ArrowDown") {
			activeIdx = Math.min(suggestions.length - 1, activeIdx + 1);
			e.preventDefault();
		} else if (e.key === "ArrowUp") {
			activeIdx = Math.max(0, activeIdx - 1);
			e.preventDefault();
		} else if (e.key === "Escape") {
			open = false;
			e.preventDefault();
		}
	}

	// Feldwahl: Voreinstellung «exakt» des neuen Feldes (Signatur), Vorschläge zu.
	function onFieldChange(next: FieldChoice) {
		field = next;
		exact = catalogFieldExactByDefault(next);
		exclude = false;
		suggestions = [];
		open = false;
	}

	onMount(() => () => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});
</script>

{#if levels.length > 0}
	<section>
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Stufe</h3>
		<ul class="space-y-1.5">
			{#each levels as level (level)}
				<li>
					<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
						<input
							type="checkbox"
							class="accent-accent-500"
							checked={filters.level.includes(level)}
							onchange={() => onApply({ level: toggle(filters.level, level) })}
						/>
						<span class="flex-1">{level || "ohne Stufe"}</span>
						<span class="text-xs text-zszh-600 tabular-nums">{(facets.level[level] ?? 0).toLocaleString("de-CH")}</span>
					</label>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Feldsuche</h3>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			commitField();
		}}
		class="space-y-1.5"
	>
		<select
			value={field}
			onchange={(e) => onFieldChange(e.currentTarget.value as FieldChoice)}
			aria-label="Feld"
			class="w-full px-1.5 py-1 text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:ring-1 focus:ring-accent-500"
		>
			{#each CATALOG_SEARCH_FIELDS as f (f.key)}
				<option value={f.key}>{f.label}</option>
			{/each}
			<option value="bestand">Bestand</option>
		</select>
		<div class="relative flex gap-1">
			<input
				type="text"
				bind:value={input}
				oninput={onInput}
				onfocus={onFocus}
				onblur={onBlur}
				onkeydown={onKeydown}
				placeholder={PLACEHOLDER[field]}
				aria-label={isBestand ? "Bestand suchen" : `Suchbegriff im Feld ${CATALOG_SEARCH_FIELDS.find((f) => f.key === field)?.label ?? ""}`}
				role={isBestand ? "combobox" : undefined}
				aria-expanded={isBestand ? open && suggestions.length > 0 : undefined}
				aria-controls={isBestand ? BESTAND_LIST : undefined}
				aria-activedescendant={isBestand && open && suggestions.length > 0 && activeIdx >= 0 ? comboboxOptionId(BESTAND_LIST, activeIdx) : undefined}
				aria-autocomplete={isBestand ? "list" : undefined}
				autocomplete="off"
				class="w-full min-w-0 px-2 py-1 text-base sm:text-sm bg-white border border-zszh-300 rounded focus:outline-none focus:ring-1 focus:ring-accent-500"
			/>
			<button
				type="submit"
				title={isBestand ? "Bestand wählen" : "Eintrag hinzufügen"}
				class="px-2 py-1 text-xs border border-zszh-300 rounded text-zszh-700 hover:border-accent-500 shrink-0"
			>
				OK
			</button>
			{#if isBestand}
				<ComboboxList
					id={BESTAND_LIST}
					label="Bestand"
					{open}
					{loading}
					{suggestions}
					{activeIdx}
					onPick={pickBestand}
					isSelected={(v) => filters.bestand.includes(v)}
					empty="Kein Bestand in den Treffern"
					itemClass="items-start"
					listClass="max-h-72"
				>
					{#snippet row(s)}
						{@const label = splitCatalogLabel(s.value)}
						<span class="flex-1 min-w-0 leading-snug" title={s.value}>
							<span class="line-clamp-2">{label.name}</span>
							{#if label.date}<span class="block text-xs text-zszh-600">{label.date}</span>{/if}
						</span>
					{/snippet}
				</ComboboxList>
			{/if}
		</div>
		{#if !isBestand}
			<div class="flex flex-wrap gap-x-4 gap-y-1">
				<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer" title="Exakte Wortfolge (Phrase) – auch via Anführungszeichen">
					<input type="checkbox" class="accent-accent-500" checked={exactEffective} onchange={(e) => (exact = e.currentTarget.checked)} />
					exakt
				</label>
				<label class="flex items-center gap-1.5 text-xs text-zszh-700 cursor-pointer" title="Einheiten ausschliessen, in deren Feld der Begriff steht (NICHT)">
					<input type="checkbox" class="accent-accent-500" bind:checked={exclude} />
					ausschliessen
				</label>
			</div>
		{/if}
	</form>
	<FilterChips {chips} class="flex mt-2" />
	<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
		{#if isBestand}
			Bestände der aktuellen Treffer, häufigste zuerst.
		{:else}
			Sucht nur im gewählten Feld; alle Einträge müssen zutreffen. «exakt» verlangt die Wortfolge, bei der Signatur
			voreingestellt (C II 12, nicht C II 1, Nr. 12).
		{/if}
	</p>
</section>

<section>
	<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
		<input type="checkbox" class="accent-accent-500" checked={filters.digital} onchange={() => onApply({ digital: !filters.digital })} />
		<span class="flex-1">nur mit Digitalisat</span>
		<span class="text-xs text-zszh-600 tabular-nums">{facets.digital.toLocaleString("de-CH")}</span>
	</label>
</section>

<p class="text-xs text-zszh-600">
	<a href="/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Archivplan durchblättern</a>
	– vom Staatsarchiv bis zu den einzelnen Einheiten.
</p>

<p class="text-xs text-zszh-600">
	Register:
	{#each REGISTER_KINDS as k, i (k.slug)}{#if i > 0}{" · "}{/if}<a
			href={registerHref(k.slug)}
			class="underline decoration-dotted underline-offset-2 hover:text-accent-600">{k.label}</a
		>{/each}
	– die Namen im Katalog, häufigste zuerst.
</p>

<p class="text-xs text-zszh-600 leading-snug border-l-2 border-zszh-200 pl-3">
	Die Zentralen Serien – Amtsblatt, Regierungsratsbeschlüsse, Kantonsratsprotokolle, Gesetzessammlung und
	Ratsmanuale – lassen sich im Reiter «Zentrale Serien» im Volltext durchsuchen. Ihre Katalogeinträge erscheinen hier
	nur bei einer Suche im Feld «Signatur».
</p>

<p class="text-xs text-zszh-600 leading-snug border-l-2 border-zszh-200 pl-3">
	Die Einträge der Ehedatenbank sind hier mitenthalten. Gezielt nach Braut, Bräutigam, Herkunft oder Kirchgemeinde
	sucht der Reiter «Ehedaten».
</p>
