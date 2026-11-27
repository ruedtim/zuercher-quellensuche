/**
 * Formatierungs-Helper für die Detailansicht, die Druckansicht und die
 * API-Metadaten. Bewusst ohne $lib-/$env-Imports (nur relativ), damit das
 * Modul unter `tsx --test` läuft.
 */

import { SERIES_LABEL, type SeriesAbbr } from "./types";

const MONTHS_DE = [
	"Januar",
	"Februar",
	"März",
	"April",
	"Mai",
	"Juni",
	"Juli",
	"August",
	"September",
	"Oktober",
	"November",
	"Dezember",
];

/**
 * "1935-03-22" → "22. März 1935"
 * "1935-03" / "1935" → fallback auf ursprüngliche Form
 * null/undefined → ""
 */
export function formatDateDE(iso: string | null | undefined): string {
	if (!iso) return "";
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return iso;
	const day = Number.parseInt(m[3], 10);
	const month = MONTHS_DE[Number.parseInt(m[2], 10) - 1];
	if (!month) return iso;
	return `${day}. ${month} ${m[1]}`;
}

// Zürich datierte bis 31.12.1700 nach dem julianischen Kalender (alter Stil)
// und ab 12.1.1701 gregorianisch. Die Ratsmanuale (RM) übernehmen die Daten wie
// geschrieben, ohne Umrechnung – bis 1700 tragen sie darum den Zusatz «a. St.».
export const OLD_STYLE_LAST_YEAR = 1700;
export const OLD_STYLE_SUFFIX = "(a. St.)";

/** true, wenn das Datum eines RM-Dokuments im alten Stil (julianisch) steht. */
export function isOldStyleDate(series: string, iso: string | null | undefined): boolean {
	if (series !== "RM" || !iso) return false;
	const m = iso.match(/^(\d{4})/);
	return m !== null && Number(m[1]) <= OLD_STYLE_LAST_YEAR;
}

/** " (a. St.)" für Daten im alten Stil, sonst "" – zum Anhängen an ein Datum. */
export function oldStyleSuffix(series: string, iso: string | null | undefined): string {
	return isOldStyleDate(series, iso) ? ` ${OLD_STYLE_SUFFIX}` : "";
}

/** formatDateDE plus «(a. St.)» bei RM-Daten bis 1700. */
export function formatDocDateDE(doc: { series: string; date: string | null | undefined }): string {
	const de = formatDateDE(doc.date);
	return de ? de + oldStyleSuffix(doc.series, doc.date) : "";
}

/** "1642-10-07" → "7.10.1642" (Zitierform wie in den RM-Titeln); andere Formen unverändert. */
export function formatDateNumeric(iso: string | null | undefined): string {
	if (!iso) return "";
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : iso;
}

/**
 * Zitiervorschlag für eine Ratsmanual-Sitzung, z. B. «StAZH B II 441,
 * S. 122–124, Sitzung vom 17.10.1642 (a. St.); maschinelle Transkription,
 * zitiert nach https://…/documents/RM/…». Ohne Datum
 * (undatierte Sitzung) entfällt «Sitzung vom …».
 */
export function rmCitation(
	doc: { series: string; stazhIdent: string | null | undefined; date: string | null | undefined },
	permalink: string,
): string {
	const ident = normalizeWhitespace(doc.stazhIdent);
	const date = formatDateNumeric(doc.date);
	const session = date ? `Sitzung vom ${date}${oldStyleSuffix(doc.series, doc.date)}` : "";
	const head = [ident, session].filter(Boolean).join(", ");
	return `${head ? `${head}; ` : ""}maschinelle Transkription, zitiert nach ${permalink}`;
}

/**
 * Bildnachweis der Ratsmanual-Faksimiles. Die Bilder liegen auf dem
 * Transkribus-Bildserver und tragen keine Rechtekennzeichnung (die Public
 * Domain Mark gilt nur für Texte und Metadaten) – nur diesen Nachweis, wie das
 * `requiredStatement` der RM-Manifeste.
 */
export function rmImageCredit(volumeNr: number | null | undefined): string {
	const band = volumeNr != null ? `, StAZH B II ${volumeNr}` : "";
	return `Digitalisat: Staatsarchiv des Kantons Zürich${band}`;
}

/**
 * Whitespace im stazhIdent normalisieren – manche XML-Werte enthalten Newlines
 * (z.B. "StAZH OS 10 (S.\n                        115-120)").
 */
export function normalizeWhitespace(s: string | null | undefined): string {
	if (!s) return "";
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Anzuzeigender Titel eines Dokuments. Bei ABl ist `title` vor dem Re-Index
 * teils noch generisch ("Amtsblatt", "Amtsblatt des Kantons Zürich") bzw.
 * leer ("(ohne Titel)") – dann auf den stazhIdent zurückfallen. Spiegelt die
 * `displayTitle`-Logik der Detailseite (+page.svelte), damit Druckansicht und
 * UI denselben Titel zeigen.
 */
export function displayTitle(doc: {
	title: string;
	series: SeriesAbbr;
	stazhIdent: string | null;
}): string {
	const ident = normalizeWhitespace(doc.stazhIdent);
	const generic =
		doc.title === SERIES_LABEL[doc.series] ||
		doc.title === "Amtsblatt des Kantons Zürich" ||
		doc.title === "(ohne Titel)";
	return generic && ident ? ident : normalizeWhitespace(doc.title);
}

/**
 * Herkunft (Quelle/Publisher) eines Dokuments nach Teilbestand: Der
 * digitalisierte Altbestand (`subset` leer) stammt vom Staatsarchiv, die
 * born-digital Spätbestände von der jeweils publizierenden Behörde (wie
 * `<authority>` in services/{krp-gever,rrb-zhweb,os-zhlex}/src/tei.ts). Ein
 * unbekannter Teilbestand ist per Definition born-digital, also nicht vom
 * Staatsarchiv. Die Kurzlabels der Detailseite (`lateSourceLabel`) synchron
 * halten.
 */
export function documentSource(subset: string | null | undefined): string {
	if (!subset) return "Staatsarchiv des Kantons Zürich";
	switch (subset) {
		case "krp-late":
			return "Kantonsrat des Kantons Zürich";
		case "rrb-late":
			return "Regierungsrat des Kantons Zürich";
		case "os-late":
			return "Staatskanzlei des Kantons Zürich";
		default:
			return "Kanton Zürich";
	}
}
