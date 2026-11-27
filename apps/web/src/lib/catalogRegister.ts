/**
 * Register des Archivkatalogs: Personen, Orte und Organisationen, die der Aufbau des
 * Katalog-Index (services/catalog: Titelschema, Erschliessungsregeln, NER) an den
 * Verzeichnungseinheiten erkannt hat. Ein Registereintrag ist ein Vergleichsschlüssel
 * (entityKey.ts): Schreibvarianten fallen zusammen («Anna Meyer» = «Meier, Anna»),
 * gleichnamige Personen ebenso – das Register verzeichnet Namen, keine geprüften
 * Identitäten.
 *
 * Im Index sind nur die Schlüssel filterbar (`personKeys`/`placeKeys`/`orgKeys`), die
 * Anzeigeformen (`persons`/`places`/`organizations`) nur angezeigt. Gefiltert wird über
 * dieselben URL-Parameter wie in der Dokumentsuche (`persons=Anna Meier`): beide Reiter
 * teilen sich die Auswahl, die Dokumente filtern die Form oder ihren Schlüssel (Fassung 2,
 * entityFilter.ts), der Katalog den daraus gerechneten Schlüssel (Fassung 1). Das Register zeigt je Schlüssel die häufigste Form unter einigen
 * Treffern.
 *
 * Pur (Browser und Server), unit-getestet in catalogRegister.test.ts.
 */

import { entityKey, nameWords, type EntityKind } from "./entityKey";

export interface RegisterKindInfo {
	kind: EntityKind;
	/** Pfadsegment der Registerseite. */
	slug: "personen" | "orte" | "organisationen";
	label: string;
	singular: string;
	/** Filterbares Schlüsselfeld im Index `catalog`. */
	keyField: "personKeys" | "placeKeys" | "orgKeys";
	/** Anzeigeformen im Index `catalog`, Entitäts-Facette der Dokumentsuche und der
	 *  URL-Parameter, den beide Reiter teilen. */
	formField: "persons" | "places" | "organizations";
}

export const REGISTER_KINDS: readonly RegisterKindInfo[] = [
	{ kind: "person", slug: "personen", label: "Personen", singular: "Person", keyField: "personKeys", formField: "persons" },
	{ kind: "place", slug: "orte", label: "Orte", singular: "Ort", keyField: "placeKeys", formField: "places" },
	{ kind: "org", slug: "organisationen", label: "Organisationen", singular: "Organisation", keyField: "orgKeys", formField: "organizations" },
];

export function registerKind(kind: EntityKind): RegisterKindInfo {
	return REGISTER_KINDS.find((k) => k.kind === kind) ?? REGISTER_KINDS[0];
}

export function registerKindBySlug(slug: string): RegisterKindInfo | null {
	return REGISTER_KINDS.find((k) => k.slug === slug) ?? null;
}

// --- Entitätsfilter im Katalog-Reiter ---------------------------------------------

/** Gewählte Personen, Orte, Organisationen je Typ (Formen mit Schlüssel). */
export interface CatalogEntityFilter {
	person: string[];
	place: string[];
	org: string[];
}

export const NO_ENTITY_FILTER: CatalogEntityFilter = { person: [], place: [], org: [] };

/** Höchstens so viele Einträge je Typ (wie die Bestände). */
const ENTITY_FILTER_MAX = 20;

/**
 * Entitätsfilter des Katalogs aus den geteilten Parametern der Suchseite (`persons`,
 * `places`, `organizations`, je wiederholbar). Nur Formen mit Schlüssel (eine Person
 * braucht Vor- und Nachnamen), je Schlüssel die erste; die übrigen wirken nur auf die
 * Dokumente (unkeyedEntityCount).
 */
export function parseEntityFilter(sp: URLSearchParams): CatalogEntityFilter {
	const out: CatalogEntityFilter = { person: [], place: [], org: [] };
	for (const info of REGISTER_KINDS) {
		const seen = new Set<string>();
		for (const raw of sp.getAll(info.formField)) {
			const form = raw.replace(/\s+/g, " ").trim().slice(0, 200);
			const key = form ? entityKey(info.kind, form) : null;
			if (!key || seen.has(key) || out[info.kind].length >= ENTITY_FILTER_MAX) continue;
			seen.add(key);
			out[info.kind].push(form);
		}
	}
	return out;
}

/** Formen, die der Katalog nicht anwenden kann (kein Schlüssel, z. B. Nachname allein). */
export function unkeyedEntityCount(kind: EntityKind, values: readonly string[]): number {
	return values.filter((v) => !entityKey(kind, v)).length;
}

export function hasEntityFilter(f: CatalogEntityFilter | undefined): boolean {
	return !!f && (f.person.length > 0 || f.place.length > 0 || f.org.length > 0);
}

/**
 * Meili-Filterklauseln: je Typ `personKeys IN [...]` (mehrere Einträge eines Typs =
 * oder, wie die Entitätsfilter der Dokumentsuche), Typen untereinander und.
 * Schlüssel bestehen nur aus Kleinbuchstaben, Ziffern und Leerzeichen.
 */
export function entityFilterClauses(f: CatalogEntityFilter | undefined): string[] {
	if (!f) return [];
	const clauses: string[] = [];
	for (const info of REGISTER_KINDS) {
		const keys = [...new Set(f[info.kind].map((v) => entityKey(info.kind, v)).filter((k): k is string => !!k))];
		if (keys.length > 0) clauses.push(`${info.keyField} IN [${keys.map((k) => `"${k}"`).join(", ")}]`);
	}
	return clauses;
}

// --- Links ------------------------------------------------------------------------

/** Katalogsuche (Reiter «Archivkatalog»), gefiltert auf einen Registereintrag, optional in
 *  einem Bestand. Derselbe Parameter filtert im Reiter «Zentrale Serien» die Form oder ihren Schlüssel. */
export function catalogEntitySearchHref(kind: EntityKind, form: string, bestand?: string): string {
	const sp = new URLSearchParams({ view: "catalog" });
	sp.append(registerKind(kind).formField, form);
	if (bestand) sp.append("catBestand", bestand);
	return `/search?${sp}`;
}

/** Dokumentsuche mit den Formen eines Namens (Entitätsfilter `persons`/`places`/`organizations`, oder-verknüpft). */
export function documentEntitySearchHref(kind: EntityKind, forms: readonly string[]): string {
	const sp = new URLSearchParams();
	for (const f of forms) sp.append(registerKind(kind).formField, f);
	sp.set("view", "documents");
	return `/search?${sp}`;
}

export type RegisterSort = "count" | "name";

export interface RegisterQuery {
	q: string;
	sort: RegisterSort;
	page: number;
}

/** Einträge je Seite. */
export const REGISTER_PAGE_SIZE = 50;

export function parseRegisterQuery(sp: URLSearchParams): RegisterQuery {
	const page = Number.parseInt(sp.get("page") ?? "", 10);
	return {
		q: (sp.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
		sort: sp.get("sort") === "name" ? "name" : "count",
		page: Number.isFinite(page) && page > 1 ? Math.min(page, 10_000) : 1,
	};
}

/** Abfrage einer Registerseite als «?…», nur mit abweichenden Parametern (auch für das Register
 *  der Editionen, editionRegister.ts). */
export function registerSearch(q: Partial<RegisterQuery> = {}): string {
	const sp = new URLSearchParams();
	if (q.q) sp.set("q", q.q);
	if (q.sort && q.sort !== "count") sp.set("sort", q.sort);
	if (q.page && q.page > 1) sp.set("page", String(q.page));
	const qs = sp.toString();
	return qs ? `?${qs}` : "";
}

/** Registerseite, nur mit abweichenden Parametern. */
export function registerHref(slug: RegisterKindInfo["slug"], q: Partial<RegisterQuery> = {}): string {
	return `/archivkatalog/register/${slug}${registerSearch(q)}`;
}

// --- Suche im Register ---------------------------------------------------------------

/**
 * Suchwörter in Schlüsselform (gefaltet wie entityKey), je Wort die möglichen Anfänge.
 * Eine vollständige Form ergibt ihren Schlüssel («Meier, Anna» → ana, meier); sonst die
 * gefalteten Wörter, damit auch ein Nachname allein oder ein Wortanfang trifft. Endet
 * die Eingabe auf «c», darf das letzte Wort auch mit «ch» weitergehen («Sc» → Schmid):
 * der Schlüssel macht aus «c» sonst «k».
 */
export function registerQueryWords(kind: EntityKind, q: string): string[][] {
	const clean = q.replace(/\s+/g, " ").trim().slice(0, 100);
	if (!clean) return [];
	const key = entityKey(kind, clean);
	const words = [...new Set((key ? key.split(" ") : nameWords(clean)).filter(Boolean))].slice(0, 6);
	const out = words.map((w) => [w]);
	const last = out[out.length - 1];
	if (last && /c$/i.test(clean) && last[0].endsWith("k")) last.push(`${last[0].slice(0, -1)}ch`);
	return out;
}

/** Trifft der Schlüssel alle Suchwörter (je als Anfang eines seiner Wörter, Reihenfolge egal)? */
export function keyMatchesQuery(key: string, words: readonly (readonly string[])[]): boolean {
	if (words.length === 0) return false;
	const kw = key.split(" ");
	return words.every((alts) => kw.some((k) => alts.some((a) => k.startsWith(a))));
}

/** Sortierschlüssel «Name»: Personen nach Nachnamen (letztes Wort des Schlüssels), sonst der Schlüssel. */
export function registerSortName(kind: EntityKind, key: string): string {
	if (kind !== "person") return key;
	const ws = key.split(" ");
	return [ws[ws.length - 1], ...ws.slice(0, -1)].join(" ");
}

export function sortRegisterKeys<T extends { key: string; count: number }>(kind: EntityKind, items: readonly T[], sort: RegisterSort): T[] {
	const byCount = (a: T, b: T) => b.count - a.count || a.key.localeCompare(b.key, "de");
	if (sort === "count") return [...items].sort(byCount);
	const name = new Map(items.map((i) => [i.key, registerSortName(kind, i.key)]));
	return [...items].sort((a, b) => (name.get(a.key) ?? "").localeCompare(name.get(b.key) ?? "", "de") || byCount(a, b));
}

// --- Anzeigeform ----------------------------------------------------------------------

const ALL_CAPS = /^[^\p{Ll}]*$/u;

/**
 * Anzeigeform eines Schlüssels aus den Formen einiger Treffer: die häufigste Form mit
 * genau diesem Schlüssel, bei Gleichstand die kürzere («Uster» vor «Gemeinde Uster»),
 * Versalien («MEIER, Anna») nur ohne andere; null ohne Form.
 */
export function pickDisplayForm(kind: EntityKind, key: string, forms: readonly string[]): string | null {
	const counts = new Map<string, number>();
	for (const raw of forms) {
		const form = raw.replace(/\s+/g, " ").trim();
		if (form && entityKey(kind, form) === key) counts.set(form, (counts.get(form) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestScore = -Infinity;
	for (const [form, n] of counts) {
		const score = n - (ALL_CAPS.test(form) ? 0.5 : 0);
		if (score > bestScore || (score === bestScore && best != null && form.length < best.length)) {
			best = form;
			bestScore = score;
		}
	}
	return best;
}

// --- Bestandsprägende Einträge --------------------------------------------------------

/**
 * Urheber und Provenienzen stehen an fast jeder Einheit ihres Bestands – Fotografen
 * (Haagmans), Ämter (Erkennungsdienst der Kantonspolizei), Namensgeber von Nachlässen –
 * und stünden im Register sonst weit oben. Ein Eintrag gilt als bestandsprägend, wenn
 * er häufig ist und der grösste Teil seiner Einheiten in Beständen liegt, deren Einheiten
 * ihn mehrheitlich tragen. Patentinhaber (Gebrüder Sulzer AG: fast nur in den
 * Patentschriften, dort aber in wenigen Prozent der Einheiten) gelten nicht als prägend.
 */
export const CONSTANT_MIN_UNITS = 100;
/** Anteil der Einheiten eines Bestands, die den Eintrag tragen müssen. */
export const CONSTANT_COVERAGE = 0.5;
/** Anteil der Einheiten des Eintrags in solchen Beständen. */
export const CONSTANT_SHARE = 0.8;
/** Kleinere Häufungen zählen nicht als Prägung eines Bestands. */
const CONSTANT_BESTAND_MIN = 20;
/** Schwerpunkt-Hinweis ab diesem Anteil der Einheiten in einem Bestand. */
export const MAIN_BESTAND_SHARE = 0.5;

export interface BestandShare {
	/** Etikett des Bestands wie im Index («… , 1524-1999 (Bestand)»). */
	bestand: string;
	/** Einheiten des Eintrags in diesem Bestand. */
	count: number;
	/** Eigene Einheiten des Bestands insgesamt (0 = unbekannt). */
	size: number;
}

export interface EntryBestaende {
	/** Bestandsprägend (s. o.)? */
	constant: boolean;
	/** Prägende Bestände (nur bei `constant`), sonst der Schwerpunkt (ab MAIN_BESTAND_SHARE) oder leer. */
	bestaende: BestandShare[];
}

/**
 * Verteilung eines Eintrags auf die Bestände (`dist`, Facette) gegen die Grösse der
 * Bestände (`sizes`, Facette über alle eigenen Einheiten).
 */
export function classifyBestaende(total: number, dist: Record<string, number>, sizes: Record<string, number>): EntryBestaende {
	const shaped: BestandShare[] = [];
	let shapedUnits = 0;
	for (const [bestand, count] of Object.entries(dist)) {
		const size = sizes[bestand] ?? 0;
		if (size > 0 && count >= CONSTANT_BESTAND_MIN && count >= CONSTANT_COVERAGE * size) {
			shaped.push({ bestand, count, size });
			shapedUnits += count;
		}
	}
	const byCount = (a: BestandShare, b: BestandShare) => b.count - a.count || a.bestand.localeCompare(b.bestand, "de");
	if (total >= CONSTANT_MIN_UNITS && shapedUnits >= CONSTANT_SHARE * total) return { constant: true, bestaende: shaped.sort(byCount) };
	const top = Object.entries(dist).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))[0];
	return {
		constant: false,
		bestaende: top && total > 0 && top[1] >= MAIN_BESTAND_SHARE * total ? [{ bestand: top[0], count: top[1], size: sizes[top[0]] ?? 0 }] : [],
	};
}

// --- Namen einer Verzeichnungseinheit (Detailseite) -------------------------------------

export interface UnitEntity {
	form: string;
	key: string;
	/** Eigene Einheiten mit diesem Namen; null, wenn die Zählung ausblieb. */
	count: number | null;
	/** Personenseite, wenn die Einheit der Person gesichert zugeordnet ist und der Name passt. */
	krdb: { id: number; name: string } | null;
}

export type UnitEntities = Record<EntityKind, UnitEntity[]>;

// --- Kantonsratsdatenbank -------------------------------------------------------------

/**
 * Passt eine Person der Kantonsratsdatenbank zum Schlüssel? Alle Wörter ihres
 * Nachnamens und mindestens ein Vorname stehen im Schlüssel («Paul Eugen Bleuler» zu
 * «eugen bleuler»). Klammerzusätze («Escher (vom Glas)») zählen nicht.
 */
export function krdbNameMatchesKey(person: { first: string; last: string }, key: string): boolean {
	const kw = new Set(key.split(" "));
	const last = nameWords(person.last);
	const first = nameWords(person.first);
	return last.length > 0 && last.every((w) => kw.has(w)) && first.some((w) => kw.has(w));
}
