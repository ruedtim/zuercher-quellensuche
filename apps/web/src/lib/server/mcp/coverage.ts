// Selbstbeschreibung des MCP-Servers: Was liegt hier, wie viel, von wann bis wann,
// mit welchen Lücken, mit welchem Werkzeug durchsuchbar und unter welcher Lizenz.
// Dasselbe als Werkzeug `coverage` (tools/call) und als Ressource `zszh://coverage`
// (resources/read) – unabhängig davon, ob ein Client die `instructions` aus initialize
// durchreicht (manche kürzen sie, manche lassen sie ganz weg).
//
// Reine (env-freie) Hälfte: die festen Texte und buildCoverage(). Die Zahlen und
// Jahresangaben holt der I/O-Teil (tools.ts, coverageData) live aus den Indizes und
// gibt sie als `CoverageLive` herein; eine Quelle, die nicht lesbar ist, kommt als null
// und wird im Bericht als «nicht lesbar» markiert (`error`), statt die Antwort zu
// verhindern. Lizenz, Nennung und Bestandsgrenzen kommen aus den bestehenden Single
// Sources (apiV1/constants, $lib/ehedaten, $lib/editions, $lib/catalog) – alles Übrige
// steht hier, einmal, mit COVERAGE_AS_OF als Stand.

import { ATTRIBUTION, CATALOG_SOURCE, CATALOG_SOURCE_URL, LICENSE, LICENSE_URL } from "../apiV1/constants";
import { INCOMPLETE_SERIES } from "../searchTools";
import { CATALOG_COMPLETE_BY, CATALOG_IN_PROGRESS, CATALOG_YEAR_MIN } from "$lib/catalog";
import {
	EHEDATEN_ATTRIBUTION,
	EHEDATEN_LICENSE,
	EHEDATEN_LICENSE_URL,
	EHEDATEN_SOURCE,
	EHEDATEN_YEAR_MAX,
	EHEDATEN_YEAR_MIN,
} from "$lib/ehedaten";
import { EDITIONS, type EditionKey } from "$lib/editions";
import { SERIES_LABEL, type SeriesAbbr } from "$lib/types";

/** URI der Ressource mit demselben Inhalt (resources/list, resources/read). */
export const COVERAGE_URI = "zszh://coverage";

/**
 * Stand der FESTEN Angaben dieser Datei (die Sätze unten und EDITION_YEARS). Umfang,
 * Zeitspannen und Lücken der Bestände kommen live aus den Indizes und veralten nicht.
 * Bei einer Änderung an den Texten hier mitführen.
 */
export const COVERAGE_AS_OF = "17.11.2026";

/** Zeitspanne in Jahren (beide Grenzen inklusive). */
export interface YearRange {
	from: number;
	to: number;
}

/** «1803–2026» bzw. «1803» (Halbgeviertstrich wie überall). */
export function yearLabel(r: YearRange | null): string | null {
	if (!r) return null;
	return r.from === r.to ? String(r.from) : `${r.from}–${r.to}`;
}

/**
 * Zusammenhängende Jahresläufe aus einer `dateYear`-Facette (Jahr → Anzahl): jede Folge
 * von Jahren mit mindestens einem Dokument wird ein Lauf. Zwischen zwei Läufen liegt eine
 * Lücke – so stehen die Lücken live im Index und nicht als Konstante im Code (RRB 1996–2007
 * und RM 1516–1544 fallen von selbst heraus, und sie wandern mit der Digitalisierung).
 */
export function yearRuns(dist: Record<string, number> | null | undefined): YearRange[] {
	const years = Object.entries(dist ?? {})
		.filter(([, count]) => count > 0)
		.map(([year]) => Number(year))
		.filter((y) => Number.isInteger(y))
		.sort((a, b) => a - b);
	const runs: YearRange[] = [];
	for (const y of years) {
		const last = runs[runs.length - 1];
		if (!last) runs.push({ from: y, to: y });
		else if (y === last.to + 1) last.to = y;
		else if (y > last.to) runs.push({ from: y, to: y });
	}
	return runs;
}

/** Höchstens so viele Lücken werden aufgezählt; bei mehr nur die grössten plus ihre Zahl –
 *  ein lückenhafter Index (Teilstand) ergäbe sonst eine Aufzählung über Dutzende Jahre. */
const GAPS_MAX = 3;

/** Die Jahre ZWISCHEN den Läufen: «1996–2007» bzw. «1516–1544 und 1996–2007». */
export function gapLabel(runs: readonly YearRange[], max = GAPS_MAX): string | null {
	const gaps: YearRange[] = [];
	for (let i = 1; i < runs.length; i++) {
		const gap = { from: runs[i - 1].to + 1, to: runs[i].from - 1 };
		if (gap.to >= gap.from) gaps.push(gap);
	}
	if (gaps.length === 0) return null;
	const span = (g: YearRange) => g.to - g.from;
	// Die grössten Lücken zuerst auswählen, dann wieder chronologisch zeigen.
	const shown = (gaps.length <= max ? gaps : [...gaps].sort((a, b) => span(b) - span(a) || a.from - b.from).slice(0, max)).slice().sort((a, b) => a.from - b.from);
	const labels = shown.map((g) => yearLabel(g) as string);
	const rest = gaps.length - shown.length;
	const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} und ${labels[labels.length - 1]}`;
	return rest > 0 ? `${list} sowie ${rest} weitere${rest === 1 ? " Lücke" : " Lücken"}` : list;
}

// --- Live-Zahlen (vom I/O-Teil) ----------------------------------------------

/** Eine Serie, wie der I/O-Teil sie liefert: die Angaben von getSeriesInfo (wie
 *  /api/v1/series, 5 min gecacht) plus die Jahresläufe aus derselben `dateYear`-Facette. */
export interface CoverageSeries {
	abbr: SeriesAbbr;
	name: string;
	description: string;
	documents: number;
	years: YearRange | null;
	runs: YearRange[];
}

/** Live-Zahlen je Quelle; `null` = Index gerade nicht lesbar. */
export interface CoverageLive {
	series: CoverageSeries[] | null;
	catalog: { units: number } | null;
	ehedaten: { entries: number } | null;
	editions: { pieces: number; byEdition: Partial<Record<EditionKey, number>> } | null;
}

// --- Bericht -----------------------------------------------------------------

/** Ein Teil eines Bestands: eine Serie (mit eigenen Lücken) bzw. eine Edition (mit
 *  eigener Lizenz – die Lizenz des Bestands verweist dann hierher). */
export interface CoveragePart {
	id: string;
	name: string;
	about?: string;
	count: number | null;
	years: string | null;
	gaps?: string;
	cite?: string;
	license?: string;
	attribution?: string;
	/** Rechte an den Abbildungen, wenn sie andere sind als die der Texte. */
	images?: string;
}

export interface CoverageCollection {
	id: string;
	name: string;
	/** Was der Bestand ist, in einem Satz. */
	about: string;
	/** Was gezählt wird («Dokumente», «Verzeichnungseinheiten», …). */
	unit: string;
	/** Umfang; null = Quelle nicht lesbar (Grund in `error`). */
	count: number | null;
	years: string | null;
	gaps: string;
	parts?: CoveragePart[];
	/** Welche Werkzeuge den Bestand durchsuchen und WIE: Suchart → Werkzeuge, dazu die
	 *  Eigenheiten, die kein Werkzeugname verrät (keine Vektoren, kein Volltext …). */
	search: { byMode: Record<string, string[]>; note: string };
	license: string;
	licenseUrl?: string;
	attribution: string;
	source?: string;
	sourceUrl?: string;
	/** Fehlercode wie bei den Suchwerkzeugen, wenn die Quelle nicht lesbar ist. */
	error?: string;
}

export interface CoverageReport {
	collections: CoverageCollection[];
	/** Stand der festen Angaben (die Zahlen sind live). */
	asOf: string;
	note: string;
}

const SERIES_ORDER: SeriesAbbr[] = ["ABl", "KRP", "OS", "RRB"];

/**
 * Zeitspanne der Editionen – die einzige Zahl, die hier als Konstante steht: Die Stücke
 * tragen ihr Datum, aber der Index kennt keine Jahres-Facette, und eine Min/Max-Abfrage
 * wären zwei Suchen für eine Angabe, die sich nur mit einer neuen Edition ändert. Stand
 * COVERAGE_AS_OF; den Satz zum Inhalt hält EDITIONS[*].about ($lib/editions).
 */
const EDITION_YEARS: Readonly<Record<EditionKey, YearRange>> = {
	qzh: { from: 1275, to: 1795 },
	ssrq: { from: 1180, to: 1800 },
};

/** Was AUSSERHALB der Jahresläufe fehlt, je Serie – ohne Jahreszahlen, die stehen live. */
const SERIES_GAP_NOTE: Partial<Record<SeriesAbbr, string>> = {
	ABl:
		"Das Amtsblatt erscheint seit 1834; digitalisiert sind bisher nur die Jahrgänge dieser Spanne " +
		"(das Staatsarchiv arbeitet von 2001 rückwärts), davor und danach fehlen Jahrgänge.",
	RRB:
		"Die Jahre zwischen den Spannen sind nicht digitalisiert; der born-digital Spätbestand aus den " +
		"Open Data des Kantons beginnt im Oktober 2008.",
	KRP:
		"Durchgehend: der digitalisierte Altbestand endet im April 1995, die Sitzungen ab Mai 1995 kommen " +
		"aus dem Web-Service des Kantonsrats.",
	OS:
		"Durchgehend: der digitalisierte Altbestand endet 1998, die Erlass-Publikationen ab 1999 kommen " +
		"aus ZH-Lex.",
	RM:
		"Nur die Bände, die das Staatsarchiv transkribiert hat; Sitzungen ohne lesbares Datum tragen den " +
		"Zeitraum ihres Bandes.",
};

const NO_GAPS = "Keine Lücke bekannt.";

function gapsOf(runs: readonly YearRange[], note?: string): string {
	const gap = gapLabel(runs);
	return [gap ? `Keine Dokumente ${gap}.` : "", note].filter(Boolean).join(" ") || NO_GAPS;
}

/** Die wörtlichen Werkzeuge über die Dokumente: ALLE Wörter der query müssen vorkommen. */
const LEXICAL_DOC_TOOLS = ["keyword_search", "list_documents", "count_documents", "timeline", "overview"];

const SERIEN_SEARCH: CoverageCollection["search"] = {
	byMode: {
		Passagen: ["passage_search"],
		"nach Bedeutung": ["semantic_search", "similar_documents", "vector_search", "search"],
		wörtlich: LEXICAL_DOC_TOOLS,
	},
	note:
		"Volltext. Volltext einzelner Treffer mit fetch/fetch_many. Die wörtlichen Werkzeuge verlangen " +
		"ALLE Wörter der query; vector_search erwartet einen extern gerechneten Qwen3-Vektor und erreicht " +
		"nur den digitalisierten Altbestand, nicht die born-digital Spätbestände.",
};

const RM_SEARCH: CoverageCollection["search"] = {
	byMode: { wörtlich: LEXICAL_DOC_TOOLS },
	note:
		"Volltext, aber ohne Vektoren: NUR wörtlich (fetch/fetch_many holen den Text). passage_search und " +
		"vector_search erreichen die Ratsmanuale nicht, similar_documents findet keine Nachbarn, " +
		"semantic_search läuft hier als Stichwortsuche. Alte Schreibungen gehören in alternatives " +
		"(Kilch/Kirche, Gmeind/Gemeinde); Nasalstrich und ß gleicht die Suche selbst an.",
};

/** Die fünf Bestände mit den festen Angaben; Umfang, Jahre und Lücken kommen live. */
function collections(live: CoverageLive): CoverageCollection[] {
	const incomplete = INCOMPLETE_SERIES.map((s) => SERIES_LABEL[s]).join(" und ");
	const byAbbr = new Map((live.series ?? []).map((s) => [s.abbr, s]));
	const serien = SERIES_ORDER.map((abbr) => byAbbr.get(abbr)).filter((s): s is CoverageSeries => !!s);
	const serienRange = serien.reduce<YearRange | null>(
		(acc, s) => (!s.years ? acc : acc ? { from: Math.min(acc.from, s.years.from), to: Math.max(acc.to, s.years.to) } : { ...s.years }),
		null,
	);
	const rm = byAbbr.get("RM");
	const editionKeys = Object.keys(EDITIONS) as EditionKey[];
	const editionRange = editionKeys.reduce<YearRange>(
		(acc, k) => ({ from: Math.min(acc.from, EDITION_YEARS[k].from), to: Math.max(acc.to, EDITION_YEARS[k].to) }),
		{ from: EDITION_YEARS.qzh.from, to: EDITION_YEARS.qzh.to },
	);

	return [
		{
			id: "serien",
			name: "Zentrale Serien",
			about:
				"Die Zentralen Serien ab 1803, amtliche Volltexte des Kantons Zürich (das Amtsblatt in den digitalisierten Jahrgängen): Amtsblatt, Kantonsratsprotokolle, " +
				"Gesetzessammlung und Regierungsratsbeschlüsse – je Geschäft, Beschluss oder Erlass ein Dokument.",
			unit: "Dokumente",
			count: live.series ? serien.reduce((sum, s) => sum + s.documents, 0) : null,
			years: yearLabel(serienRange),
			gaps:
				`Je Serie verschieden (siehe parts): ${incomplete} sind nur unvollständig digitalisiert. Die ` +
				"Jahreszahlen verschieben sich mit der Digitalisierung – darum kommen sie hier live aus dem Index.",
			parts: serien.map((s) => ({
				id: s.abbr,
				name: s.name,
				about: s.description,
				count: s.documents,
				years: yearLabel(s.years),
				gaps: gapsOf(s.runs, SERIES_GAP_NOTE[s.abbr]),
			})),
			search: SERIEN_SEARCH,
			license: LICENSE,
			licenseUrl: LICENSE_URL,
			attribution: ATTRIBUTION,
			...(live.series ? {} : { error: "documents_unavailable" }),
		},
		{
			id: "rm",
			name: SERIES_LABEL.RM,
			about:
				"Der älteste Teil der Zentralen Serien: Sitzungsprotokolle des Rats von Stadt und Republik Zürich (StAZH B II), je Sitzung ein Dokument, " +
				"maschinell transkribiert (Lesefehler möglich); Daten bis 1700 im alten Stil, nicht umgerechnet.",
			unit: "Sitzungen",
			count: rm ? rm.documents : null,
			years: rm ? yearLabel(rm.years) : null,
			// Ohne Live-Zahlen bleibt die feste Angabe stehen – «keine Lücke» wäre dann eine Behauptung.
			gaps: rm ? gapsOf(rm.runs, SERIES_GAP_NOTE.RM) : (SERIES_GAP_NOTE.RM as string),
			search: RM_SEARCH,
			license: LICENSE,
			licenseUrl: LICENSE_URL,
			attribution: ATTRIBUTION,
			...(rm ? {} : { error: "documents_unavailable" }),
		},
		{
			id: "catalog",
			name: "Archivkatalog",
			about:
				"Die Verzeichnungseinheiten des Online-Archivkatalogs des Staatsarchivs – Akten, Urkunden, Pläne, " +
				"Nachlässe, Personendossiers, Fotos: Sie zeigen, WAS im Archiv liegt, mit Signatur und Permalink.",
			unit: "Verzeichnungseinheiten",
			count: live.catalog ? live.catalog.units : null,
			years: `Mittelalter bis Gegenwart (der Zeitraum-Filter reicht von ${CATALOG_YEAR_MIN} bis heute)`,
			gaps:
				"KEIN Volltext – nur die Verzeichnungsangaben; was in den Akten steht, sagt der Katalog nicht. " +
				"Einheiten, welche die Plattform selbst als Dokument führt, sind ausgenommen (dort über die " +
				"Dokument-Werkzeuge suchen)." +
				(CATALOG_IN_PROGRESS ? ` Der Katalog wird noch übernommen (bis ${CATALOG_COMPLETE_BY}); bis dahin fehlen Einheiten.` : ""),
			search: {
				byMode: { wörtlich: ["catalog_search"], "nach Bedeutung": ["catalog_search (semantic=true)"] },
				note:
					"Gesucht wird in Signatur, Titel, Verzeichnungsangaben und Provenienz (alle Wörter der query, ß gilt als ss). " +
					"semantic=true erreicht nur Einheiten mit Vektor – Personendossiers, Eheeinträge und Firmen haben " +
					"keinen. Das letzte Suchwort trifft als Wortanfang («Pest» → «Pestalozzi»).",
			},
			// Entscheid 2026-10-28: Die Katalogbeschreibungen verfasst das Staatsarchiv, sie sind keine
			// amtlichen Erlasse – darum keine Lizenzangabe, sondern der Nachweis mit Signatur und Permalink.
			license: "keine Lizenzangabe",
			attribution: CATALOG_SOURCE,
			source: CATALOG_SOURCE,
			sourceUrl: CATALOG_SOURCE_URL,
			...(live.catalog ? {} : { error: "catalog_unavailable" }),
		},
		{
			id: "ehedaten",
			name: "Zürcher Ehedaten",
			about:
				"Trauungen und Verkündungen aus den Zürcher Kirchenbüchern (Ehedatenbank des Staatsarchivs): " +
				"je Eintrag Brautpaar, Herkunft, Kirchgemeinde und Datum.",
			unit: "Eheeinträge",
			count: live.ehedaten ? live.ehedaten.entries : null,
			years: `${EHEDATEN_YEAR_MIN}–${EHEDATEN_YEAR_MAX}`,
			gaps:
				"Nur die erhaltenen Kirchenbücher; Überlieferungslücken der Gemeinden bleiben Lücken. Gezählt " +
				"werden EINTRÄGE, nicht Ehen – dieselbe Ehe steht oft in zwei Büchern (sameMarriage). Gleicher " +
				"Name Jahrzehnte auseinander heisst verschiedene Personen.",
			search: {
				byMode: { wörtlich: ["ehedaten_search"] },
				note:
					"Nur wörtlich: Namen, Herkunft, Kirchgemeinde, Signatur und Zusatzinformation; keine Vektoren, " +
					"keine Passagen. Namen sind vereinheitlicht (Originalschreibung in note; ß gilt als ss), Daten bis " +
					"1700 stehen im alten Stil.",
			},
			license: EHEDATEN_LICENSE,
			licenseUrl: EHEDATEN_LICENSE_URL,
			attribution: EHEDATEN_ATTRIBUTION,
			source: EHEDATEN_SOURCE,
			...(live.ehedaten ? {} : { error: "ehedaten_unavailable" }),
		},
		{
			id: "editions",
			name: "Editionen",
			about:
				"Geprüfte Abschriften zweier Editionen mit Regest, Kommentar und Anmerkungen der Bearbeitung – " +
				"die einzigen Texte hier, die eine Edition gelesen und eingeordnet hat.",
			unit: "Editionsstücke",
			count: live.editions ? live.editions.pieces : null,
			years: yearLabel(editionRange),
			gaps:
				"Nur die beiden bisher übernommenen Editionen; weitere Editionen des Staatsarchivs fehlen. Bei den " +
				"Rechtsquellen ist je Nummer EIN Stück erfasst, weitere Überlieferungen sind nur beschrieben (witnesses).",
			parts: editionKeys.map((key) => ({
				id: key,
				name: EDITIONS[key].name,
				about: EDITIONS[key].about,
				count: live.editions ? (live.editions.byEdition[key] ?? 0) : null,
				years: yearLabel(EDITION_YEARS[key]),
				cite: EDITIONS[key].short,
				license: EDITIONS[key].license,
				attribution: EDITIONS[key].attribution,
				...(EDITIONS[key].images ? { images: EDITIONS[key].images.label } : {}),
			})),
			search: {
				byMode: { wörtlich: ["edition_search"], "nach Bedeutung": ["edition_search (semantic=true)"] },
				note:
					"Volltext der Abschriften wörtlich (Lesefassung mit aufgelösten Abkürzungen). semantic=true reiht " +
					"nach Titel, Schlagwörtern, Regest und Kommentar – NICHT nach dem Quellentext. `id` lädt ein Stück ganz.",
			},
			// Lizenz und Nennung gelten je Edition – sie stehen an den parts, wie an jedem Stück
			// (license/attribution von edition_search), und sind bei Weitergabe anzugeben.
			license: `je Edition, siehe parts (${editionKeys.map((k) => `${EDITIONS[k].short} ${EDITIONS[k].license}`).join(", ")})`,
			attribution: "je Edition, siehe parts",
			...(live.editions ? {} : { error: "editions_unavailable" }),
		},
	];
}

/** Der Bericht: feste Texte plus die live gelesenen Zahlen. Pure → testbar. */
export function buildCoverage(live: CoverageLive): CoverageReport {
	return {
		collections: collections(live),
		asOf: COVERAGE_AS_OF,
		note:
			"Umfang, Zeitspannen und Lücken kommen live aus den Indizes (5 min gecacht); die Jahresangaben " +
			"nennen die Jahre MIT Dokumenten, nicht die Laufzeit der Serie. `error` an einem Bestand heisst: " +
			"Quelle gerade nicht lesbar, seine Zahlen fehlen (die übrigen gelten). Feste Angaben Stand " +
			`${COVERAGE_AS_OF}. Derselbe Bericht als Ressource ${COVERAGE_URI}.`,
	};
}
