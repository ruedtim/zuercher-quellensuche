// GET /api/v1 – Index/Einstiegspunkt der öffentlichen API.

import type { RequestHandler } from "./$types";
import { apiBaseUrl, API_V1_RATE_LIMIT } from "$lib/server/apiV1/config";
import { API_V1_VERSION, BULK_DOCS_FRAGMENT, DOCS_PATH, RATE_WINDOW_S_DEFAULT } from "$lib/server/apiV1/constants";
import { SITE_NAME } from "$lib/site";
import { apiRoute, methodNotAllowed, ok } from "$lib/server/apiV1/respond";

export const GET: RequestHandler = apiRoute(async ({ url }) => {
	const base = apiBaseUrl(url);
	return ok(
		{
			name: `${SITE_NAME} – API`,
			version: API_V1_VERSION,
			baseUrl: `${base}/api/v1`,
			documentation: `${base}${DOCS_PATH}`,
			openapi: `${base}/api/v1/openapi.json`,
			reference: `${base}/api-doc`,
			// DTS-1.0-konforme Schwester-API (JSON-LD + TEI, eigener Vertrag).
			dts: `${base}/api/dts`,
			// Remote-MCP-Server (Streamable HTTP, JSON-RPC) für agentische KI.
			mcp: `${base}/api/mcp`,
			endpoints: {
				documents: `${base}/api/v1/documents`,
				document: `${base}/api/v1/documents/{id}`,
				similar: `${base}/api/v1/documents/{id}/similar`,
				series: `${base}/api/v1/series`,
				facets: `${base}/api/v1/facets/{dim}`,
				stats: `${base}/api/v1/stats`,
				// Verzeichnungseinheiten des Staatsarchiv-Katalogs (eigene Quelle, ohne Lizenzangabe).
				catalog: `${base}/api/v1/catalog`,
				catalogUnit: `${base}/api/v1/catalog/{id}`,
				// Eheeinträge der Ehedatenbank des Staatsarchivs (eigene Quelle, CC BY 4.0).
				ehedaten: `${base}/api/v1/ehedaten`,
				ehedatenEntry: `${base}/api/v1/ehedaten/{id}`,
				// Stücke der Editionen des Staatsarchivs (QZH; Lizenz je Edition, QZH CC BY 4.0).
				editions: `${base}/api/v1/editions`,
				editionPiece: `${base}/api/v1/editions/{edition}/{id}`,
			},
			rateLimit: `${API_V1_RATE_LIMIT} requests per ${RATE_WINDOW_S_DEFAULT} s per client`,
			bulkData: `${base}${DOCS_PATH}${BULK_DOCS_FRAGMENT}`,
		},
		{},
		null,
		{ "cache-control": "public, max-age=3600" },
	);
});

export const fallback: RequestHandler = apiRoute(async () => methodNotAllowed());
