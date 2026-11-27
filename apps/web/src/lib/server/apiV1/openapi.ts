// OpenAPI-3.1-Spec für /api/v1 – handgeschrieben, aber alle Deckel/Enums aus
// constants.ts bzw. types.ts importiert: Spec und Validierung können nicht
// auseinanderdriften. Ausgeliefert via GET /api/v1/openapi.json, interaktiv
// gerendert auf /api-doc (self-hosted Swagger UI).

import { ALL_SERIES } from "../../types";
import { CONTACT_EMAIL } from "../../contact";
import { SITE_DISCLAIMER, SITE_HOST, SITE_NAME, SITE_SUBTITLE, SITE_URL } from "../../site";
import { CATALOG_YEAR_MAX, CATALOG_YEAR_MIN } from "../../catalog";
import { EDITIONS } from "../../editions";
import { INDEXED_EDITIONS } from "../../editionTexts";
import {
	EHEDATEN_AS_OF,
	EHEDATEN_ATTRIBUTION,
	EHEDATEN_LICENSE,
	EHEDATEN_LICENSE_URL,
	EHEDATEN_QUELLEN,
	EHEDATEN_RAEUME,
	EHEDATEN_SOURCE,
	EHEDATEN_SOURCE_URL,
	EHEDATEN_YEAR_MAX,
	EHEDATEN_YEAR_MIN,
	STADT_ZUERICH,
	STADT_ZUERICH_KIRCHGEMEINDEN,
} from "../../ehedaten";
import {
	ALL_FACET_DIMS,
	API_V1_VERSION,
	ATTRIBUTION,
	CATALOG_NOTE,
	CATALOG_RESPONSE_FACETS,
	CATALOG_SOURCE,
	CATALOG_SOURCE_URL,
	EDITIONS_NOTE,
	EDITIONS_RESPONSE_FACETS,
	EHEDATEN_NOTE,
	EHEDATEN_RESPONSE_FACETS,
	ENTITY_VALUE_LENGTH_MAX,
	ENTITY_VALUES_MAX,
	FACET_LIMIT_DEFAULT,
	FACET_LIMIT_MAX,
	LICENSE,
	LICENSE_URL,
	LIMIT_DEFAULT,
	LIMIT_MAX,
	RESPONSE_FACETS,
	SIMILAR_LIMIT_DEFAULT,
	SIMILAR_LIMIT_MAX,
	TOPK_MAX,
	TOPK_MIN,
	WINDOW_MAX,
	YEAR_MAX,
	YEAR_MIN,
} from "./constants";

const errorResponse = (description: string) => ({
	description,
	content: {
		"application/json": {
			schema: { $ref: "#/components/schemas/Error" },
		},
	},
});

// Gemeinsame Filter-Parameter der Suche (auch von /facets/{dim} akzeptiert).
const filterParams = [
	{
		name: "q",
		in: "query",
		description:
			"Suchbegriff (lexikalische Volltextsuche über Titel und Text). Meili-Syntax wird unterstützt: \"…\" für exakte Phrasen, -wort zum Ausschliessen.",
		schema: { type: "string" },
	},
	{
		name: "theme",
		in: "query",
		description:
			"Thema (semantisch, Vektor-Ähnlichkeit, Embedding-basiert): bei sort=relevance ein reines Ranking der Treffermenge (alle Filter- bzw. q-Treffer, kein Schnitt). Bei Datums-Sortierung ein Schnitt auf die topK thematisch ähnlichsten Dokumente (mit q innerhalb von dessen Treffern), die chronologisch sortiert werden. Ist der Embedding-Dienst nicht verfügbar, wird theme ignoriert und in meta.warnings ausgewiesen. Die Ratsmanuale (RM) haben keine Vektoren: das Thema reiht sie nicht, sie erscheinen nur über den Stichwort-Anteil.",
		schema: { type: "string" },
	},
	{
		name: "series",
		in: "query",
		description: `Serien-Filter, kommasepariert. Erlaubte Werte: ${ALL_SERIES.join(", ")}.`,
		schema: { type: "string" },
		example: "RRB,KRP",
	},
	{
		name: "dateFrom",
		in: "query",
		description: "Jahr (inklusive), ab dem gesucht wird.",
		schema: { type: "integer", minimum: YEAR_MIN, maximum: YEAR_MAX },
	},
	{
		name: "dateTo",
		in: "query",
		description: "Jahr (inklusive), bis zu dem gesucht wird.",
		schema: { type: "integer", minimum: YEAR_MIN, maximum: YEAR_MAX },
	},
	{
		name: "topK",
		in: "query",
		description: `Umfang des Thema-Schnitts: wie viele thematisch ähnlichste Dokumente bei Datums-Sortierung das sortierte Set bilden (nur wirksam mit theme und sort=date_*; Default 100; bei sort=relevance wirkungslos – dort rankt das Thema ohne Schnitt).`,
		schema: { type: "integer", minimum: TOPK_MIN, maximum: TOPK_MAX },
	},
	{
		name: "volumeNr",
		in: "query",
		description: "Bandnummern, kommasepariert: OS-Band bzw. bei den Ratsmanualen (RM) die Nummer in StAZH B II.",
		schema: { type: "string" },
		example: "40,41",
	},
	{
		name: "startPg",
		in: "query",
		description: "Startseiten (OS/ABl), kommasepariert; bei den Ratsmanualen (RM) die laufende Nummer der Sitzung im Band.",
		schema: { type: "string" },
	},
	{
		name: "serialNr",
		in: "query",
		description: "Ordnungsnummern der Loseblattsammlung (OS), kommasepariert.",
		schema: { type: "string" },
		example: "632.31",
	},
	{
		name: "resolutionId",
		in: "query",
		description: "Beschlussnummern (RRB) im Format JJJJ/NNNN, kommasepariert.",
		schema: { type: "string" },
		example: "1803/0003",
	},
	{
		name: "years",
		in: "query",
		description: "Einzelne Jahrgänge, kommasepariert.",
		schema: { type: "string" },
		example: "1900,1901",
	},
	{
		name: "persons",
		in: "query",
		description:
			"Personen-Filter auf die exakte Namensform (wie in /facets/persons). Wiederholbar: ?persons=A&persons=B (Werte können Kommas enthalten). Mehrere Werte = ODER. Schreibvarianten trifft person; nicht mit person/place/organization kombinierbar.",
		schema: { type: "array", items: { type: "string" } },
		style: "form",
		explode: true,
	},
	{
		name: "places",
		in: "query",
		description: "Orts-Filter auf die exakte Namensform, wiederholbar wie persons. Schreibvarianten trifft place.",
		schema: { type: "array", items: { type: "string" } },
		style: "form",
		explode: true,
	},
	{
		name: "organizations",
		in: "query",
		description:
			"Organisations-Filter auf die exakte Namensform, wiederholbar wie persons. Schreibvarianten trifft organization.",
		schema: { type: "array", items: { type: "string" } },
		style: "form",
		explode: true,
	},
	// Seit 1.1: Form oder Vergleichsschlüssel (entityKey.ts, Fassung 2), wie die Suchseite.
	{
		name: "person",
		in: "query",
		description:
			"Personen-Filter über die Schreibung hinweg (seit 1.1), wie die Suche der Website: die Namensform oder " +
			"derselbe Vergleichsschlüssel. Gleich sind Formen, die sich nur in Gross-/Kleinschreibung, Umlauten und " +
			"Diakritika, gängigen Schreibvarianten (c/k, ph/f, th/t, y/i, ae/oe/ue, doppelte Konsonanten), einer " +
			"Anrede oder einem Titel davor oder der Reihenfolge «Nachname, Vorname» unterscheiden: «Escher, Alfred» " +
			"trifft auch «Alfred Escher» und «Dr. Alfred Escher», gleichnamige Personen ebenso. Ein Nachname allein " +
			`wirkt exakt. Wiederholbar (höchstens ${ENTITY_VALUES_MAX} Werte à ${ENTITY_VALUE_LENGTH_MAX} Zeichen), ` +
			"mehrere Werte = ODER, mit place/organization = UND. Nicht mit persons/places/organizations kombinierbar " +
			"(400). Solange der Index die Schlüssel nicht trägt, wirkt der Filter exakt (Hinweis in meta.warnings).",
		schema: {
			type: "array",
			items: { type: "string", maxLength: ENTITY_VALUE_LENGTH_MAX },
			maxItems: ENTITY_VALUES_MAX,
		},
		style: "form",
		explode: true,
	},
	{
		name: "place",
		in: "query",
		description:
			"Orts-Filter über die Schreibung hinweg wie person (seit 1.1): «Fischental» trifft auch «Fischenthal», " +
			"«Wädensweil» auch «Wädenswil», «Stadt Zürich» auch «Zürich». Kanton, Bezirk und Amt bleiben Teil des " +
			"Namens («Kanton Zürich» ist nicht «Zürich»), vom Kantonskürzel fällt nur ZH weg («Pfäffikon ZH» = " +
			"«Pfäffikon», «Pfäffikon SZ» nicht). Wiederholbar wie person.",
		schema: {
			type: "array",
			items: { type: "string", maxLength: ENTITY_VALUE_LENGTH_MAX },
			maxItems: ENTITY_VALUES_MAX,
		},
		style: "form",
		explode: true,
	},
	{
		name: "organization",
		in: "query",
		description:
			"Organisations-Filter über die Schreibung hinweg wie person (seit 1.1): «Escher Wyss & Cie.» trifft auch " +
			"«Escher, Wyss & Co.». Wiederholbar wie person.",
		schema: {
			type: "array",
			items: { type: "string", maxLength: ENTITY_VALUE_LENGTH_MAX },
			maxItems: ENTITY_VALUES_MAX,
		},
		style: "form",
		explode: true,
	},
];

export const openApiDocument: Record<string, unknown> = {
	openapi: "3.1.0",
	info: {
		title: `${SITE_NAME} – API`,
		version: API_V1_VERSION,
		description:
			`Öffentliche Lese-API für die zentralen seriellen Quellen des Kantons Zürich: ` +
			`Offizielle Gesetzessammlung (OS), Kantonsratsprotokolle (KRP) und Regierungsratsbeschlüsse (RRB) seit 1803, ` +
			`Amtsblatt (ABl) in den bisher digitalisierten Jahrgängen – rund 620'000 Dokumente, durchsuchbar lexikalisch und thematisch – ` +
			`sowie die Ratsmanuale (RM) der Stadt und Republik Zürich 1484–1798: maschinell transkribierte ` +
			`Sitzungsprotokolle, nur lexikalisch durchsuchbar (keine Vektoren); body ist dort die Lesefassung, ` +
			`die diplomatische Fassung steht in der TEI-Quelle (links.xml, DTS).\n\n` +
			`Grundsätze: nur lesend, JSON/UTF-8, keine Authentifizierung, CORS offen, ` +
			`Rate-Limit pro Client. Die API ist für gezielte Abfragen gedacht – ` +
			`Komplettbezüge laufen über die publizierten Open-Data-Dumps ` +
			`(siehe ${SITE_URL}/about/api#bulk-daten). ` +
			`Ausformulierte Antworten mit Quellenangaben erzeugen KI-Assistenten über den MCP-Server (/api/mcp).\n\n` +
			`${SITE_NAME} – ${SITE_SUBTITLE}. ${SITE_DISCLAIMER} Quellen: digitalisierte ` +
			`Altbestände des Staatsarchivs, Spätbestände aus Open Data des Kantons (Kantonsrat, Regierungsrat, ZH-Lex).`,
		license: {
			name: "Public Domain Mark 1.0 (Texte und Metadaten, Art. 5 URG)",
			url: LICENSE_URL,
		},
		contact: {
			name: `Tim Rüdiger (${SITE_HOST})`,
			email: CONTACT_EMAIL,
			url: `${SITE_URL}/impressum`,
		},
	},
	servers: [{ url: `${SITE_URL}/api/v1` }],
	paths: {
		"/": {
			get: {
				summary: "API-Index",
				description: "Einstiegspunkt: Links auf alle Endpunkte, Doku, OpenAPI-Spec und Dumps.",
				operationId: "getIndex",
				responses: {
					"200": { description: "Index mit Links und Grundsätzen." },
					"429": errorResponse("Rate-Limit überschritten."),
				},
			},
		},
		"/documents": {
			get: {
				summary: "Dokumente suchen",
				description:
					`Volltextsuche mit Filtern, Sortierung und Paginierung. Treffer enthalten Metadaten und ` +
					`einen Text-Auszug (excerpt), nie den Volltext – den liefert /documents/{id}. ` +
					`Blätter-Fenster: offset + limit ≤ ${WINDOW_MAX} pro Abfrage.`,
				operationId: "searchDocuments",
				parameters: [
					...filterParams,
					{
						name: "sort",
						in: "query",
						description: "Sortierung der Treffer.",
						schema: {
							type: "string",
							enum: ["relevance", "date_asc", "date_desc"],
							default: "relevance",
						},
					},
					{
						name: "facets",
						in: "query",
						description: `Facetten-Verteilungen mitliefern, kommasepariert. Erlaubt: ${RESPONSE_FACETS.join(", ")}.`,
						schema: { type: "string" },
						example: "series,dateYear",
					},
					{
						name: "offset",
						in: "query",
						description: `Start-Offset (0-basiert). offset + limit ≤ ${WINDOW_MAX}.`,
						schema: { type: "integer", minimum: 0, maximum: WINDOW_MAX - 1, default: 0 },
					},
					{
						name: "limit",
						in: "query",
						description: "Treffer pro Antwort.",
						schema: { type: "integer", minimum: 1, maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
					},
				],
				responses: {
					"200": {
						description: "Trefferliste mit Envelope (data/meta/links).",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: {
											type: "array",
											items: { $ref: "#/components/schemas/DocumentListItem" },
										},
										meta: { $ref: "#/components/schemas/Meta" },
										links: { $ref: "#/components/schemas/PaginationLinks" },
									},
								},
							},
						},
					},
					"400": errorResponse(
						"Ungültiger Parameter oder Blätter-Fenster überschritten (für Bulk-Bezug die Dumps nutzen).",
					),
					"429": errorResponse("Rate-Limit überschritten."),
				},
			},
		},
		"/documents/{id}": {
			get: {
				summary: "Einzeldokument mit Volltext",
				operationId: "getDocument",
				parameters: [
					{
						name: "id",
						in: "path",
						required: true,
						description: "Dokument-ID, z. B. aus einem Suchtreffer.",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Dokument mit Metadaten, Volltext (body) und Link-Bündel.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { $ref: "#/components/schemas/Document" },
										meta: { $ref: "#/components/schemas/Meta" },
									},
								},
							},
						},
					},
					"404": errorResponse("Unbekannte Dokument-ID."),
					"429": errorResponse("Rate-Limit überschritten."),
				},
			},
		},
		"/documents/{id}/similar": {
			get: {
				summary: "Thematisch ähnliche Dokumente",
				description:
					"Embedding-basierte Ähnlichkeitssuche. Ist der Embedding-Dienst nicht verfügbar – oder gehört das Dokument zu den Ratsmanualen (RM, ohne Vektoren) –, kommt eine leere Liste mit meta.warnings.",
				operationId: "getSimilarDocuments",
				parameters: [
					{ name: "id", in: "path", required: true, schema: { type: "string" } },
					{
						name: "limit",
						in: "query",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: SIMILAR_LIMIT_MAX,
							default: SIMILAR_LIMIT_DEFAULT,
						},
					},
				],
				responses: {
					"200": {
						description: "Liste ähnlicher Dokumente (DocumentListItem).",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: {
											type: "array",
											items: { $ref: "#/components/schemas/DocumentListItem" },
										},
										meta: { $ref: "#/components/schemas/Meta" },
									},
								},
							},
						},
					},
					"404": errorResponse("Unbekannte Dokument-ID."),
					"429": errorResponse("Rate-Limit überschritten."),
				},
			},
		},
		"/series": {
			get: {
				summary: "Die Serien",
				description: "Serien mit Beschreibung, Dokument-Anzahl, Jahres-Spanne und Teilbeständen.",
				operationId: "getSeries",
				responses: {
					"200": {
						description: "Serien-Liste.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: {
											type: "array",
											items: { $ref: "#/components/schemas/Series" },
										},
										meta: { $ref: "#/components/schemas/Meta" },
									},
								},
							},
						},
					},
					"429": errorResponse("Rate-Limit überschritten."),
				},
			},
		},
		"/facets/{dim}": {
			get: {
				summary: "Facetten-Werte",
				description:
					`Wertelisten mit Treffer-Counts für eine Facetten-Dimension, optional eingeschränkt per fq ` +
					`(Präfix bei Identifikatoren, Fuzzy bei Entitäten) und denselben Filtern wie die Suche ` +
					`(theme wird hier ignoriert). Bei persons, places und organizations sind die Werte Namensformen: ` +
					`person/place/organization filtern über den Vergleichsschlüssel, fassen die Werte aber nicht zusammen. ` +
					`Erlaubte Dimensionen: ${ALL_FACET_DIMS.join(", ")}.`,
				operationId: "getFacetValues",
				parameters: [
					{
						name: "dim",
						in: "path",
						required: true,
						schema: { type: "string", enum: ALL_FACET_DIMS },
					},
					{
						name: "fq",
						in: "query",
						description: "Werte-Query innerhalb der Dimension (Präfix bzw. Fuzzy-Suche).",
						schema: { type: "string" },
					},
					{
						name: "limit",
						in: "query",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: FACET_LIMIT_MAX,
							default: FACET_LIMIT_DEFAULT,
						},
					},
					...filterParams,
				],
				responses: {
					"200": {
						description: "Facetten-Werte mit Counts.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: {
											type: "array",
											items: { $ref: "#/components/schemas/FacetValue" },
										},
										meta: { $ref: "#/components/schemas/Meta" },
									},
								},
							},
						},
					},
					"400": errorResponse("Unbekannte Dimension oder ungültiger Parameter."),
					"429": errorResponse("Rate-Limit überschritten."),
				},
			},
		},
		"/catalog": {
			get: {
				summary: "Archivkatalog durchsuchen",
				description:
					`Verzeichnungseinheiten aus dem Online-Archivkatalog des Staatsarchivs (Akten, Urkunden, ` +
					`Pläne, Nachlässe, Fotos …), rein lexikalisch in Titel, Signatur, Regest/Inhalt und Provenienz; ` +
					`alle Wörter müssen vorkommen. Ohne die Einheiten, die die Plattform selbst als Dokumente ` +
					`führt (Zentrale Serien samt Ratsmanual-Sitzungen). Treffer mit Auszug, Archivplan-Pfad, ` +
					`Digitalisat-Links und Permalink. Eigene Quelle: keine Lizenzangabe, Nachweis mit Signatur ` +
					`und Permalink (meta.source, meta.note). Blätter-Fenster: offset + limit ≤ ${WINDOW_MAX}.`,
				operationId: "searchCatalog",
				parameters: [
					{
						name: "q",
						in: "query",
						description:
							'Suchbegriff. "…" für eine Wortfolge, -wort schliesst aus; «ß» gilt als «ss». Leer = alle Einheiten, chronologisch.',
						schema: { type: "string" },
					},
					{
						name: "dateFrom",
						in: "query",
						description: "Jahr (inklusive): Einheiten, deren Entstehungszeitraum bis mindestens hierher reicht.",
						schema: { type: "integer", minimum: CATALOG_YEAR_MIN, maximum: CATALOG_YEAR_MAX },
					},
					{
						name: "dateTo",
						in: "query",
						description: "Jahr (inklusive): Einheiten, deren Entstehungszeitraum spätestens hier beginnt.",
						schema: { type: "integer", minimum: CATALOG_YEAR_MIN, maximum: CATALOG_YEAR_MAX },
					},
					{
						name: "level",
						in: "query",
						description: "Stufe (z. B. Dokument, Dossier, Subdossier, Bestand), wiederholbar; mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "bestand",
						in: "query",
						description: "Bestand (Label wie in meta.facets.bestand), wiederholbar; mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "digital",
						in: "query",
						description: "true = nur Einheiten mit Digitalisat im Online-Katalog.",
						schema: { type: "boolean" },
					},
					{
						name: "person",
						in: "query",
						description:
							"Person, an deren Einheiten der Katalog-Aufbau den Namen erkannt hat (Titelschema, Erschliessungsregeln, " +
							"automatische Namenserkennung; wie das Register der Plattform), z. B. «Anna Meier» oder «Meier, Anna». " +
							"Schreibvarianten zählen mit (Meyer/Meier, Carl/Karl), gleichnamige Personen auch. Vor- und Nachname nötig. " +
							"Wiederholbar (höchstens 20); mehrere = ODER, mit place/organization = UND.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "place",
						in: "query",
						description: "Ort, wie person (z. B. «Wädenswil»); wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "organization",
						in: "query",
						description: "Organisation, wie person (z. B. «Escher Wyss AG»); wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "sort",
						in: "query",
						description: "Sortierung; ohne Suchbegriff gilt date_asc.",
						schema: { type: "string", enum: ["relevance", "date_asc", "date_desc"], default: "relevance" },
					},
					{
						name: "facets",
						in: "query",
						description: `Verteilungen mitliefern, kommasepariert. Erlaubt: ${CATALOG_RESPONSE_FACETS.join(", ")}.`,
						schema: { type: "string" },
						example: "level,bestand",
					},
					{
						name: "offset",
						in: "query",
						description: `Start-Offset (0-basiert). offset + limit ≤ ${WINDOW_MAX}.`,
						schema: { type: "integer", minimum: 0, maximum: WINDOW_MAX - 1, default: 0 },
					},
					{
						name: "limit",
						in: "query",
						description: "Treffer pro Antwort.",
						schema: { type: "integer", minimum: 1, maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
					},
				],
				responses: {
					"200": {
						description: "Trefferliste mit Envelope (data/meta/links).",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { type: "array", items: { $ref: "#/components/schemas/CatalogUnit" } },
										meta: { $ref: "#/components/schemas/CatalogMeta" },
										links: { $ref: "#/components/schemas/PaginationLinks" },
									},
								},
							},
						},
					},
					"400": errorResponse("Ungültiger Parameter oder Blätter-Fenster überschritten."),
					"429": errorResponse("Rate-Limit überschritten."),
					"503": errorResponse("Archivkatalog zurzeit nicht verfügbar."),
				},
			},
		},
		"/catalog/{id}": {
			get: {
				summary: "Einzelne Verzeichnungseinheit",
				description:
					"Eine Einheit mit vollem Text (Regest bzw. «Inhalt und Form»). Liefert auch Einheiten, die ein " +
					"Plattform-Dokument abbilden; `document` (relation depicts) verweist dann darauf.",
				operationId: "getCatalogUnit",
				parameters: [
					{
						name: "id",
						in: "path",
						required: true,
						description: "ID im Online-Katalog (wie in detail.aspx?ID=…).",
						schema: { type: "integer", minimum: 1 },
					},
				],
				responses: {
					"200": {
						description: "Verzeichnungseinheit.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { $ref: "#/components/schemas/CatalogUnit" },
										meta: { $ref: "#/components/schemas/CatalogMeta" },
									},
								},
							},
						},
					},
					"400": errorResponse("Ungültige ID."),
					"404": errorResponse("Unbekannte ID."),
					"429": errorResponse("Rate-Limit überschritten."),
					"503": errorResponse("Archivkatalog zurzeit nicht verfügbar."),
				},
			},
		},
		"/ehedaten": {
			get: {
				summary: "Ehedaten durchsuchen",
				description:
					`Eheeinträge aus den Zürcher Kirchenbüchern ${EHEDATEN_YEAR_MIN}–${EHEDATEN_YEAR_MAX} (Ehedatenbank des ` +
					`Staatsarchivs, Einträge aus dem ${EHEDATEN_SOURCE}): je Eintrag Bräutigam und Braut mit Herkunft und Zusatzinfo, ` +
					`Datum, Kirchgemeinde und Signatur. Rein lexikalisch wie der Reiter «Ehedaten» der Suche; alle Filter ` +
					`untereinander UND, mehrere Werte eines Filters ODER. Namen sind vereinheitlicht (Meier auch für Meyer), ` +
					`ein Name trifft, wenn alle seine Wörter im Namen stehen. Daten bis 1700 im alten Stil (julianisch). ` +
					`Eigene Lizenz: ${EHEDATEN_LICENSE}, mit Nennung (meta.license, meta.attribution). ` +
					`Blätter-Fenster: offset + limit ≤ ${WINDOW_MAX}.`,
				operationId: "searchEhedaten",
				parameters: [
					{
						name: "q",
						in: "query",
						description:
							'Volltext über Namen, Herkunft, Zusatzinfo (Originalschreibung, Beruf, Bemerkungen), Kirchgemeinde und Signatur; alle Wörter müssen vorkommen. "…" für eine Wortfolge, -wort schliesst aus; «ß» gilt als «ss». Leer = alle Einträge der Filter, chronologisch.',
						schema: { type: "string" },
					},
					{
						name: "name",
						in: "query",
						description:
							"Name von Bräutigam ODER Braut, z. B. «Heusser» oder «Hans Jakob Heusser»: alle Wörter müssen im Namen stehen, Schreibvarianten zählen mit (Meier/Meyer, Jakob/Jacob). Wiederholbar (höchstens 20); mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "braeutigam",
						in: "query",
						description: "Name des Bräutigams, wie name. Mit braut kombiniert = ein Paar.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "braut",
						in: "query",
						description: "Name der Braut, wie name.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "herkunft",
						in: "query",
						description:
							"Herkunft von Bräutigam oder Braut: Gemeinde (Weiler in Klammern zählen zu ihrer Gemeinde, «Pfäffikon» trifft «Irgenhausen (Pfäffikon)»), Kanton («Thurgau») oder Land («Deutschland»); Schreibvarianten zählen mit. Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "kirchgemeinde",
						in: "query",
						description: `Kirchgemeinde des Eintrags (exakt, wie in meta.facets.kirchgemeinde). «${STADT_ZUERICH}» = die Stadtkirchen (${STADT_ZUERICH_KIRCHGEMEINDEN.join(", ")}). Wiederholbar, mehrere = ODER.`,
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "raum",
						in: "query",
						description:
							"Herkunftsraum mindestens einer Person: zh = Kanton Zürich (auch Angaben ohne Kantonskürzel oder Land), ch = andere Kantone, ausland. Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string", enum: [...EHEDATEN_RAEUME] } },
						style: "form",
						explode: true,
					},
					{
						name: "quelle",
						in: "query",
						description: "Überlieferung: E III = Pfarrbücher im Staatsarchiv, TAI = Bücher anderer Archive. Wiederholbar.",
						schema: { type: "array", items: { type: "string", enum: [...EHEDATEN_QUELLEN] } },
						style: "form",
						explode: true,
					},
					{
						name: "art",
						in: "query",
						description: "Nur Trauungen bzw. nur Verkündungen (Eintrag mit dem Vermerk «Verkünddatum»).",
						schema: { type: "string", enum: ["trauung", "verkuendung"] },
					},
					{
						name: "band",
						in: "query",
						description: "Band, d. h. Signatur ohne «, EDB n» (z. B. «E III 117.1»), exakt. Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "dateFrom",
						in: "query",
						description: "Jahr (inklusive): Einträge, deren Datum bis mindestens hierher reicht.",
						schema: { type: "integer", minimum: EHEDATEN_YEAR_MIN, maximum: EHEDATEN_YEAR_MAX },
					},
					{
						name: "dateTo",
						in: "query",
						description: "Jahr (inklusive): Einträge, deren Datum spätestens hier beginnt.",
						schema: { type: "integer", minimum: EHEDATEN_YEAR_MIN, maximum: EHEDATEN_YEAR_MAX },
					},
					{
						name: "sort",
						in: "query",
						description: "Sortierung; ohne q gilt date_asc.",
						schema: { type: "string", enum: ["relevance", "date_asc", "date_desc"], default: "relevance" },
					},
					{
						name: "facets",
						in: "query",
						description: `Zählungen der ganzen Treffermenge mitliefern, kommasepariert. Erlaubt: ${EHEDATEN_RESPONSE_FACETS.join(", ")} (jahr nach Anfangsjahr). Gezählt werden Einträge, nicht Ehen.`,
						schema: { type: "string" },
						example: "kirchgemeinde,jahrzehnt",
					},
					{
						name: "offset",
						in: "query",
						description: `Start-Offset (0-basiert). offset + limit ≤ ${WINDOW_MAX}.`,
						schema: { type: "integer", minimum: 0, maximum: WINDOW_MAX - 1, default: 0 },
					},
					{
						name: "limit",
						in: "query",
						description: "Treffer pro Antwort.",
						schema: { type: "integer", minimum: 1, maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
					},
				],
				responses: {
					"200": {
						description: "Trefferliste mit Envelope (data/meta/links).",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { type: "array", items: { $ref: "#/components/schemas/EhedatenEntry" } },
										meta: { $ref: "#/components/schemas/EhedatenMeta" },
										links: { $ref: "#/components/schemas/PaginationLinks" },
									},
								},
							},
						},
					},
					"400": errorResponse("Ungültiger Parameter oder Blätter-Fenster überschritten."),
					"429": errorResponse("Rate-Limit überschritten."),
					"503": errorResponse("Ehedaten zurzeit nicht verfügbar."),
				},
			},
		},
		"/ehedaten/{id}": {
			get: {
				summary: "Einzelner Eheeintrag",
				description:
					"Ein Eintrag der Ehedatenbank über seine ID (= ID im Online-Archivkatalog des Staatsarchivs), mit den übrigen Einträgen derselben Ehe aus der geprüften Liste der Mehrfacheinträge (sameMarriage).",
				operationId: "getEhedatenEntry",
				parameters: [
					{
						name: "id",
						in: "path",
						required: true,
						description: "ID im Online-Katalog (wie in detail.aspx?ID=…).",
						schema: { type: "integer", minimum: 1 },
					},
				],
				responses: {
					"200": {
						description: "Eheeintrag.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { $ref: "#/components/schemas/EhedatenEntry" },
										meta: { $ref: "#/components/schemas/EhedatenMeta" },
									},
								},
							},
						},
					},
					"400": errorResponse("Ungültige ID."),
					"404": errorResponse("Unbekannte ID."),
					"429": errorResponse("Rate-Limit überschritten."),
					"503": errorResponse("Ehedaten zurzeit nicht verfügbar."),
				},
			},
		},
		"/editions": {
			get: {
				summary: "Editionen durchsuchen",
				description:
					`Stücke der Editionen des Staatsarchivs: geprüfte Abschriften einzelner Quellen mit Regest, Kommentar, ` +
					`Anmerkungen, Personen und Orten. Editionen: ${INDEXED_EDITIONS.map((e) => `${e} = ${EDITIONS[e].name} (${EDITIONS[e].license})`).join(", ")}. Rein lexikalisch wie der Reiter «Editionen» der ` +
					`Suche (Suche nach Bedeutung bietet das MCP-Werkzeug edition_search); alle Filter untereinander UND, mehrere ` +
					`Werte eines Filters ODER. Lizenz und Nennung stehen an jedem Stück (license, attribution), nicht in meta. ` +
					`Blätter-Fenster: offset + limit ≤ ${WINDOW_MAX}.`,
				operationId: "searchEditions",
				parameters: [
					{
						name: "q",
						in: "query",
						description:
							'Volltext über Quellentext, Titel, Regest, Schlagwörter, Kommentar, Anmerkungen, Namen und Signatur; alle Wörter müssen vorkommen. Die Zeichen der Quellen sind angeglichen (zů trifft zu, daß trifft dass, ů/ü/uͤ gleich). "…" für eine Wortfolge, -wort schliesst aus. Leer = alle Stücke der Filter, chronologisch.',
						schema: { type: "string" },
					},
					{
						name: "edition",
						in: "query",
						description: "Nur diese Edition(en). Wiederholbar.",
						schema: { type: "array", items: { type: "string", enum: [...INDEXED_EDITIONS] } },
						style: "form",
						explode: true,
					},
					{
						name: "part",
						in: "query",
						description:
							"Teil der Edition (QZH: Reihe, Rechtsquellen: Band), exakt wie in meta.facets.part (z. B. «Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5», «SSRQ ZH NF II/3: Die Landvogtei Greifensee»). Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "keyword",
						in: "query",
						description: "Schlagwort der Edition, exakt wie in meta.facets.keyword (z. B. «Täufertum»). Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "person",
						in: "query",
						description: "Person, wie die Edition sie verzeichnet («Heinrich Bullinger»); Formen im Text und Schreibvarianten zählen mit. Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "place",
						in: "query",
						description: "Ort («Grüningen»), wie person. Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "organization",
						in: "query",
						description: "Organisation, wie person. Wiederholbar, mehrere = ODER.",
						schema: { type: "array", items: { type: "string" } },
						style: "form",
						explode: true,
					},
					{
						name: "dateFrom",
						in: "query",
						description: "Jahr (inklusive): Stücke, deren Datum bis mindestens hierher reicht.",
						schema: { type: "integer", minimum: CATALOG_YEAR_MIN, maximum: CATALOG_YEAR_MAX },
					},
					{
						name: "dateTo",
						in: "query",
						description: "Jahr (inklusive): Stücke, deren Datum spätestens hier beginnt.",
						schema: { type: "integer", minimum: CATALOG_YEAR_MIN, maximum: CATALOG_YEAR_MAX },
					},
					{
						name: "facsimile",
						in: "query",
						description: "true = nur Stücke mit Faksimile (IIIF-Manifest in links.iiifManifest).",
						schema: { type: "boolean" },
					},
					{
						name: "sort",
						in: "query",
						description: "Sortierung; ohne q gilt date_asc.",
						schema: { type: "string", enum: ["relevance", "date_asc", "date_desc"], default: "relevance" },
					},
					{
						name: "facets",
						in: "query",
						description: `Zählungen der ganzen Treffermenge mitliefern, kommasepariert. Erlaubt: ${EDITIONS_RESPONSE_FACETS.join(", ")} (facsimile mit den Werten true/false).`,
						schema: { type: "string" },
						example: "part,keyword",
					},
					{
						name: "offset",
						in: "query",
						description: `Start-Offset (0-basiert). offset + limit ≤ ${WINDOW_MAX}.`,
						schema: { type: "integer", minimum: 0, maximum: WINDOW_MAX - 1, default: 0 },
					},
					{
						name: "limit",
						in: "query",
						description: "Treffer pro Antwort.",
						schema: { type: "integer", minimum: 1, maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
					},
				],
				responses: {
					"200": {
						description: "Trefferliste mit Envelope (data/meta/links).",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { type: "array", items: { $ref: "#/components/schemas/EditionPieceSummary" } },
										meta: { $ref: "#/components/schemas/EditionsMeta" },
										links: { $ref: "#/components/schemas/PaginationLinks" },
									},
								},
							},
						},
					},
					"400": errorResponse("Ungültiger Parameter oder Blätter-Fenster überschritten."),
					"429": errorResponse("Rate-Limit überschritten."),
					"503": errorResponse("Editionen zurzeit nicht verfügbar."),
				},
			},
		},
		"/editions/{edition}/{id}": {
			get: {
				summary: "Einzelnes Stück einer Edition",
				description:
					"Ein Stück mit allen Angaben: Bearbeitung, Vorlage (Signatur, Katalog-IDs), weitere Überlieferungen, Regest, Lesefassung (text), Text der Edition (html), Anmerkungen, Kommentar, Personen (Normnamen, GND), Orte (Koordinaten), Seiten und Bilder.",
				operationId: "getEditionPiece",
				parameters: [
					{ name: "edition", in: "path", required: true, description: "Kennung der Edition.", schema: { type: "string", enum: [...INDEXED_EDITIONS] } },
					{ name: "id", in: "path", required: true, description: "Kennung des Stücks in der Edition, z. B. «QZH_401» oder «SSRQ_ZH_NF_II_3_047».", schema: { type: "string" } },
				],
				responses: {
					"200": {
						description: "Stück.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { $ref: "#/components/schemas/EditionPiece" },
										meta: { $ref: "#/components/schemas/EditionsMeta" },
									},
								},
							},
						},
					},
					"400": errorResponse("Ungültige Kennung."),
					"404": errorResponse("Unbekannte Edition oder unbekanntes Stück."),
					"429": errorResponse("Rate-Limit überschritten."),
					"503": errorResponse("Editionen zurzeit nicht verfügbar."),
				},
			},
		},
		"/stats": {
			get: {
				summary: "Korpus-Statistik",
				description: "Dokument-Anzahl gesamt, pro Serie und pro Jahr.",
				operationId: "getStats",
				responses: {
					"200": { description: "Statistik-Objekt (documents, bySeries, byYear)." },
					"429": errorResponse("Rate-Limit überschritten."),
				},
			},
		},
	},
	components: {
		schemas: {
			Error: {
				type: "object",
				properties: {
					error: {
						type: "object",
						properties: {
							code: {
								type: "string",
								enum: [
									"invalid_parameter",
									"pagination_window_exceeded",
									"not_found",
									"method_not_allowed",
									"rate_limited",
									"service_unavailable",
									"internal_error",
								],
							},
							message: { type: "string" },
							status: { type: "integer" },
						},
						required: ["code", "message", "status"],
					},
				},
				required: ["error"],
			},
			Meta: {
				type: "object",
				description:
					"Antwort-Metadaten. total ist bei Volltext-Queries eine Schätzung (Meilisearch estimatedTotalHits).",
				properties: {
					total: { type: "integer" },
					offset: { type: "integer" },
					limit: { type: "integer" },
					processingTimeMs: { type: "integer" },
					warnings: {
						type: "array",
						items: { type: "string" },
						description:
							"Hinweise, etwa wenn theme ignoriert wurde oder person/place/organization nur die exakte Form filtern konnten.",
					},
					facets: { type: "object", additionalProperties: true },
					license: { type: "string", const: LICENSE },
					licenseUrl: { type: "string", const: LICENSE_URL },
					attribution: { type: "string", const: ATTRIBUTION },
				},
			},
			PaginationLinks: {
				type: "object",
				properties: {
					self: { type: "string" },
					next: { type: ["string", "null"] },
					prev: { type: ["string", "null"] },
				},
			},
			DocumentListItem: {
				type: "object",
				description: "Suchtreffer: Metadaten + Text-Auszug, ohne Volltext.",
				properties: {
					id: { type: "string" },
					series: { type: "string", enum: ALL_SERIES },
					title: { type: "string" },
					date: { type: ["string", "null"], description: "ISO-Datum JJJJ-MM-TT." },
					dateYear: { type: ["integer", "null"] },
					volumeNr: { type: ["integer", "null"], description: "Bandnummer (OS; RM: Nummer in StAZH B II)." },
					serialNr: { type: ["string", "null"], description: "Ordnungsnummer (OS)." },
					resolutionId: { type: ["string", "null"], description: "Beschlussnummer (RRB), JJJJ/NNNN." },
					startPg: { type: ["integer", "null"] },
					stazhIdent: {
						type: ["string", "null"],
						description: "Archiv-Signatur (StAZH) bzw. Kennung der Original-Publikation (Spätbestände).",
					},
					subset: {
						type: ["string", "null"],
						description: "Teilbestands-Marker (krp-late, rrb-late, os-late) oder null.",
					},
					excerpt: { type: ["string", "null"], description: "Text-Auszug um die Fundstelle." },
					score: { type: ["number", "null"], description: "Relevanz-Score (0–1)." },
					links: {
						type: "object",
						properties: { self: { type: "string" }, web: { type: "string" } },
					},
				},
			},
			Document: {
				type: "object",
				description: "Einzeldokument mit Volltext und Link-Bündel.",
				properties: {
					id: { type: "string" },
					series: { type: "string", enum: ALL_SERIES },
					title: { type: "string" },
					date: { type: ["string", "null"] },
					dateYear: { type: ["integer", "null"] },
					volumeNr: { type: ["integer", "null"] },
					serialNr: { type: ["string", "null"] },
					resolutionId: { type: ["string", "null"] },
					startPg: { type: ["integer", "null"] },
					stazhIdent: { type: ["string", "null"] },
					subset: { type: ["string", "null"] },
					archiveLink: {
						type: ["string", "null"],
						description:
							"Altbestand: Link in den Online-Katalog des Staatsarchivs; Spätbestände: Original-Publikation " +
							"(zh.ch bzw. Gever-Web-Service des Kantonsrats).",
					},
					persons: {
						type: "array",
						items: { type: "string" },
						description: "Erkannte Personen. Bei den Ratsmanualen (RM) leer – dort sind die Entitäten nur im Text ausgezeichnet (TEI/HTML).",
					},
					places: { type: "array", items: { type: "string" } },
					organizations: { type: "array", items: { type: "string" } },
					body: {
						type: ["string", "null"],
						description:
							"Volltext (normalisiert, max. ~100 KiB). Ratsmanuale (RM): Lesefassung der maschinellen Transkription (Worttrennungen und Nasalstriche aufgelöst, übrige Diakritika entfernt, ß im Wortinnern als ss); die diplomatische Fassung steht in der TEI-Quelle (links.xml) und im gerenderten HTML.",
					},
					relations: {
						type: "array",
						description:
							"Querverweise auf verwandte Dokumente (aus dem TEI-Header <listRelation>). Nur KRP + OS pflegen sie; sonst leer.",
						items: { $ref: "#/components/schemas/RelatedDocument" },
					},
					editions: {
						type: "array",
						description:
							"Ratsmanuale (RM): Einträge dieser Sitzung, die eine Edition des Staatsarchivs ediert (QZH, Zürcher Rechtsquellen), mit Link und eigener Lizenz; sonst leer.",
						items: { $ref: "#/components/schemas/EditionLink" },
					},
					links: {
						type: "object",
						properties: {
							self: { type: "string" },
							web: { type: "string", description: "Dokument-Ansicht auf der Plattform." },
							html: { type: "string", description: "Gerendertes HTML (kann für einzelne Bestände fehlen)." },
							xml: { type: "string", description: "TEI-XML-Quelle (kann für einzelne Bestände fehlen)." },
							iiifManifest: {
								type: ["string", "null"],
								description:
									"IIIF-Manifest des Faksimiles, falls vorhanden. Ratsmanuale (RM): Bilder vom Transkribus-Bildserver (files.transkribus.eu), Digitalisat des Staatsarchivs, ohne Rechtekennzeichnung.",
							},
							zip: { type: "string", description: "ZIP-Export (TEI-XML, Volltext, HTML-Druckansicht; mit `?images=1` auch die Scans, Ratsmanuale nur mit Links)." },
							similar: { type: "string" },
						},
					},
				},
			},
			EditionLink: {
				type: "object",
				description:
					"Querverweis auf ein Stück einer Edition des Staatsarchivs: Quellen zur Zürcher Geschichte (QZH) oder Zürcher Rechtsquellen " +
					"(SSRQ ZH), beide CC BY 4.0. Lizenz und Nennung gelten für Titel und Edition, nicht die Public Domain Mark der amtlichen Quellen.",
				properties: {
					edition: { type: "string", enum: ["qzh", "ssrq"] },
					editionName: { type: "string", description: "Name der Edition." },
					id: { type: "string", description: "Text der Edition (Dateiname), z. B. QZH_401 oder SSRQ_ZH_NF_II_3_047_2." },
					label: { type: "string", description: "Zitierform des Stücks, z. B. QZH_401 oder SSRQ ZH NF II/3 Nr. 40." },
					url: { type: "string", description: "Seite des Stücks in der Edition." },
					relation: {
						type: "string",
						enum: ["edition", "witness"],
						description: "edition: ediert aus dieser Vorlage; witness: die Edition führt sie als weitere Überlieferung, ediert ist das Stück aus einer anderen.",
					},
					title: { type: ["string", "null"], description: "Titel des Stücks (nur bei Ratsmanual-Sitzungen: welcher Eintrag ediert ist)." },
					license: { type: "string", enum: [...new Set(Object.values(EDITIONS).map((e) => e.license))] },
					licenseUrl: { type: "string" },
					attribution: { type: "string" },
				},
			},
			RelatedDocument: {
				type: "object",
				description:
					"Ein Querverweis aus dem TEI-Header. `document` ist gesetzt, wenn das Ziel im Korpus liegt (mit Links), sonst null – dann führt nur catalogUrl in den Staatsarchiv-Katalog.",
				properties: {
					type: { type: "string", description: "Relations-Typ aus dem TEI-Markup, z. B. Änderung_von." },
					label: { type: "string", description: "Lesbares deutsches Label, z. B. „Ändert“." },
					archiveId: { type: ["integer", "null"], description: "Staatsarchiv-Katalog-ID des Ziels." },
					catalogUrl: { type: "string", description: "Link in den Online-Katalog des Staatsarchivs." },
					document: {
						type: ["object", "null"],
						description: "Verlinktes Dokument, falls im Korpus – sonst null.",
						properties: {
							id: { type: "string" },
							series: { type: "string", enum: ALL_SERIES },
							title: { type: "string" },
							date: { type: ["string", "null"] },
							links: {
								type: "object",
								properties: { self: { type: "string" }, web: { type: "string" } },
							},
						},
					},
				},
			},
			Series: {
				type: "object",
				properties: {
					abbr: { type: "string", enum: ALL_SERIES },
					name: { type: "string" },
					description: { type: "string" },
					documents: { type: "integer" },
					years: {
						type: ["object", "null"],
						properties: { from: { type: "integer" }, to: { type: "integer" } },
					},
					subsets: {
						type: "array",
						items: {
							type: "object",
							properties: { id: { type: "string" }, description: { type: "string" } },
						},
					},
					links: { type: "object", additionalProperties: { type: "string" } },
				},
			},
			FacetValue: {
				type: "object",
				properties: {
					value: { type: "string" },
					count: { type: "integer" },
				},
			},
			CatalogMeta: {
				type: "object",
				description: "Antwort-Metadaten des Archivkatalogs: Quelle und Zitierhinweis statt Lizenz.",
				properties: {
					total: { type: "integer" },
					offset: { type: "integer" },
					limit: { type: "integer" },
					processingTimeMs: { type: "integer" },
					facets: { type: "object", additionalProperties: true },
					source: { type: "string", const: CATALOG_SOURCE },
					sourceUrl: { type: "string", const: CATALOG_SOURCE_URL },
					note: { type: "string", const: CATALOG_NOTE },
				},
			},
			CatalogUnit: {
				type: "object",
				description: "Verzeichnungseinheit des Online-Archivkatalogs.",
				properties: {
					id: { type: "integer", description: "ID im Online-Katalog." },
					signature: { type: "string" },
					title: { type: "string" },
					level: { type: ["string", "null"], description: "Stufe: Dokument, Dossier, Subdossier, Klasse, Bestand …" },
					dateText: { type: ["string", "null"], description: "Entstehungszeitraum wie im Katalog." },
					dateFrom: { type: ["integer", "null"] },
					dateTo: { type: ["integer", "null"] },
					bestand: { type: ["string", "null"] },
					path: {
						type: "array",
						description: "Archivplan-Pfad (ohne Wurzel und ohne die Einheit selbst).",
						items: {
							type: "object",
							properties: { id: { type: "integer" }, label: { type: "string" }, url: { type: "string" } },
						},
					},
					provenienz: { type: ["string", "null"] },
					hasDigitization: { type: "boolean" },
					files: {
						type: "array",
						description: "Digitalisate im Online-Katalog (Download bzw. Bildansicht).",
						items: {
							type: "object",
							properties: {
								name: { type: "string" },
								url: { type: "string" },
								kind: { type: "string", enum: ["file", "image"] },
							},
						},
					},
					fileCount: { type: "integer" },
					url: { type: "string", description: "Permalink im Online-Katalog." },
					excerpt: { type: ["string", "null"], description: "Nur in Listen: Auszug aus Regest/Inhalt." },
					text: {
						type: ["string", "null"],
						description: "Nur in der Einzelansicht: Regest bzw. «Inhalt und Form», auf 2'000 Zeichen gekürzt (ungekürzt auf der Seite links.web).",
					},
					document: {
						type: ["object", "null"],
						description:
							"Plattform-Dokument, das die Einheit abbildet (relation depicts: Einheiten der Zentralen Serien samt Ratsmanual-Sitzungen, " +
							"nur in der Einzelansicht) oder auf das sie per Weblink verweist (relation references, z. B. eine Urkunde zu einem " +
							"Regierungsratsbeschluss) – sonst null.",
						properties: {
							id: { type: "string" },
							series: { type: "string" },
							relation: { type: "string", enum: ["depicts", "references"] },
							links: { type: "object", properties: { self: { type: "string" }, web: { type: "string" } } },
						},
					},
					editions: {
						type: "array",
						description:
							"Nur in der Einzelansicht: Stücke der QZH und der Zürcher Rechtsquellen, die diese Einheit edieren bzw. als weitere Überlieferung führen; " +
							"bei Ratsmanual-Sitzungen auch die edierten Einträge der Sitzung.",
						items: { $ref: "#/components/schemas/EditionLink" },
					},
					links: {
						type: "object",
						description: "self = diese API, web = Seite der Einheit auf der Plattform, catalog = Online-Katalog des Staatsarchivs.",
						properties: { self: { type: "string" }, web: { type: "string" }, catalog: { type: "string" } },
					},
				},
			},
			EhedatenMeta: {
				type: "object",
				description: "Antwort-Metadaten der Ehedaten: eigene Lizenz mit Nennung (nicht die Public Domain Mark der amtlichen Serien).",
				properties: {
					total: { type: "integer" },
					offset: { type: "integer" },
					limit: { type: "integer" },
					processingTimeMs: { type: "integer" },
					facets: {
						type: "object",
						description: "Nur mit facets=…: je Zählung ein Objekt Wert → Anzahl Einträge.",
						additionalProperties: { type: "object", additionalProperties: { type: "integer" } },
					},
					license: { type: "string", const: EHEDATEN_LICENSE },
					licenseUrl: { type: "string", const: EHEDATEN_LICENSE_URL },
					attribution: { type: "string", const: EHEDATEN_ATTRIBUTION },
					source: {
						type: "string",
						const: EHEDATEN_SOURCE_URL,
						description: `Online-Archivkatalog des Staatsarchivs, aus dem die Einträge stammen (Stand ${EHEDATEN_AS_OF}); je Eintrag der Permalink in url.`,
					},
					note: { type: "string", const: EHEDATEN_NOTE },
				},
			},
			EhedatenPerson: {
				type: "object",
				description: "Bräutigam bzw. Braut. Namen vereinheitlicht; die Originalschreibung steht, falls vermerkt, in note.",
				properties: {
					firstName: { type: ["string", "null"] },
					lastName: { type: ["string", "null"], description: "«N.» = unbekannt." },
					name: { type: "string", description: "«Vorname Nachname»." },
					origin: { type: ["string", "null"], description: "Herkunft wie in der Ehedatenbank." },
					originNormalized: {
						type: ["string", "null"],
						description:
							"Herkunft auf die Gemeinde gebracht (Weiler in Klammern ⇒ Gemeinde), sonst mit Kantonskürzel («Nussbaumen TG») bzw. Land («Büsingen (Deutschland)»).",
					},
					note: { type: ["string", "null"], description: "Zusatzinfo: Originalschreibung, Beruf, Bemerkungen." },
					hls: { type: ["string", "null"], description: "Artikel im Historischen Lexikon der Schweiz." },
					gnd: { type: ["string", "null"], description: "GND-Normdatensatz." },
				},
			},
			EhedatenEntry: {
				type: "object",
				description: "Eheeintrag der Ehedatenbank des Staatsarchivs.",
				properties: {
					id: { type: "integer", description: "ID im Online-Katalog." },
					signature: { type: "string", description: "z. B. «E III 30.1, EDB 276»." },
					volume: { type: ["string", "null"], description: "Band: Signatur ohne «, EDB n»." },
					entry: { type: ["integer", "null"], description: "Laufnummer «EDB n»." },
					page: { type: ["string", "null"], description: "Seite bzw. Teil im Band." },
					source: { type: ["string", "null"], enum: [...EHEDATEN_QUELLEN, null], description: "E III = Pfarrbücher im Staatsarchiv, TAI = Bücher anderer Archive." },
					parish: { type: "string", description: "Kirchgemeinde." },
					type: {
						type: "string",
						enum: ["trauung", "verkuendung"],
						description: "Trauung, oder Verkündung, wenn der Eintrag «Verkünddatum» vermerkt (getraut wurde dann oft anderswo). Werte wie der Filter art.",
					},
					typeLabel: { type: "string", enum: ["Trauung", "Verkündung"] },
					date: { $ref: "#/components/schemas/EhedatenDate" },
					groom: { $ref: "#/components/schemas/EhedatenPerson" },
					bride: { $ref: "#/components/schemas/EhedatenPerson" },
					title: { type: "string", description: "Titel wie im Online-Katalog." },
					uncertain: { type: "boolean", description: "Einzelne Angaben unsicher gelesen («?»)." },
					sameMarriage: {
						anyOf: [{ $ref: "#/components/schemas/EhedatenSameMarriage" }, { type: "null" }],
						description: "Die übrigen Einträge derselben Ehe laut geprüfter Liste der Mehrfacheinträge; null, wenn die Liste den Eintrag nicht führt.",
					},
					url: { type: "string", description: "Permalink im Online-Katalog." },
					links: { $ref: "#/components/schemas/EhedatenLinks" },
				},
			},
			EhedatenDate: {
				type: "object",
				description: "Datum wie im Kirchenbuch, nicht umgerechnet.",
				properties: {
					text: { type: "string", description: "z. B. «03.03.1689», «10.1696», «ca. 1526 – ca. 1532»." },
					from: { type: "string", format: "date" },
					to: { type: "string", format: "date" },
					yearFrom: { type: "integer" },
					yearTo: { type: "integer" },
					calendar: { type: "string", enum: ["julian", "gregorian"], description: "Zürich datierte bis 1700 julianisch (alter Stil)." },
				},
			},
			EhedatenLinks: {
				type: "object",
				description: "self = diese API, web = Seite auf der Plattform (mit Ehe-Karte), catalog = Online-Katalog des Staatsarchivs.",
				properties: { self: { type: "string" }, web: { type: "string" }, catalog: { type: "string" } },
			},
			EhedatenSameMarriage: {
				type: "object",
				description:
					"Dieselbe Ehe in weiteren Kirchenbüchern, meist verkündet oder eingetragen in der einen, getraut in der anderen Kirchgemeinde. Quelle: Liste der Mehrfacheinträge des Staatsarchivs (Repository stazh/sw-ehedaten); sie erfasst nur einen Teil der Ehen, die in zwei Kirchenbüchern stehen.",
				properties: {
					certainty: {
						type: "string",
						enum: ["certain", "probable"],
						description: "Sicherheitswert der Liste: certain = geprüft dieselbe Ehe, probable = wahrscheinlich dieselbe Ehe.",
					},
					entries: {
						type: "array",
						description: "Die übrigen Einträge, nach Datum.",
						items: {
							type: "object",
							properties: {
								id: { type: "integer", description: "ID im Online-Katalog." },
								signature: { type: "string" },
								parish: { type: "string", description: "Kirchgemeinde des Kirchenbuchs." },
								type: { type: "string", enum: ["trauung", "verkuendung"] },
								typeLabel: { type: "string", enum: ["Trauung", "Verkündung"] },
								date: { $ref: "#/components/schemas/EhedatenDate" },
								links: { $ref: "#/components/schemas/EhedatenLinks" },
							},
						},
					},
				},
			},
			EditionsMeta: {
				type: "object",
				description: "Antwort-Metadaten der Editionen. Lizenz und Nennung stehen an jedem Stück, nicht hier.",
				properties: {
					total: { type: "integer" },
					offset: { type: "integer" },
					limit: { type: "integer" },
					processingTimeMs: { type: "integer" },
					facets: {
						type: "object",
						description: "Nur mit facets=…: je Zählung ein Objekt Wert → Anzahl Stücke.",
						additionalProperties: { type: "object", additionalProperties: { type: "integer" } },
					},
					note: { type: "string", const: EDITIONS_NOTE },
				},
			},
			EditionDate: {
				type: "object",
				description: "Datum wie in der Quelle (in Zürich bis 1700 alter Stil, nicht umgerechnet).",
				properties: {
					text: { type: ["string", "null"], description: "z. B. «21.9.1583», «Mai 1530», «1530–1532»." },
					from: { type: ["string", "null"], format: "date" },
					to: { type: ["string", "null"], format: "date" },
					yearFrom: { type: ["integer", "null"] },
					yearTo: { type: ["integer", "null"] },
				},
			},
			EditionRights: {
				type: "object",
				description: "Lizenz der Editionsdaten mit Nennung; die Abbildungen haben eigene Rechte.",
				properties: {
					license: { type: "string", description: "z. B. «CC BY 4.0» (QZH)." },
					licenseUrl: { type: "string" },
					attribution: { type: "string", description: "Nennung, wie die Lizenz sie verlangt." },
					imagesLicense: { type: "string", description: "Rechte an den Abbildungen (QZH: gemeinfrei)." },
					imagesLicenseUrl: { type: "string" },
				},
			},
			EditionLinks: {
				type: "object",
				description: "self = diese API, web = Seite auf der Plattform, edition = Stück in der Edition, iiifManifest = IIIF-Manifest (Presentation 3), wenn das Stück Bilder hat.",
				properties: {
					self: { type: "string" },
					web: { type: "string" },
					edition: { type: ["string", "null"] },
					iiifManifest: { type: ["string", "null"] },
				},
			},
			EditionPieceSummary: {
				allOf: [
					{ $ref: "#/components/schemas/EditionRights" },
					{
						type: "object",
						description: "Stück in der Trefferliste.",
						properties: {
							edition: { type: "string", enum: [...INDEXED_EDITIONS] },
							editionName: { type: "string" },
							id: { type: "string", description: "Kennung in der Edition, z. B. «QZH_401», «SSRQ_ZH_NF_II_3_047»." },
							label: { type: "string", description: "Zitierform, z. B. «QZH_401», «SSRQ ZH NF II/3 Nr. 47»." },
							title: { type: "string" },
							part: { type: ["string", "null"], description: "Teil der Edition (Rechtsquellen: Band)." },
							date: { $ref: "#/components/schemas/EditionDate" },
							signature: { type: ["string", "null"], description: "Signatur der Vorlage, z. B. «StAZH E I 7.2, Nr. 30»." },
							keywords: { type: "array", items: { type: "string" } },
							hasFacsimile: { type: "boolean" },
							excerpt: { type: ["string", "null"], description: "Auszug um die Suchwörter (Quellentext, sonst Regest oder Kommentar)." },
							url: { type: ["string", "null"], description: "Permalink des Stücks in der Edition." },
							links: { $ref: "#/components/schemas/EditionLinks" },
						},
					},
				],
			},
			EditionPiece: {
				allOf: [
					{ $ref: "#/components/schemas/EditionRights" },
					{
						type: "object",
						description: "Stück einer Edition mit allen Angaben.",
						properties: {
							edition: { type: "string", enum: [...INDEXED_EDITIONS] },
							editionName: { type: "string" },
							id: { type: "string" },
							label: { type: "string", description: "Zitierform, z. B. «QZH_401», «SSRQ ZH NF II/3 Nr. 47»." },
							number: { type: ["integer", "null"], description: "Laufnummer in der Edition (Rechtsquellen: im Band)." },
							title: { type: "string" },
							part: { type: ["string", "null"] },
							date: { $ref: "#/components/schemas/EditionDate" },
							calendar: {
								type: ["string", "null"],
								enum: ["julian", "gregorian", null],
								description: "Kalender des Datums, wenn die Edition ihn nennt (julian = alter Stil).",
							},
							origPlace: { type: ["string", "null"], description: "Entstehungsort." },
							signature: { type: ["string", "null"] },
							catalogIds: { type: "array", items: { type: "integer" }, description: "IDs der Vorlage im Online-Archivkatalog." },
							catalog: {
								type: "array",
								description: "Die Vorlage als Verzeichnungseinheit (/api/v1/catalog/{id}).",
								items: { type: "object", properties: { id: { type: "integer" }, links: { type: "object" } } },
							},
							sourceUrl: { type: ["string", "null"], description: "Vorlage im Online-Katalog." },
							languages: { type: "array", items: { type: "string" } },
							filiation: { type: ["string", "null"], description: "Überlieferung (z. B. «Entwurf», «Abschrift»)." },
							physical: { type: "array", items: { type: "string" }, description: "Beschreibung der Vorlage." },
							witnesses: {
								type: "array",
								description: "Weitere Überlieferungen desselben Stücks (Rechtsquellen): nur beschrieben, ediert ist der Text aus der Vorlage oben.",
								items: {
									type: "object",
									properties: {
										textId: { type: ["string", "null"], description: "Text der Edition, z. B. SSRQ_ZH_NF_II_3_047_2." },
										signature: { type: ["string", "null"] },
										date: { type: ["object", "null"], properties: { text: { type: ["string", "null"] }, from: { type: "string" }, to: { type: ["string", "null"] } } },
										catalogIds: { type: "array", items: { type: "integer" } },
										sourceUrl: { type: ["string", "null"] },
										filiation: { type: ["string", "null"] },
										physical: { type: "array", items: { type: "string" } },
										languages: { type: "array", items: { type: "string" } },
									},
								},
							},
							keywords: { type: "array", items: { type: "string" } },
							keywordGlosses: { type: "object", additionalProperties: { type: "string" }, description: "Erklärung je Schlagwort (Rechtsquellen: Glossar der Edition)." },
							editors: { type: "array", items: { type: "string" }, description: "Herausgeberschaft." },
							transcription: { type: "array", items: { type: "string" } },
							tagging: { type: "array", items: { type: "string" }, description: "Auszeichnung (Personen, Orte)." },
							publisher: { type: ["string", "null"] },
							published: { type: ["string", "null"], description: "Online veröffentlicht (Datum)." },
							bibliography: { type: "array", items: { type: "object", properties: { head: { type: ["string", "null"] }, text: { type: "string" } } } },
							regest: { type: ["string", "null"], description: "Inhaltsangabe der Bearbeitung." },
							text: { type: "string", description: "Lesefassung des Quellentexts wie in der Suche: Abkürzungen aufgelöst, Gestrichenes weggelassen, Zeichen angeglichen (ů → u, ß → ss)." },
							html: { type: "string", description: "Text der Edition (HTML, Klassen ed-*): Originalzeichen, Seiten- und Zeilenwechsel, Anmerkungszeichen, Abkürzungen mit Auflösung im title." },
							notes: {
								type: "array",
								description: "Anmerkungen: textkritische (Buchstaben) und Sachanmerkungen (Zahlen).",
								items: {
									type: "object",
									properties: {
										label: { type: "string" },
										type: { type: "string", enum: ["critical", "editorial"] },
										inCommentary: { type: "boolean" },
										text: { type: "string" },
									},
								},
							},
							comment: { type: ["string", "null"], description: "Kommentar der Bearbeitung." },
							persons: {
								type: "array",
								items: {
									type: "object",
									properties: {
										name: { type: "string" },
										gnd: { type: ["string", "null"] },
										forms: { type: "array", items: { type: "string" }, description: "Formen im Text." },
										mentions: { type: "integer" },
									},
								},
							},
							places: {
								type: "array",
								items: {
									type: "object",
									properties: {
										name: { type: "string" },
										lat: { type: ["number", "null"] },
										lon: { type: ["number", "null"] },
										forms: { type: "array", items: { type: "string" } },
										mentions: { type: "integer" },
									},
								},
							},
							organizations: { type: "array", items: { type: "string" } },
							entitySource: {
								type: ["string", "null"],
								enum: ["edition", "ner", null],
								description: "Herkunft der Namen: edition = Auszeichnung der Edition, ner = automatisch erkannt (Modell der Ratsmanuale, nur Stücke ohne Auszeichnung).",
							},
							pages: {
								type: "array",
								description: "Seiten der Vorlage in Textreihenfolge; image = Index in images (0-basiert), null ohne Bild.",
								items: { type: "object", properties: { label: { type: "string" }, image: { type: ["integer", "null"] } } },
							},
							hasFacsimile: { type: "boolean" },
							images: {
								type: "array",
								description: "Bilder (IIIF Image API 2).",
								items: {
									type: "object",
									properties: {
										label: { type: ["string", "null"] },
										service: { type: "string" },
										width: { type: "integer" },
										height: { type: "integer" },
										credit: { type: ["string", "null"], description: "Besitzende Institution, wenn das Bild nicht vom Staatsarchiv stammt." },
									},
								},
							},
							url: { type: "string", description: "Permalink des Stücks in der Edition." },
							links: { $ref: "#/components/schemas/EditionLinks" },
						},
					},
				],
			},
		},
	},
};
