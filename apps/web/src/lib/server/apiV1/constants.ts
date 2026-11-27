// Öffentlicher API-Vertrag /api/v1 – alle Deckel, Enums und Texte, die sowohl
// die Validierung (params.ts) als auch die OpenAPI-Spec (openapi.ts) brauchen.
// Single Source of Truth: Spec und Validator können nicht auseinanderdriften.
//
// Bewusst ohne $env- und $lib-Imports (nur relative), damit die reinen Module
// (params/respond/rateLimit) via `npx tsx --test` ohne SvelteKit laufen.

import { CATALOG_COMPLETE_BY, CATALOG_IN_PROGRESS } from "../../catalog";
import { EHEDATEN_DATASET_URL, EHEDATEN_SOURCE, EHEDATEN_YEAR_MAX, EHEDATEN_YEAR_MIN } from "../../ehedaten";
import { SITE_HOST, SITE_URL } from "../../site";
import { CORPUS_YEAR_MIN } from "../../types";

// 1.1.0: Namensfilter person/place/organization (Form oder Vergleichsschlüssel) neben
// den exakten persons/places/organizations – additiv, die Mehrzahl bleibt exakt.
export const API_V1_VERSION = "1.1.0";

// Paginierung: limit pro Seite, WINDOW_MAX = hartes Blätter-Fenster pro
// Abfrage (offset + limit). Die API ist für gezielte Abfragen gedacht –
// Bulk-Nutzung läuft über die publizierten Dumps (siehe Doku #bulk-daten).
export const LIMIT_DEFAULT = 20;
export const LIMIT_MAX = 100;
export const WINDOW_MAX = 1000;

export const SIMILAR_LIMIT_DEFAULT = 10;
export const SIMILAR_LIMIT_MAX = 50;

export const FACET_LIMIT_DEFAULT = 20;
export const FACET_LIMIT_MAX = 50;

// Facetten-Dimensionen für /facets/{dim} – identisch zur internen
// facetSearch-Whitelist (numerisch via searchFacetValues, strings via
// searchStringFacetValues).
export const NUMERIC_FACET_DIMS = ["volumeNr", "startPg", "years"] as const;
export const STRING_FACET_DIMS = [
	"persons",
	"places",
	"organizations",
	"resolutionId",
	"serialNr",
] as const;
export type NumericFacetDim = (typeof NUMERIC_FACET_DIMS)[number];
export type StringFacetDim = (typeof STRING_FACET_DIMS)[number];
export type FacetDim = NumericFacetDim | StringFacetDim;
export const ALL_FACET_DIMS: FacetDim[] = [...NUMERIC_FACET_DIMS, ...STRING_FACET_DIMS];

// `facets=`-Toggle der Suche: welche Verteilungen die Response mitliefern darf.
export const RESPONSE_FACETS = ["series", "dateYear"] as const;
export type ResponseFacet = (typeof RESPONSE_FACETS)[number];

// Jahres-Plausibilität (gleiche Schranken wie der interne Parser): ab 1483,
// dem Jahr der frühesten Ratsmanual-Sitzungen (CORPUS_YEAR_MIN).
export const YEAR_MIN = CORPUS_YEAR_MIN;
export const YEAR_MAX = 2100;

export const TOPK_MIN = 1;
export const TOPK_MAX = 1000;

// Namensfilter der Suche: Mehrzahl = exakte Namensform (Vertrag von 1.0, ohne Deckel),
// Einzahl = Form oder Vergleichsschlüssel (seit 1.1, Namen wie bei /catalog und
// /editions), in einer Anfrage nicht gemischt. Deckel nur für die Einzahl: höchstens so
// viele Werte je Parameter (wie /catalog und /editions), je höchstens so viele Zeichen.
export const ENTITY_PARAMS = [
	{ dim: "persons", singular: "person" },
	{ dim: "places", singular: "place" },
	{ dim: "organizations", singular: "organization" },
] as const;
export const ENTITY_VALUES_MAX = 20;
export const ENTITY_VALUE_LENGTH_MAX = 200;
// meta.warnings, solange der documents-Index die Schlüssel nicht trägt (entityKeysReady):
// dann filtert auch die Einzahl nur die Form.
export const ENTITY_KEYS_PENDING_WARNING =
	"person/place/organization matched the exact name form only: the comparison keys for spelling " +
	"variants are not available in the index yet.";

// Hinweis auf die Komplettbezüge in Fehlertexten und OpenAPI.
export const BULK_DATA_URL = `${SITE_URL}/about/api#bulk-daten`;

// Daten-Kennzeichnung (konsistent mit dem Site-Footer); auch vom ZIP-Export
// (package-Endpoint) importiert, damit die Angaben nicht driften.
// Amtliche Erlasse, Entscheidungen und Protokolle von Behörden sind nach
// Art. 5 URG urheberrechtlich nicht geschützt ⇒ es gibt nichts zu lizenzieren.
// Darum keine CC-Lizenz und kein CC0-Verzicht (den könnte nur ein
// Rechteinhaber erklären), sondern die Public Domain Mark als Kennzeichnung.
// Feldnamen `license`/`licenseUrl` bleiben aus Kompatibilität bestehen.
export const LICENSE =
	"Public Domain Mark 1.0 – urheberrechtlich nicht geschützt (amtliche Erlasse, Entscheidungen und Protokolle, Art. 5 URG)";
export const LICENSE_URL = "https://creativecommons.org/publicdomain/mark/1.0/deed.de";
// Herkunftsangabe – erbeten, keine Bedingung. Quelle (Staatsarchiv für den
// digitalisierten Altbestand, Kanton für die Spätbestände) und Plattform
// getrennt: die Plattform ist ein inoffizieller, privat betriebener Prototyp, kein Angebot des
// Staatsarchivs. Die Quelle pro Dokument liefert documentSource() (format.ts).
// Ohne «Quelle:»-Präfix – Konsumenten setzen ihr eigenes Label davor (IIIF-
// requiredStatement «Quelle», Export-README «Quellenangabe»).
export const ATTRIBUTION =
	"Staatsarchiv des Kantons Zürich bzw. Kanton Zürich (Open Government Data); " +
	`Plattform: ${SITE_HOST} (Tim Rüdiger)`;

// Archivkatalog (/api/v1/catalog): Verzeichnungseinheiten aus dem Online-
// Archivkatalog des Staatsarchivs. Bewusst KEINE Lizenzangabe (Entscheid
// 2026-10-28): die Katalogbeschreibungen verfasst das Staatsarchiv, es sind
// keine amtlichen Erlasse – darum der Nachweis mit Signatur und Permalink
// statt der Public Domain Mark (wie bei den Z-1114-Porträts).
export const CATALOG_SOURCE = "Staatsarchiv des Kantons Zürich, Online-Archivkatalog";
export const CATALOG_SOURCE_URL = "https://suche.staatsarchiv.djiktzh.ch";
export const CATALOG_NOTE =
	"Verzeichnungseinheiten aus dem Online-Archivkatalog des Staatsarchivs, ohne die Einheiten, " +
	"die die Plattform selbst als Dokumente führt. Zitieren mit Signatur und Permalink (url); " +
	"Die Plattform macht zu diesen Metadaten keine Lizenzangabe." +
	(CATALOG_IN_PROGRESS
		? ` Der Katalog wird noch übernommen (bis ${CATALOG_COMPLETE_BY}); bis dahin fehlen Einheiten.`
		: "");
// `facets=`-Toggle der Katalogsuche.
export const CATALOG_RESPONSE_FACETS = ["level", "bestand", "digital"] as const;
/** Höchstens so viele Werte je Katalog-Facette (wie bis 2026-10 `maxValuesPerFacet`). */
export const CATALOG_FACET_VALUES_MAX = 500;
export type CatalogResponseFacet = (typeof CATALOG_RESPONSE_FACETS)[number];

// Ehedaten (/api/v1/ehedaten): Eheeinträge der Ehedatenbank des Staatsarchivs. Anders als
// die amtlichen Serien (Public Domain Mark) steht der Datensatz unter CC BY 4.0 – die
// Antworten tragen Lizenz und Nennung aus $lib/ehedaten (okEhedaten in respond.ts).
export const EHEDATEN_NOTE =
	`Eheeinträge aus den Zürcher Kirchenbüchern ${EHEDATEN_YEAR_MIN}–${EHEDATEN_YEAR_MAX} (Ehedatenbank des Staatsarchivs), ` +
	`übernommen aus dem ${EHEDATEN_SOURCE} (source); veröffentlicht auch als Datensatz auf Zenodo (${EHEDATEN_DATASET_URL}). ` +
	"Namen sind vereinheitlicht (Originalschreibung in note), Daten bis 1700 stehen im alten Stil (julianisch, " +
	"nicht umgerechnet). Ein Eintrag ist eine Trauung oder eine Verkündung (type); Zählungen zählen Einträge, nicht Ehen. " +
	"sameMarriage nennt die übrigen Einträge derselben Ehe aus der geprüften Liste der Mehrfacheinträge des Staatsarchivs " +
	"(Repository stazh/sw-ehedaten); sie erfasst nur einen Teil der Ehen, die in zwei Kirchenbüchern stehen. " +
	"Bei Weitergabe die Nennung (attribution) und die Lizenz angeben.";
// `facets=`-Toggle der Ehedaten (Zählungen der ganzen Treffermenge).
export const EHEDATEN_RESPONSE_FACETS = ["kirchgemeinde", "raum", "quelle", "art", "jahr", "jahrzehnt"] as const;
export type EhedatenResponseFacet = (typeof EHEDATEN_RESPONSE_FACETS)[number];

// Editionen (/api/v1/editions): Stücke der Editionen des Staatsarchivs (Quellen zur Zürcher
// Geschichte, Zürcher Rechtsquellen). Jede Edition hat ihre eigene Lizenz (beide CC BY 4.0) – sie
// steht an jedem Stück (license, attribution), nicht im Envelope (okEditions in respond.ts).
export const EDITIONS_NOTE =
	"Stücke der Editionen des Staatsarchivs: Abschriften mit Regest, Kommentar und Anmerkungen der Bearbeitung. " +
	"Lizenz und Nennung stehen an jedem Stück (license, attribution) und gelten für die Editionsdaten; " +
	"die Abbildungen haben eigene Rechte (imagesLicense). text ist die Lesefassung wie in der Suche " +
	"(Abkürzungen aufgelöst, Zeichen angeglichen: ů → u, ß → ss), html der Text der Edition mit Seiten- und Zeilenwechseln. " +
	"Daten stehen wie in der Quelle (in Zürich bis 1700 alter Stil, nicht umgerechnet; calendar=julian, wo die Edition es angibt). " +
	"Rechtsquellen: ein Stück je Nummer eines Bandes (label «SSRQ ZH NF II/3 Nr. 47»), weitere Überlieferungen nur beschrieben (witnesses).";
// `facets=`-Toggle der Editionen (Zählungen der ganzen Treffermenge).
export const EDITIONS_RESPONSE_FACETS = ["edition", "part", "keyword", "facsimile"] as const;
export type EditionsResponseFacet = (typeof EDITIONS_RESPONSE_FACETS)[number];

export const DOCS_PATH = "/about/api";
export const BULK_DOCS_FRAGMENT = "#bulk-daten";

// Rate-Limit-Defaults (überschreibbar via API_V1_RATE_LIMIT /
// API_V1_RATE_WINDOW_S, siehe config.ts).
export const RATE_LIMIT_DEFAULT = 60;
export const RATE_WINDOW_S_DEFAULT = 60;

// Eigenes Kontingent des MCP-Servers (/api/mcp, überschreibbar via MCP_RATE_LIMIT /
// MCP_RATE_WINDOW_S): gezählt wird jede JSON-RPC-Nachricht, je anonymisiertem Netz
// (IPv4 /24). Höher als /api/v1, weil Claude.ai und ChatGPT ihre Werkzeug-Aufrufe von
// den Servern der Anbieter schicken – alle ihre Nutzer teilen sich wenige Netze, und
// eine gründliche Recherche braucht 10–30 Aufrufe.
export const MCP_RATE_LIMIT_DEFAULT = 300;
export const MCP_RATE_WINDOW_S_DEFAULT = 60;

export type ApiErrorCode =
	| "invalid_parameter"
	| "pagination_window_exceeded"
	| "not_found"
	| "method_not_allowed"
	| "rate_limited"
	| "service_unavailable"
	| "internal_error";
