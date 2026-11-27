import type { ParsedTei, SeriesAbbr } from "./types.ts";

/**
 * IIIF-Auflösung. Zwei Quellen:
 *
 * 1. **Lokal** (ABl): `<surface>` mit `<graphic url="*.tif">`. Wir generieren
 *    ein IIIF Presentation v3 Manifest und schreiben es nach
 *    `/iiif/{abbr}/{id}/manifest.json`. Image-Service: Cantaloupe via
 *    `https://media.sources-online.org/iiif/2/zszh!ABl!{tiff-name}`.
 *
 * 2. **Extern** (OS/KRP/RRB): `<bibl><figure><graphic url="*.pdf">`. Es gibt
 *    bereits ein vorab erzeugtes Manifest auf `zszh.sources-online.org`. Wir
 *    erzeugen kein eigenes, sondern referenzieren die externe URL.
 *
 * 3. **Lokal mit fremdem Bildserver** (RM): `<graphic url>` ist der Basis-URL
 *    eines IIIF-Image-Service (Transkribus `files.transkribus.eu/iiif/2/<Key>`).
 *    Transkribus hat keine Presentation-Manifeste; wir erzeugen eines je
 *    Sitzung, die Bilder lädt der Browser direkt vom Bildserver (Plan E3).
 */

const SOURCES_ONLINE_MANIFEST_BASE = "https://zszh.sources-online.org/manifests";
const ABL_IMAGE_BASE = "https://media.sources-online.org/iiif/2/zszh!ABl!";
const TRANSKRIBUS_IIIF = /^https:\/\/files\.transkribus\.eu\/iiif\/2\/[A-Z]+$/;

export interface IIIFLocalResult {
  kind: "local";
  /** Pfad relativ zum render-output-Root, z. B. `iiif/ABl/ABl_1965__S__327-328_/manifest.json`. */
  outputPath: string;
  /** Public-URL (passend zu manifestUrl im MeiliDoc). */
  publicUrl: string;
  manifest: IIIFManifestV3;
}

export interface IIIFExternalResult {
  kind: "external";
  publicUrl: string;
}

export interface IIIFNoneResult {
  kind: "none";
}

export type IIIFResult = IIIFLocalResult | IIIFExternalResult | IIIFNoneResult;

export function resolveIIIF(parsed: ParsedTei, opts: { publicBaseUrl: string }): IIIFResult {
  const { meta, surfaces, biblGraphicUrl } = parsed;

  // Strategy:
  // - ABl: hat <surface> + .tif → lokal generieren
  // - OS/KRP/RRB mit .pdf in bibl/figure/graphic → extern
  // - Sonst: keine Faksimiles
  const hasLocalSurfaces =
    meta.series === "ABl" && surfaces.some((s) => s.graphicUrl && /\.tif{1,2}$/i.test(s.graphicUrl));
  const hasImageServices =
    meta.series === "RM" && surfaces.some((s) => s.graphicUrl && TRANSKRIBUS_IIIF.test(s.graphicUrl));

  if (hasLocalSurfaces || hasImageServices) {
    return buildLocalManifest(parsed, opts.publicBaseUrl);
  }

  if (biblGraphicUrl && /\.pdf$/i.test(biblGraphicUrl)) {
    const base = filenameBase(biblGraphicUrl);
    if (base) {
      const url = `${SOURCES_ONLINE_MANIFEST_BASE}/${meta.series}/${base}/info.json`;
      return { kind: "external", publicUrl: url };
    }
  }

  return { kind: "none" };
}

function buildLocalManifest(parsed: ParsedTei, publicBaseUrl: string): IIIFLocalResult {
  const { meta, surfaces, pageBreaks } = parsed;
  const manifestId = `${publicBaseUrl}/iiif/${meta.series}/${meta.id}/manifest.json`;
  const outputPath = `iiif/${meta.series}/${meta.id}/manifest.json`;

  // Abbildung pageBreak → surface über @facs (ohne #-Prefix)
  const surfaceById = new Map(surfaces.map((s) => [s.id, s]));
  const items: IIIFCanvas[] = [];

  for (let i = 0; i < pageBreaks.length; i++) {
    const pb = pageBreaks[i];
    const facs = pb.facs;
    if (!facs) continue;
    const surface = surfaceById.get(facs);
    if (!surface || !surface.graphicUrl) continue;
    const idx = i + 1;
    items.push(canvasFromSurface({
      manifestId,
      idx,
      pageLabel: pb.n || String(idx),
      surface,
      imageServiceId: imageServiceFor(meta.series, surface),
    }));
  }

  // Falls keine pb-Verknüpfung möglich: alle Surfaces direkt nehmen
  if (items.length === 0) {
    surfaces
      .filter((s) => s.graphicUrl)
      .forEach((s, i) =>
        items.push(canvasFromSurface({
          manifestId,
          idx: i + 1,
          pageLabel: String(i + 1),
          surface: s,
          imageServiceId: imageServiceFor(meta.series, s),
        })),
      );
  }

  const manifest: IIIFManifestV3 = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: manifestId,
    type: "Manifest",
    label: { de: [meta.title] },
    metadata: buildMetadataPairs(meta),
    items,
  };
  // RM: Bildnachweis statt Lizenzangabe – die Digitalisate sind keine
  // amtlichen Werke, darum kein `rights` (Plan E3).
  if (meta.series === "RM") {
    const signature = meta.stazhIdent?.split(",")[0]?.trim();
    manifest.requiredStatement = {
      label: { de: ["Digitalisat"] },
      value: { de: [`Staatsarchiv des Kantons Zürich${signature ? `, ${signature}` : ""}`] },
    };
  }

  return {
    kind: "local",
    outputPath,
    publicUrl: manifestId,
    manifest,
  };
}

function imageServiceFor(
  series: SeriesAbbr,
  surface: { graphicUrl: string | null },
): string {
  // RM: graphic/@url ist schon der Image-Service; ABl: TIFF-Name auf Cantaloupe
  if (series === "RM") return surface.graphicUrl ?? "";
  return `${ABL_IMAGE_BASE}${encodeURIComponent(surface.graphicUrl ?? "")}`;
}

function canvasFromSurface(args: {
  manifestId: string;
  idx: number;
  pageLabel: string;
  surface: { id: string; graphicUrl: string | null; width: number | null; height: number | null };
  imageServiceId: string;
}): IIIFCanvas {
  const imageServiceId = args.imageServiceId;
  const canvasId = `${args.manifestId}/canvas/${args.idx}`;
  const width = args.surface.width ?? 2000;
  const height = args.surface.height ?? 2800;

  return {
    id: canvasId,
    type: "Canvas",
    label: { de: [args.pageLabel] },
    width,
    height,
    items: [
      {
        id: `${canvasId}/page`,
        type: "AnnotationPage",
        items: [
          {
            id: `${canvasId}/annotation/1`,
            type: "Annotation",
            motivation: "painting",
            target: canvasId,
            body: {
              id: `${imageServiceId}/full/max/0/default.jpg`,
              type: "Image",
              format: "image/jpeg",
              width,
              height,
              service: [
                {
                  id: imageServiceId,
                  type: "ImageService2",
                  profile: "http://iiif.io/api/image/2/level2.json",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function buildMetadataPairs(meta: ParsedTei["meta"]): IIIFMetadataPair[] {
  const pairs: IIIFMetadataPair[] = [];
  if (meta.date) {
    pairs.push({ label: { de: ["Datum"] }, value: { de: [meta.date] } });
  }
  if (meta.stazhIdent) {
    pairs.push({ label: { de: ["Signatur"] }, value: { de: [meta.stazhIdent] } });
  }
  pairs.push({ label: { de: ["Serie"] }, value: { de: [meta.series] } });
  return pairs;
}

function filenameBase(url: string): string | null {
  const last = url.split("/").pop();
  if (!last) return null;
  return last.replace(/\.pdf$/i, "");
}

export function manifestUrlFor(parsed: ParsedTei, publicBaseUrl: string): string | null {
  const result = resolveIIIF(parsed, { publicBaseUrl });
  if (result.kind === "none") return null;
  return result.publicUrl;
}

export function seriesHasFacsimile(_series: SeriesAbbr): boolean {
  return true;
}

// --- IIIF v3 Type-Definitionen (minimal) ---

interface IIIFLangValue {
  [lang: string]: string[];
}

interface IIIFMetadataPair {
  label: IIIFLangValue;
  value: IIIFLangValue;
}

interface IIIFImageService {
  id: string;
  type: "ImageService2" | "ImageService3";
  profile: string;
}

interface IIIFImageBody {
  id: string;
  type: "Image";
  format: string;
  width: number;
  height: number;
  service: IIIFImageService[];
}

interface IIIFAnnotation {
  id: string;
  type: "Annotation";
  motivation: "painting";
  target: string;
  body: IIIFImageBody;
}

interface IIIFAnnotationPage {
  id: string;
  type: "AnnotationPage";
  items: IIIFAnnotation[];
}

interface IIIFCanvas {
  id: string;
  type: "Canvas";
  label: IIIFLangValue;
  width: number;
  height: number;
  items: IIIFAnnotationPage[];
}

export interface IIIFManifestV3 {
  "@context": "http://iiif.io/api/presentation/3/context.json";
  id: string;
  type: "Manifest";
  label: IIIFLangValue;
  metadata: IIIFMetadataPair[];
  requiredStatement?: IIIFMetadataPair;
  items: IIIFCanvas[];
}
