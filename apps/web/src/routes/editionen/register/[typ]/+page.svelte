<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Register der Editionen: Personen, Orte oder Organisationen aus den Registern der
	// Editionen mit der Zahl der Stücke, häufigste zuerst (oder nach Name), mit Suche, die beim
	// Tippen die Liste nachführt. Jeder Name führt in den Reiter «Editionen», gefiltert auf ihn;
	// darunter Zeitraum der Stücke, GND bzw. Karte und andere Schreibungen in den Texten.
	import { goto } from "$app/navigation";
	import { REGISTER_KINDS, type RegisterQuery } from "$lib/catalogRegister";
	import { editionEntitySearchHref, editionRegisterHref, gndHref, mapHref, yearSpan } from "$lib/editionRegister";
	import { EDITIONS, type EditionKey } from "$lib/editions";
	import { INDEXED_EDITIONS } from "$lib/editionTexts";
	import { searchViewHref } from "$lib/searchViews";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const nf = new Intl.NumberFormat("de-CH");
	const info = $derived(REGISTER_KINDS.find((k) => k.slug === data.slug) ?? REGISTER_KINDS[0]);
	const kinds = $derived(REGISTER_KINDS.filter((k) => data.sizes[k.kind] > 0 || k.slug === data.slug));
	const searching = $derived(data.query.q !== "");
	const href = (patch: Partial<RegisterQuery>) => editionRegisterHref(data.slug, { ...data.query, page: 1, ...patch });
	const pieces = (n: number) => `${nf.format(n)} ${n === 1 ? "Stück" : "Stücke"}`;
	const editionNames = INDEXED_EDITIONS.map((k) => `${EDITIONS[k].name} (${EDITIONS[k].short})`);
	const multiEdition = INDEXED_EDITIONS.length > 1;

	// Suche beim Tippen wie im Register des Archivkatalogs: die Liste folgt nach einer kurzen
	// Pause; der Wert im Feld folgt der URL nur, wenn sie sich anders geändert hat.
	let qInput = $state("");
	let lastSent = "";
	$effect(() => {
		const q = data.query.q;
		if (q !== lastSent) {
			qInput = q;
			lastSent = q;
		}
	});
	let typingTimer: ReturnType<typeof setTimeout> | undefined;
	function search(q: string, delay: number) {
		clearTimeout(typingTimer);
		typingTimer = setTimeout(() => {
			const next = q.replace(/\s+/g, " ").trim();
			if (next === data.query.q) return;
			lastSent = next;
			goto(href({ q: next }), { keepFocus: true, noScroll: true, replaceState: true });
		}, delay);
	}
</script>

<svelte:head>
	<title>Register: {info.label} | Editionen | {SITE_NAME}</title>
	<meta name="robots" content="noindex, follow" />
</svelte:head>

<div class="max-w-screen-lg mx-auto px-4 py-6">
	<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
		<a href="/" class="hover:underline">Start</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/register" class="hover:underline">Register</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<span>Editionen</span>
	</nav>

	<header class="max-w-3xl mb-4">
		<h1 class="font-display text-4xl md:text-5xl leading-none text-zszh-900 mb-3">Register der Editionen</h1>
		<p class="text-sm text-zszh-700 leading-relaxed">
			Personen, Orte und Organisationen der edierten Quellenstücke, unter ihrem Namen im Register der Edition – Personen mit GND, wo die Edition sie nennt.
			Bisher {INDEXED_EDITIONS.length === 1 ? "eine Edition" : `${INDEXED_EDITIONS.length} Editionen`}: {editionNames.join(", ")}.
			Ein Klick auf einen Namen zeigt seine Stücke im Reiter
			<a href={searchViewHref("editions")} class="text-accent-600 underline hover:text-accent-700">«Editionen»</a>.
			<a href="/about/editionen#register" class="text-accent-600 underline hover:text-accent-700">Mehr dazu</a>
		</p>
	</header>

	<nav aria-label="Register" class="flex gap-1 mb-5 shadow-[inset_0_-1px_0] shadow-zszh-200">
		{#each kinds as k (k.slug)}
			<a
				aria-current={k.slug === data.slug ? "page" : undefined}
				href={editionRegisterHref(k.slug)}
				class="px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {k.slug === data.slug
					? 'border-accent-500 text-zszh-900'
					: 'border-transparent text-zszh-600 hover:text-zszh-900'}"
				>{k.label} <span class="tabular-nums text-xs text-zszh-500">{nf.format(data.sizes[k.kind])}</span></a
			>
		{/each}
	</nav>

	<form
		method="GET"
		action={editionRegisterHref(data.slug)}
		class="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 text-sm"
		data-sveltekit-keepfocus
		onsubmit={(e) => {
			e.preventDefault();
			search(qInput, 0);
		}}
	>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">{info.kind === "person" ? "Name" : info.kind === "place" ? "Ort" : "Organisation"}</span>
			<input
				type="search"
				name="q"
				bind:value={qInput}
				oninput={() => search(qInput, 250)}
				autocomplete="off"
				placeholder={info.kind === "person" ? "z. B. Bullinger oder Zwinglj" : info.kind === "place" ? "z. B. Grüningen" : "z. B. Rat"}
				class="w-72 max-w-full px-3 py-1.5 bg-white border border-zszh-300 rounded focus:border-accent-500 outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Sortierung</span>
			<select
				name="sort"
				value={data.query.sort}
				onchange={(e) => goto(href({ sort: e.currentTarget.value === "name" ? "name" : "count" }), { keepFocus: true, noScroll: true })}
				class="px-2 py-1.5 bg-white border border-zszh-300 rounded"
			>
				<option value="count">Häufigste zuerst</option>
				<option value="name">{info.kind === "person" ? "Nachname A–Z" : "Name A–Z"}</option>
			</select>
		</label>
		<noscript><button type="submit" class="px-4 py-1.5 bg-zszh-900 text-zszh-50 rounded">Suchen</button></noscript>
		{#if searching}
			<a href={editionRegisterHref(data.slug, { sort: data.query.sort })} class="pb-1.5 text-accent-600 underline hover:text-accent-700">Alle anzeigen</a>
		{/if}
	</form>

	<p class="mb-4 text-sm text-zszh-700">
		<strong class="tabular-nums">{nf.format(data.total)}</strong>
		{data.total === 1 ? "Eintrag" : "Einträge"}
		{#if searching}für «{data.query.q}»{/if}
		<span class="text-zszh-600">· aus {pieces(data.pieces)}</span>
		{#if searching}
			·
			<a href={`/register?${new URLSearchParams({ q: data.query.q })}`} class="text-accent-600 hover:underline">in allen Registern suchen</a>
		{/if}
	</p>

	{#if data.entries.length === 0}
		<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
			{#if searching}
				Kein Eintrag für «{data.query.q}». Die
				<a href={searchViewHref("editions", { q: data.query.q })} class="text-accent-600 underline hover:text-accent-700">Volltextsuche in den Editionen</a>
				findet auch Namen, die das Register nicht verzeichnet.
			{:else}
				Das Register ist leer.
			{/if}
		</div>
	{:else}
		<div class="bg-white border border-zszh-200 rounded-md">
			<div class="flex justify-between px-4 py-2 text-xs uppercase tracking-wider text-zszh-600 border-b border-zszh-200">
				<span>{info.singular}</span>
				<span>Stücke</span>
			</div>
			<ol class="divide-y divide-zszh-100">
				{#each data.entries as e (e.name)}
					{@const years = yearSpan(e.yearFrom, e.yearTo)}
					<li class="flex items-baseline gap-3 px-4 py-2">
						<div class="min-w-0 flex-1">
							<a href={editionEntitySearchHref(data.kind, e.name)} class="font-medium text-zszh-900 hover:text-accent-600 hover:underline">{e.name}</a>
							<div class="text-xs text-zszh-600 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
								{#if years}<span class="tabular-nums" title="Zeitraum der Stücke">{years}</span>{/if}
								{#if multiEdition}<span>{e.editions.map((k) => EDITIONS[k as EditionKey]?.short ?? k).join(", ")}</span>{/if}
								{#if e.gnd}<a href={gndHref(e.gnd)} target="_blank" rel="noopener external" class="text-accent-700 hover:underline" title="Eintrag in der Gemeinsamen Normdatei">GND ↗</a>{/if}
								{#if e.ratHref}<a href={e.ratHref} class="text-accent-700 hover:underline" title="Dieselbe GND im Register des Kleinen Rats (Staatsarchiv)">Kleiner Rat</a>{/if}
								{#if e.coords}<a href={mapHref(e.coords)} target="_blank" rel="noopener external" class="text-accent-700 hover:underline">Karte ↗</a>{/if}
								{#if e.forms.length > 0}<span class="ed-form">auch: {e.forms.join(", ")}</span>{/if}
							</div>
						</div>
						<a
							href={editionEntitySearchHref(data.kind, e.name)}
							class="text-sm text-zszh-700 tabular-nums hover:text-accent-600"
							aria-label={pieces(e.pieces)}
							title={`${pieces(e.pieces)}${e.mentions > e.pieces ? `, ${nf.format(e.mentions)} Nennungen` : ""}`}>{nf.format(e.pieces)}</a
						>
					</li>
				{/each}
			</ol>
		</div>

		{#if data.pages > 1}
			<nav class="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label="Seiten">
				{#if data.page > 1}
					<a href={editionRegisterHref(data.slug, { ...data.query, page: data.page - 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">← Zurück</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">← Zurück</span>
				{/if}
				<span class="text-zszh-700 tabular-nums">Seite {data.page} von {nf.format(data.pages)}</span>
				{#if data.page < data.pages}
					<a href={editionRegisterHref(data.slug, { ...data.query, page: data.page + 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">Weiter →</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">Weiter →</span>
				{/if}
			</nav>
		{/if}
	{/if}

	<p class="mt-6 text-xs text-zszh-600 leading-relaxed max-w-3xl">
		Die Namen stammen aus den Registern der Editionen: Personen unter dem Namen der Gemeinsamen Normdatei oder der
		Edition, Orte meist in heutiger Schreibung. Die Zahl nennt die Stücke mit dem Namen; «auch» zeigt Schreibungen in den
		Texten, die die Edition dem Namen zuordnet. Die Suche findet beides.
	</p>
</div>
