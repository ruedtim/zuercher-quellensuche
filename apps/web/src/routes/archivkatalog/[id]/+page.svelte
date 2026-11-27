<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Seite einer Verzeichnungseinheit des Archivkatalogs: Kopf mit Archivplan-Kontext
	// (Pfad, Nachbarn, Position), Untereinheiten als Archivbaum, die veröffentlichten
	// Abschnitte des Online-Katalogs, Zitiervorschlag. Die Texte stammen aus dem
	// Online-Katalog des Staatsarchivs (ohne Lizenzangabe, Nachweis über Signatur und
	// Permalink). Eheeinträge zeigen zusätzlich die Ehe-Karte aus der Ehedatenbank
	// (CC BY 4.0), auch wenn die Einheit im Katalog-Index noch fehlt. Ediert eine Edition
	// des Staatsarchivs die Einheit (QZH, Zürcher Rechtsquellen), verweist der Kopf darauf.
	import {
		CATALOG_IN_PROGRESS,
		catalogCitation,
		catalogLinkResolver,
		catalogPermalink,
		fieldLines,
		formatCatalogDate,
	} from "$lib/catalog";
	import CopyButton from "$lib/components/CopyButton.svelte";
	import CatalogContext from "$lib/components/CatalogContext.svelte";
	import EditionLinks from "$lib/components/EditionLinks.svelte";
	import CatalogFieldText from "./CatalogFieldText.svelte";
	import CatalogTree from "$lib/components/CatalogTree.svelte";
	import CatalogUnitEntities from "./CatalogUnitEntities.svelte";
	import EheKarte from "./EheKarte.svelte";
	import { ehedatenCitation } from "$lib/ehedaten";
	import { searchViewHref } from "$lib/searchViews";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const unit = $derived(data.unit);
	const date = $derived(formatCatalogDate(unit.dateText));
	const permalink = $derived(catalogPermalink(unit.id));
	// Eheeinträge: mit Paar, Art, Datum und Lizenz der Ehedatenbank.
	const citation = $derived(data.ehe ? ehedatenCitation(data.ehe) : catalogCitation(unit));
	const known = $derived(new Set(data.known));
	const resolve = $derived(catalogLinkResolver(known, unit.doc));
	const heading = $derived(unit.title.replace(/\s+/g, " ").trim() || unit.signature || `Einheit ${unit.id}`);
	// Zurück in die Trefferliste, an die Stelle des Eintrags (Reiter «Ehedaten»: Tabellenzeile).
	const backHref = $derived(
		data.fromSearch ? `/search?${data.fromSearch}#${/(^|&)view=ehedaten(&|$)/.test(data.fromSearch) ? "ehe" : "cat"}-${unit.id}` : null,
	);
	const nf = new Intl.NumberFormat("de-CH");
	/** Ab so vielen Zeichen steht ein Feld zuerst gekürzt da; Regest bzw. «Inhalt und Form»
	 *  (der eigentliche Inhalt) erst ab dem Mehrfachen. */
	const LONG_FIELD = 1200;
	const LONG_MAIN_TEXT = 4000;
	const isLong = (field: { label: string; text: string }) =>
		field.text.length > (field.label === "Regest" || field.label === "Inhalt und Form" ? LONG_MAIN_TEXT : LONG_FIELD);
</script>

<svelte:head>
	<title>{unit.signature ? `${unit.signature} ` : ""}{heading.length > 100 ? `${heading.slice(0, 100)} …` : heading} | {SITE_NAME}</title>
	<meta name="description" content={[unit.level, date, heading].filter(Boolean).join(" · ")} />
	<meta name="robots" content="noindex, follow" />
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-6">
	{#if backHref}
		<nav aria-label="Trefferliste" class="mb-3 no-print">
			<a
				href={backHref}
				class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zszh-300 hover:border-accent-500 text-zszh-800 text-sm font-medium rounded-md"
			>
				<span aria-hidden="true">←</span>
				Zurück zur Trefferliste
			</a>
		</nav>
	{:else}
		<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
			<a href="/" class="hover:underline">Start</a>
			<span class="text-zszh-400" aria-hidden="true">›</span>
			{#if data.ehe}
				<a href={searchViewHref("ehedaten")} class="hover:underline">Ehedaten</a>
			{:else}
				<a href={searchViewHref("catalog")} class="hover:underline">Archivkatalog</a>
			{/if}
		</nav>
	{/if}

	<header class="bg-white border border-zszh-200 rounded-md shadow-sm px-5 py-4 mb-4">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2.5">
			<span class="inline-block px-2 py-0.5 text-xs font-bold uppercase tracking-wider rounded bg-zszh-900 text-zszh-50">
				{unit.level || "Verzeichnungseinheit"}
			</span>
			{#if date}<span class="text-zszh-700 font-medium text-sm">{date}</span>{/if}
			{#if unit.signature}<span class="text-xs text-zszh-600">{unit.signature}</span>{/if}
		</div>

		<h1 class="font-serif text-xl md:text-2xl text-zszh-900 leading-tight whitespace-pre-line">{unit.title || heading}</h1>

		{#if unit.stub}
			<p class="mt-2 text-xs text-zszh-600">
				Diese Stufe ist bisher nur aus dem Archivplan ihrer Untereinheiten bekannt; die Beschreibung folgt, sobald der
				Katalog übernommen ist.
			</p>
		{/if}

		{#if unit.doc?.own}
			<p class="mt-3">
				<a
					href={`/documents/${unit.doc.series}/${encodeURIComponent(unit.doc.id)}`}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-md"
				>
					Dokument auf der Plattform öffnen
					<span aria-hidden="true">→</span>
				</a>
			</p>
		{:else if unit.doc}
			<!-- Verweis per Weblink (z. B. Urkunde zu einem Beschluss): die Einheit ist ein eigenes Stück. -->
			<p class="mt-3">
				<a
					href={`/documents/${unit.doc.series}/${encodeURIComponent(unit.doc.id)}`}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zszh-300 hover:border-accent-500 text-zszh-800 text-sm font-medium rounded-md"
				>
					Dokument öffnen, auf das die Einheit verweist
					<span aria-hidden="true">→</span>
				</a>
			</p>
		{/if}

		<div class="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
			<a href={permalink} target="_blank" rel="noopener external" class="text-accent-600 underline">
				Im Archivkatalog des Staatsarchivs ↗
			</a>
			{#if unit.files.length > 0}
				<span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<span class="text-zszh-600">Digitalisat:</span>
					{#each unit.files as file (file.url)}
						<a href={file.url} target="_blank" rel="noopener" title={file.title} class="text-accent-700 hover:underline">{file.label} ↗</a>
					{/each}
					{#if unit.fileCount > unit.files.length}
						<span class="text-zszh-600">und {nf.format(unit.fileCount - unit.files.length)} weitere im Katalog</span>
					{/if}
				</span>
			{:else if unit.hasDigitization}
				<span class="text-zszh-600">Digitalisat im Online-Katalog einsehbar</span>
			{/if}
		</div>

		{#if data.editions.length > 0}
			<div class="mt-3">
				<EditionLinks links={data.editions} />
			</div>
		{/if}

		{#if data.path.length > 0}
			<!-- Archivplan-Kontext: Pfad, Nachbarn derselben Stufe und Position. -->
			<div class="mt-4 pt-3 border-t border-zszh-200">
				<CatalogContext path={data.path} {known} {unit} neighbors={data.neighbors} />
			</div>
		{/if}
	</header>

	{#if data.ehe}
		<EheKarte entry={data.ehe} sameMarriage={data.sameMarriage} sameCouple={data.sameCouple} />
	{/if}

	<!-- Archivbaum direkt unter dem Kopf: setzt den Archivplan-Kontext nach unten fort,
	     vor den (oft langen) Abschnitten der Beschreibung. -->
	{#if data.children && data.children.total > 0}
		<section class="bg-white border border-zszh-200 rounded-md px-5 py-4 mb-4" aria-labelledby="untereinheiten">
			<h2 id="untereinheiten" class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">
				Untereinheiten <span class="font-normal normal-case tracking-normal tabular-nums">({nf.format(data.children.total)})</span>
			</h2>
			{#key unit.id}
				<CatalogTree parentId={unit.id} initial={data.children} />
			{/key}
		</section>
	{/if}

	{#if unit.sections}
		<!-- Neu je Einheit: aufgeklappte Felder gelten nur für diese Seite. -->
		{#key unit.id}
		{#each unit.sections as section, si (si)}
			<section class="bg-white border border-zszh-200 rounded-md px-5 py-4 mb-4">
				<h2 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-3">{section.title}</h2>
				<dl class="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-x-6 gap-y-2 text-sm">
					{#each section.fields as field, i (i)}
						<dt class="text-zszh-600 sm:pt-px">{field.label}</dt>
						<dd class="text-zszh-900 leading-relaxed min-w-0 break-words mb-1 sm:mb-0">
							<CatalogFieldText lines={fieldLines(field, resolve)} long={isLong(field)} />
						</dd>
					{/each}
				</dl>
			</section>
		{/each}
		{/key}
	{:else if unit.text || unit.provenienz}
		<!-- Index ohne `sections` (vor dem Neuaufbau): gekürzter Text und Provenienz. -->
		<section class="bg-white border border-zszh-200 rounded-md px-5 py-4 mb-4">
			<dl class="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-x-6 gap-y-2 text-sm">
				{#if unit.text}
					<dt class="text-zszh-600">Inhalt</dt>
					<dd class="text-zszh-900 leading-relaxed whitespace-pre-line">{unit.text}</dd>
				{/if}
				{#if unit.provenienz}
					<dt class="text-zszh-600">Provenienz</dt>
					<dd class="text-zszh-900">{unit.provenienz}</dd>
				{/if}
			</dl>
		</section>
	{/if}

	<!-- Erkannte Namen (Register) nach der Beschreibung: die Einheit zuerst, die Automatik dahinter (#225). -->
	<CatalogUnitEntities entities={data.entities} />

	<footer class="text-xs text-zszh-700 space-y-1.5 px-1">
		<p>
			<span class="text-zszh-500">Zitiervorschlag:</span>
			<span class="select-all">{citation}</span>
			<CopyButton text={citation} context="Zitiervorschlag" class="ml-1 text-zszh-600 hover:text-zszh-900 hover:underline no-print" />
		</p>
		<p class="text-zszh-600">
			{#if data.catalogMissing}
				<!-- Ein Hinweis statt zwei (#225): Herkunft der Angaben und Katalogstand in einem Satz. -->
				Angaben aus der Ehedatenbank des Staatsarchivs Zürich (CC BY 4.0); aus dem Archivkatalog ist die Einheit noch nicht
				übernommen{#if CATALOG_IN_PROGRESS}, der <a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Katalog ist noch im Aufbau</a>{/if}.
			{:else}
				Beschreibung aus dem Online-Archivkatalog des Staatsarchivs Zürich.
				{#if CATALOG_IN_PROGRESS}
					<a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Katalog noch im Aufbau</a>
				{/if}
			{/if}
		</p>
	</footer>
</div>
