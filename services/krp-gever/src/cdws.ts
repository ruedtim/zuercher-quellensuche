/**
 * Zugriff auf den Gever-Web-Service des Kantonsrates Zürich (CMI CDWS).
 *
 * Wir nutzen den Index `SITZUNGENDETAIL`, der alle Sitzungen auflistet. Pro
 * Sitzung des Gremiums `KR` (Kantonsrat-Plenum) hängt das Wort-/Verhandlungs-
 * protokoll als PDF-Dokument (`<Kategorie>Protokoll</Kategorie>`).
 *
 * Doku/Datensatz: https://opendata.swiss/ → "Organisation und Geschäfte des
 * Zürcher Kantonsrats"; openZH/KRZH_gever.
 */

import { XMLParser } from "fast-xml-parser";

/** Host, der den SITZUNGENDETAIL-Index bedient. Files liegen i.d.R. auf demselben. */
export const CDWS_INDEX_HOST = "parlzh3";
/** Datei-Download-Hosts in Fallback-Reihenfolge (Files liegen verteilt). */
export const CDWS_FILE_HOSTS = ["parlzh3", "parlzh2", "parlzh5"] as const;
const CDWS_BASE = (host: string) => `https://parlzhcdws.cmicloud.ch/${host}/cdws`;

export const USER_AGENT =
  "zszh-krp-gever/0.1 (+https://archivquellen.ch; Kantonsratsprotokolle-Indexierung)";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
  // Entity-Verarbeitung aus: fast-xml-parser hat eine DoS-Schranke (max. 1000
  // Entities pro Parse), die eine 200er-Seite reisst. Wir dekodieren die paar
  // Standard-Entities selbst in textOf().
  processEntities: false,
});

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** Eine Kantonsrats-Sitzung mit (falls vorhanden) ihrem Protokoll-PDF. */
export interface ProtocolSession {
  /** Sitzungstitel, z. B. "36. KR-Sitzung". */
  sessionTitle: string;
  /** Dokumenttitel des Protokolls, z. B. "36. KR-Protokoll vom 08.01.2024". */
  protocolTitle: string;
  /** ISO-Datum der Sitzung (YYYY-MM-DD). */
  date: string;
  /** Jahr aus date. */
  year: number;
  /** Sitzungsnummer innerhalb der Legislatur (kann fehlen). */
  sessionNr: number | null;
  /** eDokument-ID, z. B. "26013fac21114148b6c7d59001cb0faf-332". */
  eDokumentId: string;
  /** GUID-Anteil der eDokument-ID (vor dem "-…"). Stabiler, eindeutiger Schlüssel. */
  guid: string;
  /** Version-Nr, deren Rendition das PDF ist (Pfadsegment im Files-Endpoint). */
  pdfVersion: number;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return decodeEntities(v.trim());
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    if (typeof t === "string") return decodeEntities(t.trim());
    if (typeof t === "number") return String(t);
  }
  return "";
}

/** ISO-Datetime "1995-05-08T00:00:00.000" → "1995-05-08". */
function isoDate(v: unknown): string | null {
  const s = textOf(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Baut die SITZUNGENDETAIL-Query. `gremium all KR` filtert auf das Plenum.
 * Datumsfenster optional (für Sampling nach Jahr).
 */
function buildQuery(opts: { since: string; until?: string }): string {
  const clauses = [
    "gremium all KR",
    `datum_start >= "${opts.since} 00:00:00"`,
  ];
  if (opts.until) clauses.push(`datum_start <= "${opts.until} 23:59:59"`);
  return `${clauses.join(" and ")} sortBy datum_start/sort.ascending`;
}

/** Aus einer `<Sitzung>` das Protokoll-Dokument + PDF-Version herauslösen (oder null). */
function extractProtocol(sitzung: Record<string, unknown>): ProtocolSession | null {
  const date = isoDate((sitzung["Datum"] as Record<string, unknown>)?.["Start"]);
  if (!date) return null;

  const dokumente = asArray(
    (sitzung["Sitzungsdokumente"] as Record<string, unknown> | undefined)?.["Dokument"],
  ) as Array<Record<string, unknown>>;

  const protokoll = dokumente.find((d) => textOf(d["Kategorie"]) === "Protokoll");
  if (!protokoll) return null;

  const eDok = protokoll["eDokument"] as Record<string, unknown> | undefined;
  const eDokumentId = eDok ? String(eDok["@_ID"] ?? "") : "";
  if (!eDokumentId) return null;
  // Die ID kommt von aussen und wird Teil von Dateinamen, Adressen und (late-sync) Befehlen im Bericht.
  if (!/^[A-Za-z0-9]{8,64}(-[A-Za-z0-9]{1,16})?$/.test(eDokumentId)) {
    console.warn(`[cdws] unerwartete eDokument-ID, Sitzung vom ${date} übersprungen: ${JSON.stringify(eDokumentId.slice(0, 80))}`);
    return null;
  }

  // Höchste Version, deren Rendition ein PDF ist → deren Nr ist das Pfadsegment.
  let pdfVersion = -1;
  for (const ver of asArray(eDok?.["Version"]) as Array<Record<string, unknown>>) {
    const nr = Number.parseInt(String(ver["@_Nr"] ?? ""), 10);
    if (!Number.isFinite(nr)) continue;
    const hasPdf = asArray(ver["Rendition"]).some(
      (r) => String((r as Record<string, unknown>)["@_Extension"] ?? "").toLowerCase() === "pdf",
    );
    if (hasPdf && nr > pdfVersion) pdfVersion = nr;
  }
  if (pdfVersion < 0) return null;

  const sessionNrRaw = Number.parseInt(textOf(sitzung["Sitzungsnummer"]), 10);

  return {
    sessionTitle: textOf(sitzung["Titel"]),
    protocolTitle: textOf(protokoll["Titel"]) || textOf(sitzung["Titel"]),
    date,
    year: Number.parseInt(date.slice(0, 4), 10),
    sessionNr: Number.isFinite(sessionNrRaw) ? sessionNrRaw : null,
    eDokumentId,
    guid: eDokumentId.split("-")[0],
    pdfVersion,
  };
}

/**
 * Listet alle KR-Plenarsitzungen mit Protokoll-PDF ab `since` (paginiert).
 * Liefert chronologisch aufsteigend. Sitzungen ohne Protokoll werden gezählt
 * (onSkip) und ausgelassen.
 */
export async function listProtocolSessions(opts: {
  since: string;
  until?: string;
  pageSize?: number;
  onProgress?: (loaded: number, total: number) => void;
  onSkipNoProtocol?: (sessionTitle: string, date: string | null) => void;
}): Promise<ProtocolSession[]> {
  const pageSize = opts.pageSize ?? 200;
  const q = encodeURIComponent(buildQuery({ since: opts.since, until: opts.until }));
  const out: ProtocolSession[] = [];
  const seen = new Set<string>();

  // `s` ist ein 1-basierter DATENSATZ-Offset (kein Seitenindex): s=2 startet bei
  // Datensatz 2. Also pro Seite um die tatsächlich gelieferte Trefferzahl
  // weiterrücken, sonst überlappen die Seiten.
  let start = 1;
  let total = Infinity;
  let loaded = 0;

  while (start <= total) {
    const url =
      `${CDWS_BASE(CDWS_INDEX_HOST)}/Index/SITZUNGENDETAIL/searchdetails` +
      `?q=${q}&l=de-CH&m=${pageSize}&s=${start}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`SITZUNGENDETAIL HTTP ${res.status} (s=${start})`);
    const xml = await res.text();
    const doc = parser.parse(xml) as Record<string, unknown>;
    const resp = doc["SearchDetailResponse"] as Record<string, unknown> | undefined;
    if (!resp) throw new Error(`SITZUNGENDETAIL: kein SearchDetailResponse (s=${start})`);

    total = Number.parseInt(String(resp["@_numHits"] ?? "0"), 10) || 0;

    const hits = asArray(resp["Hit"]) as Array<Record<string, unknown>>;
    if (hits.length === 0) break;

    for (const hit of hits) {
      loaded++;
      const sitzung = hit["Sitzung"] as Record<string, unknown> | undefined;
      if (!sitzung) continue;
      const prot = extractProtocol(sitzung);
      if (prot) {
        if (!seen.has(prot.guid)) {
          seen.add(prot.guid);
          out.push(prot);
        }
      } else {
        opts.onSkipNoProtocol?.(textOf(sitzung["Titel"]), isoDate((sitzung["Datum"] as Record<string, unknown>)?.["Start"]));
      }
    }

    opts.onProgress?.(loaded, total);
    start += hits.length;
  }

  // Defensiv chronologisch sortieren (API sortiert bereits aufsteigend).
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Files-Endpoint-URL für ein Protokoll-PDF auf einem bestimmten Host. */
export function pdfUrl(host: string, eDokumentId: string, version: number): string {
  return `${CDWS_BASE(host)}/Files/${eDokumentId}/${version}/pdf`;
}
