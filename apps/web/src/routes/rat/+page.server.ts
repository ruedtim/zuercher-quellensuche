// Verzeichnis des Kleinen Rats (/rat), eines der Register (Übersicht /register): alle Personen
// des Registers «Der Kleine Rat des Stadtstaats Zürich 1225–1798» mit Namenssuche und Filtern
// nach Zunft, Funktion, Jahrhundert und Zeit der Ratsmanuale. Liegt ganz im Speicher.

import { RAT_DIRECTORY_PAGE_SIZE, parseRatDirectoryQuery } from "$lib/rat";
import { ratPersons, ratStand } from "$lib/server/rat";
import { hasRmSeat, ratLifeSpan, ratPersonName } from "$lib/server/ratCouncil";
import { filterRatDirectory, seatSummary, seatValueOptions } from "$lib/server/ratPeople";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
	const query = parseRatDirectoryQuery(url.searchParams);
	const persons = ratPersons();
	const filtered = filterRatDirectory(persons, query);
	const pages = Math.max(1, Math.ceil(filtered.length / RAT_DIRECTORY_PAGE_SIZE));
	const page = Math.min(query.page, pages);
	return {
		query,
		page,
		pages,
		total: filtered.length,
		size: persons.length,
		guilds: seatValueOptions(persons, "guild"),
		offices: seatValueOptions(persons, "office"),
		stand: ratStand(),
		items: filtered.slice((page - 1) * RAT_DIRECTORY_PAGE_SIZE, page * RAT_DIRECTORY_PAGE_SIZE).map((p) => ({
			id: p.id,
			name: ratPersonName(p),
			life: ratLifeSpan(p),
			summary: seatSummary(p, 2),
			rm: hasRmSeat(p),
		})),
	};
};
