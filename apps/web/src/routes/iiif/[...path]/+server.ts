import { error } from "@sveltejs/kit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RENDER_BASE_URL, RENDER_LOCAL_DIR } from "$lib/server/env";
import type { RequestHandler } from "./$types";

/**
 * Liefert die vom Indexer erzeugten lokalen IIIF-Presentation-v3-Manifeste aus.
 *
 * - Dev: aus `RENDER_LOCAL_DIR/iiif/...`
 * - Prod: per HTTP von Caddy (RENDER_BASE_URL endet auf /render → wir tauschen es zu /iiif)
 */
export const GET: RequestHandler = async ({ params }) => {
	const path = params.path;
	if (!path || path.includes("..")) throw error(400, "invalid path");

	if (RENDER_LOCAL_DIR) {
		const file = join(RENDER_LOCAL_DIR, "iiif", path);
		try {
			const body = await readFile(file, "utf-8");
			return new Response(body, {
				headers: {
					"content-type": "application/json",
					"cache-control": "public, max-age=3600",
					"access-control-allow-origin": "*",
				},
			});
		} catch {
			throw error(404, "Manifest nicht gefunden");
		}
	}

	if (RENDER_BASE_URL) {
		const upstream = RENDER_BASE_URL.replace(/\/render\/?$/, "") + `/iiif/${path}`;
		const res = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) throw error(res.status, "Manifest-Upstream-Fehler");
		const body = await res.text();
		return new Response(body, {
			headers: {
				"content-type": "application/json",
				"cache-control": "public, max-age=3600",
				"access-control-allow-origin": "*",
			},
		});
	}

	throw error(500, "Weder RENDER_LOCAL_DIR noch RENDER_BASE_URL gesetzt");
};
