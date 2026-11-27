// Wer sass in dieser Ratssitzung im Rat? Register des Kleinen Rats
// (data/rat-register.json, gebaut von services/rat) + Bandtabelle: Der Band
// einer Sitzung nennt Jahr und Halbjahresrat, das Register die Mitglieder.
//
// Gebündelt als `?raw` wie das KRDB-Register, damit svelte-check aus dem JSON
// keinen Literaltyp ableitet; geparst beim ersten Zugriff. Ist die Datei kaputt,
// bleibt der Reiter «Rat» einfach weg.
//
// Logik und Typen liegen pur in ratCouncil.ts, Nennung und Links in $lib/rat.

import registerRaw from "./data/rat-register.json?raw";
import { councilAt, ratLifeSpan, ratPersonName, type RatPerson, type RatRegister } from "./ratCouncil";
import { personVolumes, ratMentionViews, seatVolumes, type RatMentionView } from "./ratPeople";
import { rmBandFor, rmBandTable } from "./rmBands";
import { countDocs, searchDocuments } from "./meili";
import { gndUrl, hlsUrl, personRefsInHtml, ssrqUrl } from "$lib/rat";

export type { RatMentionView };
import { DEFAULT_SEARCH } from "$lib/types";

/** Ein Mitglied, wie die Detailseite es zeigt. */
export interface RatMemberView {
	id: number;
	name: string;
	/** «1759–1856», «* 1759» oder leer. */
	life: string;
	job: string | null;
	office: string | null;
	guild: string | null;
	/** Jahre dieses Einsitzes («1644–1655» bzw. «1650»). */
	years: string;
	/** Belegstelle bei Schnyder. */
	pages: string | null;
	gnd: string | null;
	hls: string | null;
	/** Personendatenbank der Rechtsquellen. */
	ssrq: string | null;
}

export interface RatCouncilView {
	/** «Natalrat 1650». */
	label: string;
	year: number;
	half: 1 | 2;
	members: RatMemberView[];
	/** Stand des Registers (Datum des Abzugs). */
	stand: string;
}

interface RatState {
	persons: RatPerson[];
	/** Stand des Abzugs, aus dem das Register gebaut wurde. */
	built: string;
}

let state: RatState | undefined;

function load(): RatState {
	if (state) return state;
	try {
		const register = JSON.parse(registerRaw) as RatRegister;
		state = { persons: Array.isArray(register.persons) ? register.persons : [], built: register.meta?.built ?? "" };
	} catch (err) {
		console.warn("[rat] Register nicht lesbar – kein Reiter «Rat»:", err);
		state = { persons: [], built: "" };
	}
	return state;
}

/**
 * Der Rat zur Sitzung. Null, wenn das Dokument keine Ratsmanual-Sitzung ist
 * oder ihr Band kein Halbjahr nennt: 15 ganzjährige Bände und die
 * Sonderbände 1545–1547 lassen offen, welcher der beiden Räte tagte
 * (2,6 % der Sitzungen). Lieber kein Reiter als der falsche Rat.
 */
export function ratCouncilFor(docId: string): RatCouncilView | null {
	const band = rmBandFor(docId);
	const half = band?.band.half;
	if (!band || (half !== 1 && half !== 2)) return null;
	const { persons, built } = load();
	const year = band.band.year;
	const members = councilAt(persons, year, half).map(({ person, seat }) => ({
		id: person.id,
		name: ratPersonName(person),
		life: ratLifeSpan(person),
		job: person.job ?? null,
		office: seat.office ?? null,
		guild: seat.guild ?? null,
		years: seat.from === seat.to ? String(seat.from) : `${seat.from}–${seat.to}`,
		pages: seat.pages ?? null,
		gnd: person.gnd ? gndUrl(person.gnd) : null,
		hls: person.hls ? hlsUrl(person.hls) : null,
		ssrq: person.ssrq ? ssrqUrl(person.ssrq) : null,
	}));
	if (members.length === 0) return null;
	return { label: band.label ?? `${half === 1 ? "Natalrat" : "Baptistalrat"} ${year}`, year, half, members, stand: built };
}

// --- Personenseiten und Verzeichnis ---------------------------------------------

/** Alle Personen des Registers (nach Personen-Id). */
export function ratPersons(): readonly RatPerson[] {
	return load().persons;
}

let byId: Map<number, RatPerson> | undefined;

export function ratPerson(id: number): RatPerson | null {
	if (!byId) byId = new Map(load().persons.map((p) => [p.id, p]));
	return byId.get(id) ?? null;
}

let byGnd: Map<string, RatPerson> | undefined;

/** Person mit dieser GND-Nummer (ohne URL); bei doppelter GND die erste des Registers. */
export function ratPersonByGnd(gnd: string): RatPerson | null {
	if (!byGnd) {
		byGnd = new Map();
		for (const p of load().persons) if (p.gnd && !byGnd.has(p.gnd)) byGnd.set(p.gnd, p);
	}
	return byGnd.get(gnd) ?? null;
}

let bySsrq: Map<string, RatPerson> | undefined;

/** Person mit dieser Personen-ID der Rechtsquellen («per002157»); bei doppelter ID die erste. */
export function ratPersonBySsrq(ssrq: string): RatPerson | null {
	if (!bySsrq) {
		bySsrq = new Map();
		for (const p of load().persons) if (p.ssrq && !bySsrq.has(p.ssrq)) bySsrq.set(p.ssrq, p);
	}
	return bySsrq.get(ssrq) ?? null;
}

/**
 * Die in der Transkription mit Normdaten ausgezeichneten Personen im gerenderten Text einer Sitzung
 * (`data-gnd`, `data-hls`, `data-ssrq`, vom Indexer) – Personenkarte beim Namen, mit Register-
 * eintrag, wo es die Person kennt.
 */
export function ratMentionsFor(html: string | null, council: RatCouncilView | null): RatMentionView[] {
	return ratMentionViews(personRefsInHtml(html), { byGnd: ratPersonByGnd, bySsrq: ratPersonBySsrq }, council);
}

/** Stand des Registers (Datum des Abzugs); leer, wenn es nicht lesbar ist. */
export function ratStand(): string {
	return load().built;
}

export const RAT_SESSIONS_PAGE_SIZE = 20;

export interface RatSessionHit {
	id: string;
	title: string;
	date: string | null;
	volumeNr: number | null;
}

export interface RatSessions {
	/** Bandnummern der ganzen Amtszeit (für den Link in die Suche). */
	volumes: number[];
	total: number;
	page: number;
	pages: number;
	hits: RatSessionHit[];
	/** Sitzungen je Einsitz (Reihenfolge wie `person.seats`); null ohne Bände oder bei Fehler. */
	perSeat: Array<number | null>;
}

const RM_FILTER = "series = 'RM'";
const volumeClause = (volumes: readonly number[]) => `volumeNr IN [${volumes.join(", ")}]`;

/**
 * Die Ratsmanual-Sitzungen der Amtszeit einer Person: über die Bände ihrer
 * Halbjahre (ratPeople.ts), nach Datum. Null, wenn keiner ihrer Einsitze in
 * einen Band fällt (vor 1484, Lücke 1516–1545, nur ganzjährige Bände) oder Meili
 * nicht antwortet – dann zeigt die Seite nur Kopf und Einsitze.
 */
export async function ratSessions(
	person: RatPerson,
	q: { sort: "date_asc" | "date_desc"; page: number },
): Promise<RatSessions | null> {
	const bands = rmBandTable();
	const volumes = personVolumes(person, bands);
	if (volumes.length === 0) return null;
	const seatVols = person.seats.map((s) => seatVolumes(s, bands));
	try {
		const [result, ...perSeat] = await Promise.all([
			searchDocuments(
				{ ...DEFAULT_SEARCH, series: ["RM"], volumeNr: volumes, sort: q.sort, page: q.page, pageSize: RAT_SESSIONS_PAGE_SIZE },
				{ attributesToRetrieve: ["id", "series", "title", "date", "volumeNr"] },
			),
			...seatVols.map((v) => (v.length > 0 ? countDocs([RM_FILTER, volumeClause(v)]) : Promise.resolve(0))),
		]);
		const total = result.estimatedTotalHits;
		return {
			volumes,
			total,
			page: q.page,
			pages: Math.max(1, Math.ceil(total / RAT_SESSIONS_PAGE_SIZE)),
			hits: result.hits.map((h) => ({ id: h.id, title: h.title, date: h.date, volumeNr: h.volumeNr ?? null })),
			perSeat: perSeat.map((n, i) => (seatVols[i].length > 0 && Number.isFinite(n) ? n : null)),
		};
	} catch (err) {
		console.warn(`[rat] Sitzungen von ${person.id} nicht lesbar:`, err);
		return null;
	}
}
