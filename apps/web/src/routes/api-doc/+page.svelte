<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import "swagger-ui-dist/swagger-ui.css";

	type SpecKey = "v1" | "dts";
	const SPECS: Record<SpecKey, { label: string; url: string }> = {
		v1: { label: "API v1", url: "/api/v1/openapi.json" },
		dts: { label: "DTS 1.0", url: "/api/dts/openapi.json" },
	};
	const SPEC_KEYS: SpecKey[] = ["v1", "dts"];

	// Initiale Spec aus ?spec= (Default v1); deep-linkbar via /api-doc?spec=dts.
	let active = $state<SpecKey>(page.url.searchParams.get("spec") === "dts" ? "dts" : "v1");
	let error = $state<string | null>(null);

	let v1Container: HTMLDivElement | undefined;
	let dtsContainer: HTMLDivElement | undefined;

	// Swagger UI (~1.5 MB) wird lazy einmalig geladen und für beide Specs
	// wiederverwendet; jede Spec wird bei erstem Anzeigen instanziiert und bleibt
	// dann stehen (Try-it-out-State je Spec bleibt erhalten, kein Re-Init-Flackern).
	let SwaggerUIBundle: ((config: Record<string, unknown>) => unknown) | null = null;
	const mounted = new Set<SpecKey>();

	function containerFor(spec: SpecKey): HTMLDivElement | undefined {
		return spec === "v1" ? v1Container : dtsContainer;
	}

	function mount(spec: SpecKey) {
		if (!SwaggerUIBundle || mounted.has(spec)) return;
		const node = containerFor(spec);
		if (!node) return;
		mounted.add(spec);
		SwaggerUIBundle({
			url: SPECS[spec].url,
			domNode: node,
			deepLinking: true,
			tryItOutEnabled: true,
			// Kein externer Spec-Validator (validator.swagger.io) – die Seite macht
			// ausschliesslich same-origin Requests.
			validatorUrl: null,
		});
	}

	function select(spec: SpecKey) {
		if (spec === active) return;
		active = spec;
		mount(spec);
		const url = new URL(page.url);
		if (spec === "v1") url.searchParams.delete("spec");
		else url.searchParams.set("spec", spec);
		goto(url.pathname + url.search, { keepFocus: true, noScroll: true, replaceState: true });
	}

	onMount(async () => {
		try {
			const mod = await import("swagger-ui-dist/swagger-ui-es-bundle.js");
			SwaggerUIBundle = mod.default;
			mount(active);
		} catch (e) {
			console.error("Swagger UI konnte nicht geladen werden:", e);
			error = "Die interaktive Referenz konnte nicht geladen werden.";
		}
	});
</script>

<svelte:head>
	<title>API-Referenz | {SITE_NAME}</title>
	<meta
		name="description"
		content="Interaktive Referenz der öffentlichen APIs der Plattform: JSON-API (/api/v1) und DTS 1.0 (/api/dts), je mit «Try it out» (OpenAPI 3.1)."
	/>
</svelte:head>

<div class="max-w-screen-lg mx-auto px-4 py-8">
	<header class="mb-6">
		<h1 class="font-display text-4xl md:text-5xl leading-none text-zszh-900 mb-3">API-Referenz</h1>
		<p class="text-sm text-zszh-700 mb-4">
			Interaktive Referenz (OpenAPI 3.1) der beiden öffentlichen Lese-APIs: die
			<strong>JSON-API <code>/api/v1</code></strong> und die
			<strong>DTS-1.0-API <code>/api/dts</code></strong> (Distributed Text Services). Grundsätze, Beispiele und Bulk-Daten stehen in der <a href="/about/api" class="underline">API-Dokumentation</a>.
		</p>

		<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
		<div role="tablist" aria-label="API auswählen" class="inline-flex rounded-md border border-zszh-300 bg-zszh-50 p-0.5">
			{#each SPEC_KEYS as key (key)}
				<button
					type="button"
					role="tab"
					aria-selected={active === key}
					class="px-3.5 py-1.5 rounded-md font-medium transition-colors {active === key
						? 'bg-white text-accent-600 shadow-sm'
						: 'text-zszh-600 hover:text-zszh-900'}"
					onclick={() => select(key)}
				>
					{SPECS[key].label}
				</button>
			{/each}
		</div>
			<span class="text-xs leading-6 text-zszh-600">
				Spec: <a href={SPECS[active].url} class="underline">{SPECS[active].url}</a>
			</span>
		</div>
	</header>

	{#if error}
		<p class="text-sm text-red-700">{error}</p>
	{/if}

	<div bind:this={v1Container} role="tabpanel" aria-label="API v1" hidden={active !== "v1"}></div>
	<div bind:this={dtsContainer} role="tabpanel" aria-label="DTS 1.0" hidden={active !== "dts"}></div>
</div>

<style>
	/* Swagger UI: Farben mit zu wenig Kontrast (WCAG 2.2 AA) nachgezogen. */
	:global(.swagger-ui .info .title small pre.version) { background: #4c4a45; }
	:global(.swagger-ui .info .title small.version-stamp pre.version) { background: #3f6600; }
	:global(.swagger-ui .info .title small) { background: transparent; }
	:global(.swagger-ui a.link, .swagger-ui .info .url, .swagger-ui .info a) { color: var(--color-accent-600); }
	:global(.swagger-ui .opblock.opblock-get .opblock-summary-method) { background: #1b5e9e; }
	:global(.swagger-ui .opblock.opblock-post .opblock-summary-method) { background: #1c6b45; }
	:global(.swagger-ui .json-schema-2020-12-expand-deep-button) { color: var(--color-zszh-500); }
</style>
