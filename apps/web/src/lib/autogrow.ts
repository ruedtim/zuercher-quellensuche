import { tick } from "svelte";
import type { Action } from "svelte/action";

// Auto-Grow für einzeilige Frage-/Suchfelder als <textarea rows="1">: die
// Höhe folgt dem Inhalt (scrollHeight), gedeckelt auf maxRows Zeilen – darüber
// scrollt das Feld (overflow-y-auto im Markup). Als value den gebundenen State
// übergeben, damit auch programmatische Änderungen resizen (?ask=-Vorbelegung,
// Beispielfrage, reset(), Thema-Sync) – nicht nur Tippen. Enter sendet das
// umgebende Formular (requestSubmit feuert onsubmit inkl. aller Guards),
// Shift+Enter macht den Zeilenumbruch.
export interface AutogrowParams {
	value: string;
	maxRows?: number;
}

// Wo der Browser `field-sizing: content` kann (Chrome/Edge), misst er die
// Höhe selbst – inklusive programmatischer Wert-Änderungen und Reflow beim
// Breiten-Wechsel. JS deckelt dann nur noch (maxHeight). Ohne Support
// (Safari/iOS!) führt der Fallback die Höhe per scrollHeight nach.
const nativeFieldSizing =
	typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

export const autogrow: Action<HTMLTextAreaElement, AutogrowParams> = (node, params) => {
	let maxRows = params?.maxRows ?? 5;

	// Aus der Action statt als Utility-Klasse gesetzt, damit use:autogrow
	// allein genügt – ohne Support ist die Property schlicht wirkungslos.
	if (nativeFieldSizing) node.style.setProperty("field-sizing", "content");

	const resize = () => {
		const cs = getComputedStyle(node);
		const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
		const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
		const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
		// Deckel aus den realen Metriken – überlebt den text-base/sm:text-sm-
		// Breakpoint-Wechsel, anders als eine fixe max-h-Klasse.
		node.style.maxHeight = `${Math.round(maxRows * lineHeight + padding + border)}px`;
		if (nativeFieldSizing) return;
		// Erst zurücksetzen, damit scrollHeight beim Kürzen schrumpfen kann.
		node.style.height = "auto";
		// scrollHeight = Inhalt + Padding OHNE Rahmen – bei border-box die
		// Rahmenhöhe addieren, sonst fehlen 2 px und ein Scrollbalken flackert.
		node.style.height = `${node.scrollHeight + border}px`;
	};

	const onKeydown = (e: KeyboardEvent) => {
		// IME-Composition durchlassen (Enter übernimmt dort nur die Eingabe).
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			node.form?.requestSubmit();
		}
	};

	// Breiten-/Font-Wechsel (Orientation, sm-Breakpoint) ändern den Umbruch –
	// neu messen. rAF entkoppelt vom Observer-Tick; eine unveränderte Höhe
	// feuert den Observer nicht erneut, das Ganze konvergiert also.
	const ro = new ResizeObserver(() => requestAnimationFrame(resize));
	ro.observe(node);

	node.addEventListener("input", resize);
	node.addEventListener("keydown", onKeydown);
	resize();

	return {
		update(next: AutogrowParams) {
			maxRows = next?.maxRows ?? 5;
			// Programmatische Wert-Änderung: erst nach dem DOM-Flush messen –
			// bind:value schreibt den Feldwert ggf. erst nach diesem update().
			void tick().then(resize);
		},
		destroy() {
			ro.disconnect();
			node.removeEventListener("input", resize);
			node.removeEventListener("keydown", onKeydown);
		},
	};
};
