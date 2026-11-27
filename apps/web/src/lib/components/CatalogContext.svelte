<script lang="ts">
	// Archivplan-Kontext im Kopf der Katalogseite, nach dem «Archivplankontext» des
	// Online-Katalogs: die Stufen über dem Bestand als Zeile (alle Stufen aufklappbar), ab
	// dem Bestand als Treppe mit Datum und Stufe, darin die Einheit selbst zwischen der
	// vorigen und der nächsten Einheit derselben Stufe, darunter ihre Position. Stufen im
	// Index führen auf ihre Seite, übrige in den Online-Katalog. Auf der Dokumentseite
	// (Reiter «Archivkatalog») ohne Nachbarn, die Einheit führt dort auf ihre Seite.
	import {
		catalogPermalink,
		catalogPositionLabel,
		catalogUnitHref,
		formatCatalogDate,
		shortTreeName,
		splitArchivePath,
		treeNodeName,
		type CatalogNeighbors,
		type CatalogPathNode,
		type CatalogTreeNode,
	} from "$lib/catalog";

	type PathNode = CatalogPathNode;

	let {
		path,
		known,
		unit,
		neighbors,
		unitHref = null,
	}: {
		path: PathNode[];
		known: ReadonlySet<number>;
		unit: { signature: string; title: string; level: string; dateText: string };
		neighbors: CatalogNeighbors | null;
		/** Seite der Einheit, wenn der Kontext nicht auf ihr selbst steht. */
		unitHref?: string | null;
	} = $props();

	/** Alle Stufen als Treppe; bleibt beim Blättern zur nächsten Einheit so. */
	let expanded = $state(false);
	const split = $derived(splitArchivePath(path));
	const line = $derived(expanded ? [] : split.line);
	const stairs = $derived(expanded ? path : split.stairs);
	const position = $derived(
		neighbors && neighbors.pos >= 1 && neighbors.total >= neighbors.pos
			? catalogPositionLabel(neighbors.pos, neighbors.total, path.at(-1)?.name ?? "")
			: null,
	);
	const unitName = $derived(treeNodeName(unit));
	/** Einrückung je Stufe mit Führungslinie wie im Archivbaum, schmal enger. */
	const INDENT = "ml-1 pl-2 sm:ml-1.5 sm:pl-3 border-l";
</script>

{#snippet toggle()}
	{#if split.line.length > 0}
		<button
			type="button"
			class="ml-1 text-xs text-zszh-600 underline decoration-dotted underline-offset-2 hover:text-accent-600 no-print"
			aria-expanded={expanded ? "true" : "false"}
			aria-controls="archivplan-stufen"
			onclick={() => (expanded = !expanded)}>{expanded ? "weniger Stufen" : "alle Stufen"}</button
		>
	{/if}
{/snippet}

{#snippet stageLink(node: PathNode)}
	{#if known.has(node.id)}
		<a href={catalogUnitHref(node.id)} title={node.label} class="hover:text-accent-600 hover:underline">{node.name}</a>
	{:else}
		<a href={catalogPermalink(node.id)} title={node.label} target="_blank" rel="noopener" class="hover:text-accent-600 hover:underline"
			>{node.name} ↗</a
		>
	{/if}
{/snippet}

{#snippet meta(date: string | null, level: string | null)}
	{#if date}<span class="text-zszh-600 whitespace-nowrap">· {date}</span>{/if}
	{#if level}<span class="text-xs text-zszh-500">{level}</span>{/if}
{/snippet}

{#snippet sibling(node: CatalogTreeNode)}
	{@const name = treeNodeName(node)}
	{@const short = shortTreeName(name)}
	<li class="py-0.5">
		<a href={catalogUnitHref(node.id)} title={short !== name ? name : undefined} class="text-zszh-800 hover:text-accent-600 hover:underline"
			>{short}</a
		>
		{@render meta(formatCatalogDate(node.dateText), node.level)}
	</li>
{/snippet}

{#snippet level(i: number)}
	{#if i < stairs.length}
		<li>
			<div class="py-0.5">
				{@render stageLink(stairs[i])}
				{@render meta(stairs[i].date, stairs[i].level)}
				{#if expanded && i === 0}{@render toggle()}{/if}
			</div>
			<ul class={INDENT + " border-zszh-200"}>
				{@render level(i + 1)}
			</ul>
			{#if i === stairs.length - 1 && position}
				<p class={INDENT + " border-transparent mt-0.5 text-xs leading-6 text-zszh-600 flex flex-wrap items-baseline gap-x-1.5"}>
					{#if neighbors?.prev}
						<a href={catalogUnitHref(neighbors.prev.id)} rel="prev" title={treeNodeName(neighbors.prev)} class="text-accent-600 hover:underline"
							>‹ vorherige</a
						>
						<span aria-hidden="true">·</span>
					{/if}
					<span>{position}</span>
					{#if neighbors?.next}
						<span aria-hidden="true">·</span>
						<a href={catalogUnitHref(neighbors.next.id)} rel="next" title={treeNodeName(neighbors.next)} class="text-accent-600 hover:underline"
							>nächste ›</a
						>
					{/if}
				</p>
			{/if}
		</li>
	{:else}
		{#if neighbors?.prev}{@render sibling(neighbors.prev)}{/if}
		<li class="py-0.5">
			{#if unitHref}
				<a
					href={unitHref}
					title={shortTreeName(unitName) !== unitName ? unitName : undefined}
					class="-mx-1 px-1 rounded bg-zszh-100 box-decoration-clone font-semibold text-zszh-900 hover:text-accent-600 hover:underline"
					>{shortTreeName(unitName)}</a
				>
			{:else}
				<span
					aria-current="page"
					title={shortTreeName(unitName) !== unitName ? unitName : undefined}
					class="-mx-1 px-1 rounded bg-zszh-100 box-decoration-clone font-semibold text-zszh-900">{shortTreeName(unitName)}</span
				>
			{/if}
			{@render meta(formatCatalogDate(unit.dateText), unit.level)}
		</li>
		{#if neighbors?.next}{@render sibling(neighbors.next)}{/if}
	{/if}
{/snippet}

<nav aria-label="Archivplan" class="text-sm text-zszh-900 leading-snug">
	{#if line.length > 0}
		<p class="text-xs text-zszh-600 leading-relaxed mb-1">
			{#each line as node, i (node.id)}
				{#if i > 0}<span class="text-zszh-400" aria-hidden="true">{" › "}</span>{/if}
				{@render stageLink(node)}
			{/each}
			{@render toggle()}
		</p>
	{/if}
	<ul id="archivplan-stufen">
		{@render level(0)}
	</ul>
</nav>
