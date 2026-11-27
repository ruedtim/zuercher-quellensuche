/**
 * Meili-Index `ehedaten`: Eheeinträge der Ehedatenbank des Staatsarchivs (Aufbau:
 * services/catalog, ehedaten.ts). Rein lexikalisch. Eine Abfrage-Schicht für den Reiter
 * «Ehedaten» der Suchseite, die Ehe-Karte der Katalogseite, /api/v1/ehedaten und MCP;
 * Filter und Anzeige pur in $lib/ehedaten.ts, die geprüften
 * Mehrfacheinträge (Einträge derselben Ehe) in ehedatenMehrfach.ts.
 *
 * Wie die interaktive Dokumentsuche strikt (`matchingStrategy: "all"`, Ausschlüsse vorn);
 * ODER-Begriffe als föderierte Suche wie im Archivkatalog (catalogUnion.ts). Namen, Herkunft
 * und Zusatzinfo kommen maskiert zurück (sanitizeMarks).
 *
 * ß und ss gelten als gleich, sobald der Index gefaltete Suchfelder trägt (foldedSearch.ts, wie im
 * Archivkatalog); gezeigt wird das Original. Die Namensfilter (Namenswörter) und die Orte
 * (Vergleichsschlüssel) falten ß ohnehin ($lib/entityKey.ts), Filter und Vorschläge auf ganze Werte
 * (Herkunft mit Land, Kirchgemeinde) gelten in beiden Schreibungen.
 */

import { MEILI_EHEDATEN_INDEX, MEILI_SEARCH_KEY, MEILI_URL } from "./env";
import { markTerms } from "./highlight";
import { sanitizeMarks } from "./krdbPeople";
import {
	catalogLexical,
	isCatalogUnion,
	lexicalSearchOn,
	unionFacets,
	unionSearchBody,
	type CatalogLexical,
	type CatalogUnion,
} from "./catalogUnion";
import { personKey } from "$lib/entityKey";
import { foldSharpS, sharpSSpellings } from "$lib/sharpS";
import {
	EHEDATEN_TITLE_FIELDS,
	ehedatenFilter,
	nameTokens,
	type EhedatenArt,
	type EhedatenEntry,
	type EhedatenFacetCounts,
	type EhedatenFilters,
	type EhedatenFilterValues,
	type EhedatenHit,
	type EhedatenResult,
	type EhedatenShared,
	type EhedatenTimeline,
} from "$lib/ehedaten";
import type { SearchParams } from "$lib/types";
import { distinctMarriagesOf, sameMarriageOf } from "./ehedatenMehrfach";
import { browseLimitOf, browseWindow } from "./browseLimit";
import { createFoldSwitch, unfoldHit, withFolded } from "./foldedSearch";
import { createMeiliClient } from "./meiliClient";
import { idsOnly, isDeepPage, pageOnly, searchDeepPage, type PageId } from "./deepPage";

const client = createMeiliClient(MEILI_URL, MEILI_SEARCH_KEY);
const index = () => client.index(MEILI_EHEDATEN_INDEX);

const READY_MS = 30_000;
let ready: boolean | null = null;
let readyAt = 0;

/** Gefaltete Suchfelder im Index (ß als ss): Stand der letzten Prüfung von ehedatenReady(). Die
 *  Felder, die ein gefaltetes haben können, wie in services/catalog (searchText.ts). */
const folding = createFoldSwitch(
	"ehedaten",
	["mannName", "frauName", "mannHerkunft", "frauHerkunft", "mannZusatz", "frauZusatz", "kirchgemeinde"],
	(searchOn) => index().search("", { limit: 0, attributesToSearchOn: searchOn }),
);

/** Index vorhanden, gefüllt und für den Such-Key lesbar? (30 s gecacht) */
export async function ehedatenReady(): Promise<boolean> {
	if (ready !== null && Date.now() - readyAt < READY_MS) return ready;
	try {
		const stats = await index().getStats();
		ready = stats.numberOfDocuments > 0;
		await folding.update(stats.fieldDistribution);
	} catch (err) {
		// 403 (Such-Key deckt `ehedaten` nicht ab) oder Index fehlt: Reiter aus.
		if (ready !== false) console.warn(`[ehedaten] Index ${MEILI_EHEDATEN_INDEX} nicht lesbar: ${(err as Error).message}`);
		ready = false;
		await folding.update(null);
	}
	readyAt = Date.now();
	return ready;
}

/** Index-Dokument, wie die Web-App es liest (displayedAttributes in services/catalog). */
interface EhedatenRaw {
	id: number;
	signatur: string;
	band: string;
	eintrag: number | null;
	quelle: string;
	seite: string;
	kirchgemeinde: string;
	art: EhedatenArt;
	datum: string;
	isoVon: string;
	isoBis: string;
	dateFrom: number;
	dateTo: number;
	titel: string;
	mannNachname: string;
	mannVorname: string;
	mannName: string;
	mannHerkunft: string;
	mannOrt: string;
	mannZusatz: string;
	mannHls: string;
	mannGnd: string;
	frauNachname: string;
	frauVorname: string;
	frauName: string;
	frauHerkunft: string;
	frauOrt: string;
	frauZusatz: string;
	frauHls: string;
	frauGnd: string;
	unsicher?: boolean;
	_formatted?: Partial<Record<"mannName" | "frauName" | "mannHerkunft" | "frauHerkunft" | "mannZusatz" | "frauZusatz", string>>;
}

const RETRIEVE = [
	"id",
	"signatur",
	"band",
	"eintrag",
	"quelle",
	"seite",
	"kirchgemeinde",
	"art",
	"datum",
	"isoVon",
	"isoBis",
	"dateFrom",
	"dateTo",
	"titel",
	"mannNachname",
	"mannVorname",
	"mannName",
	"mannHerkunft",
	"mannOrt",
	"mannZusatz",
	"mannHls",
	"mannGnd",
	"frauNachname",
	"frauVorname",
	"frauName",
	"frauHerkunft",
	"frauOrt",
	"frauZusatz",
	"frauHls",
	"frauGnd",
	"unsicher",
];
const HIGHLIGHT = ["mannName", "frauName", "mannHerkunft", "frauHerkunft", "mannZusatz", "frauZusatz"] as const;
const MARKS = { highlightPreTag: '<mark class="match">', highlightPostTag: "</mark>" };
const FACETS = ["kirchgemeinde", "raum", "quelle", "art"];
/** Wie `maxValuesPerFacet` des Index (services/catalog ehedatenSettings.ts). */
const FACET_VALUES_MAX = 1000;

function toEntry(h: EhedatenRaw): EhedatenEntry {
	const person = (who: "mann" | "frau") => ({
		vorname: h[`${who}Vorname` as const] ?? "",
		nachname: h[`${who}Nachname` as const] ?? "",
		name: h[`${who}Name` as const] ?? "",
		herkunft: h[`${who}Herkunft` as const] ?? "",
		ort: h[`${who}Ort` as const] ?? "",
		zusatz: h[`${who}Zusatz` as const] ?? "",
		hls: h[`${who}Hls` as const] ?? "",
		gnd: h[`${who}Gnd` as const] ?? "",
	});
	return {
		id: h.id,
		signatur: h.signatur ?? "",
		band: h.band ?? "",
		eintrag: h.eintrag ?? null,
		quelle: h.quelle ?? "",
		seite: h.seite ?? "",
		kirchgemeinde: h.kirchgemeinde ?? "",
		art: h.art === "verkuendung" ? "verkuendung" : "trauung",
		datum: h.datum ?? "",
		isoVon: h.isoVon ?? "",
		isoBis: h.isoBis ?? "",
		dateFrom: h.dateFrom,
		dateTo: h.dateTo,
		titel: h.titel ?? "",
		mann: person("mann"),
		frau: person("frau"),
		unsicher: h.unsicher === true,
	};
}

function toHit(h: EhedatenRaw, extraTerms: readonly string[]): EhedatenHit {
	const html = Object.fromEntries(
		HIGHLIGHT.map((f) => {
			const raw = h._formatted?.[f] ?? h[f] ?? "";
			// ODER: Meili markiert nur den Begriff des liefernden Zweigs (catalogUnion.ts).
			return [f, sanitizeMarks(extraTerms.length > 0 ? markTerms(raw, [...extraTerms], "match") : raw)];
		}),
	) as EhedatenHit["html"];
	return { ...toEntry(h), html };
}

/** Suchbegriff, ODER-Begriffe und «nur im Titel» (= Namen und Herkunft) wie im Archivkatalog, in
 *  der Schreibung des Index. */
function lexicalOf(params: Pick<SearchParams, "q" | "titleOnly"> & { anyTerms?: readonly string[] }): CatalogLexical {
	const lex = catalogLexical(params, folding.on);
	return { ...lex, searchOn: lex.searchOn ? EHEDATEN_TITLE_FIELDS : undefined };
}

/** Nach Datum, sonst nach Relevanz (braucht Suchbegriff oder ODER-Begriffe), ohne beide chronologisch. */
function sortRules(sort: SearchParams["sort"], lex: Pick<CatalogLexical, "q" | "terms">): string[] | undefined {
	if (sort === "date_desc") return ["sortDate:desc"];
	if (sort === "date_asc" || (lex.q === "" && lex.terms === null)) return ["sortDate:asc"];
	return undefined;
}

function lexicalOptions(lex: CatalogLexical) {
	const searchOn = lexicalSearchOn(lex);
	return { matchingStrategy: "all" as const, ...(lex.q && searchOn ? { attributesToSearchOn: searchOn } : {}) };
}

/** Treffer, wie sie gezeigt werden: Hervorhebung der gefalteten Felder am Original. */
function shownHits(hits: EhedatenRaw[], lex: CatalogLexical): EhedatenRaw[] {
	if (!lex.fold) return hits;
	return hits.map((h) => unfoldHit(h, HIGHLIGHT, { pre: MARKS.highlightPreTag, post: MARKS.highlightPostTag }));
}

interface FederatedResult {
	hits: EhedatenRaw[];
	estimatedTotalHits?: number;
	processingTimeMs?: number;
	facetDistribution?: Record<string, Record<string, number>>;
	facetStats?: Record<string, { min: number; max: number }>;
}
type MultiSearchArg = Parameters<typeof client.multiSearch>[0];

async function federate(lex: CatalogUnion, filter: string, federation: Record<string, unknown>, perBranch?: Record<string, unknown>) {
	const body = unionSearchBody(lex, MEILI_EHEDATEN_INDEX, filter, federation, perBranch);
	return (await client.multiSearch(body as unknown as MultiSearchArg)) as unknown as FederatedResult;
}

/** Filter auf bestimmte Einträge (Seiten der zweistufigen Pfade). */
const idInClause = (ids: readonly PageId[]) => `id IN [${ids.join(", ")}]`;

function facetCounts(distribution: unknown): EhedatenFacetCounts {
	const fd = (distribution ?? {}) as Record<string, Record<string, number>>;
	return { kirchgemeinde: fd.kirchgemeinde ?? {}, raum: fd.raum ?? {}, quelle: fd.quelle ?? {}, art: fd.art ?? {} };
}

/** Eine Seite Treffer mit Facetten (Liste, API, MCP). */
async function page(
	lex: CatalogLexical,
	filter: string,
	sort: SearchParams["sort"],
	window: { offset: number; limit: number },
	facets: string[],
	highlight: boolean,
): Promise<{ hits: EhedatenRaw[]; total: number; ms: number; distribution: Record<string, Record<string, number>> }> {
	const rules = sortRules(sort, lex);
	const marked = highlight && (lex.q || lex.terms) ? [...HIGHLIGHT] : [];
	const format = {
		attributesToRetrieve: RETRIEVE,
		attributesToHighlight: lex.fold ? withFolded(marked) : marked,
		...MARKS,
		...(rules ? { sort: rules } : {}),
	};
	// Tiefe Seiten zweistufig (deepPage.ts): Meili v1.56 holte und formatierte sonst jeden
	// Eintrag bis zum Offset, die Föderation tut das in jeder Version.
	const deep = isDeepPage(window.offset, window.limit);
	if (isCatalogUnion(lex)) {
		const federation = { ...window, ...(facets.length > 0 ? unionFacets(MEILI_EHEDATEN_INDEX, facets, FACET_VALUES_MAX) : {}) };
		const res = deep
			? await searchDeepPage<EhedatenRaw, FederatedResult>({
					ids: () => federate(lex, filter, federation, idsOnly(format)),
					format: (ids) => federate(lex, idInClause(ids), { offset: 0, limit: ids.length }, format),
				})
			: await federate(lex, filter, federation, format);
		return { hits: shownHits(res.hits, lex), total: res.estimatedTotalHits ?? res.hits.length, ms: res.processingTimeMs ?? 0, distribution: res.facetDistribution ?? {} };
	}
	const body = {
		filter: filter || undefined,
		...window,
		facets: facets.length > 0 ? facets : undefined,
		...format,
		...lexicalOptions(lex),
	};
	const run = async (b: Record<string, unknown>) => (await index().search(lex.q, b)) as unknown as FederatedResult;
	const res = deep
		? await searchDeepPage<EhedatenRaw, FederatedResult>({
				ids: () => run(idsOnly(body)),
				format: (ids) => run(pageOnly(body, idInClause(ids), ids.length)),
			})
		: await run(body);
	return {
		hits: shownHits(res.hits, lex),
		total: res.estimatedTotalHits ?? res.hits.length,
		ms: res.processingTimeMs ?? 0,
		distribution: res.facetDistribution ?? {},
	};
}

/** Zeitleiste ohne Zeitraumfilter (Anfangs- und Endjahre, Zählung nach Berührung wie im Katalog). */
async function timeline(lex: CatalogLexical, filters: EhedatenFilterValues, shared: EhedatenShared): Promise<EhedatenTimeline | null> {
	const filter = ehedatenFilter(filters, { ...shared, dateFrom: null, dateTo: null });
	try {
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_EHEDATEN_INDEX, ["dateFrom", "dateTo"], FACET_VALUES_MAX) })
			: await index().search(lex.q, { filter: filter || undefined, limit: 0, facets: ["dateFrom", "dateTo"], ...lexicalOptions(lex) });
		const fd = (res.facetDistribution ?? {}) as Record<string, Record<string, number>>;
		const stats = (res.facetStats ?? {}) as Record<string, { min: number; max: number }>;
		return { from: fd.dateFrom ?? {}, to: fd.dateTo ?? {}, min: stats.dateFrom?.min ?? null, max: stats.dateTo?.max ?? null };
	} catch (err) {
		console.warn(`[ehedaten] Zeitleiste nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

type PageParams = Pick<SearchParams, "q" | "anyTerms" | "titleOnly" | "sort" | "page" | "pageSize" | "dateFrom" | "dateTo" | "persons" | "places">;

/** Facetten der Filterspalte und der Filter, den ihre Auswahl setzt (Drill-Sideways). */
const SIDEWAYS: ReadonlyArray<{ facet: keyof EhedatenFacetCounts; clear: (f: EhedatenFilterValues) => EhedatenFilterValues; set: (f: EhedatenFilterValues) => boolean }> = [
	{ facet: "kirchgemeinde", clear: (f) => ({ ...f, kirche: [] }), set: (f) => f.kirche.length > 0 },
	{ facet: "raum", clear: (f) => ({ ...f, raum: [] }), set: (f) => f.raum.length > 0 },
	{ facet: "quelle", clear: (f) => ({ ...f, quelle: [] }), set: (f) => f.quelle.length > 0 },
	{ facet: "art", clear: (f) => ({ ...f, art: null }), set: (f) => f.art !== null },
];

/**
 * Zählung einer Facette ohne ihre eigene Auswahl: Mit «Uster» gewählt zeigt die Liste der
 * Kirchgemeinden weiter die übrigen mit ihren Zahlen (wie die Facetten der Dokumentsuche).
 */
async function sidewaysFacet(lex: CatalogLexical, filter: string, facet: string): Promise<Record<string, number>> {
	try {
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_EHEDATEN_INDEX, [facet], FACET_VALUES_MAX) })
			: await index().search(lex.q, { filter: filter || undefined, limit: 0, facets: [facet], ...lexicalOptions(lex) });
		return ((res.facetDistribution ?? {}) as Record<string, Record<string, number>>)[facet] ?? {};
	} catch {
		return {};
	}
}

/** Reiter «Ehedaten» der Suchseite: eine Seite mit Hervorhebung, Facetten und Zeitleiste, bis zum
 *  Deckel fürs Blättern (browseLimit.ts; dahinter nur Zahlen und Facetten). */
export function searchEhedaten(params: PageParams, filters: EhedatenFilters, opts: { overview?: boolean } = {}): Promise<EhedatenResult> {
	return folding.withFallback(() => tabPage(params, filters, opts));
}

async function tabPage(params: PageParams, filters: EhedatenFilters, opts: { overview?: boolean }): Promise<EhedatenResult> {
	const lex = lexicalOf(params);
	const filter = ehedatenFilter(filters, params);
	const window = browseWindow(params);
	// overview: Block im Reiter «Alle Quellen» – ohne Zeitleiste und Drill-Sideways.
	const sideways = opts.overview ? [] : SIDEWAYS.filter((s) => s.set(filters));
	const [res, tl, ...side] = await Promise.all([
		page(lex, filter, params.sort, window, FACETS, true),
		opts.overview ? Promise.resolve<EhedatenTimeline | null>(null) : timeline(lex, filters, params),
		...sideways.map((s) => sidewaysFacet(lex, ehedatenFilter(s.clear(filters), params), s.facet)),
	]);
	const facets = facetCounts(res.distribution);
	sideways.forEach((s, i) => (facets[s.facet] = side[i]));
	return {
		hits: res.hits.map((h) => toHit(h, lex.highlight)),
		total: res.total,
		processingTimeMs: res.ms,
		page: params.page,
		pageSize: params.pageSize,
		facets,
		timeline: tl,
		...browseLimitOf(res.total),
	};
}

/** Trefferzahl fürs Reiter-Label in den anderen Reitern; null bei Fehler. */
export async function countEhedaten(
	params: Pick<SearchParams, "q" | "anyTerms" | "titleOnly" | "dateFrom" | "dateTo" | "persons" | "places">,
	filters: EhedatenFilterValues,
): Promise<number | null> {
	const filter = ehedatenFilter(filters, params);
	try {
		return await folding.withFallback(async () => {
			const lex = lexicalOf(params);
			const res = isCatalogUnion(lex)
				? await federate(lex, filter, { offset: 0, limit: 0 })
				: await index().search(lex.q, { filter: filter || undefined, limit: 0, ...lexicalOptions(lex) });
			return res.estimatedTotalHits ?? 0;
		});
	} catch {
		return null;
	}
}

/** Ein Eintrag über seine Katalog-ID; null, wenn er fehlt oder der Index nicht lesbar ist. */
export async function getEhedatenEntry(id: number): Promise<EhedatenEntry | null> {
	if (!Number.isInteger(id) || id <= 0) return null;
	try {
		return toEntry((await index().getDocument(id, { fields: RETRIEVE })) as unknown as EhedatenRaw);
	} catch {
		return null;
	}
}

/** Einträge über ihre Katalog-IDs in einer Abfrage, nach Datum; fehlende fallen weg. */
export async function getEhedatenEntries(ids: readonly number[]): Promise<EhedatenEntry[]> {
	const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
	if (wanted.length === 0) return [];
	const res = await index().search("", {
		filter: `id IN [${wanted.join(", ")}]`,
		sort: ["sortDate:asc"],
		limit: wanted.length,
		attributesToRetrieve: RETRIEVE,
	});
	return (res.hits as unknown as EhedatenRaw[]).map(toEntry);
}

/** Die übrigen Einträge einer geprüften Ehe (Liste der Mehrfacheinträge), nach Datum. */
export interface EhedatenSameMarriage {
	/** false = laut Liste nur wahrscheinlich dieselbe Ehe. */
	sicher: boolean;
	entries: EhedatenEntry[];
}

/**
 * Geprüfte Ehen mehrerer Einträge (API, MCP): die übrigen Einträge je
 * Katalog-ID, alle in einer Abfrage nachgeladen. Einträge ohne Listeneintrag (oder deren
 * Partner im Index fehlen) fehlen in der Map; ist der Index nicht lesbar, ist sie leer.
 */
export async function sameMarriages(entries: readonly Pick<EhedatenEntry, "id">[]): Promise<Map<number, EhedatenSameMarriage>> {
	const listed = entries.flatMap((e) => {
		const m = sameMarriageOf(e.id);
		return m ? [{ id: e.id, m }] : [];
	});
	const out = new Map<number, EhedatenSameMarriage>();
	if (listed.length === 0) return out;
	let found: EhedatenEntry[];
	try {
		found = await getEhedatenEntries(listed.flatMap((l) => l.m.ids));
	} catch (err) {
		console.warn(`[ehedaten] Einträge geprüfter Ehen nicht lesbar: ${(err as Error).message}`);
		return out;
	}
	const byId = new Map(found.map((e) => [e.id, e]));
	for (const { id, m } of listed) {
		const others = m.ids.flatMap((x) => byId.get(x) ?? []).sort((a, b) => a.isoVon.localeCompare(b.isoVon) || a.id - b.id);
		if (others.length > 0) out.set(id, { sicher: m.sicher, entries: others });
	}
	return out;
}

/** So weit auseinander dürfen Einträge derselben Ehe liegen (Verkündung, Trauung, Abschrift). */
const SAME_COUPLE_YEARS = 1;

/**
 * Weitere Einträge mit denselben Namen (Personenschlüssel beider, entityKey.ts) höchstens
 * SAME_COUPLE_YEARS Jahre auseinander – meist dieselbe Ehe, verkündet in der einen, getraut
 * in der anderen Kirchgemeinde. Nicht geprüft: gleichnamige Paare sind möglich.
 */
export async function sameCoupleEntries(e: EhedatenEntry): Promise<EhedatenEntry[]> {
	const mann = personKey(e.mann.name);
	const frau = personKey(e.frau.name);
	if (!mann || !frau) return [];
	try {
		const res = await index().search("", {
			filter: `mannKey = "${mann}" AND frauKey = "${frau}" AND id != ${e.id} AND dateTo >= ${e.dateFrom - SAME_COUPLE_YEARS} AND dateFrom <= ${e.dateTo + SAME_COUPLE_YEARS}`,
			sort: ["sortDate:asc"],
			limit: 10,
			attributesToRetrieve: RETRIEVE,
		});
		return (res.hits as unknown as EhedatenRaw[]).map(toEntry);
	} catch (err) {
		console.warn(`[ehedaten] Einträge derselben Ehe von ${e.id} nicht lesbar: ${(err as Error).message}`);
		return [];
	}
}

/** Was die Ehe-Karte unter dem Eintrag zeigt. */
export interface EhedatenRelated {
	/** Weitere Einträge derselben Ehe laut geprüfter Liste; null, wenn die Liste den Eintrag
	 *  nicht führt. */
	sameMarriage: EhedatenSameMarriage | null;
	/** Weitere Einträge mit denselben Namen nahe beim Datum (Heuristik, ungeprüft) – ohne die
	 *  der Liste und ohne die, die nach ihren Angaben eine andere Ehe sind (distinctMarriagesOf). */
	sameCouple: EhedatenEntry[];
}

/**
 * Ehe-Karte: zuerst die geprüfte Liste, dazu die Namens-Heuristik nur mit dem, was die Liste
 * nicht hat (ein dritter Eintrag derselben Ehe, Ehen ausserhalb der Liste) – kein Eintrag
 * zweimal.
 */
export async function ehedatenRelated(e: EhedatenEntry): Promise<EhedatenRelated> {
	const [marriages, couple] = await Promise.all([sameMarriages([e]), sameCoupleEntries(e)]);
	const sameMarriage = marriages.get(e.id) ?? null;
	const skip = new Set([...(sameMarriageOf(e.id)?.ids ?? []), ...distinctMarriagesOf(e.id)]);
	return { sameMarriage, sameCouple: couple.filter((c) => !skip.has(c.id)) };
}

// --- Abfragen für API und MCP ---------------------------------------------------------

export type EhedatenGroupBy = "kirchgemeinde" | "jahr" | "jahrzehnt" | "raum" | "art" | "quelle";

export interface EhedatenQuery {
	/** Volltext (Namen, Herkunft, Zusatzinfo, Kirchgemeinde, Signatur), strikt. */
	q: string;
	/** ODER-Begriffe, ab zwei als Vereinigung wie im Reiter (der Suchbegriff hängt an jedem). */
	anyTerms?: string[];
	/** Suchbegriff und ODER-Begriffe nur in Namen und Herkunft («nur im Titel» des Reiters). */
	titleOnly?: boolean;
	sort: SearchParams["sort"];
	offset: number;
	limit: number;
	filters: EhedatenFilterValues;
	shared: EhedatenShared;
	/** Zählungen der ganzen Treffermenge. */
	groupBy?: EhedatenGroupBy[];
	/** Hervorhebung in `hits` (MCP und API brauchen sie nicht). */
	highlight?: boolean;
}

export interface EhedatenQueryResult {
	entries: EhedatenEntry[];
	total: number;
	processingTimeMs: number;
	/** Zählungen je Wert, absteigend (Jahre und Jahrzehnte aufsteigend). */
	counts: Partial<Record<EhedatenGroupBy, Array<{ value: string; count: number }>>>;
}

const GROUP_FACET: Record<EhedatenGroupBy, string> = {
	kirchgemeinde: "kirchgemeinde",
	jahr: "dateFrom",
	jahrzehnt: "dateFrom",
	raum: "raum",
	art: "art",
	quelle: "quelle",
};

function grouped(by: EhedatenGroupBy, dist: Record<string, number>): Array<{ value: string; count: number }> {
	if (by === "jahr") return Object.entries(dist).map(([value, count]) => ({ value, count })).sort((a, b) => Number(a.value) - Number(b.value));
	if (by === "jahrzehnt") {
		const decades = new Map<number, number>();
		for (const [y, n] of Object.entries(dist)) {
			const d = Math.floor(Number(y) / 10) * 10;
			decades.set(d, (decades.get(d) ?? 0) + n);
		}
		return [...decades.entries()].sort((a, b) => a[0] - b[0]).map(([d, count]) => ({ value: `${d}er`, count }));
	}
	return Object.entries(dist)
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de"));
}

/** Eine Abfrage für /api/v1/ehedaten, und MCP (ehedaten_search). */
export async function queryEhedaten(query: EhedatenQuery): Promise<EhedatenQueryResult> {
	const filter = ehedatenFilter(query.filters, query.shared);
	const groups = [...new Set(query.groupBy ?? [])];
	const facets = [...new Set(groups.map((g) => GROUP_FACET[g]))];
	const res = await folding.withFallback(() => {
		const lex = lexicalOf({ q: query.q, anyTerms: query.anyTerms, titleOnly: query.titleOnly === true });
		return page(lex, filter, query.sort, { offset: query.offset, limit: query.limit }, facets, query.highlight === true);
	});
	const counts: EhedatenQueryResult["counts"] = {};
	for (const g of groups) counts[g] = grouped(g, res.distribution[GROUP_FACET[g]] ?? {});
	return { entries: res.hits.map(toEntry), total: res.total, processingTimeMs: res.ms, counts };
}

// --- Vorschläge der Felder im Reiter ------------------------------------------------

export type EhedatenSuggestDim = "persons" | "herkunft" | "kirchgemeinde" | "band";

/** So viele Vorschläge liefert ein Feld höchstens. */
const SUGGEST_MAX = 30;

/**
 * Vorschläge für ein Feld des Reiters, gezählt in der aktuellen Auswahl ohne den Filter des
 * Feldes selbst (Drill-Sideways). Herkunft, Kirchgemeinde und Band über Meilis
 * Facettensuche (Wortanfang, Tippfehler; leer = häufigste zuerst), mit ss und, weil sie ß nicht
 * angleicht, für Werte mit ß auch mit ß. Namen über eine Suche in
 * den Namen: Meilis Facettensuche findet nur Anfänge des ganzen Werts («Hans Jakob …»), nicht
 * den Nachnamen – hier zählen die Namen der Treffer, deren Wörter mit den eingegebenen
 * beginnen.
 */
export function ehedatenSuggestions(
	dim: EhedatenSuggestDim,
	fq: string,
	params: PageParams,
	filters: EhedatenFilterValues,
): Promise<Array<{ value: string; count: number }>> {
	return folding.withFallback(() => suggestions(dim, fq, params, filters));
}

async function suggestions(
	dim: EhedatenSuggestDim,
	fq: string,
	params: PageParams,
	filters: EhedatenFilterValues,
): Promise<Array<{ value: string; count: number }>> {
	const lex = lexicalOf(params);
	const own: EhedatenFilterValues = {
		...filters,
		kirche: dim === "kirchgemeinde" ? [] : filters.kirche,
		band: dim === "band" ? [] : filters.band,
	};
	const sharedOwn: EhedatenShared = {
		dateFrom: params.dateFrom,
		dateTo: params.dateTo,
		persons: dim === "persons" ? [] : params.persons,
		places: dim === "herkunft" ? [] : params.places,
	};
	const filter = ehedatenFilter(own, sharedOwn);
	const text = fq.replace(/\s+/g, " ").trim().slice(0, 100);
	if (dim === "persons") {
		if (!text) return [];
		const words = nameTokens(text);
		if (words.length === 0) return [];
		// Name im Suchbegriff: nur in den Namen, alle Wörter; die Treffer zählen beide Personen.
		const name = lex.fold ? foldSharpS(text) : text;
		const names = ["mannName", "frauName"];
		const res = await index().search(lex.q ? `${lex.q} ${name}` : name, {
			filter: filter || undefined,
			limit: 0,
			facets: ["persons"],
			attributesToSearchOn: lex.fold ? withFolded(names) : names,
			matchingStrategy: "all",
		});
		const dist = (res.facetDistribution?.persons ?? {}) as Record<string, number>;
		return Object.entries(dist)
			.filter(([form]) => {
				const ws = nameTokens(form);
				return words.every((w) => ws.some((x) => x.startsWith(w)));
			})
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de"))
			.slice(0, SUGGEST_MAX);
	}
	if (!text) {
		const res = isCatalogUnion(lex)
			? await federate(lex, filter, { offset: 0, limit: 0, ...unionFacets(MEILI_EHEDATEN_INDEX, [dim], FACET_VALUES_MAX) })
			: await index().search(lex.q, { filter: filter || undefined, limit: 0, facets: [dim], ...lexicalOptions(lex) });
		const dist = ((res.facetDistribution ?? {}) as Record<string, Record<string, number>>)[dim] ?? {};
		return grouped("kirchgemeinde", dist).slice(0, SUGGEST_MAX);
	}
	const [ss, ...others] = await Promise.all(
		sharpSSpellings(text).map((facetQuery) =>
			index().searchForFacetValues({ facetName: dim, facetQuery, q: lex.terms ? "" : lex.q, filter: filter || undefined, ...lexicalOptions(lex) }),
		),
	);
	const counts = new Map(ss.facetHits.map((h) => [h.value, h.count]));
	for (const h of others.flatMap((r) => r.facetHits)) if (h.value.includes("ß")) counts.set(h.value, h.count);
	return [...counts]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, SUGGEST_MAX);
}
