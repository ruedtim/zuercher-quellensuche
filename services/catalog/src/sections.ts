/**
 * Veröffentlichte Abschnitte einer Katalogeinheit für die Detailseite der Plattform
 * (`/archivkatalog/<ID>`), in der Reihenfolge des Online-Katalogs. Weg fallen leere
 * Felder und Platzhalter («[Leer]»), was die Seite schon im Kopf zeigt (Signatur, Titel,
 * Name, Entstehungszeitraum, Stufe), Vorschaubilder, der Permalink (leitet die Web-App aus der ID ab)
 * und die Dateiliste (steht als `files` im Dokument). Regest bzw. «Inhalt und Form»
 * bleiben ungekürzt drin (`text` ist für die Suche gekürzt). Verweise auf andere Einheiten
 * behalten nur ihre ID, alle anderen nur http(s)-Adressen. Pur, unit-getestet in
 * sections.test.ts.
 */

import type { CatalogDocLink, CatalogDocSection, CatalogRecord } from "./types.ts";

const SKIP_SECTIONS = new Set(["permalink", "files"]);
// «Ansichtsbild» sind Vorschaubilder im Online-Katalog (als Text nur «1», «2»); die
// Plattform bettet keine ein, die Digitalisate stehen als Links in `files`.
const SKIP_FIELDS = new Set(["signatur", "titel", "name", "entstehungszeitraum", "stufe", "signatur_archivplan", "ansichtsbild"]);
const PLACEHOLDER = /^\[Leer\]$/;

function link(l: { text: string; href: string; id?: number }): CatalogDocLink | null {
  const text = l.text.trim();
  if (typeof l.id === "number" && Number.isInteger(l.id) && l.id > 0) return { text, id: l.id };
  return /^https?:\/\//i.test(l.href) ? { text: text || l.href, href: l.href } : null;
}

export function catalogSections(rec: CatalogRecord): CatalogDocSection[] {
  const out: CatalogDocSection[] = [];
  for (const s of rec.sections) {
    if (SKIP_SECTIONS.has(s.key)) continue;
    const fields: CatalogDocSection["fields"] = [];
    for (const f of s.fields) {
      const text = f.text.trim();
      if (SKIP_FIELDS.has(f.key) || !text || PLACEHOLDER.test(text)) continue;
      const links = f.links.map(link).filter((l): l is CatalogDocLink => l !== null);
      fields.push(links.length > 0 ? { label: f.label, text, links } : { label: f.label, text });
    }
    if (fields.length > 0) out.push({ title: s.section, fields });
  }
  return out;
}
