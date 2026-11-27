import { EMBED_URL } from "./env";
import { createTtlLruCache } from "./ttlCache";

let embedderHealthy: boolean | null = null;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30_000;

export async function isEmbedderHealthy(): Promise<boolean> {
	const now = Date.now();
	if (embedderHealthy !== null && now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
		return embedderHealthy;
	}
	try {
		const res = await fetch(`${EMBED_URL}/healthz`, {
			signal: AbortSignal.timeout(2000),
		});
		const body = (await res.json()) as { status?: string };
		embedderHealthy = body.status === "ok";
	} catch {
		embedderHealthy = false;
	}
	lastHealthCheck = now;
	return embedderHealthy;
}

// Query-Vektoren cachen: Embeddings sind deterministisch, und dieselben Texte
// kommen laufend wieder – das Thema bei jeder Folge-Interaktion (Pagination,
// Sortierung, Facetten, Nachbar-Navigation), RAG-Fragen über «Mehr wissen»-
// Runden, Titel+Body-Präfix bei similar-Aufrufen. Spart pro Hit einen
// Embed-Service-Roundtrip (auf CPU der teuerste Einzelschritt der Suche).
// maxKeyLen: /api/embed nimmt unbegrenzten Nutzertext – Riesen-Keys nicht
// cachen, sonst wird der Cache selbst zum Memory-Vektor (~6 KB/Vektor × 300
// Einträge ≈ 2 MB bleiben so die Obergrenze). Fehlschläge (null) nie cachen.
const vectorCache = createTtlLruCache<number[]>({
	maxEntries: 300,
	ttlMs: 60 * 60_000,
	maxKeyLen: 4000,
});

// Laufende Anfragen teilen: der Katalog-Reiter embedded dasselbe Thema gleichzeitig
// für seine Liste und für die Trefferzahl der Dokumente (+page.server.ts).
const inflight = new Map<string, Promise<number[] | null>>();

export async function embedQuery(text: string): Promise<number[] | null> {
	const key = text.trim();
	if (!key) return null;
	const cached = vectorCache.get(key);
	if (cached) return cached;
	const pending = inflight.get(key);
	if (pending) return pending;
	const request = fetchVector(text, key).finally(() => inflight.delete(key));
	inflight.set(key, request);
	return request;
}

async function fetchVector(text: string, key: string): Promise<number[] | null> {
	try {
		const res = await fetch(`${EMBED_URL}/embed`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ texts: [text] }),
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) {
			console.warn(`[embed] ${res.status} ${res.statusText}`);
			return null;
		}
		const json = (await res.json()) as { vectors: number[][] };
		const vec = json.vectors[0] ?? null;
		if (vec) vectorCache.set(key, vec);
		return vec;
	} catch (err) {
		console.warn("[embed] failed:", err);
		return null;
	}
}
