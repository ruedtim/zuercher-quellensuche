// Shared types – sollten 1:1 zu services/indexer/src/types.ts passen
// (kopiert weil Mono-Repo-Workspaces erst in Phase 5 eingerichtet werden).

export type SeriesAbbr = "ABl" | "KRP" | "OS" | "RRB" | "RM";

// RM (Ratsmanuale, StAZH B II) steht bewusst am Ende: die Serie ist neu dazu-
// gekommen und älter als die vier zentralen Serien ab 1803.
export const ALL_SERIES: SeriesAbbr[] = ["ABl", "KRP", "OS", "RRB", "RM"];

export const SERIES_LABEL: Record<SeriesAbbr, string> = {
	ABl: "Amtsblatt",
	KRP: "Kantonsratsprotokolle",
	OS: "Gesetzessammlung",
	RRB: "Regierungsratsbeschlüsse",
	RM: "Ratsmanuale",
};

// Serien ohne Vektoren und ohne Passagen (chunks): nur lexikalisch auffindbar
// (Stichwortsuche, Listen, Zählungen, Zeitleiste). Das Thema reiht sie nicht,
// Ähnlichkeitssuche und KI-Antwort-Passagen gibt es für sie nicht. Die
// Ratsmanuale (RM) sind maschinell transkribiert; jina-v2-base-de taugt für sie
// nicht (docs/ratsmanuale-plan.md, E10) – bis zum Embedder-Entscheid bleiben
// sie ohne Vektoren.
export const LEXICAL_ONLY_SERIES: SeriesAbbr[] = ["RM"];

export function isLexicalOnlySeries(s: string): boolean {
	return (LEXICAL_ONLY_SERIES as string[]).includes(s);
}

// Früheste Jahreszahl im Korpus – die Untergrenze aller Jahres-Parameter (Suche,
// /api/v1, MCP, Frage-Erkennung). Die Ratsmanuale beginnen mit StAZH B II 6
// (Bandjahr 1484); eine Natalrat-Sitzung kann noch vom Dezember des Vorjahres sein.
export const CORPUS_YEAR_MIN = 1483;

// Ab hier beginnen die vier zentralen Serien (ABl, KRP, OS, RRB); davor gibt es
// nur die Ratsmanuale (bis 1798), 1799–1802 keine Serie. Zeitstrahl-Achse und das
// Routing der MCP-Suchen (Passagen erst ab 1803) richten sich danach.
export const MODERN_FIRST_YEAR = 1803;

// Letztes Jahr der Ratsmanuale – Ende der Zeitstrahl-Achse bei reinen
// Ratsmanual-Suchen (timelineAxis in timelineBins.ts).
export const PREMODERN_LAST_YEAR = 1798;

// Querverweis-Relation aus dem TEI-Header (`<bibl><listRelation><relation>`).
// 1:1 zu services/indexer/src/types.ts. `targetId` = Staatsarchiv-Katalog-ID
// des Ziels (join-bar gegen `archiveId`), `url` = Katalog-URL (externer
// Fallback-Link).
export interface DocRelation {
	name: string;
	targetId: number | null;
	url: string;
}

export interface SearchHit {
	id: string;
	series: SeriesAbbr;
	title: string;
	date: string | null;
	dateYear: number | null;
	startPg: number | null;
	volumeNr: number | null;
	serialNr: string | null;
	resolutionId: string | null;
	stazhIdent: string | null;
	archiveLink: string | null;
	manifestUrl: string | null;
	subset?: string | null;
	// Staatsarchiv-Katalog-ID (Join-Schlüssel für Querverweise) + Querverweise.
	archiveId?: number | null;
	relations?: DocRelation[];
	body?: string;
	persons?: string[];
	places?: string[];
	organizations?: string[];
	_formatted?: {
		title?: string;
		body?: string;
	};
	_rankingScore?: number;
}

/** Angaben eines Dokuments für Seiten, ohne Volltext und interne Felder. */
export type DocumentMeta = Pick<
	SearchHit,
	| "id"
	| "series"
	| "title"
	| "date"
	| "dateYear"
	| "startPg"
	| "volumeNr"
	| "serialNr"
	| "resolutionId"
	| "stazhIdent"
	| "archiveLink"
	| "manifestUrl"
	| "subset"
>;

/** Treffer der Dokumentsuche für den Browser: nur, was die Liste zeigt. Titel und Auszug sind
 *  maskiert (sanitizeMarks), nur die Hervorhebungen bleiben Markup. */
export interface DocumentHitView {
	id: string;
	series: SeriesAbbr;
	date: string | null;
	stazhIdent: string | null;
	titleHtml: string;
	textHtml: string | null;
}

export type DocumentResultView = Omit<SearchResponse, "hits"> & { hits: DocumentHitView[] };

export interface FacetDistribution {
	series?: Record<string, number>;
	dateYear?: Record<string, number>;
}

export interface SearchResponse {
	hits: SearchHit[];
	estimatedTotalHits: number;
	processingTimeMs: number;
	facetDistribution?: FacetDistribution;
	page: number;
	pageSize: number;
	// Nur im Top-K-Modus (Thema + Datums-Sort): Grösse der Menge, aus der die
	// topK ähnlichsten geschnitten wurden – volle Filter-Menge (Thema allein)
	// bzw. echte lexikalische/Union-Trefferzahl (mit Suchbegriff/ODER). Fürs
	// Zähler-Label «K ähnlichste von X Treffern»; estimatedTotalHits bleibt die
	// Anzahl der geschnittenen Treffer (Pagination läuft innerhalb der K).
	topKOfTotal?: number;
	// Thema + Suchbegriff/ODER, nach Relevanz: Anzahl der tatsächlich durchblätterbaren Treffer,
	// wenn es mehr sind (zuerst die dem Thema nächsten, server/themeOrder.ts; im Export CORPUS_CAP).
	// estimatedTotalHits nennt die ECHTE Treffermenge (ehrlicher Zähler, Issue #113) – die UI deckelt
	// die Seitenzahl darauf und weist es aus. Ungesetzt = alle Treffer durchblätterbar.
	rankedPool?: number;
	// Nach Relevanz ohne Thema (server/browseLimit.ts) und mit Thema allein (server/themeOrder.ts):
	// so viele Treffer lassen sich durchblättern. Gilt nicht für den Export. Ungesetzt = alle.
	browseLimit?: number;
	// Thema allein + Relevanz: das Thema rankt die GANZE Filtermenge (Hybrid,
	// kein Schnitt). Marker für den Treffer-Export, der hier auf CORPUS_CAP
	// deckelt (eine Hybrid-Suche mit Limit 100'000 wäre zu teuer) – so muss
	// niemand das Routing von executeSearch nachbauen.
	themeRankedAll?: boolean;
	// Nur bei Hybrid-Suchen (Thema-Vektor): wie viele Treffer der semantische Arm
	// beigetragen hat (Meili `semanticHitCount`). 0 bei vorhandenen Treffern nach
	// einer langsamen Suche = Meili hat am searchCutoffMs abgebrochen und nur nach
	// Stichwort gereiht (still, ohne Fehler) – der Treffer-Export prüft darauf.
	semanticHitCount?: number;
	// Strikte Stichwortsuche der Suchseite (server/tiers.ts): so viele Treffer enthalten alle
	// Wörter genau so geschrieben. Sie stehen in der Liste zuerst – nach Relevanz reiht Meili
	// so, nach Datum zwei Stufen –, danach die «ähnlichen Schreibungen» (Wortanfang,
	// Tippfehler, Zerlegung). Ungesetzt = keine solche Grenze (Thema, ODER, «nur im Titel»).
	exactTotal?: number;
}

export interface SearchParams {
	// Suchbegriff (lexikalisch, BM25). Kombinierbar mit `theme`.
	q: string;
	// Lexikalische ODER-Begriffe (echte Union, BM25): >= 2 Begriffe schalten den
	// ODER-Modus – die Trefferliste ist die deduplizierte Vereinigung der
	// Einzelsuchen (Meili-Föderation, s. searchDocumentsUnion). Mehrwortige
	// Begriffe sind erlaubt (URL-Param `qAny` als wiederholter Parameter). v1 ist
	// rein lexikalisch (keine Thema-/Vektor-Kombi). Leer/1 Begriff = kein ODER.
	anyTerms: string[];
	// Thema (semantisch, Vektor-Ähnlichkeit): bei Relevanz-Sortierung ein
	// reines Ranking der Treffermenge (Filter-Menge bzw. Suchbegriff-/ODER-
	// Treffer, kein Schnitt); bei Datums-Sortierung wählt es die `topK`
	// ähnlichsten daraus, die dann chronologisch sortiert werden.
	theme: string;
	series: SeriesAbbr[];
	dateFrom: number | null;
	dateTo: number | null;
	// Intern (kein URL-Param mehr): >0 aktiviert die Hybrid-Pfade. Wird vom
	// Parser aus `theme` abgeleitet (Thema gesetzt → 0.7).
	semanticRatio: number; // 0 = lexical, 1 = pure vector
	sort: "relevance" | "date_asc" | "date_desc";
	page: number;
	pageSize: number;
	// «Themen-Umfang»: wie viele thematisch ähnlichste Dokumente bei
	// Datums-Sortierung das sortierte Set bilden. Greift in ALLEN
	// Thema+Datums-Sort-Modi – allein (Top-K der Filter-Menge) wie mit
	// Suchbegriff/ODER (Top-K innerhalb von deren Treffern; die Treffermenge
	// bildet weiterhin der Suchbegriff, NICHT das Thema – die umgekehrte
	// Richtung war der 2026-06 entfernte Alt-Schnitt). Bei Relevanz-Sortierung
	// rankt das Thema ohne Schnitt, topK ist dort wirkungslos. null =
	// DEFAULT_TOPK in den Schnitt-Modi, wirkt nur mit gesetztem `theme`.
	topK: number | null;
	// Serien-spezifische Multi-Select-Filter. UI zeigt sie nur an, wenn genau
	// eine Serie aktiv ist; der Filter selbst greift unabhängig – wer mit
	// volumeNr=40 auch OS+RRB aktiviert, sieht nur OS-Treffer (RRB hat keinen
	// volumeNr). Leere Liste = kein Filter.
	volumeNr: number[];       // OS
	startPg: number[];        // OS + ABl
	serialNr: string[];       // OS LS-Loseblatt-Systematik ab 1981, z.B. "632.31"
	resolutionId: string[];   // RRB-Identifier "JJJJ/NNNN", z.B. "1803/0003"
	years: number[];          // ABl Jahrgang (Multi-Select über dateYear)
	// Named-Entity-Filter (serienübergreifend): die Form ODER derselbe
	// Vergleichsschlüssel (lib/entityFilter.ts, Fassung 2 von entityKey.ts), sobald
	// der documents-Index die Schlüsselfelder trägt (entityKeysReady); sonst und
	// bei `entityMatch: "exact"` nur die Form. Mehrere Werte derselben Dimension =
	// OR; verschiedene Dimensionen = AND.
	persons: string[];
	places: string[];
	organizations: string[];
	// "exact" = Namensfilter nur auf die Form (öffentliche API mit den Mehrzahl-
	// Parametern persons/places/organizations, deren Bedeutung v1 zusagt). Fehlt = Form
	// oder Schlüssel.
	entityMatch?: "exact";
	// Nur-Titel-Suche: beschränkt die lexikalische Suche (Suchbegriff `q` +
	// ODER-Begriffe `anyTerms`) auf das Titelfeld (Meili `attributesToSearchOn:
	// ["title"]`, Suchzeit-Option, KEIN Re-Index). Zielt auf das gezielte
	// Auffinden EINES Dokuments über seinen Titel – im Volltext geht der exakte
	// Titel-Treffer sonst im Rauschen unter. Wirkt nur auf den BM25-Arm; bei
	// Thema-allein (kein Suchbegriff) bedeutungslos und darum ignoriert (der
	// Vektor rankt den ganzen Doc).
	titleOnly: boolean;
}

export const DEFAULT_SEARCH: SearchParams = {
	q: "",
	anyTerms: [],
	theme: "",
	series: [],
	dateFrom: null,
	dateTo: null,
	semanticRatio: 0,
	sort: "relevance",
	page: 1,
	pageSize: 20,
	topK: null,
	volumeNr: [],
	startPg: [],
	serialNr: [],
	resolutionId: [],
	years: [],
	persons: [],
	places: [],
	organizations: [],
	titleOnly: false,
};

// Dimensionen-Konfig pro Serie für die UI: welche Facetten erscheinen, wenn
// genau diese eine Serie ausgewählt ist. Reihenfolge bestimmt die Anzeige-
// Reihenfolge in der Sidebar.
export type FacetDimension =
	| "volumeNr"
	| "startPg"
	| "serialNr"
	| "resolutionId"
	| "dateYear";

export const FACET_DIMENSION_LABEL: Record<FacetDimension, string> = {
	volumeNr: "Bandnummer",
	startPg: "Startseite",
	serialNr: "Ordnungsnummer",
	resolutionId: "Beschlussnummer",
	dateYear: "Jahrgang",
};

// String-Dimensionen erwarten String-Werte (kein parseInt in URL/Combobox).
// Numerische Dimensionen sind alles andere.
export const STRING_FACET_DIMENSIONS: FacetDimension[] = ["serialNr", "resolutionId"];

export const FACETS_BY_SERIES: Record<SeriesAbbr, FacetDimension[]> = {
	OS: ["volumeNr", "startPg", "serialNr"],
	ABl: ["startPg", "dateYear"],
	RRB: ["resolutionId"],
	KRP: [],
	// volumeNr = Nummer des Bandes in StAZH B II («Alle Sitzungen dieses Bandes»).
	RM: ["volumeNr"],
};

// Entity-Facetten – serienübergreifend, immer sichtbar (im Gegensatz zu den
// serien-spezifischen FACETS_BY_SERIES, die nur bei Single-Series greifen).
export type EntityFacetDimension = "persons" | "places" | "organizations";

export const ENTITY_FACETS: EntityFacetDimension[] = [
	"persons",
	"places",
	"organizations",
];

export const ENTITY_FACET_LABEL: Record<EntityFacetDimension, string> = {
	persons: "Personen",
	places: "Orte",
	organizations: "Organisationen",
};

// Mögliche Umfänge des Thema-Filters. Kein "Alle" – bei Vektor-Ähnlichkeit
// ist jeder Doc "ähnlich" mit irgendeinem Score, eine endliche Top-N ist immer
// sinnvoller als "alle".
export const TOPK_OPTIONS: number[] = [25, 50, 100, 250, 1000];
export const DEFAULT_TOPK = 100;

// Deckel fürs Blättern nach Relevanz ohne Thema (server/browseLimit.ts), für den Export mit Thema
// und für die erste Bedingung der Feldsuche im Katalog. Listen mit Thema enden früher
// (THEME_LIST_MAX, server/themeOrder.ts).
export const CORPUS_CAP = 10_000;

// Fallback-Grenzen, falls die echte Korpus-Verteilung (noch) nicht vorliegt.
// Der Zeitstrahl nimmt im Normalfall die dynamischen Grenzen aus
// yearBoundsFromDistribution() (äusserste Jahre mit Dokumenten); seine Achse
// beginnt nur mit Treffern vor 1803 früher und endet bei reinen
// Ratsmanual-Suchen 1798 (timelineAxis in timelineBins.ts).
export const DATE_BOUNDS = { min: CORPUS_YEAR_MIN, max: new Date().getFullYear() };

/**
 * Äusserste Jahre, die im Korpus tatsächlich Dokumente haben – abgeleitet aus
 * einer dateYear-facetDistribution (`{ "1803": 42, … }`). Fällt auf DATE_BOUNDS
 * zurück, wenn die Verteilung leer ist.
 */
export function yearBoundsFromDistribution(
	dist: Record<string, number>,
): { min: number; max: number } {
	const years = Object.entries(dist)
		.filter(([, count]) => count > 0)
		.map(([year]) => Number(year))
		.filter((n) => Number.isFinite(n));
	if (years.length === 0) return { ...DATE_BOUNDS };
	return { min: Math.min(...years), max: Math.max(...years) };
}
