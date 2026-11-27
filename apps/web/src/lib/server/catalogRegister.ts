/**
 * Register des Archivkatalogs (Seiten /archivkatalog/register/<typ>) und die Namen
 * einer Verzeichnungseinheit (Detailseite): Personen, Orte und Organisationen der
 * eigenen Treffer (`onPlatform = false`) über die filterbaren Schlüssel des Index
 * `catalog`. Begriffe und reine Logik in $lib/catalogRegister.ts.
 *
 * - Liste: Facette des Schlüsselfelds (die häufigsten bis `maxValuesPerFacet`, 2'000)
 *   und der Bestände, 1 h gecacht (stale-while-revalidate). Häufige Einträge werden
 *   auf Bestandsprägung geprüft (classifyBestaende) und stehen getrennt.
 * - Anzeigeform, Schwerpunkt-Bestand und KRDB-Person je Schlüssel: eine Abfrage je
 *   Schlüssel (einige Treffer + Facetten), gebündelt per multiSearch, je Schlüssel 1 h
 *   gecacht. Die Schlüssel selbst sind nicht abrufbar (nicht in displayedAttributes),
 *   darum rechnet pickDisplayForm sie aus den Formen nach.
 * - Suche: Wortanfänge in der gecachten Liste, Meilis Facettensuche (findet nur
 *   Schlüssel, die mit der Eingabe beginnen – Personen-Schlüssel beginnen mit dem
 *   Vornamen) und die Schlüssel der Einheiten, deren Text die Eingabe enthält (seltene
 *   Nachnamen); deren Zahlen werden einzeln nachgezählt.
 * - Dokumente: dieselben Namen im Index `documents` – trägt er die Vergleichsschlüssel, die
 *   Anzeigeform samt Schreibvarianten (Form oder Schlüssel, Fassung 2), sonst die Formen
 *   mit demselben Schlüssel aus den Entitäts-Facetten (Facettensuche mit der Anzeigeform).
 */

import { createHash } from "node:crypto";
import { MEILI_CATALOG_INDEX, MEILI_INDEX, MEILI_SEARCH_KEY, MEILI_URL } from "./env";
import { entityKeysReady, getIndex } from "./meili";
import { catalogFacetDistribution, catalogFieldScope, catalogSpelling, countCatalogSets, lexicalOf, withCatalogFallback } from "./catalog";
import { lexicalSearchOn } from "./catalogUnion";
import { resolveKrdbPerson } from "./krdb";
import { personName } from "./krdbPeople";
import { createTtlLruCache } from "./ttlCache";
import { splitCatalogLabel, type CatalogFilters } from "$lib/catalog";
import { entityKey, type EntityKind } from "$lib/entityKey";
import { documentEntityClause } from "$lib/entityFilter";
import { foldSharpS } from "$lib/sharpS";
import type { SearchParams } from "$lib/types";
import {
	classifyBestaende,
	NO_ENTITY_FILTER,
	CONSTANT_MIN_UNITS,
	keyMatchesQuery,
	krdbNameMatchesKey,
	pickDisplayForm,
	REGISTER_KINDS,
	REGISTER_PAGE_SIZE,
	registerKind,
	registerQueryWords,
	sortRegisterKeys,
	type RegisterKindInfo,
	type RegisterQuery,
	type UnitEntities,
} from "$lib/catalogRegister";
import { createMeiliClient } from "./meiliClient";

const client = createMeiliClient(MEILI_URL, MEILI_SEARCH_KEY);
const catalogIndex = () => client.index(MEILI_CATALOG_INDEX);

/** Nur eigene Treffer – wie Suche, Zähler und Zeitleiste des Katalogs. */
const OWN = "onPlatform = false";
/** `maxValuesPerFacet` des Index (services/catalog/src/settings.ts): mehr Einträge liefert die Facette nicht. */
const FACET_CAP = 2000;
/** So viele der häufigsten Einträge werden auf Bestandsprägung geprüft (die übrigen sind seltener). */
const CLASSIFY_MAX = 300;
/** Treffer je Schlüssel, aus deren Formen die Anzeigeform gewählt wird. */
const FORM_SAMPLE = 5;
/** Abfragen je multiSearch. */
const BATCH = 100;
/** Höchstens so viele Einträge liefert eine Suche im Register. */
export const REGISTER_SEARCH_MAX = 500;
/** Höchstens so viele Schlüssel aus Volltext-Treffern werden einzeln nachgezählt. */
const SEARCH_RECOUNT_MAX = 200;
/** Erst ab so vielen Buchstaben/Ziffern fragt die Suche Meili (sonst nur die gecachte Liste). */
const SEARCH_DEEP_MIN = 3;

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function chunks<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

interface KeyCount {
	key: string;
	count: number;
}

/** Ein Eintrag zur Anzeige. */
export interface RegisterEntry {
	key: string;
	/** Anzeigeform (häufigste Form unter einigen Treffern); führt in die gefilterte Katalogsuche. */
	form: string;
	/** Eigene Verzeichnungseinheiten mit diesem Eintrag. */
	count: number;
	/** Steht an (fast) allen Einheiten eines Bestands: Urheber, Provenienz, Namensgeber. */
	constant: boolean;
	/** Prägende Bestände (`constant`), sonst der Schwerpunkt-Bestand, wenn es einen gibt. */
	bestaende: Array<{ label: string; name: string; count: number; size: number }>;
	/** Rats- oder Regierungsmitglied, dem Einheiten mit diesem Namen sicher zugeordnet sind
	 *  (`units` davon; die übrigen können Namensvettern sein). */
	krdb: { id: number; name: string; units: number } | null;
}

// --- Anzeigeform, Bestände, KRDB je Schlüssel -------------------------------------------

const entryCache = createTtlLruCache<RegisterEntry | null>({ maxEntries: 20_000, ttlMs: 60 * 60_000 });

interface FacetResult {
	hits: Array<Record<string, unknown>>;
	estimatedTotalHits?: number;
	facetDistribution?: Record<string, Record<string, number>>;
}

/** KRDB-Person der Einheiten eines Schlüssels: genau eine gesichert zugeordnete Person mit
 *  passendem Namen (frühere IDs eingerechnet), mit der Zahl ihrer Einheiten. */
function krdbOf(key: string, dist: Record<string, number> | undefined): RegisterEntry["krdb"] {
	const found = new Map<number, { name: string; units: number }>();
	for (const [raw, units] of Object.entries(dist ?? {})) {
		const resolved = resolveKrdbPerson(Number(raw));
		if (!resolved || !krdbNameMatchesKey(resolved.person, key)) continue;
		const prev = found.get(resolved.person.id);
		found.set(resolved.person.id, { name: personName(resolved.person), units: (prev?.units ?? 0) + units });
	}
	if (found.size !== 1) return null;
	const [[id, person]] = [...found];
	return { id, ...person };
}

function toEntry(info: RegisterKindInfo, key: string, res: FacetResult, sizes: Record<string, number>): RegisterEntry | null {
	const forms = res.hits.flatMap((h) => (Array.isArray(h[info.formField]) ? (h[info.formField] as unknown[]).filter((f): f is string => typeof f === "string") : []));
	const form = pickDisplayForm(info.kind, key, forms);
	if (!form) return null;
	const count = res.estimatedTotalHits ?? res.hits.length;
	const fd = res.facetDistribution ?? {};
	const cls = classifyBestaende(count, fd.bestand ?? {}, sizes);
	return {
		key,
		form,
		count,
		constant: cls.constant,
		bestaende: cls.bestaende.map((b) => ({ label: b.bestand, name: splitCatalogLabel(b.bestand).name, count: b.count, size: b.size })),
		krdb: info.kind === "person" ? krdbOf(key, fd.krdbIds) : null,
	};
}

/** Einträge zu Schlüsseln (gecacht); Schlüssel ohne passende Form fehlen im Ergebnis. */
async function entriesFor(info: RegisterKindInfo, keys: readonly string[], sizes: Record<string, number>): Promise<Map<string, RegisterEntry>> {
	const out = new Map<string, RegisterEntry>();
	const missing: string[] = [];
	for (const key of new Set(keys)) {
		const cached = entryCache.get(`${info.kind}:${key}`);
		if (cached === undefined) missing.push(key);
		else if (cached) out.set(key, cached);
	}
	for (const batch of chunks(missing, BATCH)) {
		const res = await client.multiSearch({
			queries: batch.map((key) => ({
				indexUid: MEILI_CATALOG_INDEX,
				q: "",
				filter: `${OWN} AND ${info.keyField} = ${quote(key)}`,
				limit: FORM_SAMPLE,
				attributesToRetrieve: [info.formField],
				facets: info.kind === "person" ? ["bestand", "krdbIds"] : ["bestand"],
			})),
		});
		res.results.forEach((r, i) => {
			const key = batch[i];
			const entry = toEntry(info, key, r as unknown as FacetResult, sizes);
			entryCache.set(`${info.kind}:${key}`, entry);
			if (entry) out.set(key, entry);
			else console.warn(`[catalog-register] ${info.kind} «${key}»: keine passende Anzeigeform`);
		});
	}
	return out;
}

// --- Liste je Typ (1 h gecacht) -------------------------------------------------------------

interface RegisterList {
	/** Alle Facettenwerte (häufigste zuerst). */
	all: KeyCount[];
	/** Ohne bestandsprägende Einträge. */
	main: KeyCount[];
	constants: KeyCount[];
	/** Die Facette war gekappt: seltenere Einträge findet nur die Suche. */
	capped: boolean;
	/** Eigene Einheiten je Bestand. */
	sizes: Record<string, number>;
}

const LIST_TTL_MS = 60 * 60_000;
const LIST_RETRY_MS = 60_000;
const lists = new Map<EntityKind, { value: RegisterList | null; expires: number }>();
const listsLoading = new Map<EntityKind, Promise<RegisterList | null>>();

async function buildList(info: RegisterKindInfo): Promise<RegisterList | null> {
	try {
		const res = await catalogIndex().search("", { filter: OWN, limit: 0, facets: [info.keyField, "bestand"] });
		const fd = (res.facetDistribution ?? {}) as Record<string, Record<string, number>>;
		const sizes = fd.bestand ?? {};
		const all = sortRegisterKeys(
			info.kind,
			Object.entries(fd[info.keyField] ?? {}).map(([key, count]) => ({ key, count })),
			"count",
		);
		const heavy = all.filter((e) => e.count >= CONSTANT_MIN_UNITS).slice(0, CLASSIFY_MAX);
		const entries = await entriesFor(info, heavy.map((e) => e.key), sizes);
		const constant = new Set(heavy.filter((e) => entries.get(e.key)?.constant).map((e) => e.key));
		return {
			all,
			main: all.filter((e) => !constant.has(e.key)),
			constants: all.filter((e) => constant.has(e.key)),
			capped: all.length >= FACET_CAP,
			sizes,
		};
	} catch (err) {
		console.warn(`[catalog-register] Liste ${info.slug} nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

/** Liste eines Typs, 1 h gecacht (stale-while-revalidate, ein Aufbau zur Zeit); null bei Fehler. */
async function registerList(info: RegisterKindInfo): Promise<RegisterList | null> {
	const now = Date.now();
	const cached = lists.get(info.kind);
	if (cached && cached.expires > now) return cached.value;
	let loading = listsLoading.get(info.kind);
	if (!loading) {
		loading = buildList(info)
			.then((value) => {
				const kept = value ?? lists.get(info.kind)?.value ?? null;
				lists.set(info.kind, { value: kept, expires: Date.now() + (value ? LIST_TTL_MS : LIST_RETRY_MS) });
				return kept;
			})
			.finally(() => listsLoading.delete(info.kind));
		listsLoading.set(info.kind, loading);
	}
	return cached?.value ? cached.value : loading;
}

// --- Suche im Register --------------------------------------------------------------------

const searchCache = createTtlLruCache<KeyCount[]>({ maxEntries: 500, ttlMs: 10 * 60_000, maxKeyLen: 200 });

async function searchKeys(info: RegisterKindInfo, q: string, list: RegisterList): Promise<KeyCount[]> {
	const words = registerQueryWords(info.kind, q);
	if (words.length === 0) return [];
	const cacheKey = `${info.kind}:${words.map((w) => w.join("|")).join(" ")}:${q.toLowerCase()}`;
	const cached = searchCache.get(cacheKey);
	if (cached) return cached;

	const found = new Map<string, number>();
	for (const e of list.all) if (keyMatchesQuery(e.key, words)) found.set(e.key, e.count);
	// Ein, zwei Zeichen treffen fast jeden Schlüssel: nur die Liste, keine Meili-Abfragen.
	if (foldSharpS(q).replace(/[^\p{L}\p{N}]/gu, "").length < SEARCH_DEEP_MIN) {
		const out = sortRegisterKeys(info.kind, [...found].map(([key, count]) => ({ key, count })), "count").slice(0, REGISTER_SEARCH_MAX);
		searchCache.set(cacheKey, out);
		return out;
	}
	const spelled = await catalogSpelling(q);
	const [facetHits, text] = await Promise.all([
		catalogIndex()
			.searchForFacetValues({ facetName: info.keyField, facetQuery: words.map((w) => w[0]).join(" "), filter: OWN })
			.then((r) => r.facetHits)
			.catch(() => []),
		catalogIndex()
			.search(spelled, { filter: OWN, limit: 0, facets: [info.keyField], matchingStrategy: "all" })
			.catch(() => null),
	]);
	for (const h of facetHits) if (keyMatchesQuery(h.value, words)) found.set(h.value, h.count);
	// Schlüssel aus Einheiten, deren Text die Eingabe enthält: dort nur innerhalb dieser
	// Treffer gezählt, darum einzeln nachzählen.
	const textDist = ((text?.facetDistribution ?? {}) as Record<string, Record<string, number>>)[info.keyField] ?? {};
	const extra = sortRegisterKeys(
		info.kind,
		Object.entries(textDist)
			.filter(([key]) => !found.has(key) && keyMatchesQuery(key, words))
			.map(([key, count]) => ({ key, count })),
		"count",
	).slice(0, SEARCH_RECOUNT_MAX);
	for (const batch of chunks(extra, BATCH)) {
		const res = await client.multiSearch({
			queries: batch.map((e) => ({ indexUid: MEILI_CATALOG_INDEX, q: "", filter: `${OWN} AND ${info.keyField} = ${quote(e.key)}`, limit: 0 })),
		});
		res.results.forEach((r, i) => found.set(batch[i].key, r.estimatedTotalHits ?? batch[i].count));
	}
	const out = sortRegisterKeys(
		info.kind,
		[...found].map(([key, count]) => ({ key, count })),
		"count",
	).slice(0, REGISTER_SEARCH_MAX);
	searchCache.set(cacheKey, out);
	return out;
}

// --- Seite ------------------------------------------------------------------------------

export interface RegisterPage {
	entries: RegisterEntry[];
	/** Bestandsprägende Einträge (nur in der Liste, Seite 1). */
	constants: RegisterEntry[];
	/** Einträge der Liste bzw. Suche (ohne die bestandsprägenden in der Liste). */
	total: number;
	page: number;
	pages: number;
	/** Liste: nur die häufigsten Einträge (Facette gekappt). Suche: Treffer gekappt. */
	capped: boolean;
}

/** Eine Seite des Registers; null, wenn der Katalog nicht lesbar ist. */
export async function registerPage(info: RegisterKindInfo, query: RegisterQuery): Promise<RegisterPage | null> {
	const list = await registerList(info);
	if (!list) return null;
	const searching = query.q !== "";
	let items: KeyCount[];
	try {
		items = searching ? await searchKeys(info, query.q, list) : list.main;
	} catch (err) {
		console.warn(`[catalog-register] Suche «${query.q}» in ${info.slug}: ${(err as Error).message}`);
		return null;
	}
	const sorted = sortRegisterKeys(info.kind, items, query.sort);
	const pages = Math.max(1, Math.ceil(sorted.length / REGISTER_PAGE_SIZE));
	const page = Math.min(query.page, pages);
	const slice = sorted.slice((page - 1) * REGISTER_PAGE_SIZE, page * REGISTER_PAGE_SIZE);
	const constants = !searching && page === 1 ? list.constants : [];
	let entries: Map<string, RegisterEntry>;
	try {
		entries = await entriesFor(info, [...slice, ...constants].map((e) => e.key), list.sizes);
	} catch (err) {
		console.warn(`[catalog-register] Einträge ${info.slug}: ${(err as Error).message}`);
		return null;
	}
	const pick = (items: KeyCount[]) => items.flatMap((e) => entries.get(e.key) ?? []);
	return {
		entries: pick(slice),
		constants: pick(constants),
		total: sorted.length,
		page,
		pages,
		capped: searching ? items.length >= REGISTER_SEARCH_MAX : list.capped,
	};
}

/**
 * Die ersten `n` Treffer einer Suche im Register und ihre Zahl (Namenssuche der Übersicht
 * /register): dieselbe Suche wie die Registerseite, nur `n` Einträge aufgelöst. null, wenn der
 * Katalog nicht lesbar ist.
 */
export async function registerPreview(
	info: RegisterKindInfo,
	q: string,
	n: number,
): Promise<{ entries: RegisterEntry[]; total: number; capped: boolean } | null> {
	const list = await registerList(info);
	if (!list) return null;
	try {
		const items = sortRegisterKeys(info.kind, await searchKeys(info, q, list), "count");
		const top = items.slice(0, n);
		const entries = await entriesFor(info, top.map((e) => e.key), list.sizes);
		return { entries: top.flatMap((e) => entries.get(e.key) ?? []), total: items.length, capped: items.length >= REGISTER_SEARCH_MAX };
	} catch (err) {
		console.warn(`[catalog-register] Vorschau «${q}» in ${info.slug}: ${(err as Error).message}`);
		return null;
	}
}

// --- Dieselben Namen in den Dokumenten -------------------------------------------------------

export interface RegisterDocLink {
	/** Formen für den Link in die Dokumentsuche: mit Vergleichsschlüsseln im Index `documents`
	 *  die Anzeigeform, sonst die Formen dort mit demselben Schlüssel. */
	forms: string[];
	/** Dokumente, die der Link liefert. */
	count: number;
	/** Der Link findet auch andere Schreibungen (Vergleichsschlüssel im Index `documents`). */
	variants?: boolean;
}

const DOC_FORMS_MAX = 10;
const DOC_LINK_PARALLEL = 6;
const DOC_LINK_BUDGET_MS = 8000;
const docLinkCache = createTtlLruCache<RegisterDocLink | null>({ maxEntries: 20_000, ttlMs: 60 * 60_000 });

/** Formen eines Namens in den Entitäts-Facetten der Dokumente (gleicher Schlüssel). */
async function docFormsFor(info: RegisterKindInfo, entry: { key: string; form: string }): Promise<string[]> {
	const res = await getIndex().searchForFacetValues({ facetName: info.formField, facetQuery: entry.form });
	return res.facetHits
		.map((h) => h.value)
		.filter((v) => entityKey(info.kind, v) === entry.key)
		.slice(0, DOC_FORMS_MAX);
}

/**
 * Links in die Dokumentsuche für die Einträge einer Seite (Schlüssel → Formen und Zahl),
 * nur wo die Dokumente den Namen kennen. Trägt der documents-Index die Vergleichsschlüssel,
 * filtert die Dokumentsuche einen Namen nach Form oder Schlüssel (Fassung 2): dann führt der
 * Link mit der Anzeigeform dorthin, und eine multiSearch zählt für alle, was er liefert
 * (documentEntityClause). Sonst je Eintrag eine Facettensuche nach den Formen mit demselben
 * Schlüssel, dann eine multiSearch für alle Zahlen. Höchstens DOC_LINK_BUDGET_MS: was bis
 * dahin fehlt, bleibt ohne Link (und ist beim nächsten Aufruf meist gecacht).
 */
export async function registerDocLinks(
	kind: EntityKind,
	entries: ReadonlyArray<{ key: string; form: string }>,
): Promise<Record<string, RegisterDocLink>> {
	const info = registerKind(kind);
	const keyed = await entityKeysReady();
	// Je Verfahren eigene Einträge: nach dem Nachrüsten der Schlüssel nichts Veraltetes.
	const cacheKey = (key: string) => `${keyed ? "key" : "form"}:${info.kind}:${key}`;
	const out: Record<string, RegisterDocLink> = {};
	const queue: Array<{ key: string; form: string }> = [];
	for (const e of entries) {
		const cached = docLinkCache.get(cacheKey(e.key));
		if (cached) out[e.key] = cached;
		else if (cached === undefined && !queue.some((q) => q.key === e.key)) queue.push(e);
	}
	if (queue.length === 0) return out;
	const forms = new Map<string, string[]>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, DOC_LINK_BUDGET_MS);
	});
	const work = async () => {
		// Mit Schlüsseln genügt die Anzeigeform (keine Facettensuche).
		if (keyed) for (const e of queue) forms.set(e.key, [e.form]);
		const pending = keyed ? [] : [...queue];
		const worker = async () => {
			for (let e = pending.shift(); e; e = pending.shift()) {
				try {
					forms.set(e.key, await docFormsFor(info, e));
				} catch (err) {
					console.warn(`[catalog-register] Dokumente zu «${e.form}»: ${(err as Error).message}`);
				}
			}
		};
		await Promise.all(Array.from({ length: DOC_LINK_PARALLEL }, worker));
		for (const e of queue) if (forms.get(e.key)?.length === 0) docLinkCache.set(cacheKey(e.key), null);
		// Dieselbe Klausel wie die Dokumentsuche (ohne Schlüssel: die Formen exakt).
		const counted = queue.flatMap((e) => {
			const filter = documentEntityClause(info.formField, forms.get(e.key) ?? [], keyed, quote);
			return filter ? [{ e, filter }] : [];
		});
		if (counted.length === 0) return;
		const res = await client.multiSearch({
			queries: counted.map(({ filter }) => ({ indexUid: MEILI_INDEX, q: "", filter, limit: 0 })),
		});
		res.results.forEach((r, i) => {
			const { e } = counted[i];
			const count = r.estimatedTotalHits ?? 0;
			const link = count > 0 ? { forms: forms.get(e.key) ?? [], count, ...(keyed ? { variants: true } : {}) } : null;
			docLinkCache.set(cacheKey(e.key), link);
			if (link) out[e.key] = link;
		});
	};
	try {
		await Promise.race([work().catch((err) => console.warn(`[catalog-register] Dokumente: ${(err as Error).message}`)), deadline]);
	} finally {
		clearTimeout(timer);
	}
	return { ...out };
}

// --- Namen einer Verzeichnungseinheit (Detailseite) ----------------------------------------

const UNIT_BUDGET_MS = 1500;

/**
 * Personen, Orte und Organisationen einer Einheit mit der Zahl der Einheiten gleichen
 * Namens (eine multiSearch, höchstens UNIT_BUDGET_MS, sonst ohne Zahlen). Personen mit
 * einer der KRDB-IDs der Einheit (`krdbIds`, gesichert) und passendem Namen verweisen
 * auf ihre Personenseite.
 */
export async function unitEntities(unit: {
	persons?: string[];
	places?: string[];
	organizations?: string[];
	krdbIds?: number[];
}): Promise<UnitEntities> {
	const out: UnitEntities = { person: [], place: [], org: [] };
	const krdbPersons = (unit.krdbIds ?? []).flatMap((id) => resolveKrdbPerson(id)?.person ?? []);
	for (const info of REGISTER_KINDS) {
		const seen = new Set<string>();
		for (const raw of unit[info.formField] ?? []) {
			const form = raw.replace(/\s+/g, " ").trim();
			const key = form ? entityKey(info.kind, form) : null;
			if (!key || seen.has(key)) continue;
			seen.add(key);
			const krdb = info.kind === "person" ? krdbPersons.filter((p) => krdbNameMatchesKey(p, key)) : [];
			out[info.kind].push({
				form,
				key,
				count: null,
				krdb: krdb.length === 1 ? { id: krdb[0].id, name: personName(krdb[0]) } : null,
			});
		}
	}
	const all = REGISTER_KINDS.flatMap((info) => out[info.kind].map((e) => ({ info, e })));
	if (all.length === 0) return out;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const res = await Promise.race([
			client.multiSearch({
				queries: all.map(({ info, e }) => ({
					indexUid: MEILI_CATALOG_INDEX,
					q: "",
					filter: `${OWN} AND ${info.keyField} = ${quote(e.key)}`,
					limit: 0,
				})),
			}),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), UNIT_BUDGET_MS);
			}),
		]);
		res?.results.forEach((r, i) => {
			all[i].e.count = r.estimatedTotalHits ?? null;
		});
		if (!res) console.warn(`[catalog-register] Namen der Einheit: über ${UNIT_BUDGET_MS} ms, ohne Zahlen`);
	} catch (err) {
		console.warn(`[catalog-register] Namen der Einheit nicht zählbar: ${(err as Error).message}`);
	} finally {
		clearTimeout(timer);
	}
	return out;
}

// --- Auswahlfelder Personen/Orte/Organisationen im Katalog-Reiter --------------------------

/** Vorschläge je Feld (wie die Entitätsfelder der Dokumentsuche). */
const SUGGEST_MAX = 20;
/** Seltene Namen aus der Registersuche, die in der Treffermenge nachgezählt werden. */
const SUGGEST_RECOUNT_MAX = 30;
const contextDists = createTtlLruCache<{ dist: Record<string, number>; capped: boolean }>({
	maxEntries: 200,
	ttlMs: 5 * 60_000,
	maxKeyLen: 4000,
});

/**
 * Vorschläge für ein Auswahlfeld im Katalog-Reiter: die Namen der aktuellen Treffermenge
 * (Suchbegriff, ODER-Begriffe, «nur im Titel», Feldsuche, Zeitraum, Katalog-Filter und die
 * übrigen Namensfelder; ohne die Auswahl dieses Feldes, wie die Dokumentsuche), häufigste
 * zuerst, mit `fq` auf passende Wortanfänge eingegrenzt (registerQueryWords). Die Zahl zählt in
 * der Treffermenge, mit ODER-Begriffen in der Vereinigung wie die Liste (catalogLexical,
 * gemergte Facette). Ist die Facette gekappt (über 2'000 Namen), ergänzt die Registersuche
 * seltene Namen, nachgezählt in der Treffermenge. Das Thema bleibt unaufgelöst – es reiht
 * nur (wie facetQueryBase).
 */
export function catalogEntitySuggestions(
	kind: EntityKind,
	context: Pick<SearchParams, "q" | "anyTerms" | "titleOnly">,
	filters: CatalogFilters,
	fq: string,
): Promise<Array<{ value: string; count: number }>> {
	return withCatalogFallback(() => entitySuggestions(kind, context, filters, fq));
}

async function entitySuggestions(
	kind: EntityKind,
	context: Pick<SearchParams, "q" | "anyTerms" | "titleOnly">,
	filters: CatalogFilters,
	fq: string,
): Promise<Array<{ value: string; count: number }>> {
	const info = registerKind(kind);
	// Suchbegriff, ODER-Begriffe und Feldsuche wie die Liste; eine zu breite Feldsuche trifft nichts.
	const scope = await catalogFieldScope(lexicalOf(context), { ...filters, entities: { ...(filters.entities ?? NO_ENTITY_FILTER), [kind]: [] } });
	if (scope.tooBroad) return [];
	const { lex, filter } = scope;
	// Gehasht: mit Feldsuche trägt der Filter bis zu 10'000 IDs.
	const ctxKey = createHash("sha256").update(JSON.stringify([kind, lex.q, lex.terms, lexicalSearchOn(lex) ?? null, filter])).digest("hex");
	let ctx = contextDists.get(ctxKey);
	if (!ctx) {
		const dist = (await catalogFacetDistribution(lex, filter, [info.keyField]))[info.keyField] ?? {};
		ctx = { dist, capped: Object.keys(dist).length >= FACET_CAP };
		contextDists.set(ctxKey, ctx);
	}
	const words = registerQueryWords(kind, fq);
	const found = new Map<string, number>(Object.entries(ctx.dist).filter(([key]) => words.length === 0 || keyMatchesQuery(key, words)));
	const list = await registerList(info);
	if (words.length > 0 && ctx.capped && list) {
		const extra = (await searchKeys(info, fq, list)).filter((e) => !found.has(e.key)).slice(0, SUGGEST_RECOUNT_MAX);
		const counts = await countCatalogSets(lex, extra.map((e) => `${filter} AND ${info.keyField} = ${quote(e.key)}`));
		counts.forEach((count, i) => {
			if (count > 0) found.set(extra[i].key, count);
		});
	}
	const top = sortRegisterKeys(
		kind,
		[...found].map(([key, count]) => ({ key, count })),
		"count",
	).slice(0, SUGGEST_MAX);
	const entries = await entriesFor(info, top.map((e) => e.key), list?.sizes ?? {});
	return top.flatMap((e) => {
		const entry = entries.get(e.key);
		return entry ? [{ value: entry.form, count: e.count }] : [];
	});
}
