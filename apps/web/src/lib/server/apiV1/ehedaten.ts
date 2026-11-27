// /api/v1/ehedaten: strikter Parameter-Parser und Allowlist-Mapper für die Eheeinträge der
// Ehedatenbank des Staatsarchivs (Index `ehedaten`). Pure (nur relative Imports), damit via
// `npx tsx --test` testbar; die Meili-Abfrage macht lib/server/ehedaten.ts (queryEhedaten),
// derselbe Mapper formt die Treffer des MCP-Werkzeugs `ehedaten_search`.
//
// Gleiche Fehler-Policy wie params.ts: unbekannte Parameter-Namen werden ignoriert, ungültige
// Werte bekannter Parameter geben einen ParamError (400). Die Parameter heissen wie die Felder
// der Ehedatenbank (deutsch, wie `bestand` im Katalog), die Felder der Antwort englisch wie die
// übrigen Objekte der API; die Werte bleiben deutsch (Kirchgemeinde, `type` trauung/verkuendung
// wie der Filter `art`).

import { catalogPermalink } from "../../catalog";
import {
	ART_LABEL,
	EHEDATEN_QUELLEN,
	EHEDATEN_RAEUME,
	EHEDATEN_YEAR_MAX,
	EHEDATEN_YEAR_MIN,
	isJulian,
	nameTokens,
	NO_EHEDATEN_FILTERS,
	type EhedatenArt,
	type EhedatenEntry,
	type EhedatenFilterValues,
	type EhedatenPerson,
	type EhedatenRaum,
	type EhedatenShared,
} from "../../ehedaten";
import { placeKey } from "../../entityKey";
import type { SearchParams } from "../../types";
import { EHEDATEN_RESPONSE_FACETS, LIMIT_DEFAULT, LIMIT_MAX, WINDOW_MAX, type EhedatenResponseFacet } from "./constants";
import { intParam, isParamError, type ParamError } from "./params";

export interface EhedatenApiQuery {
	q: string;
	sort: SearchParams["sort"];
	offset: number;
	limit: number;
	filters: EhedatenFilterValues;
	shared: EhedatenShared;
	facets: EhedatenResponseFacet[];
}

const invalid = (message: string): ParamError => ({ code: "invalid_parameter", message });

const SORTS: SearchParams["sort"][] = ["relevance", "date_asc", "date_desc"];

/** Höchstens so viele Werte je Parameter (wie der Entitätsfilter des Katalogs). */
const VALUES_MAX = 20;

function repeated(url: URL, name: string): string[] | ParamError {
	const values = [...new Set(url.searchParams.getAll(name).map((s) => s.replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean))];
	return values.length > VALUES_MAX ? invalid(`Parameter '${name}' accepts at most ${VALUES_MAX} values.`) : values;
}

/** Namen: mindestens ein Namenswort (nameTokens, gefaltet wie im Index). */
function names(url: URL, name: string): string[] | ParamError {
	const values = repeated(url, name);
	if (isParamError(values)) return values;
	for (const v of values) if (nameTokens(v).length === 0) return invalid(`Parameter '${name}' must contain a name, e.g. 'Heusser' or 'Hans Jakob Heusser'.`);
	return values;
}

/** Werte aus einer festen Liste (raum, quelle). */
function oneOf<T extends string>(url: URL, name: string, allowed: readonly T[]): T[] | ParamError {
	const values = repeated(url, name);
	if (isParamError(values)) return values;
	for (const v of values) if (!(allowed as readonly string[]).includes(v)) return invalid(`Parameter '${name}' must be one of: ${allowed.join(", ")}.`);
	return values as T[];
}

export function parseEhedatenApiParams(url: URL): EhedatenApiQuery | ParamError {
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
	const dateFrom = intParam(url, "dateFrom", EHEDATEN_YEAR_MIN, EHEDATEN_YEAR_MAX, Number.NaN);
	if (isParamError(dateFrom)) return dateFrom;
	const dateTo = intParam(url, "dateTo", EHEDATEN_YEAR_MIN, EHEDATEN_YEAR_MAX, Number.NaN);
	if (isParamError(dateTo)) return dateTo;
	if (!Number.isNaN(dateFrom) && !Number.isNaN(dateTo) && dateFrom > dateTo) {
		return invalid("Parameter 'dateFrom' must not be greater than 'dateTo'.");
	}
	const sortRaw = (url.searchParams.get("sort") ?? "").trim();
	if (sortRaw && !SORTS.includes(sortRaw as SearchParams["sort"])) {
		return invalid(`Parameter 'sort' must be one of: ${SORTS.join(", ")}.`);
	}
	const artRaw = (url.searchParams.get("art") ?? "").trim();
	if (artRaw && artRaw !== "trauung" && artRaw !== "verkuendung") return invalid("Parameter 'art' must be one of: trauung, verkuendung.");

	const name = names(url, "name");
	if (isParamError(name)) return name;
	const mann = names(url, "braeutigam");
	if (isParamError(mann)) return mann;
	const frau = names(url, "braut");
	if (isParamError(frau)) return frau;
	const herkunft = repeated(url, "herkunft");
	if (isParamError(herkunft)) return herkunft;
	for (const v of herkunft) if (!placeKey(v)) return invalid("Parameter 'herkunft' must contain a place name, e.g. 'Uster', 'Thurgau' or 'Deutschland'.");
	const kirche = repeated(url, "kirchgemeinde");
	if (isParamError(kirche)) return kirche;
	const band = repeated(url, "band");
	if (isParamError(band)) return band;
	const raum = oneOf<EhedatenRaum>(url, "raum", EHEDATEN_RAEUME);
	if (isParamError(raum)) return raum;
	const quelle = oneOf(url, "quelle", EHEDATEN_QUELLEN);
	if (isParamError(quelle)) return quelle;

	const facets: EhedatenResponseFacet[] = [];
	for (const f of (url.searchParams.get("facets") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
		if (!(EHEDATEN_RESPONSE_FACETS as readonly string[]).includes(f)) {
			return invalid(`Unknown facet '${f}'. Allowed values: ${EHEDATEN_RESPONSE_FACETS.join(", ")}.`);
		}
		if (!facets.includes(f as EhedatenResponseFacet)) facets.push(f as EhedatenResponseFacet);
	}

	return {
		q: (url.searchParams.get("q") ?? "").trim(),
		sort: (sortRaw || "relevance") as SearchParams["sort"],
		offset,
		limit,
		filters: { ...NO_EHEDATEN_FILTERS, mann, frau, kirche, raum, quelle, art: (artRaw || null) as EhedatenArt | null, band },
		shared: {
			dateFrom: Number.isNaN(dateFrom) ? null : dateFrom,
			dateTo: Number.isNaN(dateTo) ? null : dateTo,
			persons: name,
			places: herkunft,
		},
		facets,
	};
}

/** Zählungen (queryEhedaten `counts`) als Objekte Wert → Zahl für meta.facets bzw. MCP `counts`. */
export function ehedatenFacetsMeta(
	counts: Partial<Record<string, Array<{ value: string; count: number }>>>,
): Record<string, Record<string, number>> {
	return Object.fromEntries(Object.entries(counts).map(([by, list]) => [by, Object.fromEntries((list ?? []).map((c) => [c.value, c.count]))]));
}

const orNull = (s: string | null | undefined) => (s ? s : null);

function person(p: EhedatenPerson): Record<string, unknown> {
	return {
		firstName: orNull(p.vorname),
		lastName: orNull(p.nachname),
		name: p.name,
		origin: orNull(p.herkunft),
		originNormalized: orNull(p.ort),
		note: orNull(p.zusatz),
		hls: orNull(p.hls),
		gnd: orNull(p.gnd),
	};
}

function dateOf(e: EhedatenEntry): Record<string, unknown> {
	return { text: e.datum, from: e.isoVon, to: e.isoBis, yearFrom: e.dateFrom, yearTo: e.dateTo, calendar: isJulian(e) ? "julian" : "gregorian" };
}

const linksOf = (id: number, base: string) => ({ self: `${base}/api/v1/ehedaten/${id}`, web: `${base}/archivkatalog/${id}`, catalog: catalogPermalink(id) });

/**
 * Übrige Einträge derselben Ehe laut geprüfter Liste der Mehrfacheinträge (stazh/sw-ehedaten):
 * `certainty` wie der Sicherheitswert der Liste (certain | probable), je Eintrag Art,
 * Kirchgemeinde, Datum und Signatur (alles Weitere über `links.self`).
 */
function sameMarriageItem(m: { sicher: boolean; entries: EhedatenEntry[] }, base: string): Record<string, unknown> {
	return {
		certainty: m.sicher ? "certain" : "probable",
		entries: m.entries.map((o) => ({
			id: o.id,
			signature: o.signatur,
			parish: o.kirchgemeinde,
			type: o.art,
			typeLabel: ART_LABEL[o.art],
			date: dateOf(o),
			links: linksOf(o.id, base),
		})),
	};
}

/**
 * Öffentliche Form eines Eheeintrags (explizite Allowlist, nie gespreadet – Namenswörter,
 * Schlüssel und Facettenfelder des Index gehen nie hinaus). `type` trägt die Werte des
 * Filters `art` (trauung | verkuendung), `typeLabel` die Anzeige. `date.text` steht wie im
 * Kirchenbuch (ohne «a. St.»), `date.calendar` sagt, ob julianisch (bis 1700) oder
 * gregorianisch; `from`/`to` sind ISO-Tage, nicht umgerechnet. `url` = Permalink des
 * Online-Katalogs (Katalog-ID = id), `links.web` = Seite der Einheit auf der Plattform.
 * `sameMarriage` = die übrigen Einträge derselben Ehe aus der geprüften Liste (sameMarriages
 * in lib/server/ehedaten.ts), null, wenn die Liste den Eintrag nicht führt.
 */
export function toEhedatenItem(
	e: EhedatenEntry,
	base: string,
	sameMarriage: { sicher: boolean; entries: EhedatenEntry[] } | null = null,
): Record<string, unknown> {
	const url = catalogPermalink(e.id);
	return {
		id: e.id,
		signature: e.signatur,
		volume: orNull(e.band),
		entry: e.eintrag ?? null,
		page: orNull(e.seite),
		source: orNull(e.quelle),
		parish: e.kirchgemeinde,
		type: e.art,
		typeLabel: ART_LABEL[e.art],
		date: dateOf(e),
		groom: person(e.mann),
		bride: person(e.frau),
		title: e.titel,
		uncertain: e.unsicher,
		sameMarriage: sameMarriage && sameMarriage.entries.length > 0 ? sameMarriageItem(sameMarriage, base) : null,
		url,
		links: linksOf(e.id, base),
	};
}
