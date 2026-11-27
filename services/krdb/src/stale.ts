/**
 * Veraltete P13468 auflösen.
 *
 * Die KRDB vergibt die Personen-ID (ID_PERSON_NEW) neu, wenn sich ein
 * Datensatz ändert – etwa beim Nachtrag eines Todesdatums, bei neuen Einsitzen
 * oder Korrekturen. P13468 auf Wikidata hält eine Momentaufnahme und zeigt
 * danach ins Leere (2023 → 2026: 552 von rund 4'300 Personen neu nummeriert,
 * darunter alle seither Verstorbenen und die meisten Amtierenden).
 *
 * Ein Item mit veralteter ID wird der Person der Live-KRDB zugeordnet, deren
 * Name (Label/Alias) und Geburtsdatum passen – nur wenn genau eine Person passt
 * und sie nicht schon mit einem anderen Item verknüpft ist. Pur (kein Netz),
 * unit-getestet in stale.test.ts.
 */

export interface StaleItem {
  qid: string;
  /** Veraltete P13468-Werte des Items. */
  oldIds: string[];
  /** Labels und Aliasse (de/en/fr/it/mul). */
  names: string[];
  /** P569: Datum «YYYY-MM-DD» mit Wikidata-Genauigkeit (9 Jahr, 10 Monat, 11 Tag). */
  births: Array<{ date: string; precision: number }>;
}

export interface StalePerson {
  id: number;
  first: string;
  last: string;
  /** «YYYY[-MM[-DD]]» aus der KRDB. */
  bornDate?: string;
}

export interface StaleResolution {
  qid: string;
  oldIds: string[];
  newId: number;
  name: string;
  /** «Name + Geburtsdatum» oder «Name + Geburtsjahr». */
  basis: string;
  /** Die Person ist über eine andere Route schon mit diesem Item verknüpft. */
  linkedAlready: boolean;
}

export interface StaleUnresolved {
  qid: string;
  oldIds: string[];
  name: string;
  reason: string;
}

const PARTICLES = new Set(["von", "vom", "van", "de", "di", "da", "del", "der", "den", "du", "la", "le", "zu", "zur", "zum"]);

/** Gleichwertige Vornamensformen (Wikidata «Hans Heinrich» ↔ KRDB «Johann Heinrich»). */
const FIRST_NAME_FORMS: string[][] = [
  ["hans", "johann", "johannes"],
  ["jakob", "jacob"],
  ["konrad", "conrad"],
  ["karl", "carl"],
  ["kaspar", "caspar"],
  ["rudolf", "rudolph"],
  ["friedrich", "fritz"],
];
const FORMS = new Map(FIRST_NAME_FORMS.flatMap((group) => group.map((n) => [n, group] as const)));

/** Namensformen für den Vergleich: Umlaute ausgeschrieben (ä → ae) und
 *  gestrichen (ä → a), Diakritika weg, nur Buchstaben/Ziffern als Tokens. */
function tokenSets(name: string): Array<Set<string>> {
  const base = name.toLowerCase().replace(/\([^)]*\)/g, " ");
  const expand = base.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const strip = base.replace(/ß/g, "ss");
  return [expand, strip].map(
    (s) =>
      new Set(
        s
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/[^a-z0-9]+/)
          .filter(Boolean),
      ),
  );
}

/** Ein Vornamensteil (auch in gleichwertiger Form, Hans ↔ Johann) und ein
 *  Nachnamensteil ausser Partikeln kommen im Item-Namen vor. Streng genug, weil
 *  zusätzlich das Geburtsdatum passen muss. */
export function nameMatches(person: Pick<StalePerson, "first" | "last">, itemName: string): boolean {
  const itemSets = tokenSets(itemName);
  const firstSets = tokenSets(person.first);
  const lastSets = tokenSets(person.last);
  return itemSets.some((item, v) => {
    const firsts = [...firstSets[v]].flatMap((t) => FORMS.get(t) ?? [t]);
    const lasts = [...lastSets[v]].filter((t) => !PARTICLES.has(t));
    return firsts.some((t) => item.has(t)) && lasts.some((t) => item.has(t));
  });
}

/** Geburtsdaten verträglich: verglichen wird in der gröberen der beiden Genauigkeiten. */
export function birthMatches(
  bornDate: string | undefined,
  birth: { date: string; precision: number },
): "date" | "year" | null {
  if (!bornDate) return null;
  const [ky, km, kd] = bornDate.split("-");
  const [iy, im, id] = birth.date.slice(0, 10).split("-");
  if (ky !== iy) return null;
  const itemDay = birth.precision >= 11 && im !== "00" && id !== "00";
  const itemMonth = birth.precision >= 10 && im !== "00";
  if (km && itemMonth && km !== im) return null;
  if (kd && itemDay && kd !== id) return null;
  return kd && itemDay ? "date" : "year";
}

export function resolveStale(
  items: StaleItem[],
  persons: StalePerson[],
  linked: ReadonlyMap<number, string>,
): { resolved: StaleResolution[]; unresolved: StaleUnresolved[] } {
  const hits: Array<{ item: StaleItem; person: StalePerson; basis: string } | StaleUnresolved> = [];
  const holders = new Map<string, number[]>();
  for (const [id, q] of linked) holders.set(q, [...(holders.get(q) ?? []), id]);
  for (const item of items) {
    const name = item.names[0] ?? item.qid;
    if (item.births.length === 0) {
      hits.push({ qid: item.qid, oldIds: item.oldIds, name, reason: "Item ohne Geburtsdatum" });
      continue;
    }
    const candidates = new Map<number, { person: StalePerson; exact: boolean }>();
    const nearMisses: number[] = [];
    const itemYears = new Set(item.births.map((b) => b.date.slice(0, 4)));
    for (const person of persons) {
      if (!item.names.some((n) => nameMatches(person, n))) continue;
      const kinds = item.births.map((b) => birthMatches(person.bornDate, b));
      if (!kinds.some(Boolean)) {
        if (person.bornDate && itemYears.has(person.bornDate.slice(0, 4))) nearMisses.push(person.id);
        continue;
      }
      candidates.set(person.id, { person, exact: kinds.includes("date") });
    }
    if (candidates.size === 0) {
      const reason =
        nearMisses.length > 0
          ? `Name und Geburtsjahr passen, Geburtsdatum weicht ab (KRDB ${nearMisses.join(", ")})`
          : "keine Person mit passendem Namen und Geburtsdatum";
      hits.push({ qid: item.qid, oldIds: item.oldIds, name, reason });
      continue;
    }
    // Mehrere Kandidaten: ein taggenauer Treffer schlägt blosse Jahrestreffer.
    let pool = [...candidates.values()];
    if (pool.length > 1 && pool.filter((c) => c.exact).length === 1) pool = pool.filter((c) => c.exact);
    if (pool.length > 1) {
      hits.push({
        qid: item.qid,
        oldIds: item.oldIds,
        name,
        reason: `mehrdeutig (KRDB ${pool.map((c) => c.person.id).join(", ")})`,
      });
      continue;
    }
    const [{ person, exact }] = pool;
    const other = linked.get(person.id);
    if (other && other !== item.qid) {
      hits.push({ qid: item.qid, oldIds: item.oldIds, name, reason: `KRDB ${person.id} ist schon mit ${other} verknüpft – Dublette?` });
      continue;
    }
    const others = (holders.get(item.qid) ?? []).filter((id) => id !== person.id);
    if (others.length > 0) {
      hits.push({ qid: item.qid, oldIds: item.oldIds, name, reason: `Item ist schon mit KRDB ${others.join(", ")} verknüpft – Dublette in der KRDB?` });
      continue;
    }
    hits.push({ item, person, basis: exact ? "Name + Geburtsdatum" : "Name + Geburtsjahr" });
  }

  // Zwei Items für dieselbe Person: keines übernehmen, beide melden.
  const perPerson = new Map<number, number>();
  for (const h of hits) if ("person" in h) perPerson.set(h.person.id, (perPerson.get(h.person.id) ?? 0) + 1);

  const resolved: StaleResolution[] = [];
  const unresolved: StaleUnresolved[] = [];
  for (const h of hits) {
    if (!("person" in h)) {
      unresolved.push(h);
      continue;
    }
    const name = h.item.names[0] ?? h.item.qid;
    if ((perPerson.get(h.person.id) ?? 0) > 1) {
      unresolved.push({ qid: h.item.qid, oldIds: h.item.oldIds, name, reason: `mehrere Items für KRDB ${h.person.id} – Dublette?` });
      continue;
    }
    resolved.push({
      qid: h.item.qid,
      oldIds: h.item.oldIds,
      newId: h.person.id,
      name,
      basis: h.basis,
      linkedAlready: linked.get(h.person.id) === h.item.qid,
    });
  }
  const byQid = (a: { qid: string }, b: { qid: string }) => Number(a.qid.slice(1)) - Number(b.qid.slice(1));
  return { resolved: resolved.sort(byQid), unresolved: unresolved.sort(byQid) };
}
