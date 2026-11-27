// Der Collection-Identifier-Raum der DTS-API und die RFC-6570-URI-Templates.
// Pure Modul (kein $env/Meili) – via `npx tsx --test` testbar. Die Meili-
// abhängige Eltern-Auflösung eines Dokuments liegt in collection.ts.
//
// Hierarchie & id-Grammatik:
//   root      → "corpus"            (fehlender id-Param ≙ root)
//   series    → "ABl" | "KRP" | …   (eine der Serien-Abkürzungen, ALL_SERIES)
//   year      → "ABl/1834"          (Serie "/" Jahr)
//   document  → Meili-Doc-id         (z. B. "RRB_1837_1395"; enthält nie "/")

import { ALL_SERIES, type SeriesAbbr } from "../../types";
import { ROOT_COLLECTION_ID } from "./constants";

export type CollectionNode =
	| { kind: "root" }
	| { kind: "series"; series: SeriesAbbr }
	| { kind: "year"; series: SeriesAbbr; year: number }
	| { kind: "document"; id: string };

function isSeries(value: string): value is SeriesAbbr {
	return (ALL_SERIES as string[]).includes(value);
}

/**
 * Zerlegt einen Collection-`id`-Parameter in einen Knoten. Liefert null für
 * syntaktisch ungültige ids (→ 404), z. B. "ABl/" oder "OS/abc" oder eine
 * unbekannte Serie in der Jahr-Form. Ein leerer/fehlender id ≙ root.
 */
export function parseCollectionId(id: string | null | undefined): CollectionNode | null {
	const raw = (id ?? "").trim();
	if (raw === "" || raw === ROOT_COLLECTION_ID) return { kind: "root" };

	if (raw.includes("/")) {
		// Nur die Jahr-Form darf einen Slash tragen (Doc-ids enthalten keinen).
		const parts = raw.split("/");
		if (parts.length !== 2) return null;
		const [seriesPart, yearPart] = parts;
		if (!isSeries(seriesPart)) return null;
		if (!/^\d{1,4}$/.test(yearPart)) return null;
		return { kind: "year", series: seriesPart, year: Number(yearPart) };
	}

	if (isSeries(raw)) return { kind: "series", series: raw };
	return { kind: "document", id: raw };
}

/** Die kanonische id-Zeichenkette eines Knotens (zugleich sein JSON-LD `@id`). */
export function collectionIdOf(node: CollectionNode): string {
	switch (node.kind) {
		case "root":
			return ROOT_COLLECTION_ID;
		case "series":
			return node.series;
		case "year":
			return `${node.series}/${node.year}`;
		case "document":
			return node.id;
	}
}

// --- URI-Templates (RFC 6570) -----------------------------------------------

const enc = encodeURIComponent;

/** Entry-Point-Template (ungebunden) – alle Variablen optional. */
export function collectionTemplate(base: string): string {
	return `${base}/api/dts/collection{?id,page,nav}`;
}
export function navigationTemplate(base: string): string {
	return `${base}/api/dts/navigation{?resource,ref,start,end,down,tree,page}`;
}
export function documentTemplate(base: string): string {
	return `${base}/api/dts/document{?resource,ref,start,end,tree,mediaType}`;
}

/** `collection`-Property eines konkreten Knotens (id gebunden). */
export function collectionLinkFor(base: string, node: CollectionNode): string {
	return `${base}/api/dts/collection?id=${enc(collectionIdOf(node))}{&page,nav}`;
}

/** `navigation`/`document`-Property einer Resource (resource gebunden). */
export function navigationLinkFor(base: string, id: string): string {
	return `${base}/api/dts/navigation?resource=${enc(id)}{&ref,start,end,down,tree,page}`;
}
export function documentLinkFor(base: string, id: string): string {
	return `${base}/api/dts/document?resource=${enc(id)}{&ref,start,end,tree,mediaType}`;
}
