<script lang="ts">
	import { iframeDownload } from "$lib/iframeDownload";
	import type { SeriesAbbr } from "$lib/types";

	let { series, docId }: { series: SeriesAbbr; docId: string } = $props();

	// Ratsmanuale: die Bilder liegen auf dem Transkribus-Bildserver – das Paket
	// legt sie nicht bei, sondern verlinkt Manifest und Bilder (README).
	const imagesOffered = $derived(series !== "RM");

	let open = $state(false);
	let formatXml = $state(false);
	let formatTxt = $state(true);
	let formatHtml = $state(false);
	let includeImages = $state(true);
	let errorText = $state("");
	const withImages = $derived(imagesOffered && includeImages);

	let popoverEl: HTMLDivElement | null = $state(null);
	let buttonEl: HTMLButtonElement | null = $state(null);

	const formats = $derived(
		[formatTxt && "txt", formatHtml && "html", formatXml && "xml"].filter(Boolean) as string[],
	);
	const canSubmit = $derived(formats.length > 0 || withImages);

	function toggle() {
		open = !open;
		if (!open) return;
		errorText = "";
		// Fokus ins Fenster, damit Screenreader es ansagen.
		queueMicrotask(() => popoverEl?.focus());
	}

	function close() {
		open = false;
	}

	/** Escape, «Abbrechen» und «Download»: zurück zum Knopf, sonst verliert die Tastatur ihren Ort. */
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

	function start() {
		if (!canSubmit) return;
		const params = new URLSearchParams();
		// Auch leer mitschicken: ohne Angabe liefert der Server alle Formate.
		params.set("formats", formats.join(","));
		params.set("images", withImages ? "1" : "0");
		const url = `/api/document/${series}/${docId}.xml/package?${params.toString()}`;
		errorText = "";
		iframeDownload(url, (text) => {
			errorText = text;
			open = true;
		});
		dismiss();
	}
</script>

<div class="relative inline-block">
	<button
		type="button"
		bind:this={buttonEl}
		onclick={toggle}
		aria-expanded={open}
		aria-haspopup="dialog"
		class="inline-flex items-center gap-1 text-zszh-600 hover:text-zszh-900 hover:underline"
	>
		<svg
			class="w-3 h-3"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"
			/>
		</svg>
		Daten herunterladen
	</button>

	{#if open}
		<div
			bind:this={popoverEl}
			role="dialog"
			tabindex="-1"
			aria-label="Download konfigurieren"
			class="absolute z-20 mt-2 left-0 min-w-[18rem] bg-white border border-zszh-200 rounded-md shadow-lg p-4 text-sm text-zszh-800"
		>
			<fieldset class="mb-3">
				<legend class="font-medium text-zszh-900 mb-1.5">Inhalt</legend>
				<label class="flex items-center gap-2 py-0.5 cursor-pointer">
					<input type="checkbox" bind:checked={formatTxt} class="accent-accent-600" />
					<span>Volltext (.txt)</span>
				</label>
				<label class="flex items-center gap-2 py-0.5 cursor-pointer">
					<input type="checkbox" bind:checked={formatHtml} class="accent-accent-600" />
					<span>HTML-Druckansicht</span>
				</label>
				<label class="flex items-center gap-2 py-0.5 cursor-pointer">
					<input type="checkbox" bind:checked={formatXml} class="accent-accent-600" />
					<span>TEI-XML</span>
				</label>
			</fieldset>

			<fieldset class="mb-3">
				<legend class="font-medium text-zszh-900 mb-1.5">Faksimiles</legend>
				{#if imagesOffered}
					<label class="flex items-center gap-2 py-0.5 cursor-pointer">
						<input type="checkbox" bind:checked={includeImages} class="accent-accent-600" />
						<span>Bilder beilegen <span class="text-zszh-600">(Originalauflösung)</span></span>
					</label>
				{:else}
					<p class="text-zszh-600 leading-snug">
						Die Bilder liegen auf dem Transkribus-Bildserver und werden nicht beigelegt –
						bei mehreren Formaten verlinkt das README Manifest und Bilder.
					</p>
				{/if}
			</fieldset>

			{#if errorText}
				<p class="mb-3 bg-yellow-50 border border-yellow-200 text-yellow-900 px-3 py-2 rounded" role="alert">{errorText}</p>
			{/if}

			<div class="flex items-center justify-end gap-2 pt-1 border-t border-zszh-100">
				<button
					type="button"
					onclick={dismiss}
					class="px-3 py-1.5 text-zszh-600 hover:text-zszh-900"
				>
					Abbrechen
				</button>
				<button
					type="button"
					onclick={start}
					disabled={!canSubmit}
					class="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 disabled:bg-zszh-300 disabled:cursor-not-allowed text-white font-medium rounded-md"
				>
					Download
				</button>
			</div>
		</div>
	{/if}
</div>
