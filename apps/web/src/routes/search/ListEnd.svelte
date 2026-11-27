<script lang="ts">
	// Seite hinter dem Ende der Liste (zu hohe Seitenzahl in der Adresse oder hinter dem Deckel fürs
	// Blättern, server/browseLimit.ts): Hinweis mit Sprung zur letzten Seite.
	let { lastPage, onPage }: { lastPage: number; onPage: (page: number) => void } = $props();
</script>

<div class="bg-white border border-zszh-200 rounded-md p-8 text-center text-zszh-600">
	Die Liste endet bei Seite {lastPage.toLocaleString("de-CH")}.
	<button type="button" class="underline" onclick={() => onPage(lastPage)}>Zur letzten Seite</button>
</div>
