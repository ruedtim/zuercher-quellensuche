// In-Memory-Rate-Limiter für /api/v1 (Sliding Window pro Client-Key).
//
// Bewusst in-memory: der Stack läuft als genau eine web-Replica (compose),
// damit ist der Prozess-Speicher autoritativ. Horizontale Skalierung bräuchte
// einen shared Store – dokumentiert, nicht gebaut (YAGNI).
//
// Key-Granularität: hinter nginx kommt die anonymisierte IP an (IPv4 /24,
// IPv6 /32 – siehe $anon_ip in infra/nginx-zentraleserien-new.conf), das
// Limit gilt also pro /24-Netz statt pro Host. Privacy-konsistent und für
// Fair-Use-Zwecke ausreichend. Pure Funktionen mit injizierbarer Clock für
// die node:test-Suite.

interface BucketCheck {
	ok: boolean;
	// Sekunden bis der älteste Eintrag aus dem Fenster fällt (für Retry-After).
	retryAfterS: number;
	// Verbleibende Requests im aktuellen Fenster (für X-RateLimit-Remaining).
	remaining: number;
}

const buckets = new Map<string, number[]>();

// Lazy-Sweep statt setInterval: kein Timer-Handle, kein HMR-Leak im Dev.
// Greift, sobald die Map ungewöhnlich gross wird (viele distinct Clients).
const SWEEP_THRESHOLD = 10_000;

export function checkRateLimit(
	key: string,
	limit: number,
	windowMs: number,
	now: number = Date.now(),
): BucketCheck {
	const cutoff = now - windowMs;
	const ts = (buckets.get(key) ?? []).filter((t) => t > cutoff);
	if (ts.length >= limit) {
		buckets.set(key, ts);
		return {
			ok: false,
			retryAfterS: Math.max(1, Math.ceil((ts[0] + windowMs - now) / 1000)),
			remaining: 0,
		};
	}
	ts.push(now);
	buckets.set(key, ts);
	if (buckets.size > SWEEP_THRESHOLD) sweepStale(cutoff);
	return { ok: true, retryAfterS: 0, remaining: Math.max(0, limit - ts.length) };
}

/** Entfernt Keys, deren Einträge komplett vor `cutoff` liegen. */
export function sweepStale(cutoff: number): void {
	for (const [key, ts] of buckets) {
		if (ts.length === 0 || ts[ts.length - 1] <= cutoff) buckets.delete(key);
	}
}

/** Nur für Tests: Limiter-Zustand zurücksetzen. */
export function resetRateLimiter(): void {
	buckets.clear();
}

/** Nur für Tests/Diagnose: Anzahl getrackter Keys. */
export function bucketCount(): number {
	return buckets.size;
}
