/**
 * Ratsmanuale: Sitzungs-Subdossiers des Katalogs den RM-Dokumenten der
 * Plattform zuordnen.
 *
 * Die RM-TEI (services/rm-transkribus, auf dem Mac unter ~/zszh-rm/tei) trägt
 * Band und Seiten im `<ident>` («StAZH B II 987, S. 48–50») und das Datum in
 * `<date when>`; der Katalog dieselben Angaben in Signatur und
 * Entstehungszeitraum. Zuerst entscheidet die Anfangsseite, dann die
 * Seitenüberschneidung mit dem Datum als Gegenprobe, zuletzt das Datum allein.
 * Kalender: beide Seiten geben das Datum der Quelle wieder (bis 1700 alter Stil).
 */

import { readdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { RmSessionRef } from "./links.ts";

export interface RmSession {
  id: string;
  band: string;
  date: string | null;
  pageFrom: number;
  pageTo: number;
}

/** Kopf einer RM-TEI → Sitzung; null ohne lesbaren `<ident>`. */
export function parseRmHeader(id: string, xml: string): RmSession | null {
  const ident = /<ident>StAZH B II (\d+[a-z]?), S\. (\d+)(?:\s*[–-]\s*(\d+))?[^<]*<\/ident>/.exec(xml);
  if (!ident) return null;
  const date = /<date when="(\d{4}-\d{2}-\d{2})"/.exec(xml);
  const pageFrom = Number(ident[2]);
  return {
    id,
    band: ident[1].replace(/^0+(?=\d)/, ""),
    date: date ? date[1] : null,
    pageFrom,
    pageTo: ident[3] ? Number(ident[3]) : pageFrom,
  };
}

/** Alle RM-Sitzungen unter `<teiDir>/data/RM/<Band>/*.xml`, nach Band gruppiert. */
export async function loadRmSessions(teiDir: string): Promise<Map<string, RmSession[]>> {
  const root = join(teiDir, "data", "RM");
  const byBand = new Map<string, RmSession[]>();
  const buf = Buffer.alloc(4096);
  for (const dir of (await readdir(root)).sort()) {
    let files: string[];
    try {
      files = (await readdir(join(root, dir))).filter((f) => f.endsWith(".xml"));
    } catch {
      continue;
    }
    for (const file of files) {
      const fh = await open(join(root, dir, file), "r");
      try {
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const s = parseRmHeader(file.slice(0, -4), buf.toString("utf8", 0, bytesRead));
        if (!s) continue;
        const list = byBand.get(s.band) ?? [];
        list.push(s);
        byBand.set(s.band, list);
      } finally {
        await fh.close();
      }
    }
  }
  return byBand;
}

export type RmMatch = { id: string; via: "page" | "overlap" | "date" } | { ambiguous: string[] } | null;

/**
 * Ein abweichendes Datum schliesst aus, wenn beide Seiten eines haben
 * (Stichprobe 2026-10: 1'568 von 1'578 Seitentreffern mit gleichem Datum, die
 * übrigen 10 waren Fehlgriffe über Seiten an Sitzungsgrenzen).
 */
export function matchRmSession(ref: RmSessionRef, date: string | null, sessions: readonly RmSession[] | undefined): RmMatch {
  if (!sessions || sessions.length === 0) return null;
  const agrees = (s: RmSession) => date === null || s.date === null || s.date === date;
  const byStart = sessions.filter((s) => s.pageFrom === ref.pageFrom && agrees(s));
  if (byStart.length === 1) return { id: byStart[0].id, via: "page" };
  const overlap = sessions.filter((s) => s.pageFrom <= ref.pageTo && ref.pageFrom <= s.pageTo && agrees(s));
  if (overlap.length === 1) return { id: overlap[0].id, via: "overlap" };
  const sameDayOverlap = overlap.filter((s) => date !== null && s.date === date);
  if (sameDayOverlap.length === 1) return { id: sameDayOverlap[0].id, via: "overlap" };
  // Seitenzählung weicht ab: das Datum allein, wenn es im Band eindeutig ist.
  const sameDay = overlap.length === 0 ? sessions.filter((s) => date !== null && s.date === date) : [];
  if (sameDay.length === 1) return { id: sameDay[0].id, via: "date" };
  const tied = overlap.length > 1 ? overlap : sameDay;
  return tied.length > 1 ? { ambiguous: tied.map((s) => s.id) } : null;
}
