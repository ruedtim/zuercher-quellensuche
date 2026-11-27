import type { Settings } from "meilisearch";
import { EHEDATEN_FOLDED_FIELDS, EHEDATEN_FORMATTED_FIELDS, foldedField, withFolded } from "./searchText.ts";

/**
 * Settings des Meili-Index `ehedaten` (Eheeinträge der Ehedatenbank, ehedaten.ts). Rein
 * lexikalisch: Namen und frühneuhochdeutsche Zusatzinfos taugen nicht für Vektoren.
 *
 * Gesucht wird in Namen, Herkunft, Zusatzinfo (Originalschreibung, Beruf, Bemerkungen),
 * Kirchgemeinde und Signatur, dazu in deren gefalteten Suchfeldern (ß als ss, searchText.ts);
 * «nur im Titel» der Suchseite beschränkt auf Namen und Herkunft (wie der Titel im
 * Online-Katalog). Namensfilter mit Rolle laufen über die Namenswörter
 * (`mannTok`/`frauTok`) bzw. die Personenschlüssel, der Ortsfilter über `herkunftKeys`;
 * Schlüssel und Wörter sind nur Filter, nicht angezeigt. Zeitleiste und Zeitraum wie im
 * Index `catalog` über die Jahre `dateFrom`/`dateTo` (Zählung nach Berührung), sortiert wird
 * nach `sortDate` (JJJJMMTT). Läuft auf Hetzner ohne Imports aus apps/web (import.ts).
 */
// Typo-Settings mit `disableOnNumbers` (Meili ≥ v1.15) – meilisearch-js 0.45 kennt das Feld
// noch nicht, darum als eigene Konstante (keine Prüfung überzähliger Felder).
const EHEDATEN_TYPO: NonNullable<Settings["typoTolerance"]> & { disableOnNumbers: boolean } = { minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 }, disableOnAttributes: ["signatur"], disableOnNumbers: true };

export const EHEDATEN_INDEX_SETTINGS: Settings = {
  searchableAttributes: withFolded(
    ["mannName", "frauName", "mannHerkunft", "frauHerkunft", "mannZusatz", "frauZusatz", "kirchgemeinde", "signatur"],
    EHEDATEN_FOLDED_FIELDS,
  ),
  filterableAttributes: [
    "id",
    "dateFrom",
    "dateTo",
    "kirchgemeinde",
    "quelle",
    "art",
    "band",
    "herkunft",
    "raum",
    "persons",
    "personKeys",
    "mannKey",
    "frauKey",
    "mannTok",
    "frauTok",
    "herkunftKeys",
  ],
  sortableAttributes: ["sortDate", "dateFrom", "dateTo"],
  displayedAttributes: [
    "id",
    "signatur",
    "band",
    "eintrag",
    "quelle",
    "seite",
    "kirchgemeinde",
    "art",
    "datum",
    "isoVon",
    "isoBis",
    "dateFrom",
    "dateTo",
    "titel",
    "mannNachname",
    "mannVorname",
    "mannName",
    "mannHerkunft",
    "mannOrt",
    "mannZusatz",
    "mannHls",
    "mannGnd",
    "frauNachname",
    "frauVorname",
    "frauName",
    "frauHerkunft",
    "frauOrt",
    "frauZusatz",
    "frauHls",
    "frauGnd",
    "herkunft",
    "raum",
    "persons",
    "unsicher",
    // Nur für Meilis Formatierung (searchText.ts), die Web-App zeigt das Original.
    ...EHEDATEN_FORMATTED_FIELDS.map(foldedField),
  ],
  // Wie `documents` und `catalog`: Datums-Sort direkt nach `words`, `exactness` vor
  // `proximity` (genau so geschriebene Wörter vor Wortanfang-Treffern, seit 2026-11-17).
  rankingRules: ["words", "sort", "typo", "exactness", "proximity", "attribute"],
  // 157 Kirchgemeinden, 367 Bände, 277 Jahre; Herkunft und Namen über die Facettensuche.
  faceting: { maxValuesPerFacet: 1000, sortFacetValuesBy: { "*": "count" } },
  pagination: { maxTotalHits: 400_000 },
  // Meilis Default (1500 ms) bricht langsame Suchen still ab (CLAUDE.md, Meili-Eigenheiten).
  searchCutoffMs: 10_000,
  // disableOnNumbers (ab Meili v1.15): Zahlen ohne Tippfehler – «11234» traf «11235». Erst
  // nach dem Upgrade auf v1.57 setzbar (v1.13 lehnt das Feld ab); der Import legt die Settings
  // vor den Dokumenten an (meilisearch#6736 betrifft nur das Einschalten auf vollem Index).
  typoTolerance: EHEDATEN_TYPO,
};
