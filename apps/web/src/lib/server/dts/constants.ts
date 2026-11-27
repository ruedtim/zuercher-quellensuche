// DTS-API-Vertrag (Distributed Text Services, Spec v1.0) – alle Konstanten,
// Enums und Texte, die Param-Parser, Serializer und Tests gemeinsam brauchen.
// Single Source of Truth, damit Implementierung und Tests nicht driften.
//
// Bewusst ohne $env-/$lib-Imports (nur relative), damit die reinen Module
// (params/serialize/ids) via `npx tsx --test` ohne SvelteKit laufen – exakt
// die Trennung wie bei apiV1/constants.ts.
//
// Spec: https://dtsapi.org/specifications/versions/v1.0/

import { SITE_HOST } from "../../site";

export const DTS_VERSION = "1.0";

// Kanonischer JSON-LD-Kontext der DTS-Spec (extern, wird nur referenziert).
export const DTS_CONTEXT_URL = "https://dtsapi.org/context/v1.0.json";

// Default-Medientyp des Document-Endpoints (Spec: TEI/XML ist Pflicht-Minimum).
export const TEI_MEDIA_TYPE = "application/tei+xml";

// Vom Document-Endpoint zusätzlich angebotene Formate (best effort – TEI bleibt
// der konforme Default). text/html = vorgerendertes Fragment, text/plain = Body.
export const SUPPORTED_MEDIA_TYPES = [TEI_MEDIA_TYPE, "text/html", "text/plain"] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

// Root-Collection (das Gesamtkorpus). `corpus` ist der stabile Identifier; ein
// fehlender `id`-Parameter ist gleichbedeutend mit der Root.
export const ROOT_COLLECTION_ID = "corpus";
export const ROOT_COLLECTION_TITLE = "Zentrale Serien des Kantons Zürich";
export const ROOT_COLLECTION_DESCRIPTION =
	"Korpus der zentralen Serien des Kantons Zürich (Amtsblatt, Kantonsrats" +
	"protokolle, Gesetzessammlung, Regierungsratsbeschlüsse): vom Staatsarchiv " +
	"des Kantons Zürich digitalisierte Altbestände sowie born-digital " +
	"Spätbestände aus Open Data des Kantons; dazu die Ratsmanuale der Stadt " +
	"und Republik Zürich 1484–1798 (maschinelle Transkription des " +
	`Staatsarchivs). Bereitgestellt von ${SITE_HOST} (Tim Rüdiger, ` +
	"inoffizieller Prototyp).";

// Projektion der Dokument-Member einer Jahres-Collection. `subset` ist Pflicht:
// dublinCoreOf leitet daraus den Publisher ab (documentSource) – fehlt es,
// erschienen Spätbestände stillschweigend als Staatsarchiv-Dokumente.
export const COLLECTION_MEMBER_FIELDS = [
	"id",
	"series",
	"title",
	"date",
	"dateYear",
	"stazhIdent",
	"subset",
] as const;

// Hierarchie Korpus → Serie → Jahr → Dokument; der einzige citeType der
// (flachen) Zitierstruktur eines Dokuments.
export const CITE_TYPE_DOCUMENT = "document";

// Paginierung der Dokument-Member einer Jahres-Collection (Hydra-view). Serien
// (5) und Jahre (je Serie ≤ ~250) passen je in eine Seite und werden nicht
// paginiert.
export const COLLECTION_PAGE_SIZE = 100;

// nav-Parameter des Collection-Endpoints.
export const NAV_CHILDREN = "children";
export const NAV_PARENTS = "parents";
export const NAV_VALUES = [NAV_CHILDREN, NAV_PARENTS] as const;
export type NavValue = (typeof NAV_VALUES)[number];

export type DtsErrorCode =
	| "invalid_parameter"
	| "not_found"
	| "method_not_allowed"
	| "unsupported_media_type"
	| "upstream_unavailable"
	| "internal_error";
