// Die Reihenfolge eines Themas: welche Treffer es in welcher Folge zeigt (pur, unit-getestet in
// themeOrder.test.ts). Genutzt von der Dokumentsuche (meili.ts, search.ts) und dem Reiter
// «Archivkatalog» (catalog.ts). Die Liste entsteht als Kennungen mit Score, die Seite formatiert
// danach eine zweite Abfrage; die Aufrufer heben sie ein paar Minuten auf, Folgeseiten sind dann
// Ausschnitte derselben Liste.
//
// Zwei Dinge bestimmen den Ablauf (Prod v1.57, 2026-11-24):
// - Meilis Vektorsuche (HNSW) sucht nur so breit, wie `limit` ist. Bei 5 Treffern («Alle Quellen»)
//   fehlten 11 % der nächsten, bei 20 noch 5 %, im Katalog stand bei einem von 20 Themen keiner der
//   20 nächsten auf Seite 1. Breiter kostet warm wenig (100: 15 statt 4 ms); kalt liest Meili rund
//   zehn Seiten der Platte je Treffer des Fensters (je 0,23 ms): frische Themen 33 ms (Dokumente) bzw.
//   95 bis 190 ms (Katalog), gleich nach einem Neustart oder Import 0,3 bis 2 s.
// - Ein Wort lässt sich der Vektorsuche nicht als Filter mitgeben, nur als Kennungen. Die kommen über
//   die Facette `id` (hitIds.ts): 9'400 Treffer 30 ms und 90 ms Reihung, 25'000 80 und 170 ms, exakt und
//   kalt kaum teurer. Bei noch breiteren Wörtern genügen meist die nächsten 300 unter den Filtern und der
//   Abgleich, welche davon das Wort enthalten (65 + 25 ms, kalt 0,1 bis 1,9 s).

/** Länge der Listen mit Thema: so viele Treffer lassen sich durchblättern. */
export const THEME_LIST_MAX = 1_000;

/**
 * Suchfenster ohne Wort: bis `need` Treffer genügt `window`. Richtig sind dann (Prod, 16 Themen) 5 aus
 * 75 100 % (aus 5 84 %, aus 50 96 %), 20 aus 75 98,7 % (aus 20 91 %, aus 100 99,4 %), weiter hinten
 * (Kopie, 40 Themen) 140 aus 200 99,4 %, 300 aus 300 99,5 %. «Alle Quellen» und die ersten drei Seiten
 * kosten so eine Vektorsuche.
 * Trifft der Filter höchstens die Hälfte der Vektoren (`narrow`), sucht Meili von sich aus breiter: 20
 * fanden dort 20 der 20 nächsten (bis ein Zehntel reiht es ohnehin exakt), ein Fenster von 100 kostete
 * aber das Vierfache (110 ms).
 */
const WINDOWS = {
	wide: [
		{ need: 60, window: 75 },
		{ need: 140, window: 200 },
		{ need: 300, window: 300 },
		{ need: THEME_LIST_MAX, window: THEME_LIST_MAX },
	],
	narrow: [
		{ need: 25, window: 25 },
		{ need: 50, window: 50 },
		{ need: 100, window: 100 },
		{ need: 300, window: 300 },
		{ need: THEME_LIST_MAX, window: THEME_LIST_MAX },
	],
};

/** Runden mit Wort: so viele nächste Dokumente werden auf das Wort geprüft. */
const WITHIN_ROUNDS = [300, 1_000];
/** Mehr Treffer als das gibt die kleine Runde kaum her. */
const SMALL_ROUND_NEED = 40;

/** Bis zu so vielen Treffern mit Vektor reiht Meili sie direkt (exakt, Kennungen im Filter). */
const EXACT_MAX = 20_000;
/** Reicht die kleine Runde nicht: alle Treffer bis hierher, sonst die grosse und die POOL relevantesten. */
const ALL_MAX = 50_000;
const POOL = 10_000;

export interface Ranked<Id> {
	id: Id;
	score: number;
}

export interface ThemeOrder<Id> {
	hits: Ranked<Id>[];
	/** So viele davon reihte der Vektor, der Rest steht am Ende (Dokumente ohne Vektor). */
	ranked: number;
	/** So viele sind schon verlangt worden; sie behalten ihren Platz, wenn die Liste wächst. */
	shown: number;
	/** Grösstes Suchfenster bisher. */
	window: number;
	/** Mehr gibt es nicht: alle Treffer oder die Höchstlänge. */
	complete: boolean;
}

/** Suchfenster einer Vektorsuche, von der `need` Treffer gezeigt werden. */
export function vectorWindow(need: number, narrow = false): number {
	return (narrow ? WINDOWS.narrow : WINDOWS.wide).find((w) => need <= w.need)?.window ?? need;
}

/** Hinten anfügen, was noch fehlt, bis zur Höchstlänge. */
function append<Id>(hits: readonly Ranked<Id>[], more: readonly Ranked<Id>[], max: number): Ranked<Id>[] {
	const seen = new Set(hits.map((h) => h.id));
	const out = hits.slice(0, max);
	for (const h of more) {
		if (out.length >= max) break;
		if (seen.has(h.id)) continue;
		seen.add(h.id);
		out.push(h);
	}
	return out;
}

/** Was von einer früheren Liste stehen bleibt: die schon verlangten Plätze. */
function kept<Id>(prev: ThemeOrder<Id> | null): Ranked<Id>[] {
	return prev ? prev.hits.slice(0, prev.shown) : [];
}

/** Dieselbe Liste, mit vermerktem Bedarf. */
function shownTo<Id>(order: ThemeOrder<Id>, want: number): ThemeOrder<Id> {
	return want > order.shown ? { ...order, shown: want } : order;
}

export interface ThemeAloneDeps<Id> {
	/** Die k nächsten unter den Filtern. */
	nearest: (k: number) => Promise<Ranked<Id>[]>;
	/** Was danach noch zur Liste gehört (Dokumente ohne Vektor). */
	rest: (limit: number) => Promise<Ranked<Id>[]>;
}

/** Thema ohne Wort: die nächsten Dokumente, danach der Rest. `prev` wird fortgesetzt. */
export async function themeOrderAlone<Id>(
	prev: ThemeOrder<Id> | null,
	need: number,
	{ max, narrow }: { max: number; narrow: boolean },
	deps: ThemeAloneDeps<Id>,
): Promise<ThemeOrder<Id>> {
	const want = Math.min(need, max);
	const window = vectorWindow(want, narrow);
	if (prev && (prev.complete || (prev.hits.length >= want && prev.window >= window))) return shownTo(prev, want);
	const near = await deps.nearest(window);
	const ranked = append(kept(prev), near, max);
	if (near.length >= window) return { hits: ranked, ranked: ranked.length, shown: want, window, complete: ranked.length >= max };
	// Alle mit Vektor gesehen – oder eine abgebrochene bzw. lückenhafte Suche: einmal so breit wie die
	// ganze Liste nachfragen (bei wenigen Dokumenten kostet das nichts).
	if (window < max) {
		const wide = await deps.nearest(max);
		if (wide.length > near.length) {
			const more = append(kept(prev), wide, max);
			if (wide.length >= max) return { hits: more, ranked: more.length, shown: want, window: max, complete: more.length >= max };
			const all = more.length < max ? append(more, await deps.rest(max - more.length), max) : more;
			return { hits: all, ranked: more.length, shown: want, window: max, complete: true };
		}
	}
	const hits = ranked.length < max ? append(ranked, await deps.rest(max - ranked.length), max) : ranked;
	return { hits, ranked: ranked.length, shown: want, window, complete: true };
}

export interface ThemeWithinDeps<Id> {
	/** Die k nächsten unter den Filtern, ohne Wort; `within`: nur diese (exakt gereiht). */
	nearest: (k: number, within?: readonly Id[]) => Promise<Ranked<Id>[]>;
	/** Welche davon die Suche trifft. */
	match: (ids: readonly Id[]) => Promise<Id[]>;
	/** Treffer der Suche mit Vektor: alle in beliebiger Folge, sonst die `limit` relevantesten. */
	candidates: (limit: number) => Promise<Id[]>;
	/** Treffer der Suche ohne Vektor, in deren Reihenfolge. */
	rest: (limit: number) => Promise<Ranked<Id>[]>;
}

export interface ThemeSize {
	/** Treffer der Suche, die einen Vektor tragen. */
	withVectors: number;
	/** Höchstlänge der Liste. */
	max: number;
}

/**
 * Thema innerhalb der Treffer eines Worts (oder mehrerer ODER-Begriffe): Meili reiht die Treffer
 * direkt; bei sehr vielen zuerst die nächsten Dokumente, die das Wort enthalten, und nur wenn sie nicht
 * reichen, die Treffer selbst. Treffer ohne Vektor stehen am Ende. `prev` wird fortgesetzt.
 */
export async function themeOrderWithin<Id>(
	prev: ThemeOrder<Id> | null,
	need: number,
	{ withVectors, max }: ThemeSize,
	deps: ThemeWithinDeps<Id>,
): Promise<ThemeOrder<Id>> {
	const want = Math.min(need, max);
	if (prev && (prev.complete || prev.hits.length >= want)) return shownTo(prev, want);
	let ranked = kept(prev);
	let window = prev?.window ?? 0;

	// Weniger als k nächste heisst hier nie «alle gesehen» (der Filter trifft mehr als EXACT_MAX Dokumente
	// mit Vektor), sondern eine abgebrochene oder lückenhafte Suche: dann weiter mit den Treffern selbst.
	if (withVectors > EXACT_MAX) {
		// Die kleine Runde für die ersten Seiten, die grosse nur, wo nicht alle Treffer gereiht werden können.
		const rounds = WITHIN_ROUNDS.filter((k) => k > window && (k === WITHIN_ROUNDS[0] ? want <= SMALL_ROUND_NEED : withVectors > ALL_MAX));
		// Ist die grösste Runde schon gelaufen, bleibt alles stehen, was sie fand: Unter den relevantesten,
		// die jetzt folgen, ist es nicht unbedingt.
		if (prev && rounds.length === 0 && withVectors > ALL_MAX) ranked = prev.hits.slice(0, max);
		for (const k of rounds) {
			const near = await deps.nearest(k);
			const hit = new Set(await deps.match(near.map((h) => h.id)));
			const found = near.filter((h) => hit.has(h.id));
			ranked = append(ranked, found, max);
			window = k;
			if (ranked.length >= want) {
				return { hits: ranked, ranked: ranked.length, shown: want, window, complete: ranked.length >= max };
			}
		}
	}

	if (withVectors > 0) {
		const ids = await deps.candidates(withVectors <= ALL_MAX ? withVectors : POOL);
		let near = ids.length > 0 ? await deps.nearest(max, ids) : [];
		// Alle Kandidaten tragen einen Vektor: weniger heisst abgebrochen, dann wenigstens die relevantesten.
		if (near.length < Math.min(max, ids.length) && ids.length > POOL) near = await deps.nearest(max, await deps.candidates(POOL));
		ranked = append(ranked, near, max);
	}
	const hits = ranked.length < max ? append(ranked, await deps.rest(max - ranked.length), max) : ranked;
	return { hits, ranked: ranked.length, shown: want, window, complete: true };
}

/** Aufgehobene Reihenfolgen (ttlCache.ts). */
export interface OrderCache<Id> {
	get(key: string): Promise<ThemeOrder<Id> | null> | undefined;
	set(key: string, value: Promise<ThemeOrder<Id> | null>): void;
}

/**
 * Reihenfolge aus dem Speicher, sonst berechnet bzw. fortgesetzt (`extend` gibt `prev` unverändert
 * zurück, wenn sie genügt). Gleichzeitige Anfragen derselben Suche rechnen nur einmal; eine
 * gescheiterte Berechnung bleibt nicht stehen, ebenso wenig eine, die `keep` verwirft (abgebrochene
 * Vektorsuche, vectorCutoff.ts).
 */
export async function cachedOrder<Id>(
	cache: OrderCache<Id>,
	key: string,
	extend: (prev: ThemeOrder<Id> | null) => Promise<ThemeOrder<Id>>,
	keep: () => boolean = () => true,
): Promise<ThemeOrder<Id>> {
	const pending = cache.get(key);
	if (!pending) {
		const first = extend(null);
		cache.set(
			key,
			first.catch(() => null),
		);
		const order = await first;
		if (!keep()) cache.set(key, Promise.resolve(null));
		return order;
	}
	const prev = await pending;
	const next = await extend(prev);
	if (next !== prev && keep()) {
		// Eine gleichzeitige Anfrage kann inzwischen weiter sein.
		const other = await cache.get(key);
		if (!other || other.shown <= next.shown) cache.set(key, Promise.resolve(next));
	}
	return next;
}
