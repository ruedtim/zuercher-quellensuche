import { building, dev } from "$app/environment";
import { env } from "$env/dynamic/private";

export const MEILI_URL = env.MEILI_URL ?? "http://localhost:7700";
// Nur im Dev-Server ersetzt der Master-Key einen fehlenden Such-Key. Im Betrieb bliebe die Website sonst
// still mit vollen Rechten verbunden; ohne Such-Key antwortet Meili dort 401.
export const MEILI_SEARCH_KEY =
	env.MEILI_SEARCH_KEY || (dev ? env.MEILI_MASTER_KEY || "dev_master_key_change_me" : "");
if (!MEILI_SEARCH_KEY && !building) console.error("[env] MEILI_SEARCH_KEY fehlt – die Suche ist nicht verfügbar.");
export const MEILI_INDEX = env.MEILI_INDEX ?? "documents";
// Passagen-Index (chunk-level Vektoren) für die MCP-Werkzeuge passage_search und
// vector_search; fehlt er, melden beide «nicht verfügbar».
export const MEILI_CHUNK_INDEX = env.MEILI_CHUNK_INDEX ?? "chunks";
// Archivkatalog des Staatsarchivs (services/catalog); fehlt der Index oder deckt
// der Such-Key ihn nicht ab, blendet die Suchseite den Reiter aus.
export const MEILI_CATALOG_INDEX = env.MEILI_CATALOG_INDEX ?? "catalog";
// Ehedatenbank des Staatsarchivs (services/catalog, ehedaten.ts); fehlt der Index oder
// deckt der Such-Key ihn nicht ab, blendet die Suchseite den Reiter «Ehedaten» aus.
export const MEILI_EHEDATEN_INDEX = env.MEILI_EHEDATEN_INDEX ?? "ehedaten";
// Texte der Editionen (QZH …) für den Reiter «Editionen» und die Detailseiten
// /editionen/<edition>/<id> (Aufbau: services/catalog, editionsBuild.ts).
export const MEILI_EDITIONS_INDEX = env.MEILI_EDITIONS_INDEX ?? "editions";
export const EMBED_URL = env.EMBED_URL ?? "http://localhost:8001";
// GitHub-Issue-Feedback (Feedback-Button, «Zuordnung melden»). Token
// gehört NICHT hierher (Datei ist committet!), sondern in apps/web/.env (dev,
// gitignored) bzw. infra/.env (Hetzner). Leer = /api/feedback antwortet 503
// (Feature deaktiviert). GITHUB_ISSUE_REPO = Ziel-Repo (owner/repo).
export const GITHUB_TOKEN = env.GITHUB_TOKEN || "";
export const GITHUB_ISSUE_REPO = env.GITHUB_ISSUE_REPO || "";

/** Wird zum Lesen statisch erzeugter HTML-Renders verwendet. */
export const RENDER_BASE_URL = env.RENDER_BASE_URL ?? "";

/** Lokales Verzeichnis (nur in Dev relevant – in Prod liest Caddy direkt). */
export const RENDER_LOCAL_DIR = env.RENDER_LOCAL_DIR ?? "";

// Original-TEI-XML-Quelldateien (vom Indexer unter <out>/xml/<series>/<id>.xml
// abgelegt, von Caddy unter /xml/* serviert). Quelle des DTS-Document-
// Endpoints. Analog zu RENDER_*: lokales Verzeichnis (Dev/Coexist-Mount) ODER
// HTTP-Basis (Prod-Standalone). Default leer = Mount /srv/zszh teilt sich der
// Pfad mit RENDER_LOCAL_DIR (xml/ und render/ liegen nebeneinander).
/** HTTP-Basis für TEI-XML (z. B. http://caddy/xml). Leer = lokales Lesen. */
export const XML_BASE_URL = env.XML_BASE_URL ?? "";

/** Lokales Verzeichnis mit dem xml/-Unterordner (z. B. /srv/zszh). */
export const XML_LOCAL_DIR = env.XML_LOCAL_DIR ?? RENDER_LOCAL_DIR;
