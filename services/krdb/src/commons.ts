/**
 * Bildinfos von Wikimedia Commons für die P18-Porträts: Vorschaubild
 * (~250 px), Masse, Dateiseite und Bildnachweis (Urheber, Lizenz).
 *
 * Die meisten Porträts sind CC BY(-SA) oder «Attribution» (ETH-Bildarchiv)
 * und verlangen Namensnennung – der Nachweis wird darum mit ins Register
 * geschrieben und auf der Detailseite angezeigt.
 */

import { USER_AGENT } from "./krdb.ts";

const API = "https://commons.wikimedia.org/w/api.php";
const BATCH = 50;
export const THUMB_WIDTH = 250;

export interface CommonsImage {
  thumb: string;
  width: number;
  height: number;
  page: string;
  artist?: string;
  credit?: string;
  license?: string;
  licenseUrl?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** extmetadata-HTML → einzeiliger Text. */
export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

/** Tracking-Parameter (utm_*) von Thumb-URLs entfernen. */
export function cleanThumbUrl(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
  return u.toString();
}

interface ApiPage {
  title: string;
  missing?: boolean;
  imageinfo?: Array<{
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

/** Dateinamen (ohne «File:») → Bildinfos; fehlende/gelöschte Dateien fehlen im Ergebnis. */
export async function fetchImageInfo(files: string[]): Promise<Map<string, CommonsImage>> {
  const out = new Map<string, CommonsImage>();
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "imageinfo",
      iiprop: "url|size|extmetadata",
      iiurlwidth: String(THUMB_WIDTH),
      iiextmetadatafilter: "Artist|Credit|LicenseShortName|LicenseUrl",
      iiextmetadatalanguage: "de",
      maxlag: "5",
      titles: batch.map((f) => `File:${f}`).join("|"),
    });
    const res = await fetch(`${API}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Commons-API: HTTP ${res.status}`);
    const json = (await res.json()) as {
      query?: { pages?: ApiPage[]; normalized?: Array<{ from: string; to: string }>; redirects?: Array<{ from: string; to: string }> };
    };
    const q = json.query ?? {};
    // Titel zurück auf die angefragten Dateinamen abbilden (Normalisierung/Weiterleitung).
    const back = new Map<string, string>();
    for (const f of batch) back.set(`File:${f}`, f);
    for (const n of [...(q.normalized ?? []), ...(q.redirects ?? [])]) {
      const orig = back.get(n.from);
      if (orig) back.set(n.to, orig);
    }
    for (const page of q.pages ?? []) {
      const info = page.imageinfo?.[0];
      const file = back.get(page.title);
      if (page.missing || !info?.thumburl || !file) continue;
      const meta = info.extmetadata ?? {};
      out.set(file, {
        thumb: cleanThumbUrl(info.thumburl),
        width: info.thumbwidth ?? THUMB_WIDTH,
        height: info.thumbheight ?? THUMB_WIDTH,
        page: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        artist: htmlToText(meta["Artist"]?.value),
        credit: htmlToText(meta["Credit"]?.value),
        license: htmlToText(meta["LicenseShortName"]?.value),
        licenseUrl: meta["LicenseUrl"]?.value || undefined,
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

/** Lädt jedes Vorschaubild einmal (Commons rendert TIFF-Thumbs beim ersten
 *  Abruf langsam) und liefert die Dateien, deren Thumb nicht als Bild kommt. */
export async function warmThumbs(images: Map<string, CommonsImage>): Promise<string[]> {
  const failed: string[] = [];
  for (const [file, img] of images) {
    try {
      const res = await fetch(img.thumb, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
      const type = res.headers.get("content-type") ?? "";
      await res.arrayBuffer();
      if (!res.ok || !/^image\/(jpeg|png|gif|webp)/.test(type)) failed.push(file);
    } catch {
      failed.push(file);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return failed;
}
