/**
 * Ausdrückliche Verknüpfungen einer Katalogeinheit, ohne Namensabgleich:
 * Weblinks auf die Zentralen Serien (= Plattform-ID), auf die
 * Kantonsratsdatenbank und die GND sowie die Sitzungsangabe der Ratsmanuale
 * (Signatur «B II 400 (S. 1-2)»). Pur, unit-getestet in links.test.ts.
 */

import type { CatalogRecord, DocSeries } from "./types.ts";

/** Alle Link-Ziele der Detailseite, in Feldreihenfolge. */
export function allLinks(rec: CatalogRecord): string[] {
  return rec.sections.flatMap((s) => s.fields.flatMap((f) => f.links.map((l) => l.href)));
}

/** Text eines Feldes (erste Belegung über alle Sektionen). */
export function fieldText(rec: CatalogRecord, key: string): string | undefined {
  for (const s of rec.sections) {
    for (const f of s.fields) if (f.key === key && f.text.trim()) return f.text.trim();
  }
  return undefined;
}

const ZS_LINK = /^https?:\/\/(?:www\.)?zentraleserien\.zh\.ch\/documents\/(abl|krp|os|rrb)\/([^/?#\s]+)/i;
const ZS_SERIES: Record<string, DocSeries> = { abl: "ABl", krp: "KRP", os: "OS", rrb: "RRB" };

/** Plattform-Dokument aus dem Weblink «Volltext und Digitalisat» (ID = Dateiname der TEI). */
export function zsDoc(rec: CatalogRecord): { series: DocSeries; id: string } | null {
  for (const href of allLinks(rec)) {
    const m = ZS_LINK.exec(href);
    if (m) return { series: ZS_SERIES[m[1].toLowerCase()], id: decodeURIComponent(m[2]) };
  }
  return null;
}

/** Signaturen der Zentralen Serien: «MM 2.190 RRB 1870/2529», «MM 24.7 KRP 1830/0066»,
 *  «ABl 1980 (S. 11-16)», «OS 54 (S. 6)», «OS NF 1 (S. 88-90)». */
const ZS_SIGNATURE = /^(?:MM|ABl|OS)\s/;

/**
 * Bildet die Einheit ein Dokument der Zentralen Serien ab? Nur mit Weblink und Signatur
 * der Serien. Andere Einheiten mit Weblink auf ein Dokument verweisen nur darauf (Urkunde
 * «C I, Nr. 3889» → Regierungsratsbeschluss) und bleiben eigene Treffer.
 */
export function isZsUnit(rec: CatalogRecord): boolean {
  return ZS_SIGNATURE.test((rec.signature ?? "").trim()) && zsDoc(rec) !== null;
}

/** KRDB-Personen-IDs aus Weblinks (…/KRRRPublic/app?id=<ID>). */
export function krdbLinkIds(rec: CatalogRecord): number[] {
  const ids = new Set<number>();
  for (const href of allLinks(rec)) {
    const m = /KRRRPublic\/app\?id=(\d+)/i.exec(href);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids];
}

/** GND-Nummern aus Weblinks (d-nb.info/gnd/…). */
export function gndIds(rec: CatalogRecord): string[] {
  const ids = new Set<string>();
  for (const href of allLinks(rec)) {
    const m = /d-nb\.info\/gnd\/([0-9X-]+)/i.exec(href);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

export interface RmSessionRef {
  /** Bandnummer wie in der Signatur («400», «555a»). */
  band: string;
  pageFrom: number;
  pageTo: number;
}

/** Sitzungs-Subdossier der Ratsmanuale: «B II 400 (S. 1-2)», bei mehreren Sitzungen auf
 *  einer Seite «B II 418 (S. 68, Eintrag 2)» (Stichprobe 2026-10: 12 %); Titel «Ratssitzung …». */
export function rmSessionRef(rec: CatalogRecord): RmSessionRef | null {
  if (!/^Ratssitzung\b/.test(rec.title ?? "")) return null;
  const m = /^B II (\d+[a-z]?)\s*\(S\.\s*(\d+)(?:\s*[-–]\s*(\d+))?(?:,\s*Eintrag\s*\d+)?\)/.exec(rec.signature ?? "");
  if (!m) return null;
  const pageFrom = Number(m[2]);
  return { band: m[1], pageFrom, pageTo: m[3] ? Number(m[3]) : pageFrom };
}

/** «02.07.1632» → «1632-07-02»; andere Formen → null. */
export function isoDay(dateText: string | null | undefined): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((dateText ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
