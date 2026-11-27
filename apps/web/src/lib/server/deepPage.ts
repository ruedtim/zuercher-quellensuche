// Tiefe Seiten zweistufig (pur, unit-getestet in deepPage.test.ts): erst die Treffer
// der Seite ohne Felder und Formatierung (nur IDs), dann nur diese Seite formatiert
// (`id IN […]`). Genutzt von der Dokumentsuche (searchDocuments, auch Thema und
// Nachbar-Navigation, und ODER nach Relevanz in searchDocumentsUnion; meili.ts) und den
// Reitern «Archivkatalog» (catalog.ts), «Ehedaten» (ehedaten.ts) und «Editionen» (editionTexts.ts).
//
// Meili v1.56 «macht» jeden Treffer bis offset + limit, nicht nur die der Seite: Felder
// holen, Hervorhebung und Auszug rechnen (`make_hit` in federated/perform.rs – seit v1.47
// läuft auch die Einzelsuche intern als Föderation). Weder searchCutoffMs noch ein Abbruch
// des Clients beendet das. documents-Kopie (Mac, warm, 2026-10-31): «Gemeinde» nach
// Relevanz, Offset 10'000 4,6 s statt 21 ms in v1.13, zweistufig 0,12 s; Offset 100'000
// 66 s. Die Föderation (ODER) tut das in jeder Version, auch in v1.13 (perform.rs, Schleife
// bis `required_hit_count`): «fisch ODER see», Offset 10'000, v1.13 3,6 s, zweistufig 0,14 s.
// docs/architektur-erkundung.md 3.6 und 3.7.
//
// Darum ab DEEP_PAGE_MIN_OFFSET zwei Abfragen: dieselbe Suche mit Fenster, Facetten,
// Sortierung und Score, aber nur `id` und ohne Formatierung (idsOnly); dann die Treffer
// der Seite mit Feldern und Formatierung der ursprünglichen Abfrage (pageOnly bzw. die
// Föderation über `id IN […]`), in der Reihenfolge der ersten. Hervorhebung und Auszug
// hängen nur an Dokument und Suchbegriff, nicht am Filter; bei der Föderation formatiert
// jeden Treffer wie in einer Abfrage der Zweig, der ihn liefert (Gleichstand: der frühere
// Zweig, unabhängig von den übrigen Treffern). Score und Föderations-Angaben übernimmt
// inPageOrder trotzdem aus der ersten Abfrage – die zweite reiht nur die Seite.

/**
 * Ab dieser Position (offset) holt eine Seite zuerst nur die IDs: Die Seiten 1 und 2 à 20 und
 * Seite 1 à 100 bleiben eine Abfrage. Gemessen auf Meili-Ebene (Kopien des Dev-Index, Mac,
 * warm, 2026-10-31): In v1.13 kostet die zweite Abfrage im Median 3–5 ms, höchstens 13 ms; in
 * v1.56 kostet eine Abfrage je Treffer vor der Seite ~0,4–1,5 ms (documents) bzw. ~0,03 ms
 * (Katalog, Ehedaten) – Gleichstand bei Offset 20–40 bzw. 80–150. Ab 40 gewinnt zweistufig in
 * v1.56 bei documents (Offset 80: 24–41 statt 48–135 ms) und verliert bei den Reitern höchstens
 * 3 ms; ODER auf documents gewinnt schon in v1.13 (Offset 80: 28 statt 50 ms).
 */
export const DEEP_PAGE_MIN_OFFSET = 40;

/** Meilis Optionen für Hervorhebung und Auszug. */
const FORMAT_KEYS = new Set([
	"attributesToHighlight",
	"attributesToCrop",
	"cropLength",
	"cropMarker",
	"highlightPreTag",
	"highlightPostTag",
	"showMatchesPosition",
]);

/** Was Treffer über die IDs hinaus anreichert (Stufe 1 lässt es weg). */
const ENRICH_KEYS = new Set([...FORMAT_KEYS, "attributesToRetrieve", "retrieveVectors"]);

/** Fenster, Facetten und Sortierung: bestimmen die Treffer der Seite, nicht ihr Aussehen. */
const PAGE_KEYS = new Set(["offset", "limit", "page", "hitsPerPage", "facets", "sort", "filter"]);

/** Reihungs-Angaben eines Treffers: Score, Score-Details, bei der Föderation Zweig und gewichteter Score. */
const RANK_KEYS = ["_rankingScore", "_rankingScoreDetails", "_federation"] as const;

export type PageId = string | number;

/** Treffer mit ID (Meili-Antworten, beliebig viele weitere Felder). */
export interface IdentifiedHit {
	id: PageId;
}

/** Antwort einer Abfrage: Treffer, Dauer und was Meili sonst liefert (Zähler, Facetten). */
export interface PageHits<H> {
	hits: H[];
	processingTimeMs?: number;
}

/** Zweistufig? Ab DEEP_PAGE_MIN_OFFSET und nur, wenn die Seite Treffer hat. */
export function isDeepPage(offset: number, limit: number): boolean {
	return limit > 0 && offset >= DEEP_PAGE_MIN_OFFSET;
}

/**
 * Formatieren in Gruppen: Hervorhebung und Auszug rechnet Meili über den ganzen Text, Treffer um
 * Treffer (0,2 ms je KB). Bei mehreren Wörtern stehen oft lange Protokolle vorn, dann war das fast
 * die ganze Suchzeit (Prod v1.57, 2026-11-24: «Frauen Universität Zulassung» 177 ms, davon 6 ms
 * Suche). In vier gleichzeitigen Abfragen 40–90 statt 110–200 ms (mehr bringen kaum noch etwas, jede
 * kostet 2–3 ms Rechenzeit), an den Treffern ändert es nichts.
 */
const FORMAT_GROUPS = 4;
/** Kleinere Gruppen lohnen die Abfrage nicht. */
const FORMAT_GROUP_MIN = 2;

/** Die Kennungen auf Gruppen verteilt, reihum (lange Texte liegen oft nebeneinander). */
export function formatGroups<T>(ids: readonly T[]): T[][] {
	const n = Math.max(1, Math.min(FORMAT_GROUPS, Math.ceil(ids.length / FORMAT_GROUP_MIN)));
	return Array.from({ length: n }, (_, g) => ids.filter((_, i) => i % n === g));
}

/** Die Treffer einer Seite formatiert, in Gruppen gleichzeitig, in beliebiger Reihenfolge. */
export async function formatInGroups<H>(ids: PageId[], run: (group: PageId[]) => Promise<PageHits<H>>): Promise<PageHits<H>> {
	if (ids.length === 0) return { hits: [], processingTimeMs: 0 };
	const parts = await Promise.all(formatGroups(ids).map(run));
	return {
		hits: parts.flatMap((p) => p.hits ?? []),
		processingTimeMs: Math.max(...parts.map((p) => p.processingTimeMs ?? 0)),
	};
}

/** Verlangt die Abfrage Hervorhebung oder Auszug? */
export function wantsFormat(body: Record<string, unknown>): boolean {
	return [body.attributesToHighlight, body.attributesToCrop].some((a) => Array.isArray(a) && a.length > 0);
}

/** Stufe 1: dieselbe Abfrage (Fenster, Filter, Facetten, Sortierung, Score), nur mit `id`. */
export function idsOnly(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) if (!ENRICH_KEYS.has(key)) out[key] = value;
	out.attributesToRetrieve = ["id"];
	return out;
}

/**
 * Stufe 2: die Treffer der Seite wie in der ursprünglichen Abfrage (Suchbegriff, Suchfelder,
 * Strategie, Felder, Formatierung, Score), ohne Fenster, Facetten und Sortierung; `filter`
 * grenzt auf die IDs ein. Auch mit Vektor (Thema): Die Suche über die wenigen IDs der Seite
 * kostet dort nichts (linearer Scan), Hervorhebung und Auszug sind dieselben.
 */
export function pageOnly(body: Record<string, unknown>, filter: string | string[], count: number): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) if (!PAGE_KEYS.has(key)) out[key] = value;
	return { ...out, filter, offset: 0, limit: count };
}

/**
 * Die formatierten Treffer in der Reihenfolge von Stufe 1, mit deren Reihungs-Angaben.
 * Fehlt ein Treffer (Index dazwischen geändert), lieber eine kürzere Seite als eine Zeile
 * ohne Titel und Text.
 */
export function inPageOrder<H extends IdentifiedHit, O extends IdentifiedHit>(order: readonly O[], formatted: readonly H[]): H[] {
	const byId = new Map(formatted.map((hit) => [hit.id, hit]));
	return order.flatMap((ranked) => {
		const hit = byId.get(ranked.id);
		if (!hit) return [];
		const out = { ...hit } as unknown as Record<string, unknown>;
		for (const key of RANK_KEYS) if (key in ranked) out[key] = (ranked as unknown as Record<string, unknown>)[key];
		return [out as unknown as H];
	});
}

/**
 * Eine tiefe Seite in zwei Abfragen: `ids` liefert Trefferzahl, Facetten und die Treffer der
 * Seite (nur IDs und Score), `format` diese Treffer mit Feldern und Formatierung in
 * beliebiger Reihenfolge. Das Ergebnis ist die Antwort von `ids` mit den formatierten
 * Treffern; die Dauer zählt beide Abfragen.
 */
export async function searchDeepPage<H extends IdentifiedHit, R extends PageHits<IdentifiedHit>>(deps: {
	ids: () => Promise<R>;
	format: (ids: PageId[]) => Promise<PageHits<H>>;
}): Promise<Omit<R, "hits"> & { hits: H[] }> {
	const first = await deps.ids();
	const order = first.hits ?? [];
	if (order.length === 0) return { ...first, hits: [] };
	const page = await deps.format(order.map((hit) => hit.id));
	return {
		...first,
		hits: inPageOrder(order, page.hits ?? []),
		processingTimeMs: (first.processingTimeMs ?? 0) + (page.processingTimeMs ?? 0),
	};
}
