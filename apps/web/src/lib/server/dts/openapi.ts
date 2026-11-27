// OpenAPI-3.1-Spec für /api/dts (Distributed Text Services 1.0) – handgeschrieben,
// aber alle Enums/Deckel aus dts/constants.ts bzw. types.ts importiert: Spec und
// Implementierung können nicht auseinanderdriften. Ausgeliefert via
// GET /api/dts/openapi.json, interaktiv gerendert auf /api-doc (Umschalter neben
// der /api/v1-Spec). Reines Modul (kein $env/Meili) – via `npx tsx --test`
// testbar, exakt wie apiV1/openapi.ts.
//
// DTS-Antworten sind JSON-LD (Metadaten) bzw. TEI/XML (Texte); die OpenAPI-Spec
// beschreibt nur die HTTP-Schnittstelle. Die JSON-LD-Objekte sind bewusst lose
// typisiert (Schlüsselfelder dokumentiert, additionalProperties offen) – eine
// vollständige JSON-LD-Typisierung wäre unverhältnismässig.
//
// Spec: https://dtsapi.org/specifications/versions/v1.0/

import { LICENSE_URL } from "../apiV1/constants";
import { ALL_SERIES } from "../../types";
import { CONTACT_EMAIL } from "../../contact";
import { SITE_DISCLAIMER, SITE_HOST, SITE_NAME, SITE_SUBTITLE, SITE_URL } from "../../site";
import {
	CITE_TYPE_DOCUMENT,
	COLLECTION_PAGE_SIZE,
	DTS_VERSION,
	NAV_VALUES,
	ROOT_COLLECTION_ID,
	SUPPORTED_MEDIA_TYPES,
	TEI_MEDIA_TYPE,
} from "./constants";

// Die sechs stabilen Fehlercodes (= der DtsErrorCode-Union aus constants.ts).
// Als Wert-Array gehalten, weil ein reiner Typ-Union nicht zur Laufzeit (Spec/
// Test) verfügbar ist; der Test gleicht ihn gegen die Route-Verwendung ab.
const DTS_ERROR_CODES = [
	"invalid_parameter",
	"not_found",
	"method_not_allowed",
	"unsupported_media_type",
	"upstream_unavailable",
	"internal_error",
] as const;

// Beispiel-Resource konsistent mit /about/api (ein reales RRB-Altbestand-
// Dokument: «Protocollsverlesung.», 05.01.1837 – existiert im Index inkl. TEI).
const EXAMPLE_RESOURCE = "MM_2_33_RRB_1837_0001";

const errorResponse = (description: string) => ({
	description,
	content: {
		"application/json": {
			schema: { $ref: "#/components/schemas/DtsError" },
		},
	},
});

const rateLimited = errorResponse("Rate-Limit überschritten.");

// --- Wiederkehrende Parameter ----------------------------------------------

const resourceParam = {
	name: "resource",
	in: "query",
	required: true,
	description: "Resource-Identifier (eine Dokument-ID, z. B. aus einem Collection-Member oder der /api/v1-Suche).",
	schema: { type: "string" },
	example: EXAMPLE_RESOURCE,
};

// ref/start/end adressieren CitableUnits. Die Zitiertiefe ist bewusst flach
// (Dokument-Ebene): genau eine CitableUnit mit identifier "1". Andere Werte → 404.
const citeUnitDescription =
	`Zitierbare Einheit. Die Zitierstruktur ist bewusst flach (Dokument-Ebene, ` +
	`citeType "${CITE_TYPE_DOCUMENT}"): nur "1" (das ganze Dokument) ist gültig.`;

const refParam = {
	name: "ref",
	in: "query",
	description: `${citeUnitDescription} ref schliesst start/end aus.`,
	schema: { type: "string", enum: ["1"] },
};
const startParam = {
	name: "start",
	in: "query",
	description: `${citeUnitDescription} Mit end zu paaren (Bereich).`,
	schema: { type: "string", enum: ["1"] },
};
const endParam = {
	name: "end",
	in: "query",
	description: `${citeUnitDescription} Mit start zu paaren (Bereich).`,
	schema: { type: "string", enum: ["1"] },
};
const treeParam = {
	name: "tree",
	in: "query",
	description: "Identifier des CitationTree (Pass-through; es gibt aktuell genau einen Baum).",
	schema: { type: "string" },
};
const pageParam = {
	name: "page",
	in: "query",
	description: `Seite der paginierten Member-Liste (${COLLECTION_PAGE_SIZE} pro Seite; Serien und Jahrgänge passen je auf eine Seite).`,
	schema: { type: "integer", minimum: 1, default: 1 },
};

// --- Lose JSON-LD-Objektschemata --------------------------------------------

const ldBase = {
	"@context": { type: "string", const: "https://dtsapi.org/context/v1.0.json" },
	dtsVersion: { type: "string", const: DTS_VERSION },
};

export const dtsOpenApiDocument: Record<string, unknown> = {
	openapi: "3.1.0",
	info: {
		title: `${SITE_NAME} – DTS-API`,
		version: DTS_VERSION,
		description:
			`Schnittstelle nach dem **Distributed-Text-Services-Standard (DTS) 1.0** für die ` +
			`zentralen seriellen Quellen des Kantons Zürich: Offizielle Gesetzessammlung (OS), ` +
			`Amtsblatt (ABl), Kantonsratsprotokolle (KRP) und Regierungsratsbeschlüsse (RRB), dazu ` +
			`die Ratsmanuale (RM) der Stadt und Republik Zürich 1484–1798. Bei RM liefert der ` +
			`Document-Endpoint die diplomatische maschinelle Transkription (TEI), text/plain die ` +
			`Lesefassung des Suchindex.\n\n` +
			`DTS ist die community-gebaute Linked-Data-API für Textsammlungen: **JSON-LD** ` +
			`(application/ld+json) für die Metadaten/Navigation, **TEI/XML** ` +
			`(application/tei+xml) für die Texte. Damit ist das Korpus für die DH-/TEI-Welt ` +
			`interoperabel (DTS-Reader, -Aggregatoren, Tooling).\n\n` +
			`Hierarchie: Korpus → Serie (${ALL_SERIES.join("/")}) → Jahrgang → Dokument (Resource). ` +
			`Die Zitiertiefe ist die Dokument-Ebene (ein Dokument = eine zitierbare Einheit).\n\n` +
			`Grundsätze wie /api/v1: nur lesend, keine Authentifizierung, CORS offen, ` +
			`gemeinsames Rate-Limit pro Client. Keine KI-Funktionen. Spec-Details: ` +
			`https://dtsapi.org/specifications/versions/v1.0/\n\n` +
			`${SITE_NAME} – ${SITE_SUBTITLE}. ${SITE_DISCLAIMER} Dublin-Core-publisher ` +
			`je Dokument: Staatsarchiv (digitalisierter Altbestand und Ratsmanuale) bzw. Kantonsrat, ` +
			`Regierungsrat oder Staatskanzlei (Spätbestände).`,
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
	// servers wird im Route-Handler dynamisch gesetzt (Dev vs. Prod).
	servers: [{ url: `${SITE_URL}/api/dts` }],
	externalDocs: {
		description: "DTS-1.0-Spezifikation",
		url: "https://dtsapi.org/specifications/versions/v1.0/",
	},
	paths: {
		"/": {
			get: {
				summary: "Entry-Point",
				description:
					"Beschreibt die API und verlinkt die drei Operationen (Collection/Navigation/Document) als RFC-6570-URI-Templates.",
				operationId: "dtsEntry",
				responses: {
					"200": {
						description: "EntryPoint-Objekt (JSON-LD).",
						content: {
							"application/ld+json": {
								schema: { $ref: "#/components/schemas/EntryPoint" },
							},
						},
					},
					"429": rateLimited,
				},
			},
		},
		"/collection": {
			get: {
				summary: "Collection (Korpus → Serie → Jahr → Dokument)",
				description:
					`Navigiert die Sammlungs-Hierarchie. Ohne id (bzw. id=${ROOT_COLLECTION_ID}) das ` +
					`Gesamtkorpus, dann pro Stufe die Kinder. nav=parents liefert stattdessen die ` +
					`Elternkette. Dokument-Member werden paginiert (${COLLECTION_PAGE_SIZE}/Seite).`,
				operationId: "dtsCollection",
				parameters: [
					{
						name: "id",
						in: "query",
						description:
							`Collection-Identifier. Formen: "${ROOT_COLLECTION_ID}" (Korpus, ` +
							`= ohne id), eine Serie (${ALL_SERIES.join(", ")}), ein Jahrgang ` +
							`("Serie/Jahr", z. B. "RRB/1837") oder eine Dokument-ID (Resource).`,
						schema: { type: "string" },
						example: "RRB",
					},
					{
						name: "nav",
						in: "query",
						description: 'Navigationsrichtung: "children" (Kinder, Default) oder "parents" (Elternkette).',
						schema: { type: "string", enum: [...NAV_VALUES], default: NAV_VALUES[0] },
					},
					pageParam,
				],
				responses: {
					"200": {
						description: "Collection-Objekt mit member[] (JSON-LD).",
						content: {
							"application/ld+json": {
								schema: { $ref: "#/components/schemas/Collection" },
							},
						},
					},
					"400": errorResponse("Ungültiger Parameter (z. B. unbekannter nav-Wert)."),
					"404": errorResponse("Unbekannte oder syntaktisch ungültige Collection-id."),
					"429": rateLimited,
				},
			},
		},
		"/navigation": {
			get: {
				summary: "Navigation (Zitierstruktur einer Resource)",
				description:
					"Liefert die zitierbaren Einheiten einer Resource. Da die Zitiertiefe die Dokument-Ebene ist, gibt es genau eine CitableUnit (\"1\").",
				operationId: "dtsNavigation",
				parameters: [
					resourceParam,
					refParam,
					startParam,
					endParam,
					{
						name: "down",
						in: "query",
						description: "Tiefe des zurückgegebenen Teilbaums (-1 = maximale Tiefe).",
						schema: { type: "integer", minimum: -1, maximum: 100 },
					},
					treeParam,
					pageParam,
				],
				responses: {
					"200": {
						description: "Navigation-Objekt mit member[] (CitableUnits, JSON-LD).",
						content: {
							"application/ld+json": {
								schema: { $ref: "#/components/schemas/Navigation" },
							},
						},
					},
					"400": errorResponse("Ungültige Parameter (z. B. ref zusammen mit start/end, oder start ohne end)."),
					"404": errorResponse("Unbekannte Resource oder ref/start/end ≠ \"1\"."),
					"429": rateLimited,
				},
			},
		},
		"/document": {
			get: {
				summary: "Document (Volltext einer Resource)",
				description:
					`Liefert den Volltext. Default ist das original TEI/XML (${TEI_MEDIA_TYPE}); ` +
					`mediaType=text/html gibt das vorgerenderte HTML-Fragment, text/plain den Lesetext.`,
				operationId: "dtsDocument",
				parameters: [
					resourceParam,
					refParam,
					startParam,
					endParam,
					treeParam,
					{
						name: "mediaType",
						in: "query",
						description:
							`Antwortformat. ${TEI_MEDIA_TYPE} (Default, original TEI), text/html ` +
							`(gerendertes Fragment) oder text/plain (Lesetext).`,
						schema: {
							type: "string",
							enum: [...SUPPORTED_MEDIA_TYPES],
							default: TEI_MEDIA_TYPE,
						},
					},
				],
				responses: {
					"200": {
						description: "Volltext im gewählten Format.",
						content: {
							[TEI_MEDIA_TYPE]: {
								schema: { type: "string", description: "Original-TEI/XML des Dokuments." },
							},
							"text/html": {
								schema: { type: "string", description: "Vorgerendertes HTML-Fragment." },
							},
							"text/plain": {
								schema: { type: "string", description: "Normalisierter Lesetext (Body)." },
							},
						},
					},
					"400": errorResponse("Ungültige Parameter oder nicht unterstützter mediaType."),
					"404": errorResponse("Unbekannte Resource oder ref/start/end ≠ \"1\"."),
					"502": errorResponse("Die TEI/XML-Quelle der Resource ist nicht verfügbar."),
					"429": rateLimited,
				},
			},
		},
	},
	components: {
		schemas: {
			DtsError: {
				type: "object",
				description: "Fehler-Shape (identisch zu /api/v1, damit Clients beide APIs gleich behandeln).",
				properties: {
					error: {
						type: "object",
						properties: {
							code: { type: "string", enum: [...DTS_ERROR_CODES] },
							message: { type: "string" },
							status: { type: "integer" },
						},
						required: ["code", "message", "status"],
					},
				},
				required: ["error"],
			},
			EntryPoint: {
				type: "object",
				description: "DTS-EntryPoint mit den URI-Templates der drei Operationen.",
				properties: {
					...ldBase,
					"@id": { type: "string" },
					"@type": { type: "string", const: "EntryPoint" },
					collection: { type: "string", description: "RFC-6570-URI-Template des Collection-Endpoints." },
					navigation: { type: "string", description: "RFC-6570-URI-Template des Navigation-Endpoints." },
					document: { type: "string", description: "RFC-6570-URI-Template des Document-Endpoints." },
				},
				additionalProperties: true,
			},
			Collection: {
				type: "object",
				description: "DTS-Collection (Korpus/Serie/Jahr) bzw. Resource (Dokument).",
				properties: {
					...ldBase,
					"@id": { type: "string" },
					"@type": { type: "string", enum: ["Collection", "Resource"] },
					title: { type: "string" },
					description: { type: "string" },
					totalParents: { type: "integer" },
					totalChildren: { type: "integer" },
					member: {
						type: "array",
						description: "Kinder-Collections bzw. -Resources (bei nav=children).",
						items: { type: "object", additionalProperties: true },
					},
					view: {
						type: "object",
						description: "Hydra-Paginierung (nur wenn die Member über mehrere Seiten gehen).",
						additionalProperties: true,
					},
				},
				additionalProperties: true,
			},
			Navigation: {
				type: "object",
				description: "DTS-Navigation: die zitierbaren Einheiten einer Resource.",
				properties: {
					...ldBase,
					"@id": { type: "string" },
					"@type": { type: "string", const: "Navigation" },
					resource: { type: "object", description: "Die Resource samt CitationTree.", additionalProperties: true },
					member: {
						type: "array",
						description: "CitableUnits (hier genau eine, identifier \"1\").",
						items: { $ref: "#/components/schemas/CitableUnit" },
					},
				},
				additionalProperties: true,
			},
			CitableUnit: {
				type: "object",
				properties: {
					"@type": { type: "string", const: "CitableUnit" },
					identifier: { type: "string", example: "1" },
					level: { type: "integer" },
					parent: { type: ["string", "null"] },
					citeType: { type: "string", const: CITE_TYPE_DOCUMENT },
				},
				additionalProperties: true,
			},
		},
	},
};
