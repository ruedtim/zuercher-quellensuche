<script lang="ts">
	// Reiter «Alle Quellen» (docs/alle-quellen-plan.md): je Quelle ein Block in fester
	// Reihenfolge – Archivkatalog, Zentrale Serien, Ehedaten, Editionen – mit Trefferzahl, den
	// ersten Treffern als kompakte Zeilen und dem Link «alle N im Reiter». Ohne jede Eingabe
	// (landing) stattdessen der Landeplatz: Bestand, Zeitraum und ein Einstieg je Quelle.
	// Ein Block ohne Treffer bleibt stehen (gestrichelt), damit die
	// Quelle sichtbar bleibt. Auf dem Handy zeigt jeder Block drei Zeilen, ab sm alle.
	import { CATALOG_IN_PROGRESS, catalogUnitHref, formatCatalogDate, type CatalogResult } from "$lib/catalog";
	import { ART_LABEL, ehedatenDateLabel, isEhedatenSignature, type EhedatenResult } from "$lib/ehedaten";
	import { editionDateLabel, editionLabel, editionShort, editionUnitPath, type EditionsResult } from "$lib/editionTexts";
	import { editionRegisterHref } from "$lib/editionRegister";
	import { oldStyleSuffix } from "$lib/format";
	import { unappliedNote, type SearchView } from "$lib/searchViews";
	import type { DocumentResultView } from "$lib/types";

	type Source = Exclude<SearchView, "all">;

	let {
		landing,
		documents,
		catalog,
		ehedaten,
		editions,
		counts,
		unapplied,
		hrefs,
		available,
		contextSearch,
		documentBounds,
	}: {
		landing: boolean;
		/** Dokumentsuche (erste Treffer bzw. beim Landeplatz nur die Zahl). */
		documents: DocumentResultView;
		catalog: CatalogResult | null;
		ehedaten: EhedatenResult | null;
		editions: EditionsResult | null;
		/** Trefferzahl je Quelle (null = nicht zählbar). */
		counts: Record<Source, number | null>;
		/** Geteilte Felder, die eine Quelle nicht anwenden kann (unappliedSharedFilters): Zahl und
		 *  erste Treffer gälten für eine andere Auswahl, der Block nennt nur den Grund. */
		unapplied: Record<Source, string[]>;
		/** Link in den Reiter der Quelle mit allen Eingaben. */
		hrefs: Record<Source, string>;
		available: Record<Source, boolean>;
		/** Querystring der aktuellen Suche für den Rückweg von der Detailseite. */
		contextSearch: string;
		/** Jahre des Dokumentbestands (Landeplatz). */
		documentBounds: { min: number; max: number };
	} = $props();

	const nf = (n: number) => n.toLocaleString("de-CH");
	const from = $derived(contextSearch ? `?from=${encodeURIComponent(contextSearch)}` : "");
	const docHref = (series: string, id: string, pos: number) =>
		`/documents/${series}/${id}?${new URLSearchParams({ ...(contextSearch ? { from: contextSearch } : {}), pos: String(pos) })}`;
	const editionHref = (edition: string, localId: string, pos: number) =>
		`${editionUnitPath(edition, localId)}?${new URLSearchParams({ ...(contextSearch ? { from: contextSearch } : {}), pos: String(pos) })}`;
	// Reihenfolge wie die Reiterleiste: Archivkatalog zuerst (Tim 2026-11-02), dann Zentrale Serien;
	// Ehedaten zuletzt (Tim 2026-11-17).
	const SOURCES: ReadonlyArray<{ id: Source; label: string; unit: [string, string] }> = [
		{ id: "catalog", label: "Archivkatalog", unit: ["Verzeichnungseinheit", "Verzeichnungseinheiten"] },
		{ id: "documents", label: "Zentrale Serien", unit: ["Dokument", "Dokumente"] },
		{ id: "editions", label: "Editionen", unit: ["Stück", "Stücke"] },
		{ id: "ehedaten", label: "Ehedaten", unit: ["Eheeintrag", "Eheeinträge"] },
	];
	const units = (s: (typeof SOURCES)[number], n: number) => (n === 1 ? s.unit[0] : s.unit[1]);
	const countOf = (id: Source): number | null => (id === "documents" ? documents.estimatedTotalHits : counts[id]);
	// Zeilen ab der vierten nur ab sm (Handy: drei je Block).
	const rowClass = (i: number) => (i >= 3 ? "hidden sm:block" : "");
</script>

{#snippet header(s: (typeof SOURCES)[number], n: number | null)}
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
		<h3 class="text-sm font-semibold text-zszh-900">
			{s.label}
			{#if n != null}
				<span class="font-normal text-zszh-600 tabular-nums">· {nf(n)} {units(s, n)}</span>
			{/if}
		</h3>
		{#if n != null && n > 0}
			<a href={hrefs[s.id]} data-sveltekit-noscroll class="text-xs text-accent-600 hover:underline">
				{landing ? "Zum Reiter →" : n === 1 ? "Im Reiter →" : `Alle ${nf(n)} im Reiter →`}
			</a>
		{/if}
	</div>
{/snippet}

<div class="space-y-4">
	{#if landing}
		<p class="text-sm text-zszh-700">
			Suchbegriff, Thema, Zeitraum oder Namen zeigen hier je Quelle die ersten Treffer; die Reiter führen in die ganze Trefferliste.
		</p>
	{/if}

	{#each SOURCES as s (s.id)}
		{@const n = countOf(s.id)}
		{#if available[s.id]}
			{#if landing}
				<section class="border-t-2 border-zszh-900 pt-3 pb-2">
					{@render header(s, n)}
					{#if s.id === "documents"}
						<p class="text-sm text-zszh-700">
							{documentBounds.min < 1803
								? `Ratsmanuale ab ${documentBounds.min}, dazu Regierungsrat, Kantonsrat, Gesetzessammlung und Amtsblatt ab 1803 bis heute.`
								: `Volltexte von Regierungsrat, Kantonsrat, Gesetzessammlung und Amtsblatt, ${documentBounds.min} bis heute.`}
							<a href={hrefs.documents} class="text-accent-600 hover:underline">Liste nach Datum, Serien und Filter</a>
							· <a href="/personen" class="text-accent-600 hover:underline">Rats- und Regierungsmitglieder</a>
						</p>
					{:else if s.id === "catalog"}
						<p class="text-sm text-zszh-700">
							Verzeichnungseinheiten des Staatsarchivs – Akten, Urkunden, Pläne, Nachlässe – ohne Volltext, ab dem Mittelalter.
							<a href={hrefs.catalog} class="text-accent-600 hover:underline">Archivplan durchblättern</a>
							· <a href="/archivkatalog/register" class="text-accent-600 hover:underline">Register</a>
							{#if CATALOG_IN_PROGRESS}
								· <a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Katalog noch im Aufbau</a>
							{/if}
						</p>
					{:else if s.id === "ehedaten"}
						<p class="text-sm text-zszh-700">
							Trauungen und Verkündungen aus den Zürcher Kirchenbüchern 1524–1800, nach Namen, Herkunft und Kirchgemeinde.
							<a href={hrefs.ehedaten} class="text-accent-600 hover:underline">Namenssuche</a>
						</p>
					{:else}
						<p class="text-sm text-zszh-700">
							Edierte Quellenstücke mit Regest, Anmerkungen und Kommentar: Quellen zur Zürcher Geschichte 1275–1795 und Zürcher Rechtsquellen 1180–1800.
							<a href={hrefs.editions} class="text-accent-600 hover:underline">Stücke durchsehen</a>
							· <a href={editionRegisterHref("personen")} class="text-accent-600 hover:underline">Register</a>
							· <a href="/about/editionen" class="text-accent-600 hover:underline">Über die Editionen</a>
						</p>
					{/if}
				</section>
			{:else if unapplied[s.id].length > 0}
				<section class="border border-dashed border-zszh-300 rounded-md px-4 py-3 text-sm text-zszh-600">
					{s.label} · {unappliedNote(unapplied[s.id], "dort")}
				</section>
			{:else if n === 0 || n === null}
				<section class="border border-dashed border-zszh-300 rounded-md px-4 py-3 text-sm text-zszh-600">
					{s.label} · {n === null ? "nicht zählbar" : "keine Treffer"}
				</section>
			{:else}
				<section class="border-t-2 border-zszh-900 pt-3 pb-2">
					{@render header(s, n)}
					{#if s.id === "documents"}
						<ul class="divide-y divide-zszh-200">
							{#each documents.hits as hit, i (hit.id)}
								<li class="relative group py-2 {rowClass(i)}">
									<div>
										<div class="flex flex-wrap items-baseline gap-x-2 text-xs text-zszh-600">
											<span class="badge-code">{hit.series}</span>
											{#if hit.date}<time>{hit.date}{oldStyleSuffix(hit.series, hit.date)}</time>{/if}
										</div>
										<p class="font-serif text-base font-semibold text-zszh-900 leading-tight group-hover:text-accent-700 kwic">
											<a href={docHref(hit.series, hit.id, i)} class="hit-link">{@html hit.titleHtml}</a>
										</p>
										{#if hit.textHtml}
											<p class="text-xs text-zszh-700 mt-0.5 leading-relaxed line-clamp-2 kwic">…{@html hit.textHtml}…</p>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{:else if s.id === "catalog" && catalog}
						<ul class="divide-y divide-zszh-200">
							{#each catalog.hits as hit, i (hit.id)}
								<li class="relative group py-2 {rowClass(i)}">
									<div>
										<div class="flex flex-wrap items-baseline gap-x-2 text-xs text-zszh-600">
											<span class="px-1.5 py-0.5 bg-zszh-100 text-zszh-700 rounded">{hit.level}</span>
											{#if hit.dateText}<span>{formatCatalogDate(hit.dateText)}</span>{/if}
											{#if hit.signature}<span>· {hit.signature}</span>{/if}
											{#if isEhedatenSignature(hit.signature)}<span class="text-accent-700">· Eheeintrag</span>{/if}
										</div>
										<p class="font-serif text-base font-semibold text-zszh-900 leading-tight whitespace-pre-line group-hover:text-accent-700 kwic"
											><a href={`${catalogUnitHref(hit.id)}${from}`} class="hit-link">{@html hit.titleHtml}</a></p
										>
										{#if hit.bestand}<p class="text-xs text-zszh-600 mt-0.5">{hit.bestand}</p>{/if}
									</div>
								</li>
							{/each}
						</ul>
					{:else if s.id === "ehedaten" && ehedaten}
						<ul class="divide-y divide-zszh-200">
							{#each ehedaten.hits as hit, i (hit.id)}
								<li class="relative group py-2 {rowClass(i)}">
									<div>
										<div class="flex flex-wrap items-baseline gap-x-2 text-xs text-zszh-600">
											<span class="tabular-nums font-medium text-zszh-800">{ehedatenDateLabel(hit)}</span>
											{#if hit.art === "verkuendung"}<span>· {ART_LABEL.verkuendung}</span>{/if}
											<span>· {hit.kirchgemeinde}</span>
										</div>
										<p class="text-sm leading-snug group-hover:text-accent-700">
											<a href={`${catalogUnitHref(hit.id)}${from}`} class="hit-link"
												><span class="font-medium text-zszh-900 kwic">{@html hit.html.mannName}</span
												>{#if hit.html.mannHerkunft}<span class="text-zszh-600 kwic">, {@html hit.html.mannHerkunft}</span>{/if}
												<span class="text-zszh-500" aria-hidden="true">⚭</span><span class="sr-only">getraut mit</span>
												<span class="font-medium text-zszh-900 kwic">{@html hit.html.frauName}</span
												>{#if hit.html.frauHerkunft}<span class="text-zszh-600 kwic">, {@html hit.html.frauHerkunft}</span>{/if}</a
											>
										</p>
									</div>
								</li>
							{/each}
						</ul>
					{:else if s.id === "editions" && editions}
						<ul class="divide-y divide-zszh-200">
							{#each editions.hits as hit, i (hit.id)}
								{@const date = editionDateLabel(hit.isoFrom, hit.isoTo)}
								<li class="relative group py-2 {rowClass(i)}">
									<div>
										<div class="flex flex-wrap items-baseline gap-x-2 text-xs text-zszh-600">
											<span class="badge-code" title={hit.part}>{editionShort(hit.edition)}</span>
											<span class={hit.edition === "qzh" ? "font-mono" : ""}>{editionLabel(hit)}</span>
											{#if date}<time datetime={hit.isoFrom ?? undefined}>{date}</time>{/if}
											{#if hit.signature}<span>· {hit.signature}</span>{/if}
										</div>
										<p class="font-serif text-base font-semibold text-zszh-900 leading-tight group-hover:text-accent-700 kwic">
											<a href={editionHref(hit.edition, hit.localId, i)} class="hit-link">{@html hit.titleHtml}</a>
										</p>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/if}
	{/each}
</div>
