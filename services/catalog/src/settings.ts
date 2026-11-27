import type { Settings } from "meilisearch";
import { CATALOG_FOLDED_FIELDS, CATALOG_FORMATTED_FIELDS, foldedField, withFolded } from "./searchText.ts";

/**
 * Settings des Meili-Index `catalog` (Verzeichnungseinheiten des Archivkatalogs).
 * Rein lexikalisch (keine Embedder, wie die Ratsmanuale). Gesucht wird in Titel,
 * Signatur, Regest/«Inhalt und Form» und Provenienz – nicht im Archivplan-Pfad,
 * sonst träfe «Universität» jede Einheit unter dieser Klasse –, dazu in deren gefalteten
 * Suchfeldern (ß als ss, searchText.ts). Entitäts-Schlüssel
 * (`*Keys`) und KRDB-IDs sind nur Filter: Vorschläge am Dokument und
 * Personenseiten fragen darüber ab. Der Archivbaum liest Kinder über `parentId`
 * in der Reihenfolge `sigSort`, die Detailseite die Nachbarn einer Einheit über
 * `parentId` + `sigPos` (Position in derselben Reihenfolge); die Zeitleiste zählt über die Facetten
 * `dateFrom`/`dateTo` (rund 1'300 mögliche Jahre, darum `maxValuesPerFacet` 2'000).
 * `sections` (alle veröffentlichten Abschnitte) ist nur angezeigt.
 *
 * Vektoren (POC 2026-10-30): Embedder `jina_de` wie im Index `documents`
 * (userProvided, 768-dim, gerechnet auf dem Mac, embed/embed_catalog.py). Nur
 * Einheiten mit Text ausser Namen tragen einen (`embedded`, filterbar); alle
 * übrigen `_vectors.jina_de: null` – Meili verlangt den Schlüssel an jedem
 * Dokument, sobald der Embedder existiert (import.ts ergänzt ihn notfalls).
 */
// Typo-Settings mit `disableOnNumbers` (Meili ≥ v1.15) – meilisearch-js 0.45 kennt das Feld
// noch nicht, darum als eigene Konstante (keine Prüfung überzähliger Felder).
const CATALOG_TYPO: NonNullable<Settings["typoTolerance"]> & { disableOnNumbers: boolean } = {
  minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
  disableOnAttributes: ["signature", foldedField("signature")],
  disableOnNumbers: true,
};

export const CATALOG_INDEX_SETTINGS: Settings = {
  searchableAttributes: withFolded(["title", "signature", "text", "provenienz"], CATALOG_FOLDED_FIELDS),
  filterableAttributes: [
    "id",
    "parentId",
    "sigPos",
    "level",
    "bestand",
    "dateFrom",
    "dateTo",
    "onPlatform",
    "docId",
    "docSeries",
    "hasDigitization",
    "personKeys",
    "placeKeys",
    "orgKeys",
    "krdbIds",
    "krdbNameIds",
    "embedded",
  ],
  sortableAttributes: ["dateFrom", "dateTo", "sigSort"],
  displayedAttributes: [
    "id",
    "signature",
    "title",
    "level",
    "dateText",
    "dateFrom",
    "dateTo",
    "path",
    "bestand",
    "parentId",
    "sigPos",
    "childCount",
    "stub",
    "provenienz",
    "text",
    "sections",
    "hasDigitization",
    "files",
    "fileCount",
    "url",
    "onPlatform",
    "docId",
    "docSeries",
    "persons",
    "places",
    "organizations",
    "krdbIds",
    "krdbNameIds",
    "embedded",
    // Nur für Meilis Formatierung (searchText.ts), die Web-App zeigt das Original.
    ...CATALOG_FORMATTED_FIELDS.map(foldedField),
  ],
  // Wie `documents`: Datums-Sort direkt nach `words`, damit er bei «ältste
  // zuerst» das erste Kriterium ist; `exactness` vor `proximity` (genau so geschriebene
  // Wörter vor Wortanfang-Treffern, seit 2026-11-17).
  rankingRules: ["words", "sort", "typo", "exactness", "proximity", "attribute"],
  faceting: { maxValuesPerFacet: 2000, sortFacetValuesBy: { "*": "count" } },
  // Wie `documents`: Meili kappt Trefferzahl und Blättern bei maxTotalHits (mit
  // 100'000 blieb die Anzahl ohne Suchbegriff dort stehen). Voller Katalog ~1,5 Mio.
  pagination: { maxTotalHits: 2_000_000 },
  // Meilis Default (1500 ms) bricht langsame Suchen still ab (s. CLAUDE.md, Meili-Eigenheiten).
  searchCutoffMs: 10_000,
  // disableOnNumbers (ab Meili v1.15): Zahlen ohne Tippfehler – «11234» traf «11235». Erst
  // nach dem Upgrade auf v1.57 setzbar (v1.13 lehnt das Feld ab); der Import legt die Settings
  // vor den Dokumenten an (meilisearch#6736 betrifft nur das Einschalten auf vollem Index).
  typoTolerance: CATALOG_TYPO,
  embedders: { jina_de: { source: "userProvided", dimensions: 768 } },
};
