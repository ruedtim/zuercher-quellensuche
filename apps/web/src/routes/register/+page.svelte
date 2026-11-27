<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	// Übersicht der Register: Namenssuche über alle Register (Treffer je Quelle) und je Quelle
	// eine Karte mit Umfang, Entstehung und Einstieg – beides in der Reihenfolge und mit den
	// Namen der Reiter (REGISTER_SOURCES). Archivkatalog und Ehedaten kommen nachgestreamt
	// (+page.server.ts).
	import { catalogEntitySearchHref, REGISTER_KINDS, registerHref } from "$lib/catalogRegister";
	import { editionEntitySearchHref, editionRegisterHref, gndHref, yearSpan } from "$lib/editionRegister";
	import { EHEDATEN_YEAR_MAX, EHEDATEN_YEAR_MIN } from "$lib/ehedaten";
	import { DIRECTORY_COUNCILS, directoryUrl } from "$lib/personUrls";
	import { ratDirectoryUrl, ratPersonUrl } from "$lib/rat";
	import { fullTextHref, fullTextQuery, REGISTER_SOURCES } from "$lib/registerHub";
	import { searchViewHref } from "$lib/searchViews";
	import type { Snippet } from "svelte";
	import type { EntityKind } from "$lib/entityKey";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const nf = new Intl.NumberFormat("de-CH");
	const count = (n: number, one: string, many: string) => `${nf.format(n)} ${n === 1 ? one : many}`;
	const q = $derived(data.q);
	const ehedatenYears = `${EHEDATEN_YEAR_MIN}–${EHEDATEN_YEAR_MAX}`;
	// Räte ohne Jahresangabe im Label (die Karte nennt «seit 1803»).
	const councils = DIRECTORY_COUNCILS.filter((c) => c.value !== "").map((c) => ({ ...c, label: c.label.replace(/\s*\(.*\)$/, "") }));
	const editionKinds = $derived(REGISTER_KINDS.filter((k) => (data.sizes.editions?.[k.kind] ?? 0) > 0));

	type Preview<E> = Record<EntityKind, { entries: E[]; total: number } | null> | null;
	const hasAny = <E,>(p: Preview<E>) => !!p && REGISTER_KINDS.some((k) => (p[k.kind]?.total ?? 0) > 0);
</script>

<svelte:head>
	<title>{q ? `«${q}» in den Registern` : "Register"} | {SITE_NAME}</title>
	<meta
		name="description"
		content="Register der Personen, Orte und Organisationen in den Quellen: Archivkatalog, Rats- und Regierungsmitglieder, Ehedaten und Editionen, mit Namenssuche über alle."
	/>
	{#if q}<meta name="robots" content="noindex, follow" />{/if}
</svelte:head>

{#snippet compact(label: string, note: string)}
	<section class="border border-dashed border-zszh-300 rounded-md px-4 py-3 text-sm text-zszh-600">{label} · {note}</section>
{/snippet}

{#snippet loading(label: string)}
	<section class="bg-white border border-zszh-200 rounded-md p-4 text-sm text-zszh-600 animate-pulse">{label} · wird durchsucht …</section>
{/snippet}

{#snippet blockHead(source: string, register: string, href: string, linkLabel: string)}
	<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
		<h3 class="font-serif text-lg leading-snug text-zszh-900">
			{source}
			<span class="font-sans text-sm text-zszh-600">· {register}</span>
		</h3>
		<a href={href} class="text-xs text-accent-600 hover:underline">{linkLabel}</a>
	</div>
{/snippet}

{#snippet kindHead(label: string, total: number)}
	<h4 class="text-xs uppercase tracking-wider text-zszh-600 font-bold mb-1.5">
		{label}
		<span class="font-normal tabular-nums">{nf.format(total)}</span>
	</h4>
{/snippet}

{#snippet links(items: Array<{ href: string; label: string }>)}
	<p class="mt-3 text-sm font-medium">
		{#each items as it, i (it.href)}{#if i > 0}<span class="text-zszh-400">{" · "}</span>{/if}<a href={it.href} class="text-accent-600 hover:underline"
				>{it.label}</a
			>{/each}
	</p>
{/snippet}

{#snippet card(source: string, title: string, origin: string, body: Snippet)}
	<article class="bg-white border border-zszh-200 rounded-md shadow-sm p-5 flex flex-col">
		<div class="text-xs font-mono text-accent-600 mb-1">{source}</div>
		<h3 class="text-lg font-serif font-semibold text-zszh-900">{title}</h3>
		{@render body()}
		<p class="mt-auto pt-3 text-xs text-zszh-600 leading-relaxed">{origin}</p>
	</article>
{/snippet}

<div class="max-w-screen-lg mx-auto px-4 py-6">
	<nav aria-label="Pfad" class="text-xs text-zszh-600 mb-3 flex items-center gap-1.5">
		<a href="/" class="hover:underline">Start</a>
		<span class="text-zszh-400" aria-hidden="true">›</span>
		<span>Register</span>
	</nav>

	<header class="max-w-3xl mb-5">
		<h1 class="font-display text-4xl md:text-5xl leading-none text-zszh-900 mb-3">Register</h1>
		<p class="text-sm text-zszh-700 leading-relaxed">
			Personen, Orte und Organisationen in den Quellen. Jede Quelle hat ihr eigenes Register; die Suche fragt alle zugleich.
		</p>
	</header>

	<form method="GET" action="/register" class="mb-8 flex flex-wrap items-end gap-x-3 gap-y-2 text-sm" role="search">
		<label class="flex flex-col gap-1 flex-1 basis-64 min-w-0 max-w-md">
			<span class="text-zszh-700">Name, Ort oder Organisation</span>
			<input
				type="search"
				name="q"
				value={q}
				autocomplete="off"
				placeholder="z. B. Bullinger, Grüningen oder Escher Wyss"
				class="w-full px-3 py-1.5 bg-white border border-zszh-300 rounded focus:border-accent-500 outline-none"
			/>
		</label>
		<button type="submit" class="px-4 py-1.5 bg-zszh-900 text-zszh-50 rounded hover:bg-zszh-800">In allen Registern suchen</button>
		{#if q}<a href="/register" class="pb-1.5 text-accent-600 underline hover:text-accent-700">Zurücksetzen</a>{/if}
	</form>

	{#if q}
		<section aria-labelledby="treffer" class="mb-10 space-y-4">
			<h2 id="treffer" class="font-serif text-xl text-zszh-900">«{q}» in den Registern</h2>

			{#each REGISTER_SOURCES as s (s.id)}
				{#if s.id === "catalog"}
					{#if !data.available.catalog}
						{@render compact(s.label, "zurzeit nicht verfügbar")}
					{:else}
						{#await data.catalog}
							{@render loading(s.label)}
						{:then cat}
							{#if !cat}
								{@render compact(s.label, "zurzeit nicht verfügbar")}
							{:else if !hasAny(cat)}
								{@render compact(s.label, "kein Eintrag im Register")}
							{:else}
								<section class="bg-white border border-zszh-200 rounded-md p-4">
									{@render blockHead(s.label, "Register des Archivkatalogs", registerHref("personen", { q }), "Zum Register →")}
									<div class="grid gap-4 sm:grid-cols-3">
										{#each REGISTER_KINDS as k (k.slug)}
											{@const part = cat[k.kind]}
											<div>
												{@render kindHead(k.label, part?.total ?? 0)}
												{#if part && part.entries.length > 0}
													<ul class="space-y-1 text-sm">
														{#each part.entries as e (e.key)}
															<li>
																<a href={catalogEntitySearchHref(k.kind, e.form)} class="text-zszh-900 hover:text-accent-600 hover:underline">{e.form}</a>
																<span class="text-xs text-zszh-600 tabular-nums whitespace-nowrap">{count(e.count, "Einheit", "Einheiten")}</span>
																{#if e.krdb}
																	<a href={`/personen/${e.krdb.id}`} class="text-xs text-accent-700 hover:underline" title={`${e.krdb.name} – Kantonsratsdatenbank`}>Personenseite</a>
																{/if}
															</li>
														{/each}
													</ul>
													{#if part.total > part.entries.length}
														<a href={registerHref(k.slug, { q })} class="mt-1 inline-block text-xs text-accent-600 hover:underline">alle {nf.format(part.total)} →</a>
													{/if}
												{:else}
													<p class="text-xs text-zszh-500">{part ? "kein Eintrag" : "nicht verfügbar"}</p>
												{/if}
											</div>
										{/each}
									</div>
								</section>
							{/if}
						{/await}
					{/if}
				{:else if s.id === "documents"}
					{#if data.krdb && data.krdb.total > 0}
						<section class="bg-white border border-zszh-200 rounded-md p-4">
							{@render blockHead(s.label, "Rats- und Regierungsmitglieder", directoryUrl(data.directory), "Zum Verzeichnis →")}
							<ul class="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
								{#each data.krdb.entries as p (p.id)}
									<li>
										<a href={`/personen/${p.id}`} class="font-medium text-zszh-900 hover:text-accent-600 hover:underline">{p.name}</a>
										{#if p.lifespan}<span class="text-xs text-zszh-500">{p.lifespan}</span>{/if}
										<div class="text-xs text-zszh-600">
											{[...p.office, p.party].filter(Boolean).join(" · ")}{#if p.docs != null}{" · "}{#if p.docs > 0}{count(p.docs, "Dokument", "Dokumente")}{:else}keine Dokumente{/if}{/if}
										</div>
									</li>
								{/each}
							</ul>
							{#if data.krdb.total > data.krdb.entries.length}
								<a href={directoryUrl(data.directory)} class="mt-2 inline-block text-xs text-accent-600 hover:underline">alle {nf.format(data.krdb.total)} →</a>
							{/if}
						</section>
					{:else}
						{@render compact(s.label, data.available.krdb ? "kein Rats- oder Regierungsmitglied dieses Namens" : "Verzeichnis zurzeit nicht verfügbar")}
					{/if}
					{#if data.rat && data.rat.total > 0}
						<section class="bg-white border border-zszh-200 rounded-md p-4">
							{@render blockHead(s.label, "Kleiner Rat 1225–1798", ratDirectoryUrl(data.ratDirectory), "Zum Verzeichnis →")}
							<ul class="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
								{#each data.rat.entries as p (p.id)}
									<li>
										<a href={ratPersonUrl(p.id)} class="font-medium text-zszh-900 hover:text-accent-600 hover:underline">{p.name}</a>
										{#if p.life}<span class="text-xs text-zszh-500">{p.life}</span>{/if}
										<div class="text-xs text-zszh-600">{p.summary.join(" · ")}</div>
									</li>
								{/each}
							</ul>
							{#if data.rat.total > data.rat.entries.length}
								<a href={ratDirectoryUrl(data.ratDirectory)} class="mt-2 inline-block text-xs text-accent-600 hover:underline">alle {nf.format(data.rat.total)} →</a>
							{/if}
						</section>
					{:else}
						{@render compact(s.label, data.available.rat ? "kein Mitglied des Kleinen Rats dieses Namens" : "Register des Kleinen Rats zurzeit nicht verfügbar")}
					{/if}
				{:else if s.id === "ehedaten"}
					{#if !data.available.ehedaten}
						{@render compact(s.label, "zurzeit nicht verfügbar")}
					{:else}
						{#await data.ehedaten}
							{@render loading(s.label)}
						{:then ehe}
							{#if !ehe || (ehe.persons == null && ehe.places == null)}
								{@render compact(s.label, "zurzeit nicht verfügbar")}
							{:else if !ehe.persons && !ehe.places}
								{@render compact(s.label, "kein Eheeintrag mit diesem Namen")}
							{:else}
								<section class="bg-white border border-zszh-200 rounded-md p-4">
									{@render blockHead(s.label, `Bräutigam und Braut ${ehedatenYears}`, searchViewHref("ehedaten"), "Zum Reiter →")}
									<ul class="space-y-1 text-sm">
										{#if ehe.persons}
											<li>
												<a href={searchViewHref("ehedaten", { persons: q })} class="font-medium text-zszh-900 hover:text-accent-600 hover:underline tabular-nums"
													>{count(ehe.persons, "Eheeintrag", "Eheeinträge")}</a
												>
												<span class="text-zszh-700">mit «{q}» im Namen von Bräutigam oder Braut</span>
											</li>
										{/if}
										{#if ehe.places}
											<li>
												<a href={searchViewHref("ehedaten", { places: q })} class="font-medium text-zszh-900 hover:text-accent-600 hover:underline tabular-nums"
													>{count(ehe.places, "Eheeintrag", "Eheeinträge")}</a
												>
												<span class="text-zszh-700">mit «{q}» als Herkunft</span>
											</li>
										{/if}
									</ul>
								</section>
							{/if}
						{/await}
					{/if}
				{:else if s.id === "editions"}
					{#if !data.available.editions || !data.editions}
						{@render compact(s.label, "zurzeit nicht verfügbar")}
					{:else if !hasAny(data.editions)}
						{@render compact(s.label, "kein Eintrag im Register")}
					{:else}
						{@const ed = data.editions}
						<section class="bg-white border border-zszh-200 rounded-md p-4">
							{@render blockHead(s.label, "Register der Editionen", editionRegisterHref("personen", { q }), "Zum Register →")}
							<div class="grid gap-4 sm:grid-cols-3">
								{#each editionKinds as k (k.slug)}
									{@const part = ed[k.kind]}
									<div>
										{@render kindHead(k.label, part.total)}
										{#if part.entries.length > 0}
											<ul class="space-y-1 text-sm">
												{#each part.entries as e (e.name)}
													{@const years = yearSpan(e.yearFrom, e.yearTo)}
													<li>
														<a href={editionEntitySearchHref(k.kind, e.name)} class="text-zszh-900 hover:text-accent-600 hover:underline">{e.name}</a>
														<span class="text-xs text-zszh-600 tabular-nums whitespace-nowrap">{count(e.pieces, "Stück", "Stücke")}{years ? `, ${years}` : ""}</span>
														{#if e.gnd}<a href={gndHref(e.gnd)} target="_blank" rel="noopener external" class="text-xs text-accent-700 hover:underline">GND ↗</a>{/if}
													</li>
												{/each}
											</ul>
											{#if part.total > part.entries.length}
												<a href={editionRegisterHref(k.slug, { q })} class="mt-1 inline-block text-xs text-accent-600 hover:underline">alle {nf.format(part.total)} →</a>
											{/if}
										{:else}
											<p class="text-xs text-zszh-500">kein Eintrag</p>
										{/if}
									</div>
								{/each}
							</div>
						</section>
					{/if}
				{/if}
			{/each}

			<p class="text-sm text-zszh-700">
				Namen, die kein Register verzeichnet, findet die Volltextsuche:
				<a href={fullTextHref(q)} class="text-accent-600 hover:underline">«{fullTextQuery(q)}» in allen Quellen suchen →</a>
			</p>
			<p class="text-xs text-zszh-600 leading-relaxed max-w-3xl">
				Die Register sind nicht miteinander verknüpft: Derselbe Name in zwei Registern muss nicht dieselbe Person meinen.
				Ausnahmen: «Personenseite» neben einem Eintrag des Archivkatalogs (sicher zugeordnete Einheiten) und Verweise zwischen Kleinem Rat und Editionen bei gleicher GND.
			</p>
		</section>
	{/if}

	<section aria-labelledby="register">
		<h2 id="register" class="font-serif text-xl text-zszh-900 mb-4">{q ? "Alle Register" : "Die Register"}</h2>
		<div class="grid gap-4 md:grid-cols-2">
			{#each REGISTER_SOURCES as s (s.id)}
				{#if s.id === "catalog"}
					{#snippet catalogBody()}
						<p class="text-sm text-zszh-700 mt-2 leading-relaxed">
							Personen, Orte und Organisationen in den Verzeichnungen des Staatsarchivs – Akten, Urkunden, Pläne,
							Personendossiers –, mit der Zahl der Einheiten, die sie nennen.
						</p>
						{#if data.available.catalog}
							{@render links(REGISTER_KINDS.map((k) => ({ href: registerHref(k.slug), label: k.label })))}
						{:else}
							<p class="mt-3 text-sm text-zszh-500">Zurzeit nicht verfügbar.</p>
						{/if}
					{/snippet}
					{@render card(
						s.label,
						"Register des Archivkatalogs",
						"Automatisch erkannt. Gleich geschriebene Namen bilden einen Eintrag, auch wenn verschiedene Personen gemeint sind.",
						catalogBody,
					)}
				{:else if s.id === "documents"}
					{#snippet krdbBody()}
						<p class="text-sm text-zszh-700 mt-2 leading-relaxed">
							{data.sizes.krdb > 0 ? `${nf.format(data.sizes.krdb)} Mitglieder` : "Die Mitglieder"} des Kantonsrats und des Regierungsrats
							seit 1803, je mit Ämtern, Partei, Porträt und den Kantonsratsprotokollen, in denen sie vorkommen.
						</p>
						{@render links([
							{ href: "/personen", label: "Verzeichnis" },
							...councils.map((c) => ({ href: directoryUrl({ council: c.value }), label: c.label })),
						])}
					{/snippet}
					{@render card(
						s.label,
						"Rats- und Regierungsmitglieder",
						"Aus der Kantonsratsdatenbank; die Protokolle sind automatisch über Name und Amtszeit zugeordnet.",
						krdbBody,
					)}
					{#snippet ratBody()}
						<p class="text-sm text-zszh-700 mt-2 leading-relaxed">
							{data.sizes.rat > 0 ? `${nf.format(data.sizes.rat)} Mitglieder` : "Die Mitglieder"} des Kleinen Rats der Stadt Zürich
							1225–1798, je mit Einsitzen, Funktion, Zunft und – ab 1484 – den Ratsmanualen ihrer Amtszeit.
						</p>
						{#if data.available.rat}
							{@render links([
								{ href: "/rat", label: "Verzeichnis" },
								{ href: ratDirectoryUrl({ office: "Bürgermeister" }), label: "Bürgermeister" },
								{ href: ratDirectoryUrl({ rmOnly: true }), label: "Zeit der Ratsmanuale" },
							])}
						{:else}
							<p class="mt-3 text-sm text-zszh-500">Zurzeit nicht verfügbar.</p>
						{/if}
					{/snippet}
					{@render card(
						s.label,
						"Kleiner Rat 1225–1798",
						"Register des Staatsarchivs nach Werner Schnyder, Die Zürcher Ratslisten (1962). Die Sitzungen der Ratsmanuale ordnet die Plattform über den Band dem Halbjahresrat zu.",
						ratBody,
					)}
				{:else if s.id === "ehedaten"}
					{#snippet ehedatenBody()}
						<p class="text-sm text-zszh-700 mt-2 leading-relaxed">
							Trauungen und Verkündungen der Zürcher Kirchenbücher mit Namen, Herkunft und Kirchgemeinde von Bräutigam und Braut.
						</p>
						{#if data.available.ehedaten}
							{@render links([{ href: searchViewHref("ehedaten"), label: "Namenssuche im Reiter «Ehedaten»" }])}
						{:else}
							<p class="mt-3 text-sm text-zszh-500">Zurzeit nicht verfügbar.</p>
						{/if}
					{/snippet}
					{@render card(
						s.label,
						`Bräutigam und Braut ${ehedatenYears}`,
						"Erfasst vom Staatsarchiv aus den Kirchenbüchern; Namen vereinheitlicht, Daten bis 1700 im alten Stil.",
						ehedatenBody,
					)}
				{:else if s.id === "editions"}
					{#snippet editionsBody()}
						<p class="text-sm text-zszh-700 mt-2 leading-relaxed">
							{#if data.sizes.editions}
								{count(data.sizes.editions.person, "Person", "Personen")}, {count(data.sizes.editions.place, "Ort", "Orte")}{data.sizes.editions.org > 0
									? ` und ${count(data.sizes.editions.org, "Organisation", "Organisationen")}`
									: ""}
								aus {count(data.sizes.editions.pieces, "edierten Stück", "edierten Stücken")} der Quellen zur Zürcher Geschichte (QZH) und
								der Zürcher Rechtsquellen, je mit Zeitraum und Schreibungen in den Texten.
							{:else}
								Personen, Orte und Organisationen der edierten Quellenstücke der Quellen zur Zürcher Geschichte (QZH) und der Zürcher
								Rechtsquellen.
							{/if}
						</p>
						{#if data.available.editions && editionKinds.length > 0}
							{@render links(editionKinds.map((k) => ({ href: editionRegisterHref(k.slug), label: k.label })))}
						{:else}
							<p class="mt-3 text-sm text-zszh-500">Zurzeit nicht verfügbar.</p>
						{/if}
					{/snippet}
					{@render card(
						s.label,
						"Register der Editionen",
						"Von den Bearbeiterinnen und Bearbeitern der Edition erschlossen; Personen unter dem Namen der Gemeinsamen Normdatei (GND), wo die Edition sie nennt.",
						editionsBody,
					)}
				{/if}
			{/each}
		</div>
	</section>
</div>
