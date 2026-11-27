// Register des Archivkatalogs (/archivkatalog/register/personen|orte|organisationen): die
// Namen, die der Katalog-Aufbau an den Verzeichnungseinheiten erkannt hat, häufigste
// zuerst, mit Suche. Jeder Eintrag führt in die gefilterte Katalogsuche; wo die Dokumente
// denselben Namen kennen, zusätzlich in die Dokumentsuche (gestreamt, blockiert die Seite
// nicht). Wie alle Katalogseiten nicht für Suchmaschinen (Entscheid 2026-10-28).

import { error } from "@sveltejs/kit";
import { parseRegisterQuery, registerKindBySlug } from "$lib/catalogRegister";
import { catalogReady } from "$lib/server/catalog";
import { registerDocLinks, registerPage } from "$lib/server/catalogRegister";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	const info = registerKindBySlug(params.typ);
	if (!info) error(404, "Register nicht gefunden");
	if (!(await catalogReady())) error(503, "Der Archivkatalog ist zurzeit nicht verfügbar.");
	setHeaders({ "x-robots-tag": "noindex, follow" });
	const query = parseRegisterQuery(url.searchParams);
	const page = await registerPage(info, query);
	if (!page) error(503, "Das Register ist zurzeit nicht verfügbar.");
	return {
		kind: info.kind,
		slug: info.slug,
		query,
		...page,
		docLinks: registerDocLinks(info.kind, [...page.entries, ...page.constants]),
	};
};
