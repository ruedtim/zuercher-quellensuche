/**
 * Lädt den Live-Excel-Export der Kantonsratsdatenbank (KRDB) und normalisiert
 * die Blätter Personen, Einsitze, Parteien und Wohnorte.
 *
 * Quelle ist bewusst der LIVE-Export (Echtzeit-Generierung des Statistischen
 * Amts), nicht die CSV auf opendata.swiss/GitHub (openZH/krdb-lod, Stand
 * 2023): Die KRDB hat Personen-IDs seither neu vergeben, und Wikidata P13468
 * folgt den Live-IDs.
 */

import { readXlsx, type SheetRow } from "./xlsx.ts";

export const KRDB_EXPORT_URL = "https://www.web.statistik.zh.ch:8443/KRRR/app?show_page=EXCEL&operation=EXCEL";
export const USER_AGENT = "archivquellen/1.0 (https://archivquellen.ch/impressum)";

export interface KrdbRawPerson {
  id: number;
  last: string;
  first: string;
  sex?: "m" | "w";
  born?: number;
  /** Geburtsdatum «YYYY[-MM[-DD]]» – nur für den Abgleich veralteter P13468,
   *  wird nicht ins Register geschrieben. */
  bornDate?: string;
  died?: number;
  gnd?: string;
  hls?: string;
  viaf?: string;
}

export interface KrdbData {
  persons: KrdbRawPerson[];
  /** Einsitze je Person: [Rat, von, bis|null, Wahlkreis|null] */
  seats: Map<number, Array<[string, string, string | null, string | null]>>;
  /** Parteien je Person: [Partei, Fraktion|null, von|null, bis|null] */
  parties: Map<number, Array<[string, string | null, string | null, string | null]>>;
  /** Wohnorte je Person: [Gemeinde, von|null, bis|null] */
  places: Map<number, Array<[string, string | null, string | null]>>;
  sheetCounts: Record<string, number>;
}

export async function downloadExport(): Promise<Uint8Array> {
  const res = await fetch(KRDB_EXPORT_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`KRDB-Export: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("KRDB-Export: keine XLSX-Datei (kein ZIP)");
  return buf;
}

function int(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Datumsteile (JAHR/MONAT/TAG) → "YYYY", "YYYY-MM" oder "YYYY-MM-DD". */
export function partialDate(row: SheetRow, prefix: string): string | null {
  const y = int(row[`${prefix}_JAHR`]);
  if (!y) return null;
  const m = int(row[`${prefix}_MONAT`]);
  const d = int(row[`${prefix}_TAG`]);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (m && m <= 12) return d && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : `${y}-${pad(m)}`;
  return String(y);
}

function sheet(sheets: Map<string, SheetRow[]>, name: string): SheetRow[] {
  const rows = sheets.get(name);
  if (!rows) throw new Error(`KRDB-Export: Blatt «${name}» fehlt (vorhanden: ${[...sheets.keys()].join(", ")})`);
  if (rows.length > 0 && !("ID_PERSON_NEW" in rows[0])) {
    throw new Error(`KRDB-Export: Blatt «${name}» ohne Spalte ID_PERSON_NEW – Format geändert?`);
  }
  return rows;
}

function push<T>(map: Map<number, T[]>, id: number, value: T): void {
  const arr = map.get(id);
  if (arr) arr.push(value);
  else map.set(id, [value]);
}

export function parseExport(buf: Uint8Array): KrdbData {
  const sheets = readXlsx(buf);
  const personen = sheet(sheets, "Personen");
  const einsitze = sheet(sheets, "Einsitze");
  const parteien = sheet(sheets, "Parteien");
  const wohnorte = sheet(sheets, "Wohnorte");

  const persons: KrdbRawPerson[] = [];
  for (const r of personen) {
    const id = int(r["ID_PERSON_NEW"]);
    if (!id) continue;
    const sex = r["GESCHLECHT"] === "w" ? "w" : r["GESCHLECHT"] === "m" ? "m" : undefined;
    persons.push({
      id,
      last: r["NACHNAME"] ?? "",
      first: r["VORNAME"] ?? "",
      sex,
      born: int(r["DATUM_GEBURT_JAHR"]),
      bornDate: partialDate(r, "DATUM_GEBURT") ?? undefined,
      died: int(r["DATUM_TOD_JAHR"]),
      gnd: r["GND"] || undefined,
      hls: r["HLS"] || undefined,
      viaf: r["VIAF"] || undefined,
    });
  }
  persons.sort((a, b) => a.id - b.id);

  const seats: KrdbData["seats"] = new Map();
  for (const r of einsitze) {
    const id = int(r["ID_PERSON_NEW"]);
    const from = partialDate(r, "DATUM_EINTRITT");
    if (!id || !from) continue;
    push(seats, id, [r["RAT"] ?? "", from, partialDate(r, "DATUM_AUSTRITT"), r["WAHLKREIS"] || null]);
  }
  for (const list of seats.values()) list.sort((a, b) => a[1].localeCompare(b[1]));

  const parties: KrdbData["parties"] = new Map();
  for (const r of parteien) {
    const id = int(r["ID_PERSON_NEW"]);
    const party = (r["PARTEIBEZEICHNUNG"] ?? "").trim();
    const faction = (r["FRAKTION"] ?? "").trim();
    if (!id || (!party && !faction)) continue;
    push(parties, id, [party || faction, faction && faction !== party ? faction : null, partialDate(r, "DATUM_VON"), partialDate(r, "DATUM_BIS")]);
  }
  for (const list of parties.values()) list.sort((a, b) => (a[2] ?? "").localeCompare(b[2] ?? ""));

  const places: KrdbData["places"] = new Map();
  for (const r of wohnorte) {
    const id = int(r["ID_PERSON_NEW"]);
    const place = (r["GEMEINDENAME"] ?? "").trim();
    if (!id || !place) continue;
    push(places, id, [place, partialDate(r, "DATUM_VON"), partialDate(r, "DATUM_BIS")]);
  }
  for (const list of places.values()) list.sort((a, b) => (a[1] ?? "").localeCompare(b[1] ?? ""));

  return {
    persons,
    seats,
    parties,
    places,
    sheetCounts: {
      Personen: personen.length,
      Einsitze: einsitze.length,
      Parteien: parteien.length,
      Wohnorte: wohnorte.length,
    },
  };
}
