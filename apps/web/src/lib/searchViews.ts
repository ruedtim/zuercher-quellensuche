/**
 * Reiter der Suchseite: Alle Quellen (je Quelle ein Block mit Trefferzahl und den ersten
 * Treffern), Dokumente (Volltexte der Plattform), Archivkatalog (Verzeichnungseinheiten des
 * Staatsarchivs), Ehedaten (Eheeinträge der Kirchenbücher) und Editionen (edierte
 * Quellenstücke: QZH und Zürcher Rechtsquellen). Welcher Reiter gilt, steht in der URL als `view=<id>`; ohne
 * Parameter «Alle Quellen» (seit 02.11.2026, Tim, docs/alle-quellen-plan.md; vom 01.11. bis
 * 02.11. der Archivkatalog, davor die Dokumente – Links auf die Dokumentsuche tragen darum
 * `view=documents`, documentsSearchHref). Ältere Links mit `catView=1` öffnen den Archivkatalog.
 *
 * Alle Reiter teilen die Filterspalte und die URL (Suchbegriff, ODER-Begriffe,
 * Zeitraum, «nur im Titel», Personen und Orte); die eigenen Filter eines Reiters
 * bleiben beim Wechsel stehen und gelten beim Zurückwechseln wieder. Pur (Server und
 * Browser), unit-getestet in searchViews.test.ts.
 */

import { entityKey, type EntityKind } from "./entityKey";
import type { SearchParams } from "./types";

export type SearchView = "all" | "documents" | "catalog" | "ehedaten" | "editions";

export interface SearchViewInfo {
	id: SearchView;
	label: string;
	/** Kurzes Label für schmale Bildschirme (fünf Reiter in 343 px). */
	mobileLabel: string;
	/** Tooltip des Reiters. */
	title: string;
}

/** Reihenfolge der Reiterleiste: «Alle Quellen» zuerst, er ist auch der Standard-Reiter
 *  (Tim 02.11.2026); dann der Archivkatalog (Standard vom 01.11.2026). Ehedaten hinter den
 *  Editionen (Tim 17.11.2026). */
export const SEARCH_VIEWS: readonly SearchViewInfo[] = [
	{ id: "all", label: "Alle Quellen", mobileLabel: "Alle", title: "Zentrale Serien, Archivkatalog, Editionen und Ehedaten auf einen Blick" },
	{ id: "catalog", label: "Archivkatalog", mobileLabel: "Katalog", title: "Verzeichnungseinheiten aus dem Online-Archivkatalog des Staatsarchivs Zürich" },
	{ id: "documents", label: "Zentrale Serien", mobileLabel: "Serien", title: "Volltexte der Zentralen Serien: Amtsblatt, Regierungsratsbeschlüsse, Kantonsratsprotokolle, Gesetzessammlung, Ratsmanuale" },
	{
		id: "editions",
		label: "Editionen",
		mobileLabel: "Editionen",
		title: "Edierte Quellenstücke mit Anmerkungen und Kommentar (Quellen zur Zürcher Geschichte, Zürcher Rechtsquellen)",
	},
	{ id: "ehedaten", label: "Ehedaten", mobileLabel: "Ehedaten", title: "Eheeinträge aus den Zürcher Kirchenbüchern 1524–1800 (Ehedatenbank des Staatsarchivs)" },
];

const IDS = new Set<string>(SEARCH_VIEWS.map((v) => v.id));

export function isSearchView(v: unknown): v is SearchView {
	return typeof v === "string" && IDS.has(v);
}

/** Standard-Reiter ohne `view` in der URL. Fehlen alle Zusatzindizes, zeigt die Suchseite die
 *  Dokumente. */
export const DEFAULT_SEARCH_VIEW: SearchView = "all";

/** Reiter aus der URL: `view=<id>`, sonst der Standard (das alte `catView=1` = Katalog). */
export function parseSearchView(sp: URLSearchParams): SearchView {
	const v = sp.get("view");
	if (isSearchView(v)) return v;
	return sp.get("catView") === "1" ? "catalog" : DEFAULT_SEARCH_VIEW;
}

/** Schreibt den Reiter in `url` (`view`, ohne das alte `catView`); der Standard ohne Parameter. */
export function writeSearchView(url: URL, view: SearchView): URL {
	url.searchParams.delete("catView");
	if (view === DEFAULT_SEARCH_VIEW) url.searchParams.delete("view");
	else url.searchParams.set("view", view);
	return url;
}

/** URL eines Reiters aus der aktuellen Such-URL: alle Eingaben bleiben, Seite 1. */
export function searchViewUrl(url: URL, view: SearchView): URL {
	const out = new URL(url.toString());
	out.searchParams.delete("page");
	return writeSearchView(out, view);
}

/** Link auf einen Reiter von anderen Seiten («/search?view=ehedaten»), mit weiteren Parametern. */
export function searchViewHref(view: SearchView, params?: URLSearchParams | Record<string, string>): string {
	const url = writeSearchView(new URL(`/search?${new URLSearchParams(params ?? {})}`, "http://local"), view);
	return `${url.pathname}${url.search}`;
}

/** Link auf die Dokumentsuche (Reiter «Zentrale Serien») mit diesen Parametern. */
export function documentsSearchHref(params?: URLSearchParams | Record<string, string>): string {
	return searchViewHref("documents", params);
}

/** Kann der Reiter das Thema reihen (Embed-Service und Vektoren im Index)? */
export interface TabThemeSupport {
	catalogSemantic: boolean;
	editionsSemantic: boolean;
}

/**
 * Geteilte Felder (Personen, Orte, Organisationen, Thema), die ein Reiter nicht anwenden kann
 * – seine Trefferzahl in der Reiterleiste gälte dann für eine andere Auswahl (ein Name ohne
 * Vornamen im Archivkatalog: alle Einheiten), die Leiste zeigt «–». Wie
 * documentsOnlyFilters (Archivkatalog), ehedatenIgnoredFilters und editionsIgnoredFilters,
 * aber nur für die geteilten Felder und mit den Namen selbst: Serien und die Filter eines
 * anderen Reiters gehören zu ihrem Reiter. Die Zentralen Serien wenden alle Namen an (die
 * Form oder ihren Vergleichsschlüssel, ohne Schlüssel genau diese Form). Das Thema zählt nur, wenn es die Treffer schneidet (mit
 * Datums-Sortierung die K ähnlichsten, wie topKApplies); nach Relevanz reiht es nur, die
 * Zahlen bleiben dieselben.
 */
export function unappliedSharedFilters(
	view: SearchView,
	p: Pick<SearchParams, "persons" | "places" | "organizations" | "theme" | "sort">,
	theme: TabThemeSupport,
): string[] {
	const unkeyed = (kind: EntityKind, values: readonly string[]) => values.filter((v) => !entityKey(kind, v));
	const named = (label: string, values: readonly string[], suffix = "") => values.map((v) => `${label} «${v}»${suffix}`);
	const themeSet = p.theme.trim() !== "" && p.sort !== "relevance";
	switch (view) {
		case "catalog":
			return [
				...named("Person", unkeyed("person", p.persons), " (ohne Vornamen)"),
				...named("Ort", unkeyed("place", p.places)),
				...named("Organisation", unkeyed("org", p.organizations)),
				...(themeSet && !theme.catalogSemantic ? ["Thema"] : []),
			];
		case "ehedaten":
			return [...named("Ort", unkeyed("place", p.places)), ...named("Organisation", p.organizations), ...(themeSet ? ["Thema"] : [])];
		case "editions":
			return themeSet && !theme.editionsSemantic ? ["Thema"] : [];
		default:
			return [];
	}
}

/** Tooltip eines Reiters ohne vergleichbare Trefferzahl; `where` für den Block im Reiter «Alle Quellen» («dort»). */
export function unappliedNote(labels: readonly string[], where = "in diesem Reiter"): string {
	return `Keine Trefferzahl: ${labels.join(", ")} ${labels.length === 1 ? "wirkt" : "wirken"} ${where} nicht.`;
}
