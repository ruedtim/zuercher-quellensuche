<script
	lang="ts"
	generics="Person extends { id: number; name: string; forms: readonly string[]; gnd?: string | null; ssrq?: string | null }"
>
	// Personenkarte beim Namen im Text: Namen, die einer Person zugeordnet sind, werden
	// im gerenderten TEI markiert – Kantonsratsdatenbank über die Schreibung im Text
	// (KrdbMentions.svelte), Ratsmanuale über GND bzw. SSRQ-ID am Namen
	// (RatMentions.svelte). Maus-Hover zeigt die Karte als Vorschau (Tooltip), Klick,
	// Tap oder Enter pinnen sie. Die bisherige Suche nach dem Namen (onTeiClick) ist
	// ein Link in der Karte; nicht zugeordnete Namen öffnen weiter direkt die Suche.
	// Den Eintrag je Person liefert der Aufrufer (`entry`).
	import { tick, untrack, type Snippet } from "svelte";
	import { buildMentionIndex, buildRefIndex, entitySurface, mentionIds, placeCard, type CardPlacement } from "$lib/krdbMentions";

	let {
		container,
		html,
		persons,
		active,
		entry,
		searchHref,
		note,
		showAllLabel,
		onShowAll,
		onMarked,
	}: {
		/** Text-Panel mit dem gerenderten TEI. */
		container: HTMLElement | null;
		/** Nur Abhängigkeit: neuer Text (Client-Navigation) ⇒ neu markieren. */
		html: string | null;
		persons: Person[];
		/** Text-Tab sichtbar – sonst bleibt die Karte zu. */
		active: boolean;
		/** Eintrag einer Person in der Karte; dazu die Schreibung des Namens im Text. */
		entry: Snippet<[Person, string]>;
		/** Suche nach dem Namen, wie sie ein Klick auf einen nicht zugeordneten Namen öffnet. */
		searchHref: (form: string) => string | null;
		/** Herkunft der Zuordnung («Automatisch zugeordnet»). */
		note: string;
		/** Knopf in der Karte, der den Reiter mit allen Personen öffnet; ohne: kein Knopf. */
		showAllLabel?: string;
		onShowAll?: () => void;
		/** Personen, deren Namen im Text markiert sind. */
		onMarked: (ids: Set<number>) => void;
	} = $props();

	/** CSS-Breite der Karte (w-80) für die Platzierung. */
	const CARD_WIDTH = 320;
	const OPEN_DELAY_MS = 300;
	const CLOSE_DELAY_MS = 200;
	const MAX_ENTRIES = 3;
	const FLASH_MS = 2400;

	interface OpenCard {
		anchor: HTMLElement;
		persons: Person[];
		form: string;
		pinned: boolean;
	}

	let card = $state.raw<OpenCard | null>(null);
	let place = $state.raw<CardPlacement | null>(null);
	let cardEl = $state<HTMLDivElement | null>(null);
	const isOpen = $derived(card !== null);
	const byId = $derived(new Map(persons.map((p) => [p.id, p])));

	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let frame = 0;
	/** Per Tastatur geöffnet ⇒ Escape gibt den Fokus an den Namen zurück. */
	let viaKeyboard = false;

	function mentionOf(target: EventTarget | null): HTMLElement | null {
		return target instanceof Element ? target.closest<HTMLElement>("[data-mention]") : null;
	}

	function position() {
		if (!card) return;
		place = placeCard(
			card.anchor.getBoundingClientRect(),
			{ width: document.documentElement.clientWidth, height: window.innerHeight },
			CARD_WIDTH,
		);
	}

	function open(anchor: HTMLElement, pinned: boolean, keyboard = false) {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
		const list = (anchor.dataset.mention ?? "")
			.split(" ")
			.map((id) => byId.get(Number(id)))
			.filter((p): p is Person => p !== undefined);
		if (list.length === 0) return;
		card = { anchor, persons: list, form: entitySurface(anchor.textContent ?? ""), pinned };
		viaKeyboard = keyboard;
		position();
		if (keyboard) void tick().then(() => cardEl?.querySelector<HTMLElement>("a[href], button")?.focus());
	}

	function close(returnFocus = false) {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
		cancelAnimationFrame(frame);
		if (!card) return;
		const { anchor } = card;
		const focusInside = !!cardEl && cardEl.contains(document.activeElement);
		card = null;
		place = null;
		if (returnFocus && (focusInside || viaKeyboard)) anchor.focus();
	}

	function scheduleClose() {
		if (!card || card.pinned) return;
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => close(), CLOSE_DELAY_MS);
	}

	function onPointerOver(e: PointerEvent) {
		if (e.pointerType !== "mouse") return;
		const span = mentionOf(e.target);
		if (!span) return;
		clearTimeout(closeTimer);
		if (card?.anchor === span || card?.pinned) return;
		clearTimeout(openTimer);
		openTimer = setTimeout(() => open(span, false), OPEN_DELAY_MS);
	}

	function onPointerOut(e: PointerEvent) {
		if (e.pointerType !== "mouse") return;
		const span = mentionOf(e.target);
		if (!span) return;
		const to = e.relatedTarget;
		if (to instanceof Node && (span.contains(to) || cardEl?.contains(to))) return;
		clearTimeout(openTimer);
		scheduleClose();
	}

	function onClick(e: MouseEvent) {
		const span = mentionOf(e.target);
		if (!span) return;
		e.preventDefault();
		if (card?.anchor === span && card.pinned) close();
		else open(span, true);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key !== "Enter" && e.key !== " ") return;
		const span = mentionOf(e.target);
		if (!span || span !== e.target) return;
		e.preventDefault();
		open(span, true, true);
	}

	// Zugeordnete Namen markieren und Listener anhängen – neu bei neuem Text.
	$effect(() => {
		const el = container;
		void html;
		const byForm = buildMentionIndex(persons);
		const byRef = buildRefIndex(persons);
		if (!el) return;
		let cancelled = false;
		void tick().then(() => {
			if (cancelled) return;
			const found = new Set<number>();
			for (const span of el.querySelectorAll<HTMLElement>(".tei-person")) {
				const ids = mentionIds(
					{ gnd: span.dataset.gnd, ssrq: span.dataset.ssrq, text: span.textContent ?? "" },
					byRef,
					byForm,
				);
				if (!ids) continue;
				span.dataset.mention = ids.join(" ");
				span.tabIndex = 0;
				span.setAttribute("role", "button");
				span.setAttribute("aria-haspopup", "dialog");
				for (const id of ids) found.add(id);
			}
			onMarked(found);
		});
		el.addEventListener("pointerover", onPointerOver);
		el.addEventListener("pointerout", onPointerOut);
		el.addEventListener("click", onClick);
		el.addEventListener("keydown", onKeyDown);
		return () => {
			cancelled = true;
			el.removeEventListener("pointerover", onPointerOver);
			el.removeEventListener("pointerout", onPointerOut);
			el.removeEventListener("click", onClick);
			el.removeEventListener("keydown", onKeyDown);
			clearTimeout(flashTimer);
			untrack(() => close());
		};
	});

	// Offene Karte: Klick daneben oder Escape schliesst; beim Scrollen schliesst
	// die Vorschau, eine gepinnte Karte folgt dem Namen.
	$effect(() => {
		if (!isOpen) return;
		const onDocClick = (e: MouseEvent) => {
			if (cardEl?.contains(e.target as Node) || mentionOf(e.target)) return;
			close();
		};
		const onDocKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			close(true);
		};
		const reposition = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(position);
		};
		// Nur Scrollen, das den Namen bewegt (Seite oder ein Vorfahr) – nicht
		// das Faksimile (Mirador scrollt intern) oder die Karte selbst.
		const onScroll = (e: Event) => {
			if (!card || !(e.target instanceof Node) || !e.target.contains(card.anchor)) return;
			if (card.pinned) reposition();
			else close();
		};
		document.addEventListener("click", onDocClick);
		document.addEventListener("keydown", onDocKey);
		window.addEventListener("scroll", onScroll, { capture: true, passive: true });
		// Resize nur neu platzieren: das Faksimile feuert beim Laden synthetische
		// window-resize-Events (Facsimile.svelte), die sonst die Vorschau schlössen.
		window.addEventListener("resize", reposition, { passive: true });
		return () => {
			document.removeEventListener("click", onDocClick);
			document.removeEventListener("keydown", onDocKey);
			window.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", reposition);
		};
	});

	$effect(() => {
		if (!active) untrack(() => close());
	});

	/** Tab «Personen» → «im Text»: zur ersten Nennung scrollen, alle kurz hervorheben. */
	export function reveal(id: number) {
		if (!container) return;
		const spans = [...container.querySelectorAll<HTMLElement>(`[data-mention~="${id}"]`)];
		if (spans.length === 0) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		spans[0].scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
		spans[0].focus({ preventScroll: true });
		for (const s of spans) {
			s.classList.remove("tei-person--flash");
			void s.offsetWidth; // Animation neu starten
			s.classList.add("tei-person--flash");
		}
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => spans.forEach((s) => s.classList.remove("tei-person--flash")), FLASH_MS);
	}
</script>

{#if card && place}
	{@const form = card.form}
	{@const search = searchHref(form)}
	<div
		bind:this={cardEl}
		role="dialog"
		tabindex="-1"
		aria-label={card.persons.map((p) => p.name || form).join(", ")}
		class="no-print fixed z-50 w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-zszh-200 bg-white p-3 text-sm shadow-lg"
		style:left="{place.left}px"
		style:top={"top" in place ? `${place.top}px` : null}
		style:bottom={"bottom" in place ? `${place.bottom}px` : null}
		style:max-height="{place.maxHeight}px"
		onpointerenter={() => clearTimeout(closeTimer)}
		onpointerleave={(e) => {
			if (e.pointerType === "mouse") scheduleClose();
		}}
	>
		<ul class="flex flex-col gap-3">
			{#each card.persons.slice(0, MAX_ENTRIES) as p (p.id)}
				<li class="flex gap-3 min-w-0">{@render entry(p, form)}</li>
			{/each}
		</ul>
		{#if card.persons.length > MAX_ENTRIES}
			<p class="mt-2 text-xs text-zszh-600">und {card.persons.length - MAX_ENTRIES} weitere</p>
		{/if}
		<div class="mt-2.5 pt-2 border-t border-zszh-100 flex flex-col gap-1 text-xs">
			{#if search}
				<a href={search} target="_blank" rel="noopener" class="text-accent-600 underline hover:text-accent-700">
					Weitere Dokumente mit «{card.form}» ↗
				</a>
			{/if}
			<span class="text-zszh-500">
				{note}{#if showAllLabel && onShowAll}{" "}·
					<button
						type="button"
						class="underline hover:text-zszh-700"
						onclick={() => {
							close();
							onShowAll?.();
						}}>{showAllLabel}</button
					>{/if}
			</span>
		</div>
	</div>
{/if}
