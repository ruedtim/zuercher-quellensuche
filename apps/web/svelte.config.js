import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";
import rehypeSlug from "rehype-slug";
import { CSP_DIRECTIVES } from "./src/lib/imageHosts.js";
import { SITE_HOST, SITE_URL } from "./src/lib/siteAddress.js";

// %SITE_URL%/%SITE_HOST% in den Markdown-Seiten: Codeblöcke (curl-Beispiele, MCP-Adresse)
// können keine Svelte-Ausdrücke auswerten. Läuft vor mdsvex.
const siteAddress = {
	name: "site-address",
	markup: ({ content, filename }) =>
		filename?.endsWith(".md")
			? { code: content.replaceAll("%SITE_URL%", SITE_URL).replaceAll("%SITE_HOST%", SITE_HOST) }
			: undefined,
};

// Tabellen der Markdown-Seiten in einen waagrecht scrollbaren, mit der Tastatur erreichbaren
// Rahmen setzen (.table-scroll in app.css), damit sie auf Handys weder die Seite verbreitern
// noch mitten im Wort umbrechen.
const rehypeTableScroll = () => (tree) => {
	const walk = (node) => {
		node.children = node.children?.flatMap((child) => {
			if (child.tagName !== "table") {
				walk(child);
				return [child];
			}
			return [
				{ type: "raw", value: "<!-- svelte-ignore a11y_no_noninteractive_tabindex -->" },
				{
					type: "element",
					tagName: "div",
					properties: { className: ["table-scroll"], role: "group", ariaLabel: "Tabelle", tabIndex: 0 },
					children: [child],
				},
			];
		});
	};
	walk(tree);
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: [".svelte", ".md"],
	preprocess: [
		siteAddress,
		vitePreprocess(),
		mdsvex({
			extensions: [".md"],
			// Heading-IDs (Slugs) für die Sprungmarken der Inhaltsverzeichnisse.
			// Setzt nur fehlende ids – explizite <h2 id="…"> bleiben unangetastet.
			rehypePlugins: [rehypeSlug, rehypeTableScroll],
		}),
	],
	kit: {
		adapter: adapter({ out: "build" }),
		// Nur eigene Skripte (Nonce je Antwort), Bilder nur von den bekannten Bildservern.
		csp: { mode: "auto", directives: CSP_DIRECTIVES },
		prerender: {
			entries: ["/", "/impressum", "/datenschutz", "/about"],
			handleHttpError: "warn",
		},
		alias: {
			$lib: "src/lib",
		},
	},
};

export default config;
