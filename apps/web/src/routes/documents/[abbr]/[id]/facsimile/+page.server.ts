import { error } from "@sveltejs/kit";
import { documentMeta } from "$lib/server/documentResult";
import { getDocument } from "$lib/server/meili";
import { ALL_SERIES, type SeriesAbbr } from "$lib/types";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
	const series = params.abbr as SeriesAbbr;
	if (!ALL_SERIES.includes(series)) {
		throw error(404, "Unbekannte Serie");
	}

	const doc = await getDocument(params.id);
	if (!doc) {
		throw error(404, "Dokument nicht gefunden");
	}
	if (!doc.manifestUrl) {
		throw error(404, "Kein Faksimile verfügbar");
	}

	return { doc: documentMeta(doc) };
};
