/**
 * Titel und Entstehungszeitraum für Einheiten ohne Feld «Titel».
 *
 * Dossiers und Dokumente tragen «Titel» und «Entstehungszeitraum». Bestände
 * führen stattdessen «Name»; Klassen und Abteilungen haben gar kein Namensfeld,
 * ihr Name und Datum stehen nur im Archivplan-Etikett der Einheit selbst (letzte
 * Stufe von `path`): «O 211 - O 250 Jahresakten, 1930-1969 (Klasse)». Das Datum
 * hat dort eine eigene Schreibweise («1272.09.12-19. Jh.», «1600 (ca.)-2016»,
 * «19. Jh.-»), die `labelDateToCatalog` in die Form des Entstehungszeitraums
 * bringt, die `parseCatalogDate` liest. Pur, unit-getestet in unitTitle.test.ts.
 */

import { fieldText } from "./links.ts";
import type { CatalogRecord } from "./types.ts";

const ATOM = String.raw`(?:\d{1,2}\. ?Jh\.|\d{3,4}(?:\.\d{2}){0,2})(?: \(ca\.\))?`;
// «<Name>, <Datum>»: Datum = Atom, Spanne «A-B», offen «A-» oder «-B».
const NAME_DATE = new RegExp(String.raw`^(.*?), (${ATOM}-(?:${ATOM})?|-?${ATOM})$`);
const LEVEL_SUFFIX =
  / \((?:Archiv|Hauptabteilung|Abteilung|Bestand|Teilbestand|Klasse|Unterklasse|Serie|Dossier|Subdossier|Dokument)\)$/;

export interface LabelParts {
  name: string;
  /** Datum in der Schreibweise des Etiketts, null ohne Datum. */
  date: string | null;
}

/** Archivplan-Etikett → Name (ohne Signatur, Datum und Stufe) und Datum. */
export function splitPathLabel(label: string, level: string | null, signature: string | null): LabelParts {
  let s = label.trim();
  s = level && s.endsWith(` (${level})`) ? s.slice(0, -(level.length + 3)) : s.replace(LEVEL_SUFFIX, "");
  let date: string | null = null;
  const m = NAME_DATE.exec(s);
  if (m) {
    s = m[1];
    date = m[2];
  }
  if (signature && s.startsWith(`${signature} `)) s = s.slice(signature.length + 1);
  return { name: s.trim(), date };
}

function catalogAtom(atom: string): string {
  const ca = atom.endsWith(" (ca.)");
  const core = ca ? atom.slice(0, -" (ca.)".length) : atom;
  // Monat und Tag auch einstellig («1553.9», so in der Ehedatenbank auf Zenodo).
  const ymd = /^(\d{3,4})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?$/.exec(core);
  const out = ymd
    ? [ymd[3]?.padStart(2, "0"), ymd[2]?.padStart(2, "0"), ymd[1]].filter(Boolean).join(".")
    : core.replace(/^0(\d)\./, "$1.");
  return ca ? `ca. ${out}` : out;
}

/** «1272.09.12-19. Jh.» → «12.09.1272 - 19. Jh.», «19. Jh.-» → «ab 19. Jh.», «-1900» → «bis 1900». */
export function labelDateToCatalog(date: string): string {
  const dash = date.indexOf("-");
  if (dash < 0) return catalogAtom(date);
  const from = date.slice(0, dash);
  const to = date.slice(dash + 1);
  if (!from) return `bis ${catalogAtom(to)}`;
  if (!to) return `ab ${catalogAtom(from)}`;
  return `${catalogAtom(from)} - ${catalogAtom(to)}`;
}

/** Titel und Entstehungszeitraum einer Einheit, mit Ersatz aus «Name» bzw. dem Pfad-Etikett. */
export function unitTitle(rec: CatalogRecord): { title: string; dateText: string; source: "titel" | "name" | "pfad" | null } {
  const own = rec.path.at(-1);
  const label = own && own.id === rec.id ? splitPathLabel(own.label, rec.level, rec.signature) : null;
  const dateText = rec.date_text?.trim() || (label?.date ? labelDateToCatalog(label.date) : "");
  const title = rec.title?.trim();
  if (title) return { title, dateText, source: "titel" };
  const name = fieldText(rec, "name");
  if (name) return { title: name, dateText, source: "name" };
  if (label?.name) return { title: label.name, dateText, source: "pfad" };
  return { title: "", dateText, source: null };
}
