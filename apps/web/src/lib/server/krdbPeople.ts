// Personenseiten (/personen, /personen/<ID>): pure Server-Logik – Meili-Filter,
// Ämter-/Parteizeilen und Verzeichnisfilter. Import-frei bis auf
// Matcher und personUrls (kein $lib/$env), unit-getestet (krdbPeople.test.ts).
// URLs und Abfrage-Parameter stehen in $lib/personUrls.ts (auch im Browser
// genutzt); die Meili-/Register-Zugriffe in krdb.ts.

import { councilLabel, displayLastName, displayParty, foldName, type KrdbPerson } from "./krdbMatch";
import { FIRST_YEAR, type DirectoryQuery, type PersonScope } from "../personUrls";

/** Alle IDs einer Person: die aktuelle und frühere (die KRDB vergibt neu). */
export function personIds(p: Pick<KrdbPerson, "id" | "aliases">): number[] {
	return [p.id, ...(p.aliases ?? [])];
}

/** Meili-Filterklauseln (AND) für die Dokumente einer Person. */
export function personFilter(ids: readonly number[], scope: PersonScope): string[] {
	const list = `[${ids.join(", ")}]`;
	switch (scope) {
		case "title":
			return [`krdbTitleIds IN ${list}`];
		case "text":
			return [`krdbIds IN ${list}`, `NOT krdbTitleIds IN ${list}`];
		default:
			return [`krdbIds IN ${list}`];
	}
}

/** Zeitleisten-Achse: Spannweite der Treffer-Jahre, mindestens zehn Jahre. */
export function yearAxis(
	buckets: Record<string, number>,
	nowYear: number,
): { min: number; max: number } {
	const years = Object.keys(buckets)
		.map(Number)
		.filter((y) => Number.isInteger(y) && y >= FIRST_YEAR && y <= nowYear);
	if (years.length === 0) return { min: nowYear - 9, max: nowYear };
	let min = Math.min(...years);
	let max = Math.max(...years);
	const missing = 10 - (max - min + 1);
	if (missing > 0) {
		min -= Math.floor(missing / 2);
		max += Math.ceil(missing / 2);
		if (min < FIRST_YEAR) {
			max += FIRST_YEAR - min;
			min = FIRST_YEAR;
		}
		if (max > nowYear) {
			min = Math.max(FIRST_YEAR, min - (max - nowYear));
			max = nowYear;
		}
	}
	return { min, max };
}

// --- Person: Anzeige ------------------------------------------------------------

export function personName(p: Pick<KrdbPerson, "first" | "last">): string {
	return `${p.first.trim()} ${displayLastName(p.last)}`.trim();
}

export interface OfficeLine {
	/** «Kantonsrat», «Kantonsrätin», «Regierungsrat» … */
	label: string;
	/** «1991–1999, seit 2003» */
	years: string;
	district: string | null;
}

interface Span {
	from: number;
	to: number | null;
}

/** Jahresspannen: aneinander anschliessende (≤ 1 Jahr Lücke) verschmelzen; offen = «seit …». */
function spanText(spans: Span[]): string {
	const sorted = [...spans].sort((a, b) => a.from - b.from);
	const merged: Span[] = [];
	for (const s of sorted) {
		const last = merged[merged.length - 1];
		if (last && (last.to === null || s.from <= last.to + 1)) {
			if (last.to !== null) last.to = s.to === null ? null : Math.max(last.to, s.to);
		} else merged.push({ ...s });
	}
	return merged
		.map((s) => (s.to === null ? `seit ${s.from}` : s.to === s.from ? String(s.from) : `${s.from}–${s.to}`))
		.join(", ");
}

const yearOf = (d: string | null): number | null => (d ? Number(d.slice(0, 4)) : null);

/** Ämter nach Rat und Wahlkreis: «Kantonsrat · 1991–1999, seit 2003 · 14. Wahlkreis (Winterthur Stadt)». */
export function officeLines(p: Pick<KrdbPerson, "seats" | "sex">): OfficeLine[] {
	const groups = new Map<string, { council: string; district: string | null; spans: Span[] }>();
	for (const [council, from, to, district] of p.seats) {
		const f = yearOf(from);
		if (f == null) continue;
		// Regierung: der «Wahlkreis» ist das Wahlgremium («Kanton Zürich») – weglassen.
		const gov = council === "Regierungsrat" || council === "Kleiner Rat";
		const d = gov ? null : (district?.replace(/\s+/g, " ").replace(/^0(\d)\./, "$1.").trim() || null);
		const key = `${council}|${d ?? ""}`;
		const g = groups.get(key) ?? { council, district: d, spans: [] };
		g.spans.push({ from: f, to: yearOf(to) });
		groups.set(key, g);
	}
	return [...groups.values()]
		.sort((a, b) => Math.min(...a.spans.map((s) => s.from)) - Math.min(...b.spans.map((s) => s.from)))
		.map((g) => ({ label: councilLabel(g.council, p.sex), years: spanText(g.spans), district: g.district }));
}

export interface PartyLine {
	party: string;
	years: string;
}

/** Parteizugehörigkeiten mit Jahren; Einbuchstaben-Kürzel ohne gesicherte Auflösung entfallen. */
export function partyLines(p: Pick<KrdbPerson, "parties">): PartyLine[] {
	const groups = new Map<string, Span[]>();
	for (const [party, , from, to] of p.parties ?? []) {
		const name = displayParty(party);
		const f = yearOf(from);
		if (!name || f == null) continue;
		groups.set(name, [...(groups.get(name) ?? []), { from: f, to: yearOf(to) }]);
	}
	return [...groups.entries()].map(([party, spans]) => ({ party, years: spanText(spans) }));
}

/** Wohnorte (während der Amtszeit) ohne Dubletten, in zeitlicher Reihenfolge. */
export function residenceNames(p: Pick<KrdbPerson, "places">): string[] {
	const sorted = [...(p.places ?? [])].sort((a, b) => (a[1] ?? "").localeCompare(b[1] ?? ""));
	return [...new Set(sorted.map(([place]) => place.replace(/\s*\(ZH\)\s*$/, "").trim()).filter(Boolean))];
}

// --- Verzeichnis (/personen) ------------------------------------------------------

/** Filtert und sortiert das Register fürs Verzeichnis. `counts` (Dokumente je
 *  Person) fehlt, solange der Index die Zuordnung noch nicht trägt. */
export function filterDirectory(
	persons: readonly KrdbPerson[],
	q: DirectoryQuery,
	counts: ReadonlyMap<number, number> | null,
): KrdbPerson[] {
	const tokens = foldName(q.q).split(" ").filter(Boolean);
	const out = persons.filter((p) => {
		if (q.council && !p.seats.some(([council]) => council === q.council)) return false;
		if (q.withDocs && counts && (counts.get(p.id) ?? 0) === 0) return false;
		if (tokens.length === 0) return true;
		const hay = `${foldName(p.first)} ${foldName(p.last)} ${foldName(displayLastName(p.last))}`;
		return tokens.every((t) => hay.includes(t));
	});
	// Nach KRDB-Schreibweise («Wyss von», «Mestral, de»): der Partikel stört die Reihenfolge nicht.
	const byName = (a: KrdbPerson, b: KrdbPerson) =>
		a.last.localeCompare(b.last, "de") ||
		a.first.localeCompare(b.first, "de") ||
		a.id - b.id;
	return out.sort(
		q.sort === "docs" && counts ? (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || byName(a, b) : byName,
	);
}

// --- Trefferauszüge -------------------------------------------------------------

const MARK = /<mark class="(match|entity-match)">([^<]*)<\/mark>/g;

const escapeHtml = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Titel/Auszug für `{@html}`: Text maskieren, nur die Hervorhebungs-Marks von
 *  Meili und highlight.ts bleiben als `<mark class="match">` stehen (mit
 *  `keepEntities` die Namen als `entity-match`). Der Korpus kann `<` und `&`
 *  enthalten (OCR, Klammern, Text Dritter in amtlichen Quellen) – roh eingesetzt
 *  würde das zu Markup. */
export function sanitizeMarks(html: string, { keepEntities = false }: { keepEntities?: boolean } = {}): string {
	let out = "";
	let last = 0;
	for (const m of html.matchAll(MARK)) {
		const cls = keepEntities ? m[1] : "match";
		out += `${escapeHtml(html.slice(last, m.index))}<mark class="${cls}">${escapeHtml(m[2])}</mark>`;
		last = m.index + m[0].length;
	}
	return out + escapeHtml(html.slice(last));
}

/** Meilis «…» an den Enden eines Auszugs weg: Die Seiten setzen selbst eines davor und dahinter. */
export const trimCropMarks = (html: string): string => html.replace(/^…+|…+$/g, "");
