<script lang="ts">
	// Namen einer Verzeichnungseinheit (Register): Personen, Orte und Organisationen, die
	// der Katalog-Aufbau erkannt hat. Jeder Name führt in die Katalogsuche nach allen
	// Einheiten mit demselben Namen (Zahl dahinter; nur diese Einheit ⇒ kein Link), Personen
	// mit gesicherter Zuordnung zur Kantonsratsdatenbank zusätzlich auf ihre Personenseite.
	import { catalogEntitySearchHref, REGISTER_KINDS, registerHref, type UnitEntities } from "$lib/catalogRegister";

	let { entities }: { entities: UnitEntities } = $props();

	const nf = new Intl.NumberFormat("de-CH");
	const rows = $derived(REGISTER_KINDS.filter((k) => entities[k.kind].length > 0));
</script>

{#if rows.length > 0}
	<section class="bg-white border border-zszh-200 rounded-md px-5 py-4 mb-4" aria-labelledby="namen">
		<h2 id="namen" class="text-xs uppercase tracking-wider text-zszh-700 font-bold mb-3">Personen, Orte, Organisationen</h2>
		<dl class="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-x-6 gap-y-2 text-sm">
			{#each rows as k (k.kind)}
				<dt class="text-zszh-600 sm:pt-px">
					<a href={registerHref(k.slug)} class="hover:text-accent-600 hover:underline" title={`Register: ${k.label}`}>{k.label}</a>
				</dt>
				<dd class="text-zszh-900 min-w-0 mb-1 sm:mb-0">
					<ul class="flex flex-wrap gap-x-4 gap-y-1">
						{#each entities[k.kind] as e (e.key)}
							<li>
								{#if e.count === 1}
									<span title="Nur in dieser Einheit">{e.form}</span>
								{:else}
									<a href={catalogEntitySearchHref(k.kind, e.form)} class="text-accent-700 hover:underline" title="Alle Einheiten mit diesem Namen">{e.form}</a
									>{#if e.count != null}{" "}<span class="text-xs text-zszh-500 tabular-nums">({nf.format(e.count)})</span>{/if}
								{/if}
								{#if e.krdb}
									<a href={`/personen/${e.krdb.id}`} class="text-xs text-accent-700 hover:underline" title={`${e.krdb.name} – Kantonsratsdatenbank`}>Personenseite</a>
								{/if}
							</li>
						{/each}
					</ul>
				</dd>
			{/each}
		</dl>
		<p class="mt-3 text-xs text-zszh-600">
			Automatisch erkannt, Fehler möglich. Die Zahl zählt Einheiten mit demselben Namen, auch andere Personen.
			<a href="/about/archivkatalog#register" class="underline decoration-dotted underline-offset-2 hover:text-accent-600">Register</a>
		</p>
	</section>
{/if}
