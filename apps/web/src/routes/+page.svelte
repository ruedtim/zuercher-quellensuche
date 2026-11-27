<script lang="ts">
	import { goto } from "$app/navigation";
	import { autogrow } from "$lib/autogrow";
	import { homeIntro } from "$lib/homeIntro";
	import { literalPhrase } from "$lib/quotedQuery";
	import { SITE_DISCLAIMER, SITE_NAME, SITE_PREVIEW, SITE_SUBTITLE, SITE_URL } from "$lib/site";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const intro = $derived(
		homeIntro({ documents: data.totalDocs, since: data.dateBounds.min, ...data.collections }, new Date().getFullYear()),
	);

	const description = `${SITE_DISCLAIMER} Recherche in historischen Amtsdokumenten, Archivkatalog, Ehedaten und Editionen.`;

	let q = $state("");
	let literal = $state(false);

	// Frage der Startseite: Suche nach Bedeutung über alle Quellen. ?ask= leitet die
	// Suchseite auf das Thema im Reiter «Alle Quellen» um und setzt einen Zeitraum aus der
	// Frage («im 19. Jahrhundert», «seit 2008») als Filter, Wortfolgen in Anführungszeichen
	// als Suchbegriff (askRedirect.ts). Keine generierte Antwort – die liefert ein eigener
	// KI-Assistent über den MCP-Server.
	const askHref = (ask: string) => `/search?${new URLSearchParams({ ask })}`;

	// Anleitung zu Anführungszeichen und «wörtlich» hinter «?» statt als Text auf der Seite (Tim
	// 2026-11-26). Maus: beim Darüberfahren; Tippen und Tastatur: der Knopf öffnet und schliesst, Escape
	// schliesst und gibt den Fokus an den Knopf zurück, ein Klick daneben schliesst.
	// Beispiel (Prod 2026-11-26): 5 Dokumente nennen «Susanna Ziegler», zuoberst die Landrechtsertheilung
	// (RRB 1820-09-12) – die Frage nach «eingebürgert» findet den alten Begriff; ohne Anführungszeichen
	// fehlt der Beschluss unter den ersten Treffern.
	const QUOTED_EXAMPLE = 'Wann wurde "Susanna Ziegler" eingebürgert?';
	let helpHover = $state(false);
	let helpPinned = $state(false);
	const helpOpen = $derived(helpHover || helpPinned);
	let helpWrap: HTMLElement | undefined = $state();
	let helpButton: HTMLButtonElement | undefined = $state();

	function onWindowKey(e: KeyboardEvent) {
		if (e.key !== "Escape" || !helpOpen) return;
		helpPinned = helpHover = false;
		helpButton?.focus();
	}
	function onWindowPointer(e: PointerEvent) {
		if (helpPinned && !helpWrap?.contains(e.target as Node)) helpPinned = false;
	}

	// «wörtlich»: der ganze Text als eine Wortfolge, die genau so vorkommen muss – Suchbegriff im
	// Reiter «Alle Quellen», ohne Thema und ohne Zeitraum aus dem Text (quotedQuery.ts).
	function onSearch(e: SubmitEvent) {
		e.preventDefault();
		const t = q.trim();
		if (t.toLowerCase() === "schabernack") window.dispatchEvent(new CustomEvent("schabernack:trigger"));
		const phrase = literal ? literalPhrase(t) : "";
		goto(phrase ? `/search?${new URLSearchParams({ q: phrase })}` : t ? askHref(t) : "/search");
	}
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<svelte:head>
	<title>{SITE_NAME}</title>
	<meta name="description" content={description} />
	<!-- Linkvorschau (LinkedIn, Messenger): Adressen absolut, das verlangen die Dienste. -->
	<meta property="og:type" content="website" />
	<meta property="og:locale" content="de_CH" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content="{SITE_NAME} – {SITE_SUBTITLE}" />
	<meta property="og:description" content={description} />
	<meta property="og:url" content="{SITE_URL}/" />
	<meta property="og:image" content="{SITE_URL}{SITE_PREVIEW.path}" />
	<meta property="og:image:type" content="image/jpeg" />
	<meta property="og:image:width" content={String(SITE_PREVIEW.width)} />
	<meta property="og:image:height" content={String(SITE_PREVIEW.height)} />
	<meta property="og:image:alt" content={SITE_PREVIEW.alt} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<!-- Füllt die Höhe bis zur Fusszeile (+layout.svelte): keine leere helle Fläche darunter. -->
<section class="flex-1 bg-zszh-900 text-zszh-50 py-14 sm:py-18">
	<div class="max-w-screen-xl mx-auto px-4">
		<!-- Sichtbar steht der Name in der Kopfzeile. -->
		<h1 class="sr-only">{SITE_NAME}</h1>
		<p class="text-lg max-w-2xl text-zszh-100">
			{intro}
		</p>

		<form class="mt-8 max-w-2xl flex flex-wrap items-end gap-2" onsubmit={onSearch}>
			<!-- textarea statt input: ganze Sätze sollen beim Tippen sichtbar
			     bleiben – das Feld wächst zeilenweise mit (autogrow), Enter
			     sendet, Shift+Enter bricht um. -->
			<textarea
				rows="1"
				use:autogrow={{ value: q, maxRows: 5 }}
				enterkeyhint="search"
				placeholder="Was möchten Sie wissen?"
				aria-label="Was möchten Sie wissen?"
				class="flex-1 min-w-0 px-4 py-3 rounded-md text-zszh-900 bg-white resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-accent-500"
				bind:value={q}
				autocomplete="off"
			></textarea>
			<button
				type="submit"
				class="px-6 pt-3 pb-2.5 bg-accent-500 hover:bg-accent-600 rounded-md font-display text-xl leading-none tracking-[0.06em] min-h-12 transition-colors"
				title="Sucht nach Bedeutung in allen Quellen; was in Anführungszeichen steht, wird wörtlich gesucht"
			>
				Suchen
			</button>
			<!-- Auf dem Handy hängt die Hilfe an der ganzen Zeile (sonst ragt sie über den Rand), ab sm am «?». -->
			<div class="relative sm:static basis-full sm:basis-auto flex items-center gap-2 px-1 sm:px-3 py-1 sm:py-3 text-sm text-zszh-200">
				<label
					class="flex items-center gap-1.5 hover:text-white cursor-pointer whitespace-nowrap"
					title="Sucht den ganzen Text wörtlich, als eine Wortfolge"
				>
					<input type="checkbox" class="accent-accent-500" bind:checked={literal} />
					wörtlich
				</label>
				<span
					class="sm:relative"
					role="presentation"
					bind:this={helpWrap}
					onpointerenter={(e) => e.pointerType === "mouse" && (helpHover = true)}
					onpointerleave={(e) => e.pointerType === "mouse" && (helpHover = false)}
				>
					<button
						type="button"
						bind:this={helpButton}
						aria-expanded={helpOpen}
						aria-controls="hilfe-anfuehrungszeichen"
						aria-label="Hilfe: Anführungszeichen und «wörtlich»"
						onclick={() => (helpPinned = !helpPinned)}
						class="w-5 h-5 inline-flex items-center justify-center rounded-full border border-zszh-200 text-xs leading-none hover:text-white hover:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
					>
						?
					</button>
					<div id="hilfe-anfuehrungszeichen" hidden={!helpOpen} class="absolute z-30 top-full left-0 sm:left-auto sm:right-0 pt-2 w-72 sm:w-80">
						<div class="rounded-md border border-zszh-300 bg-white px-3 py-2 text-sm text-zszh-900">
							<p>Was in Anführungszeichen steht, wird wörtlich gesucht, der Rest der Frage reiht diese Treffer nach Bedeutung.</p>
							<p class="mt-1.5">
								Beispiel:
								<a
									href={askHref(QUOTED_EXAMPLE)}
									rel="nofollow"
									data-sveltekit-preload-data="tap"
									class="text-accent-600 underline underline-offset-2 hover:text-accent-700">{QUOTED_EXAMPLE}</a>
								– zuoberst der Beschluss von 1820, der ihr das «Landrecht» erteilte, wie das Kantonsbürgerrecht damals hiess.
							</p>
							<p class="mt-1.5">«wörtlich» sucht den ganzen Text so.</p>
						</div>
					</div>
				</span>
			</div>
		</form>

		<p class="mt-3 max-w-2xl text-sm text-zszh-200">
			Findet die passendsten Treffer nach Bedeutung, in allen Quellen.
			Ausformulierte Antworten mit Quellenangaben liefert Ihr eigener KI-Assistent (Claude, ChatGPT, Apertus …)
			über unsere MCP-Schnittstelle:
			<a href="/about/ai" class="text-white underline underline-offset-2 hover:text-accent-200">Eigene KI anbinden</a>.
		</p>

		<!-- Beispielfragen, je Quelle eine: Der Link führt in deren Reiter, meist mit der Frage als
		     Suche nach Bedeutung (exampleQuestions.ts). Vorladen erst beim Antippen – beim
		     Überfahren liefe sonst jedes Mal eine Suche. -->
		<div class="mt-5 max-w-2xl flex flex-wrap items-center gap-2">
			<span class="text-sm text-zszh-200">Zum Beispiel:</span>
			{#each data.exampleQuestions as ex (ex.text)}
				<a
					href={ex.href}
					lang={ex.lang}
					rel="nofollow"
					data-sveltekit-preload-data="tap"
					class="px-3 py-1 text-sm bg-white/5 border border-zszh-100/50 rounded-sm text-zszh-100 hover:border-white hover:text-white transition-colors"
				>
					{ex.text}
				</a>
			{/each}
		</div>
	</div>
</section>
