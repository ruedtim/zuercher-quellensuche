// GET /api/dts/document{?resource,ref,start,end,tree,mediaType} –
// DTS-Document-Endpoint. Liefert das Original-TEI/XML (Default), best effort
// auch text/html (vorgerendert) und text/plain (Body). buildDocumentResponse
// baut die fertige Response selbst (TEI/XML statt JSON-LD).

import type { RequestHandler } from "./$types";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { buildDocumentResponse } from "$lib/server/dts/document";
import { isParamError, parseDocumentQuery } from "$lib/server/dts/params";
import { dtsError, dtsMethodNotAllowed, dtsRoute } from "$lib/server/dts/serialize";

export const GET: RequestHandler = dtsRoute(async ({ url }) => {
	const parsed = parseDocumentQuery(url);
	if (isParamError(parsed)) return dtsError(400, parsed.code, parsed.message);
	return buildDocumentResponse(apiBaseUrl(url), parsed);
});

export const fallback: RequestHandler = dtsRoute(async () => dtsMethodNotAllowed());
