<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Verzeichnis der Rats- und Regierungsmitglieder (Kantonsratsdatenbank), eines der
	// Register (Übersicht /register): Suche nach Name, Filter nach Amt, Link auf die
	// Personenseite mit allen Kantonsratsprotokollen der Person.
	import KrdbPortrait from "$lib/components/KrdbPortrait.svelte";
	import { DIRECTORY_COUNCILS, directoryUrl } from "$lib/personUrls";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const q = $derived(data.query);
	const nf = new Intl.NumberFormat("de-CH");
	const href = (patch: Partial<typeof q>) => directoryUrl({ ...q, page: 1, ...patch });
</script>

<svelte:head>
	<title>Rats- und Regierungsmitglieder | Register | {SITE_NAME}</title>
	<meta
		name="description"
		content="Rats- und Regierungsmitglieder des Kantons Zürich seit 1803 mit den Kantonsratsprotokollen, in denen sie vorkommen."
	/>
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-6">
	<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
		<a href="/" class="hover:underline">Start</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/register" class="hover:underline">Register</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<span>Rats- und Regierungsmitglieder</span>
	</nav>

	<header class="max-w-3xl mb-5">
		<h1 class="font-display text-4xl md:text-5xl leading-none text-zszh-900 mb-3">Rats- und Regierungsmitglieder</h1>
		<p class="text-sm text-zszh-700 leading-relaxed">
			Mitglieder des Kantonsrats und des Regierungsrats seit 1803 aus der
			<a
				href="https://www.zh.ch/de/politik-staat/wahlen-abstimmungen/kantons-regierungsratswahlen/mitglieder-kantonsrats-ab-1803.html"
				target="_blank"
				rel="noopener external"
				class="text-accent-600 underline hover:text-accent-700">Kantonsratsdatenbank</a
			>. Jede Person hat eine Seite mit den Kantonsratsprotokollen, die ihr automatisch über Name und Amtszeit zugeordnet sind. Andere Personen stehen in den übrigen
			<a href="/register" class="text-accent-600 underline hover:text-accent-700">Registern</a>.
		</p>
	</header>

	<form method="GET" action="/personen" class="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 text-sm" data-sveltekit-keepfocus>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Name</span>
			<input
				type="search"
				name="q"
				value={q.q}
				autocomplete="off"
				class="w-64 max-w-full px-3 py-1.5 bg-white border border-zszh-300 rounded focus:border-accent-500 outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Amt</span>
			<select name="amt" value={q.council} class="px-2 py-1.5 bg-white border border-zszh-300 rounded">
				{#each DIRECTORY_COUNCILS as c (c.value)}
					<option value={c.value}>{c.label}</option>
				{/each}
			</select>
		</label>
		{#if data.ready}
			<label class="flex flex-col gap-1">
				<span class="text-zszh-700">Sortierung</span>
				<select name="sort" value={q.sort} class="px-2 py-1.5 bg-white border border-zszh-300 rounded">
					<option value="name">Name</option>
					<option value="docs">Anzahl Dokumente</option>
				</select>
			</label>
			<label class="flex items-center gap-2 pb-1.5">
				<input type="checkbox" name="alle" value="1" checked={!q.withDocs} />
				<span class="text-zszh-700">auch Personen ohne Dokumente</span>
			</label>
		{/if}
		<button type="submit" class="px-4 py-1.5 bg-zszh-900 text-zszh-50 rounded hover:bg-zszh-800">Suchen</button>
		{#if q.q || q.council || !q.withDocs || q.sort !== "name"}
			<a href="/personen" class="pb-1.5 text-accent-600 underline hover:text-accent-700">Zurücksetzen</a>
		{/if}
	</form>

	<p class="mb-4 text-sm text-zszh-700">
		<strong class="tabular-nums">{nf.format(data.total)}</strong>
		{data.total === 1 ? "Person" : "Personen"}
		{#if !data.ready}
			<span class="text-zszh-600"> – die Dokumentzahlen erscheinen, sobald der Suchindex die Zuordnung enthält.</span>
		{/if}
	</p>

	{#if data.items.length === 0}
		<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
			Keine Person gefunden.
			{#if q.withDocs && data.ready}
				<a href={href({ withDocs: false })} class="text-accent-600 underline hover:text-accent-700"
					>Auch Personen ohne Dokumente anzeigen</a
				>.
			{/if}
		</div>
	{:else}
		<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.items as item (item.id)}
				<li>
					<a
						href={`/personen/${item.id}`}
						class="flex gap-3 h-full bg-white border border-zszh-200 rounded-md p-3 hover:border-accent-500 transition-colors"
					>
						<KrdbPortrait person={item} />
						<div class="min-w-0 text-sm leading-snug">
							<div class="font-medium text-zszh-900">{item.name}</div>
							{#if item.lifespan}<div class="text-xs text-zszh-500">{item.lifespan}</div>{/if}
							{#each item.offices.slice(0, 2) as office (office)}
								<div class="text-xs text-zszh-600">{office}</div>
							{/each}
							{#if item.party}<div class="text-xs text-zszh-600">{item.party}</div>{/if}
							{#if item.docs != null}
								<div class="mt-1 text-xs text-zszh-700 tabular-nums">
									{#if item.docs > 0}{nf.format(item.docs)} {item.docs === 1 ? "Dokument" : "Dokumente"}{:else}<span class="text-zszh-500">keine Dokumente</span>{/if}
								</div>
							{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>

		{#if data.pages > 1}
			<nav class="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label="Seiten">
				{#if data.page > 1}
					<a href={directoryUrl({ ...q, page: data.page - 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">← Zurück</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">← Zurück</span>
				{/if}
				<span class="text-zszh-700 tabular-nums">Seite {data.page} von {nf.format(data.pages)}</span>
				{#if data.page < data.pages}
					<a href={directoryUrl({ ...q, page: data.page + 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">Weiter →</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">Weiter →</span>
				{/if}
			</nav>
		{/if}
	{/if}
</div>
