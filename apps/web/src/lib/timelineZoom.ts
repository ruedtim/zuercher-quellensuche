// Zoom der Zeitleiste (Timeline.svelte), ohne Darstellung: Wer den Zeitraum
// einschränkt – Klick oder Ziehen auf der Zeitleiste, Zeitraum-Felder, von der
// KI-Frage erkannter Zeitraum –, sieht danach den gewählten Ausschnitt statt der
// ganzen Achse (mit den Ratsmanualen ~540 Jahre). Jede weitere Einschränkung
// zoomt weiter hinein; die bisherigen Stufen bleiben als Pfad
// («Alle Jahre › 1600 – 1700 › 1650 – 1659») anwählbar. Bewusst nur mit
// relativen Importen, damit der Unit-Test direkt mit `npx tsx --test` läuft.

import { MODERN_FIRST_YEAR } from "./types";

export interface YearRange {
	min: number;
	max: number;
}

/** Ein gewählter Zeitraum wie dateFrom/dateTo (`null` = offen). */
export interface ZoomStage {
	from: number | null;
	to: number | null;
}

/** Kleinster Ausschnitt in Jahren: ein einzelnes Jahr zeigt ±10 Jahre Umfeld. */
export const ZOOM_MIN_SPAN = 21;
/** Umfeld links und rechts der Auswahl, als Anteil ihrer Länge (mindestens 2 Jahre). */
export const ZOOM_PAD_RATIO = 0.125;
export const ZOOM_MIN_PAD = 2;
/** Der bisherige Ausschnitt bleibt stehen, solange er höchstens so viel breiter
 *  ist als der für die neue Auswahl nötige … */
export const ZOOM_KEEP_RATIO = 1.5;
/** … und die Auswahl mindestens diesen Anteil seiner Breite (mindestens ein
 *  Jahr) vom Rand entfernt liegt. */
export const ZOOM_EDGE_RATIO = 0.05;

/** Die Auswahl auf der Achse `base`; `null` ohne Zeitraum oder ausserhalb der Achse. */
function selectionOn(base: YearRange, from: number | null, to: number | null): YearRange | null {
	if (from == null && to == null) return null;
	const min = Math.max(base.min, from ?? base.min);
	const max = Math.min(base.max, to ?? base.max);
	return min <= max ? { min, max } : null;
}

const spanOf = (r: YearRange) => r.max - r.min + 1;

/**
 * Bereich, in dem das Umfeld einer Auswahl liegen darf: Liegt sie ganz vor 1803
 * (Ratsmanuale) bzw. ganz ab 1803, endet es an dieser Grenze – sonst überragten
 * die ersten Jahre der vier zentralen Serien (rund zehnmal mehr Dokumente je
 * Jahr) die Ratsmanual-Balken daneben, und die Auswahl wäre kaum zu lesen.
 */
function zoomArea(base: YearRange, sel: YearRange, modernStart: number): YearRange {
	if (sel.max < modernStart && base.max >= modernStart) return { min: base.min, max: modernStart - 1 };
	if (sel.min >= modernStart && base.min < modernStart) return { min: modernStart, max: base.max };
	return base;
}

/**
 * Ausschnitt für den Zeitraum `from`–`to`: die Auswahl plus Umfeld, mindestens
 * ZOOM_MIN_SPAN Jahre, innerhalb der Achse `base` (am Rand verschoben statt
 * abgeschnitten) und diesseits der Grenze 1803 (zoomArea). Ohne Zeitraum die
 * ganze Achse.
 */
export function zoomWindow(
	base: YearRange,
	from: number | null,
	to: number | null,
	modernStart = MODERN_FIRST_YEAR,
): YearRange {
	const sel = selectionOn(base, from, to);
	if (!sel) return { ...base };
	const area = zoomArea(base, sel, modernStart);
	const pad = Math.max(ZOOM_MIN_PAD, Math.round(spanOf(sel) * ZOOM_PAD_RATIO));
	let min = Math.max(area.min, sel.min - pad);
	let max = Math.min(area.max, sel.max + pad);
	const missing = ZOOM_MIN_SPAN - (max - min + 1);
	if (missing > 0) {
		min -= Math.floor(missing / 2);
		max += Math.ceil(missing / 2);
		if (min < area.min) {
			max += area.min - min;
			min = area.min;
		}
		if (max > area.max) {
			min -= max - area.max;
			max = area.max;
		}
		min = Math.max(min, area.min);
	}
	return { min, max };
}

/**
 * Ausschnitt nach einer Änderung des Zeitraums. Der bisherige Ausschnitt `prev`
 * bleibt stehen, solange die Auswahl mit etwas Abstand zum Rand hineinpasst und
 * er nicht viel breiter ist als nötig – ein Klick auf ein Nachbarjahr verschiebt
 * so keine Balken. Sonst gilt zoomWindow: hineinzoomen bei engerer Auswahl,
 * herauszoomen bei weiterer, mitwandern bei einer Auswahl am Rand.
 */
export function nextZoomView(
	prev: YearRange | null,
	base: YearRange,
	from: number | null,
	to: number | null,
	modernStart = MODERN_FIRST_YEAR,
): YearRange {
	const ideal = zoomWindow(base, from, to, modernStart);
	const sel = selectionOn(base, from, to);
	if (!prev || !sel) return ideal;
	const area = zoomArea(base, sel, modernStart);
	if (prev.min < area.min || prev.max > area.max) return ideal;
	if (spanOf(prev) > ZOOM_KEEP_RATIO * spanOf(ideal)) return ideal;
	const margin = Math.max(1, Math.round(spanOf(prev) * ZOOM_EDGE_RATIO));
	// Am Rand des Bereichs gibt es nichts zu verschieben – dort zählt nur, dass die Auswahl drin liegt.
	const leftOk = sel.min - prev.min >= margin || (prev.min === area.min && sel.min >= prev.min);
	const rightOk = prev.max - sel.max >= margin || (prev.max === area.max && sel.max <= prev.max);
	return leftOk && rightOk ? prev : ideal;
}

function contains(outer: ZoomStage, inner: ZoomStage): boolean {
	return (
		(outer.from ?? -Infinity) <= (inner.from ?? -Infinity) && (inner.to ?? Infinity) <= (outer.to ?? Infinity)
	);
}

/**
 * Zoom-Stufen (Pfad unter der Zeitleiste) nach einer Änderung des Zeitraums:
 * Ein schon bekannter Zeitraum kürzt den Pfad auf seine Stufe (Klick auf eine
 * frühere Stufe, «Zurück» im Browser); sonst bleiben die Stufen, die den neuen
 * Zeitraum enthalten, und er kommt als neue Stufe dazu. Ohne Zeitraum: kein Pfad.
 */
export function nextZoomStages(prev: readonly ZoomStage[], from: number | null, to: number | null): ZoomStage[] {
	if (from == null && to == null) return [];
	const known = prev.findIndex((s) => s.from === from && s.to === to);
	if (known >= 0) return prev.slice(0, known + 1);
	const sel = { from, to };
	const kept: ZoomStage[] = [];
	for (const stage of prev) {
		if (!contains(stage, sel)) break;
		kept.push(stage);
	}
	return [...kept, sel];
}

/** Achse in Jahren: erstes (auch gebrochenes) Jahr und Anzahl Jahre über die Breite. */
export interface ZoomAxis {
	start: number;
	years: number;
}

/**
 * Zwischenstand der Achse beim Wechsel von `from` nach `to`, `e` von 0 bis 1.
 * Die Breite ändert sich geometrisch (gleichmässige Vergrösserung) um den
 * Punkt, der in beiden Achsen an derselben Stelle steht; beide Ränder laufen
 * dabei stetig zum Ziel, eine engere Auswahl bleibt also immer im Bild. Bei
 * gleicher Breite (Verschieben) linear.
 */
export function zoomAxisAt(from: ZoomAxis, to: ZoomAxis, e: number): ZoomAxis {
	if (Math.abs(from.years - to.years) < 1e-9) {
		return { start: from.start + (to.start - from.start) * e, years: from.years };
	}
	const k = Math.pow(to.years / from.years, e);
	const fixed = (to.start * from.years - from.start * to.years) / (from.years - to.years);
	return { start: fixed - (fixed - from.start) * k, years: from.years * k };
}

/** «1655» bzw. «1650 – 1659»; offene Enden mit den Grenzen der Achse. */
export function stageLabel(stage: ZoomStage, base: YearRange): string {
	const from = stage.from ?? base.min;
	const to = stage.to ?? base.max;
	return from === to ? String(from) : `${from} – ${to}`;
}
