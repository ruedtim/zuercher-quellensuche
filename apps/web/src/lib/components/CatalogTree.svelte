<script lang="ts">
	import { tick } from "svelte";
	// Archivbaum unter einer Stufe: Untereinheiten in Archivplan-Reihenfolge, jede mit
	// eigenen Untereinheiten aufklappbar (nachgeladen über /api/catalog/children),
	// je CATALOG_TREE_PAGE Einträge mit «weitere laden». Aufklapp-Knöpfe nach dem
	// Disclosure-Muster (aria-expanded), keine Baum-Tastatursteuerung. `expanded`: schon
	// aufgeklappte Untereinheiten (Startansicht des Katalog-Reiters der Suchseite).
	import {
		CATALOG_TREE_PAGE,
		catalogUnitHref,
		formatCatalogDate,
		shortTreeName,
		treeNodeName,
		type CatalogChildren,
		type CatalogTreeNode,
	} from "$lib/catalog";
	import CatalogTree from "$lib/components/CatalogTree.svelte";

	let {
		parentId,
		initial,
		depth = 0,
		expanded = {},
	}: { parentId: number; initial: CatalogChildren; depth?: number; expanded?: Record<number, CatalogChildren> } = $props();

	// Bewusst nur der Startwert: die Liste wächst danach mit «weitere laden».
	// svelte-ignore state_referenced_locally
	let items = $state(initial.items);
	// svelte-ignore state_referenced_locally
	let total = $state(initial.total);
	let loadingMore = $state(false);
	let failed = $state(false);
	// svelte-ignore state_referenced_locally
	let open = $state<Record<number, CatalogChildren | "loading" | "error">>({ ...expanded });

	const nf = new Intl.NumberFormat("de-CH");

	async function fetchChildren(id: number, offset: number): Promise<CatalogChildren> {
		const res = await fetch(`/api/catalog/children?parent=${id}&offset=${offset}`);
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as CatalogChildren;
	}

	async function toggle(id: number) {
		if (open[id]) {
			delete open[id];
			return;
		}
		open[id] = "loading";
		try {
			open[id] = await fetchChildren(id, 0);
		} catch {
			open[id] = "error";
		}
	}

	let listEl = $state<HTMLUListElement | null>(null);

	async function more() {
		if (loadingMore) return;
		loadingMore = true;
		failed = false;
		try {
			const before = items.length;
			const next = await fetchChildren(parentId, before);
			const seen = new Set(items.map((n) => n.id));
			items = [...items, ...next.items.filter((n) => !seen.has(n.id))];
			total = next.total;
			// Der Knopf rückt nach unten oder fällt weg: weiter beim ersten neuen Eintrag.
			await tick();
			listEl?.children[before]?.querySelector("a")?.focus({ preventScroll: true });
		} catch {
			failed = true;
		} finally {
			loadingMore = false;
		}
	}

	const meta = (node: CatalogTreeNode) =>
		[
			formatCatalogDate(node.dateText),
			node.level,
			node.childCount > 0 ? `${nf.format(node.childCount)} ${node.childCount === 1 ? "Untereinheit" : "Untereinheiten"}` : "",
		].filter(Boolean);
</script>

<ul bind:this={listEl} class={depth > 0 ? "ml-2 pl-3 border-l border-zszh-200" : ""}>
	{#each items as node (node.id)}
		{@const sub = open[node.id]}
		{@const name = treeNodeName(node)}
		{@const short = shortTreeName(name)}
		<li>
			<div class="flex items-start gap-1.5 py-1">
				{#if node.childCount > 0}
					<button
						type="button"
						class="w-5 h-5 -ml-0.5 shrink-0 inline-flex items-center justify-center rounded text-zszh-600 hover:text-accent-600 hover:bg-zszh-100"
						aria-expanded={sub ? "true" : "false"}
						aria-controls={`tree-${node.id}`}
						aria-label={`${sub ? "Zuklappen" : "Aufklappen"}: ${name}`}
						onclick={() => toggle(node.id)}
					>
						<span aria-hidden="true" class="text-xs">{sub ? "▾" : "▸"}</span>
					</button>
				{:else}
					<span class="w-5 shrink-0" aria-hidden="true"></span>
				{/if}
				<div class="min-w-0 text-sm leading-snug">
					<!-- Urkunden tragen Regest-lange Titel: im Baum gekürzt, ganz im Tooltip und auf der Seite. -->
					<a href={catalogUnitHref(node.id)} title={short !== name ? name : undefined} class="text-zszh-900 hover:text-accent-600 hover:underline"
						>{short}</a
					>
					<!-- Schmal eine eigene Zeile, breit hinter dem Titel. -->
					<span class="block sm:inline text-xs text-zszh-600">
						{#each meta(node) as part, i (i)}
							{#if i > 0}{" · "}{:else}<span class="hidden sm:inline">{" · "}</span>{/if}<span class="whitespace-nowrap">{part}</span>
						{/each}
					</span>
					{#if node.doc}
						<a href={`/documents/${node.doc.series}/${encodeURIComponent(node.doc.id)}`} class="text-xs text-accent-600 hover:underline">
							Dokument
						</a>
					{/if}
				</div>
			</div>
			{#if sub === "loading"}
				<p class="ml-7 text-xs text-zszh-500" id={`tree-${node.id}`}>lädt …</p>
			{:else if sub === "error"}
				<p class="ml-7 text-xs text-zszh-600" id={`tree-${node.id}`} role="alert">Untereinheiten konnten nicht geladen werden.</p>
			{:else if sub}
				<div id={`tree-${node.id}`}>
					<CatalogTree parentId={node.id} initial={sub} depth={depth + 1} />
				</div>
			{/if}
		</li>
	{/each}
</ul>
{#if items.length < total}
	<div class="{depth > 0 ? 'ml-2 pl-3' : ''} mt-1 flex flex-wrap items-baseline gap-x-3 text-xs">
		<button
			type="button"
			class="ml-6 text-accent-600 underline hover:text-accent-700 aria-disabled:opacity-50"
			aria-disabled={loadingMore}
			onclick={more}
		>
			{loadingMore ? "lädt …" : `${nf.format(Math.min(CATALOG_TREE_PAGE, total - items.length))} weitere laden`}
		</button>
		<span class="text-zszh-500 tabular-nums">{nf.format(items.length)} von {nf.format(total)}</span>
		{#if failed}<span class="text-zszh-600" role="alert">Laden fehlgeschlagen.</span>{/if}
	</div>
{/if}
