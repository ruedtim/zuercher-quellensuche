<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Personenseite eines Rats- oder Regierungsmitglieds: Kopf aus der
	// Kantonsratsdatenbank (Ämter, Partei, Porträt, Links) und alle
	// Kantonsratsprotokolle, in denen die Person zugeordnet ist – mit Zeitleiste,
	// Umfang (alle / im Titel genannt / nur im Text) und Sortierung. Die Zuordnung
	// steht im Suchindex (krdbIds, geschrieben vom Indexer); solange er sie nicht
	// trägt, zeigt die Seite nur den Kopf.
	import { goto } from "$app/navigation";
	import FeedbackDialog from "$lib/components/FeedbackDialog.svelte";
	import KrdbCredit from "$lib/components/KrdbCredit.svelte";
	import KrdbPortrait from "$lib/components/KrdbPortrait.svelte";
	import Timeline from "$lib/components/Timeline.svelte";
	import { formatDateDE } from "$lib/format";
	import { personUrl, type PersonScope, type PersonSort } from "$lib/personUrls";
	import PersonCatalog from "./PersonCatalog.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const p = $derived(data.person);
	const q = $derived(data.query);
	const docs = $derived(data.docs);
	const totalPages = $derived(docs ? Math.max(1, Math.ceil(docs.total / docs.pageSize)) : 1);
	const hasWindow = $derived(q.from != null || q.to != null);
	const windowLabel = $derived(
		q.from != null && q.to != null && q.from !== q.to
			? `${q.from}–${q.to}`
			: String(q.from ?? q.to ?? ""),
	);
	const nf = new Intl.NumberFormat("de-CH");

	const scopes: Array<{ value: PersonScope; label: string; hint: string }> = [
		{ value: "all", label: "Alle", hint: "Alle Protokolle, in denen die Person zugeordnet ist" },
		{
			value: "title",
			label: "Im Titel genannt",
			hint: "Vorstösse und Anträge, die die Person im Titel nennen",
		},
		{ value: "text", label: "Nur im Text erwähnt", hint: "Die Person kommt im Protokolltext vor, nicht im Titel" },
	];

	const href = (patch: Partial<typeof q>) => personUrl(p.id, { ...q, page: 1, ...patch });
	const searchHref = $derived(`/search?${new URLSearchParams({ q: `"${p.name}"`, series: "KRP", view: "documents" })}`);
</script>

<svelte:head>
	<title>{p.name} | {SITE_NAME}</title>
	<meta
		name="description"
		content="{p.name}: Ämter, Partei und die Kantonsratsprotokolle, in denen die Person vorkommt."
	/>
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-6">
	<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
		<a href="/" class="hover:underline">Start</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/register" class="hover:underline">Register</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<a href="/personen" class="hover:underline">Rats- und Regierungsmitglieder</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<span>{p.name}</span>
	</nav>

	<header class="bg-white border border-zszh-200 rounded-md shadow-sm px-5 py-5 mb-5 flex flex-col sm:flex-row gap-5">
		<div class="shrink-0">
			<KrdbPortrait person={p} size="large" />
			{#if p.portrait}
				<div class="w-36"><KrdbCredit portrait={p.portrait} /></div>
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<h1 class="font-serif text-2xl md:text-3xl text-zszh-900 leading-tight">{p.name}</h1>
			{#if p.lifespan}<div class="text-sm text-zszh-600 mt-0.5">{p.lifespan}</div>{/if}

			<ul class="mt-3 space-y-1 text-sm text-zszh-800">
				{#each p.offices as o (o.label + o.years + o.district)}
					<li>
						<span class="font-medium">{o.label}</span>
						<span class="text-zszh-700">{o.years}</span>
						{#if o.district}<span class="text-zszh-600"> · {o.district}</span>{/if}
					</li>
				{/each}
			</ul>
			{#if p.parties.length > 0}
				<div class="mt-2 text-sm text-zszh-700">
					<span class="text-zszh-600">Partei:</span>
					{#each p.parties as party, i (party.party)}{i > 0 ? ", " : ""}{party.party}
						<span class="text-zszh-600">({party.years})</span>{/each}
				</div>
			{/if}
			{#if p.residences.length > 0}
				<div class="mt-1 text-sm text-zszh-700">
					<span class="text-zszh-600">Wohnort während der Amtszeit:</span>
					{p.residences.join(", ")}
				</div>
			{/if}

			<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
				<a href={p.krdbUrl} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
					Kantonsratsdatenbank ↗
				</a>
				{#if p.wikidataUrl}
					<a href={p.wikidataUrl} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
						Wikidata ↗
					</a>
				{/if}
				<a href={searchHref} class="text-accent-600 underline hover:text-accent-700">
					Volltextsuche nach «{p.name}»
				</a>
				{#if data.catalog}
					<a href="#archivkatalog" class="text-accent-600 underline hover:text-accent-700">
						Im Archivkatalog{#if data.catalog.secured.total > 0}&nbsp;<span class="tabular-nums">({nf.format(data.catalog.secured.total)})</span>{/if}
					</a>
				{/if}
			</div>
		</div>
	</header>

	{#if !data.ready || !docs}
		<div class="bg-white border border-zszh-200 rounded-md p-6 text-sm text-zszh-700">
			Die Liste der Dokumente dieser Person ist noch nicht verfügbar. Sie erscheint, sobald der Suchindex die
			Zuordnung der Personen zu den Kantonsratsprotokollen enthält.
			<a href={searchHref} class="text-accent-600 underline hover:text-accent-700">Bis dahin: Volltextsuche</a>.
		</div>
	{:else}
		<section aria-labelledby="docs-heading">
			<h2 id="docs-heading" class="font-serif text-xl text-zszh-900 mb-3">
				{#if data.totalDocs}
					{nf.format(data.totalDocs)} {data.totalDocs === 1 ? "Dokument" : "Dokumente"}
				{:else}
					Dokumente
				{/if}
			</h2>

			{#if data.totalDocs}
				<div class="mb-4">
					<Timeline
						buckets={docs.timelineBuckets}
						min={data.axis.min}
						max={data.axis.max}
						dateFrom={q.from}
						dateTo={q.to}
						onApply={(from, to) => goto(href({ from, to }), { noScroll: true, keepFocus: true })}
						caption="Dokumente pro Jahr – Klick filtert ein Jahr, Ziehen einen Bereich; die Zeitleiste zoomt mit"
					/>
				</div>

				<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4 text-sm">
					<div class="flex flex-wrap gap-1.5" role="group" aria-label="Umfang">
						{#each scopes as s (s.value)}
							<a
								href={href({ scope: s.value })}
								data-sveltekit-noscroll
								title={s.hint}
								aria-current={q.scope === s.value ? "true" : undefined}
								class="px-3 py-1 rounded-sm border {q.scope === s.value
									? 'bg-zszh-900 text-zszh-50 border-zszh-900'
									: 'bg-white text-zszh-800 border-zszh-300 hover:border-accent-500'}"
							>
								{s.label}
								<span class="tabular-nums opacity-80">({nf.format(docs.scopeCounts[s.value])})</span>
							</a>
						{/each}
					</div>
					<label class="flex items-center gap-1.5 text-zszh-700">
						<span>Sortierung</span>
						<select
							value={q.sort}
							onchange={(e) =>
								goto(href({ sort: e.currentTarget.value as PersonSort }), { noScroll: true, keepFocus: true })}
							class="px-2 py-1 bg-white border border-zszh-300 rounded text-sm"
						>
							<option value="date_desc">Neueste zuerst</option>
							<option value="date_asc">Älteste zuerst</option>
						</select>
					</label>
				</div>

				{#if hasWindow}
					<p class="mb-3 text-sm text-zszh-700">
						Nur {windowLabel}:
						<strong class="tabular-nums">{nf.format(docs.total)}</strong>
						{docs.total === 1 ? "Dokument" : "Dokumente"}
						<a
							href={href({ from: null, to: null })}
							data-sveltekit-noscroll
							class="ml-2 text-accent-600 underline hover:text-accent-700">Zeitraum aufheben</a
						>
					</p>
				{/if}

				{#if docs.hits.length === 0}
					<div class="bg-white border border-zszh-200 rounded-md p-6 text-center text-zszh-600">
						Keine Dokumente in dieser Auswahl.
					</div>
				{:else}
					<ul>
						{#each docs.hits as hit (hit.id)}
							<li class="hit-row pt-3.5 pb-5">
								<div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1">
									<span class="badge-code">{hit.series}</span>
									{#if hit.date}<time class="text-xs text-zszh-600" datetime={hit.date}>{formatDateDE(hit.date)}</time>{/if}
								</div>
								<h3 class="font-serif text-lg font-semibold text-zszh-900 leading-tight">
									<a href={`/documents/${hit.series}/${hit.id}?person=${p.id}`} class="hit-link">{@html hit.formattedTitle}</a>
								</h3>
								{#if hit.snippet}
									<p class="text-sm text-zszh-700 mt-2 leading-relaxed kwic">…{@html hit.snippet}…</p>
								{/if}
							</li>
						{/each}
					</ul>

					{#if totalPages > 1}
						<nav class="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label="Seiten">
							{#if docs.page > 1}
								<a href={personUrl(p.id, { ...q, page: docs.page - 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">← Zurück</a>
							{:else}
								<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">← Zurück</span>
							{/if}
							<span class="text-zszh-700 tabular-nums">Seite {docs.page} von {nf.format(totalPages)}</span>
							{#if docs.page < totalPages}
								<a href={personUrl(p.id, { ...q, page: docs.page + 1 })} class="px-3 py-1 border border-zszh-300 rounded bg-white hover:border-accent-500">Weiter →</a>
							{:else}
								<span class="px-3 py-1 border border-zszh-200 rounded text-zszh-400">Weiter →</span>
							{/if}
						</nav>
					{/if}
				{/if}
			{:else}
				<div class="bg-white border border-zszh-200 rounded-md p-6 text-sm text-zszh-700">
					Zu dieser Person sind keine Kantonsratsprotokolle zugeordnet. Das heisst nicht, dass sie nie vorkommt:
					Zugeordnet wird nur, wenn Name und Amtszeit eindeutig passen.
					<a href={searchHref} class="text-accent-600 underline hover:text-accent-700">In der Volltextsuche weitersuchen</a>.
				</div>
			{/if}
		</section>
	{/if}

	{#if data.catalog}
		{#key p.id}
			<PersonCatalog personId={p.id} secured={data.catalog.secured} namesTotal={data.catalog.namesTotal} />
		{/key}
	{/if}

	<footer class="mt-8 pt-4 border-t border-zszh-200 text-xs text-zszh-500 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<span>
			Die Dokumente sind automatisch über Name und Amtszeit zugeordnet – Fehler möglich; gezählt werden nur
			Kantonsratsprotokolle. Quellen:
			<a
				href="https://www.zh.ch/de/politik-staat/wahlen-abstimmungen/kantons-regierungsratswahlen/mitglieder-kantonsrats-ab-1803.html"
				target="_blank"
				rel="noopener external"
				class="underline hover:text-zszh-700">Kantonsratsdatenbank</a
			>
			(Staatsarchiv und Statistisches Amt{#if data.stand}, Stand {formatDateDE(data.stand)}{/if}), Wikidata, Porträts
			von Wikimedia Commons bzw. Staatsarchiv (Lizenz bzw. Nachweis je Bild).
		</span>
		<FeedbackDialog variant="link" label="Zuordnung melden" />
	</footer>
</div>

<style>
	:global(.kwic mark, .kwic em.match) {
		background-color: #ffd9e6;
		font-style: normal;
		font-weight: 500;
		padding: 0 2px;
		border-radius: 2px;
	}
</style>
