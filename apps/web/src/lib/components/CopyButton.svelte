<script lang="ts">
	// «… kopieren» mit Bestätigung: sichtbar am Knopf, für Screenreader in einer Statuszeile.
	let {
		text,
		label = "kopieren",
		context = "",
		title = undefined,
		class: className = "text-zszh-600 hover:text-zszh-900 hover:underline",
	}: {
		/** Text für die Zwischenablage; als Funktion erst beim Klick gelesen. */
		text: string | (() => string);
		label?: string;
		/** Vor der Beschriftung, nur für Screenreader («Zitiervorschlag» kopieren). */
		context?: string;
		title?: string;
		class?: string;
	} = $props();

	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Zwischenablage gesperrt (z. B. unsicherer Kontext)
		}
	}
</script>

<button type="button" onclick={copy} {title} class={className}
	>{#if copied}✓ Kopiert{:else}{#if context}<span class="sr-only">{context}&nbsp;</span>{/if}{label}{/if}</button
><span class="sr-only" role="status">{copied ? "Kopiert" : ""}</span>
