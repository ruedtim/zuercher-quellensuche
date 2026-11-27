<script lang="ts">
	// Reiter «Rat»: Wer sass in dieser Ratssitzung im Rat? Die Zusammensetzung
	// kommt aus dem Register des Staatsarchivs und dem Band der Sitzung
	// (lib/server/rat.ts), NICHT aus dem Protokolltext – darum der Hinweis unten.
	// Der Bürgermeister steht zuerst: Er präsidierte und steht meist im
	// Sitzungskopf («Prnt. Herr Rahn und beid Reth.»). Ist sein Name dort mit GND
	// ausgezeichnet, führt «im Text» zur Nennung (RatMentions.svelte).
	import { formatDateDE } from "$lib/format";
	import { RAT_ATTRIBUTION, RAT_PROVENANCE, RAT_SOURCE_URL, ratPersonUrl } from "$lib/rat";
	import type { PageProps } from "./$types";

	type Council = NonNullable<PageProps["data"]["ratCouncil"]>;
	type Member = Council["members"][number];

	let {
		council,
		mentioned,
		onReveal,
	}: {
		council: Council;
		/** Mitglieder, deren Namen im Text markiert sind (Link «im Text»). */
		mentioned: ReadonlySet<number>;
		onReveal: (id: number) => void;
	} = $props();

	const standDE = $derived(council.stand ? formatDateDE(council.stand) : "");
	const mayor = $derived(council.members.find((m) => m.office === "Bürgermeister") ?? null);
	const rest = $derived(council.members.filter((m) => m !== mayor));

	/**
	 * «Zunftmeister · Gerwe · 1627–1646 · Tuchhändler». Die Zunft steht so, wie das
	 * Register sie schreibt – ein ausgeschriebenes «Zunft zur …» wäre bei Kämbel,
	 * Widder und Weggen falsch («zum»). Bei der Constaffel sagt die Funktion alles.
	 */
	function meta(m: Member): string {
		const guild = m.guild && m.guild !== "Constaffel" ? m.guild : "";
		return [m.office, guild, m.years, m.job].filter((s) => s).join(" · ");
	}
</script>

{#snippet links(m: Member)}
	{#if mentioned.has(m.id)}
		<button type="button" onclick={() => onReveal(m.id)} class="text-accent-600 underline hover:text-accent-700">
			im Text<span class="sr-only"> zeigen: {m.name}</span>
		</button>
	{/if}
	{#if m.gnd}
		<a href={m.gnd} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
			GND<span class="sr-only"> zu {m.name}</span></a
		>
	{/if}
	{#if m.hls}
		<a href={m.hls} target="_blank" rel="noopener external" class="text-accent-600 underline hover:text-accent-700">
			HLS<span class="sr-only"> zu {m.name}</span></a
		>
	{/if}
	{#if m.ssrq}
		<a
			href={m.ssrq}
			target="_blank"
			rel="noopener external"
			class="text-accent-600 underline hover:text-accent-700"
			title="Personendatenbank der Sammlung Schweizerischer Rechtsquellen"
		>
			SSRQ<span class="sr-only"> zu {m.name}</span></a
		>
	{/if}
{/snippet}

{#snippet entry(m: Member, lead: boolean)}
	<!-- break-inside-avoid: in zwei Spalten darf ein Eintrag nicht zwischen Name und Amt reissen. -->
	<li class={lead ? "border border-zszh-200 bg-zszh-50 rounded-md p-3" : "py-1.5 break-inside-avoid"}>
		<div class="text-sm text-zszh-900">
			<a href={ratPersonUrl(m.id)} class="{lead ? 'font-semibold' : 'font-medium'} hover:text-accent-600 hover:underline"
				>{m.name}</a
			>
			{#if m.life}<span class="text-zszh-500 text-xs ml-1.5 tabular-nums">{m.life}</span>{/if}
		</div>
		<div
			class="text-xs text-zszh-600 mt-0.5"
			title={m.pages ? `Einsitz ${m.years}; Schnyder S. ${m.pages}` : `Einsitz ${m.years} laut Register`}
		>
			{meta(m)}
		</div>
		{#if m.gnd || m.hls || m.ssrq || mentioned.has(m.id)}
			<div class="flex flex-wrap gap-x-3 text-xs mt-1">{@render links(m)}</div>
		{/if}
	</li>
{/snippet}

<div class="@container bg-white border border-zszh-200 rounded-md p-5 md:p-6">
	<h2 class="font-serif text-lg text-zszh-900 mb-1">
		{council.label}
		<span class="text-zszh-500 font-sans text-sm font-normal tabular-nums">
			({council.members.length} Mitglieder)
		</span>
	</h2>
	<p class="text-xs text-zszh-600 mb-4">
		Wer in diesem Amtshalbjahr im Rat sass – aus dem Register, nicht aus dem Protokoll. Ob jemand an
		dieser Sitzung teilnahm, sagt es nicht.{#if mentioned.size > 0}{" "}In der Transkription mit Normdaten
			ausgezeichnete Namen öffnen eine Karte mit der Personenseite.{/if}
	</p>

	{#if mayor}
		<ul class="mb-3">
			{@render entry(mayor, true)}
		</ul>
	{/if}
	<ul class="divide-y divide-zszh-100 @md:columns-2 @md:gap-x-8">
		{#each rest as m (m.id)}
			{@render entry(m, false)}
		{/each}
	</ul>

	<p class="text-xs text-zszh-500 mt-4 pt-3 border-t border-zszh-100">
		Register:
		<a href={RAT_SOURCE_URL} target="_blank" rel="noopener external" class="underline hover:text-zszh-700">
			{RAT_ATTRIBUTION}
		</a>
		– {RAT_PROVENANCE}{#if standDE}. Stand {standDE}{/if}.
	</p>
</div>
