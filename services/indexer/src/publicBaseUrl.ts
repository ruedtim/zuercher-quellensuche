/**
 * PUBLIC_BASE_URL-Guard. Die Basis landet in den lokal erzeugten
 * IIIF-Manifesten (ABl): Meili-`manifestUrl` und die `id`s in
 * `iiif/ABl/<id>/manifest.json` (Manifest, Canvas, AnnotationPage, Annotation).
 *
 * Früher fiel der Indexer still auf http://localhost:5173 zurück – so trug Prod
 * (Befund 2026-09-25) für ABl 1930–2001 localhost-Manifeste. Darum: fehlt die
 * Variable oder zeigt sie auf einen lokalen Host, bricht der Lauf ab, ausser
 * mit ausdrücklichem Opt-in für lokale Tests.
 */

export const ALLOW_LOCAL_BASE_URL_FLAG = "--allow-local-base-url";

/** Basis beim Opt-in ohne gesetzte PUBLIC_BASE_URL (SvelteKit-Dev-Server). */
export const LOCAL_DEV_BASE_URL = "http://localhost:5173";

const PROD_HINT = "Für Prod: PUBLIC_BASE_URL=https://zentraleserien.ch.";
const OPT_IN_HINT =
  `Nur für lokale Tests: ${ALLOW_LOCAL_BASE_URL_FLAG} ` +
  `(ohne PUBLIC_BASE_URL gilt dann ${LOCAL_DEV_BASE_URL}).`;

export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(h)
  );
}

/** true, wenn `url` auf einen lokalen Host zeigt (keine gültige URL: false). */
export function isLocalUrl(url: string): boolean {
  try {
    return isLocalHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Prüft PUBLIC_BASE_URL und liefert sie ohne abschliessenden Slash (sonst
 * entstünde `…//iiif/…`). Wirft mit einer Meldung, die sagt, was zu tun ist.
 */
export function resolvePublicBaseUrl(
  raw: string | undefined,
  opts: { allowLocal: boolean },
): string {
  const value = (raw ?? "").trim();
  if (!value) {
    if (opts.allowLocal) return LOCAL_DEV_BASE_URL;
    throw new Error(
      "PUBLIC_BASE_URL fehlt – der Indexer schreibt sie in die IIIF-Manifeste " +
        `(Meili-manifestUrl + Manifest-IDs). ${PROD_HINT} ${OPT_IN_HINT}`,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PUBLIC_BASE_URL ist keine gültige URL: "${value}". ${PROD_HINT}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`PUBLIC_BASE_URL braucht http(s): "${value}". ${PROD_HINT}`);
  }
  if (!opts.allowLocal && isLocalHostname(url.hostname)) {
    throw new Error(
      `PUBLIC_BASE_URL=${value} zeigt auf einen lokalen Host – so landen ` +
        `localhost-URLs in den IIIF-Manifesten. ${PROD_HINT} ${OPT_IN_HINT}`,
    );
  }
  return value.replace(/\/+$/, "");
}
