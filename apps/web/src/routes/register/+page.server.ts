// Übersicht der Register (/register, Menüpunkt «Register»): die Register aller Quellen in der
// Reihenfolge der Reiter und eine Namenssuche über alle zugleich (?q=). Die Rats- und
// Regierungsmitglieder und das Register der Editionen liegen im Speicher und kommen sofort;
// Archivkatalog und Ehedaten fragen Meili und werden nachgestreamt (Zeitbudget), damit die
// Seite nie auf sie wartet. Logik und Begriffe in $lib/registerHub.ts.

import { REGISTER_KINDS } from "$lib/catalogRegister";
import { NO_EHEDATEN_FILTERS, nameTokens } from "$lib/ehedaten";
import { placeKey } from "$lib/entityKey";
import { DEFAULT_DIRECTORY_QUERY, type DirectoryQuery } from "$lib/personUrls";
import { HUB_KRDB_PREVIEW, HUB_PREVIEW, HUB_RAT_PREVIEW, parseHubQuery } from "$lib/registerHub";
import { DEFAULT_RAT_DIRECTORY_QUERY } from "$lib/rat";
import { ratPersons } from "$lib/server/rat";
import { ratLifeSpan, ratPersonName } from "$lib/server/ratCouncil";
import { filterRatDirectory, seatSummary } from "$lib/server/ratPeople";
import { catalogReady } from "$lib/server/catalog";
import { registerPreview, type RegisterEntry } from "$lib/server/catalogRegister";
import { editionRegister, editionRegisterPreview } from "$lib/server/editionRegister";
import { editionsReady } from "$lib/server/editionTexts";
import { countEhedaten, ehedatenReady } from "$lib/server/ehedaten";
import { docCountOf, krdbDocCountsNow, krdbRegisterPersons } from "$lib/server/krdb";
import { lifespanOf } from "$lib/server/krdbMatch";
import { filterDirectory, officeLines, partyLines, personName } from "$lib/server/krdbPeople";
import type { EntityKind } from "$lib/entityKey";
import type { PageServerLoad } from "./$types";

/** So lange wartet ein nachgestreamter Block höchstens (sonst «zurzeit nicht verfügbar»). */
const BUDGET_MS = 10_000;

async function withinBudget<T>(what: string, work: Promise<T>): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			console.warn(`[register] ${what}: über ${BUDGET_MS} ms`);
			resolve(null);
		}, BUDGET_MS);
	});
	try {
		return await Promise.race([work.catch((err) => (console.warn(`[register] ${what}: ${(err as Error).message}`), null)), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

type CatalogPreview = Record<EntityKind, { entries: RegisterEntry[]; total: number; capped: boolean } | null>;

async function catalogPreview(q: string): Promise<CatalogPreview> {
	const parts = await Promise.all(REGISTER_KINDS.map((info) => registerPreview(info, q, HUB_PREVIEW)));
	return { person: parts[0], place: parts[1], org: parts[2] };
}

/** Eheeinträge mit dem Namen bei Bräutigam oder Braut bzw. mit ihm als Herkunft (wie die
 *  geteilten Felder Personen und Orte im Reiter «Ehedaten»); null bei einem Fehler. */
async function ehedatenPreview(q: string): Promise<{ persons: number | null; places: number | null }> {
	const base = { q: "", anyTerms: [], titleOnly: false, dateFrom: null, dateTo: null, persons: [], places: [] };
	const [persons, places] = await Promise.all([
		nameTokens(q).length > 0 ? countEhedaten({ ...base, persons: [q] }, NO_EHEDATEN_FILTERS) : 0,
		placeKey(q) ? countEhedaten({ ...base, places: [q] }, NO_EHEDATEN_FILTERS) : 0,
	]);
	return { persons, places };
}

export const load: PageServerLoad = async ({ url }) => {
	const q = parseHubQuery(url.searchParams);
	const [catalog, ehedaten, editions] = await Promise.all([catalogReady(), ehedatenReady(), editionsReady()]);
	const editionReg = editions ? await editionRegister() : null;
	const krdbPersons = krdbRegisterPersons();
	const counts = krdbDocCountsNow();

	// Rats- und Regierungsmitglieder wie das Verzeichnis /personen mit «auch Personen ohne
	// Dokumente» – ein Registereintrag auch ohne zugeordnetes Protokoll –, sortiert nach Zahl der
	// Dokumente, sobald sie vorliegt (sonst nach Name).
	const directory: DirectoryQuery = { ...DEFAULT_DIRECTORY_QUERY, q, withDocs: false, sort: counts ? "docs" : "name" };
	const nowYear = new Date().getUTCFullYear();
	const krdb = q
		? (() => {
				const found = filterDirectory(krdbPersons, directory, counts?.all ?? null);
				return {
					total: found.length,
					entries: found.slice(0, HUB_KRDB_PREVIEW).map((p) => ({
						id: p.id,
						name: personName(p),
						lifespan: lifespanOf(p, nowYear),
						office: officeLines(p)
							.slice(0, 2)
							.map((o) => `${o.label} ${o.years}`),
						party: partyLines(p).at(-1)?.party ?? null,
						docs: docCountOf(counts, p.id),
					})),
				};
			})()
		: null;

	// Kleiner Rat 1225–1798 (Register des Staatsarchivs), ebenfalls im Speicher.
	const ratAll = ratPersons();
	const ratDirectory = { ...DEFAULT_RAT_DIRECTORY_QUERY, q };
	const rat = q
		? (() => {
				const found = filterRatDirectory(ratAll, ratDirectory);
				return {
					total: found.length,
					entries: found.slice(0, HUB_RAT_PREVIEW).map((p) => ({
						id: p.id,
						name: ratPersonName(p),
						life: ratLifeSpan(p),
						summary: seatSummary(p, 2),
					})),
				};
			})()
		: null;

	return {
		q,
		available: { catalog, ehedaten, editions: editionReg !== null, krdb: krdbPersons.length > 0, rat: ratAll.length > 0 },
		sizes: {
			krdb: krdbPersons.length,
			rat: ratAll.length,
			editions: editionReg
				? { person: editionReg.person.entries.length, place: editionReg.place.entries.length, org: editionReg.org.entries.length, pieces: editionReg.pieces }
				: null,
		},
		directory,
		krdb,
		ratDirectory,
		rat,
		editions: q && editionReg ? await editionRegisterPreview(q, HUB_PREVIEW) : null,
		// Nachgestreamt (Meili): die Seite steht, bevor sie da sind.
		catalog: q && catalog ? withinBudget(`Archivkatalog «${q}»`, catalogPreview(q)) : null,
		ehedaten: q && ehedaten ? withinBudget(`Ehedaten «${q}»`, ehedatenPreview(q)) : null,
	};
};
