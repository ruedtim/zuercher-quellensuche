import type { SearchParams, SeriesAbbr } from "./types";
import { ALL_SERIES, CORPUS_YEAR_MIN, DEFAULT_SEARCH } from "./types";
import { foldRmQueryMarks } from "./rmText";

/** Höchste Seite aus der URL (mehr Treffer als Dokumente gibt es nicht); darüber würde der Offset
 *  in Exponentenschreibweise an Meili gehen. */
const PAGE_MAX = 1_000_000;

// Obergrenzen der Eingaben: weit über dem, was die Oberfläche erzeugt, damit eine einzelne Adresse
// nicht beliebig viel Arbeit auslöst (jeder ODER-Begriff ist eine eigene Suche). Überzähliges fällt weg.
export const SEARCH_LIMITS = {
	/** Zeichen im Suchbegriff bzw. Thema. */
	text: 500,
	/** ODER-Begriffe. */
	anyTerms: 10,
	/** Werte je Namensfilter. */
	names: 50,
	/** Werte je Serien-Filter (die Seiten des Kleinen Rats verlinken bis 114 Bände). */
	values: 200,
	/** Zeichen eines Werts. */
	value: 200,
} as const;

/** Eingaben in zusammengesetzter Form (NFC): aus macOS oder PDF kopiert kommen Umlaute oft zerlegt
 *  («u» und Punkte); Meili gleicht das an, die Zerlegung und Hervorhebung der Wörter hier nicht. */
const nfc = (text: string): string => text.normalize("NFC");

export function parseSearchParams(url: URL): SearchParams {
	const q = nfc(url.searchParams.get("q") ?? DEFAULT_SEARCH.q).slice(0, SEARCH_LIMITS.text);
	// Thema-Filter (semantisch), kombinierbar mit dem Suchbegriff. Alte
	// alpha-/mode-Links werden in +page.server.ts redirected, hier ignoriert.
	const theme = nfc(url.searchParams.get("theme")?.trim() ?? DEFAULT_SEARCH.theme).slice(0, SEARCH_LIMITS.text);
	const seriesRaw = url.searchParams.get("series");
	const series = seriesRaw
		? (seriesRaw.split(",").filter((s) => ALL_SERIES.includes(s as SeriesAbbr)) as SeriesAbbr[])
		: DEFAULT_SEARCH.series;
	const dateFromRaw = url.searchParams.get("dateFrom");
	const dateToRaw = url.searchParams.get("dateTo");
	const sortRaw = url.searchParams.get("sort");
	const pageRaw = url.searchParams.get("page");
	const pageSizeRaw = url.searchParams.get("pageSize");
	const topKRaw = url.searchParams.get("topK");

	return {
		q,
		// Lexikalische ODER-Begriffe als wiederholter Param (?qAny=A&qAny=B), wie
		// die Entity-Filter – mehrwortige Begriffe („tolle Hunde") dürfen Kommata
		// nicht zerreissen. >= 2 Begriffe schalten den ODER-Modus (Union via
		// Föderation), s. searchDocumentsUnion / executeSearch; ein einzelner
		// wirkt als Suchbegriff (foldSingleAnyTerm).
		anyTerms: parseStringList(url.searchParams.getAll("qAny"), SEARCH_LIMITS.anyTerms),
		theme,
		series,
		dateFrom: dateFromRaw ? clampInt(dateFromRaw, CORPUS_YEAR_MIN, 2100) : null,
		dateTo: dateToRaw ? clampInt(dateToRaw, CORPUS_YEAR_MIN, 2100) : null,
		// Intern: Thema gesetzt → Hybrid-Pfade aktiv.
		semanticRatio: theme ? 0.7 : 0,
		sort: parseSort(sortRaw),
		page: pageRaw ? clampInt(pageRaw, 1, PAGE_MAX) : DEFAULT_SEARCH.page,
		pageSize: pageSizeRaw ? clampInt(pageSizeRaw, 1, 100) : DEFAULT_SEARCH.pageSize,
		topK: topKRaw ? clampInt(topKRaw, 1, 1000) : null,
		volumeNr: parseIntList(url.searchParams.get("volumeNr")),
		startPg: parseIntList(url.searchParams.get("startPg")),
		serialNr: parseStringCommaList(url.searchParams.get("serialNr")),
		resolutionId: parseStringCommaList(url.searchParams.get("resolutionId")),
		years: parseIntList(url.searchParams.get("years")),
		// Entity-Filter werden als wiederholte Params kodiert (?persons=A&persons=B),
		// nicht komma-separiert, weil Personen-/Orts-Namen selbst Kommata enthalten
		// können ("Müller, Hans") und Komma-Splitting sie zerreißen würde.
		persons: parseStringList(url.searchParams.getAll("persons"), SEARCH_LIMITS.names),
		places: parseStringList(url.searchParams.getAll("places"), SEARCH_LIMITS.names),
		organizations: parseStringList(url.searchParams.getAll("organizations"), SEARCH_LIMITS.names),
		// Nur-Titel-Suche (Suchbegriff aufs Titelfeld beschränken) – persistenter
		// Scope-Toggle, im Link teilbar.
		titleOnly: url.searchParams.get("titleOnly") === "1",
	};
}

export function searchParamsToUrl(params: Partial<SearchParams>, base?: URL): URL {
	const url = base ? new URL(base.toString()) : new URL("/search", "http://localhost");
	url.search = "";
	const merged = { ...DEFAULT_SEARCH, ...params };
	if (merged.q) url.searchParams.set("q", merged.q);
	for (const v of merged.anyTerms) url.searchParams.append("qAny", v);
	if (merged.theme) url.searchParams.set("theme", merged.theme);
	if (merged.series.length > 0) url.searchParams.set("series", merged.series.join(","));
	if (merged.dateFrom != null) url.searchParams.set("dateFrom", String(merged.dateFrom));
	if (merged.dateTo != null) url.searchParams.set("dateTo", String(merged.dateTo));
	if (merged.sort !== "relevance") url.searchParams.set("sort", merged.sort);
	// topK = Umfang des Thema-Schnitts; wirkt nur mit Thema UND Suchbegriff
	// bzw. Datums-Sortierung – sonst (reines Ranking) wirkungslos, aber harmlos.
	if (merged.topK != null) url.searchParams.set("topK", String(merged.topK));
	if (merged.page > 1) url.searchParams.set("page", String(merged.page));
	if (merged.pageSize !== DEFAULT_SEARCH.pageSize) url.searchParams.set("pageSize", String(merged.pageSize));
	if (merged.volumeNr.length > 0) url.searchParams.set("volumeNr", merged.volumeNr.join(","));
	if (merged.startPg.length > 0) url.searchParams.set("startPg", merged.startPg.join(","));
	if (merged.serialNr.length > 0) url.searchParams.set("serialNr", merged.serialNr.join(","));
	if (merged.resolutionId.length > 0) url.searchParams.set("resolutionId", merged.resolutionId.join(","));
	if (merged.years.length > 0) url.searchParams.set("years", merged.years.join(","));
	for (const v of merged.persons) url.searchParams.append("persons", v);
	for (const v of merged.places) url.searchParams.append("places", v);
	for (const v of merged.organizations) url.searchParams.append("organizations", v);
	if (merged.titleOnly) url.searchParams.set("titleOnly", "1");
	return url;
}

// Relevanz-Sortierung (Label «Relevanz» bzw. «Ähnlichkeit») braucht ein Ranking-Signal:
// Wort-Ranking braucht Wörter. Ohne Suchbegriff UND ohne Thema gibt es keins –
// Meili liefert dann bei leerer Query die interne Einfüge-Reihenfolge (= der
// älteste indexierte ABl-Jahrgang zuoberst), was als "Relevanz" verkauft
// sinnlos ist. Steuert UI (Sort-Option ein-/ausblenden) und effectiveSort.
export function relevanceSortApplicable(params: Pick<SearchParams, "q" | "theme" | "anyTerms">): boolean {
	return params.q.trim() !== "" || params.theme.trim() !== "" || params.anyTerms.length > 0;
}

// Effektive Sortierung der Trefferliste: ohne Ranking-Signal fällt der
// relevance-Default auf "älteste zuerst" (date_asc) – eine erklärbare, stabile
// Reihenfolge statt Meilis interner Einfüge-Ordnung. Explizit gewählte
// Datums-Sorts bleiben unangetastet. Bewusst von der URL-/Zustands-`sort`
// entkoppelt (die bleibt "relevance"), damit eine danach getippte Suche wieder
// nach Relevanz sortiert statt das date_asc "festzukleben".
export function effectiveSort(params: Pick<SearchParams, "q" | "theme" | "anyTerms" | "sort">): SearchParams["sort"] {
	if (params.sort === "relevance" && !relevanceSortApplicable(params)) return "date_asc";
	return params.sort;
}

// Klappen die «Erweiterten Suchoptionen» der Filterspalte von selbst auf? Ja,
// sobald ein Filter aktiv ist, der nur dort zu sehen wäre: ODER-Begriffe (das
// Feld «Irgendeines dieser Wörter» gibt es nur dort), Thema, Serie, Personen/
// Orte/Organisationen, serienspezifische Filter, Themen-Umfang. Nicht dazu
// zählen der Suchbegriff (Chips unter dem einfachen Feld), «nur im Titel»
// (Häkchen in beiden Ansichten) und der Zeitraum: Den setzt man meist über die
// Zeitleiste, die ihn selbst zeigt (Ausschnitt, Pfad «Alle Jahre › …»,
// «Reset ×»); eingeklappt steht er zudem als Pill unter dem Schalter. Ein
// geteilter Link mit nur dateFrom/dateTo öffnet darum wie der Klick eingeklappt.
export function autoOpensAdvanced(
	params: Pick<
		SearchParams,
		| "anyTerms"
		| "theme"
		| "series"
		| "persons"
		| "places"
		| "organizations"
		| "volumeNr"
		| "startPg"
		| "serialNr"
		| "resolutionId"
		| "years"
		| "topK"
	>,
): boolean {
	return (
		params.anyTerms.length > 0 ||
		params.theme.trim() !== "" ||
		params.series.length > 0 ||
		params.persons.length > 0 ||
		params.places.length > 0 ||
		params.organizations.length > 0 ||
		params.volumeNr.length > 0 ||
		params.startPg.length > 0 ||
		params.serialNr.length > 0 ||
		params.resolutionId.length > 0 ||
		params.years.length > 0 ||
		params.topK != null
	);
}

// Zeitraum als kurzes Label (Pill in der Filterspalte): «1655», «1600 – 1700»,
// offene Enden «ab 1850» bzw. «bis 1550»; ohne Zeitraum null.
export function dateRangeLabel(from: number | null, to: number | null): string | null {
	if (from == null && to == null) return null;
	if (from != null && to != null) return from === to ? String(from) : `${from} – ${to}`;
	return from != null ? `ab ${from}` : `bis ${to}`;
}

// Trenner zwischen ODER-Begriffen: standalone „OR" (jede Schreibung) oder „|".
const OR_SEPARATOR = /\s+OR\s+|\s*\|\s*/i;

// Zerlegt eine ODER-Eingabe (Wortfeld der Suchmaske) in einzelne Begriffe: an
// OR_SEPARATOR trennen, trimmen, leere/doppelte entfernen. Mehrwortige Begriffe
// bleiben intakt („tolle Hunde OR Wuth" → ["tolle Hunde", "Wuth"]). Getrennt
// wird nur ausserhalb von Anführungszeichen – in einer Phrase ist „OR" ein
// gewöhnliches Wort (`"Art. 41 OR Haftung"`, OR = Obligationenrecht); eine
// ungeschlossene Phrase reicht wie bei Meili bis zum Ende. Pure → unit-testbar.
export function splitOrQuery(input: string): string[] {
	const parts: string[] = [""];
	input.split('"').forEach((segment, i) => {
		if (i > 0) parts[parts.length - 1] += '"';
		// Ungerade Segmente liegen in Anführungszeichen → wörtlich übernehmen.
		const pieces = i % 2 === 1 ? [segment] : segment.split(OR_SEPARATOR);
		parts[parts.length - 1] += pieces[0];
		parts.push(...pieces.slice(1));
	});
	const out: string[] = [];
	const seen = new Set<string>();
	for (const p of parts) {
		const t = p.trim();
		const key = t.toLowerCase();
		if (!t || seen.has(key)) continue;
		seen.add(key);
		out.push(t);
	}
	return out;
}

// Ein einzelner ODER-Begriff ist keine Union (die ODER-Pfade verlangen >= 2) –
// er wirkt wie ein normaler Suchbegriff und wird an `q` angehängt, sonst würde
// er ignoriert und die Suche liefe leer (= ganzer Korpus). Realer UI-Zustand:
// entsteht im Feld «Irgendeines dieser Wörter» transient beim ersten Begriff,
// bevor der zweite dazukommt (URL `?qAny=Wuth`). Gemeinsame Stelle für alle
// Wege, die die Treffermenge nachbauen (Trefferliste, Facetten-Typeahead,
// KI-Treffer-Scope), damit sie nicht auseinanderlaufen. Gibt eine Kopie
// zurück (die Roh-Params der UI, etwa der ODER-Chip, bleiben unangetastet);
// ohne genau einen ODER-Begriff unverändert dasselbe Objekt. Pure → unit-testbar.
export function foldSingleAnyTerm<T extends Pick<SearchParams, "q" | "anyTerms">>(params: T): T {
	if (params.anyTerms.length !== 1) return params;
	const only = params.anyTerms[0];
	const q = params.q.trim();
	return { ...params, q: q ? `${q} ${only}` : only, anyTerms: [] };
}

// ß nach einem Buchstaben als ss schreiben, wie im Suchtext des Index. Seit
// 2026-11-17 schreibt der Indexer ALLE Serien so (services/indexer searchText.ts,
// Titel im Suchfeld titleSearch); `allSeries` setzt die Web-App, sobald der Index
// diesen Stand trägt (searchTextReady in meili.ts). Bis dahin wie zuvor: nur bei
// einer reinen RM-Auswahl, deren Lesefassung schon immer so geschrieben war. Meili
// gleicht ß nicht an (lokal gemessen 2026-10: Phrase «Hanßen Müllers» 0 Treffer,
// «Hanssen Müllers» 1; Prod 2026-11-17: «Strasse» fand keines der 19'179 Dokumente
// mit «Straße»), aus der diplomatischen Detailseite kopierter Text träfe sonst nicht.
// Gleiche Aufrufstellen wie foldSingleAnyTerm (Trefferliste, Facetten-
// Typeahead, KI-Treffer-Scope); URL und Chips behalten die getippte Form.
// Kopie bzw. ohne Änderung dasselbe Objekt. Pure → unit-testbar.
export function foldRmSharpS<T extends Pick<SearchParams, "q" | "anyTerms" | "series">>(params: T, allSeries = false): T {
	if (!allSeries && (params.series.length === 0 || !params.series.every((s) => s === "RM"))) return params;
	const fold = (s: string) => s.replace(/(?<=\p{L})ß/gu, "ss").replace(/ẞ/g, "SS");
	const q = fold(params.q);
	const anyTerms = params.anyTerms.map(fold);
	if (q === params.q && anyTerms.every((t, i) => t === params.anyTerms[i])) return params;
	return { ...params, q, anyTerms };
}

// Rohform (Meili-Syntax) eines Wortfeld-Eintrags als Token-Liste: Phrase →
// `"…"` (eigene Anführungszeichen entfernt), Ausschluss → `-wort` je Wort bzw.
// `-"phrase"`, sonst der Text als Ganzes. Leer → [].
function fieldTokens(text: string, opts: { phrase: boolean; exclude: boolean }): string[] {
	const txt = text.trim();
	if (opts.phrase) {
		const t = txt.replace(/"/g, "").trim();
		return t ? [queryTokenRaw(t, { phrase: true, exclude: opts.exclude })] : [];
	}
	if (!txt) return [];
	// Mehrere Wörter ausschliessen = jedes einzeln negieren (-a -b).
	if (opts.exclude) return txt.split(/\s+/).map((w) => `-${w}`);
	return [txt];
}

// Eingabe eines Wortfelds der Suchmaske als Bausteine für die Suche: `q` =
// Rohform zum Anhängen an den Suchbegriff, `anyTerms` = neue ODER-Alternativen.
// Die Felder: Einfach-Feld (`exclude` = Häkchen «ausschliessen»), «Alle diese
// Wörter» (Pflicht), «Irgendeines dieser Wörter» (`alternative`), «Ohne diese
// Wörter» (`exclude`); `exact` = Häkchen «exakt» (Anführungszeichen in der
// Eingabe setzen es implizit). Ein getipptes „A OR B" wird in jedem Feld
// zerlegt (splitOrQuery), «exakt» gilt dann je Teil (ein Teil mit eigenen
// Anführungszeichen ist auch ohne Häkchen eine Phrase):
//   - Ausschluss: NICHT (A ODER B) = NICHT A UND NICHT B ⇒ `-A -B` in `q`.
//   - sonst ODER-Alternativen – auch aus «Alle diese Wörter»: wörtlich in `q`
//     übernommen wäre «or» ein strikter Pflicht-Term (kaum ein Treffer).
// Pure → unit-testbar.
export function parseFieldInput(
	input: string,
	opts: { exact: boolean; exclude?: boolean; alternative?: boolean },
): { q: string; anyTerms: string[] } {
	const exclude = opts.exclude === true;
	const parts = splitOrQuery(input);
	const isOr = parts.length >= 2;
	const tokens = isOr
		? parts.flatMap((p) => fieldTokens(p, { phrase: opts.exact || p.includes('"'), exclude }))
		: fieldTokens(input, { phrase: opts.exact || input.includes('"'), exclude });
	if (!exclude && (isOr || opts.alternative)) return { q: "", anyTerms: tokens };
	// Doppelte Tokens (Wörter, die in mehreren ausgeschlossenen ODER-Teilen
	// vorkommen) nur einmal übernehmen.
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const t of tokens) {
		const key = t.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(t);
	}
	return { q: unique.join(" "), anyTerms: [] };
}

// Meili-Subquery EINES ODER-Zweigs: der ODER-Begriff plus der restliche
// (Pflicht-/UND-)Suchbegriff `q`, angehängt an jeden Zweig – über alle Zweige
// vereinigt ergibt das `(A ODER B) UND q`, ohne `q` die reine Vereinigung. Jeder
// Zweig läuft strikt (`matchingStrategy:"all"`), auch ohne `q`: Meilis Default
// `last` liesse sonst Wörter fallen – einen UND-Term aus `q` ebenso wie ein Wort
// eines mehrwortigen ODER-Begriffs (`tolle Hunde OR Wuth` träfe auch Dokumente,
// die nur «tolle» enthalten). Unabhängig von lexicalStrict: ODER gibt es nur in
// der interaktiven Suche, die öffentliche /api/v1 kennt kein `qAny`.
// Ausschluss-Tokens (aus q wie aus dem Zweig selbst) wandern nach vorn, damit
// das letzte positive Wort seine Prefix-Expansion behält (s. exclusionsFirst).
// Pure → unit-testbar.
export function combineUnionQuery(term: string, q: string): { q: string; matchingStrategy: "all" } {
	const extra = q.trim();
	return { q: exclusionsFirst(extra ? `${term} ${extra}` : term), matchingStrategy: "all" };
}

// Ein Token des lexikalischen Suchbegriffs `q`. Meili parst `"phrase"` (exakt)
// und `-wort` (ausschliessen) bereits selbst – wir zerlegen den rohen
// q-String nur fürs Chip-Display und das tokenweise Entfernen.
export interface QueryToken {
	text: string; // Anzeigetext (ohne Quotes/Minus)
	phrase: boolean; // exakte Wortfolge ("…")
	exclude: boolean; // Ausschluss (-…)
	raw: string; // exakte Quellform, fürs verlustfreie Rebuild
}

const QUERY_TOKEN_RE = /(-?)"([^"]*)"|(-?)(\S+)/g;

export function parseQueryTokens(q: string): QueryToken[] {
	const out: QueryToken[] = [];
	let m: RegExpExecArray | null;
	QUERY_TOKEN_RE.lastIndex = 0;
	while ((m = QUERY_TOKEN_RE.exec(q)) !== null) {
		if (m[2] !== undefined) {
			// Quoted: m[1] = optionales führendes '-', m[2] = Inhalt.
			const exclude = m[1] === "-";
			out.push({ text: m[2], phrase: true, exclude, raw: `${m[1]}"${m[2]}"` });
		} else {
			// Bareword: m[3] = optionales '-', m[4] = Wort.
			const exclude = m[3] === "-";
			out.push({ text: m[4], phrase: false, exclude, raw: `${m[3]}${m[4]}` });
		}
	}
	return out;
}

// Meili ergänzt Wortanfänge (Prefix-Expansion) nur beim LETZTEN Query-Term
// (Search-as-you-type-Semantik). Steht ein Ausschluss (`-wort`) am Ende – die
// UI hängt «Ohne diese Wörter» dort an, Nutzer tippen ihn meist zuletzt –,
// verdrängt er das letzte positive Suchwort von dieser Position: dessen
// Prefix-Expansion fällt weg und die Treffermenge kollabiert (Issue #112:
// `fisch` 17'732 ↔ `fisch -das` 116 statt 2'579). Darum vor jedem Meili-Call
// alle Ausschluss-Tokens nach VORN stellen; die Reihenfolge innerhalb beider
// Gruppen bleibt erhalten. Für die Negationen ist die Position egal (sie
// matchen nur ganze Wörter, nie Prefixe), die positiven Terme verhalten sich
// exakt wie ohne Ausschluss. Wirkt nur auf die an Meili gesendete Query –
// URL, Chips und Anzeige behalten die getippte Form. Pure → unit-testbar.
//
// Zweite Normalisierung am selben Boundary: Nasalstrich und ¬ der Ratsmanuale
// (foldRmQueryMarks, rmText.ts) – aus der diplomatischen Detailseite kopierter
// Text («kom̅en») trifft so die Lesefassung im Index («kommen»). Anfragen ohne
// diese Zeichen bleiben unberührt.
export function exclusionsFirst(rawQ: string): string {
	const q = foldRmQueryMarks(rawQ);
	if (!q.includes("-")) return q;
	// Quote-Parity-Guard: bei unbalancierten Anführungszeichen (Tippfehler wie
	// `fisch -"das`) weicht unsere Tokenisierung von Meilis Phrasen-Parsing ab –
	// Meili liest die ungeschlossene Phrase bis zum String-Ende. Nach vorn
	// gestellt würde die offene Negations-Phrase alle folgenden positiven
	// Wörter verschlucken (kein Pflicht-Term übrig ⇒ Match-all über den ganzen
	// Korpus). Solche Queries unverändert lassen (Status quo).
	if (((q.match(/"/g) ?? []).length & 1) === 1) return q;
	const tokens = parseQueryTokens(q);
	if (!tokens.some((t) => t.exclude)) return q;
	const neg = tokens.filter((t) => t.exclude).map((t) => t.raw);
	const pos = tokens.filter((t) => !t.exclude).map((t) => t.raw);
	return [...neg, ...pos].join(" ");
}

// Begriffe, die die zweistufigen ODER-Pfade im Treffer-Snippet nachmarkieren:
// Stufe 2 sucht dort mit q = Thema (bzw. leer) innerhalb der Union-IDs – Meili
// kennt die ODER-/UND-Begriffe nicht mehr, Highlight/Crop müssen serverseitig
// nachgezogen werden. Positive Tokens aus allen ODER-Zweigen + dem UND-q
// (Phrasen bleiben ganz, `-Ausschlüsse` fallen weg), dedupliziert. Das Thema
// gehört bewusst NICHT dazu: es ist ein semantisches Signal, eine wörtliche
// Markierung des Thema-Texts wäre irreführend. Pure → unit-testbar.
export function unionHighlightTerms(anyTerms: string[], q: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const source of [...anyTerms, q]) {
		for (const tok of parseQueryTokens(source)) {
			if (tok.exclude) continue;
			const t = tok.text.trim();
			const key = t.toLowerCase();
			if (!t || seen.has(key)) continue;
			seen.add(key);
			out.push(t);
		}
	}
	return out;
}

// Rohform eines Tokens fürs Anhängen/Rebuild der q.
export function queryTokenRaw(text: string, opts: { phrase: boolean; exclude: boolean }): string {
	const core = opts.phrase ? `"${text}"` : text;
	return opts.exclude ? `-${core}` : core;
}

function parseSort(raw: string | null): SearchParams["sort"] {
	if (raw === "date_asc" || raw === "date_desc") return raw;
	return "relevance";
}

function clampInt(raw: string, min: number, max: number): number {
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, n));
}

function parseIntList(raw: string | null): number[] {
	if (!raw) return [];
	const out: number[] = [];
	for (const part of raw.split(",")) {
		const n = Number.parseInt(part.trim(), 10);
		// Grössere Zahlen schriebe JavaScript als «1e+26» in den Meili-Filter (dort ein Syntaxfehler).
		if (Number.isSafeInteger(n)) out.push(n);
	}
	// De-dupe + stable
	return Array.from(new Set(out)).slice(0, SEARCH_LIMITS.values);
}

function parseStringList(values: string[], max: number): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		const t = nfc(v).trim().slice(0, SEARCH_LIMITS.value);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
		if (out.length >= max) break;
	}
	return out;
}

// Komma-separierte String-Listen – für Facetten-Werte wie resolutionId
// ("1803/0003,1804/2003") oder serialNr ("632.31,632.32"). Kommas in den
// Werten sind hier per definitionem ausgeschlossen (anders als bei Personen-
// Namen, die `parseStringList` mit wiederholten Params kodiert).
function parseStringCommaList(raw: string | null): string[] {
	if (!raw) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const part of raw.split(",")) {
		const t = part.trim().slice(0, SEARCH_LIMITS.value);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
		if (out.length >= SEARCH_LIMITS.values) break;
	}
	return out;
}
