<script lang="ts">
	// Tab «Personen»: alle im Protokoll zugeordneten Rats- und Regierungsmitglieder
	// aus der Kantonsratsdatenbank (KRDB) – Porträt-Kacheln (Wikidata P18 über
	// den eigenen Proxy bzw. Staatsarchiv Z 1114 als eigene Datei) zuerst, die
	// übrigen als Liste. Zuordnung serverseitig
	// (lib/server/krdb.ts); im Text zeigt KrdbMentions.svelte dieselben Personen
	// als Karte beim Namen.
	import FeedbackDialog from "$lib/components/FeedbackDialog.svelte";
	import { formatDateDE } from "$lib/format";
	import KrdbCredit from "$lib/components/KrdbCredit.svelte";
	import KrdbPortrait from "$lib/components/KrdbPortrait.svelte";
	import type { PageProps } from "./$types";

	type Person = PageProps["data"]["krdbPersons"][number];

	let {
		persons,
		stand,
		mentioned,
		focusId = null,
		onReveal,
	}: {
		persons: Person[];
		stand: string | null;
		/** Personen, deren Namen im Text markiert sind (Link «im Text»). */
		mentioned: ReadonlySet<number>;
		/** Aus einer Personenseite geöffnet (?person=): diese Person hervorheben. */
		focusId?: number | null;
		onReveal: (id: number) => void;
	} = $props();

	// Der Tab mountet erst beim ersten Öffnen: dann zur hervorgehobenen Person scrollen.
	$effect(() => {
		if (focusId != null) document.getElementById(`person-${focusId}`)?.scrollIntoView({ block: "center" });
	});

	const withPortrait = $derived(persons.filter((p) => p.portrait));
	const withoutPortrait = $derived(persons.filter((p) => !p.portrait));
	const standDE = $derived(stand ? formatDateDE(stand) : "");
	const ring = (id: number) => (id === focusId ? "ring-2 ring-accent-500 ring-offset-4 rounded-sm" : "");

	function formsTitle(p: Person): string {
		return `Im Text als: ${p.forms.join(", ")}`;
	}
</script>

{#snippet links(p: Person, short: boolean)}
	{#if p.wikidataUrl}
		<a href={p.wikidataUrl} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
			Wikidata<span class="sr-only"> zu {p.name}</span></a
		>
	{/if}
	<a href={p.krdbUrl} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
		{short ? "KRDB" : "Kantonsratsdatenbank"}<span class="sr-only"> zu {p.name}</span></a
	>
	{#if mentioned.has(p.id)}
		<button type="button" onclick={() => onReveal(p.id)} class="text-accent-600 underline hover:text-accent-700">
			im Text<span class="sr-only"> zeigen: {p.name}</span>
		</button>
	{/if}
	{#if p.pageHref}
		<a href={p.pageHref} class="text-accent-600 underline hover:text-accent-700">
			Alle Dokumente{#if p.docCount} ({p.docCount.toLocaleString("de-CH")}){/if}<span class="sr-only"> von {p.name}</span></a
		>
	{/if}
{/snippet}

<!-- @container: Spalten nach Panel-Breite, nicht nach Viewport (auf dem Desktop
     teilt sich der Tab die Breite mit dem Faksimile). -->
<div class="@container bg-white border border-zszh-200 rounded-md p-5 md:p-6">
	<p class="text-sm text-zszh-700 leading-snug">
		{persons.length === 1
			? "Ein Rats- oder Regierungsmitglied"
			: `${persons.length} Rats- und Regierungsmitglieder`} aus der Kantonsratsdatenbank, mit Amt, Partei und Wahlkreis
		zum Sitzungsdatum.{#if mentioned.size > 0}{" "}Im Text öffnen die hervorgehobenen Namen eine Karte mit
			denselben Angaben.{/if}
	</p>

	{#if withPortrait.length > 0}
		<ul class="mt-4 grid grid-cols-1 @3xl:grid-cols-2 gap-x-6 gap-y-4">
			{#each withPortrait as p (p.id)}
				<li id="person-{p.id}" class="flex gap-3 min-w-0 {ring(p.id)}">
					<KrdbPortrait person={p} />
					<div class="min-w-0 text-sm leading-snug">
						<div class="font-medium text-zszh-900" title={formsTitle(p)}>{p.name}</div>
						{#if p.lifespan}<div class="text-xs text-zszh-500">{p.lifespan}</div>{/if}
						{#if p.role}<div class="text-xs text-zszh-600">{p.role}</div>{/if}
						<div class="mt-0.5 flex flex-wrap gap-x-2 text-xs leading-6">{@render links(p, false)}</div>
						{#if p.portrait}<KrdbCredit portrait={p.portrait} />{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if withoutPortrait.length > 0}
		<ul class="mt-4 @xl:columns-2 gap-x-6 text-sm">
			{#each withoutPortrait as p (p.id)}
				<li id="person-{p.id}" class="break-inside-avoid py-0.5 leading-snug {ring(p.id)}">
					<span class="font-medium text-zszh-900" title={formsTitle(p)}>{p.name}</span>
					{#if p.lifespan}<span class="text-xs text-zszh-500"> ({p.lifespan})</span>{/if}
					{#if p.role}<span class="text-xs text-zszh-600"> · {p.role}</span>{/if}
					<span class="inline-flex flex-wrap gap-x-2 text-xs"><span aria-hidden="true">·</span>{@render links(p, true)}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-4 pt-3 border-t border-zszh-100 text-xs text-zszh-500 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<span>
			Automatisch über Name und Amtszeit zugeordnet – Fehler möglich. Quellen:
			<a
				href="https://www.zh.ch/de/politik-staat/wahlen-abstimmungen/kantons-regierungsratswahlen/mitglieder-kantonsrats-ab-1803.html"
				target="_blank"
				rel="noopener external"
				class="underline hover:text-zszh-700">Kantonsratsdatenbank</a
			>
			(Staatsarchiv und Statistisches Amt{#if standDE}, Stand {standDE}{/if}), Wikidata, Porträts von Wikimedia
			Commons (Lizenz je Bild).
		</span>
		<FeedbackDialog variant="link" label="Zuordnung melden" />
	</div>
</div>
