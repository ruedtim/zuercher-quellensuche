/**
 * Z-1114-Personendossiers den Personen der Live-KRDB zuordnen.
 *
 * Erste Wahl ist der Weblink des Dossiers auf die Kantonsratsdatenbank
 * (…/KRRRPublic/app?id=<ID>), den das Staatsarchiv bei der Erschliessung
 * gesetzt hat. Weil die KRDB IDs bei Änderungen neu vergibt (siehe stale.ts),
 * zeigt er teils ins Leere – dann entscheiden Name und Geburtsjahr aus dem
 * Dossiertitel plus ein Einsitz im passenden Rat, bei mehreren Kandidaten die
 * Amtszeit aus dem Titel, und nur bei genau einem Treffer. Auch ein gültiger
 * Link muss zum Namen passen und zu Geburtsjahr oder Amtszeit. Pur,
 * unit-getestet in z1114.test.ts.
 */

import { nameMatches } from "./stale.ts";
import { parseDossierName, parseDossierTerms, type DossierTerm } from "./dossierTitle.ts";

export interface MatchDossier {
  ve: number;
  signature: string;
  title: string;
  council: "Kantonsrat" | "Regierungsrat";
  krdbIds: number[];
}

export interface MatchPerson {
  id: number;
  first: string;
  last: string;
  born?: number;
  /** Einsitze: [Rat, von, bis|null, …]. */
  seats: ReadonlyArray<readonly [string, string, string | null, ...unknown[]]>;
}

export type Z1114Via = "link" | "name";

export interface Z1114Assignment<D extends MatchDossier> {
  personId: number;
  dossier: D;
  via: Z1114Via;
  /** Abweichung, die der Report meldet (Geburtsjahr Katalog ≠ KRDB). */
  note?: string;
}

export interface Z1114Unassigned<D extends MatchDossier> {
  dossier: D;
  reason: string;
}

/** Bestand Z 1114 dokumentiert Amtsträger:innen ab den 1960er-Jahren. */
const ERA_FROM = 1960;

const yearOf = (d: string | null): number | null => (d ? Number(d.slice(0, 4)) : null);

/** Ein Einsitz überschneidet eine Amtszeit aus dem Dossiertitel (± 1 Jahr). */
function termsOverlap(p: MatchPerson, terms: DossierTerm[]): boolean {
  return terms.some((t) =>
    p.seats.some(([c, from, to]) => {
      if (c !== t.council) return false;
      const sFrom = yearOf(from) ?? 0;
      const sTo = yearOf(to) ?? 9999;
      return sFrom <= (t.to ?? 9999) + 1 && (t.from - 1) <= sTo;
    }),
  );
}

function seatInEra(p: MatchPerson, council: string): boolean {
  return p.seats.some(([c, from, to]) => c === council && (to === null || Number(to.slice(0, 4)) >= ERA_FROM) && Number(from.slice(0, 4)) <= 2010);
}

export function assignZ1114<D extends MatchDossier>(
  dossiers: D[],
  persons: MatchPerson[],
): { assigned: Array<Z1114Assignment<D>>; unassigned: Array<Z1114Unassigned<D>> } {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const hits: Array<Z1114Assignment<D>> = [];
  const unassigned: Array<Z1114Unassigned<D>> = [];

  for (const dossier of dossiers) {
    const name = parseDossierName(dossier.title);
    if (!name) {
      unassigned.push({ dossier, reason: "Dossiertitel ohne «Nachname, Vorname (…)»" });
      continue;
    }
    const full = `${name.first} ${name.last}`;
    const terms = parseDossierTerms(dossier.title);
    const bornOk = (p: MatchPerson) => !name.born || !p.born || p.born === name.born;

    // 1. Weblink auf eine Person der Live-KRDB, deren Name passt – und
    //    Geburtsjahr oder Amtszeit (Tippfehler im Geburtsjahr kommen vor).
    const linked = dossier.krdbIds.map((id) => byId.get(id)).filter((p): p is MatchPerson => !!p);
    const linkOk = linked.filter((p) => nameMatches(p, full) && (bornOk(p) || termsOverlap(p, terms)));
    if (linkOk.length === 1) {
      const p = linkOk[0];
      const note = bornOk(p) ? undefined : `Geburtsjahr Katalog ${name.born} ≠ KRDB ${p.born}`;
      hits.push({ personId: p.id, dossier, via: "link", ...(note ? { note } : {}) });
      continue;
    }

    // 2. Name + Geburtsjahr + Einsitz im Rat des Dossiers; bei mehreren
    //    Kandidaten (oder ohne Geburtsjahr) entscheidet die Amtszeit im Titel.
    let candidates = persons.filter(
      (p) => nameMatches(p, full) && seatInEra(p, dossier.council) && (name.born ? p.born === name.born : true),
    );
    if ((candidates.length > 1 || !name.born) && terms.length > 0) candidates = candidates.filter((p) => termsOverlap(p, terms));
    if (candidates.length === 1) {
      hits.push({ personId: candidates[0].id, dossier, via: "name" });
      continue;
    }
    const linkNote =
      dossier.krdbIds.length === 0
        ? "ohne KRDB-Link"
        : linked.length === 0
          ? `KRDB-Link ${dossier.krdbIds.join(", ")} veraltet`
          : `KRDB-Link ${dossier.krdbIds.join(", ")} passt nicht zum Namen`;
    unassigned.push({
      dossier,
      reason:
        candidates.length === 0
          ? `${linkNote}, keine Person mit passendem Namen${name.born ? ` und Geburtsjahr ${name.born}` : ""}`
          : `${linkNote}, mehrdeutig (KRDB ${candidates.map((c) => c.id).join(", ")})`,
    });
  }

  // Mehrere Dossiers für dieselbe Person (etwa Kantons- und Regierungsrat):
  // eines genügt – Weblink vor Name, sonst das erste im Katalog.
  const perPerson = new Map<number, Array<Z1114Assignment<D>>>();
  for (const h of hits) perPerson.set(h.personId, [...(perPerson.get(h.personId) ?? []), h]);
  const assigned: Array<Z1114Assignment<D>> = [];
  for (const group of perPerson.values()) {
    const [winner, ...rest] = [...group].sort((a, b) => Number(a.via !== "link") - Number(b.via !== "link") || a.dossier.ve - b.dossier.ve);
    assigned.push(winner);
    for (const h of rest) {
      unassigned.push({ dossier: h.dossier, reason: `weiteres Dossier für KRDB ${h.personId} (genutzt: ${winner.dossier.signature})` });
    }
  }
  assigned.sort((a, b) => a.personId - b.personId);
  unassigned.sort((a, b) => a.dossier.ve - b.dossier.ve);
  return { assigned, unassigned };
}
