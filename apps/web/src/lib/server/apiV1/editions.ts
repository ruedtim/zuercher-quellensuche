// /api/v1/editions: strikter Parameter-Parser und Allowlist-Mapper für die Stücke der
// Editionen des Staatsarchivs (Index `editions`: Quellen zur Zürcher Geschichte, Zürcher
// Rechtsquellen).
// Pure (nur relative Imports), damit via `npx tsx --test` testbar; die Abfrage macht
// lib/server/editionTexts.ts (queryEditions), derselbe Mapper formt die Treffer des
// MCP-Werkzeugs `edition_search`.
//
// Gleiche Fehler-Policy wie params.ts: unbekannte Parameter-Namen werden ignoriert, ungültige
// Werte bekannter Parameter geben einen ParamError (400). Rein lexikalisch wie die Kataloge
// (Suche nach Bedeutung bietet das MCP-Werkzeug). Lizenz und Nennung stehen an jedem Stück
// (license, attribution; QZH und Rechtsquellen: CC BY 4.0, QZH-Abbildungen gemeinfrei), nicht im
// Envelope. Rechtsquellen: ein Stück je Nummer eines Bandes (`label` «SSRQ ZH NF II/3 Nr. 47»),
// die weiteren Überlieferungen ohne eigenen Text in `witnesses`.

import { CATALOG_YEAR_MAX, CATALOG_YEAR_MIN } from "../../catalog";
import { EDITIONS, type EditionKey } from "../../editions";
import {
	editionDateLabel,
	editionLabel,
	editionUnitPath,
	INDEXED_EDITIONS,
	NO_EDITIONS_FILTERS,
	type EditionHit,
	type EditionsFacetCounts,
	type EditionsFilterValues,
	type EditionsShared,
	type EditionUnit,
} from "../../editionTexts";
import type { SearchParams } from "../../types";
import { EDITIONS_RESPONSE_FACETS, LIMIT_DEFAULT, LIMIT_MAX, WINDOW_MAX, type EditionsResponseFacet } from "./constants";
import { intParam, isParamError, type ParamError } from "./params";

export interface EditionsApiQuery {
	q: string;
	sort: SearchParams["sort"];
	offset: number;
	limit: number;
	filters: EditionsFilterValues;
	shared: EditionsShared;
	facets: EditionsResponseFacet[];
}

const invalid = (message: string): ParamError => ({ code: "invalid_parameter", message });

const SORTS: SearchParams["sort"][] = ["relevance", "date_asc", "date_desc"];

/** Höchstens so viele Werte je Parameter (wie der Entitätsfilter des Katalogs). */
const VALUES_MAX = 20;

/** Feld des Index je Zählung der API. */
export const EDITIONS_FACET_FIELD: Readonly<Record<EditionsResponseFacet, keyof EditionsFacetCounts>> = {
	edition: "edition",
	part: "part",
	keyword: "keywords",
	facsimile: "hasFacsimile",
};

function repeated(url: URL, name: string): string[] | ParamError {
	const values = [...new Set(url.searchParams.getAll(name).map((s) => s.replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean))];
	return values.length > VALUES_MAX ? invalid(`Parameter '${name}' accepts at most ${VALUES_MAX} values.`) : values;
}

export function parseEditionsApiParams(url: URL): EditionsApiQuery | ParamError {
	const limit = intParam(url, "limit", 1, LIMIT_MAX, LIMIT_DEFAULT);
	if (isParamError(limit)) return limit;
	const offset = intParam(url, "offset", 0, WINDOW_MAX - 1, 0);
	if (isParamError(offset)) return offset;
	if (offset + limit > WINDOW_MAX) {
		return {
			code: "pagination_window_exceeded",
			message: `offset + limit must not exceed ${WINDOW_MAX}. This API is meant for selective queries.`,
		};
	}
	const dateFrom = intParam(url, "dateFrom", CATALOG_YEAR_MIN, CATALOG_YEAR_MAX, Number.NaN);
	if (isParamError(dateFrom)) return dateFrom;
	const dateTo = intParam(url, "dateTo", CATALOG_YEAR_MIN, CATALOG_YEAR_MAX, Number.NaN);
	if (isParamError(dateTo)) return dateTo;
	if (!Number.isNaN(dateFrom) && !Number.isNaN(dateTo) && dateFrom > dateTo) {
		return invalid("Parameter 'dateFrom' must not be greater than 'dateTo'.");
	}
	const sortRaw = (url.searchParams.get("sort") ?? "").trim();
	if (sortRaw && !SORTS.includes(sortRaw as SearchParams["sort"])) {
		return invalid(`Parameter 'sort' must be one of: ${SORTS.join(", ")}.`);
	}
	const facsRaw = (url.searchParams.get("facsimile") ?? "").trim();
	if (facsRaw && !["true", "false", "1", "0"].includes(facsRaw)) return invalid("Parameter 'facsimile' must be true or false.");

	const edition = repeated(url, "edition");
	if (isParamError(edition)) return edition;
	for (const e of edition) {
		if (!(INDEXED_EDITIONS as readonly string[]).includes(e)) return invalid(`Parameter 'edition' must be one of: ${INDEXED_EDITIONS.join(", ")}.`);
	}
	const lists: Record<"part" | "keyword" | "person" | "place" | "organization", string[]> = { part: [], keyword: [], person: [], place: [], organization: [] };
	for (const name of Object.keys(lists) as Array<keyof typeof lists>) {
		const values = repeated(url, name);
		if (isParamError(values)) return values;
		lists[name] = values;
	}

	const facets: EditionsResponseFacet[] = [];
	for (const f of (url.searchParams.get("facets") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
		if (!(EDITIONS_RESPONSE_FACETS as readonly string[]).includes(f)) {
			return invalid(`Unknown facet '${f}'. Allowed values: ${EDITIONS_RESPONSE_FACETS.join(", ")}.`);
		}
		if (!facets.includes(f as EditionsResponseFacet)) facets.push(f as EditionsResponseFacet);
	}

	return {
		q: (url.searchParams.get("q") ?? "").trim(),
		sort: (sortRaw || "relevance") as SearchParams["sort"],
		offset,
		limit,
		filters: {
			...NO_EDITIONS_FILTERS,
			edition: edition as EditionKey[],
			part: lists.part,
			keyword: lists.keyword,
			facs: facsRaw === "true" || facsRaw === "1",
		},
		shared: {
			dateFrom: Number.isNaN(dateFrom) ? null : dateFrom,
			dateTo: Number.isNaN(dateTo) ? null : dateTo,
			persons: lists.person,
			places: lists.place,
			organizations: lists.organization,
		},
		facets,
	};
}

/** Zählungen (queryEditions `counts`) unter den Namen der API für meta.facets bzw. MCP `counts`. */
export function editionsFacetsMeta(counts: Partial<EditionsFacetCounts>, facets: readonly EditionsResponseFacet[]): Record<string, Record<string, number>> {
	return Object.fromEntries(facets.map((f) => [f, counts[EDITIONS_FACET_FIELD[f]] ?? {}]));
}

/** Text eines beim Aufbau maskierten HTML-Felds (Regest, Kommentar, Anmerkung). */
export function plainEditionHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

/** Lizenz und Nennung der Edition, dazu die Rechte an den Abbildungen (wenn andere). */
function rights(edition: EditionKey): Record<string, string> {
	const info = EDITIONS[edition];
	return {
		license: info.license,
		licenseUrl: info.licenseUrl,
		attribution: info.attribution,
		...(info.images ? { imagesLicense: info.images.label, imagesLicenseUrl: info.images.url } : {}),
	};
}

function links(base: string, edition: EditionKey, localId: string, permalink: string, manifest: boolean): Record<string, string | null> {
	const web = `${base}${editionUnitPath(edition, localId)}`;
	return {
		self: `${base}/api/v1/editions/${edition}/${encodeURIComponent(localId)}`,
		web,
		edition: permalink || null,
		iiifManifest: manifest ? `${web}/manifest.json` : null,
	};
}

const date = (isoFrom: string | null, isoTo: string | null, yearFrom: number | null, yearTo: number | null) => ({
	text: editionDateLabel(isoFrom, isoTo) || null,
	from: isoFrom,
	to: isoTo,
	yearFrom,
	yearTo,
});

/**
 * Stück in Listen (Suche, MCP): Kennung, Titel, Teil, Datum, Vorlage, Schlagwörter, Auszug
 * (Meili-Crop ohne Markierungen), Lizenz und Nennung. Explizite Allowlist, nie gespreadet.
 */
export function toEditionListItem(h: EditionHit, base: string): Record<string, unknown> {
	const excerpt = plainEditionHtml(h.textHtml);
	return {
		edition: h.edition,
		editionName: EDITIONS[h.edition].name,
		id: h.localId,
		label: editionLabel(h),
		title: h.title,
		part: h.part || null,
		date: date(h.isoFrom, h.isoTo, h.dateFrom, h.dateTo),
		signature: h.signature || null,
		keywords: h.keywords,
		hasFacsimile: h.hasFacsimile,
		excerpt: excerpt || null,
		url: h.permalink || null,
		...rights(h.edition),
		links: links(base, h.edition, h.localId, h.permalink, h.hasFacsimile),
	};
}

/**
 * Ein Stück mit allen Angaben: Bearbeitung, Vorlage (Signatur, Katalog-IDs), Regest, Lesefassung
 * (`text`, wie die Suche sie liest), Text der Edition (`html`, Klassen `ed-*` wie auf der
 * Detailseite), Anmerkungen, Kommentar, Personen (Normnamen, GND), Orte (Koordinaten),
 * Seiten mit Bild. Die Katalog-IDs führen auf /api/v1/catalog/{id}.
 */
export function toEditionItem(u: EditionUnit, base: string): Record<string, unknown> {
	return {
		edition: u.edition,
		editionName: EDITIONS[u.edition].name,
		id: u.localId,
		label: editionLabel(u),
		number: u.nr,
		title: u.title,
		part: u.part || null,
		date: date(u.isoFrom, u.isoTo, u.dateFrom, u.dateTo),
		calendar: u.calendar,
		origPlace: u.origPlace,
		signature: u.signature || null,
		catalogIds: u.catalogIds,
		catalog: u.catalogIds.map((id) => ({ id, links: { self: `${base}/api/v1/catalog/${id}`, web: `${base}/archivkatalog/${id}` } })),
		sourceUrl: u.sourceUrl,
		languages: u.textLang,
		filiation: u.filiation,
		physical: u.physical,
		witnesses: u.witnesses.map((w) => ({
			textId: w.textId ?? null,
			signature: w.signature || null,
			date: w.isoFrom ? { text: editionDateLabel(w.isoFrom, w.isoTo) || null, from: w.isoFrom, to: w.isoTo } : null,
			catalogIds: w.catalogIds,
			sourceUrl: w.sourceUrl,
			filiation: w.filiation,
			physical: w.physical,
			languages: w.textLang,
		})),
		keywords: u.keywords,
		keywordGlosses: u.keywordGlosses,
		editors: u.editors,
		transcription: u.transcription,
		tagging: u.tagging,
		publisher: u.publisher,
		published: u.published,
		bibliography: u.bibl.map((b) => ({ head: b.head || null, text: b.text })),
		regest: u.regestHtml ? plainEditionHtml(u.regestHtml) : null,
		text: u.text,
		html: u.html,
		notes: u.notes.map((n) => ({ label: n.label, type: n.type, inCommentary: n.inBack, text: plainEditionHtml(n.html) })),
		comment: u.backHtml ? plainEditionHtml(u.backHtml) : null,
		persons: u.persons.map((p) => ({ name: p.name, gnd: p.gnd, forms: p.forms, mentions: p.count })),
		places: u.places.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, forms: p.forms, mentions: p.count })),
		organizations: u.orgs,
		entitySource: u.entitySource,
		pages: u.pages.map((p) => ({ label: p.n, image: p.image })),
		hasFacsimile: u.facs.length > 0,
		images: u.facs.map((img) => ({ label: img.n || null, service: img.service, width: img.width, height: img.height, credit: img.credit ?? null })),
		url: u.permalink,
		...rights(u.edition),
		links: links(base, u.edition, u.localId, u.permalink, u.facs.length > 0),
	};
}
