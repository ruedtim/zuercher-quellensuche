// Orchestriert die DTS-Collection-Antworten für die Hierarchie
// Korpus → Serie → Jahr → Dokument (Resource): Meili-Zugriff + Pagination,
// die reine JSON-LD-Form kommt aus objects.ts.

import { ALL_SERIES, DEFAULT_SEARCH, type SearchHit } from "../../types";
import { getDocument, searchDocuments } from "../meili";
import { getSeriesInfo } from "../apiV1/series";
import { COLLECTION_MEMBER_FIELDS, COLLECTION_PAGE_SIZE, NAV_PARENTS } from "./constants";
import { docCountForYear, getSeriesYearDistributions, yearsOf } from "./data";
import { collectionIdOf, parseCollectionId } from "./ids";
import { resourceObject, rootObject, seriesObject, yearObject } from "./objects";
import type { CollectionQuery } from "./params";
import {
	errResult,
	ldEnvelope,
	okResult,
	paginationView,
	type BuildResult,
} from "./serialize";

const enc = encodeURIComponent;

function collectionPageUrl(base: string, id: string, page: number): string {
	return `${base}/api/dts/collection?id=${enc(id)}&page=${page}`;
}

function seriesInfoDescription(
	infos: Awaited<ReturnType<typeof getSeriesInfo>>,
	abbr: (typeof ALL_SERIES)[number],
): string | undefined {
	return infos.find((i) => i.abbr === abbr)?.description;
}

async function documentParents(base: string, doc: SearchHit): Promise<Record<string, unknown>[]> {
	const dists = await getSeriesYearDistributions();
	const dist = dists[doc.series];
	if (doc.dateYear != null) {
		return [yearObject(base, doc.series, doc.dateYear, docCountForYear(dist, doc.dateYear))];
	}
	// Dokument ohne dateYear: hängt direkt unter der Serie (kein Jahrgang).
	return [seriesObject(base, doc.series, yearsOf(dist).length)];
}

export async function buildCollectionResponse(
	base: string,
	selfUrl: string,
	query: CollectionQuery,
): Promise<BuildResult> {
	const node = parseCollectionId(query.id);
	if (!node) return errResult(404, "not_found", `Unknown collection id '${query.id ?? ""}'.`);
	const parents = query.nav === NAV_PARENTS;

	switch (node.kind) {
		case "root": {
			const self = rootObject(base);
			if (parents) return okResult({ ...ldEnvelope(), ...self, member: [] });
			const [infos, dists] = await Promise.all([getSeriesInfo(), getSeriesYearDistributions()]);
			const member = ALL_SERIES.map((abbr) =>
				seriesObject(base, abbr, yearsOf(dists[abbr]).length, seriesInfoDescription(infos, abbr)),
			);
			return okResult({ ...ldEnvelope(), ...self, member });
		}

		case "series": {
			const [infos, dists] = await Promise.all([getSeriesInfo(), getSeriesYearDistributions()]);
			const dist = dists[node.series];
			const years = yearsOf(dist);
			const self = seriesObject(
				base,
				node.series,
				years.length,
				seriesInfoDescription(infos, node.series),
			);
			if (parents) return okResult({ ...ldEnvelope(), ...self, member: [rootObject(base)] });
			const member = years.map((y) => yearObject(base, node.series, y, docCountForYear(dist, y)));
			return okResult({ ...ldEnvelope(), ...self, member });
		}

		case "year": {
			const dists = await getSeriesYearDistributions();
			const dist = dists[node.series];
			const total = docCountForYear(dist, node.year);
			if (total === 0) {
				return errResult(
					404,
					"not_found",
					`No documents for collection '${node.series}/${node.year}'.`,
				);
			}
			const self = yearObject(base, node.series, node.year, total);
			if (parents) {
				return okResult({
					...ldEnvelope(),
					...self,
					member: [seriesObject(base, node.series, yearsOf(dist).length)],
				});
			}
			const totalPages = Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE));
			const page = Math.min(query.page, totalPages);
			const res = await searchDocuments(
				{
					...DEFAULT_SEARCH,
					semanticRatio: 0,
					series: [node.series],
					years: [node.year],
					page,
					pageSize: COLLECTION_PAGE_SIZE,
				},
				{ attributesToRetrieve: [...COLLECTION_MEMBER_FIELDS] },
			);
			const body: Record<string, unknown> = {
				...ldEnvelope(),
				...self,
				member: res.hits.map((h) => resourceObject(base, h)),
			};
			const view = paginationView(
				selfUrl,
				(p) => collectionPageUrl(base, collectionIdOf(node), p),
				page,
				totalPages,
			);
			if (view) body.view = view;
			return okResult(body);
		}

		case "document": {
			const doc = await getDocument(node.id);
			if (!doc) return errResult(404, "not_found", `Resource '${node.id}' not found.`);
			const self = resourceObject(base, doc);
			if (parents) {
				return okResult({ ...ldEnvelope(), ...self, member: await documentParents(base, doc) });
			}
			// Eine Resource hat keine Kinder – nur das Objekt selbst.
			return okResult({ ...ldEnvelope(), ...self });
		}
	}
}
