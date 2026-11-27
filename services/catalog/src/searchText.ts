/**
 * Gefaltete Suchfelder der Indizes `catalog` und `ehedaten`: «ß» als «ss».
 *
 * Meili gleicht ß nicht an (ä wird zu a, ß bleibt). Prod 2026-11-24: «Straße» 720
 * Katalogeinheiten, 551 davon blosse Tippfehler-Treffer («Strategie»), «Strasse» 10'465, aber
 * 145 der 169 mit «straß…» nicht; Ehedaten «Straße» 104, «Strasse» 1'044. Wie im Index `documents`
 * (services/indexer searchText.ts) bekommt der Suchtext darum ss, und die Web-App faltet die
 * Anfrage ebenso (apps/web lib/sharpS.ts, lib/server/foldedSearch.ts), sobald der Index die
 * Felder trägt. Anders als dort bleibt auch der Text im Original: Trefferliste, API und MCP
 * zeigen ihn zeichengetreu.
 *
 * - Zu jedem durchsuchten Feld mit ß ein Suchfeld `<feld>Search` mit dem ganzen Feld in ss; ohne
 *   ß fehlt es. Nur bei eigenen Treffern – was die Plattform selbst als Dokument führt, durchsucht
 *   der Katalog nicht.
 * - In `searchableAttributes` steht es direkt hinter dem Original. Meili rechnet die Rangfolge der
 *   Felder (Ranking-Regel `attribute`) aus der Position: So verdoppelt sich jede, und Treffer ohne
 *   ß bleiben in derselben Reihenfolge. Nur bei ODER mit verschieden langen Begriffen mischt die
 *   Föderation Punktzahlen, die sich dabei leicht ändern (1 von 22 Suchen, ab Platz 161).
 * - Felder, die die Trefferliste hervorhebt, stehen gefaltet auch in `displayedAttributes` – nur
 *   damit Meili sie formatiert; die Web-App überträgt Hervorhebung und Auszug auf das Original.
 *
 * Läuft auf Hetzner ohne Imports aus apps/web (Settings, import.ts); searchText.test.ts prüft die
 * Faltung gegen die der Web-App. Pur, unit-getestet.
 */

/** Felder des Index `catalog`, die ein gefaltetes Suchfeld haben können (= alle durchsuchten). */
export const CATALOG_FOLDED_FIELDS = ["title", "signature", "text", "provenienz"] as const;
/** Davon zeigt die Trefferliste diese, mit Hervorhebung bzw. als Auszug. */
export const CATALOG_FORMATTED_FIELDS = ["title", "text"] as const;

/** Felder des Index `ehedaten`, die ein gefaltetes Suchfeld haben können (alle durchsuchten ausser
 *  der Signatur). 2026-10-31 (Zenodo) mit ß: Zusatzinfo 11'959 Einträge, Herkunft 4, Namen und
 *  Kirchgemeinden keine. */
export const EHEDATEN_FOLDED_FIELDS = [
  "mannName",
  "frauName",
  "mannHerkunft",
  "frauHerkunft",
  "mannZusatz",
  "frauZusatz",
  "kirchgemeinde",
] as const;
/** Davon hebt die Trefferliste diese hervor. */
export const EHEDATEN_FORMATTED_FIELDS = ["mannName", "frauName", "mannHerkunft", "frauHerkunft", "mannZusatz", "frauZusatz"] as const;

/** ß → ss, ẞ → SS (wie apps/web lib/sharpS.ts). */
export function foldSharpS(text: string): string {
  return text.replace(/ß/g, "ss").replace(/ẞ/g, "SS");
}

/** Name des gefalteten Suchfelds zu einem Feld (`title` ⇒ `titleSearch`). */
export function foldedField<F extends string>(field: F): `${F}Search` {
  return `${field}Search`;
}

/** Die gefalteten Suchfelder eines Dokuments. */
export type FoldedFields<F extends string> = { [K in F as `${K}Search`]?: string };

/** Gefaltete Suchfelder eines Dokuments: nur für Felder, in denen ein ß steht. */
export function foldedFields<F extends string>(doc: { [K in F]?: string | null }, fields: readonly F[]): FoldedFields<F> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const text = doc[field];
    if (!text) continue;
    const folded = foldSharpS(text);
    if (folded !== text) out[foldedField(field)] = folded;
  }
  return out as FoldedFields<F>;
}

/**
 * Zeile einer Index-Datei (JSONL) mit ihren gefalteten Suchfeldern. Der Aufbau schreibt sie; in
 * Dateien von früher fehlen sie, dann ergänzt sie der Import – so braucht es für sie keinen neuen
 * Aufbau. Fehlt nichts, dieselbe Zeile. Im Katalog nur eigene Treffer (nicht `onPlatform`, keine
 * Stufe nur aus Pfaden).
 */
export function foldLine(line: string, fields: readonly string[]): string {
  // JSON darf das ß auch als Unicode-Maske schreiben (Python ohne ensure_ascii=False).
  if (fields.length === 0 || !/[ßẞ]|\\u(?:00df|1e9e)/i.test(line)) return line;
  const doc = JSON.parse(line) as Record<string, string> & { onPlatform?: boolean; stub?: boolean };
  if (doc.onPlatform || doc.stub) return line;
  const folded = foldedFields<string>(doc, fields);
  const complete = Object.entries(folded).every(([field, text]) => doc[field] === text);
  return complete ? line : JSON.stringify({ ...doc, ...folded });
}

/** Feldliste mit dem gefalteten Suchfeld direkt hinter jedem Feld aus `folded`. */
export function withFolded(fields: readonly string[], folded: readonly string[]): string[] {
  return fields.flatMap((f) => (folded.includes(f) ? [f, foldedField(f)] : [f]));
}
