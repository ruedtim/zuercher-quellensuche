// /api/v1/catalog: strikter Parameter-Parser und Allowlist-Mapper für die
// Verzeichnungseinheiten des Archivkatalogs. Pure (nur relative Imports), damit
// via `npx tsx --test` testbar; die Meili-Abfrage macht lib/server/catalog.ts.
//
// Gleiche Fehler-Policy wie params.ts: unbekannte Parameter-Namen werden
// ignoriert, ungültige Werte bekannter Parameter geben einen ParamError (400).
// Öffentlich gehen nur beschreibende Felder hinaus – keine maschinell
// erkannten Entitäten und keine Personen-Zuordnungen. Filtern lässt sich nach
// den erkannten Namen (person/place/organization, wie das Register der
// Plattform: Schreibvarianten über denselben Vergleichsschlüssel).

import { CATALOG_YEAR_MAX, CATALOG_YEAR_MIN, type CatalogFilters } from "../../catalog";
import { hasEntityFilter, type CatalogEntityFilter } from "../../catalogRegister";
import { entityKey, type EntityKind } from "../../entityKey";
import type { SearchParams } from "../../types";
import type { EditionLink } from "../../editions";
import { toApiEditions } from "./respond";
import { CATALOG_RESPONSE_FACETS, LIMIT_DEFAULT, LIMIT_MAX, WINDOW_MAX, type CatalogResponseFacet } from "./constants";
import { intParam, isParamError, type ParamError } from "./params";

export interface CatalogApiQuery {
	q: string;
	sort: SearchParams["sort"];
	offset: number;
	limit: number;
	filters: CatalogFilters;
	facets: CatalogResponseFacet[];
}

const invalid = (message: string): ParamError => ({ code: "invalid_parameter", message });

const SORTS: SearchParams["sort"][] = ["relevance", "date_asc", "date_desc"];

function repeated(url: URL, name: string): string[] {
	return [...new Set(url.searchParams.getAll(name).map((s) => s.trim()).filter(Boolean))];
}

/** Höchstens so viele Namen je Parameter (wie der Entitätsfilter der Suchseite). */
const ENTITY_VALUES_MAX = 20;

const ENTITY_PARAMS: ReadonlyArray<{ name: string; kind: EntityKind; hint: string }> = [
	{ name: "person", kind: "person", hint: "needs a first and a last name, e.g. 'Anna Meier' or 'Meier, Anna'" },
	{ name: "place", kind: "place", hint: "must contain a place name" },
	{ name: "organization", kind: "org", hint: "must contain a name of at least three letters" },
];

/** person/place/organization: Anzeigeformen mit Vergleichsschlüssel, je Schlüssel einmal. */
function entityParams(url: URL): CatalogEntityFilter | ParamError {
	const out: CatalogEntityFilter = { person: [], place: [], org: [] };
	for (const p of ENTITY_PARAMS) {
		const values = repeated(url, p.name);
		if (values.length > ENTITY_VALUES_MAX) return invalid(`Parameter '${p.name}' accepts at most ${ENTITY_VALUES_MAX} values.`);
		const seen = new Set<string>();
		for (const v of values) {
			const key = entityKey(p.kind, v);
			if (!key) return invalid(`Parameter '${p.name}' ${p.hint}.`);
			if (!seen.has(key)) out[p.kind].push(v);
			seen.add(key);
		}
	}
	return out;
}

export function parseCatalogApiParams(url: URL): CatalogApiQuery | ParamError {
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
	const digitalRaw = (url.searchParams.get("digital") ?? "").trim();
	if (digitalRaw && !["true", "false", "1", "0"].includes(digitalRaw)) {
		return invalid("Parameter 'digital' must be true or false.");
	}
	const entities = entityParams(url);
	if (isParamError(entities)) return entities;
	const facets: CatalogResponseFacet[] = [];
	for (const f of (url.searchParams.get("facets") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
		if (!(CATALOG_RESPONSE_FACETS as readonly string[]).includes(f)) {
			return invalid(`Unknown facet '${f}'. Allowed values: ${CATALOG_RESPONSE_FACETS.join(", ")}.`);
		}
		if (!facets.includes(f as CatalogResponseFacet)) facets.push(f as CatalogResponseFacet);
	}
	return {
		q: (url.searchParams.get("q") ?? "").trim(),
		sort: (sortRaw || "relevance") as SearchParams["sort"],
		offset,
		limit,
		filters: {
			active: true,
			dateFrom: Number.isNaN(dateFrom) ? null : dateFrom,
			dateTo: Number.isNaN(dateTo) ? null : dateTo,
			level: repeated(url, "level"),
			bestand: repeated(url, "bestand"),
			digital: digitalRaw === "true" || digitalRaw === "1",
			...(hasEntityFilter(entities) ? { entities } : {}),
		},
		facets,
	};
}

/** Was der Mapper von einem Index-Dokument braucht (lib/server/catalog.ts CatalogUnitRaw). */
export interface CatalogUnitInput {
	id: number;
	signature: string;
	title: string;
	text?: string;
	level: string;
	dateText: string;
	dateFrom?: number | null;
	dateTo?: number | null;
	bestand: string | null;
	path?: Array<{ id: number; label: string }>;
	provenienz?: string;
	hasDigitization: boolean;
	files?: Array<{ name: string; url: string; kind: string }>;
	fileCount?: number;
	url: string;
	onPlatform?: boolean;
	docId?: string;
	docSeries?: string;
	_formatted?: { text?: string };
}

const CATALOG_DETAIL = "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=";

/**
 * Öffentliche Form einer Verzeichnungseinheit. Listen tragen einen Auszug
 * (excerpt, Meili-Crop ohne Markierungen), die Einzelansicht den Text des Index
 * (Regest bzw. «Inhalt und Form», bis 2'000 Zeichen; ungekürzt nur auf der Seite der Einheit).
 * Bildet die Einheit ein Plattform-Dokument ab (`relation` «depicts») oder verweist sie per
 * Weblink auf eines («references», z. B. eine Urkunde zum Beschluss), steht es in `document`.
 * Die Einzelansicht trägt die Verweise auf Editionen (`editions`, server/editionLinks.ts).
 */
export function toCatalogItem(
	raw: CatalogUnitInput,
	base: string,
	opts: { full: boolean; editions?: readonly EditionLink[] },
): Record<string, unknown> {
	const excerpt = raw._formatted?.text ? raw._formatted.text.replace(/<\/?mark\b[^>]*>/gi, "") : null;
	const item: Record<string, unknown> = {
		id: raw.id,
		signature: raw.signature,
		title: raw.title,
		level: raw.level || null,
		dateText: raw.dateText || null,
		dateFrom: raw.dateFrom ?? null,
		dateTo: raw.dateTo ?? null,
		bestand: raw.bestand ?? null,
		path: (raw.path ?? []).map((n) => ({ id: n.id, label: n.label, url: `${CATALOG_DETAIL}${n.id}` })),
		provenienz: raw.provenienz ?? null,
		hasDigitization: raw.hasDigitization,
		files: (raw.files ?? []).map((f) => ({ name: f.name, url: f.url, kind: f.kind === "image" ? "image" : "file" })),
		fileCount: raw.fileCount ?? raw.files?.length ?? 0,
		url: raw.url,
		document:
			raw.docId && raw.docSeries
				? {
						id: raw.docId,
						series: raw.docSeries,
						// Vor dem Neuaufbau trugen nur abbildende Einheiten eine docId.
						relation: raw.onPlatform === false ? "references" : "depicts",
						links: {
							self: `${base}/api/v1/documents/${encodeURIComponent(raw.docId)}`,
							web: `${base}/documents/${raw.docSeries}/${encodeURIComponent(raw.docId)}`,
						},
					}
				: null,
		links: { self: `${base}/api/v1/catalog/${raw.id}`, web: `${base}/archivkatalog/${raw.id}`, catalog: raw.url },
	};
	if (opts.full) {
		item.text = raw.text ?? null;
		item.editions = toApiEditions(opts.editions ?? []);
	} else item.excerpt = excerpt ?? (raw.text ? raw.text.slice(0, 240) : null);
	return item;
}
