// Laufzeit-Konfiguration für /api/v1 – die EINZIGE apiV1-Datei mit
// $env-Zugriff, damit params/respond/rateLimit ohne SvelteKit testbar bleiben.

import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { MCP_RATE_LIMIT_DEFAULT, MCP_RATE_WINDOW_S_DEFAULT, RATE_LIMIT_DEFAULT, RATE_WINDOW_S_DEFAULT } from "./constants";

function intEnv(raw: string | undefined, fallback: number): number {
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

function boolEnv(raw: string | undefined, fallback: boolean): boolean {
	if (raw == null || raw === "") return fallback;
	return raw === "1" || raw.toLowerCase() === "true";
}

// Remote-MCP-Server (/api/mcp). Default AUS – per infra/.env (MCP_ENABLE=1)
// scharfschalten, Container neu starten (Dark-Shipping, kein Rebuild nötig).
export const MCP_ENABLE = boolEnv(env.MCP_ENABLE, false);

// Optionales Bearer-Gate für /api/mcp: leer ⇒ offener Lesezugriff (Default,
// gemeinfreie Daten); gesetzt ⇒ `Authorization: Bearer <token>` erforderlich (z. B.
// private Beta, danach per Env auf offen umschaltbar – kein Code-Change).
export const MCP_BEARER_TOKEN = (env.MCP_BEARER_TOKEN ?? "").trim();

// Requests pro Fenster und Client (Fenster in Sekunden). Tuning ohne Deploy:
// Werte in infra/.env setzen (Compose-Pass-through), Container neu starten.
export const API_V1_RATE_LIMIT = intEnv(env.API_V1_RATE_LIMIT, RATE_LIMIT_DEFAULT);
export const API_V1_RATE_WINDOW_MS =
	intEnv(env.API_V1_RATE_WINDOW_S, RATE_WINDOW_S_DEFAULT) * 1000;

// Kontingent des MCP-Servers, getrennt von /api/v1 und /api/dts (constants.ts).
export const MCP_RATE_LIMIT = intEnv(env.MCP_RATE_LIMIT, MCP_RATE_LIMIT_DEFAULT);
export const MCP_RATE_WINDOW_MS = intEnv(env.MCP_RATE_WINDOW_S, MCP_RATE_WINDOW_S_DEFAULT) * 1000;

/**
 * Basis für absolute URLs in Responses. adapter-node läuft ohne ORIGIN/
 * PROTOCOL_HEADER, d. h. url.origin wäre in Prod "http://…" – darum
 * PUBLIC_BASE_URL (in infra/compose.* gesetzt), Fallback request origin (Dev).
 */
export function apiBaseUrl(requestUrl: URL): string {
	const fromEnv = (publicEnv.PUBLIC_BASE_URL ?? "").trim();
	return (fromEnv || requestUrl.origin).replace(/\/+$/, "");
}
