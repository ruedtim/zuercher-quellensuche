import type { Settings } from "meilisearch";

/**
 * Settings des Meili-Index `editions` (Texte der Editionen, editionsBuild.ts: QZH und Zürcher
 * Rechtsquellen). Stichwortsuche über den Suchtext (editionSearchForm: frühneuhochdeutsche Zeichen
 * vereinheitlicht) von Titel, Regest, Schlagwörtern, Quellentext, Kommentar und Anmerkungen;
 * «nur im Titel» = `title`. Das Thema reiht über jina-Vektoren aus Titel, Schlagwörtern,
 * Regest und Kommentar (modernes Deutsch; userProvided wie `documents` und `catalog`, die
 * Anfrage bettet der embed-Service ein).
 *
 * Personen, Orte und Organisationen filtern wie im Archivkatalog über die Vergleichsschlüssel
 * (`personKeys`, `placeKeys`, `orgKeys`, entityKey.ts; mit allen Schreibungen des Registers)
 * und zusätzlich über den Namen selbst (`persons`, `places`, `orgs`: Einzelnamen ohne
 * Schlüssel; ohne filterbares `orgs` scheiterte bis 2026-11 jede Suche mit Organisation).
 * Zeitleiste und Zeitraum über die Jahre `dateFrom`/`dateTo` (Zählung nach Berührung),
 * sortiert nach `sortDate` (JJJJMMTT).
 * HTML, Anmerkungen und Faksimile-Liste liegen im Index, die Detailseite liest sie mit.
 * Läuft auf Hetzner ohne Imports aus apps/web (import.ts).
 */
// Typo-Settings mit `disableOnNumbers` (Meili ≥ v1.15) – meilisearch-js 0.45 kennt das Feld
// noch nicht, darum als eigene Konstante (keine Prüfung überzähliger Felder).
const EDITIONS_TYPO: NonNullable<Settings["typoTolerance"]> & { disableOnNumbers: boolean } = { minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 }, disableOnAttributes: ["signature", "localId", "label"], disableOnNumbers: true };

export const EDITIONS_INDEX_SETTINGS: Settings = {
  searchableAttributes: ["title", "regest", "keywords", "text", "comment", "noteText", "persons", "places", "orgs", "signature", "localId", "label"],
  filterableAttributes: [
    "id",
    "edition",
    "localId",
    "part",
    "keywords",
    "persons",
    "places",
    "orgs",
    "personKeys",
    "placeKeys",
    "orgKeys",
    "dateFrom",
    "dateTo",
    "dated",
    "hasFacsimile",
    "catalogIds",
    "embedded",
    "textLang",
  ],
  sortableAttributes: ["sortDate", "dateFrom", "dateTo", "nr"],
  displayedAttributes: [
    "id",
    "edition",
    "localId",
    "label",
    "nr",
    "permalink",
    "displayTitle",
    "title",
    "part",
    "editors",
    "transcription",
    "tagging",
    "publisher",
    "published",
    "signature",
    "sourceUrl",
    "catalogIds",
    "textLang",
    "filiation",
    "physical",
    "origPlace",
    "witnesses",
    "sourceFile",
    "dated",
    "isoFrom",
    "isoTo",
    "calendar",
    "dateFrom",
    "dateTo",
    "bibl",
    "keywords",
    "keywordGlosses",
    "regestHtml",
    "regest",
    "html",
    "backHtml",
    "notes",
    "text",
    "comment",
    "noteText",
    "persons",
    "personList",
    "places",
    "placeList",
    "orgs",
    "entitySource",
    "pages",
    "facs",
    "hasFacsimile",
    "embedded",
  ],
  // Wie `documents` und `catalog`: Datums-Sort direkt nach `words`, `exactness` vor
  // `proximity` (genau so geschriebene Wörter vor Wortanfang-Treffern, seit 2026-11-17).
  rankingRules: ["words", "sort", "typo", "exactness", "proximity", "attribute"],
  faceting: { maxValuesPerFacet: 2000, sortFacetValuesBy: { "*": "count" } },
  pagination: { maxTotalHits: 100_000 },
  // Meilis Default (1500 ms) bricht langsame Suchen still ab (CLAUDE.md, Meili-Eigenheiten).
  searchCutoffMs: 10_000,
  // disableOnNumbers (ab Meili v1.15): Zahlen ohne Tippfehler – «11234» traf «11235». Erst
  // nach dem Upgrade auf v1.57 setzbar (v1.13 lehnt das Feld ab); der Import legt die Settings
  // vor den Dokumenten an (meilisearch#6736 betrifft nur das Einschalten auf vollem Index).
  typoTolerance: EDITIONS_TYPO,
  embedders: { jina_de: { source: "userProvided", dimensions: 768 } },
};
