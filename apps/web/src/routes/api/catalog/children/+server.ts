// GET /api/catalog/children?parent=<ID>&offset=<n> – Untereinheiten einer Stufe des
// Archivplans für den Archivbaum der Katalogseiten (intern, nicht Teil von /api/v1).
// Reihenfolge wie im Archivplan, je Abruf CATALOG_TREE_PAGE Einheiten.

import { json } from "@sveltejs/kit";
import { CATALOG_TREE_PAGE } from "$lib/catalog";
import { catalogReady, getCatalogChildren } from "$lib/server/catalog";
import type { RequestHandler } from "./$types";

const OFFSET_MAX = 1_000_000;

export const GET: RequestHandler = async ({ url }) => {
	const parent = url.searchParams.get("parent") ?? "";
	const offsetRaw = url.searchParams.get("offset") ?? "0";
	if (!/^\d{1,9}$/.test(parent) || !/^\d{1,7}$/.test(offsetRaw) || Number(offsetRaw) > OFFSET_MAX) {
		return json({ error: "invalid_parameter" }, { status: 400 });
	}
	if (!(await catalogReady())) return json({ error: "catalog_unavailable" }, { status: 503 });
	const children = await getCatalogChildren(Number(parent), Number(offsetRaw), CATALOG_TREE_PAGE);
	if (!children) return json({ error: "tree_unavailable" }, { status: 503 });
	return json(children, { headers: { "cache-control": "private, max-age=300" } });
};
