<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Register des Archivkatalogs: Personen, Orte oder Organisationen mit der Zahl der
	// Verzeichnungseinheiten, häufigste zuerst (oder nach Name), mit Suche, die beim Tippen
	// die Liste nachführt. Jeder Name führt in die gefilterte Katalogsuche; Schwerpunkt-
	// Bestand, Personenseite (Kantonsratsdatenbank) und dieselben Namen in den Dokumenten
	// stehen darunter. Bestandsprägende Namen (Urheber, Provenienzen) stehen getrennt.
	import { goto } from "$app/navigation";
	import { CATALOG_COMPLETE_BY, CATALOG_IN_PROGRESS } from "$lib/catalog";
	import {
		catalogEntitySearchHref,
		documentEntitySearchHref,
		REGISTER_KINDS,
		registerHref,
		type RegisterQuery,
	} from "$lib/catalogRegister";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const nf = new Intl.NumberFormat("de-CH");
	const info = $derived(REGISTER_KINDS.find((k) => k.slug === data.slug) ?? REGISTER_KINDS[0]);
	const searching = $derived(data.query.q !== "");
	const href = (patch: Partial<RegisterQuery>) => registerHref(data.slug, { ...data.query, page: 1, ...patch });
	const units = (n: number) => `${nf.format(n)} ${n === 1 ? "Einheit" : "Einheiten"}`;

	// Suche beim Tippen: die Liste folgt nach einer kurzen Pause. Der Wert im Feld folgt der
	// URL nur, wenn sie sich anders geändert hat (Reiter, Zurück), nicht beim eigenen Tippen.
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
	<title>Register: {info.label} | Archivkatalog | {SITE_NAME}</title>
	<meta name="robots" content="noindex, follow" />
</svelte:head>

<div class="max-w-screen-lg mx-auto px-4 py-6">
	<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
		<a href="/" class="hover:underline">Start</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/register" class="hover:underline">Register</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<span>Archivkatalog</span>
	</nav>

	<header class="max-w-3xl mb-4">
		<h1 class="font-display text-4xl md:text-5xl leading-none text-zszh-900 mb-3">Register des Archivkatalogs</h1>
		<p class="text-sm text-zszh-700 leading-relaxed">
			Automatisch erkannte Personen, Orte und Organisationen in den Verzeichnungen des Staatsarchivs. Gleich geschriebene Namen bilden einen Eintrag, auch wenn
			verschiedene Personen gemeint sind. Ein Klick auf einen Namen zeigt seine Einheiten im
			<a href="/search?view=catalog" class="text-accent-600 underline hover:text-accent-700">Archivkatalog</a>.
			<a href="/about/archivkatalog#register" class="text-accent-600 underline hover:text-accent-700">Mehr dazu</a>
		</p>
	</header>

	<nav aria-label="Register" class="flex gap-1 mb-5 shadow-[inset_0_-1px_0] shadow-zszh-200">
		{#each REGISTER_KINDS as k (k.slug)}
			<a
				aria-current={k.slug === data.slug ? "page" : undefined}
				href={registerHref(k.slug)}
				class="px-3 sm:px-4 py-2 text-sm font-medium border-b-2 {k.slug === data.slug
					? 'border-accent-500 text-zszh-900'
					: 'border-transparent text-zszh-600 hover:text-zszh-900'}">{k.label}</a
			>
		{/each}
	</nav>

	<form
		method="GET"
		action={registerHref(data.slug)}
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
				placeholder={info.kind === "person" ? "z. B. Meier oder Meier, Anna" : info.kind === "place" ? "z. B. Wädenswil" : "z. B. Sulzer"}
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
			<a href={registerHref(data.slug, { sort: data.query.sort })} class="pb-1.5 text-accent-600 underline hover:text-accent-700">Alle anzeigen</a>
		{/if}
	</form>

	<p class="mb-4 text-sm text-zszh-700">
		<strong class="tabular-nums">{nf.format(data.total)}</strong>
		{data.total === 1 ? "Eintrag" : "Einträge"}
		{#if searching}
			für «{data.query.q}»{#if data.capped}<span class="text-zszh-600"> – die häufigsten {nf.format(data.total)}; genauer suchen grenzt ein</span>{/if}
		{:else if data.capped}
			<span class="text-zszh-600">– die häufigsten; seltenere Namen findet die Suche</span>
		{/if}
		{#if CATALOG_IN_PROGRESS}
			<span class="text-zszh-600">
				·
				<a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Katalog noch im Aufbau</a>,
				vollständig {CATALOG_COMPLETE_BY}
			</span>
		{/if}
	</p>

	{#snippet docLink(key: string)}
		{#await data.docLinks then links}
			{@const link = links[key]}
			{#if link}
				<a href={documentEntitySearchHref(data.kind, link.forms)} class="text-accent-700 hover:underline" title={`In den Dokumenten als ${link.forms.map((f) => `«${f}»`).join(", ")}${link.variants ? " und in gleichwertigen Schreibungen" : ""}`}
					>{nf.format(link.count)} {link.count === 1 ? "Dokument" : "Dokumente"}</a
				>
			{/if}
		{/await}
	{/snippet}

	{#if data.constants.length > 0}
		<details class="mb-5 bg-zszh-50 border border-zszh-200 rounded-md px-4 py-3 text-sm">
			<summary class="cursor-pointer text-zszh-800">
				<span class="font-medium">Prägen ganze Bestände</span>
				<span class="tabular-nums text-zszh-600">({nf.format(data.constants.length)})</span>
				<span class="text-zszh-600"> – Urheber, Provenienzen und Namensgeber, die an fast jeder Einheit eines Bestands stehen</span>
			</summary>
			<ul class="mt-3 space-y-2">
				{#each data.constants as e (e.key)}
					<li>
						<a href={catalogEntitySearchHref(data.kind, e.form)} class="font-medium text-zszh-900 hover:text-accent-600 hover:underline">{e.form}</a>
						<span class="text-zszh-600 tabular-nums">· {units(e.count)}</span>
						{#each e.bestaende as b (b.label)}
							<div class="text-xs text-zszh-600">
								in {nf.format(b.count)} von {nf.format(b.size)} Einheiten des Bestands
								<a href={catalogEntitySearchHref(data.kind, e.form, b.label)} class="hover:text-accent-600 hover:underline" title={b.label}>«{b.name}»</a>
							</div>
						{/each}
					</li>
				{/each}
			</ul>
			<p class="mt-3 text-xs text-zszh-600">
				Die Suche findet sie wie alle anderen.
			</p>
		</details>
	{/if}

	{#if data.entries.length === 0}
		<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
			{#if searching}
				Kein Eintrag für «{data.query.q}». Archivtitel nennen Personen meist als «Nachname, Vorname»; die
				<a href={`/search?view=catalog&q=${encodeURIComponent(data.query.q)}`} class="text-accent-600 underline hover:text-accent-700">Volltextsuche im Katalog</a>
				findet auch Namen, die das Register nicht erkannt hat.
			{:else}
				Das Register ist leer.
			{/if}
		</div>
	{:else}
		<div class="bg-white border border-zszh-200 rounded-md">
			<div class="flex justify-between px-4 py-2 text-xs uppercase tracking-wider text-zszh-600 border-b border-zszh-200">
				<span>{info.singular}</span>
				<span>Einheiten</span>
			</div>
			<ol class="divide-y divide-zszh-100">
				{#each data.entries as e (e.key)}
					<li class="flex items-baseline gap-3 px-4 py-2">
						<div class="min-w-0 flex-1">
							<a href={catalogEntitySearchHref(data.kind, e.form)} class="font-medium text-zszh-900 hover:text-accent-600 hover:underline">{e.form}</a>
							<div class="text-xs text-zszh-600 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
								{#if e.bestaende[0]}
									{@const b = e.bestaende[0]}
									<span>
										meist in
										<a href={catalogEntitySearchHref(data.kind, e.form, b.label)} class="hover:text-accent-600 hover:underline" title={b.label}>«{b.name}»</a>
									</span>
								{/if}
								{#if e.constant}<span title="Steht an fast jeder Einheit eines Bestands (Urheber, Provenienz, Namensgeber)">prägt den Bestand</span>{/if}
								{#if e.krdb}
									<span>
										<a href={`/personen/${e.krdb.id}`} class="text-accent-700 hover:underline" title={`${e.krdb.name} – Kantonsratsdatenbank`}>Personenseite</a
										>{#if e.krdb.units < e.count}{" "}<span title="Diese Einheiten sind der Person sicher zugeordnet; die übrigen können Namensvettern sein"
												>({units(e.krdb.units)} zugeordnet)</span
											>{/if}
									</span>
								{/if}
								{@render docLink(e.key)}
							</div>
						</div>
						<a href={catalogEntitySearchHref(data.kind, e.form)} class="text-sm text-zszh-700 tabular-nums hover:text-accent-600" aria-label={units(e.count)}
							>{nf.format(e.count)}</a
						>
					</li>
				{/each}
			</ol>
		</div>

		{#if data.pages > 1}
			<nav class="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label="Seiten">
				{#if data.page > 1}
					<a href={registerHref(data.slug, { ...data.query, page: data.page - 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">← Zurück</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">← Zurück</span>
				{/if}
				<span class="text-zszh-700 tabular-nums">Seite {data.page} von {nf.format(data.pages)}</span>
				{#if data.page < data.pages}
					<a href={registerHref(data.slug, { ...data.query, page: data.page + 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">Weiter →</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">Weiter →</span>
				{/if}
			</nav>
		{/if}
	{/if}

	<p class="mt-6 text-xs text-zszh-600 leading-relaxed max-w-3xl">
		Erkannt beim Aufbau des Katalogs: aus dem Titelschema (etwa «Nachname, Vorname (geb. …), von Ort»), nach den
		Erschliessungsregeln des Staatsarchivs und mit automatischer Namenserkennung. Fehler sind möglich. Die Zahl nennt
		die Verzeichnungseinheiten mit dem Namen; Einheiten der Zentralen Serien (samt Ratsmanualen) stehen als Dokumente
		auf der Plattform und zählen hier nicht.
	</p>
</div>
