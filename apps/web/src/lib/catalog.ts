/**
 * Archivkatalog: Reiter «Archivkatalog» der Suchseite und Detailseiten
 * `/archivkatalog/<ID>` – Typen, URL-Parameter, Anzeige-Helfer (Server und
 * Browser). Suchbegriff (`q`), ODER-Begriffe (`qAny`), Thema (`theme`, `topK`),
 * «nur im Titel», Sortierung und Seite teilt der Reiter mit der Dokumentsuche; den Zeitraum
 * liest er selbst, weil der Katalog vor 1483 zurückreicht (Urkunden ab dem
 * 9. Jh.) und die Dokumentsuche dort kappt. Den Reiter wählt `view=catalog`
 * (searchViews.ts, früher `catView=1`). Eigene Filter: `catLevel`, `catBestand`
 * (wiederholt), `catDigital=1` und die Feldsuche (`catSig`, `catTitle`, `catText`,
 * `catProv`, catalogFields.ts); sie bleiben auch in den anderen Reitern in der URL,
 * damit sie beim Zurückwechseln wieder gelten.
 * Personen, Orte und Organisationen (`persons`/`places`/`organizations`) teilen
 * sich beide Reiter ebenfalls: die Dokumente filtern die Form oder ihren Schlüssel
 * (entityFilter.ts), der Katalog nur den Vergleichsschlüssel (catalogRegister.ts);
 * Formen ohne Schlüssel wirken nur auf die Dokumente.
 * Pur, unit-getestet in catalog.test.ts.
 */

import { parseEntityFilter, unkeyedEntityCount, type CatalogEntityFilter } from "./catalogRegister";
import { parseSearchView, type SearchView } from "./searchViews";
import { parseCatalogFields, writeCatalogFields, type CatalogFieldEntry } from "./catalogFields";
import { entityKey, type EntityKind } from "./entityKey";
import type { SpanCounts } from "./timelineBins";
import type { SearchParams } from "./types";

export const CATALOG_YEAR_MIN = 700;
export const CATALOG_YEAR_MAX = 2100;

/** Wurzel des Archivplans («Staatsarchiv Zürich»), Einstieg von `/archivkatalog`. */
export const CATALOG_ROOT_ID = 1;

/** So viele Untereinheiten lädt der Archivbaum auf einmal. */
export const CATALOG_TREE_PAGE = 25;

/** Permalink im Online-Katalog («URL für diese Verz.-Einheit» des Staatsarchivs). */
export function catalogPermalink(id: number): string {
	return `https://archivkatalog.ji.zh.ch/detail.aspx?ID=${id}`;
}

/** Detailseite der Plattform. */
export function catalogUnitHref(id: number): string {
	return `/archivkatalog/${id}`;
}

/**
 * Hinweis «Katalog noch im Aufbau» in Reiter, API-Hinweis und MCP-Beschreibung.
 * Aus seit dem Vollstand (Crawl
 * fertig 2026-11-09, am selben Tag ganz auf Prod geladen). Für einen Neuaufbau,
 * bei dem Einheiten fehlen, wieder auf true setzen, dazu /about/archivkatalog,
 * /about/ai und llms.txt von Hand.
 */
export const CATALOG_IN_PROGRESS = false;
/** Bis wann der Katalog voraussichtlich vollständig ist (nur mit CATALOG_IN_PROGRESS). */
export const CATALOG_COMPLETE_BY = "voraussichtlich November 2026";

export interface CatalogFilters {
	/** true = Reiter «Archivkatalog» aktiv. */
	active: boolean;
	dateFrom: number | null;
	dateTo: number | null;
	level: string[];
	bestand: string[];
	/** nur Einheiten mit Digitalisat */
	digital: boolean;
	/** Personen, Orte, Organisationen (Formen mit Vergleichsschlüssel, aus den geteilten
	 *  Parametern `persons`/`places`/`organizations`); fehlt = keine. */
	entities?: CatalogEntityFilter;
	/** Feldsuche: Suchbegriffe nur in einem Feld (catalogFields.ts); fehlt = keine. Der
	 *  Server löst sie vor jeder Abfrage auf (withFieldSearch, lib/server/catalog.ts). */
	fields?: CatalogFieldEntry[];
}

/**
 * Meili-Filterklauseln für einen Zeitraum über `dateFrom`/`dateTo` der Einheiten:
 * Einheiten, deren Entstehungszeitraum ihn berührt (Reiter, Zeitleiste, API, MCP;
 * Entscheid 2026-10-28); leer ohne Grenzen. Einheiten ohne Datum fallen bei jeder
 * Grenze weg (der Aufbau setzt beide Jahre oder keines). Bis 2026-11 teilte der
 * Recherche-Modus der Website die Berührung zusätzlich in «ganz darin» und
 * «überstehend» auf.
 */
export function catalogDateClauses(from: number | null, to: number | null): string[] {
	return [from != null ? `dateTo >= ${from}` : "", to != null ? `dateFrom <= ${to}` : ""].filter(Boolean);
}

export interface CatalogHit {
	id: number;
	signature: string;
	/** Titel mit Hervorhebungen, bereits maskiert (sanitizeMarks). */
	titleHtml: string;
	/** Auszug aus Regest/«Inhalt und Form», maskiert; leer ohne Text. */
	textHtml: string;
	level: string;
	dateText: string;
	bestand: string | null;
	/** Direkter Elternknoten (letztes Glied des Archivplan-Pfads). */
	parent: string | null;
	hasDigitization: boolean;
	/** Links auf die Digitalisate im Online-Katalog (Download bzw. Bildansicht). */
	files: CatalogFileLink[];
	/** Zahl aller Digitalisate (kann grösser sein als `files`). */
	fileCount: number;
	url: string;
	/** Plattform-Dokument, das die Einheit abbildet (nur bei einer Suche nach Signatur). */
	doc: { series: string; id: string } | null;
}

export interface CatalogFileLink {
	label: string;
	url: string;
	/** Dateiname im Katalog (Tooltip). */
	title: string;
}

export interface CatalogResult {
	hits: CatalogHit[];
	total: number;
	processingTimeMs: number;
	page: number;
	pageSize: number;
	facets: CatalogFacetCounts;
	/** Zeitleiste: Treffer ohne Zeitraumfilter; null, wenn die Abfrage scheiterte. */
	timeline: CatalogTimeline | null;
	/** Wie das Thema gewirkt hat (catalogThemeMode); fehlt ohne wirksames Thema. */
	theme?: {
		mode: Exclude<CatalogThemeMode, "none">;
		/** Thema-Reihung bei Relevanz: so viele Treffer sind gereiht und durchblätterbar
		 *  (`total` zählt alle), fehlt, wenn alle durchblätterbar sind. */
		rankedPool?: number;
		/** Datums-Sortierung: Umfang K und Grösse der Menge, aus der die K ähnlichsten stammen. */
		topK?: number;
		topKOfTotal?: number;
	};
	/** Thema gesetzt, aber keine der Einheiten hat einen Vektor (Personendossiers,
	 *  Ehedaten, Firmen): die Liste steht ohne Thema-Reihung. */
	themeWithoutVectors?: boolean;
	/** Feldsuche zu breit: Jede Bedingung trifft für sich mehr Einheiten, als der Server
	 *  schneiden kann (planFieldSearch); die Liste bleibt leer. */
	fieldsTooBroad?: boolean;
	/** Ohne Thema: so viele Einheiten lassen sich durchblättern (`total` zählt alle), fehlt, wenn alle. */
	browseLimit?: number;
}

export interface CatalogFacetCounts {
	level: Record<string, number>;
	bestand: Record<string, number>;
	digital: number;
}

/**
 * Wie das Thema (jina-Vektoren des Katalogs, wie im Index `documents`) im Reiter wirkt,
 * gleich wie in der Dokumentsuche: bei Relevanz reiht es die Treffermenge nach
 * Ähnlichkeit («rank»; die Menge bildet der Suchbegriff, ohne ihn alle Einheiten der
 * Filter), bei Datums-Sortierung wählt es die K ähnlichsten, die dann nach Datum
 * sortiert werden («topK», Themen-Umfang). Ohne Thema oder ohne Vektoren «none».
 */
export type CatalogThemeMode = "none" | "rank" | "topK";

export function catalogThemeMode(p: Pick<SearchParams, "theme" | "sort">, semantic: boolean): CatalogThemeMode {
	if (!semantic || !p.theme.trim()) return "none";
	return p.sort === "relevance" ? "rank" : "topK";
}

/** Jahresverteilung der Treffer für die Zeitleiste (Zählung nach Berührung, timelineBins.ts). */
export interface CatalogTimeline extends SpanCounts {
	/** Frühestes Anfangs- und spätestes Endjahr der datierten Treffer; null ohne datierte. */
	min: number | null;
	max: number | null;
	/** Treffer ohne lesbares Datum (fehlen in der Zeitleiste). */
	undated: number;
}

/** Knoten des Archivbaums (Detailseite, `/api/catalog/children`). */
export interface CatalogTreeNode {
	id: number;
	signature: string;
	title: string;
	level: string;
	dateText: string;
	childCount: number;
	/** Stufe bisher nur aus dem Archivplan-Pfad bekannt (noch nicht übernommen). */
	stub: boolean;
	hasDigitization: boolean;
	/** Plattform-Dokument, das die Einheit abbildet (Zentrale Serien, Ratsmanuale). */
	doc: { series: string; id: string } | null;
}

export interface CatalogChildren {
	total: number;
	items: CatalogTreeNode[];
}

/** Archivbaum als Startansicht des Reiters: die Stufen unter der Wurzel, jede schon einmal
 *  aufgeklappt (`open`: Katalog-ID → Untereinheiten). */
export interface CatalogTreeStart {
	root: CatalogChildren;
	open: Record<number, CatalogChildren>;
}

/** Nachbarn einer Einheit im Archivplan (Detailseite): vorige und nächste Einheit derselben
 *  Stufe, Position ab 1 und Zahl der Geschwister. */
export interface CatalogNeighbors {
	prev: CatalogTreeNode | null;
	next: CatalogTreeNode | null;
	pos: number;
	total: number;
}

/** Verweis in einem Feld der Detailseite: Katalogeinheit (`id`) oder Webadresse (`href`). */
export interface CatalogFieldLink {
	text: string;
	id?: number;
	href?: string;
}

export interface CatalogUnitField {
	label: string;
	text: string;
	links?: CatalogFieldLink[];
}

export interface CatalogUnitSection {
	title: string;
	fields: CatalogUnitField[];
}

function year(raw: string | null): number | null {
	if (!raw || !/^\d{1,4}$/.test(raw.trim())) return null;
	return Math.min(CATALOG_YEAR_MAX, Math.max(CATALOG_YEAR_MIN, Number(raw)));
}

function list(values: string[]): string[] {
	return [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, 20);
}

export function parseCatalogFilters(url: URL): CatalogFilters {
	const sp = url.searchParams;
	return {
		active: parseSearchView(sp) === "catalog",
		dateFrom: year(sp.get("dateFrom")),
		dateTo: year(sp.get("dateTo")),
		level: list(sp.getAll("catLevel")),
		bestand: list(sp.getAll("catBestand")),
		digital: sp.get("catDigital") === "1",
		entities: parseEntityFilter(sp),
		fields: parseCatalogFields(sp),
	};
}

/**
 * Schreibt die Katalog-eigenen Parameter (Stufe, Bestand, Digitalisat, Feldsuche) in `url`;
 * den Reiter schreibt writeSearchView. Suchbegriff, Thema, «nur im Titel» und Zeitraum teilen
 * sich die Reiter, die schreibt searchParamsToUrl.
 */
export function writeCatalogParams(url: URL, f: Pick<CatalogFilters, "level" | "bestand" | "digital" | "fields">): URL {
	const sp = url.searchParams;
	for (const k of ["catLevel", "catBestand", "catDigital"]) sp.delete(k);
	for (const v of f.level) sp.append("catLevel", v);
	for (const v of f.bestand) sp.append("catBestand", v);
	if (f.digital) sp.set("catDigital", "1");
	writeCatalogFields(sp, f.fields ?? []);
	return url;
}

/**
 * Zeitraum-Jahr für die nächste Such-URL. Die Dokumentsuche (und mit ihr der Reiter
 * «Ehedaten») kappt Jahre vor 1483 (parseSearchParams), Katalog und Editionen erst vor 700.
 * Steht in einem kappenden Reiter noch unverändert der gekappte Wert (`state` = `documents`),
 * bleibt das Jahr der URL (`catalog`, z. B. 900) stehen und gilt beim Zurückwechseln wieder.
 */
export function carriedYear(view: SearchView, state: number | null, documents: number | null, catalog: number | null): number | null {
	return !UNCLAMPED_YEAR_VIEWS.includes(view) && state === documents ? catalog : state;
}

/** Reiter, deren Zeitraum wie der Archivkatalog ab Jahr 700 gilt (Editionen: Rechtsquellen ab 1180, QZH ab 1275; «Alle Quellen»: Katalog und Editionen darin). */
export const UNCLAMPED_YEAR_VIEWS: readonly SearchView[] = ["all", "catalog", "editions"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Was im Reiter «Archivkatalog» gesetzt ist, aber nur die Dokumente filtert – der Hinweis in
 * der Filterspalte («wirkt nur auf die Dokumente»). ODER-Begriffe gelten in beiden Reitern.
 * Das Thema nur, wenn der Katalog es nicht reihen kann (`catalogSemantic` falsch). Personen,
 * Orte und Organisationen filtern auch den Katalog (über ihren Vergleichsschlüssel); hier
 * zählen nur Formen ohne Schlüssel, etwa ein Nachname ohne Vornamen.
 */
export function documentsOnlyFilters(
	p: Pick<SearchParams, "series" | "persons" | "places" | "organizations" | "volumeNr" | "startPg" | "serialNr" | "resolutionId" | "years" | "theme">,
	catalogSemantic: boolean,
): string[] {
	const out: string[] = [];
	if (p.series.length > 0) out.push(`${p.series.length === 1 ? "Serie" : "Serien"} ${p.series.join(", ")}`);
	const persons = unkeyedEntityCount("person", p.persons);
	const places = unkeyedEntityCount("place", p.places);
	const orgs = unkeyedEntityCount("org", p.organizations);
	if (persons > 0) out.push(plural(persons, "Person ohne Vornamen", "Personen ohne Vornamen"));
	if (places > 0) out.push(plural(places, "Ort", "Orte"));
	if (orgs > 0) out.push(plural(orgs, "Organisation", "Organisationen"));
	if ([p.volumeNr, p.startPg, p.serialNr, p.resolutionId, p.years].some((v) => v.length > 0)) out.push("Filter der Serie");
	if (p.theme.trim() && !catalogSemantic) out.push("Thema");
	return out;
}

/**
 * Klappen im Reiter «Archivkatalog» die «Erweiterten Suchoptionen» von selbst auf? Wie in der
 * Dokumentsuche (autoOpensAdvanced) steht ausserhalb nur die lexikalische Suche; aufklappen
 * lässt alles, was nur darin zu sehen wäre: ODER-Begriffe, das Thema (nur wenn der Katalog es
 * reihen kann, sonst fehlt das Feld), der Themen-Umfang, Namen mit Vergleichsschlüssel (Formen
 * ohne wirken nur auf die Dokumente) und die Filter des Katalogs – Stufe, Bestand, Digitalisat
 * und die Feldsuche. Der Zeitraum nicht: eingeklappt steht er als Pill unter dem Schalter.
 */
export function catalogAutoOpensAdvanced(
	p: Pick<SearchParams, "anyTerms" | "theme" | "topK" | "persons" | "places" | "organizations">,
	f: Pick<CatalogFilters, "level" | "bestand" | "digital" | "fields">,
	catalogSemantic: boolean,
): boolean {
	const keyed = (kind: EntityKind, values: readonly string[]) => values.some((v) => entityKey(kind, v));
	return (
		p.anyTerms.length > 0 ||
		(catalogSemantic && p.theme.trim() !== "") ||
		p.topK != null ||
		keyed("person", p.persons) ||
		keyed("place", p.places) ||
		keyed("org", p.organizations) ||
		f.level.length > 0 ||
		f.bestand.length > 0 ||
		f.digital ||
		(f.fields ?? []).length > 0
	);
}

type DatedUnit = { dateFrom?: number | null; dateTo?: number | null };

/** Einheiten nach Anfangsjahr (bei gleichem nach Endjahr), undatierte zuletzt – Datums-
 *  Sortierung der K ähnlichsten (Thema + Datum), wie `dateFrom:asc|desc` der Liste. */
export function sortByCatalogDate<T extends DatedUnit>(hits: readonly T[], sort: "date_asc" | "date_desc"): T[] {
	const dir = sort === "date_desc" ? -1 : 1;
	return hits
		.map((hit, i) => ({ hit, i }))
		.sort((a, b) => {
			const fa = a.hit.dateFrom ?? null;
			const fb = b.hit.dateFrom ?? null;
			if (fa == null || fb == null) return fa == null && fb == null ? a.i - b.i : fa == null ? 1 : -1;
			return dir * (fa - fb) || dir * ((a.hit.dateTo ?? fa) - (b.hit.dateTo ?? fb)) || a.i - b.i;
		})
		.map(({ hit }) => hit);
}

/** Zeitleiste aus einer festen Treffermenge (die K ähnlichsten): Anfangs- und Endjahre. */
export function catalogTimelineOf(hits: readonly DatedUnit[]): CatalogTimeline {
	const from: Record<string, number> = {};
	const to: Record<string, number> = {};
	let min: number | null = null;
	let max: number | null = null;
	let undated = 0;
	for (const h of hits) {
		if (h.dateFrom == null) {
			undated++;
			continue;
		}
		const end = h.dateTo ?? h.dateFrom;
		from[h.dateFrom] = (from[h.dateFrom] ?? 0) + 1;
		to[end] = (to[end] ?? 0) + 1;
		min = min == null ? h.dateFrom : Math.min(min, h.dateFrom);
		max = max == null ? end : Math.max(max, end);
	}
	return { from, to, min, max, undated };
}

/**
 * Stufen, die die Zeitleiste des Reiters zählt: ohne Stufenwahl nur die unteren (Dossier,
 * Subdossier, Dokument; Tim 2026-11-01) – ein Bestand oder eine Klasse 1803–2000 zählte sonst
 * in jedem dieser Jahre (Prod 2026-11-01, Jahr 1850: 7'106 Einheiten, davon 2'448 obere Stufen).
 * Wählt die Filterspalte Stufen, zählen genau diese, auch obere. Ein Feld «ohne Untereinheiten»
 * gibt es im Index nicht; Dossiers mit Subdossiers (Prod ~9'000 von 345'000) zählen doppelt.
 */
export const CATALOG_TIMELINE_LEVELS: readonly string[] = ["Dossier", "Subdossier", "Dokument"];

export function catalogTimelineLevels(level: readonly string[]): string[] {
	return level.length > 0 ? [...level] : [...CATALOG_TIMELINE_LEVELS];
}

/**
 * Stufen nach einem Klick in die Zeitleiste (Tim 2026-11-01): Ohne Stufenwahl setzt ein Jahr
 * oder Bereich die unteren Stufen, die der Balken zählt – die Liste zeigt dann so viele
 * Einheiten wie der Balken. Gewählte Stufen bleiben. Hebt die Zeitleiste den Zeitraum auf
 * («Alle Jahre») und stehen genau die unteren Stufen, fallen sie wieder weg.
 */
export function catalogTimelineClickLevels(level: readonly string[], from: number | null, to: number | null): string[] {
	if (from == null && to == null) {
		const same = level.length === CATALOG_TIMELINE_LEVELS.length && CATALOG_TIMELINE_LEVELS.every((l) => level.includes(l));
		return same ? [] : [...level];
	}
	return catalogTimelineLevels(level);
}

/**
 * Zeigt der Reiter «Archivkatalog» statt der Trefferliste den Archivbaum (Tim 2026-11-01)?
 * Ja, solange nichts die Menge eingrenzt oder ordnet: kein Suchbegriff, keine ODER-Begriffe,
 * kein Thema, das der Katalog reihen kann, kein Zeitraum, keine Namen mit Vergleichsschlüssel,
 * keine Stufe, kein Bestand, kein Digitalisat, keine Feldsuche und keine gewählte Sortierung
 * (`sort` fehlt in der URL ⇒ «relevance»; «Alle Einheiten als Liste» setzt sie). Was nur die
 * Dokumente filtert (Serie, Namen ohne Schlüssel, «nur im Titel» ohne Suchbegriff), zählt nicht.
 */
export function catalogShowsTree(
	p: Pick<SearchParams, "q" | "anyTerms" | "theme" | "sort" | "persons" | "places" | "organizations">,
	f: Pick<CatalogFilters, "dateFrom" | "dateTo" | "level" | "bestand" | "digital" | "fields">,
	catalogSemantic: boolean,
): boolean {
	const keyed = (kind: EntityKind, values: readonly string[]) => values.some((v) => entityKey(kind, v));
	return !(
		p.q.trim() !== "" ||
		p.anyTerms.some((t) => t.trim() !== "") ||
		(catalogSemantic && p.theme.trim() !== "") ||
		p.sort !== "relevance" ||
		f.dateFrom != null ||
		f.dateTo != null ||
		keyed("person", p.persons) ||
		keyed("place", p.places) ||
		keyed("org", p.organizations) ||
		f.level.length > 0 ||
		f.bestand.length > 0 ||
		f.digital ||
		(f.fields ?? []).length > 0
	);
}

/** Facetten der Filterspalte aus einer festen Treffermenge (die K ähnlichsten). */
export function catalogFacetsOf(hits: ReadonlyArray<{ level?: string; bestand?: string | null; hasDigitization?: boolean }>): CatalogFacetCounts {
	const level: Record<string, number> = {};
	const bestand: Record<string, number> = {};
	let digital = 0;
	for (const h of hits) {
		if (h.level) level[h.level] = (level[h.level] ?? 0) + 1;
		if (h.bestand) bestand[h.bestand] = (bestand[h.bestand] ?? 0) + 1;
		if (h.hasDigitization) digital++;
	}
	return { level, bestand, digital };
}

const FILE_TYPE: Record<string, string> = {
	pdf: "PDF",
	jpg: "Bild",
	jpeg: "Bild",
	png: "Bild",
	tif: "Bild",
	tiff: "Bild",
	mp3: "Audio",
	wav: "Audio",
	mp4: "Video",
	mov: "Video",
};

/** Beschriftungen für Digitalisat-Links: Dateityp bzw. «Bildansicht», nummeriert bei mehreren gleichen. */
export function digitalLinks(files: ReadonlyArray<{ name: string; url: string; kind: string }>): CatalogFileLink[] {
	const labels = files.map((f) => {
		if (f.kind === "image") return "Bildansicht";
		const ext = /\.([a-z0-9]{2,4})(?:$|\?)/i.exec(f.url)?.[1]?.toLowerCase() ?? "";
		return FILE_TYPE[ext] ?? "Datei";
	});
	const total = new Map<string, number>();
	for (const l of labels) total.set(l, (total.get(l) ?? 0) + 1);
	const seen = new Map<string, number>();
	return files.map((f, i) => {
		const l = labels[i];
		const n = (seen.get(l) ?? 0) + 1;
		seen.set(l, n);
		return { label: (total.get(l) ?? 0) > 1 ? `${l} ${n}` : l, url: f.url, title: f.name };
	});
}

/** Entstehungszeitraum zur Anzeige: Spannen mit Halbgeviertstrich («1934 – 1935»). */
export function formatCatalogDate(dateText: string | null | undefined): string {
	return (dateText ?? "").replace(/ - /g, " – ").replace(/(\d|Jh\.)-(\d)/g, "$1–$2").trim();
}

/** Verzeichnungsstufen des Archivplans (Feld `level`, Etiketten «… (Dossier)»). */
export const CATALOG_LEVELS = [
	"Archiv",
	"Hauptabteilung",
	"Abteilung",
	"Bestand",
	"Teilbestand",
	"Klasse",
	"Unterklasse",
	"Serie",
	"Dossier",
	"Subdossier",
	"Dokument",
] as const;

const LABEL_LEVEL = new RegExp(` \\((${CATALOG_LEVELS.join("|")})\\)$`);
const LABEL_ATOM = String.raw`(?:\d{1,2}\. ?Jh\.|\d{3,4}(?:\.\d{2}){0,2})(?: \(ca\.\))?`;
const LABEL_DATE = new RegExp(String.raw`^(.*?), (${LABEL_ATOM}-(?:${LABEL_ATOM})?|-?${LABEL_ATOM})$`);

/** Datumsglied eines Etiketts: «1272.09.12» → «12.09.1272», «05. Jh.» → «5. Jh.», «1600 (ca.)» → «ca. 1600». */
function labelAtom(atom: string): string {
	const ca = atom.endsWith(" (ca.)");
	const core = ca ? atom.slice(0, -" (ca.)".length) : atom;
	const ymd = /^(\d{3,4})(?:\.(\d{2}))?(?:\.(\d{2}))?$/.exec(core);
	const out = ymd ? [ymd[3], ymd[2], ymd[1]].filter(Boolean).join(".") : core.replace(/^0(\d)\./, "$1.");
	return ca ? `ca. ${out}` : out;
}

/** Datum eines Etiketts in der Schreibweise der Einheiten («1803-» → «ab 1803», «-1900» →
 *  «bis 1900», Spannen mit Halbgeviertstrich), wie services/catalog `labelDateToCatalog`. */
function labelDate(date: string): string {
	const dash = date.indexOf("-");
	if (dash < 0) return labelAtom(date);
	const from = date.slice(0, dash);
	const to = date.slice(dash + 1);
	if (!from) return `bis ${labelAtom(to)}`;
	if (!to) return `ab ${labelAtom(from)}`;
	return `${labelAtom(from)} – ${labelAtom(to)}`;
}

/**
 * Archivplan-Etikett «U 94 - U 112 Universität, 1800-1987 (Klasse)» → Name mit
 * Signatur («U 94 - U 112 Universität»), Datum («1800 – 1987») und Stufe.
 */
export function splitCatalogLabel(label: string): { name: string; date: string | null; level: string | null } {
	let name = label.trim();
	const lv = LABEL_LEVEL.exec(name);
	const level = lv ? lv[1] : null;
	if (lv) name = name.slice(0, lv.index);
	const d = LABEL_DATE.exec(name);
	return d ? { name: d[1].trim(), date: labelDate(d[2]), level } : { name, date: null, level };
}

/** Archivplan-Stufe zur Anzeige (Kontext auf der Katalog- und der Dokumentseite). */
export interface CatalogPathNode {
	id: number;
	/** Name mit Signatur, ohne Datum und Stufe (splitCatalogLabel). */
	name: string;
	date: string | null;
	level: string | null;
	/** Etikett wie im Online-Katalog (Tooltip). */
	label: string;
}

/** Etikett der Wurzel; der Index führt die Pfade ohne sie. */
const CATALOG_ROOT_LABEL = "Staatsarchiv Zürich (Archiv)";

/** Archivplan von der Wurzel bis zur Elternstufe einer Einheit (`path` im Index ohne Wurzel). */
export function catalogAncestors(id: number, path: ReadonlyArray<{ id: number; label: string }> | undefined): CatalogPathNode[] {
	const nodes = id === CATALOG_ROOT_ID ? [] : [{ id: CATALOG_ROOT_ID, label: CATALOG_ROOT_LABEL }, ...(path ?? [])];
	return nodes.map((n) => ({ id: n.id, ...splitCatalogLabel(n.label), label: n.label }));
}

/** Ohne Bestand darüber stehen höchstens so viele Stufen als Treppe im Archivplan-Kontext. */
const CONTEXT_STAIRS_MAX = 4;

/**
 * Archivplan-Kontext der Detailseite: Die Stufen über dem nächsten Bestand (Archiv,
 * Haupt-, Abteilungen) stehen als eine Zeile (`line`), ab dem Bestand als Treppe mit Datum
 * und Stufe (`stairs`); ohne Bestand darüber die letzten CONTEXT_STAIRS_MAX Stufen. Blieben
 * für die Zeile höchstens zwei Stufen, steht alles in der Treppe.
 */
export function splitArchivePath<T extends { level: string | null }>(path: readonly T[]): { line: T[]; stairs: T[] } {
	let start = -1;
	for (let i = path.length - 1; i >= 0 && start < 0; i--) if (path[i].level === "Bestand") start = i;
	if (start < 0) start = Math.max(0, path.length - CONTEXT_STAIRS_MAX);
	if (start <= 2) start = 0;
	return { line: path.slice(0, start), stairs: path.slice(start) };
}

/** Längere Titel kürzen Archivbaum und Archivplan-Kontext (Zeichen); ganz im Tooltip. */
export const TREE_TITLE_MAX = 140;

/** Signatur und Titel eines Knotens in einer Zeile. */
export function treeNodeName(node: { signature: string; title: string }): string {
	return (node.signature ? `${node.signature} ${node.title}` : node.title).replace(/\s+/g, " ").trim() || "(ohne Titel)";
}

/** Urkunden tragen Regest-lange Titel: auf TREE_TITLE_MAX Zeichen gekürzt, an einer Wortgrenze. */
export function shortTreeName(name: string): string {
	return name.length > TREE_TITLE_MAX ? `${name.slice(0, TREE_TITLE_MAX).replace(/\s+\S*$/, "")} …` : name;
}

/** Position unter den Geschwistern: «3 von 4 in «Landwirtschaft»», allein «einzige Einheit in …». */
export function catalogPositionLabel(pos: number, total: number, parent: string): string {
	const nf = new Intl.NumberFormat("de-CH");
	const where = parent ? ` in «${parent}»` : "";
	return total <= 1 ? `einzige Einheit${where}` : `${nf.format(pos)} von ${nf.format(total)}${where}`;
}

/** Signatur mit Kürzel des Staatsarchivs («StAZH U 110.6.1902»); ohne Signatur
 *  «Staatsarchiv Zürich». */
export function catalogSignatureLabel(signature: string): string {
	const sig = signature.trim();
	return sig ? `StAZH ${sig}` : "Staatsarchiv Zürich";
}

/**
 * Zitiervorschlag: Signatur mit Kürzel des Staatsarchivs, Titel, Entstehungszeitraum
 * und Permalink des Online-Katalogs, z. B. «StAZH U 110.6.1902, Akte, 1935;
 * https://archivkatalog.ji.zh.ch/detail.aspx?ID=…». Ohne Signatur «Staatsarchiv Zürich».
 */
export function catalogCitation(unit: { id: number; signature: string; title: string; dateText: string }): string {
	const head = catalogSignatureLabel(unit.signature);
	const title = unit.title.replace(/\s+/g, " ").trim();
	const parts = [head, title === head ? "" : title, formatCatalogDate(unit.dateText)];
	return `${parts.filter(Boolean).join(", ")}; ${catalogPermalink(unit.id)}`;
}

/** Eine Zeile eines Feldes; mit `href` als Verweis (extern = neuer Tab, ↗), mit `note` als
 *  Text mit gedämpftem Zusatz (Weblink ohne Plattform-Dokument). */
export interface CatalogFieldLine {
	text: string;
	href?: string;
	external?: boolean;
	note?: string;
}

export type CatalogLinkResolver = (link: CatalogFieldLink) => { href: string; external: boolean } | { note: string } | null;

const ZS_WEBLINK = /^https?:\/\/(?:www\.)?zentraleserien\.zh\.ch\/documents\//i;

/** Zusatz zum Weblink «Volltext und Digitalisat», wenn das Dokument auf der Plattform fehlt. */
export const ZS_WEBLINK_MISSING = "auf der Plattform nicht vorhanden";

/**
 * Verweise der Detailseite: Einheiten im Index auf ihre Plattform-Seite, übrige in den
 * Online-Katalog; der Weblink der Zentralen Serien (alte Adresse zentraleserien.zh.ch)
 * auf das Plattform-Dokument der Einheit – ohne Dokument (der Aufbau fand es auf der Plattform
 * nicht; Prod 2026-11-09 fehlt es auch beim Staatsarchiv) kein Link, nur der Zusatz; sonst nur http(s).
 */
export function catalogLinkResolver(known: ReadonlySet<number>, doc: { series: string; id: string } | null): CatalogLinkResolver {
	return (link) => {
		if (link.id != null) {
			return known.has(link.id)
				? { href: catalogUnitHref(link.id), external: false }
				: { href: catalogPermalink(link.id), external: true };
		}
		if (!link.href || !/^https?:\/\//i.test(link.href)) return null;
		if (ZS_WEBLINK.test(link.href)) {
			return doc ? { href: `/documents/${doc.series}/${encodeURIComponent(doc.id)}`, external: false } : { note: ZS_WEBLINK_MISSING };
		}
		return { href: link.href, external: true };
	};
}

/**
 * Zeilen eines Feldes mit seinen Verweisen: Eine Zeile, die genau einem Verweistext
 * entspricht, wird zum Verweis («Verwandte Verzeichnungseinheiten», «GND-Links»);
 * Verweise ohne eigene Zeile folgen am Ende.
 */
export function fieldLines(field: CatalogUnitField, resolve: CatalogLinkResolver): CatalogFieldLine[] {
	const pending = [...(field.links ?? [])];
	const asLine = (link: CatalogFieldLink, text: string): CatalogFieldLine => {
		const target = resolve(link);
		return target ? { text, ...target } : { text };
	};
	const lines: CatalogFieldLine[] = field.text.split("\n").map((raw) => {
		const text = raw.trim();
		const i = text ? pending.findIndex((l) => l.text.trim() === text) : -1;
		if (i < 0) return { text: raw.trimEnd() };
		const [link] = pending.splice(i, 1);
		return asLine(link, text);
	});
	for (const link of pending) lines.push(asLine(link, link.text.trim() || link.href || String(link.id ?? "")));
	return lines;
}

/** Mindestbreite der Katalog-Zeitleiste in Jahren (wie ein einzelnes Jahr im Zoom). */
const AXIS_MIN_SPAN = 21;

/**
 * Achse der Katalog-Zeitleiste: von der ersten bis zur letzten Jahreszahl der
 * Treffer (ohne Zeitraumfilter gezählt), innerhalb [CATALOG_YEAR_MIN, `nowYear`];
 * ein gewählter Zeitraum liegt immer darin, mindestens AXIS_MIN_SPAN Jahre. Anders als
 * in der Dokumentsuche keine Teilung bei 1803. null = nichts zu zeigen.
 */
export function catalogTimelineAxis(
	stats: { min: number | null; max: number | null },
	selection: { dateFrom: number | null; dateTo: number | null },
	nowYear: number,
): { min: number; max: number } | null {
	const lo = [stats.min, selection.dateFrom, selection.dateTo].filter((y): y is number => y != null);
	const hi = [stats.max, selection.dateTo, selection.dateFrom].filter((y): y is number => y != null);
	if (lo.length === 0 || hi.length === 0) return null;
	const top = Math.max(CATALOG_YEAR_MIN, nowYear);
	let min = Math.min(top, Math.max(CATALOG_YEAR_MIN, Math.min(...lo)));
	let max = Math.max(min, Math.min(top, Math.max(...hi)));
	const missing = AXIS_MIN_SPAN - (max - min + 1);
	if (missing > 0) {
		min = Math.max(CATALOG_YEAR_MIN, min - Math.floor(missing / 2));
		max = Math.min(top, min + AXIS_MIN_SPAN - 1);
		min = Math.max(CATALOG_YEAR_MIN, max - AXIS_MIN_SPAN + 1);
	}
	return { min, max };
}

/** Einheit des Archivkatalogs in einer kurzen Liste (Dokument- und Personenseite). */
export interface CatalogUnitRef {
	id: number;
	signature: string;
	title: string;
	level: string;
	dateText: string;
	/** Etikett des Bestands wie im Index («Z 1114 …, 1971-1999 (Bestand)»). */
	bestand: string | null;
	/** Katalog-ID des Bestands, wenn er im Archivplan-Pfad steht. */
	bestandId: number | null;
	hasDigitization: boolean;
}

/** Katalogeintrag eines Plattform-Dokuments (Reiter «Archivkatalog» der Dokumentseite). */
export interface DocumentCatalog {
	/** Die Einheit, die das Dokument abbildet, mit Archivplan; null, solange sie im Index fehlt. */
	unit: (CatalogUnitRef & { path: CatalogPathNode[] }) | null;
	/** Archivplan-Stufen im Index (interne Links, übrige führen in den Online-Katalog). */
	known: number[];
	/** Eigene Einheiten mit Weblink auf das Dokument (z. B. eine Urkunde zum Beschluss). */
	references: CatalogUnitRef[];
}

/** So viele verweisende Einheiten zeigt die Dokumentseite höchstens. */
export const DOCUMENT_REFERENCES_MAX = 20;

/** So viele Einheiten je Liste zeigt die Personenseite höchstens (gesichert bzw. Vorschläge). */
export const PERSON_CATALOG_MAX = 100;

/** Katalog-IDs von Plattform-Dokumenten in Weblinks: die ID selbst bzw. ohne angehängtes «_t»
 *  (Gegenstück zu services/catalog `platformIdVariants`). */
export function catalogDocIdVariants(docId: string): string[] {
	return docId.endsWith("_t") ? [docId, docId.slice(0, -2)] : [docId];
}

/**
 * Plattform-IDs, unter denen ein unbekanntes Dokument liegen kann, in dieser Reihenfolge: mit
 * «_t» (getippte Fassung) und bei Doppelbeschlüssen ohne «-» («…_1811_-_…_1812» →
 * «…_1811_…_1812»). So verlinkten der Katalog-Index vor dem Abgleich mit der Plattform und die
 * Weblinks des Staatsarchivs (services/catalog `platformIdVariants`); die Dokumentseite leitet um.
 */
export function platformIdFallbacks(docId: string): string[] {
	const joined = docId.replace(/_-_/g, "_");
	const out = [docId.endsWith("_t") ? null : `${docId}_t`, joined, joined.endsWith("_t") ? null : `${joined}_t`];
	return [...new Set(out.filter((x): x is string => x !== null && x !== docId))];
}

/** Signaturen der Zentralen Serien («MM 2.3 RRB 1831/0882», «ABl 1980 (S. 1-10)», «OS 54 (S. 6)»):
 *  nur solche Einheiten bilden ein Dokument ab (services/catalog `isZsUnit`). */
const ZS_SIGNATURE = /^(?:MM|ABl|OS)\s/;

const quoteValue = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Meili-Filter für den Katalogeintrag eines Dokuments: die Einheit über `archiveId` (Zentrale
 * Serien) und alle Einheiten mit Plattform-Bezug (`docId`: Ratsmanual-Sitzungen, Verweise).
 */
export function documentCatalogFilter(doc: { id: string; archiveId?: number | null }): string {
	const byDoc = `docId IN [${catalogDocIdVariants(doc.id).map(quoteValue).join(", ")}]`;
	const archiveId = doc.archiveId;
	return archiveId != null && Number.isInteger(archiveId) && archiveId > 0 ? `id = ${archiveId} OR ${byDoc}` : byDoc;
}

/**
 * Teilt die Treffer von documentCatalogFilter: die Einheit des Dokuments und die eigenen
 * Einheiten, die darauf verweisen (`onPlatform = false`), nach Signatur.
 *
 * Die Einheit: Zentrale Serien über `archiveId`. Verlinkt die genannte Einheit per Weblink ein
 * anderes Dokument, gilt die Einheit, deren Weblink auf dieses zeigt – der `archiveLink` der
 * TEI nennt dann die Nachbareinheit (Prod 2026-11-09: 74 Dokumente, z. B. RRB 1831/0882 mit der
 * Einheit von 1831/0883, Mitgliederlisten MM 2.174–2.247 um eine Einheit verschoben). Nur
 * Einheiten mit Signatur der Serien: vor dem Neuaufbau trugen auch Verweise (Urkunde zu einem
 * Beschluss) `onPlatform`. Ohne `archiveId` (Ratsmanuale) die Plattform-Einheit mit passender `docId`.
 */
export function pickDocumentCatalog<T extends { id: number; signature?: string; onPlatform?: boolean; docId?: string; stub?: boolean }>(
	hits: readonly T[],
	doc: { id: string; archiveId?: number | null },
): { unit: T | null; references: T[] } {
	const ids = new Set(catalogDocIdVariants(doc.id));
	const linked = (h: T) => h.docId != null && ids.has(h.docId);
	const depicts = (h: T) => h.onPlatform === true && h.stub !== true && linked(h);
	let unit: T | null;
	if (doc.archiveId != null) {
		const named = hits.find((h) => h.id === doc.archiveId && h.stub !== true) ?? null;
		const weblinked = hits.find((h) => h !== named && depicts(h) && ZS_SIGNATURE.test((h.signature ?? "").trim())) ?? null;
		unit = named && (named.docId == null || linked(named)) ? named : (weblinked ?? named);
	} else unit = hits.find(depicts) ?? null;
	const references = hits
		.filter((h) => h !== unit && h.onPlatform === false && linked(h))
		.sort((a, b) => (a.signature ?? "").localeCompare(b.signature ?? "", "de", { numeric: true }) || a.id - b.id)
		.slice(0, DOCUMENT_REFERENCES_MAX);
	return { unit, references };
}

/**
 * Meili-Filter für die Einheiten einer KRDB-Person (alle ihre IDs, auch frühere): gesichert
 * (`krdbIds`) bzw. Vorschläge gleichen Namens (`krdbNameIds`) ohne die gesicherten; nur eigene
 * Treffer. `IN` trifft nur Einheiten mit Zuordnung (anders als `IS NOT EMPTY`, das Einheiten
 * ohne das Feld mitzählt).
 */
export function personCatalogFilter(ids: readonly number[], kind: "secured" | "names"): string {
	const list = `[${ids.filter((n) => Number.isInteger(n) && n > 0).join(", ")}]`;
	return kind === "secured"
		? `onPlatform = false AND krdbIds IN ${list}`
		: `onPlatform = false AND krdbNameIds IN ${list} AND NOT krdbIds IN ${list}`;
}

/** Einheiten nach Bestand, in der Reihenfolge ihres ersten Auftretens (Personenseite). */
export function groupByBestand<T extends { bestand: string | null; bestandId: number | null }>(
	units: readonly T[],
): Array<{ bestand: string | null; bestandId: number | null; units: T[] }> {
	const groups = new Map<string, { bestand: string | null; bestandId: number | null; units: T[] }>();
	for (const u of units) {
		const key = u.bestand ?? "";
		const g = groups.get(key) ?? { bestand: u.bestand, bestandId: u.bestandId, units: [] };
		g.bestandId ??= u.bestandId;
		g.units.push(u);
		groups.set(key, g);
	}
	return [...groups.values()];
}

/** Die `n` häufigsten Facettenwerte, gewählte (`keep`) immer dabei. */
export function topFacetValues(dist: Record<string, number>, n: number, keep: readonly string[] = []): Record<string, number> {
	const top = Object.entries(dist)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
		.slice(0, n);
	const out = Object.fromEntries(top);
	for (const k of keep) if (k in dist) out[k] = dist[k];
	return out;
}
