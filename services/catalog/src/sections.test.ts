import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogSections } from "./sections.ts";
import type { CatalogRecord, CatalogSection } from "./types.ts";

// Aufbau wie der stazh-scraper-Export; Inhalte frei erfunden.

const field = (key: string, label: string, text: string, links: CatalogSection["fields"][number]["links"] = []) => ({
  key,
  label,
  text,
  lines: text.split("\n"),
  links,
});

function rec(sections: CatalogSection[]): CatalogRecord {
  return { id: 7, url: "", signature: "X 1.2", title: "Muster", level: "Dossier", date_text: "1900", parent_id: 6, path: [], sections, fields: {} };
}

test("Abschnitte in Katalog-Reihenfolge, ohne Kopf-Felder und Platzhalter", () => {
  const out = catalogSections(
    rec([
      {
        section: "Identifikation und Inhalt",
        key: "identifikation_und_inhalt",
        fields: [
          field("signatur", "Signatur", "X 1.2"),
          field("titel", "Titel", "Muster"),
          field("entstehungszeitraum", "Entstehungszeitraum", "1900"),
          field("inhalt_und_form", "Inhalt und Form", "Erste Zeile\nZweite Zeile"),
          field("archivalienart", "Archivalienart", "Dossier"),
          field("anmerkungen", "Anmerkungen", "Noch eine Zeile"),
        ],
      },
      {
        section: "Benutzung",
        key: "usage",
        fields: [field("zugaenglichkeit", "Zugänglichkeit", "[Leer]"), field("schutzfristende", "Schutzfristende", "31.12.1950")],
      },
      { section: "Kontrolle", key: "kontrolle", fields: [field("stufe", "Stufe", "Dossier"), field("signatur_archivplan", "Signatur Archivplan", "X 1.2")] },
      {
        section: "URL für diese Verz.-Einheit",
        key: "permalink",
        fields: [field("url", "URL", "https://example.org/detail.aspx?ID=7", [{ text: "x", href: "https://example.org/detail.aspx?ID=7", id: 7 }])],
      },
    ]),
  );
  assert.deepEqual(out, [
    {
      title: "Identifikation und Inhalt",
      fields: [
        { label: "Inhalt und Form", text: "Erste Zeile\nZweite Zeile" },
        { label: "Archivalienart", text: "Dossier" },
        { label: "Anmerkungen", text: "Noch eine Zeile" },
      ],
    },
    { title: "Benutzung", fields: [{ label: "Schutzfristende", text: "31.12.1950" }] },
  ]);
});

test("Verweise: Katalogeinheiten über die ID, sonst nur http(s)", () => {
  const out = catalogSections(
    rec([
      {
        section: "Verwandte Verzeichnungseinheiten",
        key: "related",
        fields: [
          field("verwandte_verzeichnungseinheiten", "Verwandte Verzeichnungseinheiten", "Siehe:\nX 9 Andere Akten, 1901 (Dossier)", [
            { text: "X 9 Andere Akten, 1901 (Dossier)", href: "https://example.org/detail.aspx?ID=9", id: 9 },
          ]),
        ],
      },
      {
        section: "Weitere Angaben",
        key: "weitere_angaben",
        fields: [
          field("weblinks", "Weblinks", "Beispiel\nSkript", [
            { text: "Beispiel", href: "https://example.org/a" },
            { text: "Skript", href: "javascript:alert(1)" },
          ]),
        ],
      },
    ]),
  );
  assert.deepEqual(out[0].fields[0].links, [{ text: "X 9 Andere Akten, 1901 (Dossier)", id: 9 }]);
  assert.deepEqual(out[1].fields[0].links, [{ text: "Beispiel", href: "https://example.org/a" }]);
});

test("Dateien, Vorschaubilder und leere Abschnitte fallen weg", () => {
  const out = catalogSections(
    rec([
      { section: "Dateien", key: "files", fields: [field("dateien", "Dateien", "a.pdf", [{ text: "a.pdf", href: "https://example.org/a.pdf" }])] },
      { section: "Behältnisse", key: "behaeltnisse", fields: [field("anzahl", "Anzahl", " ")] },
      { section: "Fotospezifische Merkmale", key: "fotospezifische_merkmale", fields: [field("ansichtsbild", "Ansichtsbild", "1\n2")] },
    ]),
  );
  assert.deepEqual(out, []);
});
