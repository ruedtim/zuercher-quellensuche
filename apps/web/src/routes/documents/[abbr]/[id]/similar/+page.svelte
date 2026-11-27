<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	import { SERIES_LABEL } from "$lib/types";
	import { formatDocDateDE, normalizeWhitespace } from "$lib/format";
	import Similar from "../Similar.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const seriesLabel = $derived(SERIES_LABEL[data.doc.series]);
	const titleIsGeneric = $derived(
		data.doc.title === seriesLabel ||
			data.doc.title === "Amtsblatt des Kantons Zürich" ||
			data.doc.title === "(ohne Titel)",
	);
	const stazhIdent = $derived(normalizeWhitespace(data.doc.stazhIdent));
	const displayTitle = $derived(
		titleIsGeneric && stazhIdent ? stazhIdent : normalizeWhitespace(data.doc.title),
	);
	const dateDE = $derived(formatDocDateDE(data.doc));
</script>

<svelte:head>
	<title>Ähnliche zu: {displayTitle} | {SITE_NAME}</title>
</svelte:head>

<div class="max-w-screen-md mx-auto px-4 py-6">
	<!-- Kompakter Header: Rückkehr zum Dokument + Titel -->
	<header class="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<a
			href={`/documents/${data.doc.series}/${data.doc.id}`}
			class="text-sm text-accent-600 underline"
		>
			← Zurück zum Text
		</a>
		<span class="text-zszh-400">·</span>
		<span class="px-2 py-0.5 bg-zszh-900 text-zszh-50 text-xs font-bold uppercase tracking-wider rounded">
			{seriesLabel}
		</span>
		{#if dateDE}
			<time datetime={data.doc.date} class="text-zszh-700 text-sm">{dateDE}</time>
		{/if}
	</header>

	<h1 class="font-serif text-lg text-zszh-900 mb-1 leading-tight">
		Ähnliche Dokumente
	</h1>
	<p class="text-sm text-zszh-600 mb-4 truncate" title={displayTitle}>
		zu „{displayTitle}"
	</p>

	<Similar id={data.doc.id} />
</div>
