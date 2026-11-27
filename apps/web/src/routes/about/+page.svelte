<script lang="ts">
	import { SITE_HOST, SITE_NAME, SITE_SUBTITLE, SOURCE_REPO_URL } from "$lib/site";
	const series = [
		{
			href: "/about/os",
			tag: "OS",
			title: "Offizielle Gesetzessammlung",
			description:
				"Erlasse des Kantons Zürich seit 1803: bis 1998 digitalisiert, ab 1999 aus ZH-Lex.",
		},
		{
			href: "/about/abl",
			tag: "ABl",
			title: "Amtsblatt",
			description:
				"Amtliche Mitteilungen seit 1834; durchsuchbar sind bisher die Jahrgänge 1883–2001, weitere folgen.",
		},
		{
			href: "/about/krp",
			tag: "KRP",
			title: "Kantonsratsprotokolle",
			description:
				"Protokolle des Zürcher Parlaments seit 1803; ab Mai 1995 aus dem Web-Service des Kantonsrats.",
		},
		{
			href: "/about/rrb",
			tag: "RRB",
			title: "Regierungsratsbeschlüsse",
			description:
				"Beschlüsse der Zürcher Regierung seit 1803; durchsuchbar bis 1995 und ab Oktober 2008.",
		},
		{
			href: "/about/rm",
			tag: "RM",
			title: "Ratsmanuale",
			description:
				"Sitzungsprotokolle des Kleinen und Grossen Rats der Stadt und Republik Zürich 1484–1798, je Sitzung ein Dokument. Maschinelle Transkription des Staatsarchivs; Daten bis 1700 im alten Stil.",
		},
	];

	// Richtlinien und Verzeichnisse stehen beim Staatsarchiv (Entscheid Tim 2026-11-23: verlinken,
	// nicht wiedergeben).
	const standards = [
		{
			href: "https://www.zentraleserien.zh.ch/resources/pdfs/OS_Editions-_und_Transkriptionsrichtlinien.pdf",
			title: "Richtlinien OS (PDF) ↗",
			description: "Wie das Staatsarchiv die Gesetzessammlung 1803–1998 ediert hat.",
		},
		{
			href: "https://www.zentraleserien.zh.ch/resources/pdfs/KRP_RRB_Editions-_und_Transkriptionsrichtlinien.pdf",
			title: "Richtlinien KRP und RRB (PDF) ↗",
			description: "Wie das Staatsarchiv Kantonsratsprotokolle und Regierungsratsbeschlüsse bis 1995 ediert hat.",
		},
		{
			href: "https://www.zentraleserien.zh.ch/about",
			title: "Portal des Staatsarchivs ↗",
			description: "Beschreibung der Serien seit 1803, Abkürzungsverzeichnisse und das offizielle Angebot dazu.",
		},
	];
</script>

<svelte:head>
	<title>Über das Projekt | {SITE_NAME}</title>
	<meta name="description" content="Inoffizieller Prototyp, kein Angebot des Staatsarchivs: Recherche in den Zentralen Serien des Kantons Zürich, im Archivkatalog, in Ehedaten und Editionen." />
</svelte:head>

<div class="max-w-screen-xl mx-auto px-4 py-12">
	<header class="max-w-3xl mb-12">
		<h1 class="font-display text-5xl md:text-6xl leading-[0.95] text-balance text-zszh-900 mb-5">
			{SITE_NAME}
			<span class="block mt-1 text-lg md:text-xl font-normal text-zszh-700">{SITE_SUBTITLE}</span>
		</h1>
		<p class="text-lg text-zszh-700 leading-relaxed mb-3">
			Eine Suche über öffentlich zugängliche Quellen aus dem und zum Staatsarchiv des Kantons Zürich: die
			Zentralen Serien – Offizielle Gesetzessammlung, Amtsblatt, Kantonsratsprotokolle und
			Regierungsratsbeschlüsse seit 1803 (das Amtsblatt in den digitalisierten Jahrgängen) sowie die Ratsmanuale der Stadt
			und Republik Zürich (1484–1798) –, den Archivkatalog, die Ehedaten und zwei Editionen, einheitlich aufbereitet und untereinander verlinkt.
		</p>
		<h2 class="text-lg font-serif font-bold text-zszh-900 mt-6 mb-2">Betrieb und Daten</h2>
		<!-- Ziel des Prototyp-Stempels im Kopf (Layout). -->
		<p id="prototyp" class="text-zszh-700 mb-3 scroll-mt-6">
			Die {SITE_NAME} – «{SITE_SUBTITLE}» ({SITE_HOST}) – ist ein inoffizieller Prototyp,
			um die Grenzen des Möglichen für eine digitale Nutzungsplattform
			des Staatsarchivs auszuloten. Betrieben wird die Seite privat von Tim Rüdiger; sie ist
			kein Angebot des Staatsarchivs oder des Kantons Zürich. Kontakt und Verantwortlichkeiten:
			<a href="/impressum" class="text-accent-600 underline">Impressum</a>. Der Quellcode steht auf
			<a href={SOURCE_REPO_URL} class="text-accent-600 underline" rel="external">GitHub</a>.
		</p>
		<p class="text-zszh-700">
			Die digitalisierten Altbestände sind Editionen des Staatsarchivs; es stellt sie im
			<a
				href="https://www.zh.ch/de/politik-staat/statistik-daten/datenkatalog.html"
				class="text-accent-600 underline"
				rel="external">Datenkatalog des Kantons Zürich</a
			>
			als OGD-Datensätze bereit. Die Spätbestände stammen aus den offenen Daten des Kantons:
			Kantonsratsprotokolle ab Mai 1995 (Gever-Web-Service des Kantonsrats),
			Regierungsratsbeschlüsse ab Oktober 2008 (zh.ch) und die Offizielle Gesetzessammlung ab 1999
			(ZH-Lex). Die Ratsmanuale sind eine maschinelle Transkription des Staatsarchivs auf der
			Plattform Transkribus. Archivkatalog, Ehedaten und Editionen haben je
			eine eigene Seite und eigene Nutzungsbedingungen.
		</p>
	</header>

	<section class="mb-12">
		<h2 class="text-xl font-serif font-bold text-zszh-900 mb-4">Die Serien</h2>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			{#each series as item (item.href)}
				<a
					href={item.href}
					class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
				>
					<div class="text-xs font-mono text-accent-600 mb-1">{item.tag}</div>
					<h3 class="text-lg font-serif font-semibold text-zszh-900">{item.title}</h3>
					<p class="text-sm text-zszh-700 mt-2">{item.description}</p>
				</a>
			{/each}
		</div>
	</section>

	<section class="mb-12">
		<h2 class="text-xl font-serif font-bold text-zszh-900 mb-4">Beim Staatsarchiv</h2>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			{#each standards as item (item.href)}
				<a
					href={item.href}
					target="_blank"
					rel="noopener external"
					class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
				>
					<h3 class="text-base font-serif font-semibold text-zszh-900">{item.title}</h3>
					<p class="text-sm text-zszh-700 mt-2">{item.description}</p>
				</a>
			{/each}
		</div>
	</section>

	<section class="mb-12">
		<h2 class="text-xl font-serif font-bold text-zszh-900 mb-4">Plattform</h2>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<a
				href="/about/ai"
				class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
			>
				<h3 class="text-base font-serif font-semibold text-zszh-900">Eigene KI anbinden</h3>
				<p class="text-sm text-zszh-700 mt-2">
					Ausformulierte Antworten mit Quellenangaben über den eigenen KI-Assistenten (Claude, ChatGPT,
					Apertus …) und den MCP-Server – Verbinden, Werkzeuge, gute Fragen, Datenschutz und Grenzen.
				</p>
			</a>
			<a
				href="/about/suchhilfe"
				class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
			>
				<h3 class="text-base font-serif font-semibold text-zszh-900">Suchhilfe</h3>
				<p class="text-sm text-zszh-700 mt-2">
					Wie die Suche funktioniert – Frage nach Bedeutung, einfache und erweiterte Suche, ODER,
					Phrasen, Suchbegriff und Thema, Filterlogik, Download und die Dokumentansicht.
				</p>
			</a>
			<a
				href="/about/archivkatalog"
				class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
			>
				<h3 class="text-base font-serif font-semibold text-zszh-900">Archivkatalog</h3>
				<p class="text-sm text-zszh-700 mt-2">
					Verzeichnungseinheiten des Staatsarchivs mitdurchsuchen – Akten, Urkunden, Pläne, Nachlässe;
					Filter, Digitalisat-Links, Zitieren und Grenzen.
				</p>
			</a>
			<a
				href="/about/ehedaten"
				class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
			>
				<h3 class="text-base font-serif font-semibold text-zszh-900">Ehedaten</h3>
				<p class="text-sm text-zszh-700 mt-2">
					Rund 296'000 Eheeinträge aus den Zürcher Kirchenbüchern 1524–1800 – Suche nach Namen mit Rolle,
					Herkunft und Kirchgemeinde, alter Stil, Trauung oder Verkündung; Lizenz CC BY 4.0.
				</p>
			</a>
			<a
				href="/about/editionen"
				class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
			>
				<h3 class="text-base font-serif font-semibold text-zszh-900">Editionen</h3>
				<p class="text-sm text-zszh-700 mt-2">
					Edierte Quellenstücke mit Anmerkungen, Kommentar und Faksimile: 790 Stücke der Quellen zur Zürcher Geschichte
					(QZH, 1275–1795) und 897 der Zürcher Rechtsquellen (SSRQ ZH, 1180–1800); Suche im Quellentext, Lizenz je Edition.
				</p>
			</a>
			<a
				href="/about/api"
				class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
			>
				<h3 class="text-base font-serif font-semibold text-zszh-900">API</h3>
				<p class="text-sm text-zszh-700 mt-2">
					Öffentliche Lese-APIs für die maschinelle Recherche – JSON-REST (/api/v1), DTS 1.0 und
					MCP-Server für eigene KI-Assistenten (Claude, ChatGPT, Apertus); Endpunkte, Beispiele, OpenAPI-Spec.
				</p>
			</a>
			<a
				href="/about/architektur"
				class="block p-5 bg-white border border-zszh-200 rounded-md shadow-sm hover:shadow-md hover:border-accent-500 transition-all"
			>
				<h3 class="text-base font-serif font-semibold text-zszh-900">Technische Architektur</h3>
				<p class="text-sm text-zszh-700 mt-2">
					Stack, Daten-Pipeline (Altbestände und offene Daten), Such-Infrastruktur (lexikalisch +
					semantisch), Passagen-Index und MCP-Server, IIIF-Faksimile und Betrieb.
				</p>
			</a>
		</div>
	</section>

</div>
