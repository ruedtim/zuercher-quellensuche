// GET /api/dts/navigation{?resource,ref,start,end,down,tree,page} –
// DTS-Navigation-Endpoint. Liefert die (flache) Zitierstruktur eines
// Dokuments: genau eine CitableUnit auf Dokument-Ebene.

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { buildNavigationResponse } from "$lib/server/dts/navigation";
import { isParamError, parseNavigationQuery } from "$lib/server/dts/params";
import { dtsError, dtsMethodNotAllowed, dtsRoute, jsonld } from "$lib/server/dts/serialize";

export const GET: RequestHandler = dtsRoute(async ({ url }) => {
	const parsed = parseNavigationQuery(url);
	if (isParamError(parsed)) return dtsError(400, parsed.code, parsed.message);

	const base = apiBaseUrl(url);
	const selfUrl = `${base}${url.pathname}${url.search}`;
	const result = await buildNavigationResponse(base, selfUrl, parsed);
	if (result.kind === "error") return dtsError(result.status, result.code, result.message);
	return jsonld(result.body, { "cache-control": "public, max-age=300" });
});

export const fallback: RequestHandler = dtsRoute(async () => dtsMethodNotAllowed());
