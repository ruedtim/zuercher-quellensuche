// Datums-Sortierung über ein Jahresfenster: welche Treffer eine Seite braucht und
// in welcher Reihenfolge (pur), dazu der Ablauf mit injizierten Abfragen
// (searchByDateWindow); unit-getestet in dateWindow.test.ts. Genutzt von der
// Einzelsuche (searchDocuments) und der ODER-Suche (searchDocumentsUnion), beide in
// meili.ts.
//
// Meili sortiert nach Datum teuer, sobald es die Treffer vor dem Offset einzeln
// bewertet: `date` bildet einen Sortier-Bucket je Tag.
// - Föderation (ODER), in jeder Version: `federation.sort` wird abgelehnt, `sort` je
//   Zweig mischt zwar richtig, kostet aber ~0,75 ms je Treffer und Zweig BIS ZUM
//   OFFSET. Prod 2026-10-30, `fisch OR see` (52'436): Offset 0 47 ms, 1'000 1,6 s,
//   5'000 6,7 s, ab ~10'000 am Cutoff (searchCutoffMs 10 s) – dann doppelte,
//   fehlende und falsch einsortierte Treffer.
// - Einzelsuche seit Meili v1.47 ebenso («always perform a federated search under
//   the hood»): documents-Kopie, `fisch` nach Datum, Offset 10'000 in v1.13 33 ms,
//   in v1.56 6,6 s; 10'000 Treffer ab Offset 0 1,8 bzw. 6,2 s
//   (docs/architektur-erkundung.md 3.2). Dazu formatiert v1.56 (Hervorhebung, Auszug)
//   jeden Treffer bis zum Offset: `fisch` nach Datum, Offset 5'000, nur IDs 3,5 s, wie
//   die Trefferliste 7,6 s; ab ~14'000 am Cutoff, dann falsche Seiten.
// - Ohne Suchbegriff kostet ein Treffer weniger, aber es sind alle: Prod v1.57, letzte
//   Seite der Zentralen Serien (Offset 697'520) 9,5 s, Serie RRB 6,3–6,8 s (2026-11-24).
//
// Darum ein Fenster über die Jahre: Die Jahres-Facette der datierten Treffer sagt,
// in welchen Jahren die Seite liegt. Geholt werden nur die Treffer dieser Jahre,
// nach Relevanz und ohne Formatierung (billig), hier nach Datum geordnet und auf die
// Seite geschnitten; formatiert werden nur die Treffer der Seite (`id IN […]`). Ohne
// Datum (4'425 Ratsmanual-Sitzungen bis 1777, Jahr bekannt) stehen Treffer wie in
// Meilis Datums-Sort am Ende, in beiden Richtungen.
//
// Reihenfolge: `date` (Richtung der Sortierung), `startPg` aufsteigend (wie mapSort,
// fehlende Werte zuletzt), bei Gleichstand die Reihenfolge der Relevanz-Suche. Bei
// der Einzelsuche ist das Meilis eigene Reihenfolge innerhalb eines Sortier-Buckets
// (strikt gibt es nur einen words-Bucket, danach die übrigen Ranking-Regeln und die
// interne Doc-ID), bei der Föderation Score, Zweig, interne Doc-ID. Beides
// hängt nur am Dokument (und Zweig), nicht am Jahresfilter – Seiten,
// Nachbar-Navigation und Treffer-Export ergeben darum dieselbe Folge.
//
// Annahme: jedes `date` beginnt mit seinem `dateYear` (der Indexer leitet es daraus
// ab; Prod 2026-10-31 alle 510 Jahre geprüft). Fehlt einem datierten Treffer das
// Jahr, passt die Facette nicht zur Trefferzahl ⇒ ganze Treffermenge (fallback).

export type DateSort = "date_asc" | "date_desc";

/** Felder, nach denen die Seite geordnet wird. */
export interface DatedHit {
	date?: string | null;
	startPg?: number | null;
}

/** Sortierfelder der Treffer im Fenster. */
export const DATE_WINDOW_SORT_FIELDS = ["id", "date", "startPg"];

/**
 * Einzelsuche mit Suchbegriff: bis zu dieser Tiefe (offset + limit) bleibt es EINE Meili-Abfrage
 * mit `sort` (Seite 1 à 20), tiefer das Fenster (drei Abfragen nacheinander, die beiden Zählungen
 * parallel). Gemessen auf Prod (v1.57, 2026-11-24, Meili-Zeit je Seite à 20, direkt / Fenster): Offset
 * 0 25–67 / 25–76 ms, 20 44–128 / 27–92, 80 92–204 / 35–70 («Gemeinde», «fisch», «Regierungsrat
 * Beschluss», «Hochwasser»); tiefer wächst nur die direkte Abfrage (Offset 5'000 5,9 s).
 */
export const DATE_WINDOW_MIN_DEPTH = 20;

/**
 * Dasselbe ohne Suchbegriff: Dort kostet `sort` je Treffer vor der Seite nur ~0,01 ms, das
 * Fenster immer 13–25 ms. Gemessen auf der documents-Kopie (Mac, warm, v1.56, 2026-11-24,
 * ganzer Korpus, Meili-Zeit je Seite à 20, direkt / Fenster): Offset 1'000 14 / 17 ms, 2'000
 * 20 / 21, 5'000 45 / 17, 10'000 356 / 68, 50'000 2'925 / 118; immer dieselbe Seite.
 */
export const DATE_WINDOW_MIN_DEPTH_NO_QUERY = 2_000;

/**
 * Passt die Jahres-Facette nicht zur Trefferzahl (fallback), holt das Fenster die ganze
 * Treffermenge – bis hierher. Grösser nimmt die Einzelsuche Meilis eigene Sortierung (tief
 * langsam): Der ganze Korpus wären 700'000 Treffer im Speicher.
 */
export const DATE_WINDOW_FALLBACK_MAX = 50_000;

/**
 * Läuft eine Einzelsuche über das Fenster? Nur strikt (matchingStrategy "all": ein
 * words-Bucket, die Relevanz-Reihenfolge ist Meilis Reihenfolge im Sortier-Bucket;
 * weich reiht Meili zuerst nach der Zahl getroffener Wörter, erst darin nach Datum) und
 * erst ab DATE_WINDOW_MIN_DEPTH, ohne Suchbegriff ab DATE_WINDOW_MIN_DEPTH_NO_QUERY.
 */
export function dateWindowSort(input: {
	sort: string;
	q: string;
	strict: boolean;
	offset: number;
	limit: number;
}): DateSort | null {
	if (input.sort !== "date_asc" && input.sort !== "date_desc") return null;
	if (!input.strict) return null;
	const minDepth = input.q.trim() === "" ? DATE_WINDOW_MIN_DEPTH_NO_QUERY : DATE_WINDOW_MIN_DEPTH;
	return input.offset + input.limit > minDepth ? input.sort : null;
}

/** Was die Seite [offset, offset + limit) aus den Treffern braucht. */
export interface DateWindow {
	/** Zusatzfilter (Meili-Syntax) für die Treffer des Fensters; null = alle Treffer. */
	clause: string | null;
	/** So viele Treffer liefert die Suche mit `clause` (ihr limit). */
	fetch: number;
	/** Position des ersten Seitentreffers in diesen Treffern, nach Datum geordnet. */
	localOffset: number;
	/** Jahres-Facette passt nicht zur Trefferzahl ⇒ alle Treffer (Notbehelf, teuer). */
	fallback?: true;
}

/**
 * Plant das Fenster einer Seite. `total` = alle Treffer (bei ODER dedupliziert),
 * `datedTotal` und `datedYears` = dieselben Treffer mit `date IS NOT NULL`
 * (Trefferzahl und dateYear-Facette). null = die Seite ist leer.
 */
export function planDateWindow(input: {
	total: number;
	datedTotal: number;
	datedYears: Record<string, number> | undefined;
	sort: DateSort;
	offset: number;
	limit: number;
}): DateWindow | null {
	const { total, sort } = input;
	const offset = Math.max(0, Math.floor(input.offset));
	const limit = Math.floor(input.limit);
	if (!(total > 0) || !(limit > 0) || offset >= total) return null;
	const datedTotal = Math.min(Math.max(0, input.datedTotal), total);
	const undated = total - datedTotal;

	const years = Object.entries(input.datedYears ?? {})
		.map(([y, c]) => [Number(y), c] as const)
		.filter(([y, c]) => Number.isInteger(y) && c > 0)
		.sort((a, b) => (sort === "date_asc" ? a[0] - b[0] : b[0] - a[0]));
	const sum = years.reduce((s, [, c]) => s + c, 0);
	// Fehlende oder überzählige Jahre (Facette gekappt?) ⇒ Positionen nicht
	// verlässlich: alle Treffer holen, lieber langsam als falsch.
	if (sum !== datedTotal) return { clause: null, fetch: total, localOffset: offset, fallback: true };

	// Seite beginnt hinter allen datierten Treffern: nur Treffer ohne Datum.
	if (offset >= datedTotal) {
		return { clause: "date IS NULL", fetch: undated, localOffset: offset - datedTotal };
	}

	const end = Math.min(offset + limit, total);
	let before = 0;
	let first = 0;
	while (before + years[first][1] <= offset) {
		before += years[first][1];
		first++;
	}
	let last = first;
	let covered = before + years[first][1];
	while (covered < end && last < years.length - 1) {
		last++;
		covered += years[last][1];
	}
	const fromYear = Math.min(years[first][0], years[last][0]);
	const toYear = Math.max(years[first][0], years[last][0]);
	const range = fromYear === toYear ? `dateYear = ${fromYear}` : `dateYear >= ${fromYear} AND dateYear <= ${toYear}`;
	const datedFetch = covered - before;
	// Reicht die Seite über die datierten Treffer hinaus, kommen alle undatierten
	// dazu (sie stehen geschlossen am Ende); sonst bleiben sie draussen, auch die
	// aus den Jahren des Fensters.
	if (covered < end) {
		return { clause: `(date IS NULL OR (${range}))`, fetch: datedFetch + undated, localOffset: offset - before };
	}
	return { clause: `(date IS NOT NULL AND ${range})`, fetch: datedFetch, localOffset: offset - before };
}

/** Vergleich nach `date` (Richtung der Sortierung) und `startPg` aufsteigend, fehlende Werte zuletzt. */
export function compareByDate(sort: DateSort): (a: DatedHit, b: DatedHit) => number {
	const dir = sort === "date_asc" ? 1 : -1;
	return (a, b) => {
		const ad = a.date ?? null;
		const bd = b.date ?? null;
		if (ad !== bd) {
			if (ad === null) return 1;
			if (bd === null) return -1;
			return (ad < bd ? -1 : 1) * dir;
		}
		const ap = a.startPg ?? null;
		const bp = b.startPg ?? null;
		if (ap === bp) return 0;
		if (ap === null) return 1;
		if (bp === null) return -1;
		return ap - bp;
	};
}

/**
 * Die Treffer des Fensters (Relevanz-Reihenfolge) nach Datum ordnen und die Seite
 * herausschneiden. Stabil: Gleichstände behalten die Relevanz-Reihenfolge.
 */
export function orderDateWindow<T extends DatedHit>(pool: readonly T[], sort: DateSort, window: DateWindow, limit: number): T[] {
	return pool
		.slice()
		.sort(compareByDate(sort))
		.slice(window.localOffset, window.localOffset + Math.max(0, limit));
}

/** Facetten einer Abfrage; das Fenster selbst braucht nur die Jahre. */
export interface DateWindowFacets {
	dateYear?: Record<string, number>;
}

/** Antwort einer Abfrage des Fensters (Meili-Suche bzw. Föderation). */
export interface DateWindowRaw<H, F extends DateWindowFacets = DateWindowFacets> {
	hits: H[];
	estimatedTotalHits?: number;
	processingTimeMs?: number;
	facetDistribution?: F;
}

/** Eine Abfrage des Fensters: alle Bedingungen der Suche plus `clause`, ohne `sort`. */
export interface DateWindowQuery {
	clause: string | null;
	limit: number;
	/** Facetten (bei limit 0). */
	facets: string[];
	/** Felder der Treffer; fehlt = alle. */
	retrieve?: string[];
}

export interface DateWindowDeps<H, F extends DateWindowFacets = DateWindowFacets> {
	/** Suche bzw. Föderation nach Relevanz, ohne Hervorhebung und Auszug. */
	query(q: DateWindowQuery): Promise<DateWindowRaw<H, F>>;
	/** Die Treffer `ids` wie in der Trefferliste (Hervorhebung, Auszug), Reihenfolge beliebig. */
	format(ids: string[]): Promise<DateWindowRaw<H, F>>;
	/** Die Seite mit Meilis eigener Sortierung; statt einer Treffermenge über DATE_WINDOW_FALLBACK_MAX. */
	direct?(): Promise<DateWindowRaw<H, F>>;
}

export interface DateWindowPage<H, F extends DateWindowFacets = DateWindowFacets> {
	hits: H[];
	total: number;
	/** Facetten aller Treffer (opts.facets). */
	facetDistribution?: F;
	processingTimeMs: number;
	/** Jahres-Facette passte nicht zur Trefferzahl, geholt wurden alle Treffer (bzw. `direct`). */
	fallback?: true;
}

/**
 * Eine Seite nach Datum: Trefferzahl + Facetten aller Treffer und die Jahres-Facette
 * der datierten (parallel), daraus das Fenster; dann dessen Treffer nach Relevanz
 * (nur die Sortierfelder), hier geordnet und geschnitten; zuletzt die Seite selbst
 * formatiert. Lean (Treffer-Export): die geschnittenen Treffer sind das Ergebnis,
 * mit der Projektion `retrieve` (ohne = alle Felder).
 */
export async function searchByDateWindow<H extends DatedHit & { id: string }, F extends DateWindowFacets = DateWindowFacets>(
	deps: DateWindowDeps<H, F>,
	opts: { sort: DateSort; offset: number; limit: number; facets: string[]; lean: boolean; retrieve?: string[] },
): Promise<DateWindowPage<H, F>> {
	const ids = ["id"];
	const [all, dated] = await Promise.all([
		deps.query({ clause: null, limit: 0, facets: opts.facets, retrieve: ids }),
		deps.query({ clause: "date IS NOT NULL", limit: 0, facets: ["dateYear"], retrieve: ids }),
	]);
	const total = all.estimatedTotalHits ?? 0;
	const page = (hits: H[], processingTimeMs: number, fallback?: true): DateWindowPage<H, F> => ({
		hits,
		total,
		facetDistribution: all.facetDistribution,
		processingTimeMs,
		...(fallback ? { fallback } : {}),
	});
	const window = planDateWindow({
		total,
		datedTotal: dated.estimatedTotalHits ?? 0,
		datedYears: dated.facetDistribution?.dateYear,
		sort: opts.sort,
		offset: opts.offset,
		limit: opts.limit,
	});
	if (!window) return page([], all.processingTimeMs ?? 0);
	if (window.fallback && window.fetch > DATE_WINDOW_FALLBACK_MAX && deps.direct) {
		const res = await deps.direct();
		return page(res.hits ?? [], (all.processingTimeMs ?? 0) + (res.processingTimeMs ?? 0), true);
	}
	// Im Export sind die Treffer des Fensters das Ergebnis – dort zusätzlich seine
	// Projektion (ohne Projektion alle Felder).
	const retrieve = !opts.lean
		? DATE_WINDOW_SORT_FIELDS
		: opts.retrieve
			? [...new Set([...opts.retrieve, ...DATE_WINDOW_SORT_FIELDS])]
			: undefined;
	const pool = await deps.query({ clause: window.clause, limit: window.fetch, facets: [], retrieve });
	const sorted = orderDateWindow(pool.hits ?? [], opts.sort, window, opts.limit);
	const poolMs = (all.processingTimeMs ?? 0) + (pool.processingTimeMs ?? 0);
	if (opts.lean || sorted.length === 0) return page(sorted, poolMs, window.fallback);
	const formatted = await deps.format(sorted.map((h) => h.id));
	const byId = new Map((formatted.hits ?? []).map((h) => [h.id, h]));
	// Fehlt ein Treffer (Index dazwischen geändert), lieber eine kürzere Seite als
	// eine Zeile ohne Titel und Text.
	return page(
		sorted.flatMap((h) => byId.get(h.id) ?? []),
		poolMs + (formatted.processingTimeMs ?? 0),
		window.fallback,
	);
}
