// Personenseite eines Mitglieds des Kleinen Rats (/rat/<Personen-Id>): Kopf und Einsitze aus
// dem Register des Staatsarchivs, darunter die Ratsmanual-Sitzungen der Amtszeit (über die
// Bände ihrer Halbjahre, nicht über Daten – lib/server/ratPeople.ts).

import { error } from "@sveltejs/kit";
import { editionEntitySearchHref } from "$lib/editionRegister";
import { gndUrl, hlsUrl, rmSessionsHref, ssrqUrl } from "$lib/rat";
import { editionPersonByGnd } from "$lib/server/editionRegister";
import { ratPerson, ratSessions, ratStand } from "$lib/server/rat";
import { ratLifeSpan, ratPersonName } from "$lib/server/ratCouncil";
import { searchSurname, seatInRm, seatLabel, seatVolumes } from "$lib/server/ratPeople";
import { rmBandTable } from "$lib/server/rmBands";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url }) => {
	if (!/^\d{1,9}$/.test(params.id)) throw error(404, "Person nicht gefunden");
	const person = ratPerson(Number(params.id));
	if (!person) throw error(404, "Person nicht gefunden");

	const sort = url.searchParams.get("sort") === "date_desc" ? "date_desc" : "date_asc";
	const pageRaw = Number(url.searchParams.get("seite"));
	const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 1000 ? pageRaw : 1;

	// Dieselbe Person im Register der Editionen: über die GND.
	const [sessions, edition] = await Promise.all([
		ratSessions(person, { sort, page }),
		person.gnd ? editionPersonByGnd(person.gnd) : Promise.resolve(null),
	]);
	const bands = rmBandTable();

	return {
		person: {
			id: person.id,
			name: ratPersonName(person),
			last: person.last,
			life: ratLifeSpan(person),
			job: person.job ?? null,
			gnd: person.gnd ? gndUrl(person.gnd) : null,
			hls: person.hls ? hlsUrl(person.hls) : null,
			ssrq: person.ssrq ? ssrqUrl(person.ssrq) : null,
			editions: edition ? { pieces: edition.pieces, href: editionEntitySearchHref("person", edition.name) } : null,
		},
		seats: person.seats.map((s, i) => {
			const volumes = seatVolumes(s, bands);
			return {
				label: seatLabel(s),
				office: s.office ?? null,
				guild: s.guild ?? null,
				pages: s.pages ?? null,
				inRm: seatInRm(s),
				sessions: sessions?.perSeat[i] ?? null,
				href: volumes.length > 0 ? rmSessionsHref(volumes) : null,
			};
		}),
		sessions: sessions && {
			total: sessions.total,
			page: Math.min(sessions.page, sessions.pages),
			pages: sessions.pages,
			hits: sessions.hits,
			searchHref: rmSessionsHref(sessions.volumes),
			// Nachname im Text dieser Sitzungen – Familien wiederholen Namen, darum nur als Suche.
			surname: searchSurname(person.last),
			nameHref: rmSessionsHref(sessions.volumes, searchSurname(person.last)),
		},
		sort,
		stand: ratStand(),
	};
};
