import type { RequestHandler } from "./$types";

// Liveness-Endpoint für den Container-Healthcheck (Dockerfile HEALTHCHECK).
// Immer 200, ohne Meili/embed zu berühren – und in hooks.server.ts vom
// Analytics-Logging ausgenommen, damit das JSONL nicht zu ~99 % aus
// 30-Sekunden-Healthchecks besteht.
export const GET: RequestHandler = () =>
	new Response("ok\n", { headers: { "content-type": "text/plain" } });
