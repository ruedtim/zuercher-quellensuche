/**
 * Welche Top-Level-Settings würde ein `PATCH /indexes/:uid/settings` mit
 * `desired` tatsächlich ändern? Leer ⇒ der Settings-Task wäre ein No-op und
 * kann entfallen.
 *
 * Grund: Meili arbeitet Tasks global nacheinander ab – auch ein No-op-
 * Settings-Task wartet hinter allen offenen Tasks. Am 2026-06-26 stand so ein
 * 0,3-s-Task 21 min hinter Chunk-Löschungen, der 10-min-Wait in
 * import-chunks.ts lief ab, und der Import brach ab, bevor ein Chunk
 * geschrieben war (12'551 Docs blieben bis 2026-09-25 ohne Chunks).
 *
 * Vergleich nach PATCH-Semantik: Objekte (embedders, typoTolerance, faceting,
 * pagination) werden gemergt – `desired` muss darin nur ENTHALTEN sein;
 * Listen und die als Ganzes ersetzten Maps werden exakt verglichen,
 * Mengen-Listen (filterable/sortable, stopWords …) reihenfolgeunabhängig, weil
 * Meili sie sortiert zurückliefert.
 */

// Listen, die Meili als Menge speichert (GET liefert sie sortiert zurück).
const SET_LISTS = new Set([
  "filterableAttributes",
  "sortableAttributes",
  "stopWords",
  "nonSeparatorTokens",
  "separatorTokens",
  "dictionary",
  "disableOnWords",
  "disableOnAttributes",
]);

// Maps, die ein PATCH als Ganzes ersetzt statt sie zu mergen.
const REPLACED_MAPS = new Set(["synonyms", "sortFacetValuesBy"]);

export function settingsDrift(current: object, desired: object): string[] {
  const have = current as Record<string, unknown>;
  return Object.entries(desired)
    .filter(([key, want]) => want !== undefined && !contains(have[key], want, key))
    .map(([key]) => key);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Kanonische Form fürs exakte Vergleichen (Objekt-Keys sortiert). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}

/** Ist `want` (unter `key`) in `have` enthalten, d. h. änderte ein PATCH nichts? */
function contains(have: unknown, want: unknown, key: string): boolean {
  if (isPlainObject(want) && !REPLACED_MAPS.has(key)) {
    return (
      isPlainObject(have) &&
      Object.entries(want).every(([k, w]) => w === undefined || contains(have[k], w, k))
    );
  }
  if (SET_LISTS.has(key) && Array.isArray(want) && Array.isArray(have)) {
    return canon(want.map(canon).sort()) === canon(have.map(canon).sort());
  }
  return canon(have) === canon(want);
}
