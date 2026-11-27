import test from "node:test";
import assert from "node:assert/strict";
import {
	DATE_WINDOW_FALLBACK_MAX,
	DATE_WINDOW_MIN_DEPTH,
	DATE_WINDOW_MIN_DEPTH_NO_QUERY,
	DATE_WINDOW_SORT_FIELDS,
	compareByDate,
	dateWindowSort,
	orderDateWindow,
	planDateWindow,
	searchByDateWindow,
	type DateSort,
	type DateWindow,
	type DateWindowQuery,
	type DateWindowRaw,
} from "./dateWindow";

// 1900: 5, 1901: 3, 1902: 4 datierte Treffer, dazu 2 ohne Datum.
const YEARS = { "1900": 5, "1901": 3, "1902": 4 };
const plan = (sort: DateSort, offset: number, limit: number, over: Partial<Parameters<typeof planDateWindow>[0]> = {}) =>
	planDateWindow({ total: 14, datedTotal: 12, datedYears: YEARS, sort, offset, limit, ...over });

test("planDateWindow: Seite in einem Jahr ⇒ nur dieses Jahr, ohne undatierte", () => {
	assert.deepEqual(plan("date_asc", 0, 2), { clause: "(date IS NOT NULL AND dateYear = 1900)", fetch: 5, localOffset: 0 });
	assert.deepEqual(plan("date_asc", 5, 3), { clause: "(date IS NOT NULL AND dateYear = 1901)", fetch: 3, localOffset: 0 });
	assert.deepEqual(plan("date_desc", 0, 4), { clause: "(date IS NOT NULL AND dateYear = 1902)", fetch: 4, localOffset: 0 });
	assert.deepEqual(plan("date_desc", 5, 2), { clause: "(date IS NOT NULL AND dateYear = 1901)", fetch: 3, localOffset: 1 });
});

test("planDateWindow: Seite über eine Jahresgrenze ⇒ Jahresbereich, Offset ab dessen Anfang", () => {
	// asc: Position 4 = letzter Treffer von 1900, 5–6 aus 1901.
	assert.deepEqual(plan("date_asc", 4, 3), { clause: "(date IS NOT NULL AND dateYear >= 1900 AND dateYear <= 1901)", fetch: 8, localOffset: 4 });
	// desc: 1902 (0–3), 1901 (4–6), 1900 (7–11) – Position 3 bis 8.
	assert.deepEqual(plan("date_desc", 3, 6), { clause: "(date IS NOT NULL AND dateYear >= 1900 AND dateYear <= 1902)", fetch: 12, localOffset: 3 });
});

test("planDateWindow: Seite reicht ins Ende ohne Datum ⇒ alle undatierten dazu", () => {
	assert.deepEqual(plan("date_asc", 11, 3), { clause: "(date IS NULL OR (dateYear = 1902))", fetch: 6, localOffset: 3 });
	assert.deepEqual(plan("date_desc", 10, 20), { clause: "(date IS NULL OR (dateYear = 1900))", fetch: 7, localOffset: 3 });
	// Ganz ohne undatierte: der letzte Jahresbereich genügt.
	assert.deepEqual(plan("date_asc", 10, 20, { total: 12 }), { clause: "(date IS NOT NULL AND dateYear = 1902)", fetch: 4, localOffset: 2 });
});

test("planDateWindow: Seite nur aus undatierten", () => {
	assert.deepEqual(plan("date_asc", 12, 20), { clause: "date IS NULL", fetch: 2, localOffset: 0 });
	assert.deepEqual(plan("date_desc", 13, 1), { clause: "date IS NULL", fetch: 2, localOffset: 1 });
	assert.deepEqual(plan("date_asc", 0, 20, { total: 3, datedTotal: 0, datedYears: {} }), { clause: "date IS NULL", fetch: 3, localOffset: 0 });
});

test("planDateWindow: leere Seite ⇒ null", () => {
	assert.equal(plan("date_asc", 14, 20), null);
	assert.equal(plan("date_asc", 0, 0), null);
	assert.equal(plan("date_asc", 0, 20, { total: 0, datedTotal: 0, datedYears: {} }), null);
});

test("planDateWindow: Facette passt nicht zur Trefferzahl ⇒ alle Treffer", () => {
	assert.deepEqual(plan("date_asc", 7, 20, { datedTotal: 13 }), { clause: null, fetch: 14, localOffset: 7, fallback: true });
	assert.deepEqual(plan("date_asc", 7, 20, { datedYears: undefined }), { clause: null, fetch: 14, localOffset: 7, fallback: true });
});

test("planDateWindow: leere und unbrauchbare Facettenwerte zählen nicht", () => {
	const years = { "1900": 5, "1901": 0, "x": 4, "1902": 7 };
	assert.deepEqual(plan("date_asc", 5, 2, { datedYears: years }), { clause: "(date IS NOT NULL AND dateYear = 1902)", fetch: 7, localOffset: 0 });
});

const hit = (id: string, date: string | null, startPg: number | null = null) => ({ id, date, startPg });

test("compareByDate: Datum in Richtung der Sortierung, startPg aufsteigend, fehlende Werte zuletzt", () => {
	const hits = [hit("a", "1901-01-02"), hit("b", null, 3), hit("c", "1900-05-01", 7), hit("d", "1900-05-01", 2), hit("e", "1900-05-01"), hit("f", null, 1)];
	assert.deepEqual(hits.slice().sort(compareByDate("date_asc")).map((h) => h.id), ["d", "c", "e", "a", "f", "b"]);
	assert.deepEqual(hits.slice().sort(compareByDate("date_desc")).map((h) => h.id), ["a", "d", "c", "e", "f", "b"]);
});

test("orderDateWindow: stabil (Gleichstand behält die Relevanz-Reihenfolge), Seite ab localOffset", () => {
	const pool = [hit("x", "1900-01-01"), hit("y", "1899-12-31"), hit("z", "1900-01-01"), hit("w", "1900-01-01")];
	const window: DateWindow = { clause: null, fetch: 4, localOffset: 1 };
	assert.deepEqual(orderDateWindow(pool, "date_asc", window, 2).map((h) => h.id), ["x", "z"]);
	assert.deepEqual(orderDateWindow(pool, "date_desc", { ...window, localOffset: 0 }, 10).map((h) => h.id), ["x", "z", "w", "y"]);
	assert.deepEqual(pool.map((h) => h.id), ["x", "y", "z", "w"]);
});

test("dateWindowSort: nur strikt, nach Datum und tiefer als DATE_WINDOW_MIN_DEPTH", () => {
	const deep = { q: "fisch", strict: true, offset: DATE_WINDOW_MIN_DEPTH, limit: 20 };
	// Seite 1 à 20 bleibt eine Abfrage, ab Seite 2 das Fenster.
	assert.equal(dateWindowSort({ ...deep, sort: "date_asc", offset: 0 }), null);
	assert.equal(dateWindowSort({ ...deep, sort: "date_asc", offset: 20 }), "date_asc");
	assert.equal(dateWindowSort({ ...deep, sort: "date_asc" }), "date_asc");
	assert.equal(dateWindowSort({ ...deep, sort: "date_desc" }), "date_desc");
	assert.equal(dateWindowSort({ ...deep, sort: "relevance" }), null);
	// Weich (matchingStrategy last) gibt es Teiltreffer-Buckets vor dem Datum.
	assert.equal(dateWindowSort({ ...deep, sort: "date_asc", strict: false }), null);
	// Die ersten Seiten: eine Abfrage – die Tiefe zählt bis zum letzten Treffer der Seite.
	assert.equal(dateWindowSort({ ...deep, sort: "date_asc", offset: DATE_WINDOW_MIN_DEPTH - 20 }), null);
	assert.equal(dateWindowSort({ ...deep, sort: "date_asc", offset: DATE_WINDOW_MIN_DEPTH - 19 }), "date_asc");
	// Ein grosses Fenster ab Treffer 1 (Export, MCP mit offset) ist ebenso tief.
	assert.equal(dateWindowSort({ ...deep, sort: "date_desc", offset: 0, limit: 100_000 }), "date_desc");
});

test("dateWindowSort: ohne Suchbegriff erst ab DATE_WINDOW_MIN_DEPTH_NO_QUERY", () => {
	const page = (offset: number, over: Partial<Parameters<typeof dateWindowSort>[0]> = {}) =>
		dateWindowSort({ sort: "date_asc", q: "  ", strict: true, offset, limit: 20, ...over });
	assert.ok(DATE_WINDOW_MIN_DEPTH_NO_QUERY > DATE_WINDOW_MIN_DEPTH);
	assert.equal(page(DATE_WINDOW_MIN_DEPTH), null);
	assert.equal(page(DATE_WINDOW_MIN_DEPTH_NO_QUERY - 20), null);
	assert.equal(page(DATE_WINDOW_MIN_DEPTH_NO_QUERY - 19), "date_asc");
	// Letzte Seiten des ganzen Korpus, beide Richtungen; die höchste Seite aus der Adresse.
	assert.equal(page(697_520), "date_asc");
	assert.equal(page(697_520, { sort: "date_desc" }), "date_desc");
	assert.equal(page(99_999_900, { limit: 100 }), "date_asc");
	// Nach Relevanz und weich (öffentliche API) nie.
	assert.equal(page(697_520, { sort: "relevance" }), null);
	assert.equal(page(697_520, { strict: false }), null);
});

// Meili-Attrappe: `docs` in Relevanz-Reihenfolge; eine Abfrage liefert die Treffer,
// die die Klausel des Fensters erfüllen (Reihenfolge erhalten), mit Trefferzahl und
// Facetten. Kennt genau die Klauseln, die planDateWindow schreibt.
interface Doc {
	id: string;
	date: string | null;
	dateYear: number | null;
	startPg: number | null;
	series: string;
}
const doc = (id: string, date: string | null, startPg: number | null = null, dateYear: number | null = date ? Number(date.slice(0, 4)) : null) =>
	({ id, date, dateYear, startPg, series: Number(id.slice(1)) % 2 ? "KRP" : "RRB" }) as Doc;

function matchesClause(clause: string | null, d: Doc): boolean {
	if (clause === null) return true;
	if (clause === "date IS NOT NULL") return d.date !== null;
	if (clause === "date IS NULL") return d.date === null;
	const m = clause.match(/dateYear (?:= (\d+)|>= (\d+) AND dateYear <= (\d+))/);
	if (!m) throw new Error(`unbekannte Klausel: ${clause}`);
	const lo = Number(m[1] ?? m[2]);
	const hi = Number(m[1] ?? m[3]);
	const inRange = d.dateYear !== null && d.dateYear >= lo && d.dateYear <= hi;
	if (clause.startsWith("(date IS NULL OR")) return d.date === null || inRange;
	if (clause.startsWith("(date IS NOT NULL AND")) return d.date !== null && inRange;
	throw new Error(`unbekannte Klausel: ${clause}`);
}

function fakeMeili(docs: Doc[]) {
	const calls: { query: DateWindowQuery[]; format: string[][] } = { query: [], format: [] };
	type Hit = Partial<Doc> & { id: string; _formatted?: { title: string } };
	type Facets = Record<string, Record<string, number>>;
	const deps = {
		query: async (q: DateWindowQuery): Promise<DateWindowRaw<Hit, Facets>> => {
			calls.query.push(q);
			const matched = docs.filter((d) => matchesClause(q.clause, d));
			const facetDistribution: Facets = {};
			for (const f of q.facets) {
				const dist: Record<string, number> = {};
				for (const d of matched) {
					const v = d[f as keyof Doc];
					if (v !== null) dist[String(v)] = (dist[String(v)] ?? 0) + 1;
				}
				facetDistribution[f] = dist;
			}
			const project = (d: Doc): Hit =>
				q.retrieve ? (Object.fromEntries(q.retrieve.map((k) => [k, d[k as keyof Doc]])) as unknown as Hit) : { ...d };
			return {
				hits: matched.slice(0, q.limit).map(project),
				estimatedTotalHits: matched.length,
				processingTimeMs: 1,
				facetDistribution,
			};
		},
		// Formatiert, Reihenfolge verdreht (die Seite ordnet selbst).
		format: async (ids: string[]): Promise<DateWindowRaw<Hit, Facets>> => {
			calls.format.push(ids);
			const hits = docs.filter((d) => ids.includes(d.id)).map((d) => ({ ...d, _formatted: { title: `<mark>${d.id}</mark>` } }));
			return { hits: hits.reverse(), processingTimeMs: 1 };
		},
	};
	return { deps, calls };
}

// Relevanz-Reihenfolge mit Gleichständen (gleiches Datum, gleiche bzw. fehlende Seite)
// und undatierten Treffern mit bekanntem Jahr (Ratsmanuale).
const DOCS: Doc[] = [
	doc("d01", "1902-03-01"), doc("d02", "1900-01-01", 2), doc("d03", null, 5, 1777), doc("d04", "1901-06-01"),
	doc("d05", "1900-01-01", 1), doc("d06", "1902-03-01"), doc("d07", "1900-07-07"), doc("d08", null, null, 1750),
	doc("d09", "1903-01-01"), doc("d10", "1901-06-01", 4), doc("d11", "1900-01-01"), doc("d12", "1902-12-31"),
	doc("d13", "1900-01-01"), doc("d14", "1901-06-01", 4), doc("d15", null, 2, 1777), doc("d16", "1903-01-01", 9),
];

test("searchByDateWindow: Blättern ergibt alle Treffer in Meilis Datumsfolge, Gleichstände nach Relevanz", async () => {
	for (const sort of ["date_asc", "date_desc"] as const) {
		const expected = DOCS.slice().sort(compareByDate(sort)).map((d) => d.id);
		for (const pageSize of [1, 2, 3, 5, 7, 16, 20]) {
			const seen: string[] = [];
			for (let offset = 0; offset < DOCS.length; offset += pageSize) {
				const { deps } = fakeMeili(DOCS);
				const res = await searchByDateWindow(deps, { sort, offset, limit: pageSize, facets: ["series", "dateYear"], lean: false });
				assert.equal(res.total, DOCS.length);
				assert.equal(res.fallback, undefined);
				assert.ok(res.hits.every((h) => h._formatted), "Seite formatiert");
				seen.push(...res.hits.map((h) => h.id));
			}
			assert.deepEqual(seen, expected, `${sort}, Seiten à ${pageSize}`);
		}
	}
});

test("searchByDateWindow: Abfragen – Zähler parallel, Fenster nur mit Sortierfeldern, Seite formatiert", async () => {
	const { deps, calls } = fakeMeili(DOCS);
	// asc: 1900 = Positionen 0–4, 1901 = 5–7 (alle am 1. Juni: Seite 4, 4, ohne).
	const res = await searchByDateWindow(deps, { sort: "date_asc", offset: 5, limit: 3, facets: ["series", "dateYear"], lean: false });
	assert.deepEqual(res.hits.map((h) => h.id), ["d10", "d14", "d04"]);
	assert.deepEqual(
		calls.query.map((q) => [q.clause, q.limit, q.facets.join(",")]),
		[
			[null, 0, "series,dateYear"],
			["date IS NOT NULL", 0, "dateYear"],
			["(date IS NOT NULL AND dateYear = 1901)", 3, ""],
		],
	);
	assert.deepEqual(calls.query[2].retrieve, DATE_WINDOW_SORT_FIELDS);
	assert.deepEqual(calls.format, [["d10", "d14", "d04"]]);
	// Facetten aller Treffer für die Filterspalte.
	assert.equal(res.facetDistribution?.dateYear?.["1777"], 2);
	assert.equal(Object.values(res.facetDistribution?.series ?? {}).reduce((a, b) => a + b, 0), DOCS.length);
});

test("searchByDateWindow: lean (Export) – Treffer des Fensters mit Projektion, ohne Formatierung", async () => {
	const { deps, calls } = fakeMeili(DOCS);
	const res = await searchByDateWindow(deps, { sort: "date_desc", offset: 0, limit: 100_000, facets: [], lean: true, retrieve: ["id", "series"] });
	assert.deepEqual(res.hits.map((h) => h.id), DOCS.slice().sort(compareByDate("date_desc")).map((d) => d.id));
	assert.deepEqual(calls.format, []);
	assert.deepEqual(calls.query[0].facets, []);
	assert.deepEqual(calls.query[2].retrieve, ["id", "series", "date", "startPg"]);
	assert.ok(res.hits.every((h) => h.series && !("dateYear" in h)));
	// Ohne Projektion alle Felder.
	const all = await searchByDateWindow(fakeMeili(DOCS).deps, { sort: "date_asc", offset: 0, limit: 5, facets: [], lean: true });
	assert.ok(all.hits.every((h) => "dateYear" in h));
});

test("searchByDateWindow: Seite hinter dem Ende ⇒ leer, ohne Fenster-Abfrage", async () => {
	const { deps, calls } = fakeMeili(DOCS);
	const res = await searchByDateWindow(deps, { sort: "date_asc", offset: DOCS.length, limit: 20, facets: [], lean: false });
	assert.deepEqual(res.hits, []);
	assert.equal(res.total, DOCS.length);
	assert.equal(calls.query.length, 2);
	assert.deepEqual(calls.format, []);
});

test("searchByDateWindow: datierter Treffer ohne Jahr ⇒ alle Treffer geholt, Reihenfolge stimmt trotzdem", async () => {
	const docs = [...DOCS, doc("d17", "1899-05-05", null, null)];
	const { deps, calls } = fakeMeili(docs);
	const res = await searchByDateWindow(deps, { sort: "date_asc", offset: 0, limit: 3, facets: [], lean: false });
	assert.equal(res.fallback, true);
	assert.deepEqual(res.hits.map((h) => h.id), ["d17", "d05", "d02"]);
	assert.deepEqual([calls.query[2].clause, calls.query[2].limit], [null, docs.length]);
});

test("searchByDateWindow: Jahres-Facette passt nicht, Treffermenge zu gross ⇒ Meilis Sortierung statt aller Treffer", async () => {
	const total = DATE_WINDOW_FALLBACK_MAX + 1;
	const run = async (withDirect: boolean) => {
		const queries: DateWindowQuery[] = [];
		let direct = 0;
		const deps = {
			// Ein datierter Treffer ohne Jahr: Die Facette zählt einen weniger.
			query: async (q: DateWindowQuery): Promise<DateWindowRaw<Doc>> => {
				queries.push(q);
				return { hits: [], estimatedTotalHits: total, processingTimeMs: 1, facetDistribution: { dateYear: { "1900": total - 1 } } };
			},
			format: async (): Promise<DateWindowRaw<Doc>> => ({ hits: [] }),
			...(withDirect
				? {
						direct: async (): Promise<DateWindowRaw<Doc>> => {
							direct++;
							return { hits: [doc("d1", "1900-01-01")], processingTimeMs: 5 };
						},
					}
				: {}),
		};
		const res = await searchByDateWindow<Doc>(deps, { sort: "date_asc", offset: 30_000, limit: 20, facets: ["dateYear"], lean: false });
		return { res, queries, direct };
	};
	const a = await run(true);
	assert.equal(a.direct, 1);
	assert.equal(a.queries.length, 2); // nur die Zählungen, nie die ganze Treffermenge
	assert.deepEqual(a.res.hits.map((h) => h.id), ["d1"]);
	assert.deepEqual([a.res.total, a.res.fallback, a.res.processingTimeMs], [total, true, 6]);
	assert.deepEqual(a.res.facetDistribution, { dateYear: { "1900": total - 1 } });
	// Ohne eigene Sortierung (ODER-Föderation) bleibt der Notbehelf.
	const b = await run(false);
	assert.deepEqual(b.queries.map((q) => q.limit), [0, 0, total]);
});

test("searchByDateWindow: fehlt ein Treffer beim Formatieren, wird die Seite kürzer", async () => {
	const { deps } = fakeMeili(DOCS);
	const format = deps.format;
	deps.format = async (ids) => {
		const res = await format(ids);
		return { ...res, hits: res.hits.filter((h) => h.id !== "d10") };
	};
	const res = await searchByDateWindow(deps, { sort: "date_asc", offset: 5, limit: 3, facets: [], lean: false });
	assert.deepEqual(res.hits.map((h) => h.id), ["d14", "d04"]);
});
