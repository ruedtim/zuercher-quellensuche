// Meili-Datenzugriff für die DTS-Collection-Hierarchie: pro Serie die
// dateYear-Verteilung (Jahres-Kinder + Dokument-Counts je Jahr). 5-min-Cache
// analog getSeriesInfo (apiV1/series.ts). Ein paralleler Mini-Call je Serie
// (pageSize 1, nur Facets) – je Serie reicht maxValuesPerFacet (1000) für die
// ~224 Jahrgänge 1803–heute bzw. die gut 300 der Ratsmanuale (1484–1798).

import { ALL_SERIES, DEFAULT_SEARCH, type SeriesAbbr } from "../../types";
import { searchDocuments } from "../meili";

export type YearDist = Record<string, number>;

let cache: { data: Record<SeriesAbbr, YearDist>; expiresAt: number } | null = null;
const TTL_MS = 5 * 60_000;

export async function getSeriesYearDistributions(): Promise<Record<SeriesAbbr, YearDist>> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) return cache.data;

	const responses = await Promise.all(
		ALL_SERIES.map((abbr) =>
			searchDocuments({ ...DEFAULT_SEARCH, semanticRatio: 0, pageSize: 1, series: [abbr] }),
		),
	);
	const data = {} as Record<SeriesAbbr, YearDist>;
	ALL_SERIES.forEach((abbr, i) => {
		data[abbr] = responses[i].facetDistribution?.dateYear ?? {};
	});

	cache = { data, expiresAt: now + TTL_MS };
	return data;
}

/** Aufsteigend sortierte Jahre mit mindestens einem Dokument. */
export function yearsOf(dist: YearDist): number[] {
	return Object.entries(dist)
		.filter(([, count]) => count > 0)
		.map(([year]) => Number(year))
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => a - b);
}

/** Dokument-Anzahl eines Jahrgangs (0, wenn es den Jahrgang nicht gibt). */
export function docCountForYear(dist: YearDist, year: number): number {
	return dist[String(year)] ?? 0;
}
