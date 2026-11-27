<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Verzeichnis des Kleinen Rats 1225–1798 (Register des Staatsarchivs), eines der Register
	// (Übersicht /register): Suche nach Name, Filter nach Zunft, Funktion und Jahrhundert, Link
	// auf die Personenseite mit Einsitzen und den Ratsmanualen der Amtszeit.
	import { formatDateDE } from "$lib/format";
	import {
		RAT_ATTRIBUTION,
		RAT_CENTURIES,
		RAT_PROVENANCE,
		RAT_SOURCE_URL,
		ratDirectoryUrl,
		ratPersonUrl,
		type RatDirectoryQuery,
	} from "$lib/rat";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const q = $derived(data.query);
	const nf = new Intl.NumberFormat("de-CH");
	const href = (patch: Partial<RatDirectoryQuery>) => ratDirectoryUrl({ ...q, page: 1, ...patch });
	const filtered = $derived(!!(q.q || q.guild || q.office || q.century || q.rmOnly || q.sort !== "name"));
	const standDE = $derived(data.stand ? formatDateDE(data.stand) : "");
</script>

<svelte:head>
	<title>Kleiner Rat 1225–1798 | Register | {SITE_NAME}</title>
	<meta
		name="description"
		content="Mitglieder des Kleinen Rats der Stadt Zürich 1225–1798 mit Einsitzen, Zunft und den Ratsmanualen ihrer Amtszeit."
	/>
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-6">
	<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
		<a href="/" class="hover:underline">Start</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/register" class="hover:underline">Register</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<span>Kleiner Rat</span>
	</nav>

	<header class="max-w-3xl mb-5">
		<h1 class="font-display text-4xl md:text-5xl leading-none text-zszh-900 mb-3">Kleiner Rat 1225–1798</h1>
		<p class="text-sm text-zszh-700 leading-relaxed">
			{nf.format(data.size)} Mitglieder des Kleinen Rats der Stadt Zürich aus dem Register des Staatsarchivs, je mit
			Einsitzen, Funktion und Zunft. Ab 1484 mit den
			<a href="/about/rm" class="text-accent-600 underline hover:text-accent-700">Ratsmanualen</a> ihrer Amtszeit. Die Rats- und Regierungsmitglieder seit 1803 stehen im
			<a href="/personen" class="text-accent-600 underline hover:text-accent-700">eigenen Verzeichnis</a>.
		</p>
	</header>

	<form method="GET" action="/rat" class="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 text-sm" data-sveltekit-keepfocus>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Name</span>
			<input
				type="search"
				name="q"
				value={q.q}
				autocomplete="off"
				placeholder="z. B. Hirzel, Escher Luchs"
				class="w-64 max-w-full px-3 py-1.5 bg-white border border-zszh-300 rounded focus:border-accent-500 outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Zunft</span>
			<select name="zunft" value={q.guild} class="px-2 py-1.5 bg-white border border-zszh-300 rounded max-w-[14rem]">
				<option value="">Alle</option>
				{#each data.guilds as g (g.value)}
					<option value={g.value}>{g.value} ({nf.format(g.count)})</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Funktion</span>
			<select name="funktion" value={q.office} class="px-2 py-1.5 bg-white border border-zszh-300 rounded max-w-[14rem]">
				<option value="">Alle</option>
				{#each data.offices as o (o.value)}
					<option value={o.value}>{o.value} ({nf.format(o.count)})</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Jahrhundert</span>
			<select name="jh" value={q.century ?? ""} class="px-2 py-1.5 bg-white border border-zszh-300 rounded">
				<option value="">Alle</option>
				{#each RAT_CENTURIES as c (c)}
					<option value={c}>{c}. Jahrhundert</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-zszh-700">Sortierung</span>
			<select name="sort" value={q.sort === "entry" ? "eintritt" : "name"} class="px-2 py-1.5 bg-white border border-zszh-300 rounded">
				<option value="name">Name</option>
				<option value="eintritt">Eintritt</option>
			</select>
		</label>
		<label class="flex items-center gap-2 pb-1.5">
			<input type="checkbox" name="rm" value="1" checked={q.rmOnly} />
			<span class="text-zszh-700">nur Zeit der Ratsmanuale (1484–1798)</span>
		</label>
		<button type="submit" class="px-4 py-1.5 bg-zszh-900 text-zszh-50 rounded hover:bg-zszh-800">Suchen</button>
		{#if filtered}
			<a href="/rat" class="pb-1.5 text-accent-600 underline hover:text-accent-700">Zurücksetzen</a>
		{/if}
	</form>

	<p class="mb-4 text-sm text-zszh-700">
		<strong class="tabular-nums">{nf.format(data.total)}</strong>
		{data.total === 1 ? "Person" : "Personen"}
	</p>

	{#if data.items.length === 0}
		<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
			Keine Person gefunden.
			{#if filtered}<a href={href({ guild: "", office: "", century: null, rmOnly: false })} class="text-accent-600 underline hover:text-accent-700">Nur nach dem Namen suchen</a>.{/if}
		</div>
	{:else}
		<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.items as item (item.id)}
				<li>
					<a
						href={ratPersonUrl(item.id)}
						class="block h-full bg-white border border-zszh-200 rounded-md p-3 hover:border-accent-500 transition-colors text-sm leading-snug"
					>
						<div class="font-medium text-zszh-900">{item.name}</div>
						{#if item.life}<div class="text-xs text-zszh-500 tabular-nums">{item.life}</div>{/if}
						{#each item.summary as line (line)}
							<div class="text-xs text-zszh-600">{line}</div>
						{/each}
						{#if item.rm}<div class="mt-1 text-xs text-zszh-700">Ratsmanuale der Amtszeit</div>{/if}
					</a>
				</li>
			{/each}
		</ul>

		{#if data.pages > 1}
			<nav class="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label="Seiten">
				{#if data.page > 1}
					<a href={ratDirectoryUrl({ ...q, page: data.page - 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">← Zurück</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">← Zurück</span>
				{/if}
				<span class="text-zszh-700 tabular-nums">Seite {data.page} von {nf.format(data.pages)}</span>
				{#if data.page < data.pages}
					<a href={ratDirectoryUrl({ ...q, page: data.page + 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">Weiter →</a>
				{:else}
					<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">Weiter →</span>
				{/if}
			</nav>
		{/if}
	{/if}

	<p class="max-w-3xl text-xs text-zszh-500 mt-8 pt-3 border-t border-zszh-200">
		Register:
		<a href={RAT_SOURCE_URL} target="_blank" rel="noopener external" class="underline hover:text-zszh-700">{RAT_ATTRIBUTION}</a>
		– {RAT_PROVENANCE}{#if standDE}. Stand {standDE}{/if}.
	</p>
</div>
