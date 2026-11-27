// Personen aus der Kantonsratsdatenbank (KRDB) für die KRP-Detailseite:
// Abgleich der Named-Entity-Personen (krdbMatch.ts), Wikidata-Link und
// Porträt – von Commons über den eigenen Proxy (portraitProxy.ts), aus dem
// Staatsarchiv-Bestand Z 1114 als statische Datei (static/portraits/z1114/).
//
// Personenseiten (/personen/<ID>): Register-Zugriff mit Alias-Auflösung (die KRDB
// vergibt IDs neu), die Dokumente einer Person aus dem Suchindex (Felder
// krdbIds/krdbTitleIds, geschrieben vom Indexer) und gecachte Dokumentzahlen,
// die zugleich zeigen, ob der Index die Zuordnung schon trägt.
//
// Das Register (data/krdb-register.json, gebaut von services/krdb) wird
// gebündelt: `?raw` liefert es als String, damit svelte-check nicht aus
// 1,4 MB JSON einen Literaltyp ableitet. Geparst und indexiert wird es beim
// ersten Zugriff; ist es kaputt, bleibt die Sektion einfach leer.

import registerRaw from "./data/krdb-register.json?raw";
import {
	buildKrdbIndex,
	displayLastName,
	matchKrdbDocument,
	portraitKey,
	sortPersonViews,
	toPersonView,
	type KrdbIndex,
	type KrdbPerson,
	type KrdbPersonView,
	type KrdbRegister,
} from "./krdbMatch";
import { personFilter, personIds } from "./krdbPeople";
import { countDocs, getIndex, searchWithTimeline } from "./meili";
import { createPortraitProxy, type PortraitSource } from "./portraitProxy";
import { PERSON_PAGE_SIZE, type PersonQuery, type PersonScope } from "$lib/personUrls";
import { DEFAULT_SEARCH, type SearchHit, type SearchParams, type SearchResponse } from "$lib/types";

interface KrdbState {
	register: KrdbRegister;
	index: KrdbIndex;
	portraits: Map<string, PortraitSource>;
	byId: Map<number, KrdbPerson>;
	/** Frühere ID → aktuelle ID (die KRDB vergibt Personen-IDs bei Änderungen neu). */
	aliasToId: Map<number, number>;
}

let state: KrdbState | null | undefined;

function load(): KrdbState | null {
	if (state !== undefined) return state;
	try {
		const register = JSON.parse(registerRaw) as KrdbRegister;
		const portraits = new Map<string, PortraitSource>();
		for (const p of register.persons) {
			// Nur Commons über den Proxy (Schlüssel QID bzw. K<KRDB-ID>); Z-1114-Porträts sind statische Dateien.
			if (p.img && !p.img.source) portraits.set(portraitKey(p), { url: p.img.thumb, v: p.img.v });
		}
		const byId = new Map<number, KrdbPerson>();
		const aliasToId = new Map<number, number>();
		for (const p of register.persons) {
			byId.set(p.id, p);
			for (const a of p.aliases ?? []) aliasToId.set(a, p.id);
		}
		state = { register, index: buildKrdbIndex(register), portraits, byId, aliasToId };
	} catch (err) {
		console.warn("[krdb] Register nicht lesbar – Personen-Sektion bleibt leer:", err);
		state = null;
	}
	return state;
}

export function portraitPath(key: string, v?: string): string {
	return `/api/portrait/${key}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
}

/** Zugeordnete Rats- und Regierungsmitglieder eines KRP-Dokuments (sonst []).
 *  Derselbe Dokument-Abgleich wie im Index (krdbIds): die erkannten Personen. */
export function krdbPersonsFor(
	doc: Pick<SearchHit, "series" | "persons" | "date" | "title" | "body">,
): KrdbPersonView[] {
	if (doc.series !== "KRP" || !doc.persons?.length) return [];
	const s = load();
	if (!s) return [];
	const { matches } = matchKrdbDocument(s.index, {
		persons: doc.persons,
		date: doc.date,
		title: doc.title,
		body: doc.body,
	});
	const nowYear = new Date().getUTCFullYear();
	return sortPersonViews(matches.map((m) => toPersonView(m, { portraitSrc: portraitPath, nowYear })));
}

/** Stand des Registers (ISO-Zeitpunkt des Builds) für die Quellenzeile. */
export function krdbStand(): string | null {
	return load()?.register.meta.generatedAt ?? null;
}

export const portraitProxy = createPortraitProxy({
	lookup: (key) => load()?.portraits.get(key) ?? null,
	fetch: (input, init) => fetch(input, init),
});

// --- Personenseiten ------------------------------------------------------------

/** Alle Personen des Registers (leer, wenn es nicht lesbar ist). */
export function krdbRegisterPersons(): readonly KrdbPerson[] {
	return load()?.register.persons ?? [];
}

/** Person zu einer ID: die aktuelle (`canonical`) oder – über `aliases` – eine
 *  frühere ID derselben Person (dann auf die aktuelle umleiten). */
export function resolveKrdbPerson(id: number): { person: KrdbPerson; canonical: boolean } | null {
	const s = load();
	if (!s) return null;
	const direct = s.byId.get(id);
	if (direct) return { person: direct, canonical: true };
	const current = s.aliasToId.get(id);
	const person = current != null ? s.byId.get(current) : undefined;
	return person ? { person, canonical: false } : null;
}

export interface KrdbDocCounts {
	/** Dokumente mit zugeordneter Person, je aktuelle KRDB-ID. */
	all: ReadonlyMap<number, number>;
	/** Davon mit Nennung im Titel. */
	title: ReadonlyMap<number, number>;
}

const COUNTS_TTL_MS = 60 * 60_000;
const COUNTS_RETRY_MS = 60_000;
const COUNTS_PAGE = 1000;
let counts: { value: KrdbDocCounts | null; expires: number } | undefined;
let countsLoading: Promise<KrdbDocCounts | null> | undefined;

/** Zählt die zugeordneten Dokumente je Person in einem Durchlauf über die Docs mit
 *  `krdbIds` (nur die beiden ID-Felder, ~45 Seiten à 1000). null = der Index trägt
 *  die Zuordnung noch nicht (Feld nicht filterbar oder nirgends befüllt). */
async function scanDocCounts(): Promise<KrdbDocCounts | null> {
	const s = load();
	if (!s) return null;
	const current = new Map<number, number>(); // gespeicherte ID (aktuell oder früher) → aktuelle
	for (const p of s.register.persons) {
		current.set(p.id, p.id);
		for (const a of p.aliases ?? []) current.set(a, p.id);
	}
	const all = new Map<number, number>();
	const title = new Map<number, number>();
	const bump = (map: Map<number, number>, ids: number[] | undefined) => {
		for (const id of ids ?? []) {
			const person = current.get(id);
			if (person != null) map.set(person, (map.get(person) ?? 0) + 1);
		}
	};
	try {
		for (let offset = 0; ; offset += COUNTS_PAGE) {
			const page = await getIndex().getDocuments<{ krdbIds?: number[]; krdbTitleIds?: number[] }>({
				filter: "krdbIds EXISTS",
				fields: ["krdbIds", "krdbTitleIds"],
				limit: COUNTS_PAGE,
				offset,
			});
			for (const d of page.results) {
				bump(all, d.krdbIds);
				bump(title, d.krdbTitleIds);
			}
			if (page.results.length < COUNTS_PAGE) break;
		}
	} catch (err) {
		// Meili lehnt den Filter ab, solange krdbIds nicht filterbar ist – dann ist der Index noch nicht bereit.
		console.warn("[krdb] Dokumentzahlen nicht lesbar – Personenseiten ohne Dokumentliste:", String(err).slice(0, 200));
		return null;
	}
	return all.size > 0 ? { all, title } : null;
}

/**
 * Dokumentzahlen je Person, 1 h gecacht (stale-while-revalidate, ein Lauf zur
 * Zeit). `null` heisst: der Index trägt die Zuordnung noch nicht – die Web-App
 * darf also vor dem Indexlauf (`--patch-krdb`) deployt werden; Links und Listen
 * erscheinen, sobald der Index bereit ist (nach höchstens einer Minute bzw. einer
 * Stunde bei vorhandenem Wert).
 */
export async function krdbDocCounts(): Promise<KrdbDocCounts | null> {
	const now = Date.now();
	if (counts && counts.expires > now) return counts.value;
	countsLoading ??= scanDocCounts()
		.then((value) => {
			// Ein Fehlschlag überschreibt einen früheren guten Wert nicht.
			const kept = value ?? counts?.value ?? null;
			counts = { value: kept, expires: Date.now() + (value ? COUNTS_TTL_MS : COUNTS_RETRY_MS) };
			return kept;
		})
		.finally(() => {
			countsLoading = undefined;
		});
	return counts?.value ? counts.value : countsLoading;
}

/** Gecachte Dokumentzahlen ohne Warten (Detailseite): null, solange noch kein Wert
 *  vorliegt – der Scan läuft dann im Hintergrund, ein späterer Aufruf sieht ihn. */
export function krdbDocCountsNow(): KrdbDocCounts | null {
	if (!counts || counts.expires <= Date.now()) void krdbDocCounts().catch(() => {});
	return counts?.value ?? null;
}

/** Dokumentzahl einer Person (aktuelle ID; frühere IDs sind schon eingerechnet). */
export function docCountOf(c: KrdbDocCounts | null, id: number): number | null {
	return c ? (c.all.get(id) ?? 0) : null;
}

export interface PersonDocs {
	result: SearchResponse;
	/** Treffer je Jahr (ohne Jahresfenster) für die Zeitleiste. */
	timelineBuckets: Record<string, number>;
	/** Zahl der Dokumente je Umfang unter dem aktuellen Jahresfenster. */
	scopeCounts: Record<PersonScope, number>;
}

/** Dokumente einer Person aus dem Index: Liste (mit Ausschnitt um den Nachnamen),
 *  Zeitleiste und Zähler je Umfang. */
export async function personDocuments(person: KrdbPerson, q: PersonQuery): Promise<PersonDocs> {
	const ids = personIds(person);
	const params: SearchParams = {
		...DEFAULT_SEARCH,
		series: ["KRP"],
		dateFrom: q.from,
		dateTo: q.to,
		sort: q.sort,
		page: q.page,
		pageSize: PERSON_PAGE_SIZE,
	};
	const window: string[] = [
		"series = 'KRP'",
		...(q.from != null ? [`dateYear >= ${q.from}`] : []),
		...(q.to != null ? [`dateYear <= ${q.to}`] : []),
	];
	const [main, all, title] = await Promise.all([
		searchWithTimeline(params, {
			extraFilter: personFilter(ids, q.scope),
			highlightTerms: [displayLastName(person.last)],
		}),
		countDocs([...window, ...personFilter(ids, "all")]),
		countDocs([...window, ...personFilter(ids, "title")]),
	]);
	const { timelineBuckets, ...result } = main;
	return {
		result,
		timelineBuckets,
		// Der Titel-Umfang ist eine Teilmenge von «alle»; «nur im Text» ist der Rest.
		scopeCounts: { all, title, text: Math.max(0, all - title) },
	};
}
