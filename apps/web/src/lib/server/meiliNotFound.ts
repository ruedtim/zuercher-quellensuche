// «Gibt es nicht» von «Meili antwortet nicht» unterscheiden: Bis 2026-11 wurde beides zu 404, bei einem
// Ausfall verschwanden Dokumentseiten so für Suchmaschinen. Pur → Test.

/** Meili kennt das Dokument (oder den Index) nicht. */
export function isMeiliNotFound(err: unknown): boolean {
	const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
	return status === 404;
}

/** Ergebnis oder null, wenn es das Dokument nicht gibt; andere Fehler gehen weiter. */
export async function orNull<T>(run: Promise<T>): Promise<T | null> {
	try {
		return await run;
	} catch (err) {
		if (isMeiliNotFound(err)) return null;
		throw err;
	}
}
