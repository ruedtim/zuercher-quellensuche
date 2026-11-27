// Reine JSON-LD-Objekt-Bauer für die DTS-Antworten (Collection/Resource,
// Navigation-Resource, CitableUnit, Dublin Core). KEIN $env-/Meili-Import –
// damit via `npx tsx --test` testbar (collection.ts/navigation.ts orchestrieren
// den Meili-Zugriff und nutzen diese Bauer). Die Objekte tragen bewusst KEIN
// @context/dtsVersion – das ergänzt nur der Top-Level via ldEnvelope().

import { documentSource } from "../../format";
import { ALL_SERIES, SERIES_LABEL, type SearchHit, type SeriesAbbr } from "../../types";
import {
	CITE_TYPE_DOCUMENT,
	ROOT_COLLECTION_DESCRIPTION,
	ROOT_COLLECTION_ID,
	ROOT_COLLECTION_TITLE,
} from "./constants";
import { collectionLinkFor, documentLinkFor, navigationLinkFor } from "./ids";

/**
 * Dublin-Core-Metadaten einer Resource aus den vorhandenen Meili-Feldern.
 * publisher = Herkunft des Dokuments (Staatsarchiv bzw. publizierende Behörde
 * der Spätbestände) – braucht `subset` in der Projektion.
 */
export function dublinCoreOf(doc: SearchHit): Record<string, unknown> {
	const dc: Record<string, unknown> = {
		title: [{ lang: "de", value: doc.title }],
		publisher: [documentSource(doc.subset)],
		type: ["Text"],
		language: ["de"],
		isPartOf: [SERIES_LABEL[doc.series]],
	};
	if (doc.date) dc.date = [doc.date];
	if (doc.stazhIdent) dc.source = [doc.stazhIdent];
	return dc;
}

export function rootObject(base: string): Record<string, unknown> {
	return {
		"@id": ROOT_COLLECTION_ID,
		"@type": "Collection",
		title: ROOT_COLLECTION_TITLE,
		description: ROOT_COLLECTION_DESCRIPTION,
		totalParents: 0,
		totalChildren: ALL_SERIES.length,
		collection: collectionLinkFor(base, { kind: "root" }),
	};
}

export function seriesObject(
	base: string,
	abbr: SeriesAbbr,
	totalChildren: number,
	description?: string,
): Record<string, unknown> {
	const obj: Record<string, unknown> = {
		"@id": abbr,
		"@type": "Collection",
		title: SERIES_LABEL[abbr],
		totalParents: 1,
		totalChildren,
		collection: collectionLinkFor(base, { kind: "series", series: abbr }),
	};
	if (description) obj.description = description;
	return obj;
}

export function yearObject(
	base: string,
	series: SeriesAbbr,
	year: number,
	docCount: number,
): Record<string, unknown> {
	return {
		"@id": `${series}/${year}`,
		"@type": "Collection",
		title: `${SERIES_LABEL[series]} ${year}`,
		totalParents: 1,
		totalChildren: docCount,
		collection: collectionLinkFor(base, { kind: "year", series, year }),
	};
}

/** Resource-Objekt (Member-Summary und Top-Level identisch). */
export function resourceObject(base: string, doc: SearchHit): Record<string, unknown> {
	return {
		"@id": doc.id,
		"@type": "Resource",
		title: doc.title,
		totalParents: 1,
		// Eine Resource ist eine lesbare Collection ohne Unter-Collections – das
		// DTS-Collection-Schema verlangt totalChildren auch hier (0 = keine Kinder).
		totalChildren: 0,
		collection: collectionLinkFor(base, { kind: "document", id: doc.id }),
		navigation: navigationLinkFor(base, doc.id),
		document: documentLinkFor(base, doc.id),
		dublinCore: dublinCoreOf(doc),
	};
}

/** Resource-Objekt mit Zitierstruktur (für den `resource`-Slot der Navigation). */
export function navResource(base: string, doc: SearchHit): Record<string, unknown> {
	return {
		"@id": doc.id,
		"@type": "Resource",
		collection: collectionLinkFor(base, { kind: "document", id: doc.id }),
		navigation: navigationLinkFor(base, doc.id),
		document: documentLinkFor(base, doc.id),
		citationTrees: [
			{
				"@type": "CitationTree",
				maxCiteDepth: 1,
				citeStructure: [{ citeType: CITE_TYPE_DOCUMENT }],
			},
		],
		dublinCore: dublinCoreOf(doc),
		totalParents: 1,
	};
}

/** Die einzige zitierbare Einheit eines Dokuments (flache Struktur). */
export function citableUnit(doc: SearchHit): Record<string, unknown> {
	return {
		identifier: "1",
		"@type": "CitableUnit",
		level: 1,
		parent: null,
		citeType: CITE_TYPE_DOCUMENT,
		dublinCore: { title: [{ lang: "de", value: doc.title }] },
	};
}
