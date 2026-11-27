// IIIF-Manifest (Presentation 3) eines Editionsstücks: je Seite mit Bild ein Canvas, Bild
// direkt vom Bildserver der Edition (media.sources-online.org, bei einigen Stücken
// e-manuscripta.ch der Zentralbibliothek Zürich). Die Edition hat keine Manifeste; Grösse
// und Bilddienst stehen im Index (`facs`, beim Aufbau aus info.json bzw. dem Manifest von
// e-manuscripta geholt). Gebaut je Anfrage, keine Dateien auf dem Server.

import { error, json } from "@sveltejs/kit";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { getEditionUnit } from "$lib/server/editionTexts";
import { editionManifest, editionUnitPath, isIndexedEdition } from "$lib/editionTexts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, url }) => {
	if (!isIndexedEdition(params.edition)) error(404, "Edition nicht gefunden");
	const unit = await getEditionUnit(params.edition, params.id);
	if (!unit || unit.facs.length === 0) error(404, "Kein Faksimile");
	const base = apiBaseUrl(url);
	return json(editionManifest(unit, `${base}${editionUnitPath(unit.edition, unit.localId)}`), {
		headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*", "x-robots-tag": "noindex" },
	});
};
