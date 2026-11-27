// JSON-LD-Response-Bausteine für /api/dts: Erfolgs-Antworten (application/
// ld+json), Fehler-Shape, Methoden-Fallback, Route-Wrapper und die Hydra-
// Paginierung (`view` mit @type "Pagination"). Pure Modul (Response/JSON/
// console sind Node-Globals) – via `npx tsx --test` ohne SvelteKit testbar.
//
// Anders als apiV1/respond.ts gibt es KEINEN {data, meta, links}-Envelope: DTS-
// Antworten SIND das JSON-LD-Objekt (Entry/Collection/Navigation) bzw. TEI/XML
// (Document). Die Fehler-Shape ({error:{code,message,status}}) ist bewusst
// identisch zu apiV1, damit Clients beide öffentlichen APIs gleich behandeln.

import { DTS_CONTEXT_URL, DTS_VERSION, type DtsErrorCode } from "./constants";

const JSONLD_HEADERS = { "content-type": "application/ld+json; charset=utf-8" };

/**
 * Ergebnis der JSON-LD-Bau-Funktionen (collection/navigation): entweder ein
 * fertiges Objekt oder ein Fehler, den der Route-Handler in dtsError mappt.
 */
export type BuildResult =
	| { kind: "ok"; body: Record<string, unknown> }
	| { kind: "error"; status: number; code: DtsErrorCode; message: string };

export const okResult = (body: Record<string, unknown>): BuildResult => ({ kind: "ok", body });
export const errResult = (
	status: number,
	code: DtsErrorCode,
	message: string,
): BuildResult => ({ kind: "error", status, code, message });

/** JSON-LD-Erfolgsantwort. `@context`/`dtsVersion` setzt der Aufrufer im Body. */
export function jsonld(body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { ...JSONLD_HEADERS, ...headers },
	});
}

export function dtsError(status: number, code: DtsErrorCode, message: string): Response {
	return new Response(JSON.stringify({ error: { code, message, status } }), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

/** Fallback-Export für alle dts-Routen: JSON-405 statt SvelteKits Plaintext. */
export function dtsMethodNotAllowed(): Response {
	return new Response(
		JSON.stringify({
			error: { code: "method_not_allowed", message: "Only GET requests are supported.", status: 405 },
		}),
		{
			status: 405,
			headers: {
				"content-type": "application/json; charset=utf-8",
				allow: "GET, OPTIONS",
				"cache-control": "no-store",
			},
		},
	);
}

/** Wrapper für dts-Route-Handler: uncaught Exceptions → JSON-500 in DTS-Shape. */
export function dtsRoute<E>(fn: (event: E) => Promise<Response>): (event: E) => Promise<Response> {
	return async (event: E) => {
		try {
			return await fn(event);
		} catch (err) {
			console.error("[api/dts] unhandled error:", err);
			return dtsError(500, "internal_error", "Internal server error.");
		}
	};
}

/** Die beiden Pflicht-Felder am Kopf jedes JSON-LD-Dokuments. */
export function ldEnvelope(): { "@context": string; dtsVersion: string } {
	return { "@context": DTS_CONTEXT_URL, dtsVersion: DTS_VERSION };
}

/**
 * Hydra-Paginierung (`view`, @type "Pagination"). Liefert null, wenn alles auf
 * eine Seite passt (dann gehört kein `view` in die Antwort). `buildPageUrl(n)`
 * baut die absolute URL für Seite n; `selfUrl` ist die URL des Requests.
 */
export function paginationView(
	selfUrl: string,
	buildPageUrl: (page: number) => string,
	page: number,
	totalPages: number,
): Record<string, string> | null {
	if (totalPages <= 1) return null;
	const view: Record<string, string> = {
		"@id": selfUrl,
		"@type": "Pagination",
		first: buildPageUrl(1),
	};
	if (page > 1) view.previous = buildPageUrl(page - 1);
	if (page < totalPages) view.next = buildPageUrl(page + 1);
	view.last = buildPageUrl(totalPages);
	return view;
}
