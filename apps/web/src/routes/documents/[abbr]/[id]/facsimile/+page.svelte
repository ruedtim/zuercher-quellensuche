<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	import { SERIES_LABEL } from "$lib/types";
	import { formatDocDateDE, normalizeWhitespace } from "$lib/format";
	import Facsimile from "$lib/components/Facsimile.svelte";
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
	<title>Faksimile: {displayTitle} | {SITE_NAME}</title>
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-4 flex flex-col" style="min-height: 100vh;">
	<!-- Kompakter Header: Rückkehr zum Dokument + Titel -->
	<header class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
		<h1 class="font-serif text-base text-zszh-900 truncate" title={displayTitle}>
			{displayTitle}
		</h1>
	</header>

	<div class="flex-1 min-h-0">
		<Facsimile manifestUrl={data.doc.manifestUrl!} fillHeight />
	</div>
</div>
