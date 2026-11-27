import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const UPSTREAM = "https://zszh.sources-online.org/manifests";

/**
 * Proxy zu zszh.sources-online.org/manifests/* für OS/KRP/RRB.
 * Setzt CORS-Header, damit Mirador das Manifest fetchen kann (der Upstream
 * liefert keine Access-Control-Allow-Origin).
 *
 * Zusätzlich: patcht IIIF-Presentation-2-Manifeste, deren Image-Annotationen
 * weder `on` noch `target` haben. Mirador 4 ruft auf solchen Annotationen
 * `(on || target).match(/xywh=/)` auf und crasht mit "Cannot read properties
 * of undefined (reading 'match')". Wir setzen `on` aus der enthaltenden
 * Canvas-ID – semantisch korrekt nach IIIF-Spec.
 *
 * Caddy könnte den Proxy-Teil in Prod genauso erledigen – die Manifest-Korrektur
 * muss aber zwingend hier durchlaufen.
 */
export const GET: RequestHandler = async ({ params }) => {
	const path = params.path;
	if (!path || path.includes("..")) throw error(400, "invalid path");

	const url = `${UPSTREAM}/${path}`;
	const res = await fetch(url, {
		signal: AbortSignal.timeout(10_000),
		headers: { accept: "application/json" },
	});
	if (!res.ok) throw error(res.status, `Upstream ${res.status}`);

	const contentType = res.headers.get("content-type") ?? "application/json";
	let body: ArrayBuffer | string = await res.arrayBuffer();

	// Nur JSON patchen – bei info.json (Image API) gibts keine Canvas, fällt
	// durchs Schema; bei Presentation-Manifesten fügen wir `on` hinzu wo nötig.
	if (contentType.includes("json")) {
		try {
			const text = new TextDecoder().decode(body);
			const manifest = JSON.parse(text);
			let patched = false;
			const sequences = manifest?.sequences ?? [];
			for (const seq of sequences) {
				for (const canvas of seq.canvases ?? []) {
					const canvasId = canvas["@id"];
					if (!canvasId) continue;
					for (const img of canvas.images ?? []) {
						// Mirador 4 ruft `(on || target).match()` blind auf – also
						// beide setzen, sonst crasht es trotz Patch (siehe Bug
						// in mirador.es.js, onFragment-Funktion).
						if (!img.on) {
							img.on = canvasId;
							patched = true;
						}
						if (!img.target) {
							img.target = canvasId;
							patched = true;
						}
					}
				}
			}
			if (patched) {
				body = JSON.stringify(manifest);
			} else {
				body = text;
			}
		} catch {
			// Nicht-JSON oder Parse-Fehler – Upstream-Body unverändert weiterreichen
		}
	}

	return new Response(body, {
		status: 200,
		headers: {
			"content-type": contentType,
			"cache-control": "public, max-age=3600",
			"access-control-allow-origin": "*",
		},
	});
};
