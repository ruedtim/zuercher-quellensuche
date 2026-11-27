// Detailseite eines Editionsstücks (/editionen/<edition>/<id>, Index `editions`: QZH und
// Zürcher Rechtsquellen): Kopf mit Datum, Vorlage (Archivkatalog der Plattform, sonst
// Online-Katalog), weitere Überlieferungen, Bearbeitung, Permalink der Edition,
// Zitiervorschlag und Lizenz; Regest, Text mit Anmerkungen, Kommentar, Personen, Orte,
// Schlagwörter und Faksimile (Manifest aus manifest.json/+server.ts). Steht der Eintrag in
// einer Ratsmanual-Sitzung der Plattform (Querverweise, edition-links.json, auch über eine
// weitere Überlieferung), führt ein Link auf deren HTR-Text.
// Nicht für Suchmaschinen (wie die Katalogseiten): das Original ist die Edition selbst.

import { error, redirect } from "@sveltejs/kit";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { catalogReady, existingCatalogIds } from "$lib/server/catalog";
import { rmDocumentsForEditionText } from "$lib/server/editionLinks";
import { editionNeighbors, editionsReady, getEditionUnit } from "$lib/server/editionTexts";
import { editionTextIds, editionUnitPath, isIndexedEdition } from "$lib/editionTexts";
import { ratPersonUrl } from "$lib/rat";
import { ratPersonByGnd } from "$lib/server/rat";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	if (!isIndexedEdition(params.edition)) error(404, "Edition nicht gefunden");
	if (!(await editionsReady())) error(503, "Die Editionen sind zurzeit nicht verfügbar.");
	const unit = await getEditionUnit(params.edition, params.id);
	if (!unit) error(404, "Stück nicht gefunden");
	// Kennung eines Texts der Rechtsquellen («…_047_1», «…_047_2») ⇒ Seite des Stücks.
	if (unit.localId !== params.id) redirect(301, `${editionUnitPath(unit.edition, unit.localId)}${url.search}`);
	setHeaders({ "x-robots-tag": "noindex, follow" });
	const vorlagen = [...new Set([...unit.catalogIds, ...unit.witnesses.flatMap((w) => w.catalogIds)])];
	const [neighbors, known] = await Promise.all([
		editionNeighbors(unit),
		(async () => ((await catalogReady()) ? existingCatalogIds(vorlagen) : new Set<number>()))(),
	]);
	const path = editionUnitPath(unit.edition, unit.localId);
	return {
		unit,
		neighbors,
		// Vorlagen (auch der weiteren Überlieferungen) mit eigener Seite im Archivkatalog der
		// Plattform (sonst Online-Katalog).
		catalogOwn: vorlagen.filter((id) => known.has(id)),
		// Ratsmanual-Sitzungen der Plattform, in denen der Eintrag steht (HTR-Text, Faksimile).
		rmDocs: [...new Set(editionTextIds(unit).flatMap((t) => rmDocumentsForEditionText(t)))].sort(),
		// Personen, deren GND auch das Register des Kleinen Rats nennt: GND → Personenseite.
		ratHrefs: Object.fromEntries(
			unit.persons.flatMap((p) => {
				const rat = p.gnd ? ratPersonByGnd(p.gnd) : null;
				return rat && p.gnd ? [[p.gnd, ratPersonUrl(rat.id)]] : [];
			}),
		) as Record<string, string>,
		fromSearch: url.searchParams.get("from"),
		pageUrl: `${apiBaseUrl(url)}${path}`,
		manifestUrl: unit.facs.length > 0 ? `${path}/manifest.json` : null,
	};
};
