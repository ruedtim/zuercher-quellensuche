// Prüfungen am Anfang jeder Anfrage (hooks.server.ts). Anlass: nginx wählt seine Location nach dem
// dekodierten, von «..» bereinigten Pfad, reicht aber den rohen weiter, und SvelteKit dekodiert
// Trennzeichen erst im Routen-Parameter. Ein Pfad, den die beiden verschieden lesen, umginge Regeln,
// die nur einer anwendet (Gate, Limits). Derselbe Filter steht in infra/nginx-website.conf.
// Ohne $env → requestGuard.test.ts.

// Kodierte Trennzeichen (%2F %5C %23 %3F), Punkte, NUL, doppelte Kodierung (%25), Buchstaben und
// Ziffern, der Backslash, den der URL-Parser wie «/» liest, und das Segment «..» (nginx legt vorher
// doppelte Schrägstriche zusammen, der URL-Parser nicht: «/a//../b» ist dort /b, hier /a/b). Kein
// Client schickt das in unseren Pfaden – Browser, curl und Bibliotheken lösen «..» vor dem Senden auf;
// Umlaute, Leerzeichen und alles im Query bleiben erlaubt.
const SUSPICIOUS = /%(?:2e|2f|5c|23|3f|00|25|3\d|[46][1-9a-f]|[57][0-9a])|\\|\/\.\.(?:\/|$)/i;

/** Ist der rohe Pfad (Anfrageziel ohne Query) auf eine zweite Lesart angelegt? */
export function isSuspiciousPath(target: string): boolean {
	return SUSPICIOUS.test(target.split(/[?#]/, 1)[0]);
}

// Routen, die Meili, den Embed-Service oder ganze Dateien brauchen. Nicht dabei: MCP, Treffer-Export
// (eigene Plätze), Porträts (eigener Cache), Feedback und Seiten aus dem Speicher.
const COSTLY = [
	"/search",
	"/api/search",
	"/api/catalog",
	"/api/editions",
	"/api/ehedaten",
	"/api/similar",
	"/api/document",
	"/api/v1",
	"/api/dts",
	"/documents",
	"/personen/[id]",
	"/rat/[id]",
	"/register",
	"/archivkatalog",
	"/editionen",
];
const OWN_LIMITS = ["/api/search/export"];

/** Zählt diese Route zu den teuren, von denen nur wenige gleichzeitig laufen (WEB_GATE)? */
export function isCostlyRoute(routeId: string | null): boolean {
	if (!routeId) return false;
	const under = (prefix: string) => routeId === prefix || routeId.startsWith(`${prefix}/`);
	return COSTLY.some(under) && !OWN_LIMITS.some(under);
}

export type PublicApi = "v1" | "dts" | "mcp";

/**
 * Öffentliche API, zu der eine Anfrage gehört. Entscheidet nach der getroffenen Route: SvelteKit
 * routet den dekodierten Pfad, `event.url.pathname` ist der rohe («/%61pi/v1» entging so dem
 * Rate-Limit). Ohne Route (404) gilt der Pfad.
 */
export function publicApiOf(routeId: string | null, pathname: string): PublicApi | null {
	const path = routeId ?? pathname;
	if (path.startsWith("/api/v1")) return "v1";
	if (path.startsWith("/api/dts")) return "dts";
	if (path.startsWith("/api/mcp")) return "mcp";
	return null;
}
