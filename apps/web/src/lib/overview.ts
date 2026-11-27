/**
 * Reiter «Alle Quellen» der Suchseite (docs/alle-quellen-plan.md): je Quelle ein Block mit
 * Trefferzahl und den ersten Treffern. Pure Logik, die Server und Browser teilen:
 * - overviewIsLanding: ohne Suche und Filter zeigt der Reiter den Landeplatz (Bestand und
 *   Einstieg je Quelle) statt leerer Blöcke;
 * - allAutoOpensAdvanced: was die «Erweiterten Suchoptionen» dort von selbst aufklappt;
 * - foreignFilters: was in der URL steht, aber im aktuellen Reiter nicht wirkt – als Zeile
 *   in der Filterspalte, in jedem Reiter (Issue #221: versteckte Filter der anderen Reiter
 *   verkleinerten die Reiterzahlen, ohne dass etwas darauf hinwies).
 * Unit-getestet in overview.test.ts.
 */

import { documentsOnlyFilters, splitCatalogLabel, type CatalogFilters } from "./catalog";
import { ART_LABEL, ehedatenIgnoredFilters, QUELLE_LABEL, RAUM_LABEL, type EhedatenFilterValues } from "./ehedaten";
import { editionShort, editionsIgnoredFilters, type EditionsFilterValues } from "./editionTexts";
import type { SearchView } from "./searchViews";
import type { SearchParams } from "./types";

type CatalogOwn = Pick<CatalogFilters, "level" | "bestand" | "digital" | "fields">;

export type OverviewParams = Pick<
	SearchParams,
	"q" | "anyTerms" | "theme" | "topK" | "sort" | "series" | "persons" | "places" | "organizations" | "volumeNr" | "startPg" | "serialNr" | "resolutionId" | "years"
>;

const some = (values: readonly string[]) => values.some((v) => v.trim() !== "");
const hasCatalogOwn = (f: CatalogOwn) => f.level.length > 0 || f.bestand.length > 0 || f.digital || (f.fields ?? []).length > 0;
const hasEheOwn = (e: EhedatenFilterValues) =>
	e.mann.length > 0 || e.frau.length > 0 || e.kirche.length > 0 || e.raum.length > 0 || e.quelle.length > 0 || e.art !== null || e.band.length > 0;
const hasEdOwn = (e: EditionsFilterValues) => e.edition.length > 0 || e.part.length > 0 || e.keyword.length > 0 || e.facs;
const hasSeriesFacets = (p: OverviewParams) => [p.volumeNr, p.startPg, p.serialNr, p.resolutionId, p.years].some((v) => v.length > 0);

/**
 * Zeigt der Reiter «Alle Quellen» den Landeplatz? Nur ohne jede Eingabe: kein Suchbegriff,
 * keine ODER-Begriffe, kein Thema, kein Zeitraum (`dates` = Zeitraum ab 700 wie im Katalog),
 * keine Namen, keine Sortierung und keine Filter irgendeines Reiters – was in der URL steht,
 * wirkt in mindestens einem Block oder wird als fremder Filter gemeldet.
 */
export function overviewIsLanding(
	p: OverviewParams,
	dates: { dateFrom: number | null; dateTo: number | null },
	cat: CatalogOwn,
	ehe: EhedatenFilterValues,
	ed: EditionsFilterValues,
): boolean {
	return !(
		p.q.trim() !== "" ||
		some(p.anyTerms) ||
		p.theme.trim() !== "" ||
		p.sort !== "relevance" ||
		dates.dateFrom != null ||
		dates.dateTo != null ||
		p.series.length > 0 ||
		some(p.persons) ||
		some(p.places) ||
		some(p.organizations) ||
		hasSeriesFacets(p) ||
		hasCatalogOwn(cat) ||
		hasEheOwn(ehe) ||
		hasEdOwn(ed)
	);
}

/**
 * Klappen im Reiter «Alle Quellen» die «Erweiterten Suchoptionen» von selbst auf? Wie in den
 * anderen Reitern steht ausserhalb nur die lexikalische Suche; aufklappen lässt, was nur darin
 * stünde: ODER-Begriffe, das Thema (nur mit Embed-Service), der Themen-Umfang und Namen. Der
 * Zeitraum nicht (Pill unter dem Schalter), Serien und Filter der anderen Reiter auch nicht:
 * Sie stehen dort nicht, sondern in der Zeile der fremden Filter.
 */
export function allAutoOpensAdvanced(
	p: Pick<SearchParams, "anyTerms" | "theme" | "topK" | "persons" | "places" | "organizations">,
	semantic: boolean,
): boolean {
	return (
		p.anyTerms.length > 0 ||
		(semantic && p.theme.trim() !== "") ||
		p.topK != null ||
		some(p.persons) ||
		some(p.places) ||
		some(p.organizations)
	);
}

/** Reiter, in dem ein fremder Filter wirkt (für den Hinweis «gilt im Reiter …»). */
const VIEW_LABEL: Record<Exclude<SearchView, "all">, string> = {
	documents: "Zentrale Serien",
	catalog: "Archivkatalog",
	ehedaten: "Ehedaten",
	editions: "Editionen",
};

export interface ForeignFilterGroup {
	/** Reiter, in dem die Einträge wirken. */
	view: Exclude<SearchView, "all">;
	label: string;
	/** Lesbare Einträge («Stufe Dossier», «Bräutigam Heusser»). */
	items: string[];
}

const list = (values: readonly string[], max = 3) =>
	values.length <= max ? values.join(", ") : `${values.slice(0, max).join(", ")} und ${values.length - max} weitere`;

function catalogOwnLabels(f: CatalogOwn): string[] {
	const out: string[] = [];
	if (f.level.length > 0) out.push(`Stufe ${list(f.level)}`);
	if (f.bestand.length > 0) out.push(`Bestand ${list(f.bestand.map((b) => splitCatalogLabel(b).name))}`);
	if (f.digital) out.push("nur mit Digitalisat");
	const n = (f.fields ?? []).length;
	if (n > 0) out.push(n === 1 ? "Feldsuche (1 Eintrag)" : `Feldsuche (${n} Einträge)`);
	return out;
}

function ehedatenOwnLabels(e: EhedatenFilterValues): string[] {
	const out: string[] = [];
	if (e.mann.length > 0) out.push(`Bräutigam ${list(e.mann)}`);
	if (e.frau.length > 0) out.push(`Braut ${list(e.frau)}`);
	if (e.kirche.length > 0) out.push(`Kirchgemeinde ${list(e.kirche)}`);
	if (e.raum.length > 0) out.push(`Herkunftsraum ${list(e.raum.map((r) => RAUM_LABEL[r] ?? r))}`);
	if (e.art) out.push(`nur ${ART_LABEL[e.art]}`);
	if (e.quelle.length > 0) out.push(`Überlieferung ${list(e.quelle.map((q) => QUELLE_LABEL[q] ?? q))}`);
	if (e.band.length > 0) out.push(`Band ${list(e.band)}`);
	return out;
}

function editionsOwnLabels(e: EditionsFilterValues): string[] {
	const out: string[] = [];
	if (e.edition.length > 0) out.push(`Edition ${list(e.edition.map(editionShort))}`);
	if (e.part.length > 0) out.push(`Teil ${list(e.part)}`);
	if (e.keyword.length > 0) out.push(`Schlagwort ${list(e.keyword)}`);
	if (e.facs) out.push("nur mit Faksimile");
	return out;
}

/** Serie und Serien-Filter der Dokumentsuche, wie sie die anderen Reiter melden. */
function documentsOwnLabels(p: OverviewParams): string[] {
	const out: string[] = [];
	if (p.series.length > 0) out.push(`${p.series.length === 1 ? "Serie" : "Serien"} ${p.series.join(", ")}`);
	if (hasSeriesFacets(p)) out.push("Filter der Serie");
	return out;
}

/**
 * Was in der URL steht, aber im Reiter `view` nicht wirkt, nach dem Reiter gruppiert, in dem
 * es gilt. Geteilte Felder (Suchbegriff, ODER, Zeitraum, «nur im Titel») tauchen nie auf;
 * Thema und Namen nur dort, wo sie wirklich nicht greifen (Thema ohne Vektoren der Quelle,
 * Namensformen ohne Vergleichsschlüssel im Katalog, Organisationen in den Ehedaten – die
 * bisherigen Hinweise documentsOnlyFilters, ehedatenIgnoredFilters, editionsIgnoredFilters).
 * `semantic`: ob das Thema im aktuellen Reiter reihen kann.
 */
export function foreignFilters(
	view: SearchView,
	p: OverviewParams,
	cat: CatalogOwn,
	ehe: EhedatenFilterValues,
	ed: EditionsFilterValues,
	semantic: boolean,
): ForeignFilterGroup[] {
	const groups: ForeignFilterGroup[] = [];
	const push = (v: Exclude<SearchView, "all">, items: string[]) => {
		if (items.length > 0) groups.push({ view: v, label: VIEW_LABEL[v], items });
	};
	switch (view) {
		case "all":
			push("documents", documentsOwnLabels(p));
			push("catalog", catalogOwnLabels(cat));
			push("ehedaten", ehedatenOwnLabels(ehe));
			push("editions", editionsOwnLabels(ed));
			break;
		case "documents":
			push("catalog", catalogOwnLabels(cat));
			push("ehedaten", ehedatenOwnLabels(ehe));
			push("editions", editionsOwnLabels(ed));
			break;
		case "catalog":
			push("documents", documentsOnlyFilters(p, semantic));
			push("ehedaten", ehedatenOwnLabels(ehe));
			push("editions", editionsOwnLabels(ed));
			break;
		case "ehedaten": {
			// Thema und Organisationen wirken in Katalog und Editionen; die bisherige Liste
			// (ehedatenIgnoredFilters) nennt sie unter den Dokumenten, wo sie sicher gelten.
			push("documents", ehedatenIgnoredFilters(p));
			push("catalog", catalogOwnLabels(cat));
			push("editions", editionsOwnLabels(ed));
			break;
		}
		case "editions":
			// Namen ohne Vergleichsschlüssel gelten in den Editionen exakt (Register) – kein Hinweis.
			push("documents", editionsIgnoredFilters(p, semantic));
			push("catalog", catalogOwnLabels(cat));
			push("ehedaten", ehedatenOwnLabels(ehe));
			break;
	}
	return groups;
}
