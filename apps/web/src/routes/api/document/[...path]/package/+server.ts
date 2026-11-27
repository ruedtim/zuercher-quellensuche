import { error } from "@sveltejs/kit";
import { getDocument } from "$lib/server/meili";
import { loadRawXml } from "$lib/server/loadRawXml";
import { loadRenderedHtml } from "$lib/server/renderHtml";
import { buildPrintHtml } from "$lib/server/printHtml";
import { PACKAGE_IMAGE_HOSTS } from "$lib/imageHosts.js";
import { clientKey } from "$lib/server/clientKey";
import { tryAcquireExport } from "$lib/server/exportGate";
import { createPackageStream, imageFetcher, type PackageFile } from "$lib/server/packageStream";
import { clientGone } from "$lib/server/responseBody";
import { ATTRIBUTION, LICENSE, LICENSE_URL } from "$lib/server/apiV1/constants";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { buildPlainText, buildSlug, pickSingleFile, singleFileMeta } from "$lib/server/packageDownload";
import { documentSource, rmCitation, rmImageCredit } from "$lib/format";
import { LEGACY_HOSTS, SITE_DISCLAIMER, SITE_HOST, SITE_NAME, SITE_URL } from "$lib/site";
import { ALL_SERIES, type SeriesAbbr } from "$lib/types";
import type { RequestHandler } from "./$types";

const ALLOWED_FORMATS = new Set(["xml", "txt", "html"]);

interface IIIFCanvasEntry {
	url: string;
	pageLabel: string;
}

const fetchImage = imageFetcher(PACKAGE_IMAGE_HOSTS, fetch);

// HEAD reichte SvelteKit sonst an GET weiter und holte das ganze Paket samt Bildern (Node verwirft nur den Body).
export const HEAD: RequestHandler = () => new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });

export const GET: RequestHandler = async ({ params, url, fetch, request, getClientAddress }) => {
	const rawPath = params.path ?? "";
	// Erwartet: "<series>/<id>" oder "<series>/<id>.xml"
	const stripped = rawPath.replace(/\.xml$/i, "");
	const slash = stripped.indexOf("/");
	if (slash <= 0 || slash === stripped.length - 1) {
		throw error(400, "Pfad muss <series>/<id> sein");
	}
	const series = stripped.slice(0, slash) as SeriesAbbr;
	const id = stripped.slice(slash + 1);
	if (!ALL_SERIES.includes(series)) {
		throw error(400, `Unbekannte Serie: ${series}`);
	}

	// Auswahl parsen. Ohne Angaben (Link `zip` der API) alle Formate, Bilder nur auf Wunsch.
	const formatsRaw = (url.searchParams.get("formats") ?? "xml,txt,html").trim();
	const formats = new Set(
		formatsRaw
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter((s) => ALLOWED_FORMATS.has(s)),
	);
	const imagesRaw = (url.searchParams.get("images") ?? "0").trim().toLowerCase();
	const images = imagesRaw === "1" || imagesRaw === "true";
	if (formats.size === 0 && !images) {
		throw error(400, "Mindestens ein Format oder Bilder auswählen");
	}

	const doc = await getDocument(id);
	if (!doc || doc.series !== series) {
		throw error(404, "Dokument nicht gefunden");
	}

	// Ratsmanuale: die Bilder liegen auf dem Transkribus-Bildserver (READ-COOP),
	// der alle Crawler sperrt – das Paket lädt sie nicht herunter (Hetzner würde
	// sonst zum Massen-Abrufer), sondern verlinkt Manifest und Bilder im README.
	// Eine Rechtekennzeichnung tragen die Bilder nicht, nur den Bildnachweis.
	const remoteImages = series === "RM";

	const slug = buildSlug(doc.stazhIdent ?? null, id);
	const errors: string[] = [];

	// Einzeldatei-Direktdownload: genau ein Textformat, keine Bilder → kein ZIP
	// mit nur einem Eintrag, sondern die Datei direkt (mit dem Slug-Namen, den
	// sonst das ZIP trägt). Mehrere Formate / Bilder → weiter unten als ZIP.
	const single = pickSingleFile(formats, images);
	if (single === "txt") {
		const { filename, contentType } = singleFileMeta(slug, "txt");
		return fileResponse(buildPlainText(doc), filename, contentType);
	}
	if (single === "html") {
		const fragment = await loadRenderedHtml(series, id);
		const html = buildPrintHtml({ series, id, doc, fragment, baseUrl: apiBaseUrl(url) });
		const { filename, contentType } = singleFileMeta(slug, "html");
		return fileResponse(html, filename, contentType);
	}
	if (single === "xml") {
		const xml = await loadRawXml(series, id);
		if (xml) {
			const { filename, contentType } = singleFileMeta(slug, "xml");
			return fileResponse(xml, filename, contentType);
		}
		// TEI-Quelle fehlt → in den ZIP-Pfad fallen (legt MISSING-Hinweis +
		// errors.log bei, statt eine leere .xml auszuliefern).
	}

	// Texte vor den Bildern
	const files: PackageFile[] = [];
	let xmlIncluded = false;
	if (formats.has("xml")) {
		const xml = await loadRawXml(series, id);
		if (xml) {
			files.push({ name: "document.xml", content: xml });
			xmlIncluded = true;
		} else {
			errors.push(`[xml] TEI-Quelle nicht gefunden – xml/${series}/${id}.xml fehlt im Render-Output`);
			files.push({
				name: "document.xml.MISSING.txt",
				content: "TEI-XML konnte für dieses Dokument nicht gefunden werden. Details siehe errors.log.\n",
			});
		}
	}

	// TXT (Plaintext aus Meili-Index – vom Indexer aus dem TEI extrahiert)
	if (formats.has("txt")) files.push({ name: "document.txt", content: buildPlainText(doc) });

	// HTML-Druckansicht (in sich geschlossene, druckfertige Seite)
	let htmlIncluded = false;
	if (formats.has("html")) {
		const fragment = await loadRenderedHtml(series, id);
		if (!fragment && !(doc.body ?? "").trim()) {
			errors.push(
				`[html] weder Render-HTML (render/${series}/${id}.html) noch Volltext vorhanden – Druckansicht enthält nur den Kopf`,
			);
		}
		files.push({ name: "document.html", content: buildPrintHtml({ series, id, doc, fragment, baseUrl: apiBaseUrl(url) }) });
		htmlIncluded = true;
	}

	// Bilder (Ratsmanuale: nur Links, aus dem eigenen Manifest)
	let imageUrls: string[] = [];
	let imageLinks: IIIFCanvasEntry[] = [];
	if (remoteImages) {
		if (doc.manifestUrl) imageLinks = await loadIiifCanvases(doc.manifestUrl, fetch, errors);
	} else if (images) {
		if (!doc.manifestUrl) {
			errors.push("[images] keine Faksimile-Quelle im Index hinterlegt (manifestUrl=null) – keine Bilder verfügbar");
		} else {
			const canvases = await loadIiifCanvases(doc.manifestUrl, fetch, errors);
			if (canvases.length === 0 && errors.findIndex((e) => e.startsWith("[manifest]")) === -1) {
				errors.push(`[images] Manifest enthielt keine Canvas-Einträge – ${doc.manifestUrl}`);
			}
			imageUrls = canvases.map((c) => c.url);
		}
	}

	// Vor der Antwort getrennt: nichts mehr beginnen.
	if (request.signal.aborted) return clientGone();

	// Bilder kommen von einem fremden Bildserver: gleichzeitige Pakete begrenzt, je Netz und gesamt.
	let release = () => {};
	if (imageUrls.length > 0) {
		const gate = tryAcquireExport("package", clientKey(request, getClientAddress));
		if (!gate.ok) {
			return new Response(`${gate.message}\n`, {
				status: gate.status,
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store",
					"retry-after": String(gate.retryAfterS),
				},
			});
		}
		release = gate.release;
	}

	const body = createPackageStream(
		{
			root: slug,
			files,
			images: imageUrls,
			errors,
			// Am Ende, damit das README den tatsächlichen Stand der Bilder nennt.
			closing: ({ imageCount, errors: all }) => {
				if (all.length > 0) console.warn(`[package] ${id}: ${all.length} issue(s) – see errors.log in ZIP`);
				return [
					{
						name: "README.txt",
						content: buildReadme(
							doc,
							series,
							id,
							formats,
							images,
							{ xmlIncluded, htmlIncluded, imageCount, imageLinks: remoteImages ? imageLinks : null, hasErrors: all.length > 0 },
							apiBaseUrl(url),
						),
					},
					{ name: "metadata.json", content: buildMetadataJson(doc, series, id, apiBaseUrl(url)) },
				];
			},
		},
		{ fetchImage, signal: request.signal, release },
	);

	return new Response(body, {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${slug}.zip"`,
			"Cache-Control": "no-store",
		},
	});
};

/** Antwort für einen Einzeldatei-Download (Content-Disposition: attachment). */
function fileResponse(body: string, filename: string, contentType: string): Response {
	return new Response(body, {
		headers: {
			"Content-Type": contentType,
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}

function buildReadme(
	doc: Awaited<ReturnType<typeof getDocument>> & object,
	series: SeriesAbbr,
	id: string,
	formats: Set<string>,
	images: boolean,
	status: {
		xmlIncluded: boolean;
		htmlIncluded: boolean;
		imageCount: number;
		// Ratsmanuale: verlinkte statt beigelegte Bilder (null = andere Serien).
		imageLinks: IIIFCanvasEntry[] | null;
		hasErrors: boolean;
	},
	baseUrl: string,
): string {
	const title = (doc.title ?? "").trim();
	const stazhIdent = (doc.stazhIdent ?? "").trim();
	const date = doc.date ?? "";
	const docUrl = `${baseUrl}/documents/${series}/${id}`;
	const heading = `${SITE_NAME} (${SITE_HOST})`;
	const lines: string[] = [heading, "Dokument-Paket", "=".repeat(heading.length), SITE_DISCLAIMER, ""];
	if (title) lines.push(`Titel:      ${title}`);
	if (stazhIdent) lines.push(`Signatur:   ${stazhIdent}`);
	if (date) lines.push(`Datum:      ${date}`);
	lines.push(`Serie:      ${series}`);
	lines.push(`URL:        ${docUrl}`);
	lines.push("");
	lines.push("Inhalt dieses Pakets:");
	lines.push("  metadata.json   - Bibliographische Metadaten");
	if (formats.has("xml")) {
		lines.push(
			status.xmlIncluded
				? "  document.xml    - TEI-XML-Quelltext"
				: "  document.xml.MISSING.txt - TEI-XML konnte nicht geladen werden",
		);
	}
	if (formats.has("txt")) lines.push("  document.txt    - Volltext (Plaintext)");
	if (status.htmlIncluded) lines.push("  document.html   - HTML-Druckansicht (im Browser öffnen, dann drucken)");
	if (images && !status.imageLinks) {
		lines.push(
			status.imageCount > 0
				? `  images/         - ${status.imageCount} Faksimile-Bild(er), Originalauflösung`
				: "  images/         - keine Bilder beigelegt (Details in errors.log)",
		);
	}
	if (status.hasErrors) {
		lines.push("  errors.log      - Hinweise zu fehlenden/unvollständigen Inhalten");
	}
	lines.push("");
	if (status.hasErrors) {
		lines.push("Hinweis: Beim Erzeugen dieses Pakets traten Probleme auf – siehe errors.log.");
		lines.push("");
	}
	if (status.imageLinks) {
		const manifest = doc.manifestUrl ?? "";
		lines.push("Faksimile (nicht beigelegt):");
		lines.push("  Die Bilder liegen auf dem Transkribus-Bildserver (files.transkribus.eu,");
		lines.push("  READ-COOP SCE) und werden nicht mitgeliefert. Sie tragen keine");
		lines.push("  Rechtekennzeichnung; die Public Domain Mark gilt nur für Text und Metadaten.");
		lines.push(`  ${rmImageCredit(doc.volumeNr)}`);
		if (manifest) lines.push(`  IIIF-Manifest: ${manifest}`);
		for (const link of status.imageLinks) lines.push(`  ${link.pageLabel}: ${link.url}`);
		lines.push("");
		lines.push("Text: maschinelle Transkription (HTR) des Staatsarchivs, Lesefehler möglich.");
		lines.push("Der Volltext (document.txt) ist die Lesefassung (aufgelöste Trennungen und");
		lines.push("Nasalstriche, ß im Wortinnern als ss); diplomatisch sind die TEI-Quelle");
		lines.push("(document.xml) und die Detailseite.");
		lines.push(`Zitiervorschlag: ${rmCitation(doc, `${baseUrl}/documents/${series}/${id}`)}`);
		lines.push("");
	}
	lines.push(`Quelle:    ${documentSource(doc.subset)}`);
	lines.push(`Plattform: ${SITE_URL} (Tim Rüdiger)`);
	lines.push(`Erzeugt:   ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
	return lines.join("\n") + "\n";
}

function buildMetadataJson(
	doc: Awaited<ReturnType<typeof getDocument>> & object,
	series: SeriesAbbr,
	id: string,
	baseUrl: string,
): string {
	const info = {
		id,
		series,
		stazhIdent: doc.stazhIdent ?? null,
		title: doc.title ?? null,
		date: doc.date ?? null,
		dateYear: doc.dateYear ?? null,
		startPg: doc.startPg ?? null,
		volumeNr: doc.volumeNr ?? null,
		serialNr: doc.serialNr ?? null,
		resolutionId: doc.resolutionId ?? null,
		archiveLink: doc.archiveLink ?? null,
		manifestUrl: doc.manifestUrl ?? null,
		url: `${baseUrl}/documents/${series}/${id}`,
		license: LICENSE,
		licenseUrl: LICENSE_URL,
		attribution: ATTRIBUTION,
		// Herkunft dieses Dokuments (Staatsarchiv bzw. publizierende Behörde der
		// Spätbestände), analog DTS dublinCore.publisher.
		publisher: documentSource(doc.subset),
		// Ratsmanuale: Bilder vom Transkribus-Bildserver, nicht beigelegt und ohne
		// Rechtekennzeichnung (license gilt für Text und Metadaten) – nur der Nachweis.
		...(series === "RM" ? { imageCredit: rmImageCredit(doc.volumeNr), imagesIncluded: false } : {}),
		exported: new Date().toISOString(),
	};
	return JSON.stringify(info, null, 2) + "\n";
}

function padWidthFor(n: number): number {
	if (n < 10) return 2;
	if (n < 100) return 3;
	return String(n).length;
}

async function loadIiifCanvases(
	manifestUrl: string,
	fetcher: typeof fetch,
	errors: string[],
): Promise<IIIFCanvasEntry[]> {
	const resolved = resolveManifestUrl(manifestUrl);
	let manifest: unknown;
	try {
		const res = await fetcher(resolved, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) {
			errors.push(`[manifest] HTTP ${res.status} – ${resolved}`);
			return [];
		}
		manifest = await res.json();
	} catch (err) {
		errors.push(`[manifest] fetch failed – ${resolved} (${(err as Error).message})`);
		return [];
	}

	if (!manifest || typeof manifest !== "object") {
		errors.push(`[manifest] response was not a JSON object – ${resolved}`);
		return [];
	}
	const m = manifest as Record<string, unknown>;
	const version: 2 | 3 = detectPresentationVersion(m);
	const sizeParam = version === 3 ? "max" : "full";

	return version === 3 ? parseV3(m, sizeParam) : parseV2(m, sizeParam);
}

/**
 * MeiliDoc.manifestUrl trägt absolute URLs, die in Prod intern via Caddy
 * proxied werden. Wir wandeln die eigenen Adressen (auch frühere: sie stehen im
 * Index) und zszh.sources-online.org auf
 * relative Pfade (analog Facsimile.svelte), damit der SvelteKit-Server-fetch
 * sie im Container per same-origin auflöst.
 *
 * `localhost`/`127.0.0.1` werden ebenfalls auf relativ umgeschrieben – passiert
 * wenn der Indexer mit PUBLIC_BASE_URL=http://localhost:5173 lief und die
 * Werte unverändert in den Meili-Index gewandert sind. Ohne diese Defensive
 * würde der Server-fetch im Container (Port 3000) gegen Port 5173 fetchen
 * und stumm fehlschlagen.
 */
const KNOWN_MANIFEST_HOSTS = new Set([
	SITE_HOST,
	...LEGACY_HOSTS,
	"zszh.sources-online.org",
	"localhost",
	"127.0.0.1",
]);

function resolveManifestUrl(raw: string): string {
	try {
		const u = new URL(raw);
		if (KNOWN_MANIFEST_HOSTS.has(u.hostname)) {
			return u.pathname + u.search;
		}
		console.warn(`[package] unknown manifest host (passing through absolute): ${u.hostname}`);
		return raw;
	} catch {
		return raw;
	}
}

function detectPresentationVersion(m: Record<string, unknown>): 2 | 3 {
	const ctx = m["@context"];
	if (typeof ctx === "string") {
		if (ctx.includes("/presentation/3")) return 3;
		if (ctx.includes("/presentation/2")) return 2;
	}
	if (Array.isArray(m.items)) return 3;
	if (Array.isArray(m.sequences)) return 2;
	return 3;
}

function parseV3(manifest: Record<string, unknown>, size: string): IIIFCanvasEntry[] {
	const out: IIIFCanvasEntry[] = [];
	const items = (manifest.items ?? []) as unknown[];
	let idx = 0;
	for (const canvas of items) {
		if (!isRecord(canvas)) continue;
		idx++;
		const pageLabel = extractLabel(canvas.label) ?? String(idx);
		const pages = (canvas.items ?? []) as unknown[];
		for (const page of pages) {
			if (!isRecord(page)) continue;
			const annos = (page.items ?? []) as unknown[];
			for (const anno of annos) {
				if (!isRecord(anno)) continue;
				const body = anno.body;
				if (!isRecord(body)) continue;
				const url = buildImageUrl(body, size);
				if (url) out.push({ url, pageLabel });
			}
		}
	}
	return out;
}

function parseV2(manifest: Record<string, unknown>, size: string): IIIFCanvasEntry[] {
	const out: IIIFCanvasEntry[] = [];
	const sequences = (manifest.sequences ?? []) as unknown[];
	let idx = 0;
	for (const seq of sequences) {
		if (!isRecord(seq)) continue;
		const canvases = (seq.canvases ?? []) as unknown[];
		for (const canvas of canvases) {
			if (!isRecord(canvas)) continue;
			idx++;
			const pageLabel = extractLabel(canvas.label) ?? String(idx);
			const imgs = (canvas.images ?? []) as unknown[];
			for (const img of imgs) {
				if (!isRecord(img)) continue;
				const resource = img.resource;
				if (!isRecord(resource)) continue;
				const url = buildImageUrl(resource, size);
				if (url) out.push({ url, pageLabel });
			}
		}
	}
	return out;
}

function buildImageUrl(resource: Record<string, unknown>, size: string): string | null {
	const service = resource.service;
	const serviceId = extractServiceId(service);
	if (serviceId) {
		return `${serviceId}/full/${size}/0/default.jpg`;
	}
	const rid = (resource["@id"] as string | undefined) ?? (resource.id as string | undefined);
	if (typeof rid === "string") {
		// Wenn rid IIIF-Pattern matched, Size-Segment umschreiben
		const rewritten = rid.replace(/\/full\/[^/]+\/(\d+\/default\.[a-zA-Z]+)$/, `/full/${size}/$1`);
		return rewritten;
	}
	return null;
}

function extractServiceId(service: unknown): string | null {
	if (!service) return null;
	if (Array.isArray(service)) {
		for (const s of service) {
			const id = extractServiceId(s);
			if (id) return id;
		}
		return null;
	}
	if (isRecord(service)) {
		const id = (service["@id"] as string | undefined) ?? (service.id as string | undefined);
		return typeof id === "string" ? id : null;
	}
	return null;
}

function extractLabel(label: unknown): string | null {
	if (!label) return null;
	if (typeof label === "string") return label;
	if (Array.isArray(label)) {
		return label.filter((x) => typeof x === "string").join(" ") || null;
	}
	if (isRecord(label)) {
		// IIIF v3 LangMap: { de: ["..."], en: ["..."] } – beliebige erste Sprache
		for (const key of Object.keys(label)) {
			const val = label[key];
			if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
				return val[0];
			}
			if (typeof val === "string") return val;
		}
	}
	return null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}
