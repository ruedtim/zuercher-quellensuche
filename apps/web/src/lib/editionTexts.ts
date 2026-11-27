/**
 * Texte der Editionen (Index `editions`): Reiter «Editionen» der Suchseite, Detailseiten
 * /editionen/<edition>/<id>, später API und MCP – Typen, URL-Parameter,
 * Filter und Anzeige (Server und Browser). Editionen: QZH (Quellen zur Zürcher Geschichte) und
 * Zürcher Rechtsquellen (SSRQ ZH, seit 2026-11); Stillstandsprotokolle, Escher und Bullinger
 * kämen in denselben Index mit eigenem `edition`-Wert. Nennung und Lizenz je Edition stehen in
 * $lib/editions.ts (EDITIONS), nicht die Public Domain Mark der Plattform.
 *
 * Mit den anderen Reitern geteilt: Suchbegriff (`q`, im Suchtext der Editionen:
 * editionSearchForm, frühneuhochdeutsche Zeichen vereinheitlicht), ODER-Begriffe, Thema
 * (über Titel, Schlagwörter, Regest und Kommentar), Zeitraum (wie im Archivkatalog ab 700,
 * Zählung nach Berührung), «nur im Titel», Personen, Orte und Organisationen (Name oder
 * Vergleichsschlüssel, entityKey.ts). Eigene Filter (`edEdition`, `edPart`, `edKeyword`,
 * `edFacs`) bleiben auch in den anderen Reitern in der URL. Pur, unit-getestet in
 * editionTexts.test.ts.
 */

import { catalogDateClauses } from "./catalog";
import { EDITIONS, type EditionKey } from "./editions";
import { editionEntityClause } from "./entityFilter";
import { parseSearchView } from "./searchViews";
import { SITE_HOST } from "./site";
import type { SpanCounts } from "./timelineBins";
import type { SearchParams } from "./types";

/** Editionen im Index (Facette «Edition»); die übrigen Schlüssel aus EDITIONS sind nur Querverweise. */
export const INDEXED_EDITIONS: readonly EditionKey[] = ["qzh", "ssrq"];

export function isIndexedEdition(v: unknown): v is EditionKey {
	return typeof v === "string" && (INDEXED_EDITIONS as readonly string[]).includes(v);
}

/** Pfad der Detailseite eines Stücks. */
export function editionUnitPath(edition: string, localId: string): string {
	return `/editionen/${encodeURIComponent(edition)}/${encodeURIComponent(localId)}`;
}

/** Meili-ID eines Stücks (services/catalog editionsBuild.ts). */
export function editionDocId(edition: string, localId: string): string {
	return `${edition}-${localId}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

// --- URL-Parameter --------------------------------------------------------------

/** Eigene Filter des Reiters (URL-Parameter `ed…`). */
export interface EditionsFilters {
	/** true = Reiter «Editionen» aktiv. */
	active: boolean;
	/** Editionen (`edEdition`). */
	edition: EditionKey[];
	/** Teile der Edition (`edPart`: Reihe, bei den Täuferquellen mit Band). */
	part: string[];
	/** Schlagwörter (`edKeyword`). */
	keyword: string[];
	/** nur Stücke mit Faksimile (`edFacs=1`). */
	facs: boolean;
}

export type EditionsFilterValues = Omit<EditionsFilters, "active">;

export const NO_EDITIONS_FILTERS: EditionsFilterValues = { edition: [], part: [], keyword: [], facs: false };

const VALUES_MAX = 20;

function list(values: string[]): string[] {
	return [...new Set(values.map((v) => v.replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean))].slice(0, VALUES_MAX);
}

export function parseEditionsFilters(url: URL): EditionsFilters {
	const sp = url.searchParams;
	return {
		active: parseSearchView(sp) === "editions",
		edition: list(sp.getAll("edEdition")).filter(isIndexedEdition),
		part: list(sp.getAll("edPart")),
		keyword: list(sp.getAll("edKeyword")),
		facs: sp.get("edFacs") === "1",
	};
}

const PARAMS = ["edEdition", "edPart", "edKeyword", "edFacs"];

/** Schreibt die eigenen Filter des Reiters in `url` (den Reiter selbst schreibt writeSearchView). */
export function writeEditionsParams(url: URL, f: EditionsFilterValues): URL {
	const sp = url.searchParams;
	for (const k of PARAMS) sp.delete(k);
	for (const v of f.edition) sp.append("edEdition", v);
	for (const v of f.part) sp.append("edPart", v);
	for (const v of f.keyword) sp.append("edKeyword", v);
	if (f.facs) sp.set("edFacs", "1");
	return url;
}

// --- Filter ---------------------------------------------------------------------

/** Was der Reiter mit den anderen teilt. */
export type EditionsShared = Pick<SearchParams, "dateFrom" | "dateTo" | "persons" | "places" | "organizations">;

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Meili-Filterklauseln des Reiters (verbunden mit «AND»): Zeitraum nach Berührung wie der
 * Archivkatalog, Personen, Orte, Organisationen, Edition, Teil, Schlagwort, Faksimile.
 * Mehrere Werte eines Filters gelten wie in den anderen Reitern als oder.
 */
export function editionsFilterClauses(f: EditionsFilterValues, shared: EditionsShared): string[] {
	const out: Array<string | null> = [
		...catalogDateClauses(shared.dateFrom, shared.dateTo),
		// Ein Name: genau so (Einzelnamen wie «Bohq» haben keinen Schlüssel) oder über den
		// Vergleichsschlüssel (Meier = Meyer, die Form aus einem anderen Reiter).
		editionEntityClause("persons", shared.persons, quote),
		editionEntityClause("places", shared.places, quote),
		editionEntityClause("organizations", shared.organizations, quote),
		f.edition.length > 0 ? `edition IN [${f.edition.map(quote).join(", ")}]` : null,
		f.part.length > 0 ? `part IN [${f.part.map(quote).join(", ")}]` : null,
		f.keyword.length > 0 ? `keywords IN [${f.keyword.map(quote).join(", ")}]` : null,
		f.facs ? "hasFacsimile = true" : null,
	];
	return out.filter((c): c is string => !!c);
}

export function editionsFilter(f: EditionsFilterValues, shared: EditionsShared): string {
	return editionsFilterClauses(f, shared).join(" AND ");
}

/**
 * Was im Reiter «Editionen» gesetzt ist, aber dort nicht wirkt (Hinweis in der Filterspalte):
 * Serien und ihre Filter, das Thema ohne Vektoren.
 */
export function editionsIgnoredFilters(
	p: Pick<SearchParams, "series" | "volumeNr" | "startPg" | "serialNr" | "resolutionId" | "years" | "theme">,
	semantic: boolean,
): string[] {
	const out: string[] = [];
	if (p.series.length > 0) out.push(`${p.series.length === 1 ? "Serie" : "Serien"} ${p.series.join(", ")}`);
	if ([p.volumeNr, p.startPg, p.serialNr, p.resolutionId, p.years].some((v) => v.length > 0)) out.push("Filter der Serie");
	if (p.theme.trim() && !semantic) out.push("Thema");
	return out;
}

/** Klappen im Reiter die «Erweiterten Suchoptionen» von selbst auf? Wie im Katalog: ODER,
 *  Thema (nur mit Vektoren), Themen-Umfang, Namen. Die Filter des Reiters stehen ausserhalb. */
export function editionsAutoOpensAdvanced(
	p: Pick<SearchParams, "anyTerms" | "theme" | "topK" | "persons" | "places" | "organizations">,
	semantic: boolean,
): boolean {
	return (
		p.anyTerms.length > 0 ||
		(semantic && (p.theme.trim() !== "" || p.topK != null)) ||
		p.persons.length + p.places.length + p.organizations.length > 0
	);
}

// --- Daten ----------------------------------------------------------------------

/** Eine Person des Stücks (Register der Edition): Name, GND, Formen im Text, Nennungen. */
export interface EditionPerson {
	name: string;
	gnd: string | null;
	forms: string[];
	count: number;
}

export interface EditionPlace {
	name: string;
	lat: number | null;
	lon: number | null;
	forms: string[];
	count: number;
}

export interface EditionNoteItem {
	key: string;
	label: string;
	type: "critical" | "editorial";
	html: string;
	inBack: boolean;
}

/** Weitere Überlieferung eines Stücks (Rechtsquellen): nur die Beschreibung der Vorlage. */
export interface EditionWitness {
	/** Kennung des Texts in der Edition («SSRQ_ZH_NF_II_3_047_2»); fehlt in älteren Index-Ständen. */
	textId?: string;
	signature: string;
	sourceUrl: string | null;
	catalogIds: number[];
	filiation: string | null;
	physical: string[];
	isoFrom: string | null;
	isoTo: string | null;
	textLang: string[];
}

/** Ein Bild fürs Manifest: IIIF-Image-API-2-Dienst mit Grösse. */
export interface EditionImage {
	service: string;
	width: number;
	height: number;
	n: string;
	credit?: string;
}

/** Ein Stück mit allen Angaben (Detailseite, API). HTML-Felder sind beim Aufbau maskiert. */
export interface EditionUnit {
	id: string;
	edition: EditionKey;
	localId: string;
	/** Zitierform («QZH_401», «SSRQ ZH NF II/3 Nr. 47»). */
	label: string;
	nr: number | null;
	permalink: string;
	title: string;
	part: string;
	editors: string[];
	transcription: string[];
	tagging: string[];
	publisher: string | null;
	published: string | null;
	signature: string;
	sourceUrl: string | null;
	catalogIds: number[];
	textLang: string[];
	filiation: string | null;
	physical: string[];
	origPlace: string | null;
	/** Weitere Überlieferungen (Rechtsquellen). */
	witnesses: EditionWitness[];
	/** Datei der Vorlage im Repo der Edition (Link «TEI»), sonst null. */
	sourceFile: string | null;
	isoFrom: string | null;
	isoTo: string | null;
	/** Kalender, wenn die Edition ihn nennt (Rechtsquellen: «Julian»). */
	calendar: "julian" | "gregorian" | null;
	dateFrom: number | null;
	dateTo: number | null;
	bibl: Array<{ head: string; html: string; text: string }>;
	keywords: string[];
	/** Erklärung je Schlagwort (Rechtsquellen), Tooltip. */
	keywordGlosses: Record<string, string>;
	/** Namen aus der Auszeichnung der Edition oder automatisch erkannt (NER der Ratsmanuale). */
	entitySource: "edition" | "ner" | null;
	regestHtml: string | null;
	html: string;
	backHtml: string | null;
	notes: EditionNoteItem[];
	persons: EditionPerson[];
	places: EditionPlace[];
	orgs: string[];
	pages: Array<{ n: string; image: number | null }>;
	facs: EditionImage[];
	/** Lesetext (Suchtext), für MCP und API. */
	text: string;
	comment: string;
}

/** Treffer der Liste: Titel und Auszug mit Hervorhebung (maskiert). */
export interface EditionHit {
	id: string;
	edition: EditionKey;
	localId: string;
	/** Zitierform («SSRQ ZH NF II/3 Nr. 47»). */
	label: string;
	title: string;
	titleHtml: string;
	/** Auszug aus dem Suchtext (Quellentext, sonst Regest oder Kommentar), maskiert. */
	textHtml: string;
	/** Seite des Stücks in der Edition. */
	permalink: string;
	part: string;
	signature: string;
	isoFrom: string | null;
	isoTo: string | null;
	dateFrom: number | null;
	dateTo: number | null;
	keywords: string[];
	hasFacsimile: boolean;
}

export interface EditionsFacetCounts {
	edition: Record<string, number>;
	part: Record<string, number>;
	keywords: Record<string, number>;
	hasFacsimile: Record<string, number>;
}

export interface EditionsTimeline extends SpanCounts {
	min: number | null;
	max: number | null;
	undated: number;
}

export interface EditionsResult {
	hits: EditionHit[];
	total: number;
	processingTimeMs: number;
	page: number;
	pageSize: number;
	facets: EditionsFacetCounts;
	timeline: EditionsTimeline | null;
	/** Mit Thema: wie gereiht wurde (wie im Archivkatalog). */
	theme?: { mode: "rank" | "topK"; topK?: number; topKOfTotal?: number; rankedPool?: number };
	/** Thema gesetzt, aber kein Stück der Auswahl hat einen Vektor: Liste ohne Thema. */
	themeWithoutVectors?: boolean;
}

// --- Anzeige --------------------------------------------------------------------

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function parts(iso: string): { y: number; m: number; d: number } | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const day = (p: { y: number; m: number; d: number }) => `${p.d}.${p.m}.${p.y}`;

/**
 * Datum eines Stücks: «21.9.1583», «Mai 1530», «1530», «1530–1532», «21.9.–3.10.1583».
 * Wie in der Edition das Datum der Quelle (in Zürich bis 1700 alter Stil, nicht umgerechnet).
 */
export function editionDateLabel(isoFrom: string | null, isoTo: string | null): string {
	const a = isoFrom ? parts(isoFrom) : null;
	const b = isoTo ? parts(isoTo) : a;
	if (!a || !b) return "";
	const wholeYears = a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31;
	if (wholeYears) return a.y === b.y ? String(a.y) : `${a.y}–${b.y}`;
	const wholeMonth = a.d === 1 && b.d === lastDay(b.y, b.m);
	if (wholeMonth && a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.y}`;
	if (isoFrom === isoTo || (a.y === b.y && a.m === b.m && a.d === b.d)) return day(a);
	if (wholeMonth) return `${MONTHS[a.m - 1]} ${a.y} – ${MONTHS[b.m - 1]} ${b.y}`;
	return a.y === b.y ? `${a.d}.${a.m}.–${day(b)}` : `${day(a)}–${day(b)}`;
}

/** Name der Edition in Facette und Liste («QZH»). */
export function editionShort(key: EditionKey): string {
	return EDITIONS[key]?.short ?? key.toUpperCase();
}

/** Bearbeitung: Transkription, Auszeichnung (wenn andere Personen) und Herausgeberschaft. */
export function editionCredits(u: Pick<EditionUnit, "transcription" | "tagging" | "editors">): Array<{ label: string; names: string[] }> {
	const same = u.tagging.length > 0 && u.tagging.join("|") === u.transcription.join("|");
	return [
		{ label: same ? "Transkription und Auszeichnung" : "Transkription", names: u.transcription },
		...(same ? [] : [{ label: "Auszeichnung", names: u.tagging }]),
		{ label: "Herausgeberschaft", names: u.editors },
	].filter((c) => c.names.length > 0);
}

/** Zitierform eines Stücks (Index ohne `label`: die Kennung). */
export function editionLabel(u: Pick<EditionUnit, "localId"> & { label?: string | null }): string {
	return u.label || u.localId;
}

/** Kurzform eines Nachbarstücks in der Navigation: QZH die Kennung, Editionen mit Nummern je
 *  Band «Nr. 47» (die Nachbarn liegen im selben Band). */
export function editionNeighborLabel(edition: EditionKey, localId: string): string {
	if (EDITIONS[edition].numbering !== "part") return localId;
	const nr = /_(\d+)$/.exec(localId)?.[1];
	return nr ? `Nr. ${Number(nr)}` : localId;
}

/**
 * Zitiervorschlag: Titel, Datum, Signatur der Vorlage, Edition mit Zitierform, Bearbeitung,
 * Permalink der Edition und Lizenz; dazu die Seite auf der Plattform (`pageUrl`).
 */
export function editionCitation(
	u: Pick<EditionUnit, "edition" | "localId" | "title" | "isoFrom" | "isoTo" | "signature" | "permalink" | "transcription"> & { label?: string | null; calendar?: EditionUnit["calendar"] },
	pageUrl: string,
): string {
	const info = EDITIONS[u.edition];
	const date = editionDateLabel(u.isoFrom, u.isoTo);
	const head = [u.title, date && u.calendar === "julian" ? `${date} (a. St.)` : date].filter(Boolean).join(", ");
	const by = u.transcription.length > 0 ? `, bearbeitet von ${u.transcription.join(", ")}` : "";
	return `${head}. ${u.signature ? `${u.signature}. ` : ""}In: ${info.name} (${info.short}), ${editionLabel(u)}${by}, ${u.permalink} (${info.license}). Auf ${SITE_HOST}: ${pageUrl}`;
}

/**
 * TEI-Datei des Stücks im Repo der Edition (Link «TEI-XML»). Ältere Index-Stände ohne
 * `sourceFile` kennen nur die QZH (`quellenstuecke/<Kennung>.xml`).
 */
export function editionTeiUrl(u: Pick<EditionUnit, "edition" | "localId" | "sourceFile">): string | null {
	const info = EDITIONS[u.edition];
	if (!info.repo) return null;
	const file = u.sourceFile ?? (u.edition === "qzh" ? `quellenstuecke/${u.localId}.xml` : null);
	return file ? `${info.repo}/blob/main/${file.split("/").map(encodeURIComponent).join("/")}` : null;
}

/**
 * Kennungen der Texte eines Stücks, wie sie die Querverweise (edition-links.json) führen: das
 * Stück selbst, sein Grundtext («…_047_1», aus `sourceFile`) und die weiteren Überlieferungen.
 */
export function editionTextIds(u: Pick<EditionUnit, "localId" | "sourceFile" | "witnesses">): string[] {
	const main = u.sourceFile ? /([^/]+)\.xml$/.exec(u.sourceFile)?.[1] : undefined;
	return [...new Set([u.localId, main, ...u.witnesses.map((w) => w.textId)].filter((x): x is string => Boolean(x)))];
}

/** Facetten der Filterspalte: die `n` häufigsten Werte, gewählte immer. */
export function topFacet(dist: Readonly<Record<string, number>>, selected: readonly string[], n: number): Array<{ value: string; count: number }> {
	const byCount = Object.entries(dist)
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de"));
	const top = byCount.slice(0, n);
	for (const s of selected) if (!top.some((t) => t.value === s)) top.push(byCount.find((t) => t.value === s) ?? { value: s, count: 0 });
	return top;
}

/**
 * Voriges und nächstes Stück nach Laufnummer aus der nach `nr` geordneten Liste der Edition
 * (`nr` ist im Index nur sortierbar, nicht filterbar: ein Filter `nr < 401` scheiterte mit 400).
 */
export function editionNeighborsIn(
	order: ReadonlyArray<{ localId: string; nr: number }>,
	nr: number | null,
): { prev: string | null; next: string | null } {
	if (nr == null) return { prev: null, next: null };
	let prev: string | null = null;
	let next: string | null = null;
	for (const u of order) {
		if (u.nr < nr) prev = u.localId;
		else if (u.nr > nr) {
			next = u.localId;
			break;
		}
	}
	return { prev, next };
}

/** Achse der Zeitleiste: Spannweite der Treffer (ohne Zeitraumfilter) mit dem gewählten
 *  Zeitraum, mindestens 21 Jahre; null ohne datierte Treffer. */
export function editionsTimelineAxis(
	stats: { min: number | null; max: number | null },
	selection: { dateFrom: number | null; dateTo: number | null },
): { min: number; max: number } | null {
	const lo = [stats.min, selection.dateFrom, selection.dateTo].filter((y): y is number => y != null);
	const hi = [stats.max, selection.dateTo, selection.dateFrom].filter((y): y is number => y != null);
	if (lo.length === 0 || hi.length === 0) return null;
	let min = Math.min(...lo);
	let max = Math.max(min, ...hi);
	const missing = 21 - (max - min + 1);
	if (missing > 0) {
		min -= Math.floor(missing / 2);
		max = min + 20;
	}
	return { min, max };
}

// --- Faksimile ------------------------------------------------------------------

type Lang = Record<string, string[]>;

/**
 * IIIF-Manifest (Presentation 3) eines Stücks aus seinen Bildern (`facs`): je Bild ein Canvas
 * mit dem Bilddienst der Edition (Image API 2). Bildnachweis je Canvas (Staatsarchiv mit
 * Signatur bzw. die Bibliothek bei e-manuscripta); `rights` nur, wenn alle Bilder von der
 * Edition stammen und sie deren Rechte kennt (QZH: gemeinfrei). `pageUrl` = Detailseite.
 */
export function editionManifest(
	u: Pick<EditionUnit, "edition" | "localId" | "title" | "isoFrom" | "isoTo" | "signature" | "permalink" | "facs">,
	pageUrl: string,
): Record<string, unknown> {
	const info = EDITIONS[u.edition];
	const id = `${pageUrl}/manifest.json`;
	const de = (v: string): Lang => ({ de: [v] });
	const archive = `Staatsarchiv des Kantons Zürich${u.signature ? `, ${u.signature.replace(/^StAZH\s+/, "")}` : ""}`;
	const items = u.facs.map((img, i) => {
		const canvasId = `${id}/canvas/${i + 1}`;
		return {
			id: canvasId,
			type: "Canvas",
			label: de(img.n || String(i + 1)),
			width: img.width,
			height: img.height,
			...(img.credit ? { requiredStatement: { label: de("Digitalisat"), value: de(img.credit) } } : {}),
			items: [
				{
					id: `${canvasId}/page`,
					type: "AnnotationPage",
					items: [
						{
							id: `${canvasId}/annotation/1`,
							type: "Annotation",
							motivation: "painting",
							target: canvasId,
							body: {
								id: `${img.service}/full/max/0/default.jpg`,
								type: "Image",
								format: "image/jpeg",
								width: img.width,
								height: img.height,
								service: [{ id: img.service, type: "ImageService2", profile: "http://iiif.io/api/image/2/level2.json" }],
							},
						},
					],
				},
			],
		};
	});
	const date = editionDateLabel(u.isoFrom, u.isoTo);
	const ownImages = u.facs.every((f) => !f.credit);
	// Alle Bilder aus demselben anderen Archiv (Rechtsquellen: Stadtarchiv Winterthur …): dieses
	// mit der Signatur der Vorlage statt «Staatsarchiv».
	const credits = [...new Set(u.facs.map((f) => f.credit ?? ""))];
	const otherArchive = !ownImages && credits.length === 1 ? `${credits[0]}${u.signature ? `, ${u.signature.replace(/^\S+\s+/, "")}` : ""}` : null;
	return {
		"@context": "http://iiif.io/api/presentation/3/context.json",
		id,
		type: "Manifest",
		label: de(u.title),
		metadata: [
			...(date ? [{ label: de("Datum"), value: de(date) }] : []),
			...(u.signature ? [{ label: de("Signatur"), value: de(u.signature) }] : []),
			{ label: de("Edition"), value: de(`${info.name} (${info.short}), ${u.localId}`) },
		],
		requiredStatement: {
			label: de("Digitalisat"),
			value: de(ownImages ? archive : (otherArchive ?? `${archive}; einzelne Seiten aus anderen Sammlungen, Nachweis je Seite`)),
		},
		...(ownImages && info.images ? { rights: info.images.url.replace(/deed\.de$/, "").replace(/^https:/, "http:") } : {}),
		homepage: [{ id: u.permalink, type: "Text", label: de(`Stück in der Edition ${info.short}`), format: "text/html" }],
		items,
	};
}
