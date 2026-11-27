// Lauf: npx tsx --test src/lib/catalogFields.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	addCatalogField,
	bestandSuggestions,
	BESTAND_SUGGEST_MAX,
	catalogFieldChip,
	catalogFieldConditions,
	catalogFieldExactByDefault,
	catalogFieldMarks,
	catalogFieldsRankable,
	catalogFieldValue,
	parseCatalogFields,
	planFieldSearch,
	searchesSignature,
	signatureEntryOf,
	writeCatalogFields,
} from "./catalogFields";
import { parseCatalogFilters, writeCatalogParams } from "./catalog";
import { searchViewUrl } from "./searchViews";

const sp = (qs: string) => new URLSearchParams(qs);

test("parseCatalogFields: je Feld in fester Reihenfolge, leer und doppelt fällt weg", () => {
	const fields = parseCatalogFields(sp("catTitle=M%C3%BChle&catSig=C+II+12&catTitle=+&catTitle=m%C3%BChle&catProv=Bezirksgericht&catText=%22Konkurs%22"));
	assert.deepEqual(fields, [
		{ field: "signature", value: "C II 12" },
		{ field: "title", value: "Mühle" },
		{ field: "text", value: '"Konkurs"' },
		{ field: "provenienz", value: "Bezirksgericht" },
	]);
	// Leerzeichen zusammengezogen, höchstens zehn je Feld, Werte gekürzt.
	assert.deepEqual(parseCatalogFields(sp("catTitle=%20a%20%20b%20")), [{ field: "title", value: "a b" }]);
	const many = parseCatalogFields(sp(Array.from({ length: 12 }, (_, i) => `catTitle=w${i}`).join("&")));
	assert.equal(many.length, 10);
	assert.equal(parseCatalogFields(sp(`catSig=${"x".repeat(300)}`))[0].value.length, 200);
	assert.deepEqual(parseCatalogFields(sp("q=Rüti&catBestand=C+I")), []);
});

test("writeCatalogFields: ersetzt die Feld-Parameter, Rundreise über parseCatalogFields", () => {
	const params = sp("q=R%C3%BCti&catTitle=alt&catSig=alt");
	const entries = [
		{ field: "title" as const, value: "Kloster" },
		{ field: "signature" as const, value: '"C II 12"' },
		{ field: "title" as const, value: "-Amt" },
	];
	writeCatalogFields(params, entries);
	assert.equal(params.get("q"), "Rüti");
	assert.deepEqual(params.getAll("catTitle"), ["Kloster", "-Amt"]);
	assert.deepEqual(params.getAll("catSig"), ['"C II 12"']);
	// Gelesen in fester Feldreihenfolge (Signatur zuerst).
	assert.deepEqual(parseCatalogFields(params), [entries[1], entries[0], entries[2]]);
});

test("Katalog-Filter tragen die Feldsuche; sie bleibt beim Reiterwechsel stehen", () => {
	const url = new URL("http://x/search?catView=1&catSig=C+II&catText=Kauf");
	const f = parseCatalogFilters(url);
	assert.deepEqual(f.fields, [
		{ field: "signature", value: "C II" },
		{ field: "text", value: "Kauf" },
	]);
	const written = writeCatalogParams(new URL("http://x/search?q=Rüti&view=catalog"), { level: [], bestand: [], digital: false, fields: f.fields });
	assert.equal(written.search, "?q=R%C3%BCti&view=catalog&catSig=C+II&catText=Kauf");
	// «Filter zurücksetzen» schreibt eine leere Feldsuche.
	assert.equal(writeCatalogParams(new URL(written), { level: [], bestand: [], digital: false, fields: [] }).search, "?q=R%C3%BCti&view=catalog");
	// Andere Reiter: die Feldsuche bleibt in der URL und gilt beim Zurückwechseln wieder.
	assert.deepEqual(parseCatalogFilters(searchViewUrl(written, "documents")).fields, f.fields);
	assert.deepEqual(parseCatalogFilters(searchViewUrl(written, "ehedaten")).fields, f.fields);
});

test("catalogFieldValue: exakt ⇒ Phrase, ausschliessen ⇒ jedes Wort verneint, kein ODER", () => {
	assert.equal(catalogFieldValue("  Kloster   Rüti ", { exact: false, exclude: false }), "Kloster Rüti");
	assert.equal(catalogFieldValue("C II 12", { exact: true, exclude: false }), '"C II 12"');
	assert.equal(catalogFieldValue("Amt Vogtei", { exact: false, exclude: true }), "-Amt -Vogtei");
	assert.equal(catalogFieldValue("Amt -Vogtei", { exact: false, exclude: true }), "-Amt -Vogtei");
	assert.equal(catalogFieldValue("Kloster Rüti", { exact: true, exclude: true }), '-"Kloster Rüti"');
	// Anführungszeichen in der Eingabe machen eine Phrase (wie beim Suchbegriff).
	assert.equal(catalogFieldValue('"Kloster Rüti" Kauf', { exact: false, exclude: false }), '"Kloster Rüti Kauf"');
	assert.equal(catalogFieldValue("Rüti OR Bubikon", { exact: false, exclude: false }), "Rüti OR Bubikon");
	assert.equal(catalogFieldValue("   ", { exact: true, exclude: false }), "");
	assert.equal(catalogFieldValue('""', { exact: false, exclude: false }), "");
});

test("catalogFieldExactByDefault: nur die Signatur sucht voreingestellt die Wortfolge", () => {
	assert.equal(catalogFieldExactByDefault("signature"), true);
	for (const key of ["title", "text", "provenienz", "bestand"] as const) assert.equal(catalogFieldExactByDefault(key), false);
});

test("addCatalogField: gleicher Eintrag im selben Feld nur einmal, in anderem Feld schon", () => {
	const one = addCatalogField([], { field: "title", value: "Mühle" });
	assert.deepEqual(addCatalogField(one, { field: "title", value: " mühle " }), one);
	assert.deepEqual(addCatalogField(one, { field: "text", value: "Mühle" }), [...one, { field: "text", value: "Mühle" }]);
	assert.deepEqual(addCatalogField(one, { field: "title", value: "  " }), one);
});

test("catalogFieldConditions: eine Bedingung je Feld, Einträge zusammen", () => {
	assert.deepEqual(
		catalogFieldConditions([
			{ field: "title", value: "Kloster" },
			{ field: "signature", value: "C II" },
			{ field: "title", value: "-Amt" },
		]),
		[
			{ field: "signature", q: "C II" },
			{ field: "title", q: "Kloster -Amt" },
		],
	);
	assert.deepEqual(catalogFieldConditions(undefined), []);
});

test("catalogFieldChip: Anzeige wie die Chips des Suchbegriffs", () => {
	assert.deepEqual(catalogFieldChip({ field: "signature", value: '"C II 12"' }), { label: "Signatur: „C II 12\"", kind: "phrase" });
	assert.deepEqual(catalogFieldChip({ field: "title", value: "-Amt -Vogtei" }), { label: "Titel: − Amt − Vogtei", kind: "exclude" });
	assert.deepEqual(catalogFieldChip({ field: "text", value: "Kauf Rüti" }), { label: "Inhalt und Form: Kauf Rüti", kind: "term" });
	assert.equal(catalogFieldsRankable([]), false);
	assert.equal(catalogFieldsRankable([{ field: "title", value: "-Amt" }]), true);
});

test("catalogFieldMarks: nur vorkommende Wörter aus Titel und Inhalt und Form, Phrasen ganz", () => {
	assert.deepEqual(
		catalogFieldMarks([
			{ field: "signature", q: "C II" },
			{ field: "title", q: '-Amt "Kloster Rüti" Kauf' },
			{ field: "text", q: "Zehnten" },
			{ field: "provenienz", q: "Notariat" },
		]),
		{ title: ["Kloster Rüti", "Kauf"], text: ["Zehnten"] },
	);
});

test("planFieldSearch: eine Bedingung direkt, sonst Kette ab der kleinsten", () => {
	const cap = 10_000;
	assert.deepEqual(planFieldSearch([], { mainIndex: null, cap }), { kind: "none" });
	assert.deepEqual(planFieldSearch([50_000], { mainIndex: null, cap }), { kind: "native", main: 0 });
	// Ohne Suchbegriff bleibt die grösste Bedingung die Abfrage, die übrigen kleinste zuerst.
	assert.deepEqual(planFieldSearch([4_917, 1_931, 120_000], { mainIndex: null, cap }), { kind: "chain", main: 2, chain: [1, 0] });
	// Mit Suchbegriff (Index 0) bleibt er die Abfrage, auch wenn er gross ist.
	assert.deepEqual(planFieldSearch([18_221, 4_917], { mainIndex: 0, cap }), { kind: "chain", main: 0, chain: [1] });
	// Sind alle übrigen zu gross, beginnt die Kette mit der Abfrage selbst.
	assert.deepEqual(planFieldSearch([212, 132_498], { mainIndex: 0, cap }), { kind: "chain", main: 0, chain: [0, 1] });
	// Gleich grosse: die erste bleibt die Abfrage.
	assert.deepEqual(planFieldSearch([7, 7], { mainIndex: null, cap }), { kind: "chain", main: 0, chain: [1] });
	assert.deepEqual(planFieldSearch([30_000, 0], { mainIndex: null, cap }), { kind: "empty" });
	assert.deepEqual(planFieldSearch([30_000, 20_000], { mainIndex: null, cap }), { kind: "tooBroad" });
	assert.deepEqual(planFieldSearch([30_000, 20_000, 12_000], { mainIndex: 0, cap }), { kind: "tooBroad" });
});

test("bestandSuggestions: jedes Wort als Wortanfang, ohne Akzente, häufigste zuerst", () => {
	const dist = {
		"E III Kirchenbücher und Zivilstandsbücher der Landgemeinden, 1524-1999": 34_829,
		"E II Antistitialarchiv, 1370-1833 (Bestand)": 830,
		"Kirchenrat, 1849-2022 (Bestand)": 2_250,
		"Notariat Rüti, 1836-2000 (Bestand)": 300,
		"Notariat Zürich (Altstadt), 1741.09-2019.07 (Bestand)": 1_353,
	};
	const values = (fq: string) => bestandSuggestions(dist, fq).map((s) => s.value.split(",")[0]);
	// Meilis Facettensuche fände «Kirchenbücher» nicht (Wert beginnt mit «E III»).
	assert.deepEqual(values("kirchenb"), ["E III Kirchenbücher und Zivilstandsbücher der Landgemeinden"]);
	assert.deepEqual(values("e iii"), ["E III Kirchenbücher und Zivilstandsbücher der Landgemeinden"]);
	assert.deepEqual(values("notariat ruti"), ["Notariat Rüti"]);
	assert.deepEqual(values("Kirchen"), ["E III Kirchenbücher und Zivilstandsbücher der Landgemeinden", "Kirchenrat"]);
	assert.deepEqual(values("1849"), ["Kirchenrat"]);
	assert.equal(bestandSuggestions(dist, "").length, 5);
	assert.deepEqual(bestandSuggestions(dist, "")[0], { value: "E III Kirchenbücher und Zivilstandsbücher der Landgemeinden, 1524-1999", count: 34_829 });
	const big = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Bestand ${i}, 1900 (Bestand)`, 50 - i]));
	assert.equal(bestandSuggestions(big, "bestand").length, BESTAND_SUGGEST_MAX);
	assert.deepEqual(bestandSuggestions({ "Leer, 1900 (Bestand)": 0 }, ""), []);
	// ß und ss gelten als gleich.
	const ss = { "Straßenbau, 1900 (Bestand)": 2, "Strassenverkehr, 1900 (Bestand)": 1 };
	assert.equal(bestandSuggestions(ss, "strass").length, 2);
	assert.equal(bestandSuggestions(ss, "Straß").length, 2);
});

test("Signatursuche: nur ein vorkommender Eintrag im Feld Signatur schliesst Plattform-Einheiten ein", () => {
	assert.equal(searchesSignature(undefined), false);
	assert.equal(searchesSignature([{ field: "title", value: "MM 3.56" }]), false);
	assert.equal(searchesSignature([{ field: "signature", value: "-MM" }, { field: "signature", value: '-"C II"' }]), false);
	assert.equal(searchesSignature([{ field: "signature", value: "-MM" }, { field: "signature", value: '"C II 12"' }]), true);
});

test("«StAZH» vor der Signatur fällt weg, in anderen Feldern nicht", () => {
	assert.deepEqual(catalogFieldConditions([{ field: "signature", value: '"StAZH MM 3.56 RRB 1938/1585"' }, { field: "title", value: "StAZH Neubau" }]), [
		{ field: "signature", q: '"MM 3.56 RRB 1938/1585"' },
		{ field: "title", q: "StAZH Neubau" },
	]);
});

test("signatureEntryOf: Suchbegriffe, die wie eine Signatur aussehen", () => {
	for (const [q, value] of [
		["MM 3.56 RRB 1938/1585", '"MM 3.56 RRB 1938/1585"'],
		['"StAZH C II 12, Nr. 3"', '"C II 12, Nr. 3"'],
		["B II 400 (S. 1-2)", '"B II 400 (S. 1-2)"'],
		["ABl 1915", '"ABl 1915"'],
	]) assert.deepEqual(signatureEntryOf(q), { field: "signature", value }, q);
	for (const q of ["", "Mühle", "Mühle 1850", "RRB", "EWZ Strom", "1938/1585"]) assert.equal(signatureEntryOf(q), null, q);
});
