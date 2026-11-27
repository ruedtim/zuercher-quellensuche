// Response-Bausteine für /api/v1: Envelope ({data, meta, links}), Fehler-
// Shape ({error: {code, message, status}}), Hit-Mapping und Paginierungs-
// Links. Pure (keine SvelteKit-Imports) – Response/JSON sind Node-Globals,
// damit via `npx tsx --test` testbar.
//
// Sicherheits-Invariante: Hits werden NIE gespreadet, sondern explizit
// allowlist-gemappt – interne Felder (relativePath, _vectors, _formatted)
// können so nie in die öffentliche API leaken, auch wenn der Index wächst.

import type { DocRelation, SearchHit } from "../../types";
import { relationLabel, type ApiRelation } from "../../relations";
import { EHEDATEN_ATTRIBUTION, EHEDATEN_LICENSE, EHEDATEN_LICENSE_URL, EHEDATEN_SOURCE_URL } from "../../ehedaten";
import { EDITIONS, type EditionKey, type EditionLink } from "../../editions";
import {
	ATTRIBUTION,
	CATALOG_NOTE,
	CATALOG_SOURCE,
	CATALOG_SOURCE_URL,
	EDITIONS_NOTE,
	EHEDATEN_NOTE,
	LICENSE,
	LICENSE_URL,
	WINDOW_MAX,
	type ApiErrorCode,
} from "./constants";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export interface ApiMeta {
	total?: number;
	offset?: number;
	limit?: number;
	processingTimeMs?: number;
	warnings?: string[];
	facets?: Record<string, Record<string, number>>;
	[key: string]: unknown;
}

export function jsonResponse(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...JSON_HEADERS, ...headers },
	});
}

/** Erfolgs-Envelope – Lizenz/Attribution stehen in jeder Antwort. */
export function ok(
	data: unknown,
	meta: ApiMeta = {},
	links: Record<string, string | null> | null = null,
	headers: Record<string, string> = {},
): Response {
	const body: Record<string, unknown> = {
		data,
		meta: { ...meta, license: LICENSE, licenseUrl: LICENSE_URL, attribution: ATTRIBUTION },
	};
	if (links) body.links = links;
	return jsonResponse(body, 200, headers);
}

/** Envelope des Archivkatalogs: Quelle und Zitierhinweis statt Lizenz (constants.ts). */
export function okCatalog(
	data: unknown,
	meta: ApiMeta = {},
	links: Record<string, string | null> | null = null,
	headers: Record<string, string> = {},
): Response {
	const body: Record<string, unknown> = {
		data,
		meta: { ...meta, source: CATALOG_SOURCE, sourceUrl: CATALOG_SOURCE_URL, note: CATALOG_NOTE },
	};
	if (links) body.links = links;
	return jsonResponse(body, 200, headers);
}

/**
 * Envelope der Ehedaten: der Datensatz des Staatsarchivs steht unter CC BY 4.0 (nicht
 * Public Domain Mark wie die amtlichen Serien) – Lizenz, Nennung und Quelle (Online-
 * Archivkatalog) in jeder Antwort, dazu der Hinweis zu Stand, Namen, Kalender und Art der
 * Einträge.
 */
export function okEhedaten(
	data: unknown,
	meta: ApiMeta = {},
	links: Record<string, string | null> | null = null,
	headers: Record<string, string> = {},
): Response {
	const body: Record<string, unknown> = {
		data,
		meta: {
			...meta,
			license: EHEDATEN_LICENSE,
			licenseUrl: EHEDATEN_LICENSE_URL,
			attribution: EHEDATEN_ATTRIBUTION,
			source: EHEDATEN_SOURCE_URL,
			note: EHEDATEN_NOTE,
		},
	};
	if (links) body.links = links;
	return jsonResponse(body, 200, headers);
}

/**
 * Envelope der Editionen: Lizenz und Nennung stehen an jedem Stück (jede Edition hat ihre
 * eigene, keine ist die Public Domain Mark der amtlichen Serien), im Envelope nur der Hinweis.
 */
export function okEditions(
	data: unknown,
	meta: ApiMeta = {},
	links: Record<string, string | null> | null = null,
	headers: Record<string, string> = {},
): Response {
	const body: Record<string, unknown> = { data, meta: { ...meta, note: EDITIONS_NOTE } };
	if (links) body.links = links;
	return jsonResponse(body, 200, headers);
}

export function fail(status: number, code: ApiErrorCode, message: string): Response {
	return jsonResponse({ error: { code, message, status } }, status, {
		"cache-control": "no-store",
	});
}

/**
 * fallback-Export für alle v1-Routen: nicht unterstützte Methoden als
 * JSON-405 (SvelteKits Default-405 wäre Plaintext).
 */
export function methodNotAllowed(): Response {
	return jsonResponse(
		{
			error: {
				code: "method_not_allowed",
				message: "Only GET requests are supported.",
				status: 405,
			},
		},
		405,
		{ allow: "GET, OPTIONS", "cache-control": "no-store" },
	);
}

/**
 * Wrapper für v1-Route-Handler: uncaught Exceptions werden zum JSON-500
 * (SvelteKits eigener Fallback für +server-Fehler wäre kein v1-Shape).
 */
export function apiRoute<E>(fn: (event: E) => Promise<Response>): (event: E) => Promise<Response> {
	return async (event: E) => {
		try {
			return await fn(event);
		} catch (err) {
			console.error("[api/v1] unhandled error:", err);
			return fail(500, "internal_error", "Internal server error.");
		}
	};
}

/**
 * Excerpt aus Meilis _formatted-Crop: Markierungs-Tags raus (sowohl Meilis
 * <mark class="match"> als auch serverseitige <mark class="entity-match">),
 * Crop-Ellipsen ("…") bleiben.
 */
export function excerptFrom(hit: SearchHit): string | null {
	const formatted = hit._formatted?.body;
	if (!formatted) return null;
	return formatted.replace(/<\/?mark\b[^>]*>/gi, "");
}

/**
 * Felder, die toListHit braucht (samt date, startPg, series, dateYear fürs Sortieren und Zählen der
 * Top-K-Pfade). Kein body: Der Auszug (_formatted) kommt unabhängig davon über attributesToCrop, ein
 * Fenster von 1000 Treffern trüge sonst Dutzende MB Volltext.
 */
export const LIST_HIT_ATTRIBUTES = [
	"id",
	"series",
	"title",
	"date",
	"dateYear",
	"volumeNr",
	"serialNr",
	"resolutionId",
	"startPg",
	"stazhIdent",
	"subset",
];

/** Treffer in Listen (Suche, similar): Metadaten + Excerpt, NIE der Body. */
export function toListHit(hit: SearchHit, base: string): Record<string, unknown> {
	return {
		id: hit.id,
		series: hit.series,
		title: hit.title,
		date: hit.date ?? null,
		dateYear: hit.dateYear ?? null,
		volumeNr: hit.volumeNr ?? null,
		serialNr: hit.serialNr ?? null,
		resolutionId: hit.resolutionId ?? null,
		startPg: hit.startPg ?? null,
		stazhIdent: hit.stazhIdent ?? null,
		subset: hit.subset ?? null,
		excerpt: excerptFrom(hit),
		score: hit._rankingScore ?? null,
		links: {
			self: `${base}/api/v1/documents/${encodeURIComponent(hit.id)}`,
			web: `${base}/documents/${hit.series}/${encodeURIComponent(hit.id)}`,
		},
	};
}

/**
 * Querverweise (`<listRelation>`) in öffentliche API-Form mappen: pro Relation
 * Typ + lesbares Label + Katalog-URL, und – falls das Ziel im Korpus ist
 * (`targetsById`, vorab via `archiveId IN [...]` aufgelöst) – ein internes
 * `document` mit `/api/v1`- und Web-Link. Pure: die async Meili-Auflösung
 * passiert in der I/O-Schicht (server/relations.ts), damit dieser Mapper wie
 * `toDetailDoc` per `npx tsx --test` prüfbar bleibt. Selbstverweise verworfen,
 * nach Label sortiert.
 */
export function toApiRelations(
	relations: DocRelation[],
	base: string,
	targetsById: Map<number, SearchHit>,
	selfId: string,
): ApiRelation[] {
	const out: ApiRelation[] = [];
	for (const r of relations) {
		const hit = r.targetId != null ? targetsById.get(r.targetId) : undefined;
		if (hit && hit.id === selfId) continue; // Selbstverweis überspringen
		const document = hit
			? {
					id: hit.id,
					series: hit.series,
					title: hit.title,
					date: hit.date ?? null,
					links: {
						self: `${base}/api/v1/documents/${encodeURIComponent(hit.id)}`,
						web: `${base}/documents/${hit.series}/${encodeURIComponent(hit.id)}`,
					},
				}
			: null;
		out.push({
			type: r.name,
			label: relationLabel(r.name),
			archiveId: r.targetId,
			catalogUrl: r.url,
			document,
		});
	}
	out.sort((a, b) => a.label.localeCompare(b.label, "de"));
	return out;
}

/** Querverweis auf eine Edition des Staatsarchivs (QZH, Zürcher Rechtsquellen) in
 *  API-Form: Zitierform, Link aufs Stück, Rolle der Vorlage und Lizenz mit Nennung der
 *  Edition – nicht die Public Domain Mark der amtlichen Quellen (meta.license). */
export interface ApiEditionLink {
	edition: EditionKey;
	editionName: string;
	id: string;
	label: string;
	url: string;
	/** edition: ediert aus dieser Vorlage; witness: weitere Überlieferung des Stücks. */
	relation: "edition" | "witness";
	title: string | null;
	license: string;
	licenseUrl: string;
	attribution: string;
}

export function toApiEditions(links: readonly EditionLink[]): ApiEditionLink[] {
	return links.map((l) => {
		const e = EDITIONS[l.edition];
		return {
			edition: l.edition,
			editionName: e.name,
			id: l.id,
			label: l.label,
			url: l.url,
			relation: l.witness ? "witness" : "edition",
			title: l.title,
			license: e.license,
			licenseUrl: e.licenseUrl,
			attribution: e.attribution,
		};
	});
}

/** Einzeldokument: volle Metadaten + Volltext + Link-Bündel. `relations` wird
 *  vom Aufrufer vorab aufgelöst (server/relations.ts) und einsortiert, ebenso die
 *  Editions-Verweise (server/editionLinks.ts; nur Ratsmanuale). */
export function toDetailDoc(
	doc: SearchHit,
	base: string,
	relations: ApiRelation[] = [],
	editions: readonly EditionLink[] = [],
): Record<string, unknown> {
	const id = encodeURIComponent(doc.id);
	return {
		id: doc.id,
		series: doc.series,
		title: doc.title,
		date: doc.date ?? null,
		dateYear: doc.dateYear ?? null,
		volumeNr: doc.volumeNr ?? null,
		serialNr: doc.serialNr ?? null,
		resolutionId: doc.resolutionId ?? null,
		startPg: doc.startPg ?? null,
		stazhIdent: doc.stazhIdent ?? null,
		subset: doc.subset ?? null,
		archiveLink: doc.archiveLink ?? null,
		persons: doc.persons ?? [],
		places: doc.places ?? [],
		organizations: doc.organizations ?? [],
		body: doc.body ?? null,
		relations,
		editions: toApiEditions(editions),
		links: {
			self: `${base}/api/v1/documents/${id}`,
			web: `${base}/documents/${doc.series}/${id}`,
			html: `${base}/render/${doc.series}/${id}.html`,
			xml: `${base}/xml/${doc.series}/${id}.xml`,
			iiifManifest: doc.manifestUrl ?? null,
			zip: `${base}/api/document/${doc.series}/${id}/package`,
			similar: `${base}/api/v1/documents/${id}/similar`,
		},
	};
}

/**
 * self/next/prev für die Suche. next endet am Blätter-Fenster (WINDOW_MAX)
 * und an der Treffermenge; prev springt um eine Fenstergrösse zurück.
 * Bestehende Query-Parameter bleiben erhalten.
 */
export function paginationLinks(
	base: string,
	path: string,
	searchParams: URLSearchParams,
	offset: number,
	limit: number,
	total: number,
): { self: string; next: string | null; prev: string | null } {
	const build = (o: number) => {
		const sp = new URLSearchParams(searchParams);
		if (o === 0) sp.delete("offset");
		else sp.set("offset", String(o));
		const qs = sp.toString();
		return `${base}${path}${qs ? `?${qs}` : ""}`;
	};
	const nextOffset = offset + limit;
	const hasNext = nextOffset < total && nextOffset + limit <= WINDOW_MAX;
	const prevOffset = offset > 0 ? Math.max(0, offset - limit) : null;
	return {
		self: build(offset),
		next: hasNext ? build(nextOffset) : null,
		prev: prevOffset !== null ? build(prevOffset) : null,
	};
}
