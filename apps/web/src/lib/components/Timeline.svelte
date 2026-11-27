<!--
	Timeline.svelte – Canvas-basiertes Jahres-Histogramm.

	Verhalten:
	- Bars in Brand-Farbe, selektierter Bereich highlighted.
	- Click auf einen Balken setzt dateFrom = dateTo = year (Einzeljahr-Filter).
	- Drag (mousedown → mousemove → mouseup) malt eine Brush-Range über mehrere
	  Bars und setzt dateFrom/dateTo auf min/max der Range.
	- Tooltip beim Hover zeigt Jahr + Treffer-Count.
	- Reset-Button löscht beide Felder.
	- Responsive via ResizeObserver.
	- Bündelung: wäre ein Jahresbalken schmaler als 3 px (lange Achse, etwa
	  1484–heute mit den Ratsmanualen, oder schmaler Bildschirm), fasst ein
	  Balken 2/5/10 … Jahre zusammen (timelineBins.ts); Klick und Ziehen
	  filtern dann die Jahre der Balken.
	- Zoom: Ist ein Zeitraum gesetzt (hier, in den Zeitraum-Feldern oder von der
	  KI-Frage), zeigt die Zeitleiste ihn mit etwas Umfeld statt der ganzen Achse
	  min–max; jede weitere Einschränkung zoomt weiter hinein. Der Pfad darunter
	  («Alle Jahre › 1600 – 1700 › 1655») führt zu den früheren Stufen zurück
	  (timelineZoom.ts). Der Wechsel gleitet in ZOOM_MS (nicht bei «Bewegung
	  reduzieren»).
	- Zeitspannen (Archivkatalog, Prop `spans`): statt Jahreszahlen je Treffer
	  Anfangs- und Endjahre; ein Balken zählt jede Einheit, die seine Jahre
	  berührt – dieselbe Regel wie der Zeitraumfilter (timelineBins.ts
	  overlapCounter). `zoomSplit` null: keine Zoom-Grenze bei 1803.
-->
<script lang="ts">
	import { onMount } from "svelte";
	import {
		binLabel,
		binStart,
		buildBins,
		buildOverlapBins,
		chooseBinSize,
		overlapCounter,
		tickSteps,
		type SpanCounts,
		type YearBin,
	} from "$lib/timelineBins";
	import { MODERN_FIRST_YEAR } from "$lib/types";
	import {
		nextZoomStages,
		nextZoomView,
		stageLabel,
		zoomAxisAt,
		type YearRange,
		type ZoomAxis,
		type ZoomStage,
	} from "$lib/timelineZoom";

	type Props = {
		/** Treffer je Jahr (Dokumente: ein Jahr je Treffer). */
		buckets?: Record<string, number>;
		/** Statt `buckets`: Einheiten mit Zeitspanne (Anfangs- und Endjahre je Jahr). */
		spans?: SpanCounts;
		min: number;
		max: number;
		dateFrom: number | null;
		dateTo: number | null;
		onApply: (from: number | null, to: number | null) => void;
		caption?: string;
		/** Grenze, an der der Zoom-Ausschnitt endet (Ratsmanuale | zentrale Serien); null = keine. */
		zoomSplit?: number | null;
		/** Zusatz zur Zeile unter der Zeitleiste, z. B. «126 ohne Datum». */
		note?: string;
	};

	let {
		buckets = {},
		spans,
		min,
		max,
		dateFrom,
		dateTo,
		onApply,
		caption,
		zoomSplit = MODERN_FIRST_YEAR,
		note,
	}: Props = $props();

	// Ohne Grenze liegt sie vor jedem Jahr der Achse (timelineZoom.ts: zoomArea).
	const split = $derived(zoomSplit ?? Number.NEGATIVE_INFINITY);
	const overlap = $derived(spans ? overlapCounter(spans) : null);
	function countBins(lo: number, hi: number, size: number): YearBin[] {
		return overlap ? buildOverlapBins(overlap, lo, hi, size) : buildBins(buckets, lo, hi, size);
	}

	let canvas = $state<HTMLCanvasElement | null>(null);
	let wrapper = $state<HTMLDivElement | null>(null);
	let cssWidth = $state(800);
	const BAR_HEIGHT = 80;
	const AXIS_HEIGHT = 22;
	const TOTAL_HEIGHT = BAR_HEIGHT + AXIS_HEIGHT;

	// Zoom: Ausschnitt und Stufen-Pfad folgen dem Zeitraum, egal woher er kommt.
	// Beide merken sich ihren letzten Stand (bewusst kein $state – nur Gedächtnis
	// für die nächste Änderung): Der Ausschnitt bleibt bei Klicks auf
	// Nachbarjahre stehen, die Stufen ergeben den Pfad.
	let lastView: YearRange | null = null;
	const view = $derived.by(() => {
		lastView = nextZoomView(lastView, { min, max }, dateFrom, dateTo, split);
		return lastView;
	});
	let lastStages: ZoomStage[] = [];
	const stages = $derived.by(() => {
		lastStages = nextZoomStages(lastStages, dateFrom, dateTo);
		return lastStages;
	});

	// Balken lückenlos über den Ausschnitt, je nach Breite gebündelt (1 = ein
	// Jahr je Balken). Die x-Achse läuft über die ungeklemmten Balken (axisStart
	// … axisStart + axisYears − 1), damit jedes Jahr eine feste Position hat.
	const binSize = $derived(chooseBinSize(view.min, view.max, cssWidth));
	const bins = $derived(countBins(view.min, view.max, binSize));
	const axisStart = $derived(binStart(view.min, binSize));
	const axisYears = $derived(Math.max(1, bins.length * binSize));

	const maxCount = $derived.by(() => {
		let m = 0;
		for (const b of bins) if (b.count > m) m = b.count;
		return m || 1;
	});

	// Ansage für Screenreader statt des Bilds. Wählen lässt sich der Zeitraum ohne Maus über die
	// Jahresfelder der Filterspalte.
	const canvasLabel = $derived.by(() => {
		const filled = bins.filter((b) => b.count > 0);
		if (filled.length === 0) return "Zeitleiste ohne Treffer";
		const peak = filled.reduce((a, b) => (b.count > a.count ? b : a));
		const when = peak.from === peak.to ? String(peak.from) : `${peak.from}–${peak.to}`;
		return `Zeitleiste: Treffer von ${filled[0].from} bis ${filled[filled.length - 1].to}, am meisten ${when} (${peak.count.toLocaleString("de-CH")})`;
	});

	const totalInRange = $derived.by(() => {
		const from = dateFrom ?? min;
		const to = dateTo ?? max;
		if (overlap) return overlap(from, to);
		let sum = 0;
		for (let y = from; y <= to; y++) sum += buckets[String(y)] ?? 0;
		return sum;
	});

	// Pointer-Interaktion (Maus + Touch; touch-pan-y am Canvas lässt vertikales
	// Scrollen durch, horizontale Drags gehören der Jahresauswahl). Hover und
	// Drag merken sich Balken-Indizes (bei Bündelung 1 = Jahre).
	let hoverBin = $state<number | null>(null);
	let dragStart = $state<number | null>(null);
	let dragEnd = $state<number | null>(null);
	let isDragging = $state(false);
	// Distinguish click from drag: only treat mouseup as click if no movement
	let dragMovedAcrossBars = $state(false);

	function barWidth() {
		return cssWidth / Math.max(1, bins.length);
	}

	function binAtX(x: number): number | null {
		if (x < 0 || x > cssWidth || bins.length === 0) return null;
		return Math.min(bins.length - 1, Math.max(0, Math.floor(x / barWidth())));
	}

	function isSelected(bin: YearBin): boolean {
		// Während ein Drag läuft: nur die markierte Range gilt als selektiert
		if (isDragging && dragStart != null && dragEnd != null) {
			const lo = bins[Math.min(dragStart, dragEnd)];
			const hi = bins[Math.max(dragStart, dragEnd)];
			return lo != null && hi != null && bin.to >= lo.from && bin.from <= hi.to;
		}
		// Kein Filter aktiv → alle Bars als „selektiert" einfärben (Brand-Farbe)
		if (dateFrom == null && dateTo == null) return true;
		const from = dateFrom ?? min;
		const to = dateTo ?? max;
		return bin.to >= from && bin.from <= to;
	}

	// Zoom-Übergang: Wechselt der Ausschnitt, gleitet die Achse vom zuletzt
	// gezeichneten Stand zum neuen (zoomAxisAt). Die Balken des Übergangs sind
	// schon die des Ziels, über beide Ausschnitte; die Höhe skaliert mit.
	const ZOOM_MS = 300;
	type ZoomAnim = {
		from: ZoomAxis;
		to: ZoomAxis;
		t0: number;
		bins: YearBin[];
		size: number;
		topFrom: number;
		topTo: number;
	};
	let zoomAnim: ZoomAnim | null = null;
	let drawnView: YearRange | null = null;
	let drawnAxis: ZoomAxis | null = null;

	function startZoom(from: ZoomAxis, to: ZoomAxis) {
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		const size = binSize;
		const lo = Math.max(min, Math.floor(Math.min(from.start, to.start)));
		const hi = Math.min(max, Math.ceil(Math.max(from.start + from.years, to.start + to.years)) - 1);
		if (lo > hi) return;
		const all = countBins(lo, hi, size);
		const topIn = (axis: ZoomAxis) => {
			let m = 0;
			for (const b of all) {
				const slot = binStart(b.from, size);
				if (slot + size > axis.start && slot < axis.start + axis.years && b.count > m) m = b.count;
			}
			return m || 1;
		};
		zoomAnim = { from, to, t0: performance.now(), bins: all, size, topFrom: topIn(from), topTo: topIn(to) };
	}

	// Zwischenstand des laufenden Übergangs (null = keiner, statisch zeichnen).
	function zoomFrame(): { axis: ZoomAxis; bins: YearBin[]; size: number; top: number } | null {
		if (!zoomAnim) return null;
		const t = (performance.now() - zoomAnim.t0) / ZOOM_MS;
		if (t >= 1) {
			zoomAnim = null;
			return null;
		}
		// ease-in-out (kubisch)
		const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;
		scheduleDraw();
		return {
			axis: zoomAxisAt(zoomAnim.from, zoomAnim.to, e),
			bins: zoomAnim.bins,
			size: zoomAnim.size,
			top: zoomAnim.topFrom + (zoomAnim.topTo - zoomAnim.topFrom) * e,
		};
	}

	// Canvas-Rendering
	function draw() {
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const widthCSS = cssWidth;
		canvas.width = Math.floor(widthCSS * dpr);
		canvas.height = Math.floor(TOTAL_HEIGHT * dpr);
		canvas.style.width = `${widthCSS}px`;
		canvas.style.height = `${TOTAL_HEIGHT}px`;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, widthCSS, TOTAL_HEIGHT);

		// Achse dieses Bildes: der Ausschnitt, während eines Zoom-Wechsels der
		// Zwischenstand. Das erste Bild gleitet nicht.
		const target: ZoomAxis = { start: axisStart, years: axisYears };
		if (drawnView && drawnAxis && (drawnView.min !== view.min || drawnView.max !== view.max)) {
			startZoom(drawnAxis, target);
		}
		drawnView = view;
		const frame = zoomFrame();
		const axis = frame?.axis ?? target;
		drawnAxis = axis;
		const size = frame?.size ?? binSize;
		const top = frame?.top ?? maxCount;
		const pxPerYear = widthCSS / axis.years;
		// Linke Kante eines Jahres auf der x-Achse (Mitte: year + 0.5).
		const xOf = (year: number) => (year - axis.start) * pxPerYear;

		const accent = getCssVar("--color-accent-500", "#d4145a");
		const accentDark = getCssVar("--color-accent-600", "#a80f48");
		const muted = "rgba(156,163,175,0.45)"; // zinc-400 transparent

		// Bars
		for (const bin of frame?.bins ?? bins) {
			const x = xOf(binStart(bin.from, size));
			const w = size * pxPerYear;
			if (x + w < 0 || x > widthCSS) continue;
			const count = bin.count;
			const h = count > 0 ? Math.min(BAR_HEIGHT, Math.max(1.5, (count / top) * (BAR_HEIGHT - 6))) : 0;
			if (count === 0) {
				// kein Balken, nur dünner Sockel
				ctx.fillStyle = "rgba(212,212,216,0.5)"; // zinc-300
				ctx.fillRect(x + 0.5, BAR_HEIGHT - 1, Math.max(0.5, w - 1), 1);
			} else {
				ctx.fillStyle = isSelected(bin) ? accent : muted;
				ctx.fillRect(x + 0.5, BAR_HEIGHT - h, Math.max(0.5, w - 1), h);
			}
		}

		// X-Achse Ticks – adaptiv & endpunkt-verankert.
		// Endpunkte (Ausschnitt-Grenzen) immer; innere Labels im Abstand von
		// tickSteps nur, wenn sie pixelmäßig kollisionsfrei passen (Greedy mit
		// Endpunkt-Vorrang). So fehlt der Beginn nie und auf schmalen Breiten
		// überlappt nichts. Während eines Zoom-Wechsels nur die inneren Labels.
		ctx.fillStyle = "#71717a"; // zinc-500
		ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
		const { label: tickInterval, minor } = tickSteps(axis.years, widthCSS, size);
		const firstYear = frame ? Math.ceil(axis.start) : view.min;
		const lastYear = frame ? Math.floor(axis.start + axis.years) - 1 : view.max;
		const LABEL_PAD = 6; // Mindestabstand zwischen Labels in px

		// Kandidaten: Endpunkte + innere Vielfache von tickInterval
		type TickCand = { year: number; align: "left" | "right" | "center" };
		const interior: TickCand[] = [];
		const firstInner = Math.ceil((firstYear + 1) / tickInterval) * tickInterval;
		for (let y = firstInner; y < lastYear; y += tickInterval) {
			interior.push({ year: y, align: "center" });
		}

		// Box [left, right] eines Labels je nach Alignment berechnen
		const cx = ctx; // non-null capture für die Closures unten
		const placed: Array<[number, number]> = [];
		function boxFor(cand: TickCand): { tx: number; labelX: number; box: [number, number]; w: number } {
			const tx = xOf(cand.year + 0.5);
			const w = cx.measureText(String(cand.year)).width;
			if (cand.align === "left") {
				return { tx, labelX: 2, box: [2, 2 + w], w };
			}
			if (cand.align === "right") {
				return { tx, labelX: widthCSS - 2, box: [widthCSS - 2 - w, widthCSS - 2], w };
			}
			return { tx, labelX: tx, box: [tx - w / 2, tx + w / 2], w };
		}
		function overlaps(box: [number, number]): boolean {
			for (const [l, r] of placed) {
				if (box[0] - LABEL_PAD < r && box[1] + LABEL_PAD > l) return true;
			}
			return false;
		}
		function drawTick(cand: TickCand) {
			const { tx, labelX, box } = boxFor(cand);
			cx.fillRect(tx - 0.5, BAR_HEIGHT, 1, 4);
			cx.textAlign = cand.align;
			cx.fillText(String(cand.year), labelX, BAR_HEIGHT + 16);
			placed.push(box);
		}

		// 1) Endpunkte reservieren (gewinnen jeden Konflikt)
		if (!frame) {
			drawTick({ year: view.min, align: "left" });
			if (view.max !== view.min) drawTick({ year: view.max, align: "right" });
		}
		// 2) Innere Kandidaten links→rechts, nur wenn kollisionsfrei
		for (const cand of interior) {
			if (!overlaps(boxFor(cand).box)) drawTick(cand);
		}
		// kleine Ticks (tickSteps: nie dichter als 8 px, nie feiner als ein Balken)
		if (minor != null) {
			ctx.fillStyle = "#a1a1aa"; // zinc-400
			for (let y = Math.ceil(firstYear / minor) * minor; y <= lastYear; y += minor) {
				if (y % tickInterval === 0) continue;
				ctx.fillRect(xOf(y + 0.5) - 0.5, BAR_HEIGHT, 1, 2);
			}
		}
		if (frame) return;

		// Drag-Overlay
		if (isDragging && dragStart != null && dragEnd != null) {
			const lo = Math.min(dragStart, dragEnd);
			const hi = Math.max(dragStart, dragEnd);
			const x = lo * barWidth();
			const w = (hi - lo + 1) * barWidth();
			ctx.fillStyle = `${accentDark}33`; // ~20% opacity
			ctx.fillRect(x, 0, w, BAR_HEIGHT);
			ctx.strokeStyle = accentDark;
			ctx.lineWidth = 1;
			ctx.strokeRect(x + 0.5, 0.5, w - 1, BAR_HEIGHT - 1);
		}

		// Hover-Linie
		if (hoverBin != null && !isDragging) {
			const idx = hoverBin;
			if (idx >= 0 && idx < bins.length) {
				const x = idx * barWidth() + barWidth() / 2;
				ctx.strokeStyle = "#3f3f46"; // zinc-700
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(x, 0);
				ctx.lineTo(x, BAR_HEIGHT);
				ctx.stroke();
			}
		}
	}

	function getCssVar(name: string, fallback: string): string {
		if (typeof window === "undefined") return fallback;
		const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return v || fallback;
	}

	// Effekt: redraw bei jeder relevanten State-Änderung
	$effect(() => {
		// reactivity-anchors:
		void bins;
		void view;
		void cssWidth;
		void dateFrom;
		void dateTo;
		void hoverBin;
		void isDragging;
		void dragStart;
		void dragEnd;
		void min;
		void max;
		void overlap;
		draw();
	});

	// rAF-throttle für mousemove und die Bilder des Zoom-Übergangs
	let rafPending = false;
	function scheduleDraw() {
		if (rafPending) return;
		rafPending = true;
		requestAnimationFrame(() => {
			rafPending = false;
			draw();
		});
	}

	function onPointerMove(e: PointerEvent) {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const bin = binAtX(x);
		hoverBin = bin;
		if (isDragging && bin != null) {
			if (bin !== dragEnd) {
				dragEnd = bin;
				if (dragStart != null && bin !== dragStart) dragMovedAcrossBars = true;
			}
		}
		scheduleDraw();
	}

	function onPointerLeave() {
		hoverBin = null;
		scheduleDraw();
	}

	function onPointerDown(e: PointerEvent) {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const bin = binAtX(x);
		if (bin == null) return;
		// Ein laufender Zoom-Übergang springt ans Ziel – gezogen wird auf dem neuen Ausschnitt.
		zoomAnim = null;
		isDragging = true;
		dragStart = bin;
		dragEnd = bin;
		dragMovedAcrossBars = false;
		// Pointer-Capture liefert move/up auch ausserhalb des Canvas (ersetzt
		// den früheren window-mouseup-Handler) – funktioniert für Maus + Touch.
		canvas.setPointerCapture(e.pointerId);
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		const start = dragStart;
		const end = dragEnd;
		isDragging = false;
		dragStart = null;
		dragEnd = null;
		// Touch kennt kein Hover – Tooltip nicht stehen lassen (pointerleave
		// feuert auf Touch unzuverlässig).
		if (e.pointerType === "touch") hoverBin = null;
		if (start == null || end == null || !bins[start] || !bins[end]) return;
		// Click (kein Drag): nur ein Balken selektiert (ein Jahr bzw. dessen Jahre)
		if (!dragMovedAcrossBars || start === end) {
			onApply(bins[start].from, bins[start].to);
		} else {
			const lo = Math.min(start, end);
			const hi = Math.max(start, end);
			onApply(bins[lo].from, bins[hi].to);
		}
	}

	function onPointerCancel() {
		// Browser hat die Geste übernommen (z. B. vertikales Scrollen auf Touch):
		// Auswahl verwerfen, kein onApply.
		isDragging = false;
		dragStart = null;
		dragEnd = null;
		dragMovedAcrossBars = false;
		hoverBin = null;
		scheduleDraw();
	}

	function reset() {
		onApply(null, null);
	}

	// ResizeObserver
	onMount(() => {
		if (!wrapper) return;
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				cssWidth = Math.max(200, Math.floor(entry.contentRect.width));
			}
		});
		ro.observe(wrapper);
		return () => ro.disconnect();
	});

	const tooltipText = $derived.by(() => {
		if (hoverBin == null || !bins[hoverBin]) return null;
		const bin = bins[hoverBin];
		return `${binLabel(bin)}: ${bin.count.toLocaleString("de-CH")} Treffer`;
	});
</script>

<div class="timeline-wrap">
	{#if caption}
		<p class="text-xs text-zszh-600 mb-2">{caption}</p>
	{/if}

	<div
		bind:this={wrapper}
		class="relative bg-white border border-zszh-200 rounded-md px-2 pt-2 pb-1"
	>
		<!-- Ein Bild mit Beschriftung; die Auswahl geht ohne Maus über die Jahresfelder. -->
		<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
		<canvas
			bind:this={canvas}
			role="img"
			aria-label={canvasLabel}
			onpointermove={onPointerMove}
			onpointerleave={onPointerLeave}
			onpointerdown={onPointerDown}
			onpointerup={onPointerUp}
			onpointercancel={onPointerCancel}
			class="block w-full cursor-crosshair select-none touch-pan-y"
			style="height: {TOTAL_HEIGHT}px;"
		></canvas>

		{#if tooltipText && hoverBin != null}
			{@const bw = barWidth()}
			{@const xCenter = hoverBin * bw + bw / 2}
			{@const tooltipLeft = Math.max(40, Math.min(cssWidth - 80, xCenter))}
			<div
				class="absolute -top-7 bg-zszh-900 text-zszh-50 text-xs font-medium px-2 py-1 rounded shadow pointer-events-none whitespace-nowrap tabular-nums"
				style="left: {tooltipLeft}px; transform: translateX(-50%);"
			>
				{tooltipText}
			</div>
		{/if}
	</div>

	<div class="flex justify-between items-baseline gap-x-4 mt-2 text-sm text-zszh-700">
		<div>
			{#if stages.length === 0}
				<span class="font-semibold">Alle Jahre</span>
			{:else}
				<!-- Zoom-Stufen: die früheren setzen ihren Zeitraum wieder (herauszoomen). -->
				<nav aria-label="Zoomstufen der Zeitleiste" class="inline">
					<button type="button" onclick={reset} class="text-accent-600 underline hover:text-accent-700"
						>Alle Jahre</button
					>
					{#each stages as stage, i (i)}
						<!-- Leerzeichen explizit: am Anfang/Ende eines Blocks streicht Svelte sie. -->
						{" "}<span class="text-zszh-400" aria-hidden="true">›</span>{" "}
						{#if i < stages.length - 1}
							<button
								type="button"
								onclick={() => onApply(stage.from, stage.to)}
								class="text-accent-600 underline hover:text-accent-700 tabular-nums"
								>{stageLabel(stage, { min, max })}</button
							>
						{:else}
							<span class="font-semibold tabular-nums" aria-current="true">{stageLabel(stage, { min, max })}</span>
						{/if}
					{/each}
				</nav>
			{/if}
			<span class="text-zszh-600"
				>· {totalInRange.toLocaleString("de-CH")} Treffer</span
			>
			{#if binSize > 1}
				<span class="text-zszh-500">· Balken je {binSize} Jahre</span>
			{/if}
			{#if note}
				<span class="text-zszh-500">· {note}</span>
			{/if}
		</div>
		{#if dateFrom != null || dateTo != null}
			<button
				type="button"
				onclick={reset}
				class="text-xs text-accent-600 underline"
				aria-label="Datumsfilter zurücksetzen"
			>
				Reset ×
			</button>
		{/if}
	</div>
</div>

<style>
	.timeline-wrap {
		container-type: inline-size;
	}
</style>
