/**
 * Kuratierte Commons-Porträts (data/portrait-overrides.json): Personen, deren
 * Wikidata-Item kein P18 hat oder die gar nicht mit Wikidata verknüpft sind,
 * für die es auf Commons aber ein geprüftes Porträt gibt (gefunden über
 * Commons-Kategorien, Artikelbilder, Wikidata-Items ohne P13468 oder Bildlegenden
 * des ETH-Bildarchivs, je von Hand geprüft).
 *
 * Reihenfolge im Register: P18 > kuratiert > Z 1114. Die KRDB vergibt IDs neu,
 * wenn sich ein Datensatz ändert – ein Eintrag greift darum auch über eine
 * Alias-ID; der Nachname schützt vor einer Zuordnung zur falschen Person.
 * Pure bis auf readOverrides → unit-getestet (overrides.test.ts).
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_OVERRIDES = fileURLToPath(new URL("../data/portrait-overrides.json", import.meta.url));

export interface PortraitOverride {
  /** KRDB-Personen-ID zum Zeitpunkt der Prüfung. */
  id: number;
  /** Name laut KRDB (Kontrolle gegen neu vergebene IDs). */
  name: string;
  /** Commons-Dateiname ohne «File:». */
  file: string;
  /** Warum das Bild diese Person zeigt. */
  basis: string;
}

export interface OverridePerson {
  id: number;
  last: string;
  aliases?: number[];
  /** Porträt über P18 vorhanden (hat Vorrang). */
  hasP18: boolean;
  /** Bisher Z-1114-Porträt (wird ersetzt). */
  hasZ1114: boolean;
}

export interface OverridePlan {
  apply: Array<{ personId: number; override: PortraitOverride; via: "id" | "alias"; replacesZ1114: boolean }>;
  /** P18 liefert schon ein Porträt – Eintrag überflüssig. */
  shadowed: Array<{ personId: number; override: PortraitOverride }>;
  /** Weder aktuelle noch alte ID im Register. */
  unknown: PortraitOverride[];
  /** ID gefunden, Nachname passt nicht zum Eintrag. */
  nameMismatch: Array<{ personId: number; last: string; override: PortraitOverride }>;
  /** Commons-Datei fehlt oder ihr Vorschaubild ist nicht abrufbar. */
  noInfo: Array<{ personId: number; override: PortraitOverride }>;
  /** Weiterer Eintrag für dieselbe Person (der erste gilt). */
  duplicate: PortraitOverride[];
}

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

export function planOverrides(
  persons: readonly OverridePerson[],
  overrides: readonly PortraitOverride[],
  hasInfo: (file: string) => boolean,
): OverridePlan {
  const plan: OverridePlan = { apply: [], shadowed: [], unknown: [], nameMismatch: [], noInfo: [], duplicate: [] };
  const byId = new Map(persons.map((p) => [p.id, p]));
  const byAlias = new Map<number, OverridePerson>();
  for (const p of persons) for (const a of p.aliases ?? []) byAlias.set(a, p);
  const taken = new Set<number>();
  for (const o of overrides) {
    const direct = byId.get(o.id);
    const person = direct ?? byAlias.get(o.id);
    if (!person) {
      plan.unknown.push(o);
      continue;
    }
    if (taken.has(person.id)) {
      plan.duplicate.push(o);
      continue;
    }
    taken.add(person.id);
    if (!` ${norm(o.name)} `.includes(` ${norm(person.last)} `)) {
      plan.nameMismatch.push({ personId: person.id, last: person.last, override: o });
    } else if (person.hasP18) {
      plan.shadowed.push({ personId: person.id, override: o });
    } else if (!hasInfo(o.file)) {
      plan.noInfo.push({ personId: person.id, override: o });
    } else {
      plan.apply.push({ personId: person.id, override: o, via: direct ? "id" : "alias", replacesZ1114: person.hasZ1114 });
    }
  }
  return plan;
}

/** Liest und prüft die Liste; fehlt die Datei, gibt es keine kuratierten Porträts. */
export async function readOverrides(path: string): Promise<PortraitOverride[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    console.warn(`[krdb] Keine kuratierten Porträts (${path} fehlt).`);
    return [];
  }
  const data = JSON.parse(raw) as { entries?: unknown };
  if (!Array.isArray(data.entries)) throw new Error(`${path}: «entries» fehlt`);
  return data.entries.map((e, i) => {
    const o = e as Partial<PortraitOverride>;
    const file = typeof o.file === "string" ? o.file.replace(/^File:/i, "").replace(/_/g, " ").trim() : "";
    if (!Number.isInteger(o.id) || (o.id as number) <= 0 || !o.name?.trim() || !file || !o.basis?.trim()) {
      throw new Error(`${path}: Eintrag ${i + 1} unvollständig (id, name, file, basis)`);
    }
    return { id: o.id as number, name: o.name.trim(), file, basis: o.basis.trim() };
  });
}
