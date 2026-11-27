/**
 * Ein- und Ausgabeformate des Katalog-Aufbaus.
 *
 * Eingabe ist der JSONL-Export des stazh-scrapers (nicht veröffentlicht, `stazh export`):
 * eine Verzeichnungseinheit des Online-Archivkatalogs pro Zeile, mit allen
 * Feldern der Detailseite (`sections`, verlustfrei) und einer flachen
 * Bequemlichkeits-Map (`fields`). Ausgabe sind die Dokumente des Meili-Index
 * `catalog`.
 */

import type { CATALOG_FOLDED_FIELDS, FoldedFields } from "./searchText.ts";

export interface CatalogLink {
  text: string;
  href: string;
  /** Katalog-ID, wenn der Link auf eine andere Verzeichnungseinheit zeigt. */
  id?: number;
}

export interface CatalogField {
  label: string;
  key: string;
  text: string;
  lines?: string[];
  links: CatalogLink[];
}

export interface CatalogSection {
  section: string;
  key: string;
  fields: CatalogField[];
}

export interface CatalogPathNode {
  id: number;
  label: string;
  level: string;
}

/** Eine Zeile des stazh-scraper-Exports (nur die hier genutzten Felder). */
export interface CatalogRecord {
  id: number;
  url: string;
  signature: string | null;
  title: string | null;
  level: string | null;
  date_text: string | null;
  parent_id: number | null;
  /** Archivplan-Pfad von der Wurzel bis zur Einheit selbst. */
  path: CatalogPathNode[];
  sections: CatalogSection[];
  /** Flache Map Feld-Schlüssel → Text (Kollisionen mit Leerzeile angehängt). */
  fields: Record<string, string>;
  files?: Array<{ name: string; url: string; kind: string }>;
  has_digitization?: boolean;
  /** Abrufzeit der Seite (UTC, ISO 8601). */
  fetched_at?: string;
}

/** Serien der Plattform, auf die der Katalog per Weblink verweist. */
export type DocSeries = "ABl" | "KRP" | "OS" | "RRB" | "RM";

/** Verweis in einem Feld: andere Katalogeinheit über `id`, sonst `href` (nur http/https). */
export interface CatalogDocLink {
  text: string;
  id?: number;
  href?: string;
}

/** Ein veröffentlichter Abschnitt der Katalog-Detailseite, bereinigt für die Anzeige (sections.ts). */
export interface CatalogDocSection {
  title: string;
  fields: Array<{ label: string; text: string; links?: CatalogDocLink[] }>;
}

/** Felder, die Einheiten und Archivplan-Stufen im Index gemeinsam haben. */
interface CatalogNode {
  id: number;
  signature: string;
  title: string;
  level: string;
  dateText: string;
  /** Jahre; null, wenn `dateText` fehlt oder nicht lesbar ist. */
  dateFrom: number | null;
  dateTo: number | null;
  /** Ahnen ohne Wurzel und ohne die Einheit selbst (für Brotkrumen). */
  path: Array<{ id: number; label: string }>;
  /** Nächster Ahne der Stufe «Bestand» (sonst «Abteilung»), als Facette. */
  bestand: string | null;
  parentId: number | null;
  hasDigitization: boolean;
  url: string;
  /** Reihenfolge unter Geschwistern wie im Archivplan (tree.ts `siblingSortKey`, bei
   *  gleichem Schlüssel mit angehängter ID). */
  sigSort: string;
  /** Position unter den Geschwistern ab 1, in der Reihenfolge von `sigSort` (Nachbarn
   *  und «3 von 4» auf der Detailseite; tree.ts `SiblingOrder`). */
  sigPos: number;
  /** Bekannte Untereinheiten: gecrawlte und solche, die nur aus Pfaden bekannt sind. */
  childCount: number;
}

/**
 * Archivplan-Stufe, die bisher nur aus den Pfaden gecrawlter Einheiten bekannt ist
 * (der Crawl läuft in zufälliger ID-Reihenfolge): Name und Datum aus dem Etikett, die
 * Signatur steckt ungetrennt im Titel. Ohne `onPlatform`, damit sie aus allen Abfragen
 * mit `onPlatform = false` fällt (Suche, Zähler, Zeitleiste, API, MCP) und nur im
 * Archivbaum und als Seite erscheint. Erreicht der Crawl die Stufe, ersetzt sie die
 * Einheit beim nächsten Aufbau.
 */
export interface CatalogStub extends CatalogNode {
  stub: true;
}

/** Dokument im Meili-Index `catalog` (Primärschlüssel = Katalog-ID der Einheit), eigene Treffer
 *  mit ß dazu mit gefalteten Suchfeldern (searchText.ts). */
export interface CatalogDoc extends CatalogNode, FoldedFields<(typeof CATALOG_FOLDED_FIELDS)[number]> {
  provenienz?: string;
  /** Regest bzw. «Inhalt und Form», gekürzt (durchsuchbar; ungekürzt in `sections`). */
  text?: string;
  /** Alle veröffentlichten Abschnitte der Katalogseite, nur angezeigt (Detailseite). */
  sections?: CatalogDocSection[];
  /** Digitalisate im Online-Katalog (Datei-Downloads bzw. Bildansicht), nur eigene Treffer. */
  files?: Array<{ name: string; url: string; kind: "file" | "image" }>;
  /** Zahl der Digitalisate, wenn es mehr als in `files` sind. */
  fileCount?: number;
  /** Die Einheit bildet ein Plattform-Dokument ab (ZS-Weblink auf ein vorhandenes Dokument
   *  oder RM-Sitzung, auch ohne eindeutige Zuordnung): kein eigener Treffer in Suche und
   *  Vorschlägen. */
  onPlatform: boolean;
  /** Das abgebildete (bzw. bei Verweisen das verlinkte) Plattform-Dokument, sofern eindeutig;
   *  mit Abzug der Plattform deren ID («_t», ohne Bindestrich), sonst die Weblink-ID. */
  docId?: string;
  docSeries?: DocSeries;
  persons: string[];
  places: string[];
  organizations: string[];
  personKeys: string[];
  placeKeys: string[];
  orgKeys: string[];
  /** KRDB-Personen, gesichert zugeordnet (Katalog-Link oder Name + Geburtsjahr + Amt). */
  krdbIds?: number[];
  /** KRDB-Personen mit gleichem Namen, nicht geprüft (Vorschläge). */
  krdbNameIds?: number[];
}
