<script lang="ts">
	// Bildnachweis eines Porträts. Commons: Urheber bzw. Credit → Dateiseite,
	// Lizenz → Lizenztext (Pflicht bei CC BY(-SA) und «Attribution»).
	// Z 1114: «Foto: Fotograf:in · Staatsarchiv Zürich, Signatur» → Katalogeintrag.
	// Genutzt auf der Detailseite (Tab «Personen», Karte im Text) und auf der Personenseite.
	export interface PortraitCredit {
		source: "commons" | "z1114";
		page: string;
		credit: string | null;
		license: string | null;
		licenseUrl: string | null;
	}

	let { portrait }: { portrait: PortraitCredit } = $props();

	const label = $derived(
		portrait.source === "z1114"
			? `Foto: ${portrait.credit ?? "Staatsarchiv Zürich"}`
			: `Bild: ${portrait.credit ?? "Wikimedia Commons"}`,
	);
</script>

<div class="mt-0.5 text-[11px] leading-tight text-zszh-500 line-clamp-2" title={portrait.credit ?? undefined}>
	<a href={portrait.page} target="_blank" rel="noopener external" class="hover:underline">{label}</a
	>{#if portrait.license}
		{" · "}{#if portrait.licenseUrl}<a
				href={portrait.licenseUrl}
				target="_blank"
				rel="noopener external license"
				class="hover:underline">{portrait.license}</a
			>{:else}{portrait.license}{/if}
	{/if}
</div>
