// Strikter Parameter-Parser für /api/v1 – baut aus der Request-URL ein
// internes SearchParams-Objekt.
//
// Bewusst NICHT parseSearchParams() aus lib/searchParams.ts: der öffentliche
// Vertrag (Param-Namen, Fehlerverhalten) darf sich nicht ändern, wenn der
// interne UI-Parser refactored wird. Kopplung nur über den SearchParams-Typ –
// Compile-Fehler statt stiller Drift. Die ~30 Zeilen Helper-Duplikation sind
// der Preis dafür.
//
// Fehler-Policy (anders als die UI, die still klemmt/verwirft):
//   - unbekannte Parameter-NAMEN werden ignoriert (Forward-Kompatibilität),
//   - ungültige WERTE bekannter Parameter geben einen ParamError (→ 400).
//
// Paginierung öffentlich als offset/limit (openparldata-Stil); intern wird
// page=1 / pageSize=offset+limit gesetzt und der Route-Handler sliced – ein
// Codepfad für lexikalisch, Thema (zweistufig) und Top-K, ohne executeSearch
// anzufassen.

import {
	ALL_SERIES,
	DEFAULT_SEARCH,
	type SearchParams,
	type SeriesAbbr,
} from "../../types";
import {
	ENTITY_PARAMS,
	ENTITY_VALUE_LENGTH_MAX,
	ENTITY_VALUES_MAX,
	LIMIT_DEFAULT,
	LIMIT_MAX,
	RESPONSE_FACETS,
	TOPK_MAX,
	TOPK_MIN,
	WINDOW_MAX,
	YEAR_MAX,
	YEAR_MIN,
	type ApiErrorCode,
	type ResponseFacet,
	BULK_DATA_URL,
} from "./constants";

export interface ParamError {
	code: Extract<ApiErrorCode, "invalid_parameter" | "pagination_window_exceeded">;
	message: string;
}

export interface PublicSearchQuery {
	params: SearchParams;
	offset: number;
	limit: number;
	facets: ResponseFacet[];
	/** Namensfilter über person/place/organization: Form oder Vergleichsschlüssel. */
	keyedEntities: boolean;
}

export function isParamError(value: unknown): value is ParamError {
	return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

function invalid(message: string): ParamError {
	return { code: "invalid_parameter", message };
}

/**
 * Ganzzahl-Parameter mit Bereichsprüfung. Fehlend/leer → Default; alles, was
 * keine Ganzzahl im Bereich ist, → ParamError.
 */
export function intParam(
	url: URL,
	name: string,
	min: number,
	max: number,
	fallback: number,
): number | ParamError {
	const raw = url.searchParams.get(name);
	if (raw == null || raw.trim() === "") return fallback;
	const n = Number(raw.trim());
	if (!Number.isInteger(n) || n < min || n > max) {
		return invalid(`Parameter '${name}' must be an integer between ${min} and ${max}.`);
	}
	return n;
}

/** Kommaseparierte Ganzzahl-Liste ("40,41"); leere Items werden verworfen. */
function intListParam(url: URL, name: string): number[] | ParamError {
	const raw = url.searchParams.get(name);
	if (raw == null || raw.trim() === "") return [];
	const out: number[] = [];
	for (const part of raw.split(",")) {
		const item = part.trim();
		if (item === "") continue;
		const n = Number(item);
		// isSafeInteger statt isInteger: «1e26» wäre ganzzahlig, ergäbe im Meili-Filter aber «1e+26».
		if (!Number.isSafeInteger(n)) {
			return invalid(`Parameter '${name}' must be a comma-separated list of integers.`);
		}
		out.push(n);
	}
	return [...new Set(out)];
}

/** Kommaseparierte String-Liste ("632.31,131.1"); trim + dedupe. */
function stringListParam(url: URL, name: string): string[] {
	const raw = url.searchParams.get(name);
	if (raw == null) return [];
	return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s !== ""))];
}

/**
 * Wiederholte Parameter (?persons=A&persons=B) – für Werte, die Kommas
 * enthalten können (Entity-Surface-Forms wie "Müller, Hans").
 */
function repeatedParam(url: URL, name: string): string[] {
	return [...new Set(url.searchParams.getAll(name).map((s) => s.trim()).filter((s) => s !== ""))];
}

const SORTS: SearchParams["sort"][] = ["relevance", "date_asc", "date_desc"];

type EntityValues = Record<(typeof ENTITY_PARAMS)[number]["dim"], string[]>;

/**
 * Namensfilter: die Mehrzahl (persons/places/organizations) trifft die exakte
 * Namensform wie seit 1.0, die Einzahl (person/place/organization, seit 1.1) die
 * Form oder denselben Vergleichsschlüssel (lib/entityFilter.ts) – dieselben
 * Parameternamen wie bei /catalog und /editions. SearchParams kennt einen Modus je
 * Anfrage (entityMatch), darum nicht gemischt (400). Leere Werte zählen nicht.
 */
function entityParams(url: URL): { values: EntityValues; keyed: boolean } | ParamError {
	const plural = ENTITY_PARAMS.find((p) => repeatedParam(url, p.dim).length > 0);
	const singular = ENTITY_PARAMS.find((p) => repeatedParam(url, p.singular).length > 0);
	if (plural && singular) {
		return invalid(
			`Parameters '${plural.dim}' and '${singular.singular}' cannot be combined. Use either ` +
				`persons/places/organizations (exact name form) or person/place/organization ` +
				`(name form or comparison key).`,
		);
	}
	const values: EntityValues = { persons: [], places: [], organizations: [] };
	for (const p of ENTITY_PARAMS) {
		if (!singular) {
			values[p.dim] = repeatedParam(url, p.dim);
			continue;
		}
		const list = repeatedParam(url, p.singular);
		if (list.length > ENTITY_VALUES_MAX) {
			return invalid(`Parameter '${p.singular}' accepts at most ${ENTITY_VALUES_MAX} values.`);
		}
		if (list.some((v) => v.length > ENTITY_VALUE_LENGTH_MAX)) {
			return invalid(
				`Values of parameter '${p.singular}' must be at most ${ENTITY_VALUE_LENGTH_MAX} characters long.`,
			);
		}
		values[p.dim] = list;
	}
	return { values, keyed: !!singular };
}

export function parsePublicSearchParams(url: URL): PublicSearchQuery | ParamError {
	const limit = intParam(url, "limit", 1, LIMIT_MAX, LIMIT_DEFAULT);
	if (isParamError(limit)) return limit;
	const offset = intParam(url, "offset", 0, WINDOW_MAX - 1, 0);
	if (isParamError(offset)) return offset;
	if (offset + limit > WINDOW_MAX) {
		return {
			code: "pagination_window_exceeded",
			message:
				`offset + limit must not exceed ${WINDOW_MAX}. This API is meant for selective queries, ` +
				`not bulk export - the full corpus is published as open data dumps, see ` +
				BULK_DATA_URL,
		};
	}

	const q = (url.searchParams.get("q") ?? "").trim();
	const theme = (url.searchParams.get("theme") ?? "").trim();

	const seriesList = stringListParam(url, "series");
	const badSeries = seriesList.filter((s) => !(ALL_SERIES as string[]).includes(s));
	if (badSeries.length > 0) {
		return invalid(`Unknown series '${badSeries[0]}'. Allowed values: ${ALL_SERIES.join(", ")}.`);
	}

	const dateFrom = intParam(url, "dateFrom", YEAR_MIN, YEAR_MAX, Number.NaN);
	if (isParamError(dateFrom)) return dateFrom;
	const dateTo = intParam(url, "dateTo", YEAR_MIN, YEAR_MAX, Number.NaN);
	if (isParamError(dateTo)) return dateTo;
	if (!Number.isNaN(dateFrom) && !Number.isNaN(dateTo) && dateFrom > dateTo) {
		return invalid("Parameter 'dateFrom' must be less than or equal to 'dateTo'.");
	}

	const sortRaw = (url.searchParams.get("sort") ?? "relevance").trim();
	if (!(SORTS as string[]).includes(sortRaw)) {
		return invalid(`Unknown sort '${sortRaw}'. Allowed values: ${SORTS.join(", ")}.`);
	}

	const topK = intParam(url, "topK", TOPK_MIN, TOPK_MAX, Number.NaN);
	if (isParamError(topK)) return topK;

	const volumeNr = intListParam(url, "volumeNr");
	if (isParamError(volumeNr)) return volumeNr;
	const startPg = intListParam(url, "startPg");
	if (isParamError(startPg)) return startPg;
	const years = intListParam(url, "years");
	if (isParamError(years)) return years;

	const entities = entityParams(url);
	if (isParamError(entities)) return entities;

	const facetsList = stringListParam(url, "facets");
	const badFacets = facetsList.filter((f) => !(RESPONSE_FACETS as readonly string[]).includes(f));
	if (badFacets.length > 0) {
		return invalid(
			`Unknown facet '${badFacets[0]}'. Allowed values: ${RESPONSE_FACETS.join(", ")}.`,
		);
	}

	const params: SearchParams = {
		...DEFAULT_SEARCH,
		q,
		theme,
		series: seriesList as SeriesAbbr[],
		dateFrom: Number.isNaN(dateFrom) ? null : dateFrom,
		dateTo: Number.isNaN(dateTo) ? null : dateTo,
		// Thema gesetzt → Hybrid-Pfade aktiv (wie der interne Parser).
		semanticRatio: theme ? 0.7 : 0,
		sort: sortRaw as SearchParams["sort"],
		// Ein Fenster [0, offset+limit) holen, der Route-Handler sliced.
		page: 1,
		pageSize: offset + limit,
		topK: Number.isNaN(topK) ? null : topK,
		volumeNr,
		startPg,
		serialNr: stringListParam(url, "serialNr"),
		resolutionId: stringListParam(url, "resolutionId"),
		years,
		...entities.values,
		// v1 filtert Namen exakt; nur die Einzahl-Parameter nehmen den Schlüssel dazu.
		...(entities.keyed ? {} : { entityMatch: "exact" as const }),
	};

	return { params, offset, limit, facets: facetsList as ResponseFacet[], keyedEntities: entities.keyed };
}
