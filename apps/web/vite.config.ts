import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5173,
		strictPort: false,
	},
	// Mirador (~30 MB) wird per dynamic import erst beim Klick auf den Faksimile-
	// Tab geladen – Vite splittet es automatisch in einen separaten Chunk.
	// NICHT als external markieren (sonst sucht der Browser zur Laufzeit nach
	// einer URL "mirador" auf dem eigenen Origin und failt).
	ssr: {
		// Im SSR-Build wird Mirador NICHT eingebunden (Server rendert nie das
		// Faksimile-Widget). Der Client-Build bundlet Mirador in einen lazy
		// Chunk; der dynamic import in Facsimile.svelte greift dort.
		external: ["mirador"],
	},
});
