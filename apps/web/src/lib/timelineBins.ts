// Zeitstrahl-Logik ohne Darstellung (Timeline.svelte):
// Bündelung der Jahresbalken und Achsen-Grenzen. Mit den Ratsmanualen reicht
// der Korpus von 1484 bis heute (~540 Jahre, Lücke 1799–1802): ein Balken je
// Jahr wäre auf schmalen Breiten unter einem Pixel breit. Bewusst nur mit
// relativem Import, damit der Unit-Test direkt mit `npx tsx --test` läuft.

import { MODERN_FIRST_YEAR, PREMODERN_LAST_YEAR } from "./types";

/** Mögliche Bündelungen in Jahren je Balken (Teiler von 10 bzw. 100, damit die
 *  Balken an Jahrzehnten bzw. Jahrhunderten ausgerichtet sind). */
export const BIN_SIZES = [1, 2, 5, 10, 25, 50] as const;

/** Mindestbreite eines Balkens in Pixeln, bevor gebündelt wird. */
export const MIN_BAR_PX = 3;

export interface YearBin {
	/** Erstes und letztes Jahr des Balkens, auf die Achse [min, max] geklemmt. */
	from: number;
	to: number;
	count: number;
}

/** Erstes Jahr des Balkens, in den `year` fällt (Vielfaches von `size`). */
export function binStart(year: number, size: number): number {
	return Math.floor(year / size) * size;
}

/** Anzahl Balken für die Achse [min, max] bei `size` Jahren je Balken. */
export function binCount(min: number, max: number, size: number): number {
	if (max < min) return 0;
	return (binStart(max, size) - binStart(min, size)) / size + 1;
}

/** Kleinste Bündelung, bei der jeder Balken mindestens `minBarPx` breit ist;
 *  reicht auch die gröbste nicht, bleibt es bei ihr. */
export function chooseBinSize(min: number, max: number, widthPx: number, minBarPx = MIN_BAR_PX): number {
	for (const size of BIN_SIZES) {
		const bins = binCount(min, max, size);
		if (bins > 0 && widthPx / bins >= minBarPx) return size;
	}
	return BIN_SIZES[BIN_SIZES.length - 1];
}

/**
 * Jahresverteilung (`{ "1850": 12, … }`) auf lückenlose Balken à `size`
 * Jahre bündeln, ausgerichtet an Vielfachen von `size` (1550–1559,
 * 1560–1569 …). Der erste und der letzte Balken sind auf [min, max] geklemmt;
 * Jahre ausserhalb der Achse zählen nicht.
 */
export function buildBins(buckets: Record<string, number>, min: number, max: number, size: number): YearBin[] {
	const n = binCount(min, max, size);
	const first = binStart(min, size);
	const bins: YearBin[] = [];
	for (let i = 0; i < n; i++) {
		const start = first + i * size;
		bins.push({ from: Math.max(min, start), to: Math.min(max, start + size - 1), count: 0 });
	}
	for (const [key, count] of Object.entries(buckets)) {
		const year = Number(key);
		if (!Number.isInteger(year) || year < min || year > max || !(count > 0)) continue;
		bins[(binStart(year, size) - first) / size].count += count;
	}
	return bins;
}

/**
 * Einheiten mit Zeitspanne (Archivkatalog): wie viele Einheiten in jedem Jahr
 * beginnen bzw. enden (Meili-Facetten `dateFrom`/`dateTo`). Eine Einheit zählt
 * in jedem Jahr, das ihr Zeitraum berührt – dieselbe Regel wie der
 * Zeitraumfilter des Katalogs (`dateTo >= von AND dateFrom <= bis`).
 */
export interface SpanCounts {
	from: Record<string, number>;
	to: Record<string, number>;
}

/** Zahl der Einheiten, deren Zeitraum [von, bis] berührt. */
export type OverlapCounter = (from: number, to: number) => number;

function cumulative(counts: Record<string, number>): { years: number[]; sums: number[] } {
	const entries = Object.entries(counts)
		.map(([k, n]) => [Number(k), n] as const)
		.filter(([y, n]) => Number.isInteger(y) && n > 0)
		.sort((a, b) => a[0] - b[0]);
	const years: number[] = [];
	const sums: number[] = [];
	let sum = 0;
	for (const [y, n] of entries) {
		sum += n;
		years.push(y);
		sums.push(sum);
	}
	return { years, sums };
}

/** Summe aller Zählungen bis und mit Jahr `year`. */
function sumUpTo(c: { years: number[]; sums: number[] }, year: number): number {
	let lo = 0;
	let hi = c.years.length - 1;
	let at = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (c.years[mid] <= year) {
			at = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return at < 0 ? 0 : c.sums[at];
}

/**
 * Zähler für Einheiten mit Zeitspanne: Einheiten, die [a, b] berühren =
 * #(Beginn ≤ b) − #(Ende < a). Exakt ohne Jahresliste je Einheit; jede Einheit
 * zählt je Balken höchstens einmal.
 */
export function overlapCounter(spans: SpanCounts): OverlapCounter {
	const from = cumulative(spans.from);
	const to = cumulative(spans.to);
	return (a, b) => (b < a ? 0 : Math.max(0, sumUpTo(from, b) - sumUpTo(to, a - 1)));
}

/** Wie buildBins, aber jeder Balken zählt die Einheiten, die seine Jahre berühren. */
export function buildOverlapBins(count: OverlapCounter, min: number, max: number, size: number): YearBin[] {
	return buildBins({}, min, max, size).map((bin) => ({ ...bin, count: count(bin.from, bin.to) }));
}

/** «1850» bzw. «1850–1859» – Beschriftung eines Balkens. */
export function binLabel(bin: Pick<YearBin, "from" | "to">): string {
	return bin.from === bin.to ? String(bin.from) : `${bin.from}–${bin.to}`;
}

/** Mögliche Abstände der beschrifteten bzw. der kleinen Achsenstriche in Jahren. */
const LABEL_STEPS = [1, 5, 10, 25, 50, 100, 250] as const;
const MINOR_STEPS = [1, 5, 10, 25, 50] as const;
/** Mindestabstand zweier Jahreszahlen bzw. zweier kleiner Striche in Pixeln. */
export const MIN_LABEL_PX = 50;
export const MIN_MINOR_PX = 8;

/**
 * Abstand der Jahreszahlen und der kleinen Striche für eine Achse über `years`
 * Jahre auf `widthPx` Pixeln: der kleinste Abstand, der lesbar bleibt, nie
 * feiner als ein Balken. Die ganze Achse 1803–heute bekommt so wie bisher
 * 25er-Zahlen, ein gezoomter Ausschnitt von 20 Jahren 5er-Zahlen und einen
 * Strich je Jahr. `minor` ist `null`, wenn keine kleinen Striche passen.
 */
export function tickSteps(years: number, widthPx: number, binSize = 1): { label: number; minor: number | null } {
	const pxPerYear = widthPx / Math.max(1, years);
	const label =
		LABEL_STEPS.find((s) => s >= binSize && s * pxPerYear >= MIN_LABEL_PX) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
	const minor =
		MINOR_STEPS.find((s) => s >= binSize && s < label && label % s === 0 && s * pxPerYear >= MIN_MINOR_PX) ?? null;
	return { label, minor };
}

/**
 * Achse des Zeitstrahls der Trefferliste: die Spannweite des Korpus, aber erst
 * ab 1803, solange nichts vor 1803 liegt – sonst sähe jede Suche in den vier
 * zentralen Serien 250 leere Jahre Ratsmanual-Vorlauf. Früher beginnt sie,
 * wenn die Treffer (`buckets`, ohne Zeitraum-Filter gezählt) vor 1803 reichen,
 * die Ratsmanuale gewählt sind oder der Zeitraum-Filter vor 1803 liegt.
 * Umgekehrt endet sie 1798, wenn dann nichts ab 1803 liegt (keine Treffer,
 * keine der vier Serien gewählt, kein Zeitraum bis nach 1803) – eine reine
 * Ratsmanual-Suche zeigt keine 230 leeren Jahre. Die Achse bleibt damit je
 * Suche stabil (drei Zustände statt einer Achse pro Treffermenge); engere
 * Ausschnitte zoomt die Zeitleiste selbst (timelineZoom.ts).
 */
export function timelineAxis(
	corpus: { min: number; max: number },
	buckets: Record<string, number>,
	opts: { series: readonly string[]; dateFrom: number | null; dateTo: number | null },
	modernStart = MODERN_FIRST_YEAR,
	premodernEnd = PREMODERN_LAST_YEAR,
): { min: number; max: number } {
	if (corpus.min >= modernStart || corpus.max < modernStart) return { ...corpus };
	const hitYears = Object.entries(buckets)
		.filter(([, count]) => count > 0)
		.map(([year]) => Number(year));
	const early =
		opts.series.includes("RM") ||
		(opts.dateFrom != null && opts.dateFrom < modernStart) ||
		(opts.dateTo != null && opts.dateTo < modernStart) ||
		hitYears.some((year) => year < modernStart);
	if (!early) return { min: modernStart, max: corpus.max };
	const late =
		opts.series.some((s) => s !== "RM") ||
		((opts.dateFrom != null || opts.dateTo != null) && (opts.dateTo ?? Infinity) >= modernStart) ||
		hitYears.some((year) => year >= modernStart);
	if (late) return { ...corpus };
	return { min: corpus.min, max: Math.max(corpus.min, Math.min(corpus.max, premodernEnd)) };
}
