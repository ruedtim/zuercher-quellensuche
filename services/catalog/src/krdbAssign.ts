/**
 * Katalogeinheiten den Personen der Kantonsratsdatenbank (KRDB) zuordnen –
 * Grundlage des Abschnitts «Im Archivkatalog» der Personenseiten.
 *
 * Gesichert (`strict`, Entscheid Tim 2026-10-28):
 * - **link**: Der Katalog verlinkt die Person selbst (…/KRRRPublic/app?id=…,
 *   alte IDs über die Aliase des Registers), und ein Name im Titel passt –
 *   wie bei Z 1114 (services/krdb/src/z1114Match.ts).
 * - **name**: Name, Geburtsjahr UND eine Amtszeit im Titel («Kantonsrat
 *   1975-1978») passen auf genau eine Person.
 *
 * Vorschlag (`names`, auf der Personenseite getrennt und «nicht geprüft»):
 * gleicher Nachname und verträgliche Vornamen (die kürzere Folge ist Anfang der
 * längeren: «Hans» ~ «Hans Jakob», aber «Hans Heinrich» ≠ «Hans Jakob»), die
 * Einheit fällt in die Lebenszeit, kein abweichendes Geburts- oder Todesjahr im
 * Titel, nur genau eine KRDB-Person kommt in Frage – und dazu entweder dasselbe
 * Geburtsjahr oder ein seltener Name (höchstens MAX_NAME_COUNT Einheiten im
 * Katalog). Ohne diese Bremse häuften sich Namensvettern aus der Ehedatenbank
 * (Stichprobe 2026-10: bis zu 102 Vorschläge für eine Person). Geburtsjahre
 * lebender Personen stammen aus dem KRDB-Rohexport und werden nur hier
 * verglichen, nie ausgegeben. Pur, unit-getestet in krdbAssign.test.ts.
 */

import { nameWords } from "../../../apps/web/src/lib/entityKey.ts";
import { nameMatches } from "../../krdb/src/stale.ts";
import { parseDossierTerms, type DossierTerm } from "../../krdb/src/dossierTitle.ts";
import type { TitlePerson } from "./titleSchema.ts";

export interface KrdbCandidate {
  id: number;
  first: string;
  last: string;
  born?: number;
  died?: number;
  /** Einsitze: [Rat, von, bis|null, …] mit Daten «YYYY[-MM[-DD]]». */
  seats: ReadonlyArray<readonly [string, string, string | null, ...unknown[]]>;
}

export interface KrdbIndex {
  byId: Map<number, KrdbCandidate>;
  /** Gefalteter Nachname → Personen. */
  bySurname: Map<string, KrdbCandidate[]>;
  /** Alte KRDB-ID → aktuelle (Aliase des Registers). */
  aliases: Map<number, number>;
}

export interface KrdbAssignment {
  strict: Array<{ id: number; via: "link" | "name" }>;
  names: number[];
}

export interface AssignInput {
  title: string;
  dateFrom: number | null;
  dateTo: number | null;
  linkIds: number[];
  persons: TitlePerson[];
}

/** Ein Name ohne Geburtsjahr-Beleg trägt einen Vorschlag nur, wenn er so selten ist. */
export const MAX_NAME_COUNT = 3;

/** Gefaltete Wörter eines Namens (Varianten wie in entityKey.ts). */
const nameTokens = nameWords;

function surnameKey(last: string): string {
  return nameTokens(last).join(" ");
}

export function buildKrdbIndex(persons: KrdbCandidate[], aliases: Map<number, number>): KrdbIndex {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const bySurname = new Map<string, KrdbCandidate[]>();
  for (const p of persons) {
    const k = surnameKey(p.last);
    if (!k) continue;
    const list = bySurname.get(k) ?? [];
    list.push(p);
    bySurname.set(k, list);
  }
  return { byId, bySurname, aliases };
}

const yearOf = (d: string | null): number | null => (d ? Number(d.slice(0, 4)) : null);

/** Ein Einsitz überschneidet eine Amtszeit aus dem Titel (± 1 Jahr). */
function termsOverlap(p: KrdbCandidate, terms: DossierTerm[]): boolean {
  return terms.some((t) =>
    p.seats.some(([c, from, to]) => {
      if (c !== t.council) return false;
      const sFrom = yearOf(from) ?? 0;
      const sTo = yearOf(to) ?? 9999;
      return sFrom <= (t.to ?? 9999) + 1 && t.from - 1 <= sTo;
    }),
  );
}

/** Lebenszeit für die Plausibilität: Geburt bzw. erster Einsitz − 60, Tod bzw. letzter Einsitz + 50. */
function lifetime(p: KrdbCandidate): [number, number] | null {
  const froms = p.seats.map(([, from]) => yearOf(from)).filter((y): y is number => y !== null);
  const tos = p.seats.map(([, , to]) => yearOf(to)).filter((y): y is number => y !== null);
  const lo = p.born ?? (froms.length > 0 ? Math.min(...froms) - 60 : null);
  const hi = p.died ?? (tos.length > 0 ? Math.max(...tos) + 50 : froms.length > 0 ? Math.max(...froms) + 80 : null);
  return lo !== null && hi !== null ? [lo, hi] : null;
}

const close = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined || Math.abs(a - b) <= 1;

/** Vornamen verträglich: die kürzere Folge ist Anfang der längeren, eine Initiale passt
 *  auf jeden Vornamen mit diesem Anfangsbuchstaben – aber mindestens ein Vorname muss
 *  ausgeschrieben übereinstimmen («A. Elisabetha» ≠ «Albert», «H.» allein trägt nicht). */
export function givenCompatible(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length === 0 || y.length === 0) return false;
  const n = Math.min(x.length, y.length);
  let full = false;
  for (let i = 0; i < n; i++) {
    const [u, v] = [x[i], y[i]];
    if (u === v) {
      if (u.length > 1) full = true;
      continue;
    }
    if ((u.length === 1 && v.startsWith(u)) || (v.length === 1 && u.startsWith(v))) continue;
    return false;
  }
  return full;
}

/** Gleicher Nachname, verträgliche Vornamen (gefaltet, Schreibvarianten). */
function sameName(p: KrdbCandidate, t: TitlePerson): boolean {
  return surnameKey(p.last) === surnameKey(t.last) && givenCompatible(p.first, t.first);
}

/**
 * `nameCount(t)`: in wie vielen Katalogeinheiten der Name (Personenschlüssel)
 * vorkommt; ohne Angabe gilt jeder Name als häufig (nur Geburtsjahr-Vorschläge).
 */
export function assignKrdb(input: AssignInput, index: KrdbIndex, nameCount: (t: TitlePerson) => number = () => Infinity): KrdbAssignment {
  const out: KrdbAssignment = { strict: [], names: [] };
  const seen = new Set<number>();
  const fullNames = input.persons.map((t) => `${t.first} ${t.last}`);
  const line = input.title.split("\n")[0] ?? "";

  for (const raw of input.linkIds) {
    const p = index.byId.get(index.aliases.get(raw) ?? raw);
    if (!p || seen.has(p.id)) continue;
    if ([...fullNames, line].some((n) => nameMatches(p, n))) {
      out.strict.push({ id: p.id, via: "link" });
      seen.add(p.id);
    }
  }

  const terms = parseDossierTerms(input.title);
  for (const t of input.persons) {
    const named = (index.bySurname.get(surnameKey(t.last)) ?? []).filter((p) => !seen.has(p.id));
    if (named.length === 0) continue;

    if (t.born !== undefined && terms.length > 0) {
      const hits = named.filter((p) => nameMatches(p, `${t.first} ${t.last}`) && p.born === t.born && termsOverlap(p, terms));
      if (hits.length === 1) {
        out.strict.push({ id: hits[0].id, via: "name" });
        seen.add(hits[0].id);
        continue;
      }
    }

    if (input.dateFrom === null || input.dateTo === null) continue;
    const from = input.dateFrom;
    const to = input.dateTo;
    const cands = named.filter((p) => {
      if (!sameName(p, t) || !close(t.born, p.born) || !close(t.died, p.died)) return false;
      const life = lifetime(p);
      return life !== null && from <= life[1] && life[0] <= to;
    });
    if (cands.length !== 1 || out.names.includes(cands[0].id)) continue;
    const bornAgrees = t.born !== undefined && cands[0].born !== undefined;
    if (bornAgrees || nameCount(t) <= MAX_NAME_COUNT) out.names.push(cands[0].id);
  }
  out.names = out.names.filter((id) => !seen.has(id));
  return out;
}
