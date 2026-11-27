<script lang="ts">
	let { children } = $props();
</script>

<article class="max-w-screen-md mx-auto px-4 py-12 prose prose-zinc prose-headings:font-serif prose-h1:font-display prose-h1:font-normal prose-h1:leading-[0.95] prose-h1:text-[clamp(2.1rem,10.5vw,3rem)] prose-code:before:content-none prose-code:after:content-none prose-pre:whitespace-pre-wrap prose-pre:wrap-anywhere prose-headings:text-zszh-900 prose-headings:wrap-break-word prose-headings:hyphens-auto prose-a:text-accent-600">
	{@render children()}
</article>
