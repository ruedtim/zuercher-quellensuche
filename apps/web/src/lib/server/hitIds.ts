// Kennungen aller Treffer einer Suche, ohne die Dokumente zu lesen (pur, unit-getestet in
// hitIds.test.ts). Genutzt für Suchbegriff bzw. ODER-Begriffe mit Thema (meili.ts, catalog.ts): Der
// Vektorsuche lässt sich ein Wort nur als Kennungen mitgeben.
//
// Eine gewöhnliche Suche liest für jede Kennung das ganze Dokument: kalt (frische Wörter) 0,25 bis
// 1,6 s und 70 bis 600 MB für 3'000 bis 18'000 Treffer, im Katalog bis 3,4 s; warm rund 12 µs je
// Treffer. Die Facette `id` steht in einer kleinen Tabelle: 9'372 Treffer in 30 ms, 24'982 in 78 ms,
// fast ohne Plattenzugriff, ODER 16'148 in 22 ms (Prod v1.57, 2026-11-24). Sie nennt aber höchstens
// `maxValuesPerFacet` Werte, darum Scheiben nach Jahren, die je so viele Treffer haben; die Verteilung
// liefert die Zählung ohnehin. Ohne Reihenfolge – die braucht die exakte Reihung nicht.

/** Scheibe eines Jahresbereichs; null/null = ohne Jahr. */
export interface YearSlice {
	from: number | null;
	to: number | null;
	/** Treffer der Scheibe, höchstens (die Verteilung darf mehr zählen als die Suche trifft). */
	count: number;
}

/**
 * Jahre zu Scheiben mit je höchstens `cap` Treffern zusammengefasst; `undated` = Treffer ohne Jahr.
 * Ein Jahr mit mehr Treffern steht allein (dort liefert die Facette nicht alle).
 */
export function yearSlices(years: Readonly<Record<string, number>>, undated: number, cap: number): YearSlice[] {
	const sorted = Object.entries(years)
		.map(([year, count]) => ({ year: Number(year), count }))
		.filter((y) => Number.isInteger(y.year) && y.count > 0)
		.sort((a, b) => a.year - b.year);
	const out: YearSlice[] = [];
	for (const { year, count } of sorted) {
		const last = out.at(-1);
		if (last && last.to !== null && last.count + count <= cap) {
			last.to = year;
			last.count += count;
		} else {
			out.push({ from: year, to: year, count });
		}
	}
	if (undated > 0) out.push({ from: null, to: null, count: undated });
	return out;
}

/** Filter einer Scheibe. */
export function sliceClause(slice: YearSlice, field: string): string {
	return slice.from === null ? `(${field} IS NULL OR ${field} NOT EXISTS)` : `${field} >= ${slice.from} AND ${field} <= ${slice.to}`;
}

export interface HitIdsDeps<Id> {
	/** Kennungen dieser Scheiben über die Facette, in einer Anfrage oder mehreren. */
	byFacet: (slices: YearSlice[]) => Promise<Id[]>;
	/** Kennungen einer Scheibe über die gewöhnliche Suche (mehr Treffer, als die Facette nennt). */
	bySearch: (slice: YearSlice) => Promise<Id[]>;
}

/**
 * Alle Kennungen, in beliebiger Folge; null, wenn weniger zusammenkommen als `expected` (die
 * Verteilung passt nicht, die Facette ist enger eingestellt): dann gilt der gewöhnliche Weg.
 */
export async function collectHitIds<Id>(
	slices: readonly YearSlice[],
	cap: number,
	expected: number,
	deps: HitIdsDeps<Id>,
): Promise<Id[] | null> {
	const small = slices.filter((s) => s.count <= cap);
	const big = slices.filter((s) => s.count > cap);
	const parts = await Promise.all([small.length > 0 ? deps.byFacet(small) : Promise.resolve([]), ...big.map((s) => deps.bySearch(s))]);
	const ids = [...new Set(parts.flat())];
	return ids.length >= expected ? ids : null;
}
