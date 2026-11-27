/**
 * Unit-Tests für den Mini-XLSX-Schreiber des Treffer-Exports. Lauf:
 *   npx tsx --test src/lib/server/xlsx.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	XLSX_MAX_CELL_CHARS,
	XLSX_STATIC_PARTS,
	cellText,
	columnLetter,
	xlsxHeaderRow,
	xlsxRow,
	xlsxSheetEnd,
	xlsxSheetStart,
	xlsxWorkbook,
	xmlEscape,
} from "./xlsx";
import type { ExportColumn } from "./exportFormat";

const COLS: ExportColumn[] = [
	{ key: "rank", kind: "number", width: 7 },
	{ key: "title", kind: "text", width: 40 },
	{ key: "dateYear", kind: "number", width: 8 },
];

test("columnLetter: A…Z, AA…", () => {
	assert.equal(columnLetter(0), "A");
	assert.equal(columnLetter(25), "Z");
	assert.equal(columnLetter(26), "AA");
	assert.equal(columnLetter(51), "AZ");
	assert.equal(columnLetter(52), "BA");
	assert.equal(columnLetter(701), "ZZ");
	assert.equal(columnLetter(702), "AAA");
});

test("xmlEscape: Sonderzeichen + verbotene Steuerzeichen", () => {
	assert.equal(xmlEscape(`a<b>&"c'`), "a&lt;b&gt;&amp;&quot;c'");
	assert.equal(xmlEscape("x\u0000y\u0008z\u000Bq\uFFFEw"), "xyzqw");
	assert.equal(xmlEscape("Tab\tLF\nCR\r"), "Tab\tLF\nCR\r");
	assert.equal(xmlEscape("Emoji 😀 ok"), "Emoji 😀 ok");
	assert.equal(xmlEscape("lone \uD800 surrogate"), "lone  surrogate");
});

test("cellText: kürzt auf die Excel-Grenze", () => {
	const long = "x".repeat(XLSX_MAX_CELL_CHARS + 50);
	const out = cellText(long);
	assert.equal(out.length, XLSX_MAX_CELL_CHARS);
	assert.ok(out.endsWith("…"));
	assert.equal(cellText("kurz"), "kurz");
});

test("xlsxRow: Zahlen als Zahl, Text inline, leere Zellen weg", () => {
	const row = xlsxRow(2, [1, "Armut & Not", null], COLS);
	assert.equal(
		row,
		'<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>Armut &amp; Not</t></is></c></row>',
	);
	// Zahl in Textspalte bleibt Text
	assert.ok(xlsxRow(3, [1, 1989, 1989], COLS).includes('<c r="B3" t="inlineStr"><is><t>1989</t></is></c>'));
	assert.ok(xlsxRow(3, [1, 1989, 1989], COLS).includes('<c r="C3"><v>1989</v></c>'));
	// führender Leerraum bleibt erhalten
	assert.ok(xlsxRow(4, [null, " x", null], COLS).includes('<t xml:space="preserve"> x</t>'));
});

test("Kopfzeile fett (Stil 1), Blatt-Rahmen, Workbook mit Filterbereich", () => {
	assert.equal(
		xlsxHeaderRow(COLS),
		'<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>rank</t></is></c>' +
			'<c r="B1" t="inlineStr" s="1"><is><t>title</t></is></c>' +
			'<c r="C1" t="inlineStr" s="1"><is><t>dateYear</t></is></c></row>',
	);
	const start = xlsxSheetStart(COLS);
	assert.ok(start.startsWith("<?xml"));
	assert.ok(start.includes('state="frozen"'));
	assert.ok(start.includes('<col min="2" max="2" width="40" customWidth="1"/>'));
	assert.ok(start.endsWith("<sheetData>"));
	assert.equal(xlsxSheetEnd(101, 3), '</sheetData><autoFilter ref="A1:C101"/></worksheet>');
	assert.ok(xlsxWorkbook(101, 3).includes("Treffer!$A$1:$C$101</definedName>"));
	assert.ok(xlsxWorkbook(1, 3).includes('<autoFilter') === false);
	const names = XLSX_STATIC_PARTS.map(([n]) => n);
	assert.deepEqual(names, ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml"]);
});
