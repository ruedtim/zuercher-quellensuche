// Werkzeug `ehedaten_search` des MCP-Servers: Schema, Argumente und der Hinweis auf
// Namensvettern. Pur (ohne $env und Meili), unit-getestet in ehedatenTool.test.ts; die Abfrage
// macht queryEhedaten (ehedaten.ts), MCP gibt die Treffer als JSON aus (mcp/tools.ts). Bis
// 2026-11 nutzte auch der Recherche-Modus der Website das Werkzeug (Branch archiv/ki-antwort).

import {
	EHEDATEN_RAEUME,
	EHEDATEN_YEAR_MAX,
	EHEDATEN_YEAR_MIN,
	NO_EHEDATEN_FILTERS,
	RAUM_LABEL,
	STADT_ZUERICH,
	STADT_ZUERICH_KIRCHGEMEINDEN,
	nameTokens,
	type EhedatenArt,
	type EhedatenEntry,
	type EhedatenFilterValues,
	type EhedatenRaum,
	type EhedatenShared,
} from "$lib/ehedaten";
import { personKey } from "$lib/entityKey";
import type { SearchParams } from "$lib/types";
import type { EhedatenGroupBy } from "./ehedaten";

export const EHEDATEN_TOOL = "ehedaten_search";
export const EHEDATEN_TOPK_DEFAULT = 10;
export const EHEDATEN_TOPK_MAX = 30;
export const EHEDATEN_GROUPS: readonly EhedatenGroupBy[] = ["kirchgemeinde", "jahr", "jahrzehnt", "raum", "art", "quelle"];
/** Liegen Einträge desselben Namens weiter auseinander, sind es verschiedene Personen. */
const NAMESAKE_YEARS = 40;

export const EHEDATEN_TOOL_DESC =
	"Durchsucht die Zürcher Ehedaten (Ehedatenbank des Staatsarchivs): rund 296'000 Eheeinträge aus den Kirchenbüchern 1524–1800, je Eintrag Bräutigam und Braut mit Herkunft, Datum, Kirchgemeinde, Zusatzinfo (Originalschreibung, Beruf, Bemerkungen) und Signatur. Für Fragen, wer wann wen wo heiratete, zu Personen und Familien des 16.–18. Jahrhunderts und für Zählungen (groupBy: Einträge je Kirchgemeinde, Jahr, Jahrzehnt …). Namen sind vereinheitlicht (Meier auch für Meyer): alle Wörter eines Namens müssen vorkommen, ein Nachname allein trifft alle Träger. Daten bis 1700 im alten Stil (julianisch). Ein Eintrag ist eine Trauung oder eine Verkündung (getraut wurde dann oft in einer anderen Kirchgemeinde); Zählungen zählen Einträge, nicht Ehen.";

const name = (what: string) => ({ type: "string", description: what });
export const EHEDATEN_TOOL_PARAMETERS = {
	type: "object",
	properties: {
		name: name("Name von Bräutigam ODER Braut, z. B. «Heusser» oder «Hans Jakob Heusser» (alle Wörter müssen im Namen stehen)."),
		braeutigam: name("Name des Bräutigams (wie name, nur der Mann)."),
		braut: name("Name der Braut (wie name, nur die Frau)."),
		herkunft: name("Herkunft von Bräutigam oder Braut: Gemeinde («Uster»; Weiler zählen zu ihrer Gemeinde), Kanton («Thurgau») oder Land («Deutschland»)."),
		raum: {
			type: "string",
			enum: ["zh", "ch", "ausland"],
			description:
				"Herkunftsraum von Bräutigam oder Braut (mindestens einer der beiden): zh = Kanton Zürich (auch ohne Angabe), ch = andere Kantone, ausland = Ausland. Wer von beiden, zeigt die Herkunft im Eintrag.",
		},
		kirchgemeinde: {
			type: "string",
			description: `Kirchgemeinde des Eintrags, z. B. «Uster». «${STADT_ZUERICH}» = die Stadtkirchen (${STADT_ZUERICH_KIRCHGEMEINDEN.join(", ")}).`,
		},
		query: {
			type: "string",
			description:
				"Volltext über Namen, Herkunft, Zusatzinfo (Originalschreibung, Beruf, Bemerkungen), Kirchgemeinde und Signatur; alle Wörter müssen vorkommen (z. B. «Pfarrer», «Witwer», «Schuhmacher»). Nicht für Rolle oder Herkunft – dafür gibt es braeutigam, braut, herkunft und raum.",
		},
		dateFrom: { type: "integer", description: `Frühestes Jahr (${EHEDATEN_YEAR_MIN}–${EHEDATEN_YEAR_MAX}).` },
		dateTo: { type: "integer", description: `Spätestes Jahr (${EHEDATEN_YEAR_MIN}–${EHEDATEN_YEAR_MAX}).` },
		art: { type: "string", enum: ["trauung", "verkuendung"], description: "Nur Trauungen bzw. nur Verkündungen. Weglassen = beide." },
		groupBy: {
			type: "string",
			enum: EHEDATEN_GROUPS,
			description: "Zählt die ganze Treffermenge je Wert: kirchgemeinde, jahr, jahrzehnt, raum (Herkunftsraum), art oder quelle (Überlieferung).",
		},
		sort: {
			type: "string",
			enum: ["relevance", "date_asc", "date_desc"],
			description: "Sortierung der Einträge; date_asc = älteste zuerst. Ohne query chronologisch.",
		},
		topK: {
			type: "integer",
			description: `Anzahl Einträge (0–${EHEDATEN_TOPK_MAX}, Default ${EHEDATEN_TOPK_DEFAULT}); 0 mit groupBy = nur zählen.`,
		},
	},
	required: [],
} as const;

/** Was ehedaten_search abfragt (queryEhedaten). */
export interface EhedatenToolQuery {
	q: string;
	sort: SearchParams["sort"];
	limit: number;
	groupBy: EhedatenGroupBy[];
	filters: EhedatenFilterValues;
	shared: EhedatenShared;
	/** Die Kriterien in Worten (Kopf des Ergebnisses). */
	criteria: string[];
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
function year(v: unknown): number | null {
	const n = typeof v === "number" ? v : typeof v === "string" && /^\d{3,4}$/.test(v.trim()) ? Number(v) : Number.NaN;
	return Number.isInteger(n) ? Math.min(EHEDATEN_YEAR_MAX, Math.max(EHEDATEN_YEAR_MIN, n)) : null;
}

/** Argumente des Modells bzw. eines MCP-Clients → Abfrage; unbekannte Werte fallen weg. */
export function normalizeEhedatenArgs(raw: Record<string, unknown>, opts: { maxTopK?: number; defaultTopK?: number } = {}): EhedatenToolQuery {
	// Namen ohne verwertbares Wort («*», «?») filtern nicht – Gemini setzt sie als Platzhalter.
	const nameOf = (v: unknown) => {
		const s = str(v);
		return nameTokens(s).length > 0 ? s : "";
	};
	const nameArg = nameOf(raw.name);
	const mann = nameOf(raw.braeutigam);
	const frau = nameOf(raw.braut);
	const herkunft = str(raw.herkunft);
	const kirche = str(raw.kirchgemeinde);
	const q = str(raw.query, 300);
	let dateFrom = year(raw.dateFrom);
	let dateTo = year(raw.dateTo);
	if (dateFrom != null && dateTo != null && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
	const art: EhedatenArt | null = raw.art === "trauung" || raw.art === "verkuendung" ? raw.art : null;
	const raum = EHEDATEN_RAEUME.includes(raw.raum as EhedatenRaum) ? (raw.raum as EhedatenRaum) : null;
	const groupBy = EHEDATEN_GROUPS.includes(raw.groupBy as EhedatenGroupBy) ? [raw.groupBy as EhedatenGroupBy] : [];
	const sort = raw.sort === "date_asc" || raw.sort === "date_desc" ? raw.sort : "relevance";
	const max = opts.maxTopK ?? EHEDATEN_TOPK_MAX;
	const topK = typeof raw.topK === "number" && Number.isFinite(raw.topK) ? Math.trunc(raw.topK) : (opts.defaultTopK ?? EHEDATEN_TOPK_DEFAULT);
	const limit = Math.min(max, Math.max(groupBy.length > 0 ? 0 : 1, topK));
	const criteria = [
		nameArg ? `Name «${nameArg}»` : "",
		mann ? `Bräutigam «${mann}»` : "",
		frau ? `Braut «${frau}»` : "",
		herkunft ? `Herkunft «${herkunft}»` : "",
		raum ? `Herkunftsraum ${RAUM_LABEL[raum]}` : "",
		kirche ? `Kirchgemeinde ${kirche}` : "",
		q ? `Volltext «${q}»` : "",
		dateFrom != null || dateTo != null ? `${dateFrom ?? EHEDATEN_YEAR_MIN}–${dateTo ?? EHEDATEN_YEAR_MAX}` : "",
		art ? `nur ${art === "trauung" ? "Trauungen" : "Verkündungen"}` : "",
	].filter(Boolean);
	return {
		q,
		sort,
		limit,
		groupBy,
		filters: { ...NO_EHEDATEN_FILTERS, mann: mann ? [mann] : [], frau: frau ? [frau] : [], kirche: kirche ? [kirche] : [], raum: raum ? [raum] : [], art },
		shared: { dateFrom, dateTo, persons: nameArg ? [nameArg] : [], places: herkunft ? [herkunft] : [] },
		criteria,
	};
}

/**
 * Namensvettern: Einträge mit demselben Namen (Personenschlüssel, entityKey.ts), die mehr als
 * NAMESAKE_YEARS Jahre auseinanderliegen, betreffen verschiedene Personen – Gemini machte aus
 * «Hans Jakob Heusser» 1686 und 1791 eine Person mit zwei Ehen (E2E 2026-10-31). Ein Satz je
 * Name; leer ohne solche Fälle.
 */
export function namesakeNote(entries: readonly EhedatenEntry[]): string {
	const years = new Map<string, { name: string; years: number[] }>();
	for (const e of entries) {
		for (const p of [e.mann, e.frau]) {
			const key = personKey(p.name);
			if (!key) continue;
			const g = years.get(key) ?? { name: p.name, years: [] };
			g.years.push(e.dateFrom);
			years.set(key, g);
		}
	}
	const notes = [...years.values()]
		.filter((g) => Math.max(...g.years) - Math.min(...g.years) > NAMESAKE_YEARS)
		.map((g) => {
			const ys = [...new Set(g.years)].sort((a, b) => a - b);
			return `«${g.name}» erscheint ${ys.length > 4 ? `${ys[0]} bis ${ys[ys.length - 1]}` : ys.join(", ")}`;
		});
	return notes.length > 0
		? `Achtung, Namensvettern: ${notes.join("; ")} – mehr als ${NAMESAKE_YEARS} Jahre auseinander sind das verschiedene Personen gleichen Namens (oft Vater, Sohn, Enkel). Ordne Einträge nur bei passendem Datum, Herkunft und Ehepartner derselben Person zu.`
		: "";
}
