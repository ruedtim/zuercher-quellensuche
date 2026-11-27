// Reine (env-freie) Bausteine der Such-Werkzeuge des MCP-Servers:
// Argument-Normalisierung, die searchDocuments-Argumente der Zähl-, Listen- und
// Ranking-Werkzeuge, Gegenproben-Hinweise bei 0 Treffern, Lücken-Vorbehalte der
// Zeitleiste, Katalog-Hilfen und die Parameter-Fragmente der Tool-Schemas.
// Bewusst ohne Meili-/Embed-Import (kein `$env`), damit per `npx tsx --test`
// direkt testbar (searchTools.test.ts). Den I/O-Teil macht mcp/tools.ts; bis
// 2026-11 nutzte auch der Recherche-Modus der Website diese Bausteine (Branch
// archiv/ki-antwort).

import {
	ALL_SERIES,
	CORPUS_YEAR_MIN,
	DEFAULT_SEARCH,
	MODERN_FIRST_YEAR,
	SERIES_LABEL,
	isLexicalOnlySeries,
	type FacetDistribution,
	type SearchParams,
	type SeriesAbbr,
} from "$lib/types";
import { parseQueryTokens } from "$lib/searchParams";
import { foldSharpS, sharpSPattern } from "$lib/sharpS";
import { CATALOG_LEVELS, CATALOG_YEAR_MAX, CATALOG_YEAR_MIN } from "$lib/catalog";

// --- Arg-Normalisierung ------------------------------------------------------

export function asString(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

/** Nur gültige Serien-Kürzel, dedupliziert. Ein einzelnes Kürzel als String
 *  («RRB» statt ["RRB"]) zählt mit – sonst liefe die Suche still ungefiltert. */
export function normalizeSeries(v: unknown): SeriesAbbr[] {
	const list = typeof v === "string" ? v.split(/[\s,]+/) : Array.isArray(v) ? v : [];
	const out: SeriesAbbr[] = [];
	for (const s of list) {
		if (typeof s === "string" && (ALL_SERIES as string[]).includes(s) && !out.includes(s as SeriesAbbr)) {
			out.push(s as SeriesAbbr);
		}
	}
	return out;
}

/** Zahl aus einem Werkzeug-Argument: Zahl oder Ziffern-String («1900»). */
function numberArg(v: unknown): number | null {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && /^\s*-?\d+\s*$/.test(v)) return Number(v);
	return null;
}

/** Jahreszahl auf den Korpus-Bereich klemmen (wie clampInt in searchParams). */
export function clampYear(v: unknown): number | null {
	const n = numberArg(v);
	if (n == null) return null;
	return Math.min(2100, Math.max(CORPUS_YEAR_MIN, Math.floor(n)));
}

/** true, wenn eine Suche nur Serien ohne Vektoren und Passagen erreicht (die
 *  Ratsmanuale, s. LEXICAL_ONLY_SERIES): ausdrücklich nur solche Serien oder ein
 *  Zeitraum, der vor 1803 endet (davor gibt es nur RM). Dann taugen weder der
 *  Passagen-Index (chunks) noch ein Thema-Vektor – gesucht wird per Stichwort im
 *  Dokument-Index. Pure → unit-testbar. */
export function isLexicalOnlyScope(series: readonly string[], dateTo: number | null): boolean {
	if (series.length > 0) return series.every((s) => isLexicalOnlySeries(s));
	return dateTo != null && dateTo < MODERN_FIRST_YEAR;
}

/** topK in [1, max]; ungültig → fallback. */
export function clampTopK(v: unknown, fallback = 6, max = 25): number {
	const n = numberArg(v);
	if (n == null) return fallback;
	return Math.min(max, Math.max(1, Math.floor(n)));
}

export function normalizeSort(v: unknown): "relevance" | "date_asc" | "date_desc" {
	return v === "date_asc" || v === "date_desc" ? v : "relevance";
}

// Obergrenze des Titel-Überblicks (list_documents): viele Titel sind günstig
// (keine Bodies), aber ~60 Zeilen genügen, um Themencluster und Spannweite zu
// erkennen. Default 40.
export const LIST_MAX = 60;

/** list-limit in [1, max]; ungültig → fallback. */
export function clampListLimit(v: unknown, fallback = 40, max = LIST_MAX): number {
	const n = numberArg(v);
	if (n == null) return fallback;
	return Math.min(max, Math.max(1, Math.floor(n)));
}

/** Die Anfrage als Meili-Phrase in Anführungszeichen setzen (exakte,
 *  aufeinanderfolgende Wörter). Für Zähl-/Listen-/Zeitleisten-Tools bei
 *  mehrwortigen Eigennamen: ohne Phrase genügen die Namensteile irgendwo im
 *  Dokument, auch in ähnlicher Form (Tippfehler-Toleranz, Wortanfänge).
 *  Auch EIN Wort wird gewrappt: In Meili schaltet ein Zitat zusätzlich die
 *  Tippfehler-Toleranz und die Wortanfang-Erweiterung ab, `phrase=true` heisst
 *  bei einem Wort also «genau dieses Wort». Bis 2026-11 übersprang der Wrap
 *  einwortige Anfragen («Phrase = Wortfolge, bei einem Wort sinnlos») und war
 *  dort ein stiller No-op – Prod 2026-11-17 vor #259: «Pause» 8'066 Dokumente,
 *  «"Pause"» 841 (die übrigen über Tippfehler-Toleranz «Pässe»/«Pässen» und den
 *  Wortanfang «Pausen»; seit der Schwelle 7 nur noch über den Wortanfang, 3'017). Nur wenn `phrase` und noch keine Anführungszeichen enthalten sind;
 *  sonst unverändert (Meili parst `"` selbst). Pure → unit-testbar. */
export function phraseWrap(query: string, phrase: boolean): string {
	const q = query.trim();
	if (!phrase || !q || q.includes('"')) return q;
	return `"${q}"`;
}

// Nur Tokens mit Buchstabe oder Zahl werden zitiert – «-» oder Satzzeichen
// allein ergäben eine leere Phrase.
const WORD_TOKEN_RE = /[\p{L}\p{N}]/u;

/** JEDES Wort der Anfrage einzeln in Anführungszeichen – exakt OHNE
 *  Nachbarschaftszwang (anders als phraseWrap): Ein Zitat schaltet in Meili die
 *  Tippfehler-Toleranz (typoTolerance, im documents-Index seit #259 ab 7 Zeichen ein
 *  Edit; bis dahin ab 5 ⇒ «Pause» traf «Pässe») und die Wortanfang-Erweiterung des
 *  letzten Wortes («Pausen») ab, lässt Reihenfolge und Abstand aber frei. Prod
 *  2026-11-17: «Pause Schulhaus» 278 Dokumente vor #259, 105 danach, Wort für Wort
 *  zitiert 61. Bereits zitierte Teile, Ausschlüsse
 *  (`-wort`) und Tokens ohne Buchstabe/Zahl bleiben unangetastet. Unbalancierte
 *  Anführungszeichen (Tippfehler wie `pause "schul`) gelten wie in
 *  exclusionsFirst als solche: dann wird nichts umgestellt – Meili liest eine
 *  offene Phrase bis zum String-Ende, unsere Tokenisierung weicht dort ab.
 *  Pure → unit-testbar. */
export function exactWrap(query: string, exact: boolean): string {
	const q = query.trim();
	if (!exact || !q) return q;
	if (((q.match(/"/g) ?? []).length & 1) === 1) return q;
	const tokens = parseQueryTokens(q);
	if (tokens.length === 0) return q;
	return tokens.map((t) => (t.phrase || t.exclude || !WORD_TOKEN_RE.test(t.text) ? t.raw : `"${t.text}"`)).join(" ");
}

/** Die an Meili gehende Query eines lexikalischen Werkzeugs: `phrase` gewinnt
 *  (die ganze Anfrage als eine Wortfolge), sonst zitiert `exact` jedes Wort
 *  einzeln. Beides gesetzt ⇒ `exact` wird ignoriert; die Phrase ist die
 *  strengere Form und macht das Wort-für-Wort-Zitat gegenstandslos.
 *  Pure → unit-testbar. */
export function lexicalQuery(query: string, phrase: boolean, exact: boolean): string {
	return phrase ? phraseWrap(query, true) : exactWrap(query, exact);
}

// --- Aggregat-Abfragen (count_documents, timeline, list_documents, overview) --

/** Suchbegriff, Filter und Projektion einer Aggregat-Abfrage. */
export interface AggregateQuery {
	q: string;
	series: SeriesAbbr[];
	dateFrom: number | null;
	dateTo: number | null;
	sort?: SearchParams["sort"];
	// Zählung und Zeitleiste brauchen nur Trefferzahl und Facetten (1 Treffer).
	pageSize?: number;
	attributesToRetrieve?: string[];
	attributesToSearchOn?: string[];
}

/** Die searchDocuments-Optionen einer Aggregat-Abfrage. */
export interface AggregateSearchOpts {
	vector: null;
	strict: true;
	attributesToRetrieve?: string[];
	attributesToSearchOn?: string[];
}

/** searchDocuments-Argumente der Aggregat-Tools: rein lexikalisch und strikt –
 *  ALLE Wörter der Anfrage müssen vorkommen, in beliebiger Reihenfolge (`strict`
 *  ⇒ Meili matchingStrategy "all"). Diese Tools zählen bzw. listen die ganze
 *  Treffermenge; mit Meilis Default "last" zählten auch Dokumente mit, die nur die
 *  vorderen Wörter enthalten (Prod 2026-10-30: «Zivilschutzanlagen Rämibühl» 335
 *  statt 6 Dokumente, «Bunker Rämibühl» 586 ab 1484 statt 8 ab 1962).
 *  keyword_search ist ebenso strikt (rankingSearch), nur semantic_search bleibt
 *  weich. Pure → unit-testbar. */
export function aggregateSearch(a: AggregateQuery): [SearchParams, AggregateSearchOpts] {
	return [
		{
			...DEFAULT_SEARCH,
			q: a.q,
			semanticRatio: 0,
			sort: a.sort ?? "relevance",
			page: 1,
			pageSize: a.pageSize ?? 1,
			series: a.series,
			dateFrom: a.dateFrom,
			dateTo: a.dateTo,
		},
		{
			vector: null,
			strict: true,
			attributesToRetrieve: a.attributesToRetrieve,
			attributesToSearchOn: a.attributesToSearchOn,
		},
	];
}

/** Die Suche hinter den Aggregaten: searchDocuments, im Test eine Attrappe. */
export type AggregateSearchFn = (
	params: SearchParams,
	opts: AggregateSearchOpts,
) => Promise<{ estimatedTotalHits: number; facetDistribution?: FacetDistribution }>;

/** Anzahl Dokumente samt Serien-Verteilung (count_documents, Gegenproben). */
export async function countAggregate(
	search: AggregateSearchFn,
	a: AggregateQuery,
): Promise<{ total: number; bySeries: Record<string, number> }> {
	const res = await search(...aggregateSearch({ ...a, attributesToRetrieve: ["id"] }));
	return { total: res.estimatedTotalHits, bySeries: res.facetDistribution?.series ?? {} };
}

/** Jahresverteilung (timeline): jeder Begriff (query + alternatives) ist eine
 *  eigene strikte Suche, die Verteilungen werden aufsummiert. Ohne Begriff die
 *  Verteilung der Filter-Menge. */
export async function aggregateYearDist(
	search: AggregateSearchFn,
	terms: string[],
	a: Omit<AggregateQuery, "q">,
): Promise<Record<string, number>> {
	const dists = await Promise.all(
		(terms.length > 0 ? terms : [""]).map(async (q) => {
			const res = await search(...aggregateSearch({ ...a, q, attributesToRetrieve: ["id"] }));
			return res.facetDistribution?.dateYear ?? {};
		}),
	);
	const dist: Record<string, number> = {};
	for (const d of dists) for (const [y, c] of Object.entries(d)) dist[y] = (dist[y] ?? 0) + c;
	return dist;
}

/** Die positiven Suchwörter einer Anfrage (Phrasen als Ganzes, ohne
 *  Ausschlüsse), dedupliziert und gekappt – für die Gegenprobe «jedes Wort
 *  einzeln», wenn eine Aggregat-Abfrage leer bleibt. */
export function queryWords(q: string, max = 5): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const t of parseQueryTokens(q)) {
		const text = t.text.trim();
		if (t.exclude || !text || seen.has(text.toLowerCase())) continue;
		seen.add(text.toLowerCase());
		out.push(t.phrase ? `"${text}"` : text);
	}
	return out.slice(0, max);
}

// --- Ranking-Suchen (semantic_search, keyword_search) -------------------------

/** Suchbegriff, Filter und Fenster einer Ranking-Suche im Dokument-Index. */
export interface RankingQuery {
	kind: "semantic" | "keyword";
	q: string;
	// Query-Vektor der semantischen Suche; null = rein lexikalisch.
	vector: number[] | null;
	series: SeriesAbbr[];
	dateFrom: number | null;
	dateTo: number | null;
	sort: SearchParams["sort"];
	pageSize: number;
	attributesToSearchOn?: string[];
}

/** Die searchDocuments-Optionen einer Ranking-Suche. */
export interface RankingSearchOpts {
	vector: number[] | null;
	strict: boolean;
	attributesToSearchOn?: string[];
}

/** searchDocuments-Argumente von semantic_search und keyword_search im
 *  Dokument-Index. keyword_search verlangt wie die Aggregat-Tools ALLE Wörter
 *  (strict): Mit Meilis Default "last" füllten Dokumente mit nur den vorderen
 *  Wörtern die Liste auf, sobald zu wenige alle enthielten – als gewöhnliche
 *  Treffer, und das MCP-total zählte sie mit (Prod 2026-10-30: «Velowege
 *  Rämibühl» hat kein Dokument mit beiden Wörtern, «last» lieferte 347 mit
 *  «Velowege»). semantic_search rankt nach Bedeutung (Hybrid 0.7) und bleibt
 *  weich, ohne Vektor (Ratsmanuale, embed nicht erreichbar) als weiche
 *  Stichwortsuche. Pure → unit-testbar. */
export function rankingSearch(a: RankingQuery): [SearchParams, RankingSearchOpts] {
	return [
		{
			...DEFAULT_SEARCH,
			q: a.q,
			semanticRatio: a.vector ? 0.7 : 0,
			sort: a.sort,
			page: 1,
			pageSize: a.pageSize,
			series: a.series,
			dateFrom: a.dateFrom,
			dateTo: a.dateTo,
		},
		{
			vector: a.vector,
			strict: a.kind === "keyword",
			attributesToSearchOn: a.attributesToSearchOn,
		},
	];
}

// Spiegelt apiV1 WINDOW_MAX (offset + limit ≤ 1000): obere Blätter-Grenze, damit
// tiefe Offsets Meili nicht überlasten. Bewusst hier dupliziert, damit das Modul
// $env-/SvelteKit-frei und per `npx tsx --test` prüfbar bleibt.
export const PAGE_WINDOW_MAX = 1000;

/** Paginierungs-Offset auf [0, PAGE_WINDOW_MAX-1] klemmen; ungültig → 0. */
export function clampOffset(v: unknown): number {
	const n = numberArg(v);
	if (n == null) return 0;
	return Math.min(PAGE_WINDOW_MAX - 1, Math.max(0, Math.floor(n)));
}

// Blätter-Fenster der Passagen-Suche (offset + topK), bewusst enger als
// PAGE_WINDOW_MAX: Jede Seite sucht das ganze Fenster neu, und der Chunk-Pool
// wächst mit (acht Chunks je Passage, retrievePassages). 60 Passagen sind sieben
// Seiten mit dem Default-topK und genug für eine Recherche; tiefer gräbt man mit keyword_search/list_documents
// (dort bis PAGE_WINDOW_MAX).
export const PASSAGE_WINDOW_MAX = 60;

/** Offset der Passagen-Suche, so geklemmt, dass offset + topK ≤
 *  PASSAGE_WINDOW_MAX bleibt (ein grösserer Wunsch liefert die letzte mögliche
 *  Seite, das Werkzeug sagt es im Ergebnis). Pure → unit-testbar. */
export function clampPassageOffset(v: unknown, topK: number): number {
	return Math.min(clampOffset(v), Math.max(0, PASSAGE_WINDOW_MAX - topK));
}

/** Höchstlänge des Volltexts in `fetch`/`fetch_many` (Zeichen). Der Suchtext eines Dokuments
 *  darf seit 2026-11-17 bis 1 MiB lang sein (Indexer MAX_BODY_BYTES, vorher 100 KB) – zehn
 *  solche Dokumente in fetch_many wären für das Kontextfenster eines Assistenten zu viel. */
export const FETCH_TEXT_MAX = 100_000;

/** Text für fetch, gekürzt an einer Wortgrenze; `truncated` = ursprüngliche Länge. */
export function fetchText(body: string): { text: string; truncated: number | null } {
	if (body.length <= FETCH_TEXT_MAX) return { text: body, truncated: null };
	const cut = body.slice(0, FETCH_TEXT_MAX);
	const space = cut.lastIndexOf(" ");
	return { text: `${space > FETCH_TEXT_MAX * 0.9 ? cut.slice(0, space) : cut} …`, truncated: body.length };
}

/** field='title' → Meili `attributesToSearchOn` mit den Titelfeldern (nur den Titel
 *  durchsuchen; ab dem Suchtext-Stand des Index auch `titleSearch`, der Titel mit ss statt
 *  ß – der Aufrufer reicht docTitleFields() aus meili.ts); alles andere (inkl.
 *  'fulltext'/fehlend) → undefined = Default (Titel + Body). Pure → unit-testbar. */
export function fieldAttrs(v: unknown, titleFields: readonly string[] = ["title"]): string[] | undefined {
	return v === "title" ? [...titleFields] : undefined;
}

/** Bis zu `max` getrimmte, nicht-leere, deduplizierte Begriffe (query + Synonyme). */
export function normalizeTerms(query: string, alternatives: unknown, max = 8): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (s: unknown) => {
		if (typeof s !== "string") return;
		const t = s.trim();
		const key = t.toLowerCase();
		if (!t || seen.has(key) || out.length >= max) return;
		seen.add(key);
		out.push(t);
	};
	push(query);
	if (Array.isArray(alternatives)) for (const a of alternatives) push(a);
	return out;
}

/** Mehrere Ergebnislisten (z. B. je Synonym) fair zusammenführen: Round-Robin,
 *  dedupliziert über die docId, gekappt auf `cap`. So kommt jeder Begriff zum
 *  Zug statt dass der erste alle Slots füllt. Pure → unit-testbar. */
export function mergeRoundRobin<T extends { hit: { id: string } }>(lists: T[][], cap: number): T[] {
	const out: T[] = [];
	const seen = new Set<string>();
	const maxLen = lists.reduce((m, l) => Math.max(m, l.length), 0);
	for (let i = 0; i < maxLen && out.length < cap; i++) {
		for (const list of lists) {
			if (out.length >= cap) break;
			const item = list[i];
			if (!item || seen.has(item.hit.id)) continue;
			seen.add(item.hit.id);
			out.push(item);
		}
	}
	return out;
}

/** Eine Seite der gemischten Liste (Paginierung mit `alternatives`): zuerst das
 *  ganze Fenster `offset + limit` mischen, dann die ersten `offset` abschneiden.
 *  Die Reihenfolge von mergeRoundRobin hängt nur an den Listen, nicht am Cap –
 *  ein grösseres Fenster verlängert sie bloss. Darum ist diese Seite genau die
 *  Fortsetzung: keine Doppelten, keine Lücke. Jede Teilliste muss das ganze
 *  Fenster enthalten (also selbst UNGEschnitten sein); würde jede Liste einzeln
 *  um offset gekürzt, fielen die durch die Dedup-Runde verdrängten Treffer
 *  zwischen zwei Seiten heraus. Pure → unit-testbar. */
export function mergeRoundRobinPage<T extends { hit: { id: string } }>(lists: T[][], offset: number, limit: number): T[] {
	const merged = mergeRoundRobin(lists, Math.max(0, offset) + limit);
	return offset > 0 ? merged.slice(offset) : merged;
}

// --- Archivkatalog (catalog_search) ------------------------------------------

/** Was die Katalog-Bausteine von einem Treffer brauchen (Teilmenge von
 *  CatalogUnitRaw in lib/server/catalog.ts, das $env zieht). */
export interface CatalogHitInput {
	id: number;
	signature: string;
	title: string;
	level: string;
	dateText: string;
	/** Jahre des Entstehungszeitraums (beide oder keines, services/catalog/src/dates.ts). */
	dateFrom?: number | null;
	dateTo?: number | null;
	bestand: string | null;
	path?: Array<{ id: number; label: string }>;
	hasDigitization: boolean;
	/** Digitalisat-Links; `fileCount` setzt der Aufbau nur bei mehr als zehn Dateien. */
	files?: unknown[];
	fileCount?: number;
	text?: string;
	/** Meili-Crop des Textes (ohne Hervorhebung). */
	_formatted?: { text?: string };
}

/** Jahr für den Katalog: anders als clampYear auch vor 1483 (Urkunden ab dem 9. Jh.). */
export function clampCatalogYear(v: unknown): number | null {
	const n = numberArg(v);
	if (n == null) return null;
	return Math.min(CATALOG_YEAR_MAX, Math.max(CATALOG_YEAR_MIN, Math.floor(n)));
}

/** Nur bekannte Stufen («Dossier», «Dokument» …); sonst kein Stufen-Filter
 *  (ein erfundener Wert ergäbe 0 Treffer). */
export function normalizeCatalogLevel(v: unknown): string | null {
	const s = asString(v).toLowerCase();
	return CATALOG_LEVELS.find((l) => l.toLowerCase() === s) ?? null;
}

// Signatur-Kürzel und Zahlen («C», «II», «PLAN», «12»): Als letztes Suchwort sucht
// Meili sie als Wortanfang – «C Rüti» stimmt, «C» allein träfe jedes Wort mit c
// (Prod 2026-10-30, Stufe Dokument bis 1799: 18'562 statt 15'419 Einheiten),
// «12» auch 120 und 1219.
const SIGNATURE_TOKEN_RE = /^(?:[A-ZÄÖÜ]{1,4}|\d+)$/;

/** Endet die Katalogsuche auf ein Signatur-Kürzel oder eine Zahl? Dann soll das
 *  letzte Wort ganz gelten (queryCatalog `exactLast`). Ausschlüsse («-wort») und
 *  Phrasen zählen nicht als letztes Wort. Pure → unit-testbar. */
export function catalogExactLast(query: string): boolean {
	const t = query.trim();
	if (t.endsWith('"')) return false;
	const words = t.split(/\s+/).filter((w) => w && !w.startsWith("-"));
	return SIGNATURE_TOKEN_RE.test(words[words.length - 1] ?? "");
}

// Kurze Wörter am Ende treffen als Wortanfang oft ganz andere Wörter («Pest» →
// «Pestalozzi», «Enge» → «Engelberg»); längere eher Zusammensetzungen und
// gebeugte Formen derselben Sache («Seuchen», «Eisenbahnbau»).
const SHORT_LAST_WORD_MAX = 5;

/** Hinweis, wenn das letzte Suchwort (höchstens fünf Buchstaben, ohne
 *  Anführungszeichen) die meisten gezeigten Einheiten nur als Wortanfang trifft –
 *  Meili sucht das letzte Wort als Wortanfang: «Pest» traf Pestalozzigesellschaft,
 *  Pestalozzianum und Ehedaten der Pestalozzi (E2E 2026-10-30). Gebeugte Formen
 *  («Pesten») zählen als ganzes Wort, ß und ss als gleich. "" sonst. Pure → unit-testbar. */
export function catalogPrefixNote(query: string, hits: ReadonlyArray<Pick<CatalogHitInput, "signature" | "title" | "text">>): string {
	const t = query.trim();
	if (!t || t.endsWith('"') || catalogExactLast(t)) return "";
	const words = t.split(/\s+/).filter((w) => w && !w.startsWith("-"));
	const last = words[words.length - 1] ?? "";
	if (!/^\p{L}+$/u.test(last) || [...foldSharpS(last)].length > SHORT_LAST_WORD_MAX) return "";
	const esc = sharpSPattern(last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const whole = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?:e|en|n|s|es|er|ern)?(?![\\p{L}\\p{N}])`, "iu");
	const prefix = new RegExp(`(?<![\\p{L}\\p{N}])(${esc}[\\p{L}\\p{N}]+)`, "iu");
	const misses = hits.filter((h) => !whole.test(`${h.signature} ${h.title} ${h.text ?? ""}`));
	if (misses.length < 3 || misses.length * 2 < hits.length) return "";
	const examples = [...new Set(misses.map((h) => prefix.exec(`${h.title} ${h.text ?? ""}`)?.[1]).filter((w): w is string => !!w))].slice(0, 2);
	return `Hinweis: ${misses.length} der ${hits.length} gezeigten Einheiten enthalten «${last}» nur als Wortanfang${
		examples.length > 0 ? ` (etwa ${examples.map((e) => `«${e}»`).join(", ")})` : ""
	} – das letzte Suchwort trifft auch längere Wörter. Gehören sie nicht zur Frage, suche «"${last}"»: In Anführungszeichen zählt nur das ganze Wort.`;
}

/** Text, den catalog_search mit `semantic` einbettet: die Suchwörter ohne die
 *  Meili-Operatoren – ein Ausschluss («-Pestalozzi») zöge die Suche nach Bedeutung
 *  sonst gerade zum ausgeschlossenen Wort, Anführungszeichen tragen keine Bedeutung.
 *  "" = nichts übrig. Pure → unit-testbar. */
export function semanticCatalogText(query: string): string {
	return query
		.split(/\s+/)
		.filter((w) => w && !w.startsWith("-"))
		.join(" ")
		.replace(/["„“”«»]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// --- Null-Treffer-Diagnose -----------------------------------------------------

/** Eine gelockerte Gegenprobe zu einer Suche ohne Treffer: was ohne die
 *  jeweilige Einschränkung herauskäme. */
export interface ZeroHitProbe {
	kind: "series" | "phrase" | "dates" | "filters" | "words";
	total: number;
	bySeries?: Record<string, number>;
	// kind "words": jedes Suchwort einzeln gezählt, mit denselben Filtern.
	words?: Array<{ word: string; total: number }>;
}

function bySeriesText(bySeries: Record<string, number> | undefined): string {
	const parts = Object.entries(bySeries ?? {})
		.filter(([, c]) => c > 0)
		.sort((a, b) => b[1] - a[1])
		.map(([s, c]) => `${SERIES_LABEL[s as SeriesAbbr] ?? s}: ${c}`);
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** Hinweis-Text, wenn eine Suche 0 Treffer lieferte: welche Einschränkung
 *  (Serie, Phrase, Zeitraum) die Treffer verhindert hat bzw. – bei den Tools, die
 *  alle Wörter verlangen – wie oft jedes Wort für sich vorkommt. Ohne solche
 *  Hinweise wiederholten Modelle die leere Suche oder schlossen vorschnell auf
 *  «gibt es nicht» (im früheren Recherche-Modus: #119 Serie KRP statt OS/ABl, #96
 *  phrase=true auf «Zivilschutzanlagen Rämibühl»). Leerer String = nichts zu
 *  melden. Pure → unit-testbar. */
export function zeroHitHint(probes: ZeroHitProbe[]): string {
	if (probes.length === 0) return "";
	// Findet die Suche ohne Phrase etwas, ist das der Rat – nicht Wörter weglassen.
	const phraseHelps = probes.some((p) => p.kind === "phrase" && p.total > 0);
	const lines: string[] = [];
	for (const p of probes) {
		if (p.kind === "filters") {
			lines.push(
				p.total > 0
					? `Die gesetzten Filter (Serie/Zeitraum) umfassen ${p.total} Dokumente – formuliere die Suche anders (Synonyme, ältere Schreibweisen, keyword_search).`
					: "Für diese Filter-Kombination (Serie/Zeitraum) gibt es im Bestand überhaupt keine Dokumente – vermutlich eine Digitalisierungslücke. Lockere Serie oder Zeitraum.",
			);
			continue;
		}
		if (p.kind === "words") {
			const words = p.words ?? [];
			if (words.length === 0 || phraseHelps) continue;
			if (words.every((w) => w.total === 0)) {
				lines.push("Mit diesen Filtern kommt keines der Wörter vor – prüfe Schreibweise, Synonyme und ältere Formen (alternatives).");
				continue;
			}
			const counts = words.map((w) => `»${w.word}« in ${w.total}`).join(", ");
			lines.push(
				`Alle Wörter der Suche müssen im selben Dokument vorkommen; einzeln (gleiche Filter) stehen ${counts} Dokumenten – lass Wörter weg, die nicht zwingend sind, oder ersetze sie (Synonyme, ältere Schreibweisen).`,
			);
			continue;
		}
		if (p.total === 0) continue;
		const label =
			p.kind === "series"
				? "Ohne Serien-Einschränkung"
				: p.kind === "phrase"
					? "Ohne die exakte Form (phrase/exact weglassen: alle Wörter einzeln, in beliebiger Reihenfolge und ähnlicher Schreibung)"
					: "Ohne Zeitraum-Einschränkung";
		const tail =
			p.kind === "dates"
				? ". Hat der Nutzer den Zeitraum ausdrücklich genannt, lockere ihn NICHT – suche darin mit anderen, allgemeineren Begriffen (das Gesuchte kann dort anders heissen) oder mit semantic_search; sonst wiederhole die Suche ohne Zeitraum."
				: " – wiederhole die Suche entsprechend.";
		lines.push(`${label} gäbe es ${p.total} Treffer${bySeriesText(p.bySeries)}${tail}`);
	}
	if (lines.length === 0) {
		return "Hinweis: Auch ohne die gesetzten Einschränkungen keine Treffer – prüfe Schreibweise, Synonyme und ältere Formen (alternatives) oder versuche semantic_search.";
	}
	return `Hinweis: ${lines.join(" ")}`;
}

// --- Treffer-Inflation (exakte Gegenprobe) -----------------------------------

// Der umgekehrte, bis 2026-11 blinde Fehler: nicht «nichts gefunden», sondern
// «zu viel gefunden». Die Zahl wanderte als Fakt in die Antworten der Modelle
// (Prod 2026-11-17 vor #259: «Pause» 8'066 statt 841 Dokumente, danach 3'017;
// Katalog 663 statt 83).
// ZWEI Ursachen, die der Hinweis getrennt benennt, weil sie unterschiedlich
// greifen und nur `exact` gegen beide hilft:
//   1. Wortanfang-Erweiterung des LETZTEN Query-Worts – immer, jede Wortlänge
//      («Pause» trifft «Pausen»); darum existiert auch `exclusionsFirst`.
//   2. Tippfehler-Toleranz ab `minWordSizeForTypos` (Index-Einstellung; mit der
//      Normalisierung ä→a war «Pässe» bei der Schwelle 5 einen Edit von «Pause»
//      entfernt).
// Die Schwelle steht bewusst NICHT im Hinweis: sie ist eine Index-Einstellung und
// je Index verschieden (seit 2026-11-17 `oneTypo` 7 im documents-Index, PR #259 –
// bei 5–6 Zeichen bleibt dort nur Ursache 1; catalog, ehedaten und editions weiter
// 5), und fürs Handeln braucht ein Modell die Mechanismen, nicht die Zahl.
//
// Schwelle: Entscheidend ist das VERHÄLTNIS, nicht die Differenz – ein Modell
// schreibt «es gibt N Dokumente zu X»; liegt die exakte Zahl unter 60 % davon,
// ist diese Aussage falsch und nicht bloss gerundet (bei «Pause» 10 %). Eine
// grosse Differenz bei hohem Verhältnis (9'000 von 10'000) ist dagegen
// Rundungsrauschen und einen Absatz nicht wert. Die absolute Untergrenze hält
// zusätzlich kleine Suchen still (3 von 5 Treffern exakt braucht keinen Hinweis).
export const EXACT_HINT_MAX_RATIO = 0.6;
export const EXACT_HINT_MIN_DIFF = 10;

/** Die Query der exakten Gegenprobe zu einer laufenden Suche; "" = keine
 *  Gegenprobe nötig oder möglich: leere Anfrage, schon vollständig zitiert
 *  (Phrase bzw. `exact=true` – dann zählt die Hauptsuche selbst exakt) oder
 *  unbalancierte Anführungszeichen (exactWrap stellt dort nichts um).
 *  Pure → unit-testbar. */
export function exactProbeQuery(effective: string): string {
	const q = effective.trim();
	if (!q) return "";
	const exact = exactWrap(q, true);
	return exact === q ? "" : exact;
}

/** Hinweis, wenn die exakte Gegenprobe wesentlich weniger Treffer zählt als die
 *  Suche selbst (Schwellen oben): nennt beide Zahlen, den Mechanismus und das
 *  Mittel – und die Gegenrichtung, denn Meili stemmt kein Deutsch, exakt verliert
 *  also Plurale («Pausen» sind weitere 442 Dokumente). Darum ist `exact` nie der
 *  Default, sondern das Werkzeug gegen aufgeblähte Zahlen. "" = nichts zu melden.
 *  Pure → unit-testbar. */
export function inflationHint(total: number, exactTotal: number): string {
	if (!Number.isFinite(total) || !Number.isFinite(exactTotal)) return "";
	if (total <= 0 || exactTotal < 0 || exactTotal >= total) return "";
	if (total - exactTotal < EXACT_HINT_MIN_DIFF || exactTotal > total * EXACT_HINT_MAX_RATIO) return "";
	return (
		`Hinweis: ${total} Treffer, davon ${exactTotal} mit den Suchwörtern genau so geschrieben (exactTotal) – alle Zahlen und ` +
		`Verteilungen dieses Ergebnisses zählen die ${total}. Zwei Ursachen, die sich unterschiedlich verhalten: die ` +
		"Wortanfang-Erweiterung des LETZTEN Suchworts (sie gilt für jede Anfrage und trifft auch längere Wörter, «Pause» auch " +
		"«Pausen») und Meilis Tippfehler-Toleranz, die ab einer Mindestlänge des Suchworts einen Buchstaben Unterschied zulässt " +
		"(Index-Einstellung; kurze Wörter erreicht sie nicht). Gegen beides hilft exact=true (dieselbe Suche, jedes Wort einzeln " +
		"in Anführungszeichen): Nenne Mengen, Zeitleisten und Spitzenjahre nur so. Gegenrichtung: exact wird nicht gestemmt – " +
		"Plurale und ältere Schreibweisen fehlen dann und sind eigene Suchen (alternatives, wo vorhanden)."
	);
}

// --- Digitalisierungs-Lücken (timeline-Gegencheck) ---------------------------

// WELCHE Serien unvollständig digitalisiert sind, ist stabil; die GENAUEN Lücken-
// Jahre verschieben sich mit der laufenden Digitalisierung – darum hier bewusst
// KEINE Jahreszahlen, nur die Serien. ABl und RRB haben Lücken (ABl derzeit vor
// 1883 und nach 2001; RRB ~1995–2007), KRP und OS sind durchgehend.
export const INCOMPLETE_SERIES: SeriesAbbr[] = ["ABl", "RRB"];

/** Top-n Jahre nach Anzahl (absteigend; Gleichstand → früheres Jahr zuerst). Gibt
 *  dem Modell die Spitzenjahre VORGEFILTERT, statt es eine lange Jahr:Anzahl-Liste
 *  abscannen zu lassen (verhindert Verwechslungen wie 1994/1995, s. Issue #75). */
export function topYearsByCount(years: [number, number][], n: number): [number, number][] {
	return [...years].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, Math.max(0, n));
}

/** Hinweis für Zeitleisten mit Jahren vor 1803: davor stammen alle Dokumente aus
 *  den Ratsmanualen (eine Sitzung je Dokument), 1799–1802 gibt es keine Serie –
 *  Zählungen über den Bruch hinweg sind nicht vergleichbar. null = kein Hinweis. */
export function preModernTimelineNote(firstYear: number, lastYear: number): string | null {
	if (firstYear >= MODERN_FIRST_YEAR) return null;
	const across = lastYear >= MODERN_FIRST_YEAR;
	return `Hinweis: Vor 1803 stammen alle Dokumente aus den Ratsmanualen (RM, 1484–1798, je Sitzung ein Dokument); 1799–1802 gibt es keine Serie.${
		across ? " Zahlen vor und nach 1798/1803 sind nicht vergleichbar (Ratssitzungen gegenüber Beschlüssen, Geschäften und Erlassen)." : ""
	}`;
}

/** Lücken-Vorbehalt für ein timeline-Ergebnis: greift, wenn die effektive Serie
 *  eine unvollständig digitalisierte Serie enthält ODER leer ist (Gesamtkorpus
 *  enthält ABl+RRB – deren Lücken drücken die Kurve, auch ohne harte Null). So
 *  liest das Modell den Vorbehalt DORT, wo es die Jahreszahlen sieht, und schliesst
 *  nicht fälschlich auf einen inhaltlichen Rückgang. null = kein Vorbehalt. */
export function timelineCoverageCaveat(effectiveSeries: SeriesAbbr[]): string | null {
	const affected =
		effectiveSeries.length === 0 ? INCOMPLETE_SERIES : effectiveSeries.filter((s) => INCOMPLETE_SERIES.includes(s));
	if (affected.length === 0) return null;
	const labels = affected.map((s) => SERIES_LABEL[s] ?? s);
	return `Hinweis zur Abdeckung: ${labels.join(" und ")} ${affected.length > 1 ? "sind" : "ist"} nur unvollständig digitalisiert (verschiebende Lücken). Ein Einbruch oder niedrige/fehlende Jahre können eine Digitalisierungslücke sein – KEIN inhaltlicher Rückgang. Prüfe einen auffälligen Teilzeitraum mit count_documents/timeline gegen den Gesamtkorpus oder eine durchgehende Serie (KRP, OS), bevor du auf »weniger« oder »keine« schliesst.`;
}

// --- Parameter-Fragmente der Tool-Schemas -------------------------------------

const SERIES_DESC =
	"Serien-Kürzel: ABl = Amtsblatt, KRP = Kantonsratsprotokolle (Parlament), OS = Gesetzessammlung, RRB = Regierungsratsbeschlüsse, RM = Ratsmanuale (Sitzungsprotokolle des Rats der Stadt Zürich 1484–1798, nur per Stichwort durchsuchbar). Mehrere = ODER. Weglassen = alle Serien.";

export const seriesParam = { type: "array", items: { type: "string", enum: ALL_SERIES }, description: SERIES_DESC };
export const dateFromParam = { type: "integer", description: "Frühestes Jahr (inklusive)." };
export const dateToParam = { type: "integer", description: "Spätestes Jahr (inklusive)." };
export const phraseParam = {
	type: "boolean",
	description:
		"true = exakte Phrasensuche (die ganze query als Wortfolge, Wörter müssen direkt aufeinanderfolgen). Bei einem mehrwortigen EIGENNAMEN (Person/Ort/Organisation, z. B. »Jacqueline Fehr«) IMMER true setzen, damit nur Dokumente mit dem exakten Namen zählen – ohne Phrase genügen die Namensteile irgendwo im Dokument, auch in ähnlicher Form (»Mario Fehr« trifft dann auch »Maria … Fehr«), das bläht Mengen/Zeitleiste/Trefferliste auf. Bei EINEM Wort heisst phrase=true »genau dieses Wort«: ohne Tippfehler-Toleranz und ohne Wortanfang-Treffer (gemessen am 17.11.2026: »Pause« 3'017 Dokumente, als Phrase 841). Bei Kombinationen aus Thema und Ort (»Zivilschutzanlagen Rämibühl«) NICHT setzen – die Wörter stehen nicht nebeneinander; dafür ist `exact=true` da. Sind beide gesetzt, gewinnt phrase (exact wird ignoriert).",
};
export const exactParam = {
	type: "boolean",
	description:
		"true = jedes Wort der query muss genau so im Dokument stehen (jedes Wort einzeln in Anführungszeichen); Reihenfolge und Abstand bleiben frei – die mildere Form gegenüber phrase. Schaltet die ZWEI Quellen unscharfer Treffer ab: die Wortanfang-Erweiterung des letzten Suchworts (»Pause« trifft auch »Pausen«) und Meilis Tippfehler-Toleranz, die ab einer Mindestlänge des Suchworts einen Buchstaben Unterschied zulässt (Index-Einstellung). Gemessen am 17.11.2026: »Pause« 3'017 Dokumente, genau so geschrieben 841; »Pause Schulhaus« 105 gegen 61. Für Zählungen, Zeitleisten, Mengenaussagen und kurze Wörter setzen – `exactTotal` im Ergebnis zeigt ungefragt, wie viel die Unschärfe ausmacht. ACHTUNG Gegenrichtung: exakt wird NICHT gestemmt, Beugungsformen und alte Schreibungen fallen weg (»Pausen« sind weitere 442 Dokumente) – sie brauchen eigene Suchen bzw. `alternatives`. Darum kein Default, sondern das Mittel gegen aufgeblähte Zahlen.",
};
export const fieldParam = {
	type: "string",
	enum: ["title", "fulltext"],
	description:
		"Suchfeld. fulltext (Default) = Titel UND Volltext; title = nur im Titel suchen. Sinnvoll als Mittelweg, wenn die Volltext-/Stichwortsuche ZU VIEL (zu viele beiläufige Erwähnungen) und die semantische Suche zu wenig liefert – die Titel kodieren im Korpus oft das Kernthema (»Motion … betreffend …«). ACHTUNG: Titellänge und -konventionen schwanken stark über Serien und Zeit (frühe Titel sehr knapp, spätere Bestände ausführlicher), darum ist die Titelsuche ungleichmässig – nicht überbewerten, im Zweifel ohne field gegenprüfen.",
};
export const offsetParam = {
	type: "integer",
	description:
		"Offset für Paginierung (0-basiert, Default 0): überspringt die ersten N Treffer, um über die erste Seite hinaus zu blättern.",
};
