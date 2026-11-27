// Begrenzt, wie viel teure Arbeit gleichzeitig läuft (MCP-Aufrufe, Seiten und API-Anfragen mit Suche).
// Kontingente zählen nur, wie viele Anfragen kommen, nicht wie viele auf einmal laufen: 300
// gleichzeitige MCP-Aufrufe luden Hunderte MB Volltexte und beendeten den Webprozess (400-MB-
// Container, Website und API im selben Prozess). Zwei Grenzen, je insgesamt und je Netz:
//   - laufende Aufrufe (`acquire`): höchstens `maxActive`, je Netz `maxPerKey`
//   - fertige Antworten, die der Client noch nicht abgeholt hat (`hold`): ab `maxHeld` Bytes, je
//     Netz `maxHeldPerKey`, beginnt nichts Neues – sonst stauten langsame Leser und Batches sie an
// Was keinen Platz hat, wartet der Reihe nach. Ist die Warteschlange voll oder dauert es länger als
// `maxWaitMs`, kommt «busy» zurück. In-memory wie der Rate-Limiter (eine web-Replica). Ohne $env →
// gate.test.ts.

const MB = 1024 * 1024;

export interface GateOptions {
	maxActive: number;
	maxPerKey: number;
	maxQueue: number;
	maxQueuePerKey: number;
	maxWaitMs: number;
	/** Bytes fertiger, noch nicht abgeholter Antworten (`hold`); Infinity = nicht gezählt. */
	maxHeld: number;
	maxHeldPerKey: number;
}

/**
 * Seiten und Schnittstellen mit Suche (hooks.server.ts, isCostlyRoute): hält Meili und den Speicher in
 * Grenzen, wenn viele Anfragen zugleich kommen. Im Normalbetrieb (0,1–0,5 s je Anfrage) unsichtbar.
 */
export const WEB_GATE: GateOptions = {
	maxActive: 16,
	// Ein «Netz» ist bei IPv6 ein ganzer Anbieter (/32).
	maxPerKey: 8,
	maxQueue: 120,
	maxQueuePerKey: 40,
	maxWaitMs: 15_000,
	maxHeld: Number.POSITIVE_INFINITY,
	maxHeldPerKey: Number.POSITIVE_INFINITY,
};

export const MCP_GATE: GateOptions = {
	maxActive: 6,
	maxPerKey: 4,
	maxQueue: 80,
	maxQueuePerKey: 40,
	maxWaitMs: 20_000,
	maxHeld: 32 * MB,
	maxHeldPerKey: 8 * MB,
};

export type GateSlot = { ok: true; release: () => void } | { ok: false; reason: "busy" | "aborted" };

interface Waiter {
	key: string;
	settle: (slot: GateSlot) => void;
}

export interface Gate {
	/** Platz für einen Aufruf. Erst freigeben, wenn die Antwort fertig und per `hold` gezählt ist. */
	acquire(key: string, signal?: AbortSignal): Promise<GateSlot>;
	/** Fertige Antwort zählen, bis der Client sie hat; die Rückgabe gibt sie frei (wirkt einmal). */
	hold(key: string, bytes: number): () => void;
	/** Nur für Tests/Diagnose. */
	stats(): { active: number; waiting: number; held: number };
}

/** Summe insgesamt und je Schlüssel; Schlüssel ohne Rest verschwinden. */
function tally() {
	const byKey = new Map<string, number>();
	let total = 0;
	return {
		total: () => total,
		of: (key: string) => byKey.get(key) ?? 0,
		/** Zählt dazu; die Rückgabe nimmt es genau einmal wieder weg. */
		add(key: string, n: number): () => void {
			total += n;
			byKey.set(key, (byKey.get(key) ?? 0) + n);
			let done = false;
			return () => {
				if (done) return;
				done = true;
				total -= n;
				const left = (byKey.get(key) ?? 0) - n;
				if (left > 0) byKey.set(key, left);
				else byKey.delete(key);
			};
		},
	};
}

export function createGate(opts: GateOptions): Gate {
	const running = tally();
	const held = tally();
	const queue: Waiter[] = [];

	const room = () => running.total() < opts.maxActive && held.total() < opts.maxHeld;
	const runnable = (key: string) => room() && running.of(key) < opts.maxPerKey && held.of(key) < opts.maxHeldPerKey;

	function take(key: string): GateSlot {
		const undo = running.add(key, 1);
		return {
			ok: true,
			release: () => {
				undo();
				next();
			},
		};
	}

	/** Die ersten Wartenden starten, deren Netz noch Platz hat. */
	function next(): void {
		for (let i = 0; i < queue.length && room(); ) {
			const waiter = queue[i];
			if (!runnable(waiter.key)) {
				i++;
				continue;
			}
			queue.splice(i, 1);
			waiter.settle(take(waiter.key));
		}
	}

	function acquire(key: string, signal?: AbortSignal): Promise<GateSlot> {
		if (signal?.aborted) return Promise.resolve({ ok: false, reason: "aborted" });
		if (runnable(key)) return Promise.resolve(take(key));
		if (queue.length >= opts.maxQueue || queue.filter((w) => w.key === key).length >= opts.maxQueuePerKey) {
			return Promise.resolve({ ok: false, reason: "busy" });
		}
		return new Promise((resolve) => {
			const leave = (reason: "busy" | "aborted") => {
				const i = queue.indexOf(waiter);
				if (i >= 0) queue.splice(i, 1);
				waiter.settle({ ok: false, reason });
			};
			const onAbort = () => leave("aborted");
			const timer = setTimeout(() => leave("busy"), opts.maxWaitMs);
			const waiter: Waiter = {
				key,
				settle: (slot) => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					resolve(slot);
				},
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			queue.push(waiter);
		});
	}

	function hold(key: string, bytes: number): () => void {
		const undo = held.add(key, bytes);
		return () => {
			undo();
			next();
		};
	}

	return { acquire, hold, stats: () => ({ active: running.total(), waiting: queue.length, held: held.total() }) };
}
