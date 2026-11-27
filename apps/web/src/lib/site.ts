// Name und Einordnung der Website – EINZIGE Stelle für den Namen (Seitentitel, About,
// Impressum, OpenAPI, MCP-Titel, Export- und ZIP-README). Statisch daneben und von
// site.test.ts geprüft: static/llms.txt (kann nicht importieren). Pur.
// Adresse: siteAddress.js (hier weitergereicht).
//
// Der Name meint die Plattform. Der Bestand «Zentrale Serien» (Reiter, Korpus, DTS-
// Sammlung) heisst weiter so; Adresse und technische Kennungen sind unabhängig davon.
//
// Entschieden (Tim 2026-11-23): Titel und Untertitel. Seitentitel tragen nur den Titel; der
// Untertitel steht, wo die Seite sich erklärt (Kopf, About, Impressum, API, MCP). Der Stempel
// im Layout sagt «inoffizieller Prototyp» (Wortlaut Tim, nicht «privates Projekt») und gehört
// nicht in den Namen.
export { LEGACY_HOSTS, SITE_HOST, SITE_URL } from "./siteAddress.js";

export const SITE_NAME = "Zürcher Quellensuche";
export const SITE_SUBTITLE = "Digitale Zugänge zum Staatsarchiv Kanton Zürich";

// Steht überall dort, wo Titel oder Untertitel amtlich klingen könnten.
export const SITE_DISCLAIMER =
	"Inoffizieller Prototyp von Tim Rüdiger – kein Angebot des Staatsarchivs oder des Kantons Zürich.";

// Bild der Linkvorschau (og:image der Startseite). Vorschaudienste merken sich das Bild je
// Adresse: bei einem neuen Bild den Dateinamen ändern.
export const SITE_PREVIEW = {
	path: "/vorschau.jpg",
	width: 1200,
	height: 630,
	alt: "Zürcher Quellensuche, archivquellen.ch, Stempel «Inoffizieller Prototyp»; daneben ein rosa Frosch",
};

/** Öffentliche Kopie des Quellcodes (scripts/spiegel-push.sh); verlinkt auf About und Architektur. */
export const SOURCE_REPO_URL = "https://github.com/ruedtim/zuercher-quellensuche";

/** Seitentitel: «Impressum | <Name>», ohne Teil nur der Name. */
export function pageTitle(...parts: string[]): string {
	return [...parts.filter(Boolean), SITE_NAME].join(" | ");
}
