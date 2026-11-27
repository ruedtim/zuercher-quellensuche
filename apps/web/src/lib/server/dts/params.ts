// Strikte Parameter-Parser für die drei DTS-Endpoints. Fehler-Policy wie bei
// apiV1: unbekannte Parameter-NAMEN werden ignoriert (Forward-Kompatibilität),
// ungültige WERTE bekannter Parameter geben einen ParamError (→ 400).
// Pure Modul – via `npx tsx --test` testbar.
//
// Spec-Regeln (Navigation & Document):
//   - `ref` ist exklusiv zu `start`/`end`,
//   - `start` und `end` treten nur gemeinsam auf.

import { NAV_CHILDREN, NAV_VALUES, type NavValue } from "./constants";

export interface ParamError {
	code: "invalid_parameter";
	message: string;
}

export function isParamError(value: unknown): value is ParamError {
	return (
		typeof value === "object" &&
		value !== null &&
		"code" in value &&
		(value as { code: unknown }).code === "invalid_parameter"
	);
}

function invalid(message: string): ParamError {
	return { code: "invalid_parameter", message };
}

function intParam(
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

function optionalString(url: URL, name: string): string | null {
	const raw = url.searchParams.get(name);
	if (raw == null) return null;
	const trimmed = raw.trim();
	return trimmed === "" ? null : trimmed;
}

/** `ref` ⊥ `start`/`end`; `start`/`end` nur gemeinsam. */
function checkRefRange(
	ref: string | null,
	start: string | null,
	end: string | null,
): ParamError | null {
	if (ref !== null && (start !== null || end !== null)) {
		return invalid("Parameter 'ref' must not be combined with 'start'/'end'.");
	}
	if ((start === null) !== (end === null)) {
		return invalid("Parameters 'start' and 'end' must be used together.");
	}
	return null;
}

// --- Collection -------------------------------------------------------------

export interface CollectionQuery {
	id: string | null;
	page: number;
	nav: NavValue;
}

export function parseCollectionQuery(url: URL): CollectionQuery | ParamError {
	const page = intParam(url, "page", 1, Number.MAX_SAFE_INTEGER, 1);
	if (isParamError(page)) return page;

	const navRaw = (url.searchParams.get("nav") ?? NAV_CHILDREN).trim();
	if (!(NAV_VALUES as readonly string[]).includes(navRaw)) {
		return invalid(`Parameter 'nav' must be one of: ${NAV_VALUES.join(", ")}.`);
	}

	return { id: optionalString(url, "id"), page, nav: navRaw as NavValue };
}

// --- Navigation -------------------------------------------------------------

export interface NavigationQuery {
	resource: string;
	ref: string | null;
	start: string | null;
	end: string | null;
	down: number | null;
	tree: string | null;
	page: number;
}

export function parseNavigationQuery(url: URL): NavigationQuery | ParamError {
	const resource = optionalString(url, "resource");
	if (resource === null) return invalid("Parameter 'resource' is required.");

	const ref = optionalString(url, "ref");
	const start = optionalString(url, "start");
	const end = optionalString(url, "end");
	const rangeErr = checkRefRange(ref, start, end);
	if (rangeErr) return rangeErr;

	// down: -1 = maximale Tiefe, sonst >= 0. Nicht gesetzt → null.
	const downRaw = url.searchParams.get("down");
	let down: number | null = null;
	if (downRaw != null && downRaw.trim() !== "") {
		const parsed = intParam(url, "down", -1, 100, 0);
		if (isParamError(parsed)) return parsed;
		down = parsed;
	}

	const page = intParam(url, "page", 1, Number.MAX_SAFE_INTEGER, 1);
	if (isParamError(page)) return page;

	return { resource, ref, start, end, down, tree: optionalString(url, "tree"), page };
}

// --- Document ---------------------------------------------------------------

export interface DocumentQuery {
	resource: string;
	ref: string | null;
	start: string | null;
	end: string | null;
	tree: string | null;
	mediaType: string | null;
}

export function parseDocumentQuery(url: URL): DocumentQuery | ParamError {
	const resource = optionalString(url, "resource");
	if (resource === null) return invalid("Parameter 'resource' is required.");

	const ref = optionalString(url, "ref");
	const start = optionalString(url, "start");
	const end = optionalString(url, "end");
	const rangeErr = checkRefRange(ref, start, end);
	if (rangeErr) return rangeErr;

	return {
		resource,
		ref,
		start,
		end,
		tree: optionalString(url, "tree"),
		mediaType: optionalString(url, "mediaType"),
	};
}
