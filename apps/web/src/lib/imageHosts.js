// Bildserver, von denen der Browser Faksimiles lädt (Bilder und info.json). EINZIGE Stelle: daraus
// entsteht die Content-Security-Policy (svelte.config.js), und das ZIP-Paket holt Scans nur von
// `PACKAGE_IMAGE_HOSTS`. Ein neuer Bildserver gehört hierher und in die Datenschutzerklärung (§11).
// Als .js, weil auch svelte.config.js sie braucht.

/** Amtsblatt, KRP, RRB, OS, Editionen. */
const SOURCES_ONLINE = "https://media.sources-online.org";
/** Ratsmanuale (READ-COOP). */
const TRANSKRIBUS = "https://files.transkribus.eu";
/** Einzelne Stücke der QZH (Zentralbibliothek Zürich). */
const E_MANUSCRIPTA = "https://www.e-manuscripta.ch";

export const IMAGE_HOSTS = [SOURCES_ONLINE, TRANSKRIBUS, E_MANUSCRIPTA];

/** Scans der Ratsmanuale kommen nicht ins Paket (Transkribus sperrt Abrufer), nur Links. */
export const PACKAGE_IMAGE_HOSTS = [SOURCES_ONLINE];

/**
 * Content-Security-Policy der Seiten (kit.csp: Nonce je Antwort). `style-src` mit unsafe-inline, weil
 * Svelte-Übergänge, Mirador (emotion) und Swagger Stile einsetzen; die Porträts kommen vom eigenen
 * Server. `frame-src 'self'` trägt den Treffer-Export (verstecktes iframe).
 */
export const CSP_DIRECTIVES = {
	"default-src": ["self"],
	"script-src": ["self"],
	"style-src": ["self", "unsafe-inline"],
	"img-src": ["self", "data:", "blob:", ...IMAGE_HOSTS],
	"connect-src": ["self", ...IMAGE_HOSTS],
	"font-src": ["self", "data:"],
	"worker-src": ["self", "blob:"],
	"frame-src": ["self"],
	"frame-ancestors": ["self"],
	"object-src": ["none"],
	"base-uri": ["self"],
	"form-action": ["self"],
};
