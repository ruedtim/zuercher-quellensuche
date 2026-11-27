/**
 * Geprüfte Mehrfacheinträge der Ehedatenbank → Liste für die Web-App
 * (apps/web/src/lib/server/data/ehedaten-mehrfach.json, committet): Ehen, die in den
 * Kirchenbüchern zweier Kirchgemeinden stehen (meist verkündet bzw. eingetragen in der
 * einen, getraut in der anderen), als Paare von Katalog-IDs (= `id` im Index `ehedaten`).
 *
 * Quelle: Repository stazh/sw-ehedaten des Staatsarchivs («Wissensnetz der Zürcher
 * Ehedaten»), `sourcedata/csv/EDB_Mehrfacheintraege.csv` (Semikolon, 5'403 Ehen mit je zwei
 * Einträgen, `Scope-ID` = Katalog-ID, `Sicherheitswert` Certain/Probably; seit 2022 unverändert).
 * Massgebend ist diese CSV, nicht die Excel-Dateien daneben: Die beiden
 * `EDB_Mehrfacheinträge_manuell_korrigiert*.xlsx` sind bytegleich und die ältere Kandidatenliste
 * (5'441 Paare); die CSV ist daraus bereinigt (38 Paare weniger – Brüder, die am selben Tag
 * Schwestern heirateten, und Paare Jahre auseinander) und trägt den Sicherheitswert.
 *
 * Kalender: Die CSV datiert wie die Ehedatenbank (bis 1700 alter Stil), das RDF desselben
 * Repos rechnet auf den gregorianischen Kalender um – es wird nicht verwendet. Übernommen
 * werden nur die Katalog-IDs und der Sicherheitswert; Daten, Namen und Kirchgemeinden zeigt
 * die Plattform aus dem Index. Daten, Namen, Kirchgemeinde und Signatur der Liste werden nur
 * gegen den Index geprüft (eine umgerechnete Liste fiele dort auf: checkMehrfach).
 *
 * Auch die bereinigte Liste paart in derselben Kirchgemeinde noch zwei Ehen: zwei Brüder, die
 * am selben Tag zwei Schwestern heiraten («Gleichentags heiratet sein Bruder …»), Vater und
 * Sohn gleichen Namens. Solche Paare widersprechen den Angaben ihrer Einträge und gehen als
 * `verschieden` statt als Ehe in die Liste (distinctReason). Pur, unit-getestet in
 * ehedatenMehrfach.test.ts; Ein- und Ausgabe in ehedatenMehrfachRun.ts.
 */

import { personKey } from "../../../apps/web/src/lib/entityKey.ts";
import { parseCsv } from "./edb.ts";
import type { EhedatenDoc } from "./ehedaten.ts";

export const MEHRFACH_REPO = "stazh/sw-ehedaten";
export const MEHRFACH_PATH = "sourcedata/csv/EDB_Mehrfacheintraege.csv";

export const MEHRFACH_COLUMNS = [
  "Marriage_ID", "Nachname_Mann", "Vorname_Mann", "Herkunft_Mann", "Nachname_Frau", "Vorname_Frau", "Herkunft_Frau",
  "Datum", "Startdatum", "Enddatum", "Kirchgemeinde", "Signatur", "Scope-ID", "Sicherheitswert",
] as const;
export type MehrfachRow = Record<(typeof MEHRFACH_COLUMNS)[number], string>;

/** CSV-Text der Liste → Zeilen; bricht ab, wenn eine erwartete Spalte fehlt. */
export function mehrfachRows(text: string): MehrfachRow[] {
  const [head = [], ...body] = parseCsv(text, ";");
  const index = MEHRFACH_COLUMNS.map((c) => {
    const k = head.indexOf(c);
    if (k < 0) throw new Error(`Mehrfacheinträge: Spalte «${c}» fehlt (Kopf: ${head.join(", ")})`);
    return k;
  });
  return body
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(MEHRFACH_COLUMNS.map((c, k) => [c, (r[index[k]] ?? "").trim()])) as MehrfachRow);
}

/** Was der Abgleich von einem Eintrag des Index braucht. */
export type MehrfachDoc = Pick<
  EhedatenDoc,
  | "id"
  | "kirchgemeinde"
  | "signatur"
  | "isoVon"
  | "isoBis"
  | "mannName"
  | "mannNachname"
  | "mannVorname"
  | "mannZusatz"
  | "frauName"
  | "frauNachname"
  | "frauVorname"
  | "frauZusatz"
>;

/** Warum ein Paar der Liste zwei Ehen sind: andere Vornamen in derselben Kirchgemeinde bzw.
 *  ein Vermerk über eine andere Hochzeit am selben Tag. */
export type VerschiedenGrund = "vornamen" | "vermerk";

const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Gleicher Name: gleicher Personenschlüssel (entityKey.ts), ohne Schlüssel gleiche Schreibung. */
function sameName(a: string, b: string): boolean {
  const ka = personKey(a);
  const kb = personKey(b);
  return ka && kb ? ka === kb : fold(a) === fold(b);
}

/** «Sein Bruder … heiratet am gleichen Tag», «Gleichentags heiratet sein Bruder …»: in einem
 *  Satz eine Hochzeit und derselbe Tag. */
const SAME_DAY = /\b(am gleichen tag|am selben tag|gleichentags|gleichen tags)\b/i;
const WEDDING = /\b(heirate[nt]?|getraut)\b/i;
function sameDayWedding(zusatz: string): boolean {
  return zusatz.split(/[.;]/).some((s) => SAME_DAY.test(s) && WEDDING.test(s));
}

/**
 * Zwei Einträge, die die Liste als eine Ehe führt, nach ihren eigenen Angaben aber zwei sind.
 * Geprüft nur in derselben Kirchgemeinde: Dort steht eine Ehe ein zweites Mal nur als
 * Doppeleintrag mit denselben Namen, andere Vornamen sind ein zweites Paar (Brüder heiraten am
 * selben Tag Schwestern). Bei gleichen Namen widerspricht ein Vermerk über eine weitere Hochzeit
 * am selben Tag (Vater und Sohn «Hans Kunz», beide mit einer Margaretha Meier). Über zwei
 * Kirchgemeinden hinweg zählt beides nicht: Vornamen schwanken zwischen den Kirchenbüchern
 * («Heinrich» – «Kleinheinrich»), und der Vermerk über den Bruder steht in beiden Büchern.
 * null = kein Widerspruch.
 */
export function distinctReason(a: MehrfachDoc, b: MehrfachDoc): VerschiedenGrund | null {
  if (a.kirchgemeinde !== b.kirchgemeinde) return null;
  if (!sameName(a.mannName, b.mannName) || !sameName(a.frauName, b.frauName)) return "vornamen";
  if ([a, b].some((d) => sameDayWedding(`${d.mannZusatz}; ${d.frauZusatz}`))) return "vermerk";
  return null;
}

/** Datum der Liste («1585.11.28» bzw. Start- und Enddatum) als ISO-Spanne. */
function listDates(r: MehrfachRow): { von: string; bis: string } | null {
  const iso = (s: string) => (/^\d{4}\.\d{2}\.\d{2}$/.test(s) ? s.replace(/\./g, "-") : null);
  const d = iso(r.Datum);
  if (d) return { von: d, bis: d };
  const von = iso(r.Startdatum);
  const bis = iso(r.Enddatum);
  return von && bis ? { von, bis } : null;
}

export interface MehrfachBuild {
  /** Geprüfte Ehen: Ehe-ID der Liste → Katalog-IDs (aufsteigend). */
  ehen: Map<string, number[]>;
  /** Ehen mit Sicherheitswert «Probably». */
  wahrscheinlich: Set<string>;
  /** Paare der Liste, die nach ihren Einträgen zwei Ehen sind. */
  verschieden: Map<string, { ids: number[]; grund: VerschiedenGrund }>;
  /** Zeilen der Liste. */
  rows: number;
  /** Ehen in der Liste. */
  listed: number;
  /** Was fehlt oder nicht passt (Bericht). */
  problems: {
    /** Katalog-ID nicht im Index. */
    ohneEintrag: string[];
    /** Ehe mit weniger als zwei Einträgen im Index. */
    unvollstaendig: string[];
    /** Katalog-ID in mehreren Ehen. */
    doppelt: string[];
    /** Unbekannter Sicherheitswert (gilt als «Probably»). */
    sicherheit: string[];
  };
  /** Angaben der Liste, die vom Index abweichen (nur Bericht; massgebend ist der Index). */
  abweichungen: { datum: string[]; namen: string[]; kirchgemeinde: string[]; signatur: string[] };
  /** Einträge mit lesbarem Datum in Liste und Index (Nenner der Datums-Prüfung). */
  datiert: number;
}

/**
 * Die Liste gegen den Index: Ehen gruppieren, Einträge nachschlagen, Widersprüche aussortieren,
 * Abweichungen zählen. Eine Katalog-ID, die in mehreren Ehen steht, fällt überall weg; eine Ehe
 * mit weniger als zwei Einträgen im Index ebenso.
 */
export function buildMehrfach(rows: readonly MehrfachRow[], docs: ReadonlyMap<number, MehrfachDoc>): MehrfachBuild {
  const out: MehrfachBuild = {
    ehen: new Map(),
    wahrscheinlich: new Set(),
    verschieden: new Map(),
    rows: rows.length,
    listed: 0,
    problems: { ohneEintrag: [], unvollstaendig: [], doppelt: [], sicherheit: [] },
    abweichungen: { datum: [], namen: [], kirchgemeinde: [], signatur: [] },
    datiert: 0,
  };
  const uses = new Map<number, Set<string>>();
  const groups = new Map<string, MehrfachRow[]>();
  for (const r of rows) {
    const ehe = r.Marriage_ID;
    const id = Number(r["Scope-ID"]);
    if (!ehe || !Number.isInteger(id) || id <= 0) {
      out.problems.unvollstaendig.push(`Zeile ohne Ehe-ID oder Katalog-ID: ${ehe || "?"} / ${r["Scope-ID"] || "?"}`);
      continue;
    }
    groups.set(ehe, [...(groups.get(ehe) ?? []), r]);
    uses.set(id, (uses.get(id) ?? new Set()).add(ehe));
  }
  out.listed = groups.size;
  for (const [id, ehen] of uses) if (ehen.size > 1) out.problems.doppelt.push(`${id} in den Ehen ${[...ehen].join(", ")}`);

  for (const [ehe, members] of groups) {
    const found: MehrfachDoc[] = [];
    for (const r of members) {
      const id = Number(r["Scope-ID"]);
      if ((uses.get(id)?.size ?? 0) > 1) continue;
      const doc = docs.get(id);
      if (!doc) {
        out.problems.ohneEintrag.push(`${id} (Ehe ${ehe}, ${r.Signatur})`);
        continue;
      }
      if (found.some((d) => d.id === id)) continue;
      found.push(doc);
      checkRow(r, doc, out);
    }
    if (found.length < 2) {
      out.problems.unvollstaendig.push(`Ehe ${ehe}: ${found.length} von ${members.length} Einträgen im Index`);
      continue;
    }
    const sicherheit = members[0].Sicherheitswert;
    if (sicherheit !== "Certain" && sicherheit !== "Probably") out.problems.sicherheit.push(`Ehe ${ehe}: «${sicherheit}»`);
    const ids = found.map((d) => d.id).sort((a, b) => a - b);
    // Zwei Ehen statt einer, sobald ein Paar von Einträgen sich widerspricht.
    let grund: VerschiedenGrund | null = null;
    for (let i = 0; i < found.length && !grund; i++) for (let j = i + 1; j < found.length && !grund; j++) grund = distinctReason(found[i], found[j]);
    if (grund) {
      out.verschieden.set(ehe, { ids, grund });
      continue;
    }
    out.ehen.set(ehe, ids);
    if (members.some((m) => m.Sicherheitswert !== "Certain")) out.wahrscheinlich.add(ehe);
  }
  return out;
}

/** Eine Zeile der Liste gegen ihren Eintrag im Index (Abweichungen nur zählen). */
function checkRow(r: MehrfachRow, d: MehrfachDoc, out: MehrfachBuild): void {
  const id = r["Scope-ID"];
  const dates = listDates(r);
  if (dates) {
    out.datiert++;
    if (dates.von !== d.isoVon || dates.bis !== d.isoBis) {
      out.abweichungen.datum.push(`${id}: Liste ${dates.von === dates.bis ? dates.von : `${dates.von}…${dates.bis}`}, Index ${d.isoVon === d.isoBis ? d.isoVon : `${d.isoVon}…${d.isoBis}`}`);
    }
  }
  const names: Array<[string, string]> = [
    [r.Nachname_Mann, d.mannNachname],
    [r.Vorname_Mann, d.mannVorname],
    [r.Nachname_Frau, d.frauNachname],
    [r.Vorname_Frau, d.frauVorname],
  ];
  const diff = names.filter(([a, b]) => fold(a) !== fold(b));
  if (diff.length > 0) out.abweichungen.namen.push(`${id}: ${diff.map(([a, b]) => `«${a}» ↔ «${b}»`).join(", ")}`);
  if (fold(r.Kirchgemeinde) !== fold(d.kirchgemeinde)) out.abweichungen.kirchgemeinde.push(`${id}: «${r.Kirchgemeinde}» ↔ «${d.kirchgemeinde}»`);
  if (fold(r.Signatur) !== fold(d.signatur)) out.abweichungen.signatur.push(`${id}: «${r.Signatur}» ↔ «${d.signatur}»`);
}

/** Höchstens so viele Datumsabweichungen gelten als Korrekturen der Ehedatenbank; mehr deuten
 *  auf eine umgerechnete (gregorianische) oder fremde Liste – der Aufbau bricht ab. */
export const MAX_DATE_DEVIATION = 0.01;

/** Fehler, die den Aufbau abbrechen (leere Liste, viele Lücken, verschobene Daten); [] = gut. */
export function checkMehrfach(b: MehrfachBuild): string[] {
  const errors: string[] = [];
  if (b.ehen.size === 0) errors.push("keine Ehe übrig");
  if (b.problems.ohneEintrag.length > b.rows * 0.01) {
    errors.push(`${b.problems.ohneEintrag.length} von ${b.rows} Katalog-IDs fehlen im Index (anderer Stand der Ehedatenbank?)`);
  }
  if (b.datiert > 0 && b.abweichungen.datum.length > b.datiert * MAX_DATE_DEVIATION) {
    errors.push(
      `${b.abweichungen.datum.length} von ${b.datiert} Daten weichen vom Index ab – gregorianisch umgerechnet (RDF) statt wie die Ehedatenbank datiert?`,
    );
  }
  return errors;
}

export interface MehrfachMeta {
  built: string;
  hash: string;
  source: { repo: string; path: string; commit: string; date: string; rows: number; marriages: number };
  /** Stand der Ehedatenbank, gegen den geprüft wurde. */
  edb: string;
  counts: { marriages: number; entries: number; probable: number; distinct: number };
}

/** Form der committeten Liste (apps/web/src/lib/ehedatenMehrfach.ts liest sie). */
export interface MehrfachFile {
  meta: MehrfachMeta;
  /** Geprüfte Ehen: Ehe-ID der Liste → Katalog-IDs. */
  ehen: Record<string, number[]>;
  /** Ehe-IDs mit Sicherheitswert «Probably»: laut Liste wahrscheinlich dieselbe Ehe. */
  wahrscheinlich: string[];
  /** Paare der Liste, die nach den Angaben ihrer Einträge zwei Ehen sind. */
  verschieden: Record<string, { ids: number[]; grund: VerschiedenGrund }>;
}

const byNumber = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);

/** Inhalt der Liste (ohne meta), stabil sortiert – Grundlage von Hash und Datei. */
export function mehrfachData(b: MehrfachBuild): Omit<MehrfachFile, "meta"> {
  const ehen = Object.fromEntries([...b.ehen.entries()].sort((x, y) => byNumber(x[0], y[0])));
  const verschieden = Object.fromEntries([...b.verschieden.entries()].sort((x, y) => byNumber(x[0], y[0])));
  return { ehen, wahrscheinlich: [...b.wahrscheinlich].sort(byNumber), verschieden };
}

/** Eine Ehe je Zeile (lesbare Diffs). */
export function serializeMehrfach(file: MehrfachFile): string {
  const block = (obj: Record<string, unknown>) => {
    const lines = Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return lines.length ? `{\n${lines.join(",\n")}\n  }` : "{}";
  };
  return [
    "{",
    `  "meta": ${JSON.stringify(file.meta)},`,
    `  "ehen": ${block(file.ehen)},`,
    `  "wahrscheinlich": ${JSON.stringify(file.wahrscheinlich)},`,
    `  "verschieden": ${block(file.verschieden)}`,
    "}",
    "",
  ].join("\n");
}
