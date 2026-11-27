<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Personenseite eines Mitglieds des Kleinen Rats: Einsitze aus dem Register des
	// Staatsarchivs und die Ratsmanual-Sitzungen der Amtszeit. Die Sitzungen zeigen, wann
	// die Person im Rat sass – nicht, dass sie an jeder dieser Sitzungen teilnahm.
	import { formatDateDE } from "$lib/format";
	import { RAT_ATTRIBUTION, RAT_PROVENANCE, RAT_SOURCE_URL, ratDirectoryUrl } from "$lib/rat";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const p = $derived(data.person);
	const s = $derived(data.sessions);
	const nf = new Intl.NumberFormat("de-CH");
	const standDE = $derived(data.stand ? formatDateDE(data.stand) : "");

	function pageHref(page: number, sort = data.sort): string {
		const params = new URLSearchParams();
		if (sort !== "date_asc") params.set("sort", sort);
		if (page > 1) params.set("seite", String(page));
		const qs = params.toString();
		return `/rat/${p.id}${qs ? `?${qs}` : ""}`;
	}
</script>

<svelte:head>
	<title>{p.name} | Kleiner Rat | {SITE_NAME}</title>
	<meta name="description" content="{p.name}: Einsitze im Kleinen Rat von Zürich und die Ratsmanuale der Amtszeit." />
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-6">
	<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex flex-wrap items-center gap-1.5">
		<a href="/" class="hover:underline">Start</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/register" class="hover:underline">Register</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/rat" class="hover:underline">Kleiner Rat</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<span>{p.name}</span>
	</nav>

	<header class="bg-white border border-zszh-200 rounded-md shadow-sm px-5 py-4 mb-5 max-w-4xl">
		<h1 class="font-serif text-2xl md:text-3xl text-zszh-900 leading-tight">{p.name}</h1>
		<p class="text-sm text-zszh-700 mt-1">
			{[p.life, p.job].filter(Boolean).join(" · ") || "Lebensdaten unbekannt"}
		</p>
		{#if p.gnd || p.hls || p.ssrq || p.editions}
			<p class="flex flex-wrap gap-x-4 text-sm mt-2">
				{#if p.gnd}<a href={p.gnd} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">GND</a>{/if}
				{#if p.hls}<a href={p.hls} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">Historisches Lexikon der Schweiz</a>{/if}
				{#if p.ssrq}<a href={p.ssrq} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700" title="Personendatenbank der Sammlung Schweizerischer Rechtsquellen">Rechtsquellen (SSRQ)</a>{/if}
				{#if p.editions}
					<a href={p.editions.href} class="text-accent-600 underline hover:text-accent-700" title="Dieselbe GND im Register der Editionen"
						>In den Editionen ({p.editions.pieces.toLocaleString("de-CH")}
						{p.editions.pieces === 1 ? "Stück" : "Stücke"})</a
					>
				{/if}
			</p>
		{/if}
	</header>

	<section class="max-w-4xl mb-6" aria-labelledby="einsitze">
		<h2 id="einsitze" class="font-serif text-xl text-zszh-900 mb-2">Einsitze im Rat</h2>
		<!-- Auf Handys waagrecht scrollbar, darum mit der Tastatur erreichbar. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="bg-white border border-zszh-200 rounded-md overflow-x-auto" role="group" aria-label="Tabelle der Einsitze" tabindex="0">
			<table class="w-full text-sm">
				<thead class="text-xs text-zszh-600 border-b border-zszh-200">
					<tr>
						<th class="text-left font-medium px-3 py-2">Ratsperiode</th>
						<th class="text-left font-medium px-3 py-2">Funktion</th>
						<th class="text-left font-medium px-3 py-2">Zunft</th>
						<th class="text-left font-medium px-3 py-2">Schnyder</th>
						<th class="text-right font-medium px-3 py-2">Sitzungen</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-zszh-100">
					{#each data.seats as seat, i (i)}
						<tr>
							<td class="px-3 py-2 whitespace-nowrap tabular-nums">{seat.label}</td>
							<td class="px-3 py-2">{seat.office ?? "–"}</td>
							<td class="px-3 py-2">{seat.guild ?? "–"}</td>
							<td class="px-3 py-2 text-xs text-zszh-600" title="Seite in Werner Schnyder, Die Zürcher Ratslisten 1225–1798"
								>{seat.pages ? `S. ${seat.pages}` : "–"}</td
							>
							<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">
								{#if seat.href && seat.sessions}
									<a href={seat.href} class="text-accent-600 underline hover:text-accent-700">{nf.format(seat.sessions)}</a>
								{:else if seat.sessions === 0}
									<span class="text-zszh-500">0</span>
								{:else if !seat.inRm}
									<span class="text-zszh-500 text-xs" title="Die Ratsmanuale beginnen 1484">vor den Ratsmanualen</span>
								{:else}
									<span class="text-zszh-500 text-xs" title="Keine Bände dieser Ratshälfte überliefert bzw. Band für beide Räte">–</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="max-w-4xl" aria-labelledby="sitzungen">
		<h2 id="sitzungen" class="font-serif text-xl text-zszh-900 mb-1">Ratsmanuale der Amtszeit</h2>
		{#if !s}
			<p class="text-sm text-zszh-600">
				Zu diesen Einsitzen gibt es keine Ratsmanuale auf der Plattform – sie beginnen 1484, die Jahre 1516–1545 fehlen,
				und Bände mit beiden Räten eines Jahres sind keinem Rat zugeordnet.
			</p>
		{:else}
			<p class="text-sm text-zszh-700 mb-3">
				<strong class="tabular-nums">{nf.format(s.total)}</strong>
				{s.total === 1 ? "Sitzung" : "Sitzungen"} in den Halbjahren, in denen {p.name} im Rat sass – ob die Person an der
				einzelnen Sitzung teilnahm, sagt die Liste nicht.
				<a href={s.searchHref} class="text-accent-600 underline hover:text-accent-700">In der Suche öffnen</a>
				·
				<a href={s.nameHref} class="text-accent-600 underline hover:text-accent-700">«{s.surname}» im Text dieser Sitzungen</a>
			</p>

			<div class="flex gap-2 text-xs mb-2" role="group" aria-label="Sortierung">
				<a
					href={pageHref(1, "date_asc")}
					aria-current={data.sort === "date_asc" ? "true" : undefined}
					class="px-2 py-0.5 rounded border {data.sort === 'date_asc' ? 'border-zszh-900 bg-zszh-900 text-zszh-50' : 'border-zszh-300 bg-white text-zszh-700 hover:border-accent-500'}"
					>Älteste zuerst</a
				>
				<a
					href={pageHref(1, "date_desc")}
					aria-current={data.sort === "date_desc" ? "true" : undefined}
					class="px-2 py-0.5 rounded border {data.sort === 'date_desc' ? 'border-zszh-900 bg-zszh-900 text-zszh-50' : 'border-zszh-300 bg-white text-zszh-700 hover:border-accent-500'}"
					>Jüngste zuerst</a
				>
			</div>

			<ul class="bg-white border border-zszh-200 rounded-md divide-y divide-zszh-100">
				{#each s.hits as hit (hit.id)}
					<li class="px-4 py-2">
						<a href={`/documents/RM/${encodeURIComponent(hit.id)}`} class="text-sm text-zszh-900 hover:text-accent-600 hover:underline">
							{hit.title}
						</a>
						{#if hit.volumeNr}<span class="text-xs text-zszh-500 ml-1">B II {hit.volumeNr}</span>{/if}
					</li>
				{/each}
			</ul>

			{#if s.pages > 1}
				<nav class="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label="Seiten">
					{#if s.page > 1}
						<a href={pageHref(s.page - 1)} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">← Zurück</a>
					{:else}
						<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">← Zurück</span>
					{/if}
					<span class="text-zszh-700 tabular-nums">Seite {s.page} von {nf.format(s.pages)}</span>
					{#if s.page < s.pages}
						<a href={pageHref(s.page + 1)} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">Weiter →</a>
					{:else}
						<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">Weiter →</span>
					{/if}
				</nav>
			{/if}
		{/if}
	</section>

	<p class="max-w-4xl text-xs text-zszh-500 mt-8 pt-3 border-t border-zszh-200">
		Register:
		<a href={RAT_SOURCE_URL} target="_blank" rel="noopener external" class="underline hover:text-zszh-700">{RAT_ATTRIBUTION}</a>
		– {RAT_PROVENANCE}{#if standDE}. Stand {standDE}{/if}. Alle Mitglieder im
		<a href={ratDirectoryUrl()} class="underline hover:text-zszh-700">Verzeichnis</a>.
	</p>
</div>
