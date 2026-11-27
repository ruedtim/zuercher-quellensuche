// Porträt-Proxy für die KRDB-Personen auf den KRP-Detailseiten: lädt das
// Commons-Vorschaubild serverseitig und cacht es, damit Besucher:innen keine
// Anfragen an Wikimedia schicken (Datenschutz). Schlüssel ist die QID, bei
// kuratierten Porträts ohne Wikidata-Item «K» + KRDB-ID (portraitKey in
// krdbMatch.ts). Die Upstream-URL kommt nur aus dem Register, nie vom Client
// (kein offener Proxy). Pure bis auf den
// injizierten fetch → unit-getestet (portraitProxy.test.ts).

import { SITE_URL } from "../site";
import { createTtlLruCache } from "./ttlCache";

export interface PortraitSource {
	url: string;
	/** Versions-Token aus dem Register (Cache-Busting der Proxy-URL). */
	v?: string;
}

export interface PortraitBody {
	bytes: Uint8Array<ArrayBuffer>;
	type: string;
}

export type PortraitResult = { ok: true; body: PortraitBody } | { ok: false; status: 404 | 502 };

// Wikimedia-User-Agent-Policy: beschreibend, mit Kontakt (Adresse des Impressums, keine Mail).
export const PORTRAIT_USER_AGENT =
	`archivquellen/1.0 (${SITE_URL}/impressum) portrait-proxy`;
export const PORTRAIT_MAX_BYTES = 300 * 1024;
const KEY = /^(?:Q[1-9]\d{0,11}|K[1-9]\d{0,9})$/;
// Nie SVG: ein SVG auf der eigenen Origin könnte Skript ausführen.
const ALLOWED_TYPES = /^image\/(jpeg|png|gif|webp)$/;
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const DAY_MS = 86_400_000;

export interface PortraitProxy {
	get(key: string): Promise<PortraitResult>;
	/** Aktuelles Versions-Token des Schlüssels (für `immutable`-Caching). */
	version(key: string): string | undefined;
}

export function createPortraitProxy(deps: {
	lookup: (key: string) => PortraitSource | null;
	fetch: typeof fetch;
	now?: () => number;
	timeoutMs?: number;
	maxCacheBytes?: number;
}): PortraitProxy {
	const now = deps.now ?? Date.now;
	const timeoutMs = deps.timeoutMs ?? 8000;
	const cache = createTtlLruCache<PortraitBody>({
		maxEntries: 600,
		ttlMs: 7 * DAY_MS,
		now,
		weigh: (b) => b.bytes.byteLength,
		maxWeight: deps.maxCacheBytes ?? 32 * 1024 * 1024,
	});
	// Fehlschläge kurz merken, damit ein ausgefallenes Commons nicht bei jedem
	// Seitenaufruf erneut angefragt wird.
	const failures = createTtlLruCache<true>({ maxEntries: 600, ttlMs: 10 * 60 * 1000, now });
	const inflight = new Map<string, Promise<PortraitBody | null>>();

	const allowedHost = (url: string): boolean => {
		try {
			return ALLOWED_HOSTS.has(new URL(url).hostname);
		} catch {
			return false;
		}
	};

	async function load(url: string): Promise<PortraitBody | null> {
		if (!allowedHost(url)) return null;
		try {
			const res = await deps.fetch(url, {
				headers: { "User-Agent": PORTRAIT_USER_AGENT },
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!res.ok) return null;
			if (res.url && !allowedHost(res.url)) return null;
			const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
			if (!ALLOWED_TYPES.test(type)) return null;
			if (Number(res.headers.get("content-length") ?? 0) > PORTRAIT_MAX_BYTES) return null;
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.byteLength === 0 || bytes.byteLength > PORTRAIT_MAX_BYTES) return null;
			return { bytes, type };
		} catch {
			return null;
		}
	}

	return {
		async get(key: string): Promise<PortraitResult> {
			if (!KEY.test(key)) return { ok: false, status: 404 };
			const src = deps.lookup(key);
			if (!src) return { ok: false, status: 404 };
			const hit = cache.get(key);
			if (hit) return { ok: true, body: hit };
			if (failures.get(key)) return { ok: false, status: 502 };
			let pending = inflight.get(key);
			if (!pending) {
				pending = load(src.url).finally(() => inflight.delete(key));
				inflight.set(key, pending);
			}
			const body = await pending;
			if (!body) {
				failures.set(key, true);
				return { ok: false, status: 502 };
			}
			cache.set(key, body);
			return { ok: true, body };
		},
		version(key: string): string | undefined {
			return deps.lookup(key)?.v;
		},
	};
}
