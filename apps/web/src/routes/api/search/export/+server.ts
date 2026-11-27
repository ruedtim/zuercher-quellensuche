import { parseSearchParams } from "$lib/searchParams";
import { CORPUS_CAP } from "$lib/types";
import { exportCap, exportableCount, parseExportContent, parseExportFormat } from "$lib/exportLimits";
import { executeSearch } from "$lib/server/search";
import { isEmbedderHealthy } from "$lib/server/embed";
import { entityKeysReadyNow, fetchDocsByIds } from "$lib/server/meili";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { tryAcquireExport } from "$lib/server/exportGate";
import { SLOW_ID_PASS_MS, runIdPass } from "$lib/server/exportIdPass";
import { createExportStream, type ExportJob } from "$lib/server/exportStream";
import {
	dedupeIds,
	exportBaseName,
	exportFileExtension,
	exportTitle,
	reproducibleSearchUrl,
} from "$lib/server/exportFormat";
import { XLSX_CONTENT_TYPE } from "$lib/server/xlsx";
import { clientKey } from "$lib/server/clientKey";
import { clientGone } from "$lib/server/responseBody";
import { exportPayload } from "$lib/server/analytics/extract";
import type { RequestHandler } from "./$types";

// Treffer-Export («Alle Treffer herunterladen» auf der Suchseite):
//   GET /api/search/export?<Such-Params wie /search>&content=table|text|iiif&format=csv|xlsx
// Liefert die Treffermenge der Suche in der Reihenfolge der Trefferliste – als
// Tabelle (CSV/XLSX) oder ZIP mit Volltexten (+ IIIF-Sammlung). Ablauf:
//   1. Schutz: eigener Rate-Limit-Bucket + Slots (exportGate)
//   2. ID-Pass: executeSearch im lean-Modus, EIN grosses Fenster (gleiche
//      Routing-Zweige wie die Trefferliste ⇒ gleiche Reihenfolge)
//   3. Stream: Felder batchweise aus Meili, so schnell wie der Client liest
// Fehler vor dem Stream kommen als text/plain – die Suchseite lädt den Export
// in einem versteckten iframe und zeigt den Text im Popup an.

const HEADERS_NO_STORE = { "Cache-Control": "no-store" };

function textResponse(status: number, message: string, headers: Record<string, string> = {}): Response {
	return new Response(`${message}\n`, {
		status,
		headers: { "Content-Type": "text/plain; charset=utf-8", ...HEADERS_NO_STORE, ...headers },
	});
}

// HEAD würde SvelteKit sonst an GET weiterreichen und den ganzen Export
// erzeugen (Node verwirft den Body nur) – Download-Manager fragen gern HEAD.
export const HEAD: RequestHandler = () =>
	new Response(null, { status: 405, headers: { Allow: "GET", ...HEADERS_NO_STORE } });

export const GET: RequestHandler = async ({ url, request, getClientAddress, locals }) => {
	const content = parseExportContent(url.searchParams.get("content"));
	const format = parseExportFormat(url.searchParams.get("format") ?? "csv");
	if (!content || !format) {
		return textResponse(400, "Ungültige Auswahl für den Download (content=table|text|iiif, format=csv|xlsx).");
	}
	const params = parseSearchParams(url);

	const gate = tryAcquireExport(content === "table" ? "table" : "text", clientKey(request, getClientAddress));
	if (!gate.ok) {
		return textResponse(gate.status, gate.message, { "Retry-After": String(gate.retryAfterS) });
	}

	let handedOver = false;
	try {
		const semanticAvailable = params.theme.trim() ? await isEmbedderHealthy() : false;
		// Kalter Meili-Cache ⇒ langsamer, evtl. still abgeschnittener Lauf ⇒ einmal
		// wiederholen; bleibt ein Thema-Ranking abgeschnitten ⇒ 503 (s. exportIdPass).
		const idPass = await runIdPass(async () => {
			const t0 = Date.now();
			const result = await executeSearch(
				{ ...params, page: 1, pageSize: exportCap(content) },
				{
					semanticAvailable,
					lexicalStrict: true,
					lean: true,
					// date/startPg: die Top-K-/ODER-Pfade sortieren in JS nach Datum
					attributesToRetrieve: ["id", "date", "startPg"],
					hybridLimit: CORPUS_CAP,
				},
			);
			return { result, ms: Date.now() - t0 };
		});
		if (!idPass.ok) {
			console.warn(
				`[export] ${content}/${format} abgelehnt: Thema-Ranking zweimal abgeschnitten ` +
					`(${idPass.firstMs}ms, ${idPass.secondMs}ms, semanticHitCount=0)`,
			);
			return textResponse(
				503,
				"Der Suchserver ist gerade ausgelastet – die Reihenfolge nach Thema liess sich nicht vollständig berechnen. Bitte versuchen Sie es in einer Minute erneut.",
				{ "Retry-After": "60" },
			);
		}
		// Während des ID-Passes getrennt: nichts mehr beginnen (der Platz wird unten frei).
		if (request.signal.aborted) return clientGone();
		const { result, ms } = idPass.run;
		const planned = exportableCount(content, result);
		const ids = dedupeIds(result.hits.map((h) => h.id)).slice(0, planned.count);
		console.info(
			`[export] ${content}/${format} ids=${ids.length} total=${planned.total} scope=${planned.scope} ` +
				`idPass=${ms}ms meili=${result.processingTimeMs}ms` +
				(result.semanticHitCount != null ? ` semantic=${result.semanticHitCount}` : "") +
				(idPass.retried ? ` (2. Versuch, erster ${idPass.firstMs}ms)` : ""),
		);
		if (idPass.retried && ms >= SLOW_ID_PASS_MS) {
			// Nicht prüfbar (Meili meldet den Abbruch nicht): Ende der Liste evtl. ungerankt.
			console.warn(`[export] ${content}/${format} auch 2. ID-Pass langsam (${ms}ms) – Reihenfolge am Ende evtl. ungerankt`);
		}
		if (ids.length === 0) {
			return textResponse(404, "Diese Suche hat keine Treffer – es gibt nichts herunterzuladen.");
		}

		const base = apiBaseUrl(url);
		const now = new Date();
		const baseName = exportBaseName(params, now);
		const searchUrl = reproducibleSearchUrl(params, base);
		const job: ExportJob = {
			ids,
			content,
			format,
			baseUrl: base,
			rootName: baseName,
			readme: {
				content,
				format,
				params,
				entityKeys: entityKeysReadyNow(),
				searchUrl,
				baseUrl: base,
				planned: { ...planned, count: ids.length },
				generatedAt: now,
			},
			collection: {
				id: `${searchUrl}#iiif-collection`,
				label: exportTitle(params),
				summary: `Faksimiles der Treffer dieser Suche: ${searchUrl}`,
			},
		};
		const started = Date.now();
		const body = createExportStream(job, {
			fetchDocs: (batch, fields, signal) => fetchDocsByIds(batch, fields, signal),
			signal: request.signal,
			release: gate.release,
			onFinish: (s) =>
				console.info(
					`[export] ${content}/${format} ${s.error ? `abgebrochen (${s.error})` : "fertig"}: ` +
						`${s.exported}/${ids.length} Dokumente, fehlend=${s.missing}, text=${Math.round(s.textBytes / 1024)} KiB, ` +
						`${Date.now() - started}ms${s.stoppedByBudget ? ", Budget erreicht" : ""}`,
				),
		});
		handedOver = true;

		locals.analytics.export = exportPayload(params, {
			content,
			format,
			n: ids.length,
			total: planned.total,
			scope: planned.scope,
		});

		const contentType =
			content !== "table" ? "application/zip" : format === "xlsx" ? XLSX_CONTENT_TYPE : "text/csv; charset=utf-8";
		return new Response(body, {
			headers: {
				"Content-Type": contentType,
				"Content-Disposition": `attachment; filename="${baseName}.${exportFileExtension(content, format)}"`,
				// Gestreamt: nginx soll nicht puffern (proxy_buffering ist ohnehin aus)
				"X-Accel-Buffering": "no",
				...HEADERS_NO_STORE,
			},
		});
	} catch (err) {
		console.error("[export] ID-Pass fehlgeschlagen:", err);
		return textResponse(500, "Der Download konnte nicht erstellt werden. Bitte versuchen Sie es später erneut.");
	} finally {
		if (!handedOver) gate.release();
	}
};
