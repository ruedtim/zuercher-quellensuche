/**
 * Erzeugt TEI-XML im Format des KRP-Korpus (vereinfacht, ein Dokument pro
 * Sitzung). Bewusst OHNE `<figure>/<graphic>/<facsimile>`, damit der Indexer
 * (`iiif.ts:resolveIIIF` → kind "none") keine manifestUrl setzt und die
 * Detailansicht keine Bilder, sondern nur den Text zeigt.
 */

import { pdfUrl, CDWS_INDEX_HOST, type ProtocolSession } from "./cdws.ts";
import type { Traktandum } from "./segment.ts";

const XML_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESC[c] ?? c);
}

/** Ganz-Sitzungs-ID/Dateiname (Fallback). Enthält `_YYYY_` für die Jahr-Fallback-Regex. */
export function teiId(s: ProtocolSession): string {
  return `KRP_${s.year}_g${s.guid}`;
}

/** Per-Traktandum-ID/Dateiname: `KRP_<YYYY>_g<guid>_t<NN>`. */
export function teiItemId(s: ProtocolSession, nr: number): string {
  return `KRP_${s.year}_g${s.guid}_t${String(nr).padStart(2, "0")}`;
}

/** ISO YYYY-MM-DD → DD.MM.YYYY (für die menschenlesbare `<date>`-Innenform). */
function deDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Gemeinsames TEI-Skelett – bewusst ohne `<figure>` (keine Bilder). */
function teiXml(opts: {
  dateIso: string;
  title: string;
  ident: string;
  idno?: string;
  /** Link zum Original-PDF (Gever) → wird vom Parser auf archiveLink gemappt. */
  ref?: string;
  paragraphs: string[];
}): string {
  const title = esc(opts.title);
  const body = opts.paragraphs.length > 0 ? opts.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("") : "";
  const idno = opts.idno ? `<idno>${esc(opts.idno)}</idno>` : "";
  // Bewusst <ref> (nicht <figure>/<graphic> – Letzteres würde IIIF/Bilder triggern).
  const ref = opts.ref ? `<ref target="${esc(opts.ref)}"/>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<TEI xmlns="http://www.tei-c.org/ns/1.0">` +
    `<teiHeader><fileDesc>` +
    `<titleStmt><title>${title}</title></titleStmt>` +
    `<publicationStmt><authority>Kantonsrat des Kantons Zürich</authority><pubPlace>Zürich</pubPlace></publicationStmt>` +
    `<seriesStmt><title>Kantonsratsprotokolle</title></seriesStmt>` +
    `<sourceDesc><bibl>` +
    `<title>${title}</title>` +
    `<date when="${opts.dateIso}">${deDate(opts.dateIso)}</date>` +
    `<ident>${esc(opts.ident)}</ident>` +
    idno +
    `<edition>Kantonsratsprotokolle (Gever-Web-Service Kantonsrat Zürich)</edition>` +
    ref +
    `</bibl></sourceDesc>` +
    `</fileDesc></teiHeader>` +
    `<text><body>${body}</body></text>` +
    `</TEI>`
  );
}

/** Original-PDF-URL (Gever) für eine Sitzung – Host parlzh3 (Publikationsbereich der KR-Protokolle). */
function sourcePdfUrl(s: ProtocolSession): string {
  return pdfUrl(CDWS_INDEX_HOST, s.eDokumentId, s.pdfVersion);
}

/** Ganz-Sitzungs-TEI (Fallback, wenn Segmentierung scheitert). */
export function buildTei(s: ProtocolSession, paragraphs: string[]): string {
  return teiXml({ dateIso: s.date, title: s.protocolTitle, ident: s.sessionTitle, ref: sourcePdfUrl(s), paragraphs });
}

/** Per-Traktandum-TEI. `<idno>`=Seitenbereich (analog Altbestand), `<ident>`=Sitzung·Traktandum·KR-Nr. */
export function buildTraktandumTei(s: ProtocolSession, t: Traktandum): string {
  const idno = t.startPage === t.endPage ? `${t.startPage}` : `${t.startPage}–${t.endPage}`;
  const ident =
    `${s.sessionTitle} · Traktandum ${t.nr}` + (t.krNr ? ` · ${t.krNr}` : "");
  return teiXml({ dateIso: s.date, title: t.title, ident, idno, ref: sourcePdfUrl(s), paragraphs: t.paragraphs });
}
