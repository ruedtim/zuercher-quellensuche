// Werkzeug `edition_search` des MCP-Servers: Schema und Argumente. Ein Werkzeug für alle
// Editionen (Edition als Enum, Plan E4). Pur (ohne $env und Meili), unit-getestet in
// editionTool.test.ts; die Abfrage macht queryEditions (editionTexts.ts), MCP gibt die Treffer
// als JSON aus (mcp/tools.ts). Bis 2026-11 nutzte auch der Recherche-Modus der Website das
// Werkzeug (Branch archiv/ki-antwort).

import { EDITIONS, type EditionKey } from "$lib/editions";
import {
	INDEXED_EDITIONS,
	isIndexedEdition,
	NO_EDITIONS_FILTERS,
	type EditionsFilterValues,
	type EditionsShared,
} from "$lib/editionTexts";
import type { SearchParams } from "$lib/types";

export const EDITION_TOOL = "edition_search";
export const EDITION_TOPK_DEFAULT = 8;
export const EDITION_TOPK_MAX = 20;
/** Jahre der Editionen (QZH 1275–1795, Rechtsquellen 1180–1800; weitere bis ins 19. Jahrhundert). */
export const EDITION_YEAR_MIN = 700;
export const EDITION_YEAR_MAX = 2100;

const editionList = () => INDEXED_EDITIONS.map((e) => `${e} = ${EDITIONS[e].name}`).join(", ");

export const EDITION_TOOL_DESC = `Durchsucht die Editionen des Staatsarchivs: geprüfte Abschriften einzelner Quellenstücke mit Titel, Regest, Kommentar und Anmerkungen der Bearbeitung, Personen (Normnamen) und Orten. ${INDEXED_EDITIONS.map((e) => EDITIONS[e].about).join(". ")}. Zitierform der Rechtsquellen «SSRQ ZH NF II/3 Nr. 47» (Nummern je Band; Feld label). Wörtlich (query) im frühneuhochdeutschen Quellentext («töuffer», «zů», «daß», «offnung»), in Titel, Regest, Schlagwörtern, Kommentar und Anmerkungen; alle Wörter müssen vorkommen. Nach Bedeutung (semantic=true) über Titel, Schlagwörter, Regest und Kommentar (modernes Deutsch).`;

const text = (what: string) => ({ type: "string", description: what });
export const EDITION_TOOL_PARAMETERS = {
	type: "object",
	properties: {
		query: text(
			"Suchwörter. Wörtlich: alle müssen vorkommen; der Quellentext ist frühneuhochdeutsch – nimm alte Schreibungen («töuffer», «widertöuffer», «predicant») oder Wörter aus Titel und Regest (modernes Deutsch: «Täufer», «Ratsbeschluss»). Mit semantic=true: das Thema in wenigen Wörtern.",
		),
		semantic: {
			type: "boolean",
			description:
				"true = nach Bedeutung über Titel, Schlagwörter, Regest und Kommentar (findet Stücke zu einem Thema auch ohne deine Wörter), nach Ähnlichkeit geordnet. Nicht für Namen und alte Schreibungen.",
		},
		edition: { type: "string", enum: [...INDEXED_EDITIONS], description: `Nur eine Edition: ${editionList()}. Weglassen = alle.` },
		person: text("Person, wie die Edition sie verzeichnet («Heinrich Bullinger»; Schreibvarianten zählen mit)."),
		place: text("Ort («Grüningen», «Zürich»)."),
		keyword: text("Schlagwort der Edition («Täufertum», «Armenversorgung», «Konfession»; Rechtsquellen etwa «Offnung», «Gericht», «Zehnt»)."),
		dateFrom: { type: "integer", description: "Frühestes Jahr." },
		dateTo: { type: "integer", description: "Spätestes Jahr." },
		sort: { type: "string", enum: ["relevance", "date_asc", "date_desc"], description: "Sortierung; ohne query chronologisch." },
		topK: { type: "integer", description: `Anzahl Stücke (1–${EDITION_TOPK_MAX}, Default ${EDITION_TOPK_DEFAULT}).` },
	},
	required: [],
} as const;

/** Was edition_search abfragt (queryEditions). */
export interface EditionToolQuery {
	q: string;
	semantic: boolean;
	sort: SearchParams["sort"];
	limit: number;
	filters: EditionsFilterValues;
	shared: EditionsShared;
	/** Die Kriterien in Worten (Kopf des Ergebnisses). */
	criteria: string[];
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
function year(v: unknown): number | null {
	const n = typeof v === "number" ? v : typeof v === "string" && /^\d{3,4}$/.test(v.trim()) ? Number(v) : Number.NaN;
	return Number.isInteger(n) ? Math.min(EDITION_YEAR_MAX, Math.max(EDITION_YEAR_MIN, n)) : null;
}

/** Argumente des Modells bzw. eines MCP-Clients → Abfrage; unbekannte Werte fallen weg. */
export function normalizeEditionArgs(raw: Record<string, unknown>, opts: { maxTopK?: number; defaultTopK?: number } = {}): EditionToolQuery {
	const q = str(raw.query, 300);
	const semantic = raw.semantic === true && q !== "";
	const edition: EditionKey | null = isIndexedEdition(raw.edition) ? raw.edition : null;
	const person = str(raw.person);
	const place = str(raw.place);
	const keyword = str(raw.keyword);
	let dateFrom = year(raw.dateFrom);
	let dateTo = year(raw.dateTo);
	if (dateFrom != null && dateTo != null && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
	const sort = raw.sort === "date_asc" || raw.sort === "date_desc" ? raw.sort : "relevance";
	const max = opts.maxTopK ?? EDITION_TOPK_MAX;
	const topK = typeof raw.topK === "number" && Number.isFinite(raw.topK) ? Math.trunc(raw.topK) : (opts.defaultTopK ?? EDITION_TOPK_DEFAULT);
	const criteria = [
		q ? `${semantic ? "nach Bedeutung" : "Suchwörter"} «${q}»` : "",
		edition ? `Edition ${EDITIONS[edition].short}` : "",
		person ? `Person «${person}»` : "",
		place ? `Ort «${place}»` : "",
		keyword ? `Schlagwort «${keyword}»` : "",
		dateFrom != null || dateTo != null ? `${dateFrom ?? "…"}–${dateTo ?? "…"}` : "",
	].filter(Boolean);
	return {
		q,
		semantic,
		sort,
		limit: Math.min(max, Math.max(1, topK)),
		filters: { ...NO_EDITIONS_FILTERS, edition: edition ? [edition] : [], keyword: keyword ? [keyword] : [] },
		shared: { dateFrom, dateTo, persons: person ? [person] : [], places: place ? [place] : [], organizations: [] },
		criteria,
	};
}
