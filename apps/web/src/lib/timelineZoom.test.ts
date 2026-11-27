/**
 * Unit-Tests für den Zoom der Zeitleiste. Lauf:
 *   npx tsx --test src/lib/timelineZoom.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextZoomStages, nextZoomView, stageLabel, zoomAxisAt, zoomWindow, type ZoomStage } from "./timelineZoom";

const base = { min: 1484, max: 2026 };
const span = (r: { min: number; max: number }) => r.max - r.min + 1;

test("zoomWindow: Auswahl plus Umfeld, mindestens 21 Jahre, innerhalb der Achse", () => {
	// Ohne Zeitraum die ganze Achse.
	assert.deepEqual(zoomWindow(base, null, null), base);
	// Ein Jahrhundert: je 13 Jahre Umfeld (1/8 der Länge).
	assert.deepEqual(zoomWindow(base, 1600, 1700), { min: 1587, max: 1713 });
	// Ein Jahrzehnt bzw. ein Jahr: auf 21 Jahre um die Auswahl erweitert.
	assert.deepEqual(zoomWindow(base, 1650, 1659), { min: 1645, max: 1665 });
	assert.deepEqual(zoomWindow(base, 1655, 1655), { min: 1645, max: 1665 });
	// Am Achsenrand verschoben statt abgeschnitten.
	assert.deepEqual(zoomWindow(base, 2025, 2025), { min: 2006, max: 2026 });
	assert.deepEqual(zoomWindow(base, 1484, 1490), { min: 1484, max: 1504 });
	// Offene Enden: bis zum Achsenende, Umfeld nur auf der gewählten Seite.
	assert.deepEqual(zoomWindow(base, 1850, null), { min: 1828, max: 2026 });
	assert.deepEqual(zoomWindow(base, null, 1550), { min: 1484, max: 1558 });
	// Auswahl ausserhalb der Achse oder verkehrt herum: kein Zoom.
	assert.deepEqual(zoomWindow({ min: 1803, max: 2026 }, 1600, 1700), { min: 1803, max: 2026 });
	assert.deepEqual(zoomWindow(base, 1700, 1600), base);
	// Achse kürzer als der Mindestausschnitt: die ganze Achse.
	assert.deepEqual(zoomWindow({ min: 2017, max: 2026 }, 2020, 2020), { min: 2017, max: 2026 });
});

test("zoomWindow: Umfeld bleibt diesseits der Grenze 1803, ausser die Auswahl überquert sie", () => {
	// Ratsmanuale bis 1798: kein Umfeld aus den vier Serien (sonst flache Ratsmanual-Balken).
	assert.deepEqual(zoomWindow(base, 1750, 1798), { min: 1744, max: 1802 });
	assert.deepEqual(zoomWindow(base, 1798, 1798), { min: 1782, max: 1802 });
	assert.deepEqual(zoomWindow(base, null, 1790), { min: 1484, max: 1802 });
	// Ab 1803: kein Ratsmanual-Umfeld.
	assert.deepEqual(zoomWindow(base, 1803, 1803), { min: 1803, max: 1823 });
	assert.deepEqual(zoomWindow(base, 1805, 1830), { min: 1803, max: 1833 });
	// Über die Grenze hinweg: Umfeld auf beiden Seiten.
	assert.deepEqual(zoomWindow(base, 1790, 1810), { min: 1787, max: 1813 });
	// Achse ohne Ratsmanuale: keine Grenze im Spiel.
	assert.deepEqual(zoomWindow({ min: 1803, max: 2026 }, 1803, 1803), { min: 1803, max: 1823 });
});

test("nextZoomView: zoomt hinein, wandert am Rand mit, bleibt bei Nachbarjahren stehen", () => {
	// Erste Einschränkung: hineinzoomen.
	const century = nextZoomView(base, base, 1600, 1700);
	assert.deepEqual(century, { min: 1587, max: 1713 });
	// Engere Auswahl darin: weiter hineinzoomen (mehrere Stufen).
	const decade = nextZoomView(century, base, 1650, 1659);
	assert.deepEqual(decade, { min: 1645, max: 1665 });
	// Ein Jahr im Jahrzehnt: Ausschnitt bleibt, die Balken springen nicht.
	assert.equal(nextZoomView(decade, base, 1655, 1655), decade);
	assert.equal(nextZoomView(decade, base, 1662, 1662), decade);
	assert.equal(nextZoomView(decade, base, 1664, 1664), decade);
	// Jahr ganz am Rand: der Ausschnitt wandert mit.
	assert.deepEqual(nextZoomView(decade, base, 1665, 1665), { min: 1655, max: 1675 });
	// Jahr ausserhalb (Zeitraum-Felder): neuer Ausschnitt, diesseits von 1803.
	assert.deepEqual(nextZoomView(decade, base, 1800, 1800), { min: 1782, max: 1802 });
	// Ausschnitt über die Grenze, Auswahl nur noch davor: Umfeld ab 1803 fällt weg.
	assert.deepEqual(nextZoomView({ min: 1787, max: 1813 }, base, 1790, 1798), { min: 1782, max: 1802 });
	// Wieder weiter (Stufe zurück): herauszoomen.
	assert.deepEqual(nextZoomView(decade, base, 1600, 1700), century);
	// Zeitraum aufgehoben: ganze Achse.
	assert.deepEqual(nextZoomView(decade, base, null, null), base);
	// Fast gleicher Zeitraum: bleibt stehen.
	assert.equal(nextZoomView(century, base, 1600, 1690), century);
	// Achse hat sich geändert und der alte Ausschnitt passt nicht mehr hinein.
	assert.deepEqual(nextZoomView({ min: 1790, max: 1810 }, { min: 1803, max: 2026 }, 1805, 1805), {
		min: 1803,
		max: 1823,
	});
	// Ohne bisherigen Ausschnitt (erster Aufruf, Seitenaufruf mit Zeitraum).
	assert.deepEqual(nextZoomView(null, base, 1655, 1655), { min: 1645, max: 1665 });
	// Am Achsenrand gibt es nichts zu verschieben: der Ausschnitt bleibt.
	const atEnd = nextZoomView(null, base, 2020, 2026);
	assert.equal(nextZoomView(atEnd, base, 2026, 2026), atEnd);
	assert.equal(span(atEnd), 21);
});

test("nextZoomStages: Pfad der Einschränkungen", () => {
	const s = (from: number | null, to: number | null): ZoomStage => ({ from, to });
	let stages = nextZoomStages([], 1600, 1700);
	assert.deepEqual(stages, [s(1600, 1700)]);
	stages = nextZoomStages(stages, 1650, 1659);
	assert.deepEqual(stages, [s(1600, 1700), s(1650, 1659)]);
	stages = nextZoomStages(stages, 1655, 1655);
	assert.deepEqual(stages, [s(1600, 1700), s(1650, 1659), s(1655, 1655)]);
	// Nachbarjahr: ersetzt die letzte Stufe.
	stages = nextZoomStages(stages, 1656, 1656);
	assert.deepEqual(stages, [s(1600, 1700), s(1650, 1659), s(1656, 1656)]);
	// Ausserhalb des Jahrzehnts, innerhalb des Jahrhunderts.
	assert.deepEqual(nextZoomStages(stages, 1663, 1663), [s(1600, 1700), s(1663, 1663)]);
	// Klick auf eine frühere Stufe (oder «Zurück»): Pfad bis dorthin.
	assert.deepEqual(nextZoomStages(stages, 1600, 1700), [s(1600, 1700)]);
	// Ganz anderer Zeitraum: neuer Pfad.
	assert.deepEqual(nextZoomStages(stages, 1700, 1750), [s(1700, 1750)]);
	// Offene Enden zählen als unbegrenzt.
	assert.deepEqual(nextZoomStages([s(1850, null)], 1900, 1910), [s(1850, null), s(1900, 1910)]);
	assert.deepEqual(nextZoomStages([s(1900, 1910)], 1850, null), [s(1850, null)]);
	// Zeitraum aufgehoben: kein Pfad.
	assert.deepEqual(nextZoomStages(stages, null, null), []);
});

test("zoomAxisAt: von Achse zu Achse, Ränder stetig, Auswahl immer im Bild", () => {
	const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);
	const whole = { start: 1484, years: 544 };
	const zoomed = { start: 1645, years: 21 };
	near(zoomAxisAt(whole, zoomed, 0).start, 1484);
	near(zoomAxisAt(whole, zoomed, 0).years, 544);
	near(zoomAxisAt(whole, zoomed, 1).start, 1645);
	near(zoomAxisAt(whole, zoomed, 1).years, 21);
	// Halbzeit: geometrisches Mittel der Breiten.
	near(zoomAxisAt(whole, zoomed, 0.5).years, Math.sqrt(544 * 21));
	let prev = whole;
	for (let i = 1; i <= 20; i++) {
		const a = zoomAxisAt(whole, zoomed, i / 20);
		assert.ok(a.start >= prev.start - 1e-9, "linker Rand läuft nach rechts");
		assert.ok(a.start + a.years <= prev.start + prev.years + 1e-9, "rechter Rand läuft nach links");
		assert.ok(a.start <= 1645 + 1e-9 && a.start + a.years >= 1666 - 1e-9, "Ziel im Bild");
		prev = a;
	}
	// Herauszoomen ist dasselbe rückwärts; gleiche Breite = Verschieben.
	near(zoomAxisAt(zoomed, whole, 0.5).years, Math.sqrt(544 * 21));
	assert.deepEqual(zoomAxisAt({ start: 1645, years: 21 }, { start: 1655, years: 21 }, 0.5), { start: 1650, years: 21 });
});

test("stageLabel: Einzeljahr, Spanne, offene Enden mit den Achsengrenzen", () => {
	assert.equal(stageLabel({ from: 1655, to: 1655 }, base), "1655");
	assert.equal(stageLabel({ from: 1650, to: 1659 }, base), "1650 – 1659");
	assert.equal(stageLabel({ from: 1850, to: null }, base), "1850 – 2026");
	assert.equal(stageLabel({ from: null, to: 1550 }, base), "1484 – 1550");
});
