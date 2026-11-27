/**
 * Ehedaten: Reiter «Ehedaten» der Suchseite, Ehe-Karte auf /archivkatalog/<ID>, API und
 * MCP – Typen, URL-Parameter, Filter und Anzeige (Server und Browser).
 *
 * Quelle ist die Ehedatenbank des Staatsarchivs («Zürcher Ehedaten 16.–18. Jahrhundert»), wie
 * sie der Online-Archivkatalog führt: ein Eintrag je Trauung oder Verkündung, 1524–1800, je
 * eine Verzeichnungseinheit «…, EDB n», übernommen aus dem Crawl des Katalogs (Stand
 * EHEDATEN_AS_OF) und aufgebaut in services/catalog (ehedatenCrawl.ts, ehedaten.ts, Index
 * `ehedaten`; bis 2026-11 aus dem Zenodo-Datensatz 11191059, v6.0). Anders als die amtlichen
 * Serien (Public Domain Mark) steht der Datensatz unter CC BY 4.0 und wird mit
 * EHEDATEN_ATTRIBUTION genannt (Entscheid Tim 2026-11-09: CC BY bleibt, Quelle der Katalog).
 *
 * Mit den anderen Reitern geteilt: Suchbegriff (`q`, Volltext über Namen, Herkunft,
 * Zusatzinfo, Kirchgemeinde und Signatur), ODER-Begriffe, Zeitraum, «nur im Titel» (nur
 * Namen und Herkunft), Personen (`persons`: Bräutigam oder Braut) und Orte (`places`:
 * Herkunft). Eigene Filter (`eheMann`, `eheFrau`, `eheKirche`, `eheRaum`, `eheQuelle`,
 * `eheArt`, `eheBand`) bleiben auch in den anderen Reitern in der URL.
 *
 * Namen gelten über ihre Wörter, gefaltet wie die Personenschlüssel (entityKey.ts:
 * Meier = Meyer, Jakob = Jacob): «Heusser» trifft jeden Heusser, «Hans Jakob Heusser» jeden,
 * dessen Name alle drei Wörter trägt. Pur, unit-getestet in ehedaten.test.ts.
 */

import { catalogDateClauses, catalogPermalink, catalogSignatureLabel } from "./catalog";
import { nameWords, personKey, placeKey } from "./entityKey";
import { OLD_STYLE_LAST_YEAR, OLD_STYLE_SUFFIX } from "./format";
import { parseSearchView } from "./searchViews";
import { foldSharpS, sharpSSpellings } from "./sharpS";
import type { SpanCounts } from "./timelineBins";
import type { SearchParams } from "./types";

export const EHEDATEN_YEAR_MIN = 1524;
export const EHEDATEN_YEAR_MAX = 1800;

/** Nennung des Datensatzes (CC BY 4.0 verlangt sie). */
export const EHEDATEN_ATTRIBUTION = "Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert";
export const EHEDATEN_LICENSE = "CC BY 4.0";
export const EHEDATEN_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/deed.de";
/** Quelle der Einträge: der Online-Archivkatalog des Staatsarchivs (je Eintrag der Permalink). */
export const EHEDATEN_SOURCE_URL = "https://suche.staatsarchiv.djiktzh.ch";
/** Stand der Einträge: Abruf aus dem Online-Archivkatalog bis zu diesem Tag (refresh.sh ehedaten). */
export const EHEDATEN_AS_OF = "9.11.2026";
/** Quelle mit Stand, für Fusszeilen und API («Online-Archivkatalog des Staatsarchivs, Stand …»). */
export const EHEDATEN_SOURCE = `Online-Archivkatalog des Staatsarchivs, Stand ${EHEDATEN_AS_OF}`;
/** Derselbe Datensatz, wie ihn das Staatsarchiv veröffentlicht hat (Zenodo, Version 6.0 vom 14.05.2024). */
export const EHEDATEN_DATASET_URL = "https://doi.org/10.5281/zenodo.11191059";

export type EhedatenRaum = "zh" | "ch" | "ausland";
export const EHEDATEN_RAEUME: readonly EhedatenRaum[] = ["zh", "ch", "ausland"];
export const RAUM_LABEL: Readonly<Record<EhedatenRaum, string>> = {
	zh: "Kanton Zürich",
	ch: "andere Kantone",
	ausland: "Ausland",
};

export type EhedatenArt = "trauung" | "verkuendung";
export const EHEDATEN_ARTEN: readonly EhedatenArt[] = ["trauung", "verkuendung"];
export const ART_LABEL: Readonly<Record<EhedatenArt, string>> = { trauung: "Trauung", verkuendung: "Verkündung" };

/** Überlieferung: Pfarrbücher im Staatsarchiv (E III) und Bücher anderer Archive (TAI). */
export const EHEDATEN_QUELLEN = ["E III", "TAI"] as const;
export const QUELLE_LABEL: Readonly<Record<string, string>> = {
	"E III": "Pfarrbücher im Staatsarchiv (E III)",
	TAI: "Bücher anderer Archive (TAI)",
};

/** Die Stadtkirchen, in der Filterspalte als «Stadt Zürich» gruppierbar. Die Kirchgemeinden
 *  vor den Mauern (Wipkingen, Altstetten, Höngg …) gehörten damals nicht zur Stadt. */
export const STADT_ZUERICH = "Stadt Zürich";
export const STADT_ZUERICH_KIRCHGEMEINDEN: readonly string[] = [
	"Grossmünster",
	"Fraumünster",
	"St. Peter",
	"Predigern",
	"Spitalpfarramt",
	"Zürich",
];

/** Eheeintrag der Ehedatenbank im Archivkatalog (Signatur «…, EDB n»; nicht die Teilbände
 *  «…, EDB 501 - …, EDB 1000»). */
export function isEhedatenSignature(signature: string | null | undefined): boolean {
	const s = signature?.trim() ?? "";
	return /, EDB \d+$/.test(s) && !s.includes(" - ");
}

/** «nur im Titel»: Namen und Herkunft – so lautet der Titel eines Eheeintrags im Online-Katalog. */
export const EHEDATEN_TITLE_FIELDS = ["mannName", "frauName", "mannHerkunft", "frauHerkunft"];

// --- URL-Parameter --------------------------------------------------------------

/** Eigene Filter des Reiters (URL-Parameter `ehe…`). */
export interface EhedatenFilters {
	/** true = Reiter «Ehedaten» aktiv. */
	active: boolean;
	/** Namen des Bräutigams bzw. der Braut (`eheMann`, `eheFrau`; je mehrere = oder). */
	mann: string[];
	frau: string[];
	/** Kirchgemeinden (`eheKirche`), «Stadt Zürich» = die Stadtkirchen. */
	kirche: string[];
	/** Herkunftsraum mindestens einer Person (`eheRaum`). */
	raum: EhedatenRaum[];
	/** Überlieferung (`eheQuelle`: E III, TAI). */
	quelle: string[];
	/** nur Trauungen bzw. nur Verkündungen (`eheArt`). */
	art: EhedatenArt | null;
	/** Bände (`eheBand`: Signatur ohne «, EDB n»). */
	band: string[];
}

export type EhedatenFilterValues = Omit<EhedatenFilters, "active">;

export const NO_EHEDATEN_FILTERS: EhedatenFilterValues = { mann: [], frau: [], kirche: [], raum: [], quelle: [], art: null, band: [] };

/** Höchstens so viele Werte je Filter (wie die Bestände des Katalogs). */
const VALUES_MAX = 20;

function list(values: string[]): string[] {
	return [...new Set(values.map((v) => v.replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean))].slice(0, VALUES_MAX);
}

export function parseEhedatenFilters(url: URL): EhedatenFilters {
	const sp = url.searchParams;
	const art = sp.get("eheArt");
	return {
		active: parseSearchView(sp) === "ehedaten",
		mann: list(sp.getAll("eheMann")),
		frau: list(sp.getAll("eheFrau")),
		kirche: list(sp.getAll("eheKirche")),
		raum: list(sp.getAll("eheRaum")).filter((r): r is EhedatenRaum => (EHEDATEN_RAEUME as readonly string[]).includes(r)),
		quelle: list(sp.getAll("eheQuelle")).filter((q) => (EHEDATEN_QUELLEN as readonly string[]).includes(q)),
		art: art === "trauung" || art === "verkuendung" ? art : null,
		band: list(sp.getAll("eheBand")),
	};
}

const PARAMS = ["eheMann", "eheFrau", "eheKirche", "eheRaum", "eheQuelle", "eheArt", "eheBand"];

/** Schreibt die eigenen Filter des Reiters in `url` (den Reiter selbst schreibt writeSearchView). */
export function writeEhedatenParams(url: URL, f: EhedatenFilterValues): URL {
	const sp = url.searchParams;
	for (const k of PARAMS) sp.delete(k);
	for (const v of f.mann) sp.append("eheMann", v);
	for (const v of f.frau) sp.append("eheFrau", v);
	for (const v of f.kirche) sp.append("eheKirche", v);
	for (const v of f.raum) sp.append("eheRaum", v);
	for (const v of f.quelle) sp.append("eheQuelle", v);
	if (f.art) sp.set("eheArt", f.art);
	for (const v of f.band) sp.append("eheBand", v);
	return url;
}

// --- Filter ---------------------------------------------------------------------

/** Was der Reiter mit den anderen teilt. */
export type EhedatenShared = Pick<SearchParams, "dateFrom" | "dateTo" | "persons" | "places">;

export type NameRole = "mann" | "frau" | "beide";

/** Wörter eines eingegebenen Namens, gefaltet wie die Namenswörter im Index (höchstens 8). */
export function nameTokens(form: string): string[] {
	return [...new Set(nameWords(form))].slice(0, 8);
}

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Ein Name als Meili-Filter: alle seine Wörter beim Bräutigam, bei der Braut oder bei einem
 *  der beiden; null ohne verwertbares Wort. */
export function nameClause(form: string, role: NameRole): string | null {
	const tokens = nameTokens(form);
	if (tokens.length === 0) return null;
	const of = (field: "mannTok" | "frauTok") => tokens.map((t) => `${field} = ${quote(t)}`).join(" AND ");
	if (role === "mann") return tokens.length > 1 ? `(${of("mannTok")})` : of("mannTok");
	if (role === "frau") return tokens.length > 1 ? `(${of("frauTok")})` : of("frauTok");
	return `((${of("mannTok")}) OR (${of("frauTok")}))`;
}

/** Mehrere Werte eines Filters gelten wie in den anderen Reitern als oder. */
function anyOf(clauses: Array<string | null>): string | null {
	const ok = clauses.filter((c): c is string => !!c);
	if (ok.length === 0) return null;
	return ok.length === 1 ? ok[0] : `(${ok.join(" OR ")})`;
}

/** Kirchgemeinden eines Filters, «Stadt Zürich» als ihre Stadtkirchen; ß auch als ss (so schreibt
 *  die Ehedatenbank die Kirchgemeinden). */
export function expandKirchen(values: readonly string[]): string[] {
	return [...new Set(values.flatMap((v) => (v === STADT_ZUERICH ? STADT_ZUERICH_KIRCHGEMEINDEN : [v, foldSharpS(v)])))];
}

/** Herkunft mit Kantonskürzel bzw. Land, wie die Facette sie führt («Wald TG», «Lindau
 *  (Deutschland)»): placeKey (Fassung 1) streicht beides und träfe die gleichnamigen
 *  Zürcher Orte mit, darum gelten diese Werte exakt. */
const QUALIFIED_PLACE = /\s(?!ZH$)[A-Z]{2}$|\)$/;

/** Herkunft (`places`) als Vergleichsschlüssel der Orte (entityKey.ts placeKey); Werte mit
 *  Kantonskürzel oder Land exakt über die Facette `herkunft`, mit ss wie mit ß. */
function placeClause(values: readonly string[]): string | null {
	const exact = [...new Set(values.map((v) => v.trim()).filter((v) => QUALIFIED_PLACE.test(v)).flatMap(sharpSSpellings))];
	const keys = [
		...new Set(values.filter((v) => !QUALIFIED_PLACE.test(v.trim())).map((v) => placeKey(v)).filter((k): k is string => !!k)),
	];
	return anyOf([
		exact.length > 0 ? `herkunft IN [${exact.map(quote).join(", ")}]` : null,
		keys.length > 0 ? `herkunftKeys IN [${keys.map(quote).join(", ")}]` : null,
	]);
}

/**
 * Meili-Filterklauseln des Reiters (verbunden mit «AND»): Zeitraum nach Berührung wie der
 * Archivkatalog, Namen (geteilte Personen = Bräutigam oder Braut, dazu die Rollen), Herkunft
 * (geteilte Orte), Kirchgemeinde, Herkunftsraum, Überlieferung, Art und Band.
 */
export function ehedatenFilterClauses(f: EhedatenFilterValues, shared: EhedatenShared): string[] {
	const out: Array<string | null> = [
		...catalogDateClauses(shared.dateFrom, shared.dateTo),
		anyOf(shared.persons.map((p) => nameClause(p, "beide"))),
		anyOf(f.mann.map((p) => nameClause(p, "mann"))),
		anyOf(f.frau.map((p) => nameClause(p, "frau"))),
		placeClause(shared.places),
		f.kirche.length > 0 ? `kirchgemeinde IN [${expandKirchen(f.kirche).map(quote).join(", ")}]` : null,
		f.raum.length > 0 ? `raum IN [${f.raum.map(quote).join(", ")}]` : null,
		f.quelle.length > 0 ? `quelle IN [${f.quelle.map(quote).join(", ")}]` : null,
		f.art ? `art = ${quote(f.art)}` : null,
		f.band.length > 0 ? `band IN [${f.band.map(quote).join(", ")}]` : null,
	];
	return out.filter((c): c is string => !!c);
}

export function ehedatenFilter(f: EhedatenFilterValues, shared: EhedatenShared): string {
	return ehedatenFilterClauses(f, shared).join(" AND ");
}

/**
 * Was im Reiter «Ehedaten» gesetzt ist, aber dort nicht wirkt (Hinweis in der Filterspalte):
 * Serien und ihre Filter, Organisationen, Thema (keine Vektoren), Orte ohne Vergleichsschlüssel.
 */
export function ehedatenIgnoredFilters(
	p: Pick<SearchParams, "series" | "organizations" | "places" | "volumeNr" | "startPg" | "serialNr" | "resolutionId" | "years" | "theme">,
): string[] {
	const out: string[] = [];
	if (p.series.length > 0) out.push(`${p.series.length === 1 ? "Serie" : "Serien"} ${p.series.join(", ")}`);
	if ([p.volumeNr, p.startPg, p.serialNr, p.resolutionId, p.years].some((v) => v.length > 0)) out.push("Filter der Serie");
	if (p.organizations.length > 0) out.push(p.organizations.length === 1 ? "1 Organisation" : `${p.organizations.length} Organisationen`);
	const unkeyed = p.places.filter((v) => !placeKey(v)).length;
	if (unkeyed > 0) out.push(unkeyed === 1 ? "1 Ort" : `${unkeyed} Orte`);
	if (p.theme.trim()) out.push("Thema");
	return out;
}

// --- Anzeige --------------------------------------------------------------------

/** Ein Ehepartner zur Anzeige. */
export interface EhedatenPerson {
	vorname: string;
	nachname: string;
	/** «Vorname Nachname». */
	name: string;
	/** Herkunft wie in der Ehedatenbank. */
	herkunft: string;
	/** Herkunft auf die Gemeinde bzw. mit Kanton oder Land gebracht (Facette). */
	ort: string;
	/** Originalschreibung, Beruf, Bemerkungen. */
	zusatz: string;
	hls: string;
	gnd: string;
}

/** Ein Eheeintrag mit allen Angaben (Ehe-Karte, API, MCP). */
export interface EhedatenEntry {
	/** Katalog-ID: Seite /archivkatalog/<id>, Permalink des Online-Katalogs. */
	id: number;
	signatur: string;
	band: string;
	eintrag: number | null;
	quelle: string;
	seite: string;
	kirchgemeinde: string;
	art: EhedatenArt;
	/** Datum wie im Kirchenbuch, ohne «a. St.» (ehedatenDateLabel). */
	datum: string;
	isoVon: string;
	isoBis: string;
	dateFrom: number;
	dateTo: number;
	/** Titel wie im Online-Katalog. */
	titel: string;
	mann: EhedatenPerson;
	frau: EhedatenPerson;
	unsicher: boolean;
}

/** Treffer der Liste: Namen, Herkunft und Zusatzinfo mit Hervorhebung (bereits maskiert). */
export interface EhedatenHit extends EhedatenEntry {
	html: { mannName: string; frauName: string; mannHerkunft: string; frauHerkunft: string; mannZusatz: string; frauZusatz: string };
}

export interface EhedatenFacetCounts {
	kirchgemeinde: Record<string, number>;
	raum: Record<string, number>;
	quelle: Record<string, number>;
	art: Record<string, number>;
}

export interface EhedatenTimeline extends SpanCounts {
	min: number | null;
	max: number | null;
}

export interface EhedatenResult {
	hits: EhedatenHit[];
	total: number;
	processingTimeMs: number;
	page: number;
	pageSize: number;
	facets: EhedatenFacetCounts;
	/** Zeitleiste ohne Zeitraumfilter; null, wenn die Abfrage scheiterte. */
	timeline: EhedatenTimeline | null;
	/** So viele Einträge lassen sich durchblättern (`total` zählt alle), fehlt, wenn alle. */
	browseLimit?: number;
}

/** Bis 1700 datierte Zürich julianisch (alter Stil, format.ts). */
export function isJulian(e: Pick<EhedatenEntry, "dateFrom">): boolean {
	return e.dateFrom <= OLD_STYLE_LAST_YEAR;
}

/** Datum zur Anzeige, bis 1700 mit «(a. St.)», Spannen mit Halbgeviertstrich. */
export function ehedatenDateLabel(e: Pick<EhedatenEntry, "datum" | "dateFrom">): string {
	const d = e.datum.replace(/ - /g, " – ").trim();
	return d && isJulian(e) ? `${d} ${OLD_STYLE_SUFFIX}` : d;
}

/**
 * Trauort laut Zusatzinfo: «getraut zu Zürich beim Grossmünster», «getraut im Grossmünster» –
 * bis zur nächsten Klammer, Anmerkung oder zum Satzende; null ohne solchen Vermerk. Die
 * Kirchgemeinde eines Eintrags ist die seines Kirchenbuchs, getraut wurde oft anderswo.
 */
export function trauortVermerk(e: { mann: Pick<EhedatenPerson, "zusatz">; frau: Pick<EhedatenPerson, "zusatz"> }): string | null {
	for (const z of [e.mann.zusatz, e.frau.zusatz]) {
		const m = /\bgetraut (?:zu|in|im|bei|beim|zur|auf) [^;,.()[\]"«»]+/i.exec(z);
		if (m) return m[0].replace(/\s+/g, " ").trim();
	}
	return null;
}

/** Stehen Bräutigam oder Braut im anderen Eintrag unter einem anderen Namen (Vornamen schwanken
 *  zwischen den Kirchenbüchern: «Heinrich» – «Kleinheinrich»)? Verglichen über die
 *  Personenschlüssel (Meier = Meyer), ohne Schlüssel über die Schreibung. */
export function namesDiffer(a: Pick<EhedatenEntry, "mann" | "frau">, b: Pick<EhedatenEntry, "mann" | "frau">): boolean {
	const same = (x: string, y: string) => {
		const kx = personKey(x);
		const ky = personKey(y);
		return kx && ky ? kx === ky : x.trim().toLowerCase() === y.trim().toLowerCase();
	};
	return !same(a.mann.name, b.mann.name) || !same(a.frau.name, b.frau.name);
}

/**
 * Zitiervorschlag: Signatur mit Kürzel des Staatsarchivs, Paar, Datum, Datensatz mit Lizenz
 * und Permalink des Online-Katalogs.
 */
export function ehedatenCitation(e: Pick<EhedatenEntry, "id" | "signatur" | "mann" | "frau" | "datum" | "dateFrom" | "art">): string {
	const pair = `${e.mann.name} und ${e.frau.name}`;
	const what = `${ART_LABEL[e.art]} ${ehedatenDateLabel(e)}`;
	return `${catalogSignatureLabel(e.signatur)}, ${pair}, ${what}; ${EHEDATEN_ATTRIBUTION} (${EHEDATEN_LICENSE}); ${catalogPermalink(e.id)}`;
}

/** Facetten der Kirchgemeinde mit Gruppe «Stadt Zürich» (Summe der Stadtkirchen) für die
 *  Filterspalte: die `n` häufigsten, gewählte immer. */
export function kirchgemeindeFacet(
	dist: Readonly<Record<string, number>>,
	selected: readonly string[],
	n: number,
): Array<{ value: string; count: number }> {
	const stadt = STADT_ZUERICH_KIRCHGEMEINDEN.reduce((s, k) => s + (dist[k] ?? 0), 0);
	const all = [...Object.entries(dist).map(([value, count]) => ({ value, count })), ...(stadt > 0 ? [{ value: STADT_ZUERICH, count: stadt }] : [])];
	const byCount = all.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de"));
	const top = byCount.slice(0, n);
	for (const s of selected) {
		if (!top.some((t) => t.value === s)) top.push(byCount.find((t) => t.value === s) ?? { value: s, count: 0 });
	}
	return top;
}
