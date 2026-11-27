// Kleiner TTL-LRU-Cache (Map-basiert, Insertion-Order = LRU-Ordnung).
// Pure + dependency-frei → unit-testbar ohne $env (ttlCache.test.ts);
// genutzt vom Embed-Vektor-Cache (embed.ts) und vom Porträt-Proxy
// (portraitProxy.ts, dort zusätzlich nach Bytes begrenzt).

export interface TtlLruCache<V> {
	get(key: string): V | undefined;
	set(key: string, value: V): void;
	readonly size: number;
}

export function createTtlLruCache<V>(opts: {
	maxEntries: number;
	ttlMs: number;
	// Keys über dieser Länge werden nicht gecached (get liefert undefined,
	// set ist ein No-op) – gegen unbegrenzte Texte als Memory-Vektor.
	maxKeyLen?: number;
	// Injizierbare Uhr für Tests.
	now?: () => number;
	// Optionales Gewicht je Wert (z. B. Bytes): mit maxWeight begrenzt der
	// Cache zusätzlich die Summe; ein einzelner zu schwerer Wert wird nicht
	// gecached.
	weigh?: (value: V) => number;
	maxWeight?: number;
}): TtlLruCache<V> {
	const { maxEntries, ttlMs, maxKeyLen, weigh, maxWeight } = opts;
	const now = opts.now ?? Date.now;
	const map = new Map<string, { value: V; expiresAt: number; weight: number }>();
	let total = 0;
	const drop = (key: string) => {
		const e = map.get(key);
		if (!e) return;
		total -= e.weight;
		map.delete(key);
	};

	return {
		get(key: string): V | undefined {
			if (maxKeyLen != null && key.length > maxKeyLen) return undefined;
			const entry = map.get(key);
			if (!entry) return undefined;
			if (entry.expiresAt <= now()) {
				drop(key);
				return undefined;
			}
			// LRU-Refresh: ans Ende der Insertion-Order rotieren.
			map.delete(key);
			map.set(key, entry);
			return entry.value;
		},
		set(key: string, value: V): void {
			if (maxKeyLen != null && key.length > maxKeyLen) return;
			const weight = weigh ? weigh(value) : 0;
			drop(key);
			if (maxWeight != null && weight > maxWeight) return;
			map.set(key, { value, expiresAt: now() + ttlMs, weight });
			total += weight;
			while (map.size > maxEntries || (maxWeight != null && total > maxWeight)) {
				const oldest = map.keys().next().value;
				if (oldest === undefined) break;
				drop(oldest);
			}
		},
		get size() {
			return map.size;
		},
	};
}
