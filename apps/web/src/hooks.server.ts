import type { Handle, RequestEvent } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { logEvent } from "$lib/server/analytics/log";
import { anonSid } from "$lib/server/analytics/sid";
import { uaFamily } from "$lib/server/analytics/ua";
import { lookupCountry } from "$lib/server/analytics/geo";
import { API_V1_RATE_LIMIT, API_V1_RATE_WINDOW_MS } from "$lib/server/apiV1/config";
import { BULK_DATA_URL } from "$lib/server/apiV1/constants";
import { checkRateLimit } from "$lib/server/apiV1/rateLimit";
import { clientKey } from "$lib/server/clientKey";
import { createGate, WEB_GATE } from "$lib/server/gate";
import { trimLinkHeader } from "$lib/server/linkHeader";
import { installProcessGuard } from "$lib/server/processGuard";
import { isCostlyRoute, isSuspiciousPath, publicApiOf, type PublicApi } from "$lib/server/requestGuard";

installProcessGuard();

// Sampling für sehr hochfrequente Routes (Typeahead schickt pro Tastendruck
// einen Request – dabei interessieren uns nicht die einzelnen Calls, sondern
// die aggregierte Last). Werte landen mit `sampled: N`-Marker im Log, damit
// DuckDB-Queries den Wert hochmultiplizieren können.
const SAMPLE_RATES: Record<string, number> = {
	"/api/search/facetSearch": 20, // 1 von 20 Calls loggen
};

function referrerClass(refRaw: string | null, host: string): "internal" | "external" | "none" {
	if (!refRaw) return "none";
	try {
		const ref = new URL(refRaw);
		return ref.host === host ? "internal" : "external";
	} catch {
		return "external";
	}
}

const analyticsHandle: Handle = async ({ event, resolve }) => {
	const start = performance.now();
	event.locals.analytics = {};
	const response = await resolve(event);
	const dur_ms = Math.round(performance.now() - start);

	// SvelteKit liefert das gematchte Route-Pattern via event.route.id, z.B.
	// "/documents/[abbr]/[id]". Ohne Route (404) eine Konstante: `route` wird in Loki zum Label,
	// beliebige Pfade machten aus jedem einen eigenen Stream. Der Pfad steht im Feld `path`.
	const route = event.route.id ?? "(unmatched)";

	// Interner Container-Healthcheck (Dockerfile HEALTHCHECK, alle 30 s) – nicht
	// loggen, sonst ist das Analytics-JSONL zu ~99 % Healthcheck-Rauschen.
	// Ebenso die Porträt-Bilder der KRP-Detailseite (bis zu Dutzende pro
	// Seitenaufruf, ohne Aussagewert – der Seitenaufruf selbst wird geloggt).
	if (route === "/healthz" || route === "/api/portrait/[qid]") return response;

	// Sampling-Filter: bei Hochfrequenz-Routes nur 1/N loggen.
	const sample = SAMPLE_RATES[route];
	if (sample && Math.random() >= 1 / sample) {
		return response;
	}

	const xRealIp = event.request.headers.get("x-real-ip") ?? "0";
	const uaRaw = event.request.headers.get("user-agent") ?? "";
	const { ua, mobile } = uaFamily(uaRaw);
	const ref = referrerClass(event.request.headers.get("referer"), event.url.host);
	const country = await lookupCountry(xRealIp);

	const rec: Record<string, unknown> = {
		ts: new Date().toISOString(),
		route,
		method: event.request.method,
		status: response.status,
		dur_ms,
		anon_sid: anonSid(xRealIp, uaRaw),
		ua,
		mobile,
		ref,
	};
	if (country) rec.country = country;
	if (!event.route.id) rec.path = event.url.pathname.slice(0, 200);

	// Routen-spezifische Anreicherung (von den +page.server.ts / +server.ts
	// gefüllt – siehe lib/server/analytics/extract.ts).
	const extras = event.locals.analytics;
	if (extras?.search) rec.search = extras.search;
	if (extras?.doc) rec.doc = extras.doc;
	if (extras?.mcp) rec.mcp = extras.mcp;
	if (extras?.export) rec.export = extras.export;
	if (sample) rec.sampled = sample;

	logEvent(rec as Parameters<typeof logEvent>[0]);
	return response;
};

// --- Öffentliche APIs /api/v1, /api/dts, /api/mcp: CORS + Rate-Limit --------
//
// Gilt für alle öffentlichen Lese-APIs: die pragmatische JSON-API /api/v1, die
// DTS-1.0-konforme /api/dts (JSON-LD + TEI) und den MCP-Server /api/mcp (eigener
// CORS-Satz, s. u.). Offenes CORS ist Standard für öffentliche Lese-APIs:
// Browser-Apps fremder Domains dürfen sie direkt aufrufen. Rate-Limit in-memory (eine web-Replica, siehe apiV1/rateLimit.ts),
// gemeinsamer Bucket über /api/v1 und /api/dts; der MCP-Server zählt seit 2026-11 in der
// Route selbst, je JSON-RPC-Nachricht in einem eigenen, grösseren Kontingent (die Aufrufe
// von Claude.ai und ChatGPT kommen aus wenigen Netzen der Anbieter), und meldet eine
// Überschreitung als Werkzeug-Fehler, den das Modell lesen kann. Key ist die anonymisierte IP aus nginx
// (X-Real-IP, IPv4 /24) – das Limit gilt also pro /24-Netz. Im
// Caddy-Standalone-Deployment fehlt der Header; getClientAddress() liefert
// dann die Proxy-IP und das Limit degradiert zu einem globalen Bucket
// (RUNBOOK-Notiz; Fix wäre `header_up X-Real-IP {client_ip}` im Caddyfile).

const CORS_HEADERS: Record<string, string> = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-headers": "Content-Type",
	"access-control-expose-headers": "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining",
};

// MCP ist POST-basiert (JSON-RPC) und schickt evtl. Authorization/Session-Header
// – darum eigener CORS-Satz, der /api/v1's GET-only-Vertrag unangetastet lässt.
const MCP_CORS_HEADERS: Record<string, string> = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "POST, OPTIONS",
	"access-control-allow-headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
	"access-control-expose-headers": "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, Mcp-Session-Id",
};

function corsFor(api: PublicApi): Record<string, string> {
	return api === "mcp" ? MCP_CORS_HEADERS : CORS_HEADERS;
}

function withCors(response: Response, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
	for (const [k, v] of Object.entries({ ...cors, ...extra })) {
		response.headers.set(k, v);
	}
	return response;
}

const publicApiHandle: Handle = async ({ event, resolve }) => {
	const api = publicApiOf(event.route.id, event.url.pathname);
	if (!api) return resolve(event);

	const cors = corsFor(api);

	// Preflight: ohne Rate-Limit beantworten (Browser schicken ihn ungefragt).
	if (event.request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: { ...cors, "access-control-max-age": "86400" },
		});
	}

	// MCP: Kontingent in der Route (routes/api/mcp/+server.ts), hier nur CORS.
	if (api === "mcp") return withCors(await resolve(event), cors);

	const key = clientKey(event.request, event.getClientAddress);
	const rl = checkRateLimit(key, API_V1_RATE_LIMIT, API_V1_RATE_WINDOW_MS);
	if (!rl.ok) {
		const windowS = Math.round(API_V1_RATE_WINDOW_MS / 1000);
		const body = {
			error: {
				code: "rate_limited",
				message:
					`Rate limit exceeded: max ${API_V1_RATE_LIMIT} requests per ${windowS} s per client. ` +
					`Retry after ${rl.retryAfterS} s. For bulk data use the published dumps, see ` +
					BULK_DATA_URL,
				status: 429,
			},
		};
		return withCors(
			new Response(JSON.stringify(body), {
				status: 429,
				headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
			}),
			cors,
			{
				"retry-after": String(rl.retryAfterS),
				"x-ratelimit-limit": String(API_V1_RATE_LIMIT),
				"x-ratelimit-remaining": "0",
			},
		);
	}

	const response = await resolve(event);
	return withCors(response, cors, {
		"x-ratelimit-limit": String(API_V1_RATE_LIMIT),
		"x-ratelimit-remaining": String(rl.remaining),
	});
};

// Pfade mit zweiter Lesart (requestGuard.ts) bekommen 400, vor allem anderen. `platform.req.url` ist
// das rohe Anfrageziel (adapter-node): `event.url` hat den Backslash schon zu «/» gemacht. Interne
// Aufrufe über event.fetch tragen das Ziel der äusseren Anfrage, die schon geprüft ist.
const pathGuardHandle: Handle = async ({ event, resolve }) => {
	const raw = event.platform?.req?.url ?? event.url.pathname;
	if (!event.isSubRequest && isSuspiciousPath(raw)) {
		return new Response("Bad Request\n", {
			status: 400,
			headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
		});
	}
	return resolve(event);
};

// Teure Routen (Suche, Detailseiten, offene APIs): nur wenige gleichzeitig, weitere warten kurz
// (gate.ts). Ganz innen, damit CORS und Rate-Limit der APIs auch eine Absage tragen.
const webGate = createGate(WEB_GATE);

const BUSY = "Der Server ist gerade ausgelastet. Bitte in einigen Sekunden erneut versuchen.";

/** Absage in der Form, die der Aufrufer zeigt: Navigation im Browser (`__data.json`) und Schnittstellen
 *  als JSON, ganze Seiten und Downloads (Dialog mit iframe) als Text. */
function busyResponse({ url, isDataRequest }: RequestEvent): Response {
	const api = url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/document/");
	const body = isDataRequest
		? JSON.stringify(BUSY)
		: api
			? JSON.stringify({ error: { code: "busy", message: BUSY, status: 503 } })
			: `${BUSY}\n`;
	return new Response(body, {
		status: 503,
		headers: {
			"content-type": isDataRequest || api ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
			"cache-control": "no-store",
			"retry-after": "5",
		},
	});
}

const loadHandle: Handle = async ({ event, resolve }) => {
	if (event.isSubRequest || !isCostlyRoute(event.route.id)) return resolve(event);
	const slot = await webGate.acquire(`web:${clientKey(event.request, event.getClientAddress)}`, event.request.signal);
	if (!slot.ok) {
		return slot.reason === "aborted" ? new Response(null, { status: 499 }) : busyResponse(event);
	}
	try {
		return await resolve(event);
	} finally {
		slot.release();
	}
};

// Kopfzeilen der Seiten klein halten (linkHeader.ts).
const linkHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const link = response.headers.get("link");
	if (!link) return response;
	const short = trimLinkHeader(link);
	if (short === "") response.headers.delete("link");
	else if (short !== link) response.headers.set("link", short);
	return response;
};

// Analytics aussen, API-Handle innen: so werden auch 400er, 429er und Preflights mit
// korrektem event.route.id geloggt (Route-Matching passiert vor dem handle).
export const handle: Handle = sequence(analyticsHandle, pathGuardHandle, publicApiHandle, loadHandle, linkHandle);
