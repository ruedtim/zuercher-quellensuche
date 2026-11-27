/**
 * Ehedatenbank (EDB) des Staatsarchivs: Zenodo-Datensatz ↔ gecrawlte Katalogeinheiten.
 *
 * Das Staatsarchiv veröffentlicht die Ehedatenbank als CSV auf Zenodo («Zürcher
 * Ehedaten 16.–18. Jahrhundert», Record 11191059, CC BY 4.0); die Spalte `ID` ist
 * die Katalog-ID. Der Crawl holt dieselben Einheiten (Signatur «…, EDB n») zuletzt.
 * Beide Seiten werden hier auf dieselben Felder gebracht und verglichen (Protokoll
 * edbAbgleich.ts); nach dem Vergleich nimmt der Index seit 2026-11 den Crawl
 * (ehedatenCrawl.ts, dort die Lesart der Zeilen für den Index).
 *
 * Die Katalogseite setzt den Titel aus den Spalten zusammen («Nachname, Vorname[,
 * Herkunft], getraut mit …»), führt die Zusatzinfos in «Inhalt und Form»
 * («Zusatzinformation:», dann je eine Zeile Mann und Frau, «-» = leer), die
 * Kirchgemeinde als Provenienz («Kirchgemeinde X»), den Band (Seite) als
 * «Anmerkungen» und GND/HLS als Links. `Datum` hat die Schreibweise der
 * Archivplan-Etiketten («1553.08.28», «(ca.)», «-»). Pur, unit-getestet in edb.test.ts.
 */

import { fieldText } from "./links.ts";
import type { CatalogRecord } from "./types.ts";
import { labelDateToCatalog } from "./unitTitle.ts";

export const EDB_COLUMNS = [
  "Signatur", "Nachname_Mann", "Vorname_Mann", "Herkunft_Mann", "HLS_Artikel_Mann", "GND_Mann",
  "Nachname_Frau", "Vorname_Frau", "Herkunft_Frau", "HLS_Artikel_Frau", "GND_Frau",
  "Zusatzinfo_Mann", "Zusatzinfo_Frau", "Datum", "Datum_Von", "Datum_Bis", "Kirchgemeinde", "Band",
  "Webseite", "ID",
] as const;
export type EdbRow = Record<(typeof EDB_COLUMNS)[number], string>;

/** RFC 4180: Komma (oder `sep`, etwa «;» der Excel-Exporte), Felder in Anführungszeichen
 *  (auch mit Zeilenumbruch), "" = ", BOM, CRLF. */
export function parseCsv(text: string, sep = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    let value = "";
    if (text[i] === '"') {
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q < 0) throw new Error("CSV: Anführungszeichen nicht geschlossen");
        value += text.slice(j, q);
        if (text[q + 1] === '"') {
          value += '"';
          j = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
    } else {
      let j = i;
      while (j < n && text[j] !== sep && text[j] !== "\n" && text[j] !== "\r") j++;
      value = text.slice(i, j);
      i = j;
    }
    row.push(value);
    if (text[i] === sep) {
      i++;
      if (i === n) row.push("");
      continue;
    }
    i += text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

/** CSV-Text des Zenodo-Datensatzes → Zeilen; bricht ab, wenn eine erwartete Spalte fehlt. */
export function edbRows(text: string): EdbRow[] {
  const [head, ...body] = parseCsv(text);
  const index = EDB_COLUMNS.map((c) => {
    const k = head.indexOf(c);
    if (k < 0) throw new Error(`EDB-CSV: Spalte «${c}» fehlt (Kopf: ${head.join(", ")})`);
    return k;
  });
  return body
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(EDB_COLUMNS.map((c, k) => [c, r[index[k]] ?? ""])) as EdbRow);
}

/** Die verglichenen Felder einer Eheeintragung. */
export interface EdbFields {
  signatur: string;
  titel: string;
  datum: string;
  zusatzMann: string;
  zusatzFrau: string;
  kirchgemeinde: string;
  band: string;
  /** GND-IDs, sortiert, « | »-getrennt */
  gnd: string;
  /** HLS-Artikelnummern, sortiert, « | »-getrennt */
  hls: string;
}

export const EDB_FIELDS = ["signatur", "titel", "datum", "zusatzMann", "zusatzFrau", "kirchgemeinde", "band", "gnd", "hls"] as const;

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
// «-» steht für eine leere Zusatzinfo; Anführungszeichen bleiben (s. classifyDiff).
const zusatz = (s: string | undefined) => {
  const v = norm(s);
  return v === "-" ? "" : v;
};
const idSet = (urls: string[], re: RegExp) =>
  [...new Set(urls.map(norm).filter(Boolean).map((u) => re.exec(u)?.[1] ?? u))].sort().join(" | ");
const GND = /gnd\/([0-9X-]+)/i;
const HLS = /articles\/(\d+)/;

function person(last: string, first: string, origin: string): string {
  return [last, first, origin].map(norm).filter(Boolean).join(", ");
}

/** Titel wie auf der Katalogseite. */
export function edbTitle(z: EdbRow): string {
  return `${person(z.Nachname_Mann, z.Vorname_Mann, z.Herkunft_Mann)}, getraut mit ${person(z.Nachname_Frau, z.Vorname_Frau, z.Herkunft_Frau)}`;
}

export function fromZenodo(z: EdbRow): EdbFields {
  return {
    signatur: norm(z.Signatur),
    titel: edbTitle(z),
    datum: norm(z.Datum) ? labelDateToCatalog(norm(z.Datum)) : "",
    zusatzMann: zusatz(z.Zusatzinfo_Mann),
    zusatzFrau: zusatz(z.Zusatzinfo_Frau),
    kirchgemeinde: norm(z.Kirchgemeinde),
    band: norm(z.Band),
    gnd: idSet([z.GND_Mann, z.GND_Frau], GND),
    hls: idSet([z.HLS_Artikel_Mann, z.HLS_Artikel_Frau], HLS),
  };
}

function fieldLinks(rec: CatalogRecord, key: string): string[] {
  return rec.sections.flatMap((s) => s.fields.filter((f) => f.key === key).flatMap((f) => f.links.map((l) => l.href)));
}

export function fromCrawl(rec: CatalogRecord): EdbFields {
  const lines = (fieldText(rec, "inhalt_und_form") ?? "").split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => /^Zusatzinformation:?$/.test(l));
  const [mann = "", frau = ""] = at >= 0 ? lines.slice(at + 1) : [];
  return {
    signatur: norm(rec.signature),
    titel: norm(rec.title),
    datum: norm(rec.date_text).replace(/^zwischen (.+) und (.+)$/, "$1 - $2"),
    zusatzMann: zusatz(mann),
    zusatzFrau: zusatz(frau),
    kirchgemeinde: norm(fieldText(rec, "provenienz")).replace(/^Kirchgemeinde /, ""),
    band: norm(fieldText(rec, "anmerkungen")),
    gnd: idSet(fieldLinks(rec, "gnd_links"), GND),
    hls: idSet(fieldLinks(rec, "weblinks").filter((u) => HLS.test(u)), HLS),
  };
}

export interface EdbDiff {
  field: (typeof EDB_FIELDS)[number];
  crawl: string;
  zenodo: string;
}

export function compareEdb(crawl: EdbFields, zenodo: EdbFields): EdbDiff[] {
  return EDB_FIELDS.filter((f) => crawl[f] !== zenodo[f]).map((f) => ({ field: f, crawl: crawl[f], zenodo: zenodo[f] }));
}

export type EdbDiffKind = "inhaltlich" | "anfuehrungszeichen" | "excel";

/**
 * Art einer Abweichung. Die Zenodo-CSV lief sichtbar durch Excel: Zellen, die mit
 * einem Zitat beginnen, verlieren die Anführungszeichen («"Josue"; Metzger» →
 * «Josue; Metzger»), «-X» wird zu «#NAME?», und «1696.10» wird als Zahl zu «1696.1»
 * (die Spalten `Datum_Von`/`Datum_Bis` stimmen dort). Ein unpaariges
 * Anführungszeichen in den Zusatzinfos des Katalogs («"Findi Preiter») lässt den
 * Export die Zellen Mann/Frau verschmelzen.
 */
export function classifyDiff(d: EdbDiff, z: EdbRow, crawl: EdbFields): EdbDiffKind {
  if (/^#[A-ZÄÖÜ/0]+[?!]?$/.test(d.zenodo)) return "excel";
  if ((d.field === "zusatzMann" || d.field === "zusatzFrau") && (crawl.zusatzMann + crawl.zusatzFrau).split('"').length % 2 === 0) {
    return "excel";
  }
  if (d.field === "datum") {
    const m = /^(\d{3,4})\.(\d)$/.exec(norm(z.Datum));
    if (m && d.crawl === `${m[2]}0.${m[1]}`) return "excel";
  }
  const unquoted = (s: string) => s.replace(/"/g, "").replace(/\s+/g, " ").trim();
  return unquoted(d.crawl) === unquoted(d.zenodo) ? "anfuehrungszeichen" : "inhaltlich";
}

/** Eheeintrag im Crawl (Stufe Dokument, Signatur «…, EDB n»), auch ohne Zenodo-Zeile. */
export function isEdbUnit(rec: CatalogRecord): boolean {
  return rec.level === "Dokument" && /, EDB \d+$/.test(rec.signature ?? "");
}
