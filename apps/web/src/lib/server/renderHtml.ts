import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RENDER_BASE_URL, RENDER_LOCAL_DIR } from "./env";
import { isDocumentId } from "$lib/documentId";
import type { SeriesAbbr } from "$lib/types";

/**
 * Lädt das vom Indexer gerenderte HTML-Fragment für ein Dokument.
 *
 * - Dev: liest aus RENDER_LOCAL_DIR (z. B. ../../services/indexer/output)
 * - Prod: holt via HTTP von RENDER_BASE_URL (z. B. http://caddy/render)
 */
export async function loadRenderedHtml(series: SeriesAbbr, id: string): Promise<string | null> {
	if (!isDocumentId(id)) return null; // die ID wird Teil eines Dateipfads
	if (RENDER_LOCAL_DIR) {
		const path = join(RENDER_LOCAL_DIR, "render", series, `${id}.html`);
		try {
			return await readFile(path, "utf-8");
		} catch {
			return null;
		}
	}
	if (RENDER_BASE_URL) {
		try {
			const res = await fetch(`${RENDER_BASE_URL}/${series}/${id}.html`, {
				signal: AbortSignal.timeout(2000),
			});
			if (!res.ok) return null;
			return await res.text();
		} catch {
			return null;
		}
	}
	return null;
}
