/**
 * Register der Editionen (Seiten /editionen/register/personen|orte|organisationen und die
 * Namenssuche der Übersicht /register): die Personen, Orte und Organisationen, die die
 * Editionen in ihren Stücken auszeichnen, je mit der Zahl der Stücke, ihrem Zeitraum und den
 * Schreibungen in den Texten. Grundlage sind die Register der Edition (person.xml, place.xml
 * und die Ergänzungen, im Aufbau aufgelöst: services/catalog/src/editionRegisters.ts), wie sie
 * an jedem Stück stehen (`personList`, `placeList`, `orgs` im Index `editions`).
 *
 * Anders als das Register des Archivkatalogs (automatisch erkannte Namen, ein Eintrag je
 * Vergleichsschlüssel) ist ein Eintrag hier ein Name aus dem Register der Edition: Personen mit
 * GND, wo die Edition sie nennt; gleich lautende Personen trennt der Aufbau mit Lebensjahren
 * («Ulrich Zwingli (1556–1601)»). Jeder Eintrag führt in den Reiter «Editionen», gefiltert auf
 * den Namen (geteilte Parameter `persons`/`places`/`organizations`: Name oder Schlüssel).
 *
 * Pur (Browser und Server), unit-getestet in editionRegister.test.ts.
 */

import {
	keyMatchesQuery,
	REGISTER_KINDS,
	registerKind,
	registerQueryWords,
	registerSearch,
	registerSortName,
	type RegisterKindInfo,
	type RegisterQuery,
} from "./catalogRegister";
import { foldText, nameWords, personKey, type EntityKind } from "./entityKey";
import { isPlaceSpelling, sharesNameWord } from "./nameSpelling";
import { searchViewHref } from "./searchViews";

/** Was ein Stück zum Register beiträgt (Felder des Index `editions`). */
export interface EditionRegisterPiece {
	edition: string;
	dateFrom: number | null;
	dateTo: number | null;
	persons: ReadonlyArray<{ name: string; gnd?: string | null; forms?: readonly string[]; count?: number }>;
	places: ReadonlyArray<{ name: string; lat?: number | null; lon?: number | null; forms?: readonly string[]; count?: number }>;
	orgs: readonly string[];
}

export interface EditionRegisterEntry {
	/** Name im Register der Edition; Filterwert im Reiter «Editionen». */
	name: string;
	/** Stücke, die den Namen nennen. */
	pieces: number;
	/** Nennungen in diesen Stücken (Organisationen: je Stück eine). */
	mentions: number;
	/** Frühestes und spätestes Jahr dieser Stücke. */
	yearFrom: number | null;
	yearTo: number | null;
	/** Andere Schreibungen in den Texten, häufigste zuerst (höchstens FORMS_SHOWN; nur Formen, die
	 *  dem Namen ähneln, isNameSpelling). */
	forms: string[];
	/** GND der Person (die häufigste, falls Stücke verschiedene nennen). */
	gnd: string | null;
	/** Koordinaten des Orts aus dem Register. */
	coords: { lat: number; lon: number } | null;
	/** Editionen mit dem Namen (Schlüssel aus EDITIONS). */
	editions: string[];
}

/** Ein Typ des Registers mit den Suchschlüsseln je Eintrag (gleiche Reihenfolge wie `entries`). */
export interface EditionRegisterList {
	/** Häufigste zuerst. */
	entries: EditionRegisterEntry[];
	/** Gefaltete Wörter des Namens (nameWords). */
	nameKeys: string[];
	/** Gefaltete Wörter aller Schreibungen in den Texten. */
	formKeys: string[];
	/** Sortierschlüssel «Name» (Personen nach Nachnamen). */
	sortNames: string[];
}

export interface EditionRegister {
	person: EditionRegisterList;
	place: EditionRegisterList;
	org: EditionRegisterList;
	/** Stücke, aus denen das Register gebaut ist. */
	pieces: number;
}

/** So viele andere Schreibungen zeigt ein Eintrag. */
export const FORMS_SHOWN = 4;

const KINDS: readonly EntityKind[] = ["person", "place", "org"];

/**
 * Sortierschlüssel «Name»: Personen nach dem Nachnamen (letztes Wort des Schlüssels, wie das
 * Register des Archivkatalogs), Einzelnamen mit Zusatz nach dem Namen («Paulus, Apostel,
 * Heiliger» unter P), sonst der gefaltete Name. Klammerzusätze zählen nicht.
 */
export function editionSortName(kind: EntityKind, name: string): string {
	if (kind === "person") {
		const head = name.split(",")[0];
		if (head !== name) return foldText(head);
		const key = personKey(name);
		if (key) return registerSortName("person", key);
	}
	return foldText(name.replace(/\([^)]*\)/g, " "));
}

/**
 * Ist eine Form aus dem Text eine Schreibung des Namens? Die Edition zeichnet auch Ämter,
 * Satzteile und Fehlgriffe mit dem Verweis auf eine Person oder einen Ort aus («dechan» für
 * Rudolf Gwalther, «land» für Mähren, ein Ortsname an einer Person); solche Formen zeigt und
 * durchsucht das Register nicht. Personen und Organisationen: ein ähnliches Wort wie im Aufbau
 * (sharesNameWord: «Bullingers», «Ulrich Zwinglj»); Orte: ähnlicher Ortsschlüssel
 * (isPlaceSpelling: «Kyburch»).
 */
export function isNameSpelling(kind: EntityKind, name: string, form: string): boolean {
	return kind === "place" ? isPlaceSpelling(name, form) : sharesNameWord([name], [form]);
}

interface Acc {
	name: string;
	pieces: number;
	mentions: number;
	from: number | null;
	to: number | null;
	forms: Map<string, number>;
	gnds: Map<string, number>;
	coords: { lat: number; lon: number } | null;
	editions: Set<string>;
}

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** Register aus den Stücken: je Typ ein Eintrag je Name, häufigste zuerst. */
export function buildEditionRegister(pieces: readonly EditionRegisterPiece[]): EditionRegister {
	const accs: Record<EntityKind, Map<string, Acc>> = { person: new Map(), place: new Map(), org: new Map() };
	for (const piece of pieces) {
		const from = piece.dateFrom ?? piece.dateTo;
		const to = piece.dateTo ?? piece.dateFrom;
		// Ein Name zählt je Stück einmal, auch wenn das Stück ihn zweimal führt.
		const seen: Record<EntityKind, Set<string>> = { person: new Set(), place: new Set(), org: new Set() };
		const add = (
			kind: EntityKind,
			rawName: unknown,
			extra: { forms?: readonly string[]; count?: number; gnd?: string | null; lat?: number | null; lon?: number | null },
		) => {
			const name = clean(rawName);
			if (!name) return;
			let acc = accs[kind].get(name);
			if (!acc) {
				acc = { name, pieces: 0, mentions: 0, from: null, to: null, forms: new Map(), gnds: new Map(), coords: null, editions: new Set() };
				accs[kind].set(name, acc);
			}
			acc.mentions += Math.max(1, extra.count ?? 1);
			if (extra.gnd) acc.gnds.set(extra.gnd, (acc.gnds.get(extra.gnd) ?? 0) + 1);
			if (!acc.coords && typeof extra.lat === "number" && typeof extra.lon === "number") acc.coords = { lat: extra.lat, lon: extra.lon };
			if (seen[kind].has(name)) return;
			seen[kind].add(name);
			acc.pieces += 1;
			if (from != null) acc.from = acc.from == null ? from : Math.min(acc.from, from);
			if (to != null) acc.to = acc.to == null ? to : Math.max(acc.to, to);
			acc.editions.add(piece.edition);
			for (const f of new Set((extra.forms ?? []).map(clean).filter((f) => f && f !== name && isNameSpelling(kind, name, f)))) {
				acc.forms.set(f, (acc.forms.get(f) ?? 0) + 1);
			}
		};
		for (const p of piece.persons ?? []) add("person", p.name, p);
		for (const p of piece.places ?? []) add("place", p.name, p);
		for (const o of piece.orgs ?? []) add("org", o, {});
	}
	const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0], "de");
	const lists = {} as Record<EntityKind, EditionRegisterList>;
	for (const kind of KINDS) {
		const items = [...accs[kind].values()].map((a) => {
			const forms = [...a.forms].sort(byCount).map(([f]) => f);
			const entry: EditionRegisterEntry = {
				name: a.name,
				pieces: a.pieces,
				mentions: a.mentions,
				yearFrom: a.from,
				yearTo: a.to,
				forms: forms.slice(0, FORMS_SHOWN),
				gnd: [...a.gnds].sort(byCount)[0]?.[0] ?? null,
				coords: a.coords,
				editions: [...a.editions].sort(),
			};
			return {
				entry,
				nameKey: nameWords(a.name).join(" "),
				formKey: [...new Set(forms.flatMap((f) => nameWords(f)))].join(" "),
				sortName: editionSortName(kind, a.name),
			};
		});
		items.sort((a, b) => b.entry.pieces - a.entry.pieces || b.entry.mentions - a.entry.mentions || a.sortName.localeCompare(b.sortName, "de"));
		lists[kind] = {
			entries: items.map((i) => i.entry),
			nameKeys: items.map((i) => i.nameKey),
			formKeys: items.map((i) => i.formKey),
			sortNames: items.map((i) => i.sortName),
		};
	}
	return { ...lists, pieces: pieces.length };
}

/**
 * Einträge eines Typs zur Abfrage: ohne Suchwort alle; sonst die, deren Name alle Suchwörter
 * (als Wortanfang, wie im Register des Archivkatalogs) trägt, dahinter die, bei denen erst eine
 * Schreibung im Text passt («Zwinglj»). Sortiert nach Häufigkeit oder Name.
 */
export function filterEditionRegister(kind: EntityKind, list: EditionRegisterList, query: Pick<RegisterQuery, "q" | "sort">): EditionRegisterEntry[] {
	const words = registerQueryWords(kind, query.q);
	// Eine Eingabe ohne verwertbares Wort («–», «?») trifft nichts, statt alles zu zeigen.
	if (query.q.trim() !== "" && words.length === 0) return [];
	const picked: Array<{ i: number; tier: number }> = [];
	list.entries.forEach((_, i) => {
		if (words.length === 0) picked.push({ i, tier: 0 });
		else if (keyMatchesQuery(list.nameKeys[i], words)) picked.push({ i, tier: 0 });
		else if (list.formKeys[i] && keyMatchesQuery(list.formKeys[i], words)) picked.push({ i, tier: 1 });
	});
	// `entries` ist schon nach Häufigkeit geordnet: bei «Häufigste zuerst» genügt die Stufe.
	if (query.sort === "name") {
		picked.sort((a, b) => list.sortNames[a.i].localeCompare(list.sortNames[b.i], "de") || a.tier - b.tier || a.i - b.i);
	} else {
		picked.sort((a, b) => a.tier - b.tier || a.i - b.i);
	}
	return picked.map((p) => list.entries[p.i]);
}

/** Typen mit Einträgen, in der Reihenfolge der Register (Personen, Orte, Organisationen). */
export function editionRegisterKinds(register: Pick<EditionRegister, EntityKind>): RegisterKindInfo[] {
	return REGISTER_KINDS.filter((k) => register[k.kind].entries.length > 0);
}

// --- Links --------------------------------------------------------------------------

/** Seite des Registers der Editionen, nur mit abweichenden Parametern. */
export function editionRegisterHref(slug: RegisterKindInfo["slug"], q: Partial<RegisterQuery> = {}): string {
	return `/editionen/register/${slug}${registerSearch(q)}`;
}

/** Reiter «Editionen», gefiltert auf einen Namen des Registers. */
export function editionEntitySearchHref(kind: EntityKind, name: string): string {
	return searchViewHref("editions", { [registerKind(kind).formField]: name });
}

export const gndHref = (gnd: string): string => `https://d-nb.info/gnd/${encodeURIComponent(gnd)}`;

export const mapHref = (c: { lat: number; lon: number }): string =>
	`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=13/${c.lat}/${c.lon}`;

/** «1525», «1525–1531», leer ohne Jahr (Halbgeviertstrich). */
export function yearSpan(from: number | null, to: number | null): string {
	if (from == null && to == null) return "";
	if (from == null || to == null || from === to) return String(from ?? to);
	return `${from}–${to}`;
}
