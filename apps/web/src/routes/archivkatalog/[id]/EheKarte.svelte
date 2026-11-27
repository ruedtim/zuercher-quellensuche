<script lang="ts">
	// Ehe-Karte einer Katalogeinheit der Ehedatenbank: Art und Datum (bis 1700 im alten Stil),
	// Kirchgemeinde, Bräutigam und Braut mit Herkunft, Zusatzinfo und Normdaten, Signatur;
	// dazu die übrigen Einträge derselben Ehe aus der geprüften Liste der Mehrfacheinträge
	// (meist verkündet in der einen, getraut in der anderen Kirchgemeinde), ungeprüft weitere
	// Einträge mit denselben Namen nahe beim Datum, und Suchen im Reiter «Ehedaten». Quelle
	// (Online-Archivkatalog mit Stand) mit Lizenz (CC BY 4.0).
	import {
		ART_LABEL,
		EHEDATEN_AS_OF,
		EHEDATEN_ATTRIBUTION,
		EHEDATEN_LICENSE,
		EHEDATEN_LICENSE_URL,
		QUELLE_LABEL,
		STADT_ZUERICH_KIRCHGEMEINDEN,
		STADT_ZUERICH,
		ehedatenDateLabel,
		isJulian,
		namesDiffer,
		trauortVermerk,
		type EhedatenEntry,
		type EhedatenPerson,
	} from "$lib/ehedaten";
	import { EHEDATEN_MEHRFACH_ATTRIBUTION, EHEDATEN_MEHRFACH_URL } from "$lib/ehedatenMehrfach";
	import { catalogPermalink, catalogUnitHref } from "$lib/catalog";
	import { searchViewHref } from "$lib/searchViews";

	let {
		entry,
		sameMarriage = null,
		sameCouple = [],
	}: {
		entry: EhedatenEntry;
		/** Übrige Einträge derselben Ehe laut geprüfter Liste (sicher = Sicherheitswert «Certain»). */
		sameMarriage?: { sicher: boolean; entries: EhedatenEntry[] } | null;
		/** Ungeprüft: weitere Einträge mit denselben Namen, ohne die der Liste. */
		sameCouple?: EhedatenEntry[];
	} = $props();

	const search = (params: Record<string, string>) => searchViewHref("ehedaten", params);
	const stadt = $derived(STADT_ZUERICH_KIRCHGEMEINDEN.includes(entry.kirchgemeinde) && entry.kirchgemeinde !== "Zürich");
</script>

{#snippet person(role: string, p: EhedatenPerson, param: "eheMann" | "eheFrau")}
	<dt class="text-zszh-600 sm:pt-px">{role}</dt>
	<dd class="text-zszh-900 leading-relaxed min-w-0 break-words mb-1 sm:mb-0">
		<a href={search({ [param]: p.name })} class="font-semibold hover:underline hover:text-accent-700" title={`Alle Einträge mit ${p.name} als ${role}`}
			>{p.name}</a
		>
		{#if p.herkunft}
			<span class="block text-zszh-700">
				Herkunft: {p.herkunft}{#if p.ort && p.ort !== p.herkunft}{" "}<span
						class="text-zszh-600"
						title="Herkunft auf die Gemeinde gebracht (Weiler in Klammern zählen zu ihrer Gemeinde) – so filtert «Herkunft»"
						>→ {p.ort}</span
					>{/if}
			</span>
		{/if}
		{#if p.zusatz}
			<span class="block text-zszh-700"><span class="text-zszh-600">Zusatzinfo:</span> {p.zusatz}</span>
		{/if}
		{#if p.hls || p.gnd}
			<span class="block text-xs mt-0.5">
				{#if p.hls}<a href={p.hls} target="_blank" rel="noopener external" class="text-accent-600 underline">Historisches Lexikon der Schweiz ↗</a>{/if}
				{#if p.hls && p.gnd}<span class="text-zszh-400"> · </span>{/if}
				{#if p.gnd}<a href={p.gnd} target="_blank" rel="noopener external" class="text-accent-600 underline">GND ↗</a>{/if}
			</span>
		{/if}
	</dd>
{/snippet}

<section class="bg-white border border-zszh-200 rounded-md px-5 py-4 mb-4" aria-labelledby="eheeintrag">
	<h2 id="eheeintrag" class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-3">
		Eheeintrag <span class="font-normal normal-case tracking-normal text-zszh-600">aus der Ehedatenbank</span>
	</h2>
	<dl class="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-x-6 gap-y-2 text-sm">
		<dt class="text-zszh-600 sm:pt-px">{ART_LABEL[entry.art]}</dt>
		<dd class="text-zszh-900 mb-1 sm:mb-0">
			<span class="font-semibold tabular-nums">{ehedatenDateLabel(entry)}</span>
			{#if entry.art === "verkuendung"}
				<span class="block text-xs text-zszh-600">Datum der Verkündung (Vermerk «Verkünddatum»); getraut wurde oft in einer anderen Kirchgemeinde.</span>
			{/if}
			{#if isJulian(entry)}
				<span class="block text-xs text-zszh-600">Alter Stil: Zürich datierte bis 1700 nach dem julianischen Kalender.</span>
			{/if}
		</dd>
		<dt class="text-zszh-600 sm:pt-px">Kirchgemeinde</dt>
		<dd class="text-zszh-900 mb-1 sm:mb-0">
			<a href={search({ eheKirche: entry.kirchgemeinde })} class="hover:underline hover:text-accent-700">{entry.kirchgemeinde}</a>
			{#if stadt}<span class="text-zszh-600">({STADT_ZUERICH})</span>{/if}
		</dd>
		{@render person("Bräutigam", entry.mann, "eheMann")}
		{@render person("Braut", entry.frau, "eheFrau")}
		<dt class="text-zszh-600 sm:pt-px">Signatur</dt>
		<dd class="text-zszh-900 min-w-0 break-words">
			{entry.signatur}{#if entry.seite}, {entry.seite}{/if}
			<span class="block text-xs text-zszh-600">{QUELLE_LABEL[entry.quelle] ?? entry.quelle}</span>
		</dd>
	</dl>

	{#if sameMarriage && sameMarriage.entries.length > 0}
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mt-4 mb-2">Weitere Einträge zu dieser Ehe</h3>
		<ul class="space-y-1.5 text-sm">
			{#each sameMarriage.entries as other (other.id)}
				{@const vermerk = trauortVermerk(other)}
				{@const extra = [
					namesDiffer(entry, other) ? `eingetragen als ${other.mann.name} und ${other.frau.name}` : "",
					vermerk ? `Vermerk «${vermerk}»` : "",
				]
					.filter(Boolean)
					.join("; ")}
				<li>
					<a href={catalogUnitHref(other.id)} class="text-accent-700 hover:underline">
						{ART_LABEL[other.art]} {ehedatenDateLabel(other)}, Kirchgemeinde {other.kirchgemeinde}
					</a>
					<span class="text-xs text-zszh-600">· {other.signatur}</span>
					{#if extra}<span class="block text-xs text-zszh-600">{extra}</span>{/if}
				</li>
			{/each}
		</ul>
		<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
			Dieselbe Ehe in einem weiteren Kirchenbuch: meist verkündet oder eingetragen in der einen, getraut in der anderen
			Kirchgemeinde («Verkündung»: Der Eintrag vermerkt das Verkünddatum).
			{#if sameMarriage.sicher}Geprüft in der{:else}Laut{/if}
			<a href={EHEDATEN_MEHRFACH_URL} target="_blank" rel="noopener external" class="underline" title={EHEDATEN_MEHRFACH_ATTRIBUTION}
				>Liste der Mehrfacheinträge</a
			> des
			Staatsarchivs{#if !sameMarriage.sicher}{" "}nur wahrscheinlich dieselbe Ehe{/if}.
		</p>
	{/if}

	{#if sameCouple.length > 0}
		<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mt-4 mb-2">
			{sameMarriage ? "Weitere Einträge mit denselben Namen" : "Weitere Einträge zu diesem Paar"}
		</h3>
		<ul class="space-y-1 text-sm">
			{#each sameCouple as other (other.id)}
				<li>
					<a href={catalogUnitHref(other.id)} class="text-accent-700 hover:underline">
						{ART_LABEL[other.art]} {ehedatenDateLabel(other)}, {other.kirchgemeinde}
					</a>
					<span class="text-xs text-zszh-600">· {other.signatur}</span>
				</li>
			{/each}
		</ul>
		<p class="text-xs text-zszh-600 mt-1.5 leading-snug">
			Gleiche Namen, höchstens ein Jahr auseinander: meist dieselbe Ehe, verkündet in der einen und getraut in der anderen
			Kirchgemeinde. Nicht geprüft – gleichnamige Paare sind möglich.
		</p>
	{/if}

	<p class="mt-4 text-xs flex flex-wrap gap-x-4 gap-y-1">
		<a href={search({ eheMann: entry.mann.name, eheFrau: entry.frau.name })} class="text-accent-600 underline">Alle Einträge dieses Paars</a>
		<a href={search({ persons: entry.mann.nachname })} class="text-accent-600 underline">Familie {entry.mann.nachname}</a>
		{#if entry.frau.nachname !== entry.mann.nachname}
			<a href={search({ persons: entry.frau.nachname })} class="text-accent-600 underline">Familie {entry.frau.nachname}</a>
		{/if}
	</p>

	<p class="mt-3 text-xs text-zszh-600 leading-snug">
		Quelle: {EHEDATEN_ATTRIBUTION}, aus dem
		<a href={catalogPermalink(entry.id)} target="_blank" rel="noopener external" class="underline">Online-Archivkatalog</a>
		(Stand {EHEDATEN_AS_OF}), <a href={EHEDATEN_LICENSE_URL} target="_blank" rel="noopener license" class="underline">{EHEDATEN_LICENSE}</a>. Namen vereinheitlicht
		(Meier auch für Meyer), die Schreibung der Vorlage steht in der Zusatzinfo.
		{#if entry.unsicher}Einzelne Angaben sind unsicher gelesen («?»).{/if}
		<a href="/about/ehedaten" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Über die Ehedaten</a>
	</p>
</section>
