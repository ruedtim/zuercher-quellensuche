/**
 * Erzeugt TEI-XML im Format des RRB-Korpus (ein Dokument pro Beschluss).
 * Bewusst OHNE `<figure>/<graphic>/<facsimile>`, damit der Indexer
 * (`iiif.ts:resolveIIIF` → kind "none") keine manifestUrl setzt und die
 * Detailansicht nur den Text zeigt (kein Faksimile). Der Teilbestands-Marker
 * `rrb-late` wird vom Indexer pfadbasiert vergeben (Datei liegt unter
 * `data/RRB/RRB_late/`).
 */

import type { RrbEntry } from "./scrape.ts";

// Element-Textinhalt: laut XML-Spec müssen nur & und < escaped werden. " ' >
// bewusst NICHT escapen – das spart pro Body massenhaft Entities (&quot;/&apos;)
// und hält fast-xml-parser unter seiner Entity-Expansion-Schranke (1000/Doc).
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// Attributwerte (in "…"): zusätzlich " escapen. & und < ohnehin.
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** ID/Dateiname: `RRB_<YYYY>_<NNNN>` (4-stellig genullt). Enthält `_YYYY_` für die Jahr-Fallback-Regex des Parsers. */
export function teiId(e: RrbEntry): string {
  return `RRB_${e.year}_${pad4(e.decision_number)}`;
}

/** "DD.MM.YYYY" → ISO "YYYY-MM-DD", oder null wenn nicht parsebar. */
function deDateToIso(de: string): string | null {
  const m = de.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

// Boilerplate-Kopf, der jeden RRB-Body einleitet – redundant zu `<title>`/`<date>`.
// Über die Jahrgänge variiert die Form, daher mehrere tolerante Muster:
//   "[Auszug aus dem] Protokoll des Regierungsrates des Kantons Zürich"
//   "[Klausur]Sitzung vom <Tag>[.] <Monat> <Jahr>"
// Bei manchen Beschlüssen (Anfragen) steht zwischen beiden eine "KR-Nr."-Zeile,
// d. h. der Datums-Teil landet im 2. Absatz → wir prüfen die ersten zwei Absätze.

/** Reiner Seiten-Marker als ganzer Absatz, z. B. "–1–". */
const PAGE_MARKER = /^[–—-]\s*\d+\s*[–—-]$/u;
/** "[Auszug aus dem] Protokoll des Regierungsrates des Kantons Zürich" am Absatzanfang. */
const PROTO_PHRASE =
  /^(?:Auszug\s+aus\s+dem\s+)?Protokoll\s+(?:§\s+)?des\s+Regierungsrates\s+des\s+Kantons\s+Zürich[\s:]*/u;
/** "[Klausur]Sitzung vom <Tag>[.] <Monat> <Jahr>" am Absatzanfang (Punkt nach Tag optional). */
const DATE_HEADER = /^(?:Klausur)?[Ss]itzung\s+vom\s+\d{1,2}\.?\s+\p{L}+\s+\d{4}[\s:]*/u;

/**
 * Entfernt den Protokoll-/Sitzungs-Kopf vom Body-Anfang. Robust gegen die
 * beobachteten Layout-Varianten (Seitenmarke voran, "Protokoll" ohne "Auszug
 * aus dem", Klausursitzung, Datum mit/ohne Tag-Punkt, Datum im 2. Absatz).
 */
export function stripProtocolHeader(paragraphs: string[]): string[] {
  const paras = paragraphs.slice();
  const dropEmptyLead = () => {
    while (paras.length > 0 && paras[0].trim() === "") paras.shift();
  };
  // 1) führende reine Seitenmarke ("–1–") verwerfen
  while (paras.length > 0 && PAGE_MARKER.test(paras[0].trim())) paras.shift();
  if (paras.length === 0) return paras;
  // 2) "[Auszug aus dem] Protokoll … Kantons Zürich" am Anfang von p0, dann den
  //    ggf. nur-Header-Absatz entfernen – damit ein "Sitzung vom …" das bei
  //    Anfragen erst nach einer "KR-Nr."-Zeile folgt, in die ersten zwei Absätze rückt.
  paras[0] = paras[0].replace(PROTO_PHRASE, "");
  dropEmptyLead();
  // 3) führendes "Sitzung vom <Datum>" aus den ersten beiden Absätzen
  for (let k = 0; k < Math.min(2, paras.length); k++) {
    paras[k] = paras[k].replace(DATE_HEADER, "");
  }
  // 4) dadurch leer gewordene führende Absätze entfernen
  dropEmptyLead();
  return paras;
}

/**
 * Vollständiges TEI für einen RRB. `<ident>RRB <YYYY>/<NNNN>` ⇒ der Indexer-
 * Parser leitet daraus `resolutionId="<YYYY>/<NNNN>"` ab (jahr-zuerst, konsistent
 * mit dem digitalisierten Altbestand). `<ref target>` = zh.ch-Seite (Original-PDF-Link).
 */
export function buildRrbTei(e: RrbEntry, paragraphs: string[]): string {
  const human = `RRB ${e.year}/${pad4(e.decision_number)}`;
  const title = escText(e.title || human);
  const iso = deDateToIso(e.session_date);
  const dateEl = iso
    ? `<date when="${iso}">${escText(e.session_date)}</date>`
    : e.session_date
      ? `<date>${escText(e.session_date)}</date>`
      : "";
  // Bewusst <ref> (nicht <figure>/<graphic> – Letzteres würde IIIF/Bilder triggern).
  const ref = e.page_url ? `<ref target="${escAttr(e.page_url)}"/>` : "";
  const paras = stripProtocolHeader(paragraphs);
  const body = paras.length > 0 ? paras.map((p) => `<p>${escText(p)}</p>`).join("") : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<TEI xmlns="http://www.tei-c.org/ns/1.0">` +
    `<teiHeader><fileDesc>` +
    `<titleStmt><title>${title}</title></titleStmt>` +
    `<publicationStmt><authority>Regierungsrat des Kantons Zürich</authority><pubPlace>Zürich</pubPlace></publicationStmt>` +
    `<seriesStmt><title>Regierungsratsbeschlüsse</title></seriesStmt>` +
    `<sourceDesc><bibl>` +
    `<title>${title}</title>` +
    dateEl +
    `<ident>${escText(human)}</ident>` +
    `<edition>Regierungsratsbeschlüsse (Kanton Zürich, zh.ch)</edition>` +
    ref +
    `</bibl></sourceDesc>` +
    `</fileDesc></teiHeader>` +
    `<text><body>${body}</body></text>` +
    `</TEI>`
  );
}
