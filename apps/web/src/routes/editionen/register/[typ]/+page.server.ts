// Register der Editionen (/editionen/register/personen|orte|organisationen): die Namen aus den
// Registern der Editionen, wie sie an den Stücken stehen, häufigste zuerst, mit Suche. Jeder
// Eintrag führt in den Reiter «Editionen», gefiltert auf den Namen. Wie die Detailseiten der
// Stücke nicht für Suchmaschinen: das Register der Edition steht in der Edition selbst. Personen,
// deren GND auch das Register des Kleinen Rats nennt, verweisen auf dessen Personenseite.

import { error } from "@sveltejs/kit";
import { parseRegisterQuery, registerKindBySlug } from "$lib/catalogRegister";
import { ratPersonUrl } from "$lib/rat";
import { editionRegisterPage } from "$lib/server/editionRegister";
import { editionsReady } from "$lib/server/editionTexts";
import { ratPersonByGnd } from "$lib/server/rat";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	const info = registerKindBySlug(params.typ);
	if (!info) error(404, "Register nicht gefunden");
	if (!(await editionsReady())) error(503, "Die Editionen sind zurzeit nicht verfügbar.");
	setHeaders({ "x-robots-tag": "noindex, follow" });
	const query = parseRegisterQuery(url.searchParams);
	const page = await editionRegisterPage(info, query);
	if (!page) error(503, "Das Register ist zurzeit nicht verfügbar.");
	const entries = page.entries.map((e) => {
		const rat = info.kind === "person" && e.gnd ? ratPersonByGnd(e.gnd) : null;
		return { ...e, ratHref: rat ? ratPersonUrl(rat.id) : null };
	});
	return { kind: info.kind, slug: info.slug, query, ...page, entries };
};
