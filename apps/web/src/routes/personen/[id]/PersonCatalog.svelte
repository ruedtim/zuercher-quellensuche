<script lang="ts">
	import { tick } from "svelte";
	// Abschnitt «Im Archivkatalog» der Personenseite: Verzeichnungseinheiten des
	// Staatsarchivs, die der Person sicher zugeordnet sind (Verweis im Katalog oder Name,
	// Geburtsjahr und Amtszeit im Titel), nach Bestand. Davon abgesetzt die Einheiten mit
	// gleichem Namen (nicht geprüft): nur die Zahl steht in der Seite, die Liste lädt erst
	// ein Klick – Personenseiten werden indexiert.
	import FeedbackDialog from "$lib/components/FeedbackDialog.svelte";
	import {
		CATALOG_COMPLETE_BY,
		CATALOG_IN_PROGRESS,
		catalogUnitHref,
		formatCatalogDate,
		groupByBestand,
		shortTreeName,
		splitCatalogLabel,
		treeNodeName,
		type CatalogUnitRef,
	} from "$lib/catalog";

	let {
		personId,
		secured,
		namesTotal,
	}: {
		personId: number;
		secured: { total: number; units: CatalogUnitRef[] };
		namesTotal: number;
	} = $props();

	const nf = new Intl.NumberFormat("de-CH");
	const groups = $derived(groupByBestand(secured.units));

	let names = $state<{ total: number; units: CatalogUnitRef[] } | null>(null);
	let namesState = $state<"idle" | "loading" | "error">("idle");
	const nameGroups = $derived(names ? groupByBestand(names.units) : []);

	let namesEl = $state<HTMLDivElement | null>(null);

	async function loadNames() {
		if (namesState === "loading") return;
		namesState = "loading";
		try {
			const res = await fetch(`/api/catalog/person?id=${personId}`);
			if (!res.ok) throw new Error(String(res.status));
			names = await res.json();
			namesState = "idle";
			// Der Knopf ist weg: weiter bei der geladenen Liste.
			await tick();
			namesEl?.focus({ preventScroll: true });
		} catch {
			namesState = "error";
		}
	}
</script>

{#snippet unitList(list: Array<{ bestand: string | null; bestandId: number | null; units: CatalogUnitRef[] }>)}
	{#each list as group (group.bestand ?? "")}
		<div class="mb-4 last:mb-0">
			<h4 class="text-xs text-zszh-600 mb-1">
				{#if group.bestand && group.bestandId != null}
					<a href={catalogUnitHref(group.bestandId)} class="hover:text-accent-600 hover:underline">{splitCatalogLabel(group.bestand).name}</a>
				{:else}
					{group.bestand ? splitCatalogLabel(group.bestand).name : "Ohne Bestand"}
				{/if}
			</h4>
			<ul class="space-y-1 text-sm">
				{#each group.units as unit (unit.id)}
					{@const name = treeNodeName(unit)}
					<li>
						<a
							href={catalogUnitHref(unit.id)}
							title={shortTreeName(name) !== name ? name : undefined}
							class="text-zszh-900 hover:text-accent-600 hover:underline">{shortTreeName(name)}</a
						>
						{#if unit.dateText}<span class="text-zszh-600 whitespace-nowrap">· {formatCatalogDate(unit.dateText)}</span>{/if}
						{#if unit.level}<span class="text-xs text-zszh-500">{unit.level}</span>{/if}
						{#if unit.hasDigitization}<span class="text-xs text-zszh-500">· Digitalisat</span>{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/each}
{/snippet}

<section id="archivkatalog" aria-labelledby="catalog-heading" class="mt-8 scroll-mt-4">
	<h2 id="catalog-heading" class="font-serif text-xl text-zszh-900 mb-1">Im Archivkatalog</h2>
	<p class="text-sm text-zszh-600 mb-3">
		Verzeichnungseinheiten des Staatsarchivs Zürich (Akten, Fotos, Dossiers), ohne Volltext.
	</p>

	{#if secured.total > 0}
		<div class="bg-white border border-zszh-200 rounded-md p-4">
			<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-2">
				Zugeordnet <span class="font-normal normal-case tracking-normal tabular-nums">({nf.format(secured.total)})</span>
			</h3>
			{@render unitList(groups)}
			{#if secured.total > secured.units.length}
				<p class="mt-2 text-xs text-zszh-600">
					Die ersten {nf.format(secured.units.length)} von {nf.format(secured.total)} Einheiten.
				</p>
			{/if}
			<p class="mt-3 text-xs text-zszh-500">
				Zugeordnet über einen Verweis des Katalogs auf die Kantonsratsdatenbank oder über Name, Geburtsjahr und
				Amtszeit im Titel.
			</p>
		</div>
	{/if}

	{#if namesTotal > 0}
		<div class="mt-4 bg-zszh-50 border border-zszh-200 rounded-md p-4">
			<h3 class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-1">
				Weitere Einheiten mit gleichem Namen – nicht geprüft
				<span class="font-normal normal-case tracking-normal tabular-nums">({nf.format(namesTotal)})</span>
			</h3>
			<p class="text-xs text-zszh-600 mb-2">
				Gleicher Name, passende Lebenszeit. Ob es dieselbe Person ist, ist nicht geprüft.
			</p>
			{#if names}
				<div bind:this={namesEl} tabindex="-1" role="group" aria-label="Einheiten mit gleichem Namen" class="focus:outline-none">
					{@render unitList(nameGroups)}
					{#if names.total > names.units.length}
						<p class="mt-2 text-xs text-zszh-600">
							Die ersten {nf.format(names.units.length)} von {nf.format(names.total)} Einheiten.
						</p>
					{/if}
				</div>
			{:else}
				<button
					type="button"
					onclick={loadNames}
					aria-disabled={namesState === "loading"}
					class="text-sm text-accent-600 underline hover:text-accent-700 aria-disabled:text-zszh-500 aria-disabled:no-underline"
				>
					{namesState === "loading" ? "Wird geladen …" : "Anzeigen"}
				</button>
				{#if namesState === "error"}
					<span class="ml-2 text-xs text-zszh-600" role="alert">Konnte nicht geladen werden.</span>
				{/if}
			{/if}
		</div>
	{/if}

	<p class="mt-3 text-xs text-zszh-500 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<span>
			Beschreibungen aus dem Online-Archivkatalog des Staatsarchivs Zürich.
			{#if CATALOG_IN_PROGRESS}
				<a href="/about/archivkatalog" class="underline decoration-dotted underline-offset-2 hover:text-zszh-700"
					>Katalog noch im Aufbau</a
				>, vollständig {CATALOG_COMPLETE_BY}.
			{/if}
		</span>
		<FeedbackDialog variant="link" label="Zuordnung melden" />
	</p>
</section>
