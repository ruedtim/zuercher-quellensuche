/**
 * Die Editionen des Index `editions` und was der Aufbau je Edition wissen muss: Kennung und
 * Zitierform eines Stücks, Permalink, Bilddienst, Bildnachweis, Verweise der Edition auf
 * eigene Stücke. Dazu das Einlesen der Rechtsquellen-Dateien in Stücke (Grundtext und weitere
 * Überlieferungen) und der Teil (Band) eines Stücks.
 *
 * - QZH (stazh/qzh-data, Branch `main`): eine Datei je Stück, `quellenstuecke/QZH_nnn.xml`.
 * - Zürcher Rechtsquellen (SSRQ ZH, stazh/erqzh-data, eingefroren 2024): je Band ein Ordner
 *   (`ZH_NF_II_3/`), je Text eines Stücks eine Datei: `SSRQ_ZH_NF_II_3_047.xml` bzw. `…_047_1`
 *   = Grundtext, `…_047_2`, `…_047_3` = weitere Überlieferungen desselben Stücks (nur die
 *   Beschreibung der Vorlage, ohne Text – so zeigt es auch die Edition). Einleitungen,
 *   Vorworte und Quellenverzeichnisse (`…_000a_Vorwort`), `volinfo.xml` und die
 *   Literaturliste sind keine Stücke. Nummern zählen je Band.
 *
 * Pur, unit-getestet in editionSources.test.ts.
 */

import { ssrqLabel, ssrqParts } from "./editionLinks.ts";

export type EditionId = "qzh" | "ssrq";

export const EDITION_IDS: readonly EditionId[] = ["qzh", "ssrq"];

export interface EditionSource {
  edition: EditionId;
  /** Permalink des Stücks in der Edition. */
  permalink: (localId: string) => string;
  /** IIIF-Bilddienst eines Bildes aus `pb/@facs` (ohne e-manuscripta-Canvas). */
  imageService: (facs: string) => string;
  /** Zitierform des Stücks («QZH_401», «SSRQ ZH NF II/3 Nr. 47»). */
  label: (localId: string) => string;
  /** Archiv der Vorlage für den Bildnachweis, wenn es nicht das Staatsarchiv ist (aus der Signatur). */
  imageCredit: (signature: string) => string | undefined;
  /** Verweis der Edition (`ref/@target`) auf ein Stück derselben Edition ⇒ dessen Kennung, sonst null. */
  ownTarget: (target: string) => string | null;
  /** Datum des Stücks = Datum des Originals (`filiation[@type=original]`), nicht der Vorlage
   *  (RenderOptions.originalDateFirst). */
  originalDateFirst: boolean;
}

const QZH_TARGET = /^https?:\/\/qzh\.sources-online\.org\/quellenstuecke\/(QZH_\d+)\/?$/;
const SSRQ_BASE = "https://rechtsquellen.sources-online.org";
/** Kennung eines Rechtsquellen-Stücks: Band und dreistellige Nummer, ohne Textnummer. */
const SSRQ_PIECE = /^SSRQ_(ZH_(?:NF|AF)_[IVX]+(?:_\d{1,2}){0,2})_(\d{3})$/;
const SSRQ_TARGET =
  /^(?:https?:\/\/rechtsquellen\.sources-online\.org)?\/(?:suche\/detail|ZH_(?:NF|AF)_[IVX]+(?:_\d{1,2}){0,2})\/(SSRQ_ZH_(?:NF|AF)_[IVX]+(?:_\d{1,2}){0,2}_\d{3})(?:_\d{1,2})?\/?$/;

/** Kennung des Stücks zu einer Datei der Rechtsquellen («SSRQ_ZH_NF_II_3_047_2» ⇒
 *  «SSRQ_ZH_NF_II_3_047»); keine Stückdatei ⇒ null. */
export function ssrqPieceId(fileId: string): string | null {
  const p = ssrqParts(fileId);
  return p ? `SSRQ_${p.volume}_${String(p.nr).padStart(3, "0")}` : null;
}

/** Archive der Vorlagen (Signatur-Präfix der Rechtsquellen) für den Bildnachweis. */
const ARCHIVES: Readonly<Record<string, string>> = {
  STAW: "Stadtarchiv Winterthur",
  StArZH: "Stadtarchiv Zürich",
  ZBZ: "Zentralbibliothek Zürich",
  winbib: "Winterthurer Bibliotheken",
  StiASG: "Stiftsarchiv St. Gallen",
  BBB: "Burgerbibliothek Bern",
  StASH: "Staatsarchiv Schaffhausen",
  KAE: "Klosterarchiv Einsiedeln",
};
/** Gemeinde- und Kirchgemeindearchive: Präfix, dann der Ort («PGA Hettlingen I A 2»). */
const LOCAL_ARCHIVES: Readonly<Record<string, string>> = {
  PGA: "Gemeindearchiv",
  ZGA: "Zivilgemeindearchiv",
  ERKGA: "Archiv der reformierten Kirchgemeinde",
};

/** Bildnachweis einer Vorlage nach ihrer Signatur: andere Archive mit Namen, das
 *  Staatsarchiv (und Unbekanntes) ⇒ undefined (Nachweis «Staatsarchiv» wie bei den QZH). */
export function ssrqImageCredit(signature: string): string | undefined {
  const m = /^\s*(\S+)\s+(.*)$/.exec(signature);
  if (!m || m[1] === "StAZH") return undefined;
  if (ARCHIVES[m[1]]) return ARCHIVES[m[1]];
  const local = LOCAL_ARCHIVES[m[1]];
  if (!local) return undefined;
  // Ort = Wörter bis zur ersten Signaturstufe (römische Zahl oder Ziffer).
  const place: string[] = [];
  for (const w of m[2].split(/\s+/)) {
    if (/^(?:[IVX]+|\d.*|[A-Z])[,.]?$/.test(w)) break;
    place.push(w.replace(/,$/, ""));
  }
  return place.length > 0 ? `${local} ${place.join(" ")}` : local;
}

export const EDITION_SOURCES: Readonly<Record<EditionId, EditionSource>> = {
  qzh: {
    edition: "qzh",
    permalink: (id) => `https://qzh.sources-online.org/quellenstuecke/${id}`,
    imageService: (facs) => `https://media.sources-online.org/iiif/2/qzh!${encodeURIComponent(facs)}`,
    label: (id) => id,
    imageCredit: () => undefined,
    ownTarget: (target) => QZH_TARGET.exec(target.trim())?.[1] ?? null,
    originalDateFirst: false,
  },
  ssrq: {
    edition: "ssrq",
    permalink: (id) => {
      const m = SSRQ_PIECE.exec(id);
      return m ? `${SSRQ_BASE}/${m[1]}/${id}` : SSRQ_BASE;
    },
    imageService: (facs) => `https://media.sources-online.org/iiif/2/erqzh!${encodeURIComponent(facs)}`,
    label: (id) => {
      const m = SSRQ_PIECE.exec(id);
      return m ? ssrqLabel(m[1], Number(m[2])) : id;
    },
    imageCredit: ssrqImageCredit,
    ownTarget: (target) => SSRQ_TARGET.exec(target.trim())?.[1] ?? null,
    originalDateFirst: true,
  },
};

/** Eine Datei eines Stücks (Grundtext oder weitere Überlieferung). */
export interface PieceFile {
  fileId: string;
  /** Textnummer (`_2` ⇒ 2), Grundtext ohne Zusatz ⇒ null. */
  part: number | null;
}

/** Ein Stück der Rechtsquellen: Band, Kennung, Grundtext, weitere Überlieferungen. */
export interface SsrqPieceFiles {
  volume: string;
  localId: string;
  main: PieceFile;
  witnesses: PieceFile[];
}

const natural = new Intl.Collator("de", { numeric: true }).compare;

/** Dateinamen eines Bandes der Rechtsquellen → Stücke (natürlich sortiert). Grundtext ist der
 *  Text ohne Zusatz bzw. `_1`; fehlt er, der Text mit der kleinsten Nummer. */
export function groupSsrqFiles(fileNames: readonly string[]): SsrqPieceFiles[] {
  const by = new Map<string, { volume: string; files: PieceFile[] }>();
  for (const name of fileNames) {
    if (!name.endsWith(".xml")) continue;
    const fileId = name.slice(0, -4);
    const p = ssrqParts(fileId);
    if (!p) continue;
    const localId = `SSRQ_${p.volume}_${String(p.nr).padStart(3, "0")}`;
    const e = by.get(localId) ?? { volume: p.volume, files: [] };
    e.files.push({ fileId, part: p.part });
    by.set(localId, e);
  }
  const out: SsrqPieceFiles[] = [];
  for (const [localId, { volume, files }] of by) {
    const sorted = [...files].sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
    const mainIdx = Math.max(0, sorted.findIndex((f) => f.part == null || f.part === 1));
    const [main] = sorted.splice(mainIdx, 1);
    out.push({ volume, localId, main, witnesses: sorted });
  }
  return out.sort((a, b) => natural(a.localId, b.localId));
}

/** Teil (Band) eines Stücks der Rechtsquellen aus `volinfo.xml`: «SSRQ ZH NF II/3: Die
 *  Landvogtei Greifensee». Ohne `idno[@type=human]` die Zitierform aus dem Ordnernamen, ohne
 *  «Band n:» im Titel nur sie. */
export function ssrqPart(volume: string, volinfoXml: string | undefined): string {
  const human =
    /<idno\b[^>]*type="human"[^>]*>([^<]+)<\/idno>/.exec(volinfoXml ?? "")?.[1]?.replace(/\s+/g, " ").trim() ||
    ssrqLabel(volume, 1).replace(/ Nr\. 1$/, "");
  const title = /<titleStmt>\s*<title\b[^>]*>([\s\S]*?)<\/title>/.exec(volinfoXml ?? "")?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const band = /Band\s+\d+\s*:\s*(.+)$/.exec(title)?.[1]?.trim();
  return band ? `${human}: ${band}` : human;
}
