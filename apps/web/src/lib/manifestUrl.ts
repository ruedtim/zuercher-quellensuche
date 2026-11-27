/**
 * Manifest-URL-Normalisierung für user-facing Links.
 *
 * Wenn der Indexer mit PUBLIC_BASE_URL=http://localhost:5173 (Dev) lief, landen
 * Werte wie "http://localhost:5173/iiif/.../manifest.json" im Meili-Index.
 * Beim direkten Klick auf den IIIF-Button im Frontend würde der Browser dann
 * auf localhost laufen – defekt für jeden, der nicht zufällig einen Dev-Server
 * auf 5173 hat. Wir schreiben diese Hosts beim Server-Render auf den aktuellen
 * Origin um, damit der Link bis zum nächsten Re-Index sauber bleibt.
 */
const REWRITABLE_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function normalizeManifestUrlForUser(raw: string, originUrl: URL): string {
	try {
		const u = new URL(raw);
		if (REWRITABLE_HOSTS.has(u.hostname)) {
			return `${originUrl.origin}${u.pathname}${u.search}`;
		}
		return raw;
	} catch {
		return raw;
	}
}
