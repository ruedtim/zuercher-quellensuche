/**
 * Unit-Tests für die Zeitstrahl-Bündelung und -Achse. Lauf:
 *   npx tsx --test src/lib/timelineBins.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	binCount,
	binLabel,
	binStart,
	buildBins,
	buildOverlapBins,
	chooseBinSize,
	overlapCounter,
	tickSteps,
	timelineAxis,
} from "./timelineBins";

test("overlapCounter: Einheiten, deren Zeitraum einen Bereich berührt", () => {
	// Einheiten 1850–1850, 1850–1900, 1860–1870, 1901–1901.
	const count = overlapCounter({
		from: { "1850": 2, "1860": 1, "1901": 1 },
		to: { "1850": 1, "1870": 1, "1900": 1, "1901": 1 },
	});
	assert.equal(count(1850, 1850), 2);
	assert.equal(count(1851, 1859), 1);
	assert.equal(count(1865, 1865), 2);
	assert.equal(count(1850, 1901), 4);
	assert.equal(count(1902, 2000), 0);
	assert.equal(count(1700, 1849), 0);
	assert.equal(count(1900, 1850), 0);
});

test("buildOverlapBins: jeder Balken zählt eine Einheit höchstens einmal", () => {
	// Eine Einheit 1850–1879 und eine 1855–1855.
	const count = overlapCounter({ from: { "1850": 1, "1855": 1 }, to: { "1855": 1, "1879": 1 } });
	assert.deepEqual(buildOverlapBins(count, 1848, 1881, 10), [
		{ from: 1848, to: 1849, count: 0 },
		{ from: 1850, to: 1859, count: 2 },
		{ from: 1860, to: 1869, count: 1 },
		{ from: 1870, to: 1879, count: 1 },
		{ from: 1880, to: 1881, count: 0 },
	]);
	// Einzeljahre: dieselbe Zahl, die der Zeitraumfilter für das Jahr liefert.
	assert.deepEqual(
		buildOverlapBins(count, 1854, 1856, 1).map((b) => b.count),
		[1, 2, 1],
	);
});

test("binStart/binCount: Ausrichtung an Vielfachen der Bündelung", () => {
	assert.equal(binStart(1552, 10), 1550);
	assert.equal(binStart(1559, 10), 1550);
	assert.equal(binStart(1803, 5), 1800);
	assert.equal(binCount(1803, 2026, 1), 224);
	assert.equal(binCount(1552, 2026, 10), 48);
	assert.equal(binCount(1552, 2026, 5), 96);
	assert.equal(binCount(2000, 1999, 1), 0);
});

test("chooseBinSize: ein Jahr je Balken, solange er mindestens 3 px breit ist", () => {
	// 1803–2026 auf einer breiten Zeitleiste: wie bisher Einzeljahre.
	assert.equal(chooseBinSize(1803, 2026, 900), 1);
	// 1552–2026 auf derselben Breite: 1 px je Jahr → bündeln.
	assert.equal(chooseBinSize(1552, 2026, 900), 2);
	// Schmal (Handy): 5er bzw. 10er.
	assert.equal(chooseBinSize(1803, 2026, 343), 2);
	assert.equal(chooseBinSize(1552, 2026, 343), 5);
	assert.equal(chooseBinSize(1552, 2026, 200), 10);
	// Kurze Spannen bündeln nie.
	assert.equal(chooseBinSize(1990, 2000, 200), 1);
});

test("buildBins: summiert je Balken, klemmt Rand-Balken auf die Achse", () => {
	const bins = buildBins({ "1552": 3, "1555": 2, "1560": 7, "1571": 1, "1400": 99, "1572": 0 }, 1552, 1571, 10);
	assert.deepEqual(bins, [
		{ from: 1552, to: 1559, count: 5 },
		{ from: 1560, to: 1569, count: 7 },
		{ from: 1570, to: 1571, count: 1 },
	]);
	// Bündelung 1: lückenlos ein Balken je Jahr (auch leere Jahre).
	assert.deepEqual(
		buildBins({ "1800": 1, "1802": 4 }, 1800, 1802, 1).map((b) => [b.from, b.count]),
		[
			[1800, 1],
			[1801, 0],
			[1802, 4],
		],
	);
});

test("binLabel: Einzeljahr oder Spanne", () => {
	assert.equal(binLabel({ from: 1850, to: 1850 }), "1850");
	assert.equal(binLabel({ from: 1850, to: 1859 }), "1850–1859");
});

test("timelineAxis: moderne Suchen beginnen 1803, sonst die Korpus-Spannweite", () => {
	const corpus = { min: 1552, max: 2026 };
	const none = { series: [] as string[], dateFrom: null, dateTo: null };
	assert.deepEqual(timelineAxis(corpus, { "1850": 3, "1990": 1 }, none), { min: 1803, max: 2026 });
	assert.deepEqual(timelineAxis(corpus, {}, none), { min: 1803, max: 2026 });
	// Treffer vor 1803 → volle Achse.
	assert.deepEqual(timelineAxis(corpus, { "1650": 2, "1850": 3 }, none), corpus);
	// Leere Jahre vor 1803 zählen nicht.
	assert.deepEqual(timelineAxis(corpus, { "1650": 0, "1850": 3 }, none), { min: 1803, max: 2026 });
	// Ratsmanuale gewählt oder Zeitraum vor 1803 → Achse ab Korpus-Beginn, auch ohne Treffer …
	assert.deepEqual(timelineAxis(corpus, {}, { series: [], dateFrom: 1700, dateTo: null }), corpus);
	assert.deepEqual(timelineAxis(corpus, { "1990": 4 }, { series: ["RM"], dateFrom: null, dateTo: null }), corpus);
	assert.deepEqual(timelineAxis(corpus, {}, { series: ["RM", "KRP"], dateFrom: null, dateTo: null }), corpus);
	// … aber nur bis 1798, solange nichts ab 1803 liegt (reine Ratsmanual-Suche).
	const early = { min: 1552, max: 1798 };
	assert.deepEqual(timelineAxis(corpus, {}, { series: ["RM"], dateFrom: null, dateTo: null }), early);
	assert.deepEqual(timelineAxis(corpus, { "1650": 2 }, none), early);
	assert.deepEqual(timelineAxis(corpus, { "1650": 2, "1850": 0 }, none), early);
	assert.deepEqual(timelineAxis(corpus, {}, { series: [], dateFrom: null, dateTo: 1790 }), early);
	assert.deepEqual(timelineAxis(corpus, { "1650": 2 }, { series: [], dateFrom: 1600, dateTo: 1700 }), early);
	// Zeitraum über 1803 hinaus → volle Achse.
	assert.deepEqual(timelineAxis(corpus, { "1650": 2 }, { series: [], dateFrom: 1600, dateTo: 1850 }), corpus);
	// Korpus ohne Ratsmanuale: unverändert.
	assert.deepEqual(timelineAxis({ min: 1803, max: 2026 }, {}, none), { min: 1803, max: 2026 });
});

test("tickSteps: Jahreszahlen und kleine Striche je nach Pixeln pro Jahr", () => {
	// Ganze Achse 1803–2026 auf einer breiten Zeitleiste: wie bisher 25er-Zahlen, 5er-Striche.
	assert.deepEqual(tickSteps(224, 900), { label: 25, minor: 5 });
	// Mit den Ratsmanualen (Balken à 2 Jahre): 50er-Zahlen, 5er-Striche.
	assert.deepEqual(tickSteps(544, 900, 2), { label: 50, minor: 5 });
	// Gezoomt: 127 Jahre → 10er-Zahlen; 21 Jahre → 5er-Zahlen und ein Strich je Jahr.
	assert.deepEqual(tickSteps(127, 900), { label: 10, minor: 5 });
	assert.deepEqual(tickSteps(21, 900), { label: 5, minor: 1 });
	assert.deepEqual(tickSteps(21, 330), { label: 5, minor: 1 });
	// Nie feiner als ein Balken: bei 5er-Balken keine Jahres-Striche.
	assert.deepEqual(tickSteps(230, 330, 5), { label: 50, minor: 10 });
	// Sehr eng: gröbster Abstand, keine kleinen Striche.
	assert.deepEqual(tickSteps(1000, 100, 50), { label: 250, minor: null });
});
