// Hilfen für die strukturierte RRB-Beschlussnummer `resolutionId`.
//
// Format: `JJJJ/NNNN` – Jahr, Slash, 4-stellig genullte Beschlussnummer
// (services/indexer/src/parser.ts). Die Nummer ist im ganzen Korpus ≤ 4-stellig
// (Spitzenjahr 1971 hat 4661 Beschlüsse), also reichen 4 Ziffern.

/**
 * Aus einem getippten Nummern-Prefix `JJJJ/<1-4 Ziffern>` die passenden
 * numerischen Voll-IDs erzeugen, deren Nummer-Teil mit den getippten Ziffern
 * beginnt. Damit lässt sich die Meili-`facetDistribution` per
 * `resolutionId IN [...]` aufs richtige (alphabetisch späte) Wertefenster
 * verschieben – sonst kappt `maxValuesPerFacet` (1000) alle Treffer ausserhalb der
 * niedrigsten Nummern weg.
 *
 * Beispiele:
 *   "1958/4"    → 1000 IDs `1958/4000`..`1958/4999`
 *   "1958/40"   →  100 IDs `1958/4000`..`1958/4099`
 *   "1958/402"  →   10 IDs `1958/4020`..`1958/4029`
 *   "1958/4023" →    1 ID  `1958/4023`
 *   "1958/04"   →  100 IDs `1958/0400`..`1958/0499`  (führende Null bleibt)
 *
 * Liefert `null` (⇒ Aufrufer fällt auf den Jahres-/Exact-Match-Pfad zurück) für
 * alles, was nicht exakt `JJJJ/<1-4 Ziffern>` ist – reines Jahr ("1958"),
 * Slash ohne Ziffer ("1958/"), >4 Nummern-Ziffern ("1958/40235") oder ein
 * Buchstaben-Suffix ("1848/0001a", das nur voll getippt über den
 * Exact-Match-Fallback gefunden wird).
 */
export function resolutionIdCandidates(
	prefix: string,
): { year: number; ids: string[] } | null {
	const m = prefix.match(/^(\d{4})\/(\d{1,4})$/);
	if (!m) return null;
	const year = Number(m[1]);
	const k = m[2].length;
	const base = Number(m[2]) * 10 ** (4 - k);
	const span = 10 ** (4 - k);
	const ids: string[] = [];
	for (let n = base; n < base + span; n++) {
		ids.push(`${year}/${String(n).padStart(4, "0")}`);
	}
	return { year, ids };
}
