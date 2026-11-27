// POST /api/mcp – Remote-MCP-Server (Streamable HTTP, JSON-RPC 2.0). Externe
// agentische KI (Claude, ChatGPT, Apertus …) ruft hier die Such-Tools selbständig auf –
// seit 2026-11 der Weg zu ausformulierten Antworten (die Website generiert keine mehr).
// CORS erbt die Route über hooks.server.ts (isPublicApi → /api/mcp); das Kontingent
// zählt sie selbst: jede JSON-RPC-Nachricht im eigenen MCP-Bucket je anonymisiertem Netz,
// eine Überschreitung kommt als lesbarer Werkzeug- bzw. JSON-RPC-Fehler (rateLimitedRpc).
// Ins Nutzungs-Log gehen Methode, Werkzeug, Dauer, Trefferzahl und Fehler – nie die
// Argumente. Reiner Request/Response-Pfad (kein SSE) – die Tools sind kurze Calls. Grenzen für den
// Speicher: kurze Anfragen und Batches (die laufen der Reihe nach), Werkzeuge und Ressourcen nur in
// begrenzter Zahl gleichzeitig, Antworten zählen, bis der Client sie hat (gate.ts).

import type { RequestHandler } from "./$types";
import { apiBaseUrl, MCP_ENABLE, MCP_BEARER_TOKEN, MCP_RATE_LIMIT, MCP_RATE_WINDOW_MS } from "$lib/server/apiV1/config";
import { checkRateLimit } from "$lib/server/apiV1/rateLimit";
import { clientKey } from "$lib/server/clientKey";
import { createGate, MCP_GATE } from "$lib/server/gate";
import { bytesBody } from "$lib/server/responseBody";
import { handleRpc, hitCount, INVALID_REQUEST, PARSE_ERROR, rateLimitedRpc, rpcLabel, type JsonRpcResponse, type McpToolOutput } from "$lib/server/mcp/protocol";
import { runMcpTool, readMcpResource } from "$lib/server/mcp/tools";
import type { McpAnalytics } from "$lib/server/analytics/extract";

// Längster Batch. Das Protokoll kennt sie seit 2025-06-18 nicht mehr, ältere Clients bündeln wenige.
const BATCH_MAX = 10;
// Ab so vielen Bytes fertiger Antworten führt ein Batch nichts mehr aus.
const BATCH_MAX_BYTES = 4 * 1024 * 1024;
// Grösste Anfrage: Ein Vektor (vector_search) braucht rund 25 KB, alles andere viel weniger.
const BODY_MAX = 64 * 1024;
// So lange darf ein Client an seiner Antwort lesen, dann trennt der Server.
const SEND_MAX_MS = 60_000;

const gate = createGate(MCP_GATE);
const encoder = new TextEncoder();

// Werkzeug-Ergebnis, wenn gerade kein Platz frei ist: lesbar fürs Modell, kein Protokollfehler.
const BUSY: McpToolOutput = {
	structuredContent: {
		error: "busy",
		retryAfterS: 5,
		message: "Der Server bearbeitet gerade zu viele Aufrufe gleichzeitig. Bitte in einigen Sekunden erneut versuchen.",
	},
	isError: true,
};

// Werkzeug-Ergebnis für den Rest eines Batches, dessen Antworten zu gross werden.
const BATCH_FULL: McpToolOutput = {
	structuredContent: {
		error: "batch_too_large",
		message: "Die Antworten dieses Batches sind zu gross. Bitte die übrigen Aufrufe einzeln schicken.",
	},
	isError: true,
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function jsonError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify({ error: { code, message, status } }), {
		status,
		headers: { ...JSON_HEADERS, ...headers },
	});
}

function rpcError(code: number, message: string): Response {
	return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
		status: 200,
		headers: JSON_HEADERS,
	});
}

/**
 * Antwort ausliefern. `held` gibt die gezählten Bytes frei, sobald der Client alles hat, er trennt
 * oder die Frist um ist (dann trennt der Server, sonst bliebe die Antwort im Speicher).
 */
function send(parts: Uint8Array[], held: Array<() => void>, disconnect: () => void): Response {
	let open = true;
	const end = () => {
		if (!open) return;
		open = false;
		clearTimeout(timer);
		for (const release of held) release();
	};
	const timer = setTimeout(() => {
		end();
		disconnect();
	}, SEND_MAX_MS);
	timer.unref?.();
	const length = parts.reduce((n, p) => n + p.byteLength, 0);
	return new Response(bytesBody(parts, end), {
		status: 200,
		headers: { ...JSON_HEADERS, "content-length": String(length) },
	});
}

export const POST: RequestHandler = async ({ request, url, locals, platform, getClientAddress }) => {
	// Feature-Flag (Dark-Shipping): aus = Endpoint existiert faktisch nicht.
	if (!MCP_ENABLE) return jsonError(404, "not_found", "MCP endpoint is disabled.");

	// Optionales Bearer-Gate (Default offen, wenn MCP_BEARER_TOKEN leer ist).
	if (MCP_BEARER_TOKEN) {
		const auth = request.headers.get("authorization") ?? "";
		if (auth !== `Bearer ${MCP_BEARER_TOKEN}`) {
			return jsonError(401, "unauthorized", "Bearer token required.", { "www-authenticate": "Bearer" });
		}
	}

	const tooLarge = () => rpcError(INVALID_REQUEST, `Request too large: at most ${BODY_MAX / 1024} KB.`);
	if (Number(request.headers.get("content-length")) > BODY_MAX) return tooLarge();
	let body: unknown;
	try {
		const text = await request.text();
		if (text.length > BODY_MAX) return tooLarge();
		body = JSON.parse(text);
	} catch {
		return rpcError(PARSE_ERROR, "Parse error: invalid JSON.");
	}

	if (Array.isArray(body) && body.length > BATCH_MAX) {
		locals.analytics.mcp = { ...rpcLabel(body[0]), batch: body.length, error: true };
		return rpcError(INVALID_REQUEST, `Batch too large: at most ${BATCH_MAX} messages.`);
	}

	const base = apiBaseUrl(url);
	const key = `mcp:${clientKey(request, getClientAddress)}`;
	const windowS = Math.round(MCP_RATE_WINDOW_MS / 1000);
	const messages = Array.isArray(body) ? body : [body];
	// Nutzungs-Log: die erste Nachricht (bei einem Batch dazu die Anzahl), bei tools/call
	// Werkzeug, Dauer, Treffer und Fehler.
	const log: McpAnalytics = { ...rpcLabel(messages[0]), ...(Array.isArray(body) ? { batch: body.length } : {}) };
	locals.analytics.mcp = log;

	// Gezählte Bytes der fertigen Antworten; freigegeben, wenn der Client sie hat.
	const held: Array<() => void> = [];
	let heldBytes = 0;
	// Im Batch: nach dem ersten «busy» bzw. zu grossen Antworten den Rest gar nicht erst ausführen.
	let refusal: McpToolOutput | null = null;

	// Eine Nachricht beantworten. Den Platz (Werkzeug, Ressource) gibt sie erst frei, wenn die
	// Antwort serialisiert und gezählt ist.
	const handleOne = async (message: unknown): Promise<Uint8Array | null> => {
		const rl = checkRateLimit(key, MCP_RATE_LIMIT, MCP_RATE_WINDOW_MS);
		let release = () => {};
		const acquire = async (): Promise<McpToolOutput | null> => {
			if (refusal) return refusal;
			const slot = await gate.acquire(key, request.signal);
			if (slot.ok) {
				release = slot.release;
				return null;
			}
			log.limited = true;
			return (refusal = BUSY);
		};
		const callTool = async (name: string, args: Record<string, unknown>): Promise<McpToolOutput> => {
			const started = performance.now();
			const refused = await acquire();
			if (refused) return refused;
			try {
				const out = await runMcpTool(name, args, base);
				if (log.tool === name && log.ms === undefined) {
					log.ms = Math.round(performance.now() - started);
					const hits = hitCount(out.structuredContent);
					if (hits !== undefined) log.hits = hits;
					if (out.isError) log.error = true;
				}
				return out;
			} catch (err) {
				// handleRpc macht daraus ein isError-Ergebnis; hier wenigstens ins Server-Log.
				console.error(`[mcp] Werkzeug ${name} gescheitert:`, err);
				if (log.tool === name) {
					log.ms = Math.round(performance.now() - started);
					log.error = true;
				}
				throw err;
			}
		};
		const readResource = async (uri: string) => {
			if (await acquire()) throw new Error("busy");
			return readMcpResource(uri);
		};
		try {
			let resp: JsonRpcResponse | null;
			if (rl.ok) {
				resp = await handleRpc(message, { callTool, readResource });
				if (resp?.error) log.error = true;
			} else {
				log.limited = true;
				resp = rateLimitedRpc(message, rl.retryAfterS, MCP_RATE_LIMIT, windowS);
			}
			if (resp === null) return null;
			const bytes = encoder.encode(JSON.stringify(resp));
			held.push(gate.hold(key, bytes.byteLength));
			heldBytes += bytes.byteLength;
			return bytes;
		} finally {
			release();
		}
	};

	try {
		// Batch: je Element der Reihe nach verarbeiten, Notifications (null) weglassen. Nur
		// Notifications ⇒ 202 ohne Body (JSON-RPC-Konvention).
		const parts: Uint8Array[] = [];
		for (const message of messages) {
			if (heldBytes >= BATCH_MAX_BYTES) refusal = BATCH_FULL;
			const bytes = await handleOne(message);
			if (bytes === null) continue;
			if (parts.length > 0) parts.push(encoder.encode(","));
			parts.push(bytes);
		}
		if (parts.length === 0) return new Response(null, { status: 202 });
		if (Array.isArray(body)) {
			parts.unshift(encoder.encode("["));
			parts.push(encoder.encode("]"));
		}
		return send(parts, held, () => platform?.req?.socket.destroy());
	} catch (err) {
		for (const release of held) release();
		throw err;
	}
};

// GET → 405: dieser MCP-Server bietet keinen server-initiierten SSE-Kanal
// (Streamable HTTP erlaubt das). OPTIONS-Preflight beantwortet hooks.server.ts.
const methodNotAllowed: RequestHandler = async () =>
	jsonError(405, "method_not_allowed", "Use POST with JSON-RPC. This MCP server has no SSE channel.", {
		allow: "POST, OPTIONS",
	});

export const GET = methodNotAllowed;
export const fallback = methodNotAllowed;
