import { portraitProxy } from "$lib/server/krdb";
import type { RequestHandler } from "./$types";

/**
 * Porträt einer KRDB-Person (Wikimedia-Commons-Vorschaubild) über den eigenen
 * Server – Besucher:innen kontaktieren Wikimedia nicht. Nur Schlüssel aus dem
 * Register (sonst 404): die QID, bei kuratierten Porträts ohne Wikidata-Item
 * «K» + KRDB-ID (der Parameter heisst trotzdem `qid`). Die Upstream-URL stammt
 * nie vom Client.
 *
 * `?v=<token>` = Versions-Token aus dem Register: stimmt es, darf der Browser
 * das Bild ein Jahr lang cachen (ändert sich P18, ändert sich die URL).
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const res = await portraitProxy.get(params.qid);
	if (!res.ok) {
		return new Response(res.status === 404 ? "Kein Porträt" : "Porträt nicht verfügbar", {
			status: res.status,
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": res.status === 404 ? "public, max-age=3600" : "no-store",
				"x-robots-tag": "noindex",
			},
		});
	}
	const v = url.searchParams.get("v");
	const immutable = !!v && v === portraitProxy.version(params.qid);
	return new Response(res.body.bytes, {
		headers: {
			"content-type": res.body.type,
			"content-length": String(res.body.bytes.byteLength),
			"cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=86400",
			"x-content-type-options": "nosniff",
			// Fremde Seiten sollen uns nicht als Wikimedia-Proxy einbinden.
			"cross-origin-resource-policy": "same-origin",
			"x-robots-tag": "noindex",
		},
	});
};
