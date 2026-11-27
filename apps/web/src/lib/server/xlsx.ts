// Minimaler XLSX-Schreiber (SpreadsheetML) für den Treffer-Export – bewusst ohne
// Bibliothek: eine Tabelle, Inline-Strings, fette + fixierte Kopfzeile,
// Autofilter, Spaltenbreiten. Pur (nur XML-Strings); das Verpacken als ZIP
// (archiver) macht exportStream.ts, damit das Arbeitsblatt Zeile für Zeile
// gestreamt werden kann. Nur relative Imports (tsx --test).

import type { CellValue, ExportColumn } from "./exportFormat";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const XLSX_SHEET_NAME = "Treffer";
// Excel-Grenze pro Zelle
export const XLSX_MAX_CELL_CHARS = 32_767;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** 0 → A, 25 → Z, 26 → AA … */
export function columnLetter(index: number): string {
	let n = index + 1;
	let s = "";
	while (n > 0) {
		const r = (n - 1) % 26;
		s = String.fromCharCode(65 + r) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

// In XML 1.0 verbotene Zeichen (Steuerzeichen ausser Tab/LF/CR, Nicht-Zeichen,
// einzelne Surrogates) – sonst meldet Excel eine beschädigte Datei.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlEscape(s: string): string {
	return s
		.replace(INVALID_XML, "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Zelltext säubern + auf die Excel-Grenze kürzen. */
export function cellText(s: string): string {
	const clean = s.replace(INVALID_XML, "");
	return clean.length > XLSX_MAX_CELL_CHARS ? clean.slice(0, XLSX_MAX_CELL_CHARS - 1) + "…" : clean;
}

function textCell(ref: string, value: string, style?: number): string {
	const text = cellText(value);
	const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
	const s = style ? ` s="${style}"` : "";
	return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${xmlEscape(text)}</t></is></c>`;
}

/** Eine Zeile `<row>` (1-basiert); leere Werte werden weggelassen. */
export function xlsxRow(rowIndex: number, cells: CellValue[], columns: ExportColumn[], style?: number): string {
	let out = `<row r="${rowIndex}">`;
	cells.forEach((value, i) => {
		if (value == null || value === "") return;
		const ref = `${columnLetter(i)}${rowIndex}`;
		if (typeof value === "number" && Number.isFinite(value) && columns[i]?.kind === "number" && !style) {
			out += `<c r="${ref}"><v>${value}</v></c>`;
		} else {
			out += textCell(ref, String(value), style);
		}
	});
	return out + "</row>";
}

/** Kopfzeile (fett, Stil 1). */
export function xlsxHeaderRow(columns: ExportColumn[]): string {
	return xlsxRow(
		1,
		columns.map((c) => c.key),
		columns,
		1,
	);
}

/** Anfang von sheet1.xml bis `<sheetData>` (fixierte Kopfzeile, Spaltenbreiten). */
export function xlsxSheetStart(columns: ExportColumn[]): string {
	const cols = columns
		.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
		.join("");
	return (
		XML_DECL +
		`<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
		'<sheetViews><sheetView workbookViewId="0">' +
		'<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
		'<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
		"</sheetView></sheetViews>" +
		'<sheetFormatPr defaultRowHeight="15"/>' +
		`<cols>${cols}</cols>` +
		"<sheetData>"
	);
}

function filterRange(lastRow: number, columnCount: number): string {
	return `A1:${columnLetter(columnCount - 1)}${Math.max(1, lastRow)}`;
}

/** Ende von sheet1.xml: Autofilter über alle geschriebenen Zeilen. */
export function xlsxSheetEnd(lastRow: number, columnCount: number): string {
	return `</sheetData><autoFilter ref="${filterRange(lastRow, columnCount)}"/></worksheet>`;
}

/** workbook.xml – mit dem Filter-Bereich als definiertem Namen (erwartet Excel beim Autofilter). */
export function xlsxWorkbook(lastRow: number, columnCount: number): string {
	const [from, to] = filterRange(lastRow, columnCount).split(":");
	const abs = (ref: string) => ref.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
	return (
		XML_DECL +
		`<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
		`<sheets><sheet name="${XLSX_SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>` +
		'<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
		`${XLSX_SHEET_NAME}!${abs(from)}:${abs(to)}</definedName></definedNames>` +
		"</workbook>"
	);
}

/** Statische Teile des Pakets (Pfad → Inhalt). */
export const XLSX_STATIC_PARTS: ReadonlyArray<readonly [string, string]> = [
	[
		"[Content_Types].xml",
		XML_DECL +
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
			'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
			'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
			"</Types>",
	],
	[
		"_rels/.rels",
		XML_DECL +
			`<Relationships xmlns="${NS_PKG_REL}">` +
			`<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
			"</Relationships>",
	],
	[
		"xl/_rels/workbook.xml.rels",
		XML_DECL +
			`<Relationships xmlns="${NS_PKG_REL}">` +
			`<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
			`<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
			"</Relationships>",
	],
	[
		"xl/styles.xml",
		XML_DECL +
			`<styleSheet xmlns="${NS_MAIN}">` +
			'<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
			'<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
			'<fills count="2"><fill><patternFill patternType="none"/></fill>' +
			'<fill><patternFill patternType="gray125"/></fill></fills>' +
			'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
			'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
			'<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
			'<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
			'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
			"</styleSheet>",
	],
];

export const XLSX_SHEET_PATH = "xl/worksheets/sheet1.xml";
export const XLSX_WORKBOOK_PATH = "xl/workbook.xml";
