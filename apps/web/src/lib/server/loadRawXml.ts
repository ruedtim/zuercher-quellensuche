import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RENDER_BASE_URL, RENDER_LOCAL_DIR } from "./env";
import { isDocumentId } from "$lib/documentId";
import type { SeriesAbbr } from "$lib/types";

/**
 * Lädt die rohe TEI-XML-Quelle eines Dokuments. Der Indexer schreibt sie nach
 * `xml/{series}/{id}.xml` neben Render-HTML und IIIF-Manifesten.
 *
 * - Dev: liest aus RENDER_LOCAL_DIR
 * - Prod: holt via HTTP (Caddy serviert `/xml/...` aus dem volume `/srv/zszh`)
 */
export async function loadRawXml(series: SeriesAbbr, id: string): Promise<string | null> {
	if (!isDocumentId(id)) return null; // die ID wird Teil eines Dateipfads
	if (RENDER_LOCAL_DIR) {
		const path = join(RENDER_LOCAL_DIR, "xml", series, `${id}.xml`);
		try {
			return await readFile(path, "utf-8");
		} catch {
			return null;
		}
	}
	if (RENDER_BASE_URL) {
		try {
			const upstream = RENDER_BASE_URL.replace(/\/render\/?$/, "") + `/xml/${series}/${id}.xml`;
			const res = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
			if (!res.ok) return null;
			return await res.text();
		} catch {
			return null;
		}
	}
	return null;
}
