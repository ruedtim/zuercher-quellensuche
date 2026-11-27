<script lang="ts">
	// Porträt einer KRDB-Person (Commons über den eigenen Proxy bzw. Staatsarchiv
	// Z 1114 als eigene Datei) oder Initialen-Platzhalter – ohne Bild oder wenn es
	// nicht lädt. Genutzt vom Tab «Personen» (tile), von der Karte im Text (card)
	// und vom Kopf der Personenseite (large).
	let {
		person,
		size = "tile",
	}: {
		person: { name: string; portrait: { src: string; width: number; height: number } | null };
		size?: "tile" | "card" | "large";
	} = $props();

	let broken = $state(false);

	const box = $derived(
		size === "tile" ? "w-[72px] h-[90px] text-xl" : size === "card" ? "w-16 h-20 text-lg" : "w-28 h-36 text-3xl",
	);

	function initials(name: string): string {
		const parts = name.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w));
		return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
	}

	// Kein onerror-Attribut: Svelte schreibt dafür beim Server-Rendern ein Inline-Skript, das die
	// Content-Security-Policy sperrt. Was schon vor der Hydration scheiterte, sagt naturalWidth.
	function watchErrors(img: HTMLImageElement) {
		const fail = () => (broken = true);
		if (img.complete && img.naturalWidth === 0) fail();
		img.addEventListener("error", fail);
		return () => img.removeEventListener("error", fail);
	}
</script>

{#if person.portrait && !broken}
	<img
		src={person.portrait.src}
		width={person.portrait.width}
		height={person.portrait.height}
		alt=""
		loading={size === "large" ? "eager" : "lazy"}
		decoding="async"
		class="{box} shrink-0 object-cover object-top rounded-sm bg-zszh-100"
		{@attach watchErrors}
	/>
{:else}
	<div
		class="{box} shrink-0 rounded-sm bg-zszh-100 text-zszh-500 flex items-center justify-center font-serif"
		aria-hidden="true"
	>
		{initials(person.name)}
	</div>
{/if}
