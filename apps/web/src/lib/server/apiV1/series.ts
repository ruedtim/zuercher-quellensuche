// Serien-Übersicht für GET /api/v1/series: Counts + Jahres-Spannen aus Meili
// (1 korpusweiter + je Serie ein gefilterter Call), 5-min-Cache analog
// corpusDistCache in meili.ts. Beschreibungen = Wortlaut der /about-Karten.

import {
	ALL_SERIES,
	DEFAULT_SEARCH,
	SERIES_LABEL,
	yearBoundsFromDistribution,
	type SeriesAbbr,
} from "../../types";
import { searchDocuments } from "../meili";

const DESCRIPTIONS: Record<SeriesAbbr, string> = {
	OS: "Erlasse des Kantons Zürich seit 1803 in der Reihenfolge ihrer Publikation: bis 1998 digitalisiert, ab 1999 aus ZH-Lex.",
	ABl: "Amtliche Mitteilungen im Kanton Zürich seit 1834; das Staatsarchiv digitalisiert von 2001 rückwärts.",
	KRP: "Protokolle des Zürcher Parlaments (Kantonsrat, bis 1869 Grosser Rat) seit 1803; im Wortlaut seit 1999.",
	RRB: "Beschlüsse der Zürcher Regierung (Regierungsrat, bis 1831 Kleiner Rat) seit 1803; durchsuchbar bis 1995 und ab Oktober 2008.",
	RM: "Sitzungsprotokolle des Kleinen und Grossen Rats der Stadt und Republik Zürich 1484–1798, je Sitzung ein Dokument. Maschinelle Transkription des Staatsarchivs; Daten bis 1700 im alten Stil.",
};

// Born-digital-Teilbestände (subset-Feld der Dokumente).
const SUBSETS: Record<SeriesAbbr, Array<{ id: string; description: string }>> = {
	OS: [
		{
			id: "os-late",
			description: "Born-digital aus ZH-Lex (zh.ch), Erlass-Publikationen ab 1999.",
		},
	],
	ABl: [],
	KRP: [
		{
			id: "krp-late",
			description: "Born-digital aus dem Gever-Web-Service des Kantonsrats, Sitzungen ab Mai 1995.",
		},
	],
	RRB: [
		{
			id: "rrb-late",
			description: "Born-digital von zh.ch Open Data, Beschlüsse ab Oktober 2008.",
		},
	],
	RM: [],
};

export interface SeriesInfo {
	abbr: SeriesAbbr;
	name: string;
	description: string;
	documents: number;
	years: { from: number; to: number } | null;
	subsets: Array<{ id: string; description: string }>;
}

/** Jahresverteilung je Serie (dateYear-Facette), wie sie für die Jahres-Spannen
 *  ohnehin geholt wird – der MCP-Bericht `coverage` rechnet daraus die Lücken. */
export type SeriesYearDistributions = Record<SeriesAbbr, Record<string, number>>;

let cache: { data: SeriesInfo[]; dists: SeriesYearDistributions; expiresAt: number } | null = null;
const TTL_MS = 5 * 60_000;

async function load(): Promise<{ data: SeriesInfo[]; dists: SeriesYearDistributions }> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) return cache;

	// Korpus-weite Serien-Counts + pro Serie die dateYear-Verteilung für die
	// äussersten Jahre. Parallele Mini-Calls (pageSize 1, nur Facets).
	const [corpus, ...perSeries] = await Promise.all([
		searchDocuments({ ...DEFAULT_SEARCH, semanticRatio: 0, pageSize: 1 }),
		...ALL_SERIES.map((abbr) =>
			searchDocuments({ ...DEFAULT_SEARCH, semanticRatio: 0, pageSize: 1, series: [abbr] }),
		),
	]);
	const counts = corpus.facetDistribution?.series ?? {};

	const dists = {} as SeriesYearDistributions;
	const data = ALL_SERIES.map((abbr, i) => {
		const dist = perSeries[i].facetDistribution?.dateYear ?? {};
		dists[abbr] = dist;
		const hasDocs = Object.values(dist).some((c) => c > 0);
		const bounds = hasDocs ? yearBoundsFromDistribution(dist) : null;
		return {
			abbr,
			name: SERIES_LABEL[abbr],
			description: DESCRIPTIONS[abbr],
			documents: counts[abbr] ?? 0,
			years: bounds ? { from: bounds.min, to: bounds.max } : null,
			subsets: SUBSETS[abbr],
		};
	});

	cache = { data, dists, expiresAt: now + TTL_MS };
	return cache;
}

export async function getSeriesInfo(): Promise<SeriesInfo[]> {
	return (await load()).data;
}

/** Dieselbe (5 min gecachte) Abfrage wie getSeriesInfo, nur die rohen Jahresverteilungen. */
export async function getSeriesYearDistributions(): Promise<SeriesYearDistributions> {
	return (await load()).dists;
}
