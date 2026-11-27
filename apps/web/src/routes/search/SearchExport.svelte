<script lang="ts">
	// «Alle Treffer herunterladen»: Treffermenge der aktuellen Suche als Tabelle
	// (CSV/Excel) oder ZIP mit Volltexten (+ IIIF-Sammlung). Popup-Muster wie
	// DownloadPackage (Dokumentseite), Mobile-Overlay wie FeedbackDialog.
	//
	// Der Download läuft über ein verstecktes iframe (iframeDownload.ts): ein Fehler
	// (z. B. 429/503 bei vielen Downloads) erscheint hier im Popup, die Suchseite bleibt.
	import { iframeDownload } from "$lib/iframeDownload";
	import { searchParamsToUrl } from "$lib/searchParams";
	import { DEFAULT_SEARCH, type SearchParams, type SearchResponse } from "$lib/types";
	import {
		exportableCount,
		exportCountLabel,
		type ExportContent,
		type ExportFormat,
	} from "$lib/exportLimits";

	let {
		params,
		result,
		disabled = false,
	}: {
		params: SearchParams;
		result: Pick<SearchResponse, "estimatedTotalHits" | "rankedPool" | "topKOfTotal" | "themeRankedAll">;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	let content = $state<ExportContent>("table");
	let format = $state<ExportFormat>("csv");
	let phase = $state<"idle" | "started" | "error">("idle");
	let errorText = $state("");

	let popoverEl: HTMLDivElement | null = $state(null);
	let buttonEl: HTMLButtonElement | null = $state(null);

	const OPTIONS: Array<{ value: ExportContent; label: string; hint: string }> = [
		{
			value: "table",
			label: "Trefferliste als Tabelle",
			hint: "ID, Signatur, Titel, Datum, Serie und Links (Detailseite, TEI-Quelle, IIIF-Manifest)",
		},
		{
			value: "text",
			label: "Tabelle + Volltexte (ZIP)",
			hint: "zusätzlich eine .txt-Datei pro Dokument",
		},
		{
			value: "iiif",
			label: "Tabelle + Volltexte + IIIF-Sammlung (ZIP)",
			hint: "zusätzlich eine IIIF-Sammlung, um alle Faksimiles z. B. in Mirador zu öffnen",
		},
	];

	const counts = $derived(
		Object.fromEntries(OPTIONS.map((o) => [o.value, exportableCount(o.value, result)])) as Record<
			ExportContent,
			ReturnType<typeof exportableCount>
		>,
	);
	const selected = $derived(counts[content]);

	function toggle() {
		open = !open;
		// Fokus ins Fenster, damit Screenreader es ansagen.
		if (open) queueMicrotask(() => popoverEl?.focus());
		if (open && phase !== "started") {
			phase = "idle";
			errorText = "";
		}
	}

	function close() {
		open = false;
	}

	/** Escape und «Abbrechen»: zurück zum Knopf, sonst verliert die Tastatur ihren Ort. */
	function dismiss() {
		close();
		buttonEl?.focus();
	}

	function onDocClick(event: MouseEvent) {
		if (!open) return;
		const t = event.target as Node;
		if (popoverEl?.contains(t)) return;
		if (buttonEl?.contains(t)) return;
		close();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === "Escape" && open) dismiss();
	}

	$effect(() => {
		if (typeof window === "undefined") return;
		document.addEventListener("click", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("click", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	});

	function exportUrl(): string {
		const url = searchParamsToUrl(
			{ ...params, page: 1, pageSize: DEFAULT_SEARCH.pageSize },
			new URL("/api/search/export", window.location.origin),
		);
		url.searchParams.set("content", content);
		url.searchParams.set("format", format);
		return url.pathname + url.search;
	}

	let startedTimer: ReturnType<typeof setTimeout> | null = null;

	function start() {
		if (disabled || phase === "started") return;
		phase = "started";
		errorText = "";
		iframeDownload(exportUrl(), (text) => {
			phase = "error";
			errorText = text;
			open = true;
		});
		if (startedTimer) clearTimeout(startedTimer);
		startedTimer = setTimeout(() => {
			if (phase === "started") phase = "idle";
		}, 8_000);
	}
</script>

<div class="relative inline-block">
	<button
		type="button"
		bind:this={buttonEl}
		onclick={toggle}
		aria-expanded={open}
		aria-haspopup="dialog"
		title="Alle Treffer dieser Suche als Tabelle oder mit Volltexten herunterladen"
		class="inline-flex items-center gap-1 hover:text-zszh-900 hover:underline"
	>
		<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"
			/>
		</svg>
		Alle Treffer herunterladen
	</button>

	{#if open}
		<!-- Mobile: zentriertes Overlay (das Popup ragte sonst über den Rand);
		     ab sm hängt es rechtsbündig am Auslöser. -->
		<div
			class="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-3 pt-6 sm:static sm:block sm:bg-transparent sm:p-0"
		>
			<div
				bind:this={popoverEl}
				role="dialog"
				tabindex="-1"
				aria-label="Alle Treffer herunterladen"
				class="relative z-50 w-full max-w-sm max-h-[85vh] overflow-y-auto sm:absolute sm:z-30 sm:right-0 sm:mt-2 sm:max-h-none sm:overflow-visible sm:w-[min(24rem,calc(100vw-2rem))] bg-white border border-zszh-200 rounded-md shadow-lg p-4 text-sm text-zszh-800 text-left"
			>
				<fieldset class="mb-3">
					<legend class="font-medium text-zszh-900 mb-1.5">Inhalt</legend>
					{#each OPTIONS as opt (opt.value)}
						<label class="flex items-start gap-2 py-1 cursor-pointer">
							<input
								type="radio"
								name="search-export-content"
								value={opt.value}
								bind:group={content}
								class="mt-1 accent-accent-600"
							/>
							<span>
								<span class="text-zszh-900">{opt.label}</span>
								<span class="block text-xs text-zszh-600 leading-snug">{opt.hint}</span>
								<span class="block text-xs text-zszh-700 tabular-nums">{exportCountLabel(counts[opt.value])}</span>
							</span>
						</label>
					{/each}
				</fieldset>

				<fieldset class="mb-3">
					<legend class="font-medium text-zszh-900 mb-1.5">Tabellenformat</legend>
					<div class="flex gap-1">
						{#each [{ value: "csv", label: "CSV" }, { value: "xlsx", label: "Excel" }] as f (f.value)}
							{@const active = format === f.value}
							<button
								type="button"
								onclick={() => (format = f.value as ExportFormat)}
								class="px-2.5 py-1 text-xs font-medium rounded border transition-colors"
								class:bg-accent-500={active}
								class:text-white={active}
								class:border-accent-500={active}
								class:bg-white={!active}
								class:text-zszh-700={!active}
								class:border-zszh-300={!active}
								class:hover:border-accent-500={!active}
								aria-pressed={active}
							>
								{f.label}
							</button>
						{/each}
					</div>
				</fieldset>

				{#if selected.scope !== "all"}
					<p class="mb-3 text-xs text-zszh-600 leading-snug">
						Grössere Mengen: Suche eingrenzen oder die
						<a href="/about/api#bulk-daten" class="text-accent-600 hover:text-accent-700 hover:underline"
							>Open-Data-Pakete</a
						> nutzen.
					</p>
				{/if}

				<!-- Die Statuszeile steht schon vorher da, sonst sagt sie nicht jeder Screenreader an. -->
				<div role="status">
					{#if phase === "started"}
						<p class="mb-3 text-xs text-zszh-700 leading-snug">
							Der Download startet gleich. Grosse Exporte werden laufend erzeugt und können einige Minuten
							dauern.
						</p>
					{/if}
				</div>
				{#if phase === "error"}
					<p class="mb-3 text-xs text-red-700 leading-snug" role="alert">{errorText}</p>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-2 border-t border-zszh-100">
					<button type="button" onclick={dismiss} class="px-3 py-1.5 text-zszh-600 hover:text-zszh-900">
						Schliessen
					</button>
					<button
						type="button"
						onclick={start}
						{disabled}
						aria-disabled={phase === "started"}
						class="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 disabled:bg-zszh-300 disabled:cursor-not-allowed aria-disabled:bg-zszh-300 aria-disabled:cursor-not-allowed text-white font-medium rounded-md"
					>
						Herunterladen
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
