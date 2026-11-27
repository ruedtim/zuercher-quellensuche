<script lang="ts">
	import "../app.css";
	import { page } from "$app/state";
	import Schabernack from "$lib/components/Schabernack.svelte";
	import FeedbackDialog from "$lib/components/FeedbackDialog.svelte";
	import PrototypeStamp from "$lib/components/PrototypeStamp.svelte";
	import { isRegisterPath } from "$lib/registerHub";
	import { SITE_DISCLAIMER, SITE_NAME, SITE_SUBTITLE } from "$lib/site";

	let { children } = $props();

	// Startseite: der dunkle Teil reicht bis an die Fusszeile.
	const home = $derived(page.url.pathname === "/");

	const navItems = [
		// Recherche immer hart laden: die Filterspalte auf /search überlebt
		// Client-Navigationen (remountet nicht, samt halb getippter Eingaben und
		// aufgeklappter Optionen). Ein voller Reload setzt alles frisch zurück.
		{ href: "/search", label: "Recherche", reload: true, active: (p: string) => p.startsWith("/search") },
		// Register aller Quellen (Übersicht /register): Archivkatalog, Rats- und
		// Regierungsmitglieder (/personen), Ehedaten, Editionen.
		{ href: "/register", label: "Register", active: isRegisterPath },
		{ href: "/about", label: "Über", active: (p: string) => p.startsWith("/about") },
	];
</script>

<svelte:head>
	<title>{SITE_NAME}</title>
</svelte:head>

<div class="min-h-dvh flex flex-col bg-zszh-50 text-zszh-900">
	<a href="#inhalt" class="skip-link">Zum Inhalt springen</a>
	<!-- Klebt oben, damit der Prototyp-Stempel immer sichtbar ist (Stile unten). -->
	<header class="site-header bg-zszh-900 text-zszh-50">
		<div class="site-header-in max-w-screen-xl mx-auto px-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
			<div class="site-brand flex items-center min-w-0">
				<a href="/" class="min-w-0 font-serif leading-tight">
					<span class="site-title block font-display whitespace-nowrap">{SITE_NAME}</span>
					<span class="site-subtitle block text-[0.8125rem] opacity-80">{SITE_SUBTITLE}</span>
				</a>
				<PrototypeStamp />
			</div>
			<!-- Schmale Handys: engere Abstände, ab 360 px eine Zeile, darunter
			     bricht die Nav um statt über den Rand zu ragen. -->
			<nav aria-label="Hauptmenü" class="site-nav flex flex-wrap items-baseline gap-x-3 gap-y-2 sm:gap-x-6 font-display text-[1.14rem] tracking-[0.06em]">
				{#each navItems as item (item.href)}
					{@const active = item.active(page.url.pathname)}
					<a
						href={item.href}
						data-sveltekit-reload={item.reload ? "" : undefined}
						aria-current={active ? "page" : undefined}
						class="hover:underline underline-offset-4 decoration-2 {active ? 'underline decoration-line' : ''}"
					>
						{item.label}
					</a>
				{/each}
				<FeedbackDialog variant="header" label="Feedback" />
			</nav>
		</div>
	</header>

	<main id="inhalt" tabindex="-1" class="flex-1 focus:outline-none {home ? 'flex flex-col' : ''}">
		{@render children()}
	</main>

	<footer class="bg-zszh-100 border-t border-zszh-200 {home ? '' : 'mt-12'}">
		<div class="max-w-screen-xl mx-auto px-4 py-6 flex flex-wrap justify-between gap-4 text-sm text-zszh-700">
			<div class="space-y-1">
				<p>{SITE_DISCLAIMER}</p>
				<p>
					Plattform: <a href="https://creativecommons.org/licenses/by/4.0/deed.de" class="hover:underline">CC BY 4.0</a>,
					Texte und Metadaten: <a href="https://creativecommons.org/publicdomain/mark/1.0/deed.de" class="hover:underline">Public Domain (PDM 1.0)</a>,
					<a href="/about/ehedaten" class="hover:underline">Ehedaten</a>: <a href="https://creativecommons.org/licenses/by/4.0/deed.de" class="hover:underline">CC BY 4.0</a>, Staatsarchiv des Kantons Zürich,
					<a href="/about/editionen" class="hover:underline">Editionen</a>: Lizenz je Edition (QZH, Zürcher Rechtsquellen: <a href="https://creativecommons.org/licenses/by/4.0/deed.de" class="hover:underline">CC BY 4.0</a>)
				</p>
			</div>
			<nav aria-label="Fusszeile" class="flex flex-wrap gap-x-4 gap-y-2">
				<a href="/about/suchhilfe" class="hover:underline">Suchhilfe</a>
				<a href="/about/api" class="hover:underline">API</a>
				<a href="/impressum" class="hover:underline">Impressum</a>
				<a href="/datenschutz" class="hover:underline">Datenschutz</a>
				<a href="/about" class="hover:underline">Über das Projekt</a>
			</nav>
		</div>
	</footer>

	<Schabernack />
</div>

<style>
	/* Klebender Kopf: Die obere Polsterung rollt weg, danach bleibt eine schmalere Zeile.
	   Deren Höhe steht als --sticky-top in app.css (Faksimile-Spalten, Sprungmarken) und muss
	   zu diesen Abständen passen. z-40: über Auswahllisten und Popovern der Seite (≤ z-30),
	   unter Dialogen und Personenkarten (z-50). */
	.site-header {
		position: sticky;
		top: -0.5rem;
		z-index: 40;
		border-bottom: 4px solid var(--color-line);
	}
	.site-title {
		font-size: 2rem;
		line-height: 0.95;
		letter-spacing: 0.015em;
	}
	.site-header-in {
		padding-top: 0.95rem;
		padding-bottom: 0.55rem;
	}
	.site-brand {
		column-gap: 1.75rem;
	}
	/* Unter 1000 px haben Name, Stempel und Menü nicht nebeneinander Platz: Es klebt nur die
	   Zeile mit Name und Stempel, das Menü rollt mit. display: contents macht beide Zeilen zu
	   Kindern der Seite – eine klebende Zeile klebt nur innerhalb ihres Elternelements. */
	@media (max-width: 999px) {
		.site-header,
		.site-header-in {
			display: contents;
		}
		.site-brand,
		.site-nav {
			background: var(--color-zszh-900);
			color: var(--color-zszh-50);
		}
		.site-brand {
			position: sticky;
			top: 0;
			z-index: 40;
			justify-content: space-between;
			padding: 0.55rem 1rem 0.5rem;
			border-bottom: 4px solid var(--color-line);
		}
		.site-nav {
			column-gap: 1.5rem;
			padding: 0.55rem 1rem 0.6rem;
		}
	}
	@media (max-width: 479px) {
		.site-brand {
			column-gap: 0.75rem;
		}
		.site-nav {
			column-gap: 0.75rem;
			justify-content: space-between;
		}
	}
	/* Handys: Titel und Stempel teilen sich die Zeile, der Titel wächst mit der Breite; der
	   Untertitel bricht bei Bedarf auf zwei Zeilen um. */
	@media (max-width: 599px) {
		.site-title {
			font-size: clamp(1.3rem, 6.4vw, 1.6rem);
		}
		.site-subtitle {
			font-size: 0.72rem;
			text-wrap: balance;
		}
	}
	@media (max-width: 349px) {
		.site-brand {
			column-gap: 0.5rem;
			padding-right: 0.75rem;
			padding-left: 0.75rem;
		}
		.site-subtitle {
			font-size: 0.66rem;
		}
	}
</style>
