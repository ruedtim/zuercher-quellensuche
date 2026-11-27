/**
 * Namensfilter und Ratsmanuale (RM): Die geteilten Namensfilter (`persons`, `places`,
 * `organizations`) finden RM über die vereinheitlichten Namen des Indexers (services/indexer/src/
 * rmNames.ts: Personen mit Vor- und Nachnamen, Orte aus dem Ortsverzeichnis), aber nicht jede
 * Schreibung und keinen Nachnamen allein. Die NER-Formen taugen auch nicht als Brücke (in 40 Sitzungen
 * mit demselben Stück wie die QZH 0 von 34 Personen unter demselben Vergleichsschlüssel).
 *
 * Stattdessen bietet die Suche die Volltext-Treffer an: je gefiltertem Namen eine Hinweiszeile
 * «Im Volltext der Ratsmanuale: «Kyburg» (auch «Kiburg», «Kyburch») in N Sitzungen» mit Link auf
 * eine RM-Suche, die die Schreibungen als ODER-Phrasen sucht. Die Schreibungen kommen aus dem
 * Register der Editionen (`personList`/`placeList` des Index `editions`, je Stück die Formen im
 * Text), gefiltert auf Formen, die zum Namen passen (nameSpelling.ts), in der RM-Lesefassung
 * (rmReadingForm: Nasalstrich, uͤ → ü, ß → ss – die Suche ist eine reine RM-Auswahl).
 * Personen nur mit Vor- und Nachnamen, immer als Phrase, und nur in der Zeit der Editionsstücke
 * mit der Person (± RM_PERSON_MARGIN Jahre): Zürcher Familien wiederholen Vornamen, «Heinrich
 * Bullinger» steht in RM bis 1795, «Rudolf Walter» (eine Schreibung Gwalthers) nur 1611 und
 * 1669 (Prod 2026-11-02). Personen ausserhalb des Registers nur mit Zeitraum der Auswahl.
 *
 * Pur (Anfrage und Abfragen baut lib/server/rmNames.ts), unit-getestet in rmNames.test.ts.
 */

import { foldText, orgKey, personKey, placeKey, type EntityKind } from "./entityKey";
import { isQualifiedPersonName } from "./entityFilter";
import { isPersonSpelling, isPlaceSpelling } from "./nameSpelling";
import { rmReadingForm } from "./rmText";
import { combineUnionQuery, foldSingleAnyTerm, searchParamsToUrl } from "./searchParams";
import type { SearchParams } from "./types";

/** Zeit der Ratsmanuale (Bände B II 6–1060). */
export const RM_YEAR_MIN = 1484;
export const RM_YEAR_MAX = 1798;
/** Höchstens so viele Schreibungen je Name (die häufigsten), so viele Namen je Suche. */
export const RM_VARIANTS_MAX = 8;
export const RM_NAMES_MAX = 4;
/** Spielraum um die Jahre der Editionsstücke mit einer Person (Namensvettern, s. rmPersonRange). */
export const RM_PERSON_MARGIN = 10;

/** Ein Eintrag des Editionen-Registers in einem Stück (`personList`/`placeList`). */
export interface RegisterEntry {
	name: string;
	forms: readonly string[];
	/** Nennungen im Stück. */
	count?: number;
}

/** Hinweiszeile der Suchseite zu einem gefilterten Namen (lib/server/rmNames.ts). */
export interface RmFulltextHint {
	kind: EntityKind;
	value: string;
	/** Gesuchte Schreibungen (Lesefassung), die erste ist der Filterwert. */
	variants: string[];
	/** RM-Sitzungen mit mindestens einer Schreibung (und dem Suchbegriff der Auswahl). */
	total: number;
	/** Gesuchter Zeitraum bei Personen (Zeit der Stücke ± RM_PERSON_MARGIN, mit der Auswahl geschnitten). */
	range: { from: number | null; to: number | null } | null;
	href: string;
}

type Applies = Pick<
	SearchParams,
	| "q"
	| "anyTerms"
	| "series"
	| "dateFrom"
	| "dateTo"
	| "years"
	| "volumeNr"
	| "startPg"
	| "serialNr"
	| "resolutionId"
	| "persons"
	| "places"
	| "organizations"
	| "titleOnly"
>;

/**
 * Berührt die Auswahl die Ratsmanuale, sodass ein Hinweis auf deren Volltext sinnvoll ist? Ein
 * Namensfilter ist gesetzt, keine Serie schliesst RM aus, der Zeitraum (bzw. die gewählten
 * Jahre) schneidet 1484–1798. Nicht mit mehreren ODER-Begriffen (die Vereinigung mit den
 * Schreibungen liesse sich nur als Produkt suchen), «nur im Titel» (der Name steht im Text)
 * und Filtern anderer Serien (Erlass-, Beschlussnummer).
 */
export function rmFulltextApplies(p: Applies): boolean {
	if (p.persons.length + p.places.length + p.organizations.length === 0) return false;
	if (p.series.length > 0 && !p.series.includes("RM")) return false;
	if (p.dateFrom != null && p.dateFrom > RM_YEAR_MAX) return false;
	if (p.dateTo != null && p.dateTo < RM_YEAR_MIN) return false;
	if (p.years.length > 0 && !p.years.some((y) => y >= RM_YEAR_MIN && y <= RM_YEAR_MAX)) return false;
	if (p.serialNr.length > 0 || p.resolutionId.length > 0 || p.titleOnly) return false;
	// Band und Sitzungsnummer gelten auch in RM, aber nur, wenn nur RM gewählt ist.
	if ((p.volumeNr.length > 0 || p.startPg.length > 0) && !(p.series.length === 1 && p.series[0] === "RM")) return false;
	return foldSingleAnyTerm(p).anyTerms.length < 2;
}

/** Die gefilterten Namen, die sich in RM suchen lassen: Personen mit Vor- und Nachnamen, Orte
 *  und Organisationen mit Vergleichsschlüssel; höchstens RM_NAMES_MAX. */
export function rmFilterNames(p: Pick<SearchParams, "persons" | "places" | "organizations">): Array<{ kind: EntityKind; value: string }> {
	const out = [
		...p.persons.filter((v) => personKey(v)).map((value) => ({ kind: "person" as const, value })),
		...p.places.filter((v) => placeKey(v)).map((value) => ({ kind: "place" as const, value })),
		...p.organizations.filter((v) => orgKey(v)).map((value) => ({ kind: "org" as const, value })),
	];
	return out.slice(0, RM_NAMES_MAX);
}

const keyOf = (kind: EntityKind, s: string) => (kind === "person" ? personKey(s) : kind === "place" ? placeKey(s) : orgKey(s));

/** Lesefassung einer Form für die Phrasensuche: ohne Ergänzungsklammern der Edition
 *  («Grü[nin]gen»), weiche Trennstriche und Anführungszeichen. Ohne Buchstaben leer. */
export function rmPhraseForm(form: string): string {
	const s = rmReadingForm(form.replace(/[[\]"­]/g, "").replace(/\([^)]*\)/g, " "));
	return /\p{L}/u.test(s) && !/\d/.test(s) && !s.includes(",") ? s : "";
}

/**
 * Schreibungen eines Namens für die Suche in RM: der Filterwert, dann die Formen der
 * Register-Einträge gleichen Namens (gleicher Vergleichsschlüssel), die zum Namen passen –
 * Personen mit Vor- und Nachnamen (isPersonSpelling), Orte als Schreibung (isPlaceSpelling).
 * Organisationen nur der Filterwert (das Register der Editionen führt keine Formen). Nach
 * Häufigkeit, gleiche Lesefassung (ohne Gross-/Kleinschreibung, Umlaute, Diakritika) einmal.
 */
export function rmNameVariants(kind: EntityKind, value: string, entries: readonly RegisterEntry[]): string[] {
	const key = keyOf(kind, value);
	if (!key) return [];
	const weight = new Map<string, number>();
	const add = (form: string, w: number) => weight.set(form, (weight.get(form) ?? 0) + w);
	if (kind !== "org") {
		const fits = kind === "person" ? isPersonSpelling : isPlaceSpelling;
		// Namensvettern mit Lebensjahren nur über den eigenen Eintrag (isQualifiedPersonName).
		const exactOnly = kind === "person" && isQualifiedPersonName(value);
		for (const e of entries) {
			if (e.name !== value && (exactOnly || keyOf(kind, e.name) !== key)) continue;
			const w = Math.max(1, e.count ?? 1);
			add(e.name, 0);
			for (const f of e.forms) if (fits(e.name, f) && fits(value, f)) add(f, w);
		}
	}
	const ordered = [value, ...[...weight.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const form of ordered) {
		const phrase = rmPhraseForm(form);
		const id = foldText(phrase);
		if (!phrase || seen.has(id)) continue;
		// Personen auch in der Lesefassung mit Vor- und Nachnamen.
		if (kind === "person" && !personKey(phrase)) continue;
		seen.add(id);
		out.push(phrase);
		if (out.length >= RM_VARIANTS_MAX) break;
	}
	return out;
}

/**
 * Zeitraum der RM-Suche zu einem Namen: Orte und Organisationen der Zeitraum der Auswahl;
 * Personen die Jahre der Editionsstücke mit ihnen (`years`, Beginn und Ende der Stücke) ±
 * RM_PERSON_MARGIN, geschnitten mit der Auswahl. Person ohne Stücke: nur mit Zeitraum der
 * Auswahl. null = nicht suchen (leerer Schnitt, Person ohne Zeitbezug).
 */
export function rmSearchRange(
	kind: EntityKind,
	p: Pick<SearchParams, "dateFrom" | "dateTo">,
	years: readonly number[],
): { from: number | null; to: number | null } | null {
	if (kind !== "person") return { from: p.dateFrom, to: p.dateTo };
	if (years.length === 0) return p.dateFrom != null || p.dateTo != null ? { from: p.dateFrom, to: p.dateTo } : null;
	const from = Math.max(Math.min(...years) - RM_PERSON_MARGIN, p.dateFrom ?? -Infinity, RM_YEAR_MIN);
	const to = Math.min(Math.max(...years) + RM_PERSON_MARGIN, p.dateTo ?? Infinity, RM_YEAR_MAX);
	return from <= to ? { from, to } : null;
}

/** Suchbegriff der Auswahl in der Schreibweise der RM-Lesefassung (ß → ss, wie foldRmSharpS). */
const rmQ = (q: string) => q.trim().replace(/(?<=\p{L})ß/gu, "ss");

/** Meili-Filter der RM-Suche: Serie, Zeitraum, Jahre, Band, Sitzung der Auswahl. */
export function rmFilter(p: Pick<SearchParams, "dateFrom" | "dateTo" | "years" | "volumeNr" | "startPg">): string[] {
	const out = ["series = 'RM'"];
	if (p.dateFrom != null) out.push(`dateYear >= ${p.dateFrom}`);
	if (p.dateTo != null) out.push(`dateYear <= ${p.dateTo}`);
	if (p.years.length > 0) out.push(`dateYear IN [${p.years.join(", ")}]`);
	if (p.volumeNr.length > 0) out.push(`volumeNr IN [${p.volumeNr.join(", ")}]`);
	if (p.startPg.length > 0) out.push(`startPg IN [${p.startPg.join(", ")}]`);
	return out;
}

/** Je Schreibung ein Zweig der föderierten Zählung: Phrase plus Suchbegriff der Auswahl, alle Wörter. */
export function rmBranchQueries(variants: readonly string[], q: string): Array<{ q: string; matchingStrategy: "all" }> {
	return variants.map((v) => combineUnionQuery(`"${v}"`, rmQ(q)));
}

/**
 * Link auf die RM-Suche im Reiter «Zentrale Serien»: Serie RM, die Schreibungen als
 * ODER-Phrasen (eine allein als Phrase im Suchbegriff), Suchbegriff, Zeitraum, Jahre, Band und
 * Sitzung der Auswahl; ohne Namensfilter (sonst nur Sitzungen mit erkanntem Namen), Thema und Sortierung.
 */
export function rmFulltextHref(variants: readonly string[], p: Pick<SearchParams, "q" | "dateFrom" | "dateTo" | "years" | "volumeNr" | "startPg">): string {
	const phrases = variants.map((v) => `"${v}"`);
	const q = rmQ(p.q);
	const url = searchParamsToUrl({
		series: ["RM"],
		q: phrases.length === 1 ? [phrases[0], q].filter(Boolean).join(" ") : q,
		anyTerms: phrases.length > 1 ? phrases : [],
		dateFrom: p.dateFrom,
		dateTo: p.dateTo,
		years: p.years,
		volumeNr: p.volumeNr,
		startPg: p.startPg,
	});
	url.searchParams.set("view", "documents");
	return `${url.pathname}${url.search}`;
}
