/**
 * KRDB-Felder der Kantonsratsprotokolle: `krdbIds` (alle Rats- und
 * Regierungsmitglieder, die dem Dokument zugeordnet sind) und `krdbTitleIds`
 * (davon im Titel genannt). Grundlage der Personenseiten (/personen/<ID>) in der
 * Web-App.
 *
 * Gerechnet wird mit demselben Abgleich wie auf der Detailseite
 * (krdb/krdbMatch.ts, `matchKrdbDocument`): die erkannten Personen (`persons`),
 * Amtszeit am Dokumentdatum, Eindeutigkeit; der Text liefert nur Indizien (Ort,
 * Partei, Amt). Matcher und Register
 * liegen als Kopie in src/krdb/ – der Indexer läuft auf dem Server aus
 * `services/indexer/` allein (index-rebuild.yml und late-sync synchronisieren nur
 * dieses Verzeichnis), ein Import aus apps/web bräche dort. Die Kopie hält
 * `npm run sync-krdb` aktuell, krdbVendor.test.ts schlägt bei Abweichung an.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildKrdbIndex,
  krdbIndexFields,
  type KrdbIndex,
  type KrdbIndexFields,
  type KrdbRegister,
} from "./krdb/krdbMatch.ts";
import type { SeriesAbbr } from "./types.ts";

const REGISTER_URL = new URL("./krdb/krdb-register.json", import.meta.url);

export interface KrdbMatcher {
  index: KrdbIndex;
  persons: number;
  generatedAt: string;
}

let matcher: KrdbMatcher | undefined;

/** Register laden (einmal je Prozess); wirft mit Hinweis, wenn die Datei fehlt. */
export function loadKrdbMatcher(): KrdbMatcher {
  if (matcher) return matcher;
  let register: KrdbRegister;
  try {
    register = JSON.parse(readFileSync(REGISTER_URL, "utf-8")) as KrdbRegister;
  } catch (err) {
    throw new Error(
      `KRDB-Register nicht lesbar (${fileURLToPath(REGISTER_URL)}): ${(err as Error).message} – ` +
        "Kopie per `npm run sync-krdb` (im Repo) bzw. rsync von services/indexer/ erneuern",
    );
  }
  matcher = {
    index: buildKrdbIndex(register),
    persons: register.persons.length,
    generatedAt: register.meta.generatedAt,
  };
  return matcher;
}

/**
 * Register vorab laden und melden – wer KRP-Dokumente schreibt, bricht lieber
 * VOR dem ersten Schreiben ab als nach Stunden: `--all` ersetzt Dokumente
 * komplett, ohne Register fehlten die Felder danach still an allen KRP-Docs.
 */
export function requireKrdb(tag: string): KrdbMatcher {
  try {
    const m = loadKrdbMatcher();
    console.log(`[${tag}] KRDB-Register: ${m.persons} Personen (Stand ${m.generatedAt.slice(0, 10)})`);
    return m;
  } catch (err) {
    console.error(`[${tag}] ${(err as Error).message}`);
    process.exit(2);
  }
}

export interface KrdbDocLike {
  series: SeriesAbbr;
  date: string | null;
  title: string;
  body: string;
  persons: string[];
}

/** Felder für ein Dokument; null für Serien ohne Personen-Abgleich (nur KRP). */
export function krdbFieldsFor(doc: KrdbDocLike): KrdbIndexFields | null {
  if (doc.series !== "KRP") return null;
  return krdbIndexFields(loadKrdbMatcher().index, {
    persons: doc.persons,
    date: doc.date,
    title: doc.title,
    body: doc.body,
  });
}

/** Gleiche ID-Menge? Fehlendes Feld und leere Liste gelten als gleich. */
export function sameIds(stored: readonly number[] | null | undefined, next: readonly number[]): boolean {
  const a = stored ?? [];
  return a.length === next.length && a.every((id, i) => id === next[i]);
}
