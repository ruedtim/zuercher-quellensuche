// Entscheidung Einzeldatei vs. ZIP für den Dokument-Download, plus die
// Dateinamen-/Plaintext-Helfer (geteilt mit dem Treffer-Export). Bewusst ohne
// $env-/$lib-Imports (nur reine Logik), damit das Modul unter `tsx --test` läuft.
//
// Regel: Genau ein Textformat (Volltext/HTML/TEI-XML) und KEINE Bilder → die
// Datei wird direkt ausgeliefert (mit dem Namen, den sonst das ZIP trägt),
// statt sie in ein ZIP mit nur einem Eintrag zu verpacken. Sobald mehrere
// Formate oder Bilder im Spiel sind, bleibt es ein ZIP.

export type SingleFileFormat = "txt" | "html" | "xml";

const SINGLE_FILE_FORMATS: SingleFileFormat[] = ["txt", "html", "xml"];

/**
 * Liefert das einzige Textformat zurück, wenn der Download eine Einzeldatei
 * sein soll (genau ein Format, keine Bilder), sonst null (⇒ ZIP-Pfad).
 */
export function pickSingleFile(
	formats: ReadonlySet<string>,
	images: boolean,
): SingleFileFormat | null {
	if (images) return null;
	if (formats.size !== 1) return null;
	const only = [...formats][0];
	return (SINGLE_FILE_FORMATS as string[]).includes(only)
		? (only as SingleFileFormat)
		: null;
}

const CONTENT_TYPE: Record<SingleFileFormat, string> = {
	txt: "text/plain; charset=utf-8",
	html: "text/html; charset=utf-8",
	xml: "application/xml; charset=utf-8",
};

/** Dateiname (Slug + Endung) + Content-Type für einen Einzeldatei-Download. */
export function singleFileMeta(
	slug: string,
	fmt: SingleFileFormat,
): { filename: string; contentType: string } {
	return { filename: `${slug}.${fmt}`, contentType: CONTENT_TYPE[fmt] };
}

/**
 * Dateisystem-sicherer Name aus der Signatur (Fallback: Doc-ID) – für das
 * Dokument-Paket wie für die Volltext-Dateien des Treffer-Exports.
 */
export function buildSlug(stazhIdent: string | null | undefined, fallbackId: string): string {
	const base = (stazhIdent && stazhIdent.trim()) || fallbackId;
	const folded = base
		.replace(/[äÄ]/g, "a")
		.replace(/[öÖ]/g, "o")
		.replace(/[üÜ]/g, "u")
		.replace(/ß/g, "ss")
		.replace(/[éèêë]/gi, "e")
		.replace(/[àâá]/gi, "a")
		.replace(/[ç]/gi, "c")
		.replace(/[–—]/g, "-");
	const slug = folded.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_");
	return slug.replace(/^[_.-]+|[_.-]+$/g, "") || "dokument";
}

export interface PlainTextDoc {
	title?: string | null;
	stazhIdent?: string | null;
	date?: string | null;
	body?: string | null;
}

/** Volltext als Plaintext: Kopf (Titel – Signatur – Datum), Trennlinie, Body. */
export function buildPlainText(doc: PlainTextDoc): string {
	const title = (doc.title ?? "").trim();
	const ident = (doc.stazhIdent ?? "").trim();
	const date = doc.date ?? "";
	const body = (doc.body ?? "").trim();
	const header: string[] = [];
	if (title) header.push(title);
	if (ident) header.push(ident);
	if (date) header.push(date);
	const headerStr = header.length > 0 ? header.join(" – ") + "\n" + "=".repeat(60) + "\n\n" : "";
	return headerStr + body + "\n";
}
