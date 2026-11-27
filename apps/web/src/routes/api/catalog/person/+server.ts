// GET /api/catalog/person?id=<KRDB-ID> – Einheiten des Archivkatalogs mit gleichem Namen wie
// eine Person (Vorschläge, `krdbNameIds`, nicht geprüft) für die Personenseite. Intern, nicht
// Teil von /api/v1. Die Seite lädt die Liste erst auf Klick: Personenseiten werden indexiert,
// ungeprüfte Namensgleichheiten sollen nicht in ihrem HTML stehen.

import { json } from "@sveltejs/kit";
import { PERSON_CATALOG_MAX } from "$lib/catalog";
import { catalogReady, personCatalogUnits } from "$lib/server/catalog";
import { resolveKrdbPerson } from "$lib/server/krdb";
import { personIds } from "$lib/server/krdbPeople";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get("id") ?? "";
	if (!/^\d{1,9}$/.test(raw)) return json({ error: "invalid_parameter" }, { status: 400 });
	const found = resolveKrdbPerson(Number(raw));
	if (!found) return json({ error: "not_found" }, { status: 404 });
	if (!(await catalogReady())) return json({ error: "catalog_unavailable" }, { status: 503 });
	const names = await personCatalogUnits(personIds(found.person), "names", PERSON_CATALOG_MAX);
	if (!names) return json({ error: "catalog_unavailable" }, { status: 503 });
	return json(names, { headers: { "cache-control": "private, max-age=300", "x-robots-tag": "noindex" } });
};
