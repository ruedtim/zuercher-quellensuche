// Meili-Clients der Web-App (meili.ts, catalog.ts, catalogRegister.ts, ehedaten.ts,
// editionTexts.ts; ein neuer Client entsteht ebenso hier): unkomprimierte Antworten.
// $env-frei → meiliClient.test.ts.
import { MeiliSearch } from "meilisearch";

/**
 * Antworten unkomprimiert: Nodes `fetch` (und damit meilisearch-js) bietet gzip an, Meili
 * komprimiert dann jede Antwort und schickt sie in Stücken – auf dem Mac (Docker) ~45 ms je
 * Antwort, auch bei wenigen Bytes, auf Prod 0,3–0,7 ms. Web-App und Meili laufen auf demselben
 * Host, Kompression spart dort nichts.
 */
export const MEILI_REQUEST_HEADERS: Readonly<Record<string, string>> = { "Accept-Encoding": "identity" };

export function createMeiliClient(host: string, apiKey: string): MeiliSearch {
	return new MeiliSearch({ host, apiKey, requestConfig: { headers: { ...MEILI_REQUEST_HEADERS } } });
}
