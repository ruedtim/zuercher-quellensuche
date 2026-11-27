// Nebenläufigkeit (pur, unit-getestet in concurrent.test.ts): Volltexte einer Trefferliste laden.

/**
 * Führt `fn` für alle Elemente aus, höchstens `limit` gleichzeitig; die
 * Ergebnisse stehen in Eingabe-Reihenfolge.
 */
export async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
	return results;
}
