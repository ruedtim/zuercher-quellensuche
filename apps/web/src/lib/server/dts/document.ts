// DTS-Document-Endpoint: liefert das Original-TEI/XML eines Dokuments. Quelle
// sind die vom Indexer abgelegten Dateien (<out>/xml/<series>/<id>.xml, von
// Caddy unter /xml/* serviert). loadRawXml spiegelt loadRenderedHtml.
//
// Zitiertiefe = Dokument-Ebene: nur das ganze Dokument (ref/start/end == "1")
// ist abrufbar, kein <dts:wrapper>-Fragment. Zusätzlich zu TEI (Default) werden
// best effort text/html (vorgerendert) und text/plain (Body) angeboten.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SeriesAbbr } from "../../types";
import { XML_BASE_URL, XML_LOCAL_DIR } from "../env";
import { getDocument } from "../meili";
import { loadRenderedHtml } from "../renderHtml";
import { SUPPORTED_MEDIA_TYPES, TEI_MEDIA_TYPE } from "./constants";
import type { DocumentQuery } from "./params";
import { dtsError } from "./serialize";

/**
 * Lädt die Original-TEI/XML-Datei eines Dokuments.
 * - Dev/Coexist: liest aus XML_LOCAL_DIR/xml/<series>/<id>.xml (Mount /srv/zszh)
 * - Prod-Standalone: holt via HTTP von XML_BASE_URL (z. B. http://caddy/xml)
 */
export async function loadRawXml(series: SeriesAbbr, id: string): Promise<string | null> {
	if (XML_LOCAL_DIR) {
		const path = join(XML_LOCAL_DIR, "xml", series, `${id}.xml`);
		try {
			return await readFile(path, "utf-8");
		} catch {
			return null;
		}
	}
	if (XML_BASE_URL) {
		try {
			const res = await fetch(`${XML_BASE_URL}/${series}/${encodeURIComponent(id)}.xml`, {
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

export async function buildDocumentResponse(base: string, query: DocumentQuery): Promise<Response> {
	const doc = await getDocument(query.resource);
	if (!doc) return dtsError(404, "not_found", `Resource '${query.resource}' not found.`);

	// Flache Zitierstruktur: nur die Einheit "1" (= ganzes Dokument).
	const refs = [query.ref, query.start, query.end].filter((r): r is string => r !== null);
	const badRef = refs.find((r) => r !== "1");
	if (badRef !== undefined) {
		return dtsError(404, "not_found", `Unknown citable unit '${badRef}' in resource '${doc.id}'.`);
	}

	const mediaType = query.mediaType ?? TEI_MEDIA_TYPE;
	if (!(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
		return dtsError(
			415,
			"unsupported_media_type",
			`Unsupported mediaType '${mediaType}'. Supported: ${SUPPORTED_MEDIA_TYPES.join(", ")}.`,
		);
	}

	// Link-Header auf den Collection-Endpoint (Spec-Empfehlung).
	const linkHeader = `<${base}/api/dts/collection?id=${encodeURIComponent(doc.id)}>; rel="collection"`;
	const cache = "public, max-age=300";

	if (mediaType === "text/plain") {
		return new Response(doc.body ?? "", {
			headers: { "content-type": "text/plain; charset=utf-8", link: linkHeader, "cache-control": cache },
		});
	}

	if (mediaType === "text/html") {
		const html = await loadRenderedHtml(doc.series, doc.id);
		if (html == null) {
			return dtsError(502, "upstream_unavailable", `Rendered HTML not available for '${doc.id}'.`);
		}
		return new Response(html, {
			headers: { "content-type": "text/html; charset=utf-8", link: linkHeader, "cache-control": cache },
		});
	}

	// Default: Original-TEI/XML.
	const xml = await loadRawXml(doc.series, doc.id);
	if (xml == null) {
		return dtsError(502, "upstream_unavailable", `TEI source not available for '${doc.id}'.`);
	}
	return new Response(xml, {
		headers: {
			"content-type": `${TEI_MEDIA_TYPE}; charset=utf-8`,
			link: linkHeader,
			"cache-control": cache,
		},
	});
}
