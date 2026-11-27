<script lang="ts">
	// Eigene Felder des Reiters «Ehedaten» (nach dem Vorbild der Quickaccess-Suche des
	// Staatsarchivs): Name mit Rolle, Herkunft, Kirchgemeinde, Jahr, Herkunftsraum, Art,
	// Überlieferung und Band. Suchbegriff (Volltext) und ODER-Begriffe stehen darüber in der
	// gemeinsamen Filterspalte (Facets.svelte). Namen ohne Rolle sind die geteilten Personen
	// (`persons`), die Herkunft die geteilten Orte (`places`): beide wandern beim Reiterwechsel
	// mit. Zeitraum ebenfalls geteilt, hier als «Jahr von – bis».
	import { untrack } from "svelte";
	import {
		ART_LABEL,
		EHEDATEN_ARTEN,
		EHEDATEN_ATTRIBUTION,
		EHEDATEN_LICENSE,
		EHEDATEN_LICENSE_URL,
		EHEDATEN_QUELLEN,
		EHEDATEN_RAEUME,
		EHEDATEN_YEAR_MAX,
		EHEDATEN_YEAR_MIN,
		QUELLE_LABEL,
		RAUM_LABEL,
		STADT_ZUERICH,
		STADT_ZUERICH_KIRCHGEMEINDEN,
		kirchgemeindeFacet,
		type EhedatenFacetCounts,
		type EhedatenFilters,
		type EhedatenFilterValues,
		type NameRole,
	} from "$lib/ehedaten";
	import EhedatenCombobox from "./EhedatenCombobox.svelte";

	export interface EhedatenPatch {
		filters?: Partial<EhedatenFilterValues>;
		persons?: string[];
		places?: string[];
		dates?: { from: number | null; to: number | null };
	}

	let {
		filters,
		persons,
		places,
		dateFrom,
		dateTo,
		facets,
		contextSearch,
		onApply,
	}: {
		filters: EhedatenFilters;
		persons: string[];
		places: string[];
		dateFrom: number | null;
		dateTo: number | null;
		facets: EhedatenFacetCounts;
		contextSearch: string;
		onApply: (patch: EhedatenPatch) => void;
	} = $props();

	/** So viele Kirchgemeinden zeigt die Liste (nach Trefferzahl), gewählte immer. */
	const KIRCHE_SHOWN = 8;
	const nf = (n: number) => n.toLocaleString("de-CH");
	const toggle = <T,>(list: readonly T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	// --- Name mit Rolle -----------------------------------------------------------
	let role = $state<NameRole>("beide");
	const ROLES: NameRole[] = ["beide", "mann", "frau"];
	const ROLE_LABEL: Record<NameRole, string> = { beide: "Bräutigam oder Braut", mann: "Bräutigam", frau: "Braut" };
	const roleList = $derived(role === "mann" ? filters.mann : role === "frau" ? filters.frau : persons);
	function setRoleList(next: string[]) {
		if (role === "mann") onApply({ filters: { mann: next } });
		else if (role === "frau") onApply({ filters: { frau: next } });
		else onApply({ persons: next });
	}
	const chips = $derived([
		...persons.map((v) => ({ label: v, prefix: "", remove: () => onApply({ persons: persons.filter((x) => x !== v) }) })),
		...filters.mann.map((v) => ({ label: v, prefix: "Bräutigam", remove: () => onApply({ filters: { mann: filters.mann.filter((x) => x !== v) } }) })),
		...filters.frau.map((v) => ({ label: v, prefix: "Braut", remove: () => onApply({ filters: { frau: filters.frau.filter((x) => x !== v) } }) })),
	]);

	// --- Jahr -----------------------------------------------------------------------
	let fromInput = $state(dateFrom?.toString() ?? "");
	let toInput = $state(dateTo?.toString() ?? "");
	// Nur übernehmen, was sich am Wert geändert hat: Der Effekt läuft nach jeder Navigation
	// (die Props lesen data), und ein Rücksetzen beider Felder löschte sonst eine halb getippte
	// Jahreszahl im anderen Feld («bis» nach dem blur von «von»).
	let syncedFrom = untrack(() => dateFrom);
	let syncedTo = untrack(() => dateTo);
	$effect(() => {
		if (dateFrom !== syncedFrom) {
			syncedFrom = dateFrom;
			fromInput = dateFrom?.toString() ?? "";
		}
		if (dateTo !== syncedTo) {
			syncedTo = dateTo;
			toInput = dateTo?.toString() ?? "";
		}
	});
	function year(raw: string): number | null {
		const n = Number.parseInt(raw, 10);
		return Number.isFinite(n) ? n : null;
	}
	function commitYears() {
		const from = year(fromInput);
		const to = year(toInput);
		if (from === dateFrom && to === dateTo) return;
		onApply({ dates: { from, to } });
	}

	const kirchen = $derived(kirchgemeindeFacet(facets.kirchgemeinde, filters.kirche, KIRCHE_SHOWN));
	const artTotal = $derived(Object.values(facets.art).reduce((s, n) => s + n, 0));
</script>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Name</h3>
	{#if chips.length > 0}
		<ul class="flex flex-wrap gap-1 mb-2">
			{#each chips as chip (chip.prefix + chip.label)}
				<li>
					<button
						type="button"
						class="flex items-center gap-1 px-2 py-0.5 bg-accent-500 text-white text-xs rounded hover:bg-accent-600 text-left"
						onclick={chip.remove}
						aria-label={`${chip.prefix || "Name"} ${chip.label} entfernen`}
					>
						<span>{#if chip.prefix}<span class="opacity-80">{chip.prefix}:</span>{" "}{/if}{chip.label}</span>
						<span aria-hidden="true">×</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<label class="flex items-center gap-1.5 text-xs text-zszh-700 mb-1.5">
		<span>Rolle</span>
		<select
			bind:value={role}
			class="px-1.5 py-0.5 bg-white border border-zszh-300 rounded text-xs text-zszh-700 focus:outline-none focus:ring-1 focus:ring-accent-500"
		>
			{#each ROLES as r (r)}
				<option value={r}>{ROLE_LABEL[r]}</option>
			{/each}
		</select>
	</label>
	<EhedatenCombobox
		dim="persons"
		label={`Name (${ROLE_LABEL[role]})`}
		selected={roleList}
		{contextSearch}
		onChange={setRoleList}
		pills={false}
		showLabel={false}
		placeholder="z. B. Heusser oder Hans Jakob Heusser"
	/>
	<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
		Alle Wörter müssen im Namen stehen, Schreibvarianten zählen mit (Meier und Meyer). Die Originalschreibung steht in der Zusatzinfo. Mehrere Namen einer Rolle gelten als oder.
	</p>
</section>

<EhedatenCombobox
	dim="herkunft"
	label="Herkunft"
	selected={places}
	{contextSearch}
	onChange={(next) => onApply({ places: next })}
	placeholder="Gemeinde, Kanton oder Land"
	help="Herkunft von Bräutigam oder Braut. Weiler in Klammern zählen zu ihrer Gemeinde, «Thurgau» trifft jede Herkunft mit TG. Gilt in den anderen Reitern als Ort."
/>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Kirchgemeinde</h3>
	<ul class="space-y-1.5 mb-2">
		{#each kirchen as k (k.value)}
			<li>
				<label
					class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600"
					title={k.value === STADT_ZUERICH ? `Stadtkirchen: ${STADT_ZUERICH_KIRCHGEMEINDEN.join(", ")}` : undefined}
				>
					<input
						type="checkbox"
						class="accent-accent-500"
						checked={filters.kirche.includes(k.value)}
						onchange={() => onApply({ filters: { kirche: toggle(filters.kirche, k.value) } })}
					/>
					<span class="flex-1" class:font-medium={k.value === STADT_ZUERICH}>{k.value}</span>
					<span class="text-xs text-zszh-600 tabular-nums">{nf(k.count)}</span>
				</label>
			</li>
		{/each}
	</ul>
	<EhedatenCombobox
		dim="kirchgemeinde"
		label="Weitere Kirchgemeinde"
		selected={filters.kirche}
		{contextSearch}
		onChange={(next) => onApply({ filters: { kirche: next } })}
		pills={false}
		showLabel={false}
		placeholder="Weitere Kirchgemeinde …"
	/>
</section>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Jahr</h3>
	<div class="flex items-center gap-2">
		<input
			type="number"
			min={EHEDATEN_YEAR_MIN}
			max={EHEDATEN_YEAR_MAX}
			placeholder="von"
			aria-label="Jahr von"
			class="w-20 px-2 py-1 text-sm bg-white border border-zszh-300 rounded"
			bind:value={fromInput}
			onblur={commitYears}
			onkeydown={(e) => e.key === "Enter" && commitYears()}
		/>
		<span class="text-zszh-400">–</span>
		<input
			type="number"
			min={EHEDATEN_YEAR_MIN}
			max={EHEDATEN_YEAR_MAX}
			placeholder="bis"
			aria-label="Jahr bis"
			class="w-20 px-2 py-1 text-sm bg-white border border-zszh-300 rounded"
			bind:value={toInput}
			onblur={commitYears}
			onkeydown={(e) => e.key === "Enter" && commitYears()}
		/>
		{#if dateFrom != null || dateTo != null}
			<button
				type="button"
				onclick={() => onApply({ dates: { from: null, to: null } })}
				title="Jahr entfernen"
				aria-label="Jahr entfernen"
				class="px-2 py-1 text-xs border border-zszh-200 rounded text-zszh-600 hover:border-accent-500 shrink-0"
			>
				×
			</button>
		{/if}
	</div>
	<p class="text-xs text-zszh-600 mt-1.5 leading-snug">1524–1800. Bis 1700 datierte Zürich nach dem alten Stil (julianisch, «a. St.»).</p>
</section>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Herkunftsraum</h3>
	<ul class="space-y-1.5">
		{#each EHEDATEN_RAEUME as r (r)}
			<li>
				<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
					<input
						type="checkbox"
						class="accent-accent-500"
						checked={filters.raum.includes(r)}
						onchange={() => onApply({ filters: { raum: toggle(filters.raum, r) } })}
					/>
					<span class="flex-1">{RAUM_LABEL[r]}</span>
					<span class="text-xs text-zszh-600 tabular-nums">{nf(facets.raum[r] ?? 0)}</span>
				</label>
			</li>
		{/each}
	</ul>
	<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
		Mindestens eine der beiden Personen. Ohne Kantonskürzel oder Land gilt eine Herkunft als Kanton Zürich.
	</p>
</section>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Art des Eintrags</h3>
	<ul class="space-y-1.5">
		<li>
			<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
				<input type="radio" name="ehe-art" class="accent-accent-500" checked={filters.art === null} onchange={() => onApply({ filters: { art: null } })} />
				<span class="flex-1">alle</span>
				{#if filters.art === null}<span class="text-xs text-zszh-600 tabular-nums">{nf(artTotal)}</span>{/if}
			</label>
		</li>
		{#each EHEDATEN_ARTEN as a (a)}
			<li>
				<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
					<input type="radio" name="ehe-art" class="accent-accent-500" checked={filters.art === a} onchange={() => onApply({ filters: { art: a } })} />
					<span class="flex-1">{ART_LABEL[a]}</span>
					<span class="text-xs text-zszh-600 tabular-nums">{nf(facets.art[a] ?? 0)}</span>
				</label>
			</li>
		{/each}
	</ul>
	<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
		Verkündung, wenn der Eintrag «Verkünddatum» vermerkt; getraut wurde dann oft in einer anderen Kirchgemeinde.
	</p>
</section>

<section>
	<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">Überlieferung</h3>
	<ul class="space-y-1.5">
		{#each EHEDATEN_QUELLEN as q (q)}
			<li>
				<label class="flex items-center gap-2 text-sm cursor-pointer hover:text-accent-600">
					<input
						type="checkbox"
						class="accent-accent-500"
						checked={filters.quelle.includes(q)}
						onchange={() => onApply({ filters: { quelle: toggle(filters.quelle, q) } })}
					/>
					<span class="flex-1">{QUELLE_LABEL[q]}</span>
					<span class="text-xs text-zszh-600 tabular-nums">{nf(facets.quelle[q] ?? 0)}</span>
				</label>
			</li>
		{/each}
	</ul>
</section>

<EhedatenCombobox
	dim="band"
	label="Band (Signatur)"
	selected={filters.band}
	{contextSearch}
	onChange={(next) => onApply({ filters: { band: next } })}
	placeholder="z. B. E III 117.1"
/>

<p class="text-xs text-zszh-600 leading-snug border-l-2 border-zszh-200 pl-3">
	Daten: {EHEDATEN_ATTRIBUTION},
	<a href={EHEDATEN_LICENSE_URL} target="_blank" rel="noopener license" class="underline decoration-dotted underline-offset-2 hover:text-accent-600"
		>{EHEDATEN_LICENSE}</a
	>.
	<a href="/about/ehedaten" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Über die Ehedaten</a>
</p>
