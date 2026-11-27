// Adresse der Website – EINZIGE Stelle im Code. Als .js, weil auch svelte.config.js sie braucht
// (setzt %SITE_URL%/%SITE_HOST% in den Markdown-Seiten ein); im Code über `$lib/site` importieren.
//
// Laufzeitwert für API-, MCP- und Permalinks ist PUBLIC_BASE_URL (apiBaseUrl); die Vorgabe in
// infra/compose.* muss dieser Adresse entsprechen. Statisch daneben: static/llms.txt und
// static/.well-known/mcp.json. Beides prüft site.test.ts.
//
// Der Indexer behält bewusst https://zentraleserien.ch als Basis: die IIIF-Manifeste im Index und
// auf der Platte tragen diese Kennung, sie löst über die alte Adresse weiter auf.
export const SITE_HOST = "archivquellen.ch";
export const SITE_URL = `https://${SITE_HOST}`;

/** Frühere Adressen, die weiter auf die Website führen (die drei auf ruediger.broker: 2026-11-23/24). */
export const LEGACY_HOSTS = [
	"zentraleserien.ch",
	"www.zentraleserien.ch",
	"zh-protoplattform.ruediger.broker",
	"zh-quellenplattform.ruediger.broker",
	"zh-quellensuche.ruediger.broker",
];
