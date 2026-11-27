/**
 * Erzeugt TEI-XML im Format des OS-Korpus (ein Dokument pro Erlass-Publikation).
 * Bewusst OHNE `<figure>/<graphic>/<facsimile>`, damit der Indexer
 * (`iiif.ts:resolveIIIF` → kind "none") keine manifestUrl setzt und die
 * Detailansicht nur den Text zeigt (kein Faksimile). Der Teilbestands-Marker
 * `os-late` wird vom Indexer pfadbasiert vergeben (Datei liegt unter
 * `data/OS/OS_late/`).
 *
 * Der Indexer-Parser leitet die OS-Felder so ab:
 *   <idno>131.1</idno>   → serialNr (Ordnungsnummer, LS-Systematik)
 *   <ident>OS 81</ident> → volumeNr (OS-Bandnummer; Regex `OS\s+(\d+)`)
 *   <ref target="…"/>    → archiveLink (zh.ch-Erlass-Seite, Original-PDF-Link)
 */

import type { OsEntry } from "./scrape.ts";

// Element-Textinhalt: laut XML-Spec müssen nur & und < escaped werden. " ' >
// bewusst NICHT escapen – das spart pro Body massenhaft Entities (&quot;/&apos;)
// und hält XML-Parser unter ihrer Entity-Expansion-Schranke.
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// Attributwerte (in "…"): zusätzlich " escapen. & und < ohnehin.
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** ID/Dateiname (enthält `_YYYY_` für die Jahr-Fallback-Regex des Parsers). */
export function teiId(e: OsEntry): string {
  return e.id;
}

/** "DD.MM.YYYY" → ISO "YYYY-MM-DD", oder null wenn nicht parsebar. */
function deDateToIso(de: string): string | null {
  const m = de.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/**
 * Vollständiges TEI für eine OS-Erlass-Publikation. `<ref target>` = zh.ch-Erlass-
 * Detailseite (führt zum Original-PDF auf notes.zh.ch).
 */
export function buildOsTei(e: OsEntry, paragraphs: string[]): string {
  const human = e.reference_number ? `OS ${e.reference_number}` : "OS";
  const title = escText(e.title || human);
  // Datum aus chosen_date (= enactment_date, oder eif bei unplausiblem Tippfehler-
  // Jahr); Fallback enactment_date für alte Index-Dateien ohne chosen_date.
  const dateStr = e.chosen_date ?? e.enactment_date;
  const iso = deDateToIso(dateStr);
  const dateEl = iso
    ? `<date when="${iso}">${escText(dateStr)}</date>`
    : dateStr
      ? `<date>${escText(dateStr)}</date>`
      : "";
  // <idno> = Ordnungsnummer → serialNr-Facette ("Ordnungsnummer").
  const idno = e.reference_number ? `<idno>${escText(e.reference_number)}</idno>` : "";
  // <ident> = "OS <Band>" → volumeNr-Facette ("Bandnummer"). Ohne Band weglassen.
  const ident = e.band !== null ? `<ident>OS ${e.band}</ident>` : "";
  // Bewusst <ref> (nicht <figure>/<graphic> – Letzteres würde IIIF/Bilder triggern).
  const ref = e.page_url ? `<ref target="${escAttr(e.page_url)}"/>` : "";
  const body = paragraphs.length > 0 ? paragraphs.map((p) => `<p>${escText(p)}</p>`).join("") : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<TEI xmlns="http://www.tei-c.org/ns/1.0">` +
    `<teiHeader><fileDesc>` +
    `<titleStmt><title>${title}</title></titleStmt>` +
    `<publicationStmt><authority>Staatskanzlei des Kantons Zürich</authority><pubPlace>Zürich</pubPlace></publicationStmt>` +
    `<seriesStmt><title>Offizielle Gesetzessammlung</title></seriesStmt>` +
    `<sourceDesc><bibl>` +
    `<title>${title}</title>` +
    dateEl +
    ident +
    idno +
    `<edition>Offizielle Gesetzessammlung (Kanton Zürich, ZH-Lex)</edition>` +
    ref +
    `</bibl></sourceDesc>` +
    `</fileDesc></teiHeader>` +
    `<text><body>${body}</body></text>` +
    `</TEI>`
  );
}
