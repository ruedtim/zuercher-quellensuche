/**
 * Frühere IDs einer Person festhalten.
 *
 * Die KRDB vergibt die Personen-ID (`ID_PERSON_NEW`) neu, wenn sich ein
 * Datensatz ändert – Todesdatum, neue Einsitze, Korrekturen (2023 → 2026: 552
 * Personen, 81 % der Amtierenden; siehe stale.ts). Die Personenseiten der
 * Web-App (/personen/<ID>) und die Dokumentzuordnung im Suchindex (`krdbIds`)
 * hängen an dieser ID. Beim Register-Refresh wird darum jede Person, deren ID
 * verschwindet, der neuen ID derselben Person zugeordnet und ihre alte ID als
 * `aliases` vermerkt: alte URLs leiten um, und Dokumente, die der Index noch
 * unter der alten ID führt, bleiben bis zum nächsten `--patch-krdb` auffindbar.
 *
 * Zuordnung nur eindeutig: gleicher Name, mindestens ein gemeinsamer Einsitz
 * (Rat + Eintrittsdatum), verträgliches Geburtsjahr, genau ein Kandidat, und der
 * Kandidat ist nicht schon von einer anderen alten ID beansprucht. Pur (kein
 * Netz), unit-getestet in aliases.test.ts.
 */

import { foldName, type KrdbPerson } from "../../../apps/web/src/lib/server/krdbMatch.ts";

export interface AliasResolved {
  oldId: number;
  newId: number;
  name: string;
}

export interface AliasUnresolved {
  id: number;
  name: string;
  reason: string;
}

export interface AliasResult {
  /** Personen, die mit unveränderter ID aus dem alten Register übernommene Aliasse behalten. */
  carried: number;
  resolved: AliasResolved[];
  unresolved: AliasUnresolved[];
}

const nameKey = (p: Pick<KrdbPerson, "last" | "first">): string => `${foldName(p.last)}|${foldName(p.first)}`;
const seatKeys = (p: KrdbPerson): Set<string> => new Set(p.seats.map(([council, from]) => `${council}|${from}`));
const displayName = (p: KrdbPerson): string => `${p.first.trim()} ${p.last.trim()}`.trim();

/** Aliasse ins neue Register eintragen (mutiert `next`) und berichten, was passiert ist. */
export function carryAliases(previous: readonly KrdbPerson[], next: KrdbPerson[]): AliasResult {
  const nextById = new Map(next.map((p) => [p.id, p]));
  const prevIds = new Set(previous.map((p) => p.id));
  const result: AliasResult = { carried: 0, resolved: [], unresolved: [] };

  // Unveränderte IDs: bisherige Aliasse behalten.
  for (const old of previous) {
    const now = nextById.get(old.id);
    if (now && old.aliases?.length) {
      now.aliases = [...new Set([...(now.aliases ?? []), ...old.aliases])].sort((a, b) => a - b);
      result.carried++;
    }
  }

  // Verschwundene alte IDs den neu aufgetauchten zuordnen.
  const fresh = next.filter((p) => !prevIds.has(p.id));
  const gone = previous.filter((p) => !nextById.has(p.id));
  const claims = new Map<number, number[]>(); // neue ID → alte IDs, die sie beanspruchen
  const pick = new Map<number, KrdbPerson | null>(); // alte ID → eindeutiger Kandidat
  for (const old of gone) {
    const seats = seatKeys(old);
    const candidates = fresh.filter(
      (n) =>
        nameKey(n) === nameKey(old) &&
        (old.born == null || n.born == null || old.born === n.born) &&
        [...seatKeys(n)].some((k) => seats.has(k)),
    );
    pick.set(old.id, candidates.length === 1 ? candidates[0] : null);
    if (candidates.length === 1) claims.set(candidates[0].id, [...(claims.get(candidates[0].id) ?? []), old.id]);
    else
      result.unresolved.push({
        id: old.id,
        name: displayName(old),
        reason: candidates.length === 0 ? "keine neue ID mit gleichem Namen und Einsitz" : `mehrdeutig (${candidates.map((c) => c.id).join(", ")})`,
      });
  }
  for (const old of gone) {
    const target = pick.get(old.id);
    if (!target) continue;
    if ((claims.get(target.id) ?? []).length > 1) {
      result.unresolved.push({ id: old.id, name: displayName(old), reason: `neue ID ${target.id} von mehreren alten IDs beansprucht` });
      continue;
    }
    target.aliases = [...new Set([...(target.aliases ?? []), old.id, ...(old.aliases ?? [])])].sort((a, b) => a - b);
    result.resolved.push({ oldId: old.id, newId: target.id, name: displayName(target) });
  }
  result.resolved.sort((a, b) => a.newId - b.newId);
  result.unresolved.sort((a, b) => a.id - b.id);
  return result;
}
