// Merge der lexikalischen Hintergrund-Tranche in die Passagen-Suche: sie
// kombiniert die semantische/hybride Suche mit einer reinen BM25-Suche über die
// Stichwörter der Frage. So tauchen exakte Wort-Treffer (Namen wie «Katzensee»,
// «Sandmann», Nummern) ohne jede Entitäten-Interpretation auf – der Hybrid-Arm
// der Chunk-Suche gewichtet lexikalisch nur ~10 % (CHUNK_SEMANTIC_RATIO 0.9),
// das reicht für seltene Namen nicht. Bewusst ohne Imports, damit der Unit-Test direkt mit
// `npx tsx --test` läuft.

/**
 * Mischt die lexikalische Tranche in die semantische: ~1/3 der topK-Slots
 * sind für lexical-only-Dokumente reserviert (Docs, die in der semantischen
 * Liste nirgends vorkommen – Überschneidungen bleiben an ihrem semantischen
 * Rang). Semantisches Ranking steht zuerst, die
 * lexikalischen Extras folgen dahinter. Ist die semantische Liste dünn
 * (gefilterte Korpora), füllt lexikalisch über die Reserve hinaus auf; ohne
 * frische lexikalische Treffer ist das Ergebnis identisch zur semantischen
 * Tranche.
 */
export function mergeLexicalSources<T extends { hit: { id: string } }>(
	semantic: T[],
	lexical: T[],
	topK: number,
): T[] {
	const lexSlots = Math.max(1, Math.round(topK / 3));
	const semanticIds = new Set(semantic.map((s) => s.hit.id));
	const freshLex = lexical.filter((l) => !semanticIds.has(l.hit.id));
	const lexTake = Math.min(freshLex.length, Math.max(lexSlots, topK - semantic.length));
	return [...semantic.slice(0, Math.max(0, topK - lexTake)), ...freshLex.slice(0, lexTake)];
}

/**
 * Eine Seite der gemischten Passagen (Paginierung von passage_search): die
 * Treffer des Fensters `offset + topK`, die im Fenster `offset` noch nicht
 * standen. Ein naives `slice(offset)` über das grosse Fenster brächte
 * Doppelte – die lexikalische Reserve sitzt am Ende der Liste und wandert mit
 * dem Fenster nach hinten. Beide Fenster sind aber Präfixe derselben zwei
 * Listen (semantisch und lexikalisch), und beide Präfixe wachsen monoton mit
 * dem Fenster; die Differenz ist deshalb genau die Fortsetzung: keine
 * Doppelten, keine Lücke. Für offset 0 ist das Ergebnis unverändert
 * mergeLexicalSources.
 */
export function mergeLexicalPage<T extends { hit: { id: string } }>(
	semantic: T[],
	lexical: T[],
	offset: number,
	topK: number,
): T[] {
	const full = mergeLexicalSources(semantic, lexical, offset + topK);
	if (offset <= 0) return full;
	const before = new Set(mergeLexicalSources(semantic, lexical, offset).map((s) => s.hit.id));
	return full.filter((s) => !before.has(s.hit.id));
}
