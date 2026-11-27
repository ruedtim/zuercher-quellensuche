// Normdaten der Ratsmanuale. In Transkribus ausgezeichnete Personen (resp="#stazh", meist der Vorsitz
// im Sitzungskopf) tragen `persName/@ref` mit GND, HLS-Artikel und Personen-ID der Rechtsquellen
// (rmtk: «https://d-nb.info/gnd/<Nummer> https://hls-dhs-dss.ch/de/articles/<ID>/
// https://personae.ssrq-sds-fds.ch/?query=<per…>»). Sie gehen als `data-gnd`, `data-hls` und
// `data-ssrq` ins HTML (Personenkarte der Detailseite, apps/web) und geben der Person in der Facette
// `persons` den Namen aus dem Register des Kleinen Rats: Im Text steht meist der Nachname allein
// («Prnt. Herr Holtzhalb»), den rmNames.ts verwirft.
//
// Register: Kopie von apps/web/src/lib/server/data/rat-register.json unter src/rat/ (der Indexer
// läuft auf dem Server aus services/indexer allein); `npm run sync-rat`, Prüfung ratVendor.test.ts.

import { readFileSync } from "node:fs";
import { loadRmNames, rmPersonName, type RmNamesIndex } from "./rmNames.ts";

// Personen-GND: Ziffern, letzte Stelle auch X, ältere Nummern mit Bindestrich («118540238», «105381173X»).
const GND_RE = /d-nb\.info\/gnd\/([0-9][0-9X-]{5,11})(?=$|[\s/"])/;
// HLS-Artikel, sechsstellig, wie rmtk ihn schreibt.
const HLS_RE = /hls-dhs-dss\.ch\/de\/articles\/([0-9]{6})\//;
// Personen-ID der Sammlung Schweizerischer Rechtsquellen, selten mit Buchstaben («per026517a»).
const SSRQ_RE = /personae\.ssrq-sds-fds\.ch\/\?query=(per[0-9]{6}[a-z]?)(?=$|\s)/;

/** GND-Nummer aus `@ref` (mehrere URLs durch Leerzeichen getrennt, die erste GND gilt); null ohne
 *  lesbare Nummer. */
export function gndOfRef(ref: string | null | undefined): string | null {
  const m = ref ? GND_RE.exec(ref) : null;
  return m ? m[1] : null;
}

/** Normdaten einer Person aus `@ref`; was fehlt, ist null. */
export interface PersonRefs {
  gnd: string | null;
  /** HLS-Artikel («018060»). */
  hls: string | null;
  /** Personen-ID der Rechtsquellen («per002157»). */
  ssrq: string | null;
}

export function personRefsOf(ref: string | null | undefined): PersonRefs {
  return {
    gnd: gndOfRef(ref),
    hls: (ref && HLS_RE.exec(ref)?.[1]) || null,
    ssrq: (ref && SSRQ_RE.exec(ref)?.[1]) || null,
  };
}

export interface RatPersonNames {
  first?: string;
  last?: string;
  gnd?: string;
  ssrq?: string;
}

/**
 * Name der Person für die Facette, vereinheitlicht wie alle RM-Namen (rmPersonName), damit dieselbe
 * Person mit und ohne GND denselben Wert trägt («Hans Caspar Escher vom Glas» → «Hans Kaspar
 * Escher»). Das Register nennt teils Varianten des Vornamens («Leonhard, Lienhart») – dann zählt der
 * erste – und stellt Partikel nach («Orelli, von»). Kann rmPersonName den Namen nicht lesen, bleibt er
 * wie im Register.
 */
export function ratFacetName(p: RatPersonNames, idx: RmNamesIndex): string | null {
  const first = (p.first ?? "").split(",")[0].replace(/\s+/g, " ").trim();
  const last = (p.last ?? "")
    .replace(/^(.+?),\s*(von der|von|vom|zum|zur|de|im|am)$/i, "$2 $1")
    .replace(/\s+/g, " ")
    .trim();
  if (!last) return null;
  const full = first ? `${first} ${last}` : last;
  return rmPersonName(full, idx) ?? full;
}

/** GND bzw. SSRQ-Personen-ID → Facettenname für alle Personen des Registers, die eine davon haben.
 *  Beide Schlüssel in einer Map: GND-Nummern beginnen mit einer Ziffer, SSRQ-IDs mit «per». */
export function ratRefNames(persons: readonly RatPersonNames[], idx: RmNamesIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of persons) {
    const keys = [p.gnd, p.ssrq].filter((k): k is string => !!k && !out.has(k));
    if (keys.length === 0) continue;
    const name = ratFacetName(p, idx);
    if (name) for (const k of keys) out.set(k, name);
  }
  return out;
}

let cached: Map<string, string> | undefined;

/** Aus der Kopie des Registers; fehlt sie oder ist sie kaputt, gibt es keine Namen aus den Normdaten. */
export function loadRatRefNames(): Map<string, string> {
  if (cached) return cached;
  try {
    const raw = readFileSync(new URL("./rat/rat-register.json", import.meta.url), "utf-8");
    const register = JSON.parse(raw) as { persons?: RatPersonNames[] };
    cached = ratRefNames(Array.isArray(register.persons) ? register.persons : [], loadRmNames());
  } catch (err) {
    console.warn("[rmGnd] Register des Kleinen Rats nicht lesbar – keine Namen aus GND und SSRQ:", err);
    cached = new Map();
  }
  return cached;
}
