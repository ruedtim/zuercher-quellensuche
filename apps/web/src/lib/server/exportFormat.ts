// Formate des Treffer-Exports («Alle Treffer herunterladen»): Spalten, CSV,
// Dateinamen, README und IIIF-Sammlung. Pur und env-frei – nur relative
// Imports, damit das Modul unter `tsx --test` läuft (kein $lib-Alias dort).
//
// Die I/O-Seite (Meili, Streams) steckt in exportStream.ts bzw. im Endpoint
// routes/api/search/export/+server.ts.

import type { SearchHit, SearchParams } from "../types";
import { DEFAULT_SEARCH, SERIES_LABEL } from "../types";
import { normalizeWhitespace } from "../format";
import { normalizeManifestUrlForUser } from "../manifestUrl";
import { searchParamsToUrl } from "../searchParams";
import { hasDocumentKey, type EntityDim } from "../entityFilter";
import { writeSearchView } from "../searchViews";
import type { ExportContent, ExportCount, ExportFormat } from "../exportLimits";
import { exportCountLabel, formatCount } from "../exportLimits";
import { buildSlug } from "./packageDownload";
import { SITE_DISCLAIMER, SITE_NAME } from "../site";
import { ATTRIBUTION, LICENSE, LICENSE_URL } from "./apiV1/constants";

// --- Felder + Spalten --------------------------------------------------------

// Meili-Felder für die Tabelle (ohne Body – der kommt nur beim Volltext-Export).
export const EXPORT_META_FIELDS = [
	"id",
	"series",
	"title",
	"date",
	"dateYear",
	"volumeNr",
	"startPg",
	"serialNr",
	"resolutionId",
	"stazhIdent",
	"subset",
	"persons",
	"places",
	"organizations",
	"archiveLink",
	"manifestUrl",
];
export const EXPORT_TEXT_FIELDS = [...EXPORT_META_FIELDS, "body"];

export type CellValue = string | number | null;

export interface ExportColumn {
	key: string;
	// "number" ⇒ XLSX-Zahlenzelle (sortier-/filterbar), sonst Text
	kind: "text" | "number";
	// Spaltenbreite in XLSX (Zeichen)
	width: number;
}

// Spaltennamen = Feldnamen der API (/api/v1, MCP), damit sich Export und API
// ohne Umbenennen verbinden lassen; das README erklärt sie auf Deutsch.
export const EXPORT_COLUMNS: ExportColumn[] = [
	{ key: "rank", kind: "number", width: 7 },
	{ key: "id", kind: "text", width: 34 },
	{ key: "series", kind: "text", width: 7 },
	{ key: "stazhIdent", kind: "text", width: 34 },
	{ key: "title", kind: "text", width: 70 },
	{ key: "date", kind: "text", width: 11 },
	{ key: "dateYear", kind: "number", width: 9 },
	{ key: "volumeNr", kind: "number", width: 9 },
	{ key: "startPg", kind: "number", width: 8 },
	{ key: "serialNr", kind: "text", width: 10 },
	{ key: "resolutionId", kind: "text", width: 12 },
	{ key: "subset", kind: "text", width: 9 },
	{ key: "persons", kind: "text", width: 40 },
	{ key: "places", kind: "text", width: 30 },
	{ key: "organizations", kind: "text", width: 30 },
	{ key: "url", kind: "text", width: 50 },
	{ key: "teiUrl", kind: "text", width: 50 },
	{ key: "manifestUrl", kind: "text", width: 50 },
	{ key: "archiveLink", kind: "text", width: 50 },
];
export const TEXT_FILE_COLUMN: ExportColumn = { key: "textFile", kind: "text", width: 50 };

/** Spalten des Exports: im Volltext-ZIP kommt der Pfad der Textdatei dazu. */
export function exportColumns(withTextFile: boolean): ExportColumn[] {
	return withTextFile ? [...EXPORT_COLUMNS, TEXT_FILE_COLUMN] : EXPORT_COLUMNS;
}

// Trenner für Mehrfachwerte (Personen/Orte/Organisationen). Kein Komma/
// Semikolon – Namen enthalten beides («Müller, Hans»).
export const MULTI_VALUE_SEPARATOR = " | ";

function joinList(values: string[] | undefined): string | null {
	const clean = (values ?? []).map((v) => normalizeWhitespace(v)).filter(Boolean);
	return clean.length > 0 ? clean.join(MULTI_VALUE_SEPARATOR) : null;
}

/** Eine Tabellenzeile (Reihenfolge = exportColumns). */
export function docToCells(doc: SearchHit, rank: number, base: string, textFile?: string): CellValue[] {
	const id = encodeURIComponent(doc.id);
	const manifest = doc.manifestUrl ? normalizeManifestUrlForUser(doc.manifestUrl, new URL(base)) : null;
	const cells: CellValue[] = [
		rank,
		doc.id,
		doc.series,
		normalizeWhitespace(doc.stazhIdent) || null,
		normalizeWhitespace(doc.title) || null,
		doc.date ?? null,
		doc.dateYear ?? null,
		doc.volumeNr ?? null,
		doc.startPg ?? null,
		doc.serialNr ?? null,
		doc.resolutionId ?? null,
		doc.subset ?? null,
		joinList(doc.persons),
		joinList(doc.places),
		joinList(doc.organizations),
		`${base}/documents/${doc.series}/${id}`,
		`${base}/xml/${doc.series}/${id}.xml`,
		manifest,
		doc.archiveLink ?? null,
	];
	if (textFile !== undefined) cells.push(textFile);
	return cells;
}

// --- CSV (RFC 4180) ------------------------------------------------------------

// UTF-8-BOM: sonst liest Excel die Datei als Windows-1252 (Umlaute kaputt).
export const CSV_BOM = "\uFEFF";

export function csvEscape(value: CellValue | undefined): string {
	if (value == null) return "";
	const s = typeof value === "number" ? String(value) : value;
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Eine CSV-Zeile inkl. CRLF (RFC 4180). */
export function csvRow(cells: CellValue[]): string {
	return cells.map(csvEscape).join(",") + "\r\n";
}

export function csvHeader(columns: ExportColumn[]): string {
	return csvRow(columns.map((c) => c.key));
}

// --- Namen ---------------------------------------------------------------------

function asciiSlug(s: string, max: number): string {
	const folded = s
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/ß/g, "ss")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return folded.slice(0, max).replace(/-+$/g, "");
}

/** Datum JJJJ-MM-TT in Zürcher Zeit (Dateiname, README). */
export function zurichDate(now: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Zurich",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

/**
 * Basisname ohne Endung: `zentraleserien_<such-slug>_<JJJJ-MM-TT>` (ASCII).
 * Der Such-Slug nennt den Suchbegriff, sonst die ODER-Begriffe, das Thema oder
 * die Serien – damit mehrere Exporte im Download-Ordner unterscheidbar sind.
 */
export function exportBaseName(params: SearchParams, now: Date): string {
	// Ausschluss-Tokens (`-wort`) gehören nicht in den Namen.
	const positiveQ = params.q
		.split(/\s+/)
		.filter((t) => t && !t.startsWith("-"))
		.join(" ");
	const source =
		positiveQ.trim() ||
		params.anyTerms.join(" oder ") ||
		params.theme.trim() ||
		params.series.join("-") ||
		"";
	const slug = asciiSlug(source, 40) || "treffer";
	return `zentraleserien_${slug}_${zurichDate(now)}`;
}

export function exportFileExtension(content: ExportContent, format: ExportFormat): string {
	return content === "table" ? format : "zip";
}

/** Dateiname der Tabelle innerhalb des ZIP. */
export function tableEntryName(format: ExportFormat): string {
	return `treffer.${format}`;
}

/** Pfad der Volltext-Datei im ZIP: `texte/00042_<signatur>.txt` (Rang zuerst ⇒ Reihenfolge). */
export function textEntryName(rank: number, total: number, doc: Pick<SearchHit, "id" | "stazhIdent">): string {
	const width = Math.max(3, String(total).length);
	const slug = buildSlug(normalizeWhitespace(doc.stazhIdent), doc.id).slice(0, 80);
	return `texte/${String(rank).padStart(width, "0")}_${slug}.txt`;
}

/** Titel des Exports (IIIF-Sammlung), z. B. «<Name der Website> – Suche «Armut»». */
export function exportTitle(params: SearchParams): string {
	const what = params.q.trim() || params.anyTerms.join(" ODER ") || params.theme.trim();
	return what
		? `${SITE_NAME} – Suche «${what}»`
		: `${SITE_NAME} – Treffer-Export`;
}

/** Such-Link zum Reproduzieren (ohne Seite). */
export function reproducibleSearchUrl(params: SearchParams, base: string): string {
	const url = searchParamsToUrl(
		{ ...params, page: 1, pageSize: DEFAULT_SEARCH.pageSize },
		new URL("/search", `${base}/`),
	);
	return writeSearchView(url, "documents").toString();
}

// --- Reihenfolge -----------------------------------------------------------------

/** IDs stabil deduplizieren (erstes Vorkommen gewinnt). */
export function dedupeIds(ids: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/**
 * Batch-Antwort (beliebige Reihenfolge) in die Reihenfolge der IDs bringen.
 * `rankOffset` = Rang-1 des ersten IDs im Batch; fehlende Docs (seit dem
 * ID-Pass gelöscht) behalten ihre Lücke im Rang und werden gezählt.
 */
export function orderByIds(
	ids: string[],
	docs: SearchHit[],
	rankOffset: number,
): { ordered: Array<{ rank: number; doc: SearchHit }>; missing: number } {
	const byId = new Map(docs.map((d) => [d.id, d]));
	const ordered: Array<{ rank: number; doc: SearchHit }> = [];
	let missing = 0;
	ids.forEach((id, i) => {
		const doc = byId.get(id);
		if (doc) ordered.push({ rank: rankOffset + i + 1, doc });
		else missing++;
	});
	return { ordered, missing };
}

// --- IIIF-Sammlung ---------------------------------------------------------------

// IIIF verlangt für `rights` die kanonische http-URI (nicht die deed-Seite).
export const IIIF_RIGHTS_PDM = "http://creativecommons.org/publicdomain/mark/1.0/";

// Ratsmanuale: Bilder vom Transkribus-Bildserver, ohne Rechtekennzeichnung –
// nur der Bildnachweis (wie das requiredStatement ihrer Manifeste).
export const RM_FACSIMILE_STATEMENT =
	"Faksimiles der Ratsmanuale (RM): Digitalisat: Staatsarchiv des Kantons Zürich, StAZH B II; " +
	"Bilder vom Transkribus-Bildserver (READ-COOP SCE), ohne Rechtekennzeichnung.";

export interface IiifItem {
	manifestUrl: string;
	label: string;
	// Serie des Dokuments – RM-Faksimiles bekommen kein pauschales `rights`.
	series?: string;
}

/** Beschriftung eines Sammlungs-Eintrags: «Titel (Signatur)». */
export function iiifItemLabel(doc: Pick<SearchHit, "id" | "title" | "stazhIdent">): string {
	const title = normalizeWhitespace(doc.title) || doc.id;
	const ident = normalizeWhitespace(doc.stazhIdent);
	return ident && ident !== title ? `${title} (${ident})` : title;
}

/**
 * IIIF Presentation 3 Collection mit allen Manifesten des Exports. Sind
 * Ratsmanual-Faksimiles dabei, entfällt das pauschale `rights` (PDM gilt dort
 * nur für Text und Metadaten), und der Nachweis nennt ihre Herkunft.
 */
export function buildIiifCollection(input: {
	id: string;
	label: string;
	summary: string;
	items: IiifItem[];
}): string {
	const withRm = input.items.some((it) => it.series === "RM");
	const collection = {
		"@context": "http://iiif.io/api/presentation/3/context.json",
		id: input.id,
		type: "Collection",
		label: { de: [input.label] },
		summary: { de: [input.summary] },
		...(withRm ? {} : { rights: IIIF_RIGHTS_PDM }),
		requiredStatement: {
			label: { de: ["Quelle"] },
			value: { de: withRm ? [ATTRIBUTION, RM_FACSIMILE_STATEMENT] : [ATTRIBUTION] },
		},
		items: input.items.map((it) => ({
			id: it.manifestUrl,
			type: "Manifest",
			label: { de: [it.label] },
		})),
	};
	return JSON.stringify(collection, null, 2) + "\n";
}

// --- README ------------------------------------------------------------------------

export interface ExportReadmeInput {
	content: ExportContent;
	format: ExportFormat;
	params: SearchParams;
	// Namensfilter galten auch über die Vergleichsschlüssel (andere Schreibungen)
	entityKeys?: boolean;
	searchUrl: string;
	baseUrl: string;
	// Geplanter Umfang (exportableCount) – Zähler, Deckel-Grund
	planned: ExportCount;
	// Tatsächlich geschriebene Dokumente
	exported: number;
	// Seit dem ID-Pass verschwundene Dokumente
	missing: number;
	// Volltext-Budget erreicht (Export vorzeitig beendet)
	stoppedByBudget: boolean;
	budgetMb: number;
	// Dokumente mit Faksimile (Einträge der IIIF-Sammlung)
	withFacsimile: number;
	// Exportierte Ratsmanual-Dokumente (Lesefassung, Bilder ohne Kennzeichnung)
	withRm: number;
	generatedAt: Date;
}

const SORT_LABEL: Record<SearchParams["sort"], string> = {
	relevance: "Relevanz",
	date_asc: "Datum aufsteigend",
	date_desc: "Datum absteigend",
};

function describeSearch(p: SearchParams, keyed = false): string[] {
	const lines: string[] = [];
	if (p.q.trim()) lines.push(`Suchbegriff:      ${p.q.trim()}${p.titleOnly ? " (nur im Titel)" : ""}`);
	if (p.anyTerms.length > 0) lines.push(`ODER-Begriffe:    ${p.anyTerms.join(" | ")}`);
	if (p.theme.trim()) lines.push(`Thema:            ${p.theme.trim()}`);
	if (p.series.length > 0) {
		lines.push(`Serien:           ${p.series.map((s) => `${s} (${SERIES_LABEL[s]})`).join(", ")}`);
	}
	if (p.dateFrom != null || p.dateTo != null) {
		lines.push(`Zeitraum:         ${p.dateFrom ?? "…"} bis ${p.dateTo ?? "…"}`);
	}
	if (p.years.length > 0) lines.push(`Jahrgänge:        ${p.years.join(", ")}`);
	if (p.volumeNr.length > 0) lines.push(`Bände:            ${p.volumeNr.join(", ")}`);
	if (p.startPg.length > 0) lines.push(`Startseiten:      ${p.startPg.join(", ")}`);
	if (p.serialNr.length > 0) lines.push(`Ordnungsnummern:  ${p.serialNr.join(", ")}`);
	if (p.resolutionId.length > 0) lines.push(`Beschlussnummern: ${p.resolutionId.join(", ")}`);
	const variants = (dim: EntityDim, values: string[]) => (keyed && hasDocumentKey(dim, values) ? " (auch andere Schreibungen)" : "");
	if (p.persons.length > 0) lines.push(`Personen:         ${p.persons.join(" | ")}${variants("persons", p.persons)}`);
	if (p.places.length > 0) lines.push(`Orte:             ${p.places.join(" | ")}${variants("places", p.places)}`);
	if (p.organizations.length > 0) {
		lines.push(`Organisationen:   ${p.organizations.join(" | ")}${variants("organizations", p.organizations)}`);
	}
	if (lines.length === 0) lines.push("(keine Einschränkung: ganzer Bestand)");
	lines.push(`Sortierung:       ${SORT_LABEL[p.sort]}`);
	return lines;
}

function scopeExplanation(c: ExportCount, baseUrl: string): string[] {
	const n = formatCount(c.count);
	const m = formatCount(c.total);
	switch (c.scope) {
		case "all":
			return ["Enthalten sind alle Treffer der Suche."];
		case "cap":
			return [
				`Obergrenze dieses Exports erreicht: enthalten sind die ersten ${n} von ${m} Treffern`,
				"(in der Reihenfolge der Trefferliste). Für mehr die Suche eingrenzen oder die",
				`Open-Data-Pakete nutzen: ${baseUrl}/about/api#bulk-daten`,
			];
		case "pool":
			return [
				`Thema mit Suchbegriff oder ODER-Begriffen: enthalten sind die ersten ${n} von ${m}`,
				"Treffern in der Reihenfolge der Trefferliste, zuerst die dem Thema nächsten.",
			];
		case "topK":
			return [
				`Thema mit Datums-Sortierung: enthalten sind die ${n} thematisch ähnlichsten Treffer`,
				`(«Themen-Umfang»${c.total > c.count ? `, aus ${m} Treffern` : ""}), nach Datum sortiert.`,
			];
		case "theme":
			return [
				`Thema-Ranking über die ganze Auswahl: enthalten sind die ${n} ähnlichsten von ${m}`,
				"Treffern, in der Reihenfolge der Trefferliste.",
			];
	}
}

const COLUMN_DOCS: Array<[string, string]> = [
	["rank", "Position in der Trefferliste"],
	["id", "Dokument-ID (auch für die API: /api/v1/documents/<id>)"],
	[
		"series",
		"Serie: ABl = Amtsblatt, KRP = Kantonsratsprotokolle, OS = Gesetzessammlung, RRB = Regierungsratsbeschlüsse, RM = Ratsmanuale",
	],
	["stazhIdent", "Signatur im Staatsarchiv"],
	["title", "Titel"],
	["date", "Datum (JJJJ-MM-TT); Ratsmanuale bis 1700 im alten Stil (julianisch), nicht umgerechnet"],
	["dateYear", "Jahr"],
	["volumeNr", "Band (OS; RM: Nummer in StAZH B II)"],
	["startPg", "Startseite (OS, ABl; RM: laufende Sitzung im Band)"],
	["serialNr", "Ordnungsnummer (OS)"],
	["resolutionId", "Beschlussnummer (RRB, JJJJ/NNNN)"],
	["subset", "Teilbestand: krp-late, rrb-late, os-late = born-digital (ohne Faksimile)"],
	["persons", "Erkannte Personen (mehrere mit « | » getrennt; bei RM leer, Entitäten nur im TEI)"],
	["places", "Erkannte Orte"],
	["organizations", "Erkannte Organisationen"],
	["url", "Detailseite auf der Plattform"],
	["teiUrl", "TEI-XML-Quelle (vollständiger Text mit Auszeichnung)"],
	["manifestUrl", "IIIF-Manifest der Faksimiles (leer = keine Faksimiles)"],
	["archiveLink", "Eintrag im Archivkatalog des Staatsarchivs (Spätbestände: Original-Publikation)"],
	["textFile", "Volltext-Datei in diesem Paket (nur mit Volltexten)"],
];

export function buildExportReadme(input: ExportReadmeInput): string {
	const withTexts = input.content !== "table";
	const tableName = tableEntryName(input.format);
	const heading = `${SITE_NAME} – Treffer-Export`;
	const lines: string[] = [
		heading,
		"=".repeat(heading.length),
		SITE_DISCLAIMER,
		"",
		`Erzeugt:          ${zurichDate(input.generatedAt)} (${input.baseUrl})`,
		`Suche:            ${input.searchUrl}`,
		...describeSearch(input.params, input.entityKeys === true && input.params.entityMatch !== "exact"),
		"",
		`Umfang:           ${exportCountLabel(input.planned)}`,
		...scopeExplanation(input.planned, input.baseUrl),
	];
	if (input.exported !== input.planned.count || input.missing > 0 || input.stoppedByBudget) {
		lines.push("");
		lines.push(`Tatsächlich exportiert: ${formatCount(input.exported)} Dokumente.`);
		if (input.missing > 0) {
			lines.push(
				`${formatCount(input.missing)} Dokumente waren beim Export nicht mehr im Index (zwischenzeitlich`,
				"geändert); ihre Ränge fehlen in der Tabelle.",
			);
		}
		if (input.stoppedByBudget) {
			lines.push(
				`Das Volltext-Budget von ${input.budgetMb} MB wurde erreicht; der Export endet nach Rang`,
				`${formatCount(input.exported + input.missing)}. Für den Rest die Suche eingrenzen.`,
			);
		}
	}
	lines.push("", "Inhalt dieses Pakets", "--------------------");
	lines.push("README.txt            diese Beschreibung");
	lines.push(`${tableName.padEnd(22)}eine Zeile pro Dokument, Reihenfolge = Trefferliste (Spalte rank)`);
	if (withTexts) {
		lines.push("texte/                eine .txt-Datei pro Dokument (Rang + Signatur im Dateinamen)");
	}
	if (input.content === "iiif") {
		lines.push(
			`iiif-collection.json  IIIF-Sammlung (Presentation 3) der ${formatCount(input.withFacsimile)} Dokumente mit Faksimile`,
		);
	}
	lines.push("", "Spalten der Tabelle", "-------------------");
	for (const [key, doc] of COLUMN_DOCS) {
		if (key === "textFile" && !withTexts) continue;
		lines.push(`${key.padEnd(14)}${doc}`);
	}
	lines.push("", "Hinweise", "--------");
	if (withTexts) {
		lines.push(
			"- Die Volltexte stammen aus dem Suchindex: Zeilenumbrüche und Leerraum sind vereinheitlicht,",
			"  sehr lange Dokumente nach 100 KiB abgeschnitten. Den vollständigen Text liefert die",
			"  TEI-Quelle (Spalte teiUrl) oder das Dokument-Paket auf der Detailseite.",
		);
		if (input.withRm > 0) {
			lines.push(
				"- Ratsmanuale (RM): maschinelle Transkription (HTR), Lesefehler möglich. Die Volltexte sind",
				"  die Lesefassung (aufgelöste Trennungen und Nasalstriche, ß im Wortinnern als ss);",
				"  die diplomatische Fassung steht in der TEI-Quelle.",
			);
		}
	}
	if (input.format === "csv") {
		lines.push(
			"- CSV: UTF-8, Komma als Trennzeichen. In Excel über «Daten > Aus Text/CSV» öffnen",
			"  (oder beim Export das Excel-Format wählen).",
		);
	}
	if (input.content === "iiif") {
		lines.push(
			"- IIIF: Die Sammlung lässt sich in IIIF-Viewern wie Mirador oder dem Universal Viewer öffnen.",
			"  Die Manifeste von OS, KRP und RRB liegen bei sources-online.org (IIIF Presentation 2),",
			"  die des Amtsblatts und der Ratsmanuale auf der Plattform (Presentation 3); gängige",
			"  Viewer lesen beide. Born-digital-Dokumente (Teilbestände *-late) haben keine Faksimiles.",
		);
		if (input.withRm > 0) {
			lines.push(
				"  Die Bilder der Ratsmanuale lädt der Viewer vom Transkribus-Bildserver (files.transkribus.eu,",
				"  READ-COOP SCE); sie tragen keine Rechtekennzeichnung, nur den Nachweis «Digitalisat:",
				"  Staatsarchiv des Kantons Zürich, StAZH B II <Band>».",
			);
		}
	}
	lines.push(
		`- Lizenz (Texte und Metadaten): ${LICENSE}.`,
		`  ${LICENSE_URL}`,
		`  Quellenangabe (erbeten, keine Bedingung): ${ATTRIBUTION}`,
		`- Vollständige Bestände: Open-Data-Pakete, siehe ${input.baseUrl}/about/api#bulk-daten`,
	);
	return lines.join("\n") + "\n";
}
