// Lauf: npx tsx --test src/lib/rmBands.test.ts
// Pure Logik (Bandschlüssel aus der Dokument-ID, Beschriftung) und die
// committete Bandtabelle (server/data/rm-bands.json, gebaut von
// `python -m rmtk.bandtable`). Schlägt ein Golden-Fall nach einem neuen Lauf
// fehl, hat sich die Collection geändert – erst prüfen, dann nachführen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	parseRmBandTable,
	rmBandHint,
	rmBandKey,
	rmBandLabel,
	rmBandSignature,
	rmBandViewFor,
	rmBandYears,
	type RmBand,
	type RmBandTable,
} from "./rmBands";

const table = JSON.parse(
	readFileSync(new URL("./server/data/rm-bands.json", import.meta.url), "utf8"),
) as RmBandTable;
const bands = parseRmBandTable(table);

test("Bandschlüssel aus der Dokument-ID", () => {
	assert.equal(rmBandKey("RM_1642_0441_0007"), "0441");
	assert.equal(rmBandKey("RM_1716_0732t2_0005"), "0732t2"); // Band in zwei Teilen
	assert.equal(rmBandKey("RM_1671_0555a_0003"), "0555a"); // Handexemplar mit Suffix
	assert.equal(rmBandKey("RM_1484_0006_0122"), "0006");
	// Andere Serien und Fremdformen bleiben ohne Band.
	assert.equal(rmBandKey("MM_24_RRB_1850_0123"), null);
	assert.equal(rmBandKey("KRP_1996_g1234abcd_t03"), null);
	assert.equal(rmBandKey("ABl_1950__S__1-16_"), null);
	assert.equal(rmBandKey("RM_1642_441_0007"), null); // Schlüssel ist vierstellig
	assert.equal(rmBandKey("RM_1642_0441"), null);
	assert.equal(rmBandKey(""), null);
});

test("Beschriftung: Halbjahresrat und Jahr", () => {
	const b = (extra: Partial<RmBand>): RmBand => ({ nr: 441, year: 1642, ...extra });
	assert.equal(rmBandLabel(b({ half: 1, rat: "Natalrat" })), "Natalrat 1642");
	assert.equal(rmBandLabel(b({ half: 2, rat: "Baptistalrat" })), "Baptistalrat 1642");
	assert.equal(rmBandLabel(b({ rat: "beide" })), "Natal- und Baptistalrat 1642");
	// Mehrjähriger Band: Halbgeviertstrich.
	assert.equal(rmBandLabel(b({ rat: "beide", yearTo: 1644 })), "Natal- und Baptistalrat 1642–1644");
	assert.equal(rmBandYears(b({ yearTo: 1642 })), "1642"); // gleiches Jahr ⇒ keine Spanne
	// Nennt der Titel keinen Rat, steht nichts da – kein geratener Halbjahresrat.
	assert.equal(rmBandLabel(b({})), null);
});

test("Erklärung: Amtszeit des Rats, Herkunft der Angabe", () => {
	// Halbjahre von Weihnachten bis Johanni, nicht Januar bis Juni (B II 441:
	// 25.6.–23.12.1642; B II 78 «Natalrat 1552»: 28.12.1551–22.6.1552).
	const bapt = rmBandHint({ nr: 441, year: 1642, half: 2, rat: "Baptistalrat" });
	assert.ok(bapt.includes("Johanni (24. Juni) bis Weihnachten 1642"), bapt);
	assert.ok(bapt.includes("nicht im Sitzungsdatum"), bapt);
	const natal = rmBandHint({ nr: 78, year: 1552, half: 1, rat: "Natalrat" });
	assert.ok(natal.includes("Weihnachten 1551 bis Johanni (24. Juni) 1552"), natal);
	// Ganzjähriger Band: keine eigene Amtszeit, aber die Regel bleibt.
	const both = rmBandHint({ nr: 74, year: 1550, rat: "beide" });
	assert.ok(both.includes("zwei Räte im Jahr"), both);
	assert.ok(!both.includes("Amtszeit"), both);
});

test("Signatur mit Suffix und Teil", () => {
	assert.equal(rmBandSignature({ nr: 441, year: 1642 }), "StAZH B II 441");
	assert.equal(rmBandSignature({ nr: 549, suffix: "a", year: 1670 }), "StAZH B II 549 a");
	assert.equal(rmBandSignature({ nr: 732, part: 2, year: 1716 }), "StAZH B II 732, Teil 2");
});

test("Tabelle lesen: Unbrauchbares fällt weg", () => {
	const parsed = parseRmBandTable({
		bands: {
			"0441": { nr: 441, year: 1642, half: 2, rat: "Baptistalrat", scribe: "Unterschreiber" },
			"0442": { nr: 442, year: 1643, half: 3, rat: "Mittagsrat", scribe: "Küchenmeister" },
			"0443": { nr: "443", year: 1644 },
			"0444": { year: 1645 },
			"0445": null,
		},
	});
	assert.deepEqual(Object.keys(parsed), ["0441", "0442"]);
	assert.deepEqual(parsed["0442"], { nr: 442, year: 1643 }); // unbekannte Werte verworfen
	assert.deepEqual(parseRmBandTable(null), {});
	assert.deepEqual(parseRmBandTable({ bands: [] }), {});
});

test("Sicht auf den Band einer Sitzung", () => {
	const view = rmBandViewFor("RM_1642_0441_0007", bands);
	assert.equal(view?.key, "0441");
	assert.equal(view?.label, "Baptistalrat 1642");
	assert.equal(view?.band.scribe, "Unterschreiber");
	assert.equal(rmBandViewFor("RM_1642_9999_0007", bands), null); // Band nicht in der Tabelle
	assert.equal(rmBandViewFor("MM_24_RRB_1850_0123", bands), null);
});

test("Bandtabelle: Zähler, Schlüssel und Jahresspanne", () => {
	const keys = Object.keys(bands);
	assert.equal(keys.length, table.meta.counts.bands);
	assert.equal(keys.length, Object.keys(table.bands).length, "keine Zeile verworfen");
	assert.ok(keys.length >= 1000, `${keys.length} Bände – die Collection hat über 1000`);
	for (const [key, band] of Object.entries(bands)) {
		const m = /^(\d{4})([a-z]?)(?:t(\d))?$/.exec(key);
		assert.ok(m, `Schlüssel ${key}`);
		assert.equal(band.nr, Number(m![1]), `nr passt zum Schlüssel ${key}`);
		assert.equal(band.suffix ?? "", m![2], `Suffix passt zum Schlüssel ${key}`);
		assert.equal(band.part ?? null, m![3] ? Number(m![3]) : null, `Teil passt zum Schlüssel ${key}`);
	}
	const years = Object.values(bands).map((b) => b.year);
	assert.deepEqual([Math.min(...years), Math.max(...years)], table.meta.counts.years);
	assert.deepEqual(table.meta.counts.years, [1484, 1798]);
	const count = (p: (b: RmBand) => boolean) => Object.values(bands).filter(p).length;
	assert.equal(count((b) => b.half !== undefined), table.meta.counts.withHalf);
	assert.equal(count((b) => b.rat !== undefined), table.meta.counts.withRat);
	assert.equal(count((b) => b.scribe !== undefined), table.meta.counts.withScribe);
	assert.equal(count((b) => b.special !== undefined), table.meta.counts.special);
});

test("Bandtabelle: Hälfte und Rat sagen dasselbe", () => {
	for (const [key, band] of Object.entries(bands)) {
		if (band.half === 1) assert.equal(band.rat, "Natalrat", key);
		if (band.half === 2) assert.equal(band.rat, "Baptistalrat", key);
		if (band.rat === "Natalrat") assert.equal(band.half, 1, key);
		if (band.rat === "Baptistalrat") assert.equal(band.half, 2, key);
		if (band.rat === "beide") assert.equal(band.half, undefined, key);
		// Jeder Band lässt sich beschriften, sobald der Titel einen Rat nennt.
		assert.equal(rmBandLabel(band) !== null, band.rat !== undefined, key);
	}
});

test("Bandtabelle: ab 1552 nennt jeder Band seinen Schreiber", () => {
	// Ab 1552 führen Stadt- und Unterschreiber getrennte Reihen (Plan E-Bestandszeile).
	// Einzige Ausnahme: das Handexemplar Beat Holzhalbs (B II 555 a).
	const ohne = Object.entries(bands)
		.filter(([, b]) => b.year >= 1552 && !b.scribe)
		.map(([key]) => key);
	assert.deepEqual(ohne, ["0555a"]);
	// B II 191 heisst in Transkribus «des Unterachreibers» – der Tippfehler ist
	// in rmtk/bands.py korrigiert (TITLE_TYPOS).
	assert.equal(bands["0191"]?.scribe, "Unterschreiber");
});

test("Bandtabelle: Golden-Fälle", () => {
	assert.deepEqual(bands["0006"], { nr: 6, year: 1484, rat: "beide" });
	assert.deepEqual(bands["0059"], { nr: 59, year: 1545 }); // «Denkzedel der Ratstagen»
	assert.deepEqual(bands["0074"], { nr: 74, year: 1550, rat: "beide" });
	assert.deepEqual(bands["0548"], {
		nr: 548,
		year: 1669,
		yearTo: 1670,
		rat: "beide",
		scribe: "Unterschreiber",
		special: "Sammelband",
	});
	assert.equal(rmBandLabel(bands["0548"]), "Natal- und Baptistalrat 1669–1670");
	assert.equal(rmBandLabel(bands["0059"]), null);
	assert.equal(bands["0732t1"]?.part, 1);
	assert.equal(bands["0732t2"]?.part, 2);
});

test("Bandtabelle: jede Sitzungs-ID findet ihren Band", () => {
	// Der Konverter baut `RM_<Bandjahr>_<Schlüssel>_<Nr>` (rmtk/convert.py session_id).
	for (const [key, band] of Object.entries(bands)) {
		const id = `RM_${band.year}_${key}_0001`;
		assert.equal(rmBandViewFor(id, bands)?.key, key, id);
	}
});
