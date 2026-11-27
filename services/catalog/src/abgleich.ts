/**
 * Abgleich Archivkatalog ↔ Plattform für die Zentralen Serien (nur lesend).
 *
 * Katalog-Seite: die Einheiten mit Weblink «Volltext und Digitalisat» aus dem Export des
 * stazh-scrapers (links.ts `zsDoc`, `isZsUnit`). Plattform-Seite: id, Serie, `archiveId` und
 * `resolutionId` aller Dokumente der Serien ABl/KRP/OS/RRB – aus dem Abzug
 * `platform-docs.jsonl.gz` (refresh.sh, platform_docs.py) oder direkt aus dem Meili-Index
 * `documents` (per SSH-Tunnel und Such-Key, CLAUDE.md «Lokaler Dev-Meili»).
 *
 * Das Plattform-Dokument jedes Weblinks sucht derselbe Code wie der Aufbau (platform.ts:
 * Weblink-ID, «_t», ohne Bindestrich, über die `archiveId` des Dokuments, Stufe 2). Gemeldet
 * wird, was im Katalog oder in den TEI-Dateien zu berichtigen ist (output/abgleich.md,
 * abgleich-korrekturen.md und CSV):
 * - Katalog: Weblink auf ein Dokument, das es nicht gibt; Weblink mit «_-_» (Doppelbeschlüsse);
 *   Weblink mit anderer ID, als das Dokument trägt, das die Einheit nennt; Weblink auf das
 *   Dokument einer anderen Einheit; zwei Weblinks auf dasselbe Dokument.
 * - TEI: `archiveLink` nennt eine andere Einheit als die, deren Weblink aufs Dokument zeigt;
 *   `archiveLink` auf eine Katalog-ID, die es nicht gibt (erst nach vollständigem Crawl
 *   aussagekräftig); Beschlussnummer (`idno`, `resolutionId`) ≠ Nummer der Dokument-ID.
 *
 *   npx tsx src/main.ts abgleich --input=<export.jsonl.gz> --platform=<platform-docs.jsonl.gz> [--out=<dir>]
 *   MEILI_URL=http://localhost:7701 MEILI_KEY=<Such-Key> npx tsx src/main.ts abgleich --input=<export.jsonl.gz>
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MeiliSearch } from "meilisearch";
import { parseCatalogDate } from "./dates.ts";
import { isZsUnit, zsDoc } from "./links.ts";
import { readJsonl } from "./load.ts";
import { archiveIdOf, PlatformIndex, viaLabel, type PlatformDocRef, type PlatformTarget } from "./platform.ts";
import type { CatalogRecord } from "./types.ts";

const ZS = ["ABl", "KRP", "OS", "RRB"];
const PAGE = 10_000;

/** Eine Katalogeinheit mit ZS-Weblink (aus dem Export). */
export interface AbgleichUnit {
  id: number;
  signature: string;
  /** Erste Zeile des Titels. */
  title: string;
  year: number | null;
  weblink: { series: string; id: string };
  /** Bildet ein Dokument ab (Signatur der Serien); sonst ein Verweis (Urkunde → Beschluss). */
  zsUnit: boolean;
}

export interface AbgleichInput {
  units: AbgleichUnit[];
  platform: PlatformIndex;
  /** Alle Katalog-IDs des Exports (auch ohne Weblink), um «nicht im Export» zu erkennen. */
  catalogIds: ReadonlySet<number>;
  /** Signaturen der Einheiten ohne Weblink, die ein Dokument als archiveLink nennt (Liste). */
  signatures?: ReadonlyMap<number, string>;
}

export type KorrekturArt =
  | "weblink-fehlt"
  | "weblink-bindestrich"
  | "weblink-id"
  | "weblink-anderes-dokument"
  | "weblink-doppelt"
  | "archivelink"
  | "archivelink-unbekannt"
  | "beschlussnummer";

export interface Korrektur {
  art: KorrekturArt;
  /** Wo zu berichtigen: im Online-Archivkatalog (Weblink) oder in der TEI-Datei. */
  ort: "Katalog" | "TEI";
  /** Die betroffene Katalogeinheit (Katalog) bzw. die Einheit, die das Dokument abbildet (TEI). */
  katalogId: number | null;
  signatur: string;
  titel: string;
  /** Plattform-Dokument (bei «weblink-fehlt» die Weblink-ID). */
  dokument: string;
  ist: string;
  soll: string;
  hinweis: string;
}

export interface AbgleichResult {
  /** Wie die Weblinks aufgelöst wurden (Aufbau: docId). */
  via: Map<string, number>;
  missingOnPlatform: Array<{ catalogId: number; docId: string; series: string; year: number | null }>;
  /** TEI-archiveLink ≠ Einheit mit Weblink aufs Dokument (wie bisher, für abgleich-widersprueche.csv). */
  mismatches: Array<{ docId: string; archiveId: string; catalogId: number }>;
  notInExport: Array<{ docId: string; series: string; archiveId: string }>;
  corrections: Korrektur[];
  platformCount: number;
  catalogCount: number;
}

/** Plattform-IDs tragen bei getippten Fassungen «_t»; die Plattform des Staatsarchivs kennt
 *  die ID ohne (Weblinks ohne «_t» funktionieren dort, geprüft 2026-11-09). */
export const upstreamId = (id: string) => id.replace(/_t$/, "");

/** Beschlussnummer aus der Dokument-ID: «MM_2_3_RRB_1831_0882» → «1831/0882». */
export function idResolutionNumber(docId: string): string | null {
  const m = /^MM_\d+_\d+_(?:RRB|KRP)_(\d{4})_(?:(\d{3})_)?(\d{4}[a-z]?)(?:_t)?$/.exec(docId);
  return m ? `${m[1]}/${m[2] ? `${m[2]}/` : ""}${m[3]}` : null;
}

/** Pur, unit-getestet in abgleich.test.ts. */
export function compare(input: AbgleichInput): AbgleichResult {
  const { platform } = input;
  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const first = new Map<number, PlatformTarget | null>(input.units.map((u) => [u.id, platform.locate(u.id, u.weblink)]));
  const located = (id: number) => first.get(id)?.id;
  const res: AbgleichResult = {
    via: new Map(),
    missingOnPlatform: [],
    mismatches: [],
    notInExport: [],
    corrections: [],
    platformCount: platform.size,
    catalogCount: input.units.length,
  };
  const signatureOf = (id: number | null) => (id === null ? "" : (unitById.get(id)?.signature ?? input.signatures?.get(id) ?? ""));
  const label = (id: number | null) => [id ?? "", signatureOf(id)].filter((x) => x !== "").join(" ");
  const fix = (k: Omit<Korrektur, "signatur" | "titel"> & { unit?: AbgleichUnit }) => {
    const { art, ort, katalogId, dokument, ist, soll, hinweis, unit } = k;
    const signatur = unit?.signature ?? signatureOf(katalogId);
    res.corrections.push({ art, ort, katalogId, signatur, titel: unit?.title ?? "", dokument, ist, soll, hinweis });
  };
  /** Plattform-Dokument → Einheiten, deren Weblink (nach Stufe 2) darauf zeigt. */
  const depicting = new Map<string, number[]>();

  for (const u of input.units) {
    const t = platform.settle(u.id, first.get(u.id) ?? null, located);
    const viaKey = t ? (t.via === "variant" && t.id === `${u.weblink.id}_t` ? "t" : t.via) : null;
    if (t) {
      const label = viaLabel(t, u.weblink.id);
      res.via.set(label, (res.via.get(label) ?? 0) + 1);
    }
    if (!t) {
      res.missingOnPlatform.push({ catalogId: u.id, docId: u.weblink.id, series: u.weblink.series, year: u.year });
      fix({
        art: "weblink-fehlt",
        ort: "Katalog",
        katalogId: u.id,
        unit: u,
        dokument: u.weblink.id,
        ist: u.weblink.id,
        soll: "",
        hinweis: "Kein Plattform-Dokument mit dieser ID und keines, das die Einheit nennt",
      });
      continue;
    }
    if (viaKey === "variant") {
      fix({ art: "weblink-bindestrich", ort: "Katalog", katalogId: u.id, unit: u, dokument: t.id, ist: u.weblink.id, soll: upstreamId(t.id), hinweis: "Doppelbeschluss: ID ohne «-»" });
    } else if (viaKey === "archiveId") {
      fix({ art: "weblink-id", ort: "Katalog", katalogId: u.id, unit: u, dokument: t.id, ist: u.weblink.id, soll: upstreamId(t.id), hinweis: "Das Dokument nennt die Einheit als archiveLink" });
    } else if (viaKey === "switched") {
      const other = archiveIdOf(platform.get(first.get(u.id)?.id ?? "") ?? {});
      fix({
        art: "weblink-anderes-dokument",
        ort: "Katalog",
        katalogId: u.id,
        unit: u,
        dokument: t.id,
        ist: u.weblink.id,
        soll: upstreamId(t.id),
        hinweis: `Der Weblink trifft das Dokument von ${label(other)}; ${t.id} nennt diese Einheit`,
      });
    }
    if (!u.zsUnit) continue; // Verweise (Urkunde → Beschluss) nennt das Dokument nicht.
    const list = depicting.get(t.id);
    if (list) list.push(u.id);
    else depicting.set(t.id, [u.id]);
  }

  for (const [docId, unitIds] of depicting) {
    const d = platform.get(docId);
    const a = d ? archiveIdOf(d) : null;
    if (a !== null && unitIds.includes(a)) {
      for (const other of unitIds.filter((id) => id !== a)) {
        fix({
          art: "weblink-doppelt",
          ort: "Katalog",
          katalogId: other,
          unit: unitById.get(other),
          dokument: docId,
          ist: unitById.get(other)?.weblink.id ?? "",
          soll: "",
          hinweis: `Auch ${label(a)} verlinkt das Dokument, und es nennt jene Einheit`,
        });
      }
      continue;
    }
    // Das Dokument nennt eine Einheit, deren Weblink anderswohin zeigt (oder keine).
    const unit = unitIds.length === 1 ? unitById.get(unitIds[0]) : undefined;
    if (!unit) continue; // mehrere Weblinks und keiner passt zur archiveId: nicht entscheidbar
    res.mismatches.push({ docId, archiveId: a === null ? "" : String(a), catalogId: unit.id });
    const elsewhere = a === null ? undefined : located(a);
    fix({
      art: "archivelink",
      ort: "TEI",
      katalogId: unit.id,
      unit,
      dokument: docId,
      ist: a === null ? "" : label(a),
      soll: `${unit.id}`,
      hinweis:
        a === null
          ? "Ohne archiveLink"
          : `Die genannte Einheit ${elsewhere ? `verlinkt ${elsewhere}` : input.catalogIds.has(a) ? "hat keinen Weblink" : "fehlt im Export"}`,
    });
  }

  for (const d of platform.docs()) {
    if (!ZS.includes(d.series)) continue;
    const a = archiveIdOf(d);
    if (a !== null && !input.catalogIds.has(a)) {
      res.notInExport.push({ docId: d.id, series: d.series, archiveId: String(a) });
      if (!depicting.has(d.id)) {
        fix({ art: "archivelink-unbekannt", ort: "TEI", katalogId: null, dokument: d.id, ist: String(a), soll: "", hinweis: "Katalog-ID nicht im Export (gelöscht oder neu vergeben?)" });
      }
    }
    const nr = idResolutionNumber(d.id);
    if (nr && d.resolutionId && d.resolutionId !== nr) {
      // Die Einheit mit Weblink aufs Dokument (sonst die genannte): nennt die richtige Nummer.
      const owner = depicting.get(d.id)?.[0] ?? a;
      fix({ art: "beschlussnummer", ort: "TEI", katalogId: owner, unit: owner === null ? undefined : unitById.get(owner), dokument: d.id, ist: d.resolutionId, soll: nr, hinweis: "Beschlussnummer (idno) ≠ Nummer der Dokument-ID" });
    }
  }
  return res;
}

async function loadPlatformFromMeili(): Promise<PlatformIndex> {
  const host = process.env.MEILI_URL ?? "http://localhost:7701";
  const apiKey = process.env.MEILI_KEY ?? process.env.MEILI_MASTER_KEY;
  if (!apiKey) throw new Error("--platform=<platform-docs.jsonl.gz> oder MEILI_KEY (Such-Key) fehlt");
  const index = new MeiliSearch({ host, apiKey }).index("documents");
  const out: PlatformDocRef[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await index.getDocuments<PlatformDocRef>({
      fields: ["id", "series", "archiveId", "dateYear", "resolutionId"],
      filter: `series IN [${ZS.join(", ")}]`,
      limit: PAGE,
      offset,
    });
    out.push(...page.results);
    if (page.results.length < PAGE) break;
  }
  return new PlatformIndex(out);
}

const ART_TEXT: Record<KorrekturArt, string> = {
  "weblink-fehlt": "Weblink auf ein Dokument, das es nicht gibt",
  "weblink-bindestrich": "Weblink mit «_-_» (Doppelbeschluss), richtig ohne Bindestrich",
  "weblink-id": "Weblink mit anderer ID als das Dokument, das die Einheit nennt",
  "weblink-anderes-dokument": "Weblink auf das Dokument einer anderen Einheit",
  "weblink-doppelt": "Zweiter Weblink auf ein Dokument, das eine andere Einheit nennt",
  archivelink: "archiveLink nennt eine andere Einheit als die mit Weblink aufs Dokument",
  "archivelink-unbekannt": "archiveLink auf eine Katalog-ID, die es nicht gibt",
  beschlussnummer: "Beschlussnummer weicht von der Dokument-ID ab",
};

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (rows: Array<Record<string, unknown>>) =>
  rows.length === 0 ? "" : [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map(csvCell).join(","))].join("\n") + "\n";

const mdCell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Korrekturliste als Markdown: je Art eine Tabelle, lange Listen gekürzt (vollständig im CSV). */
export function correctionsMarkdown(corrections: readonly Korrektur[], created: string, maxRows = 40): string {
  const parts = [
    "# Korrekturen Archivkatalog ↔ Plattform (Zentrale Serien)",
    "",
    `Erzeugt ${created} aus dem Export des Online-Archivkatalogs und dem Index der Plattform zentraleserien.ch. IDs wie auf www.zentraleserien.zh.ch (ohne das «_t» der getippten Fassungen). Vollständig: \`abgleich-korrekturen.csv\`.`,
  ];
  for (const ort of ["Katalog", "TEI"] as const) {
    const rows = corrections.filter((c) => c.ort === ort);
    parts.push("", ort === "Katalog" ? "## Im Online-Archivkatalog (Weblinks)" : "## In den TEI-Dateien der Zentralen Serien", "");
    if (rows.length === 0) {
      parts.push("Keine.");
      continue;
    }
    for (const art of Object.keys(ART_TEXT) as KorrekturArt[]) {
      const list = rows.filter((c) => c.art === art);
      if (list.length === 0) continue;
      parts.push(`### ${ART_TEXT[art]}: ${list.length.toLocaleString("de-CH")}`, "");
      parts.push("| Katalog-ID | Signatur | Dokument | ist | soll | Hinweis |", "|---:|---|---|---|---|---|");
      for (const c of list.slice(0, maxRows)) {
        parts.push(`| ${c.katalogId ?? ""} | ${mdCell(c.signatur)} | ${mdCell(c.dokument)} | ${mdCell(c.ist)} | ${mdCell(c.soll)} | ${mdCell(c.hinweis)} |`);
      }
      if (list.length > maxRows) parts.push(`| … | ${(list.length - maxRows).toLocaleString("de-CH")} weitere im CSV | | | | |`);
      parts.push("");
    }
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export async function runAbgleich(opts: { input: string; platform?: string; out: string }): Promise<void> {
  const platform = opts.platform ? await PlatformIndex.fromAsync(readJsonl<PlatformDocRef>(opts.platform)) : await loadPlatformFromMeili();
  const units: AbgleichUnit[] = [];
  const catalogIds = new Set<number>();
  const signatures = new Map<number, string>();
  for await (const rec of readJsonl<CatalogRecord>(opts.input)) {
    catalogIds.add(rec.id);
    const signature = (rec.signature ?? "").trim();
    const zs = zsDoc(rec);
    if (!zs) {
      if (platform.claiming(rec.id).length > 0) signatures.set(rec.id, signature);
      continue;
    }
    units.push({
      id: rec.id,
      signature,
      title: (rec.title ?? "").split("\n")[0].trim(),
      year: parseCatalogDate(rec.date_text)?.from ?? null,
      weblink: zs,
      zsUnit: isZsUnit(rec),
    });
  }
  const r = compare({ units, platform, catalogIds, signatures });
  const created = new Date().toISOString();
  const bySeriesYear = new Map<string, number>();
  for (const m of r.missingOnPlatform) {
    const k = `${m.series} ${m.year ?? "?"}`;
    bySeriesYear.set(k, (bySeriesYear.get(k) ?? 0) + 1);
  }
  const notInExportBySeries = new Map<string, number>();
  for (const n of r.notInExport) notInExportBySeries.set(n.series, (notInExportBySeries.get(n.series) ?? 0) + 1);
  const byArt = new Map<KorrekturArt, number>();
  for (const c of r.corrections) byArt.set(c.art, (byArt.get(c.art) ?? 0) + 1);
  const md = `# Abgleich Archivkatalog ↔ Plattform (Zentrale Serien)

Erzeugt ${created}: ${catalogIds.size.toLocaleString("de-CH")} Katalogeinheiten im Export, davon ${r.catalogCount.toLocaleString("de-CH")} mit Weblink auf die Plattform; ${r.platformCount.toLocaleString("de-CH")} Plattform-Dokumente der Serien ABl, KRP, OS, RRB (${opts.platform ? `Abzug \`${opts.platform}\`` : "Index documents"}).

Plattform-Dokument der Weblinks (wie im Aufbau): ${[...r.via].map(([k, n]) => `${k} ${n.toLocaleString("de-CH")}`).join(", ")}.

## Zu berichtigen

| Art | Ort | Anzahl |
|---|---|---:|
${(Object.keys(ART_TEXT) as KorrekturArt[])
  .filter((a) => byArt.has(a))
  .map((a) => `| ${ART_TEXT[a]} | ${r.corrections.find((c) => c.art === a)?.ort} | ${byArt.get(a)?.toLocaleString("de-CH")} |`)
  .join("\n")}

Liste: \`abgleich-korrekturen.md\` (gekürzt), \`abgleich-korrekturen.csv\` (vollständig).

## Im Katalog, auf der Plattform nicht vorhanden: ${r.missingOnPlatform.length}

| Serie Jahr | Einheiten |
|---|---:|
${[...bySeriesYear].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `| ${k} | ${n} |`).join("\n")}

Liste: \`abgleich-fehlt-auf-plattform.csv\`. Im Aufbau werden diese Einheiten eigene Treffer ohne Dokumentlink.

## Widersprüche (archiveLink ≠ Einheit mit Weblink aufs Dokument): ${r.mismatches.length}

Liste: \`abgleich-widersprueche.csv\`. Die Dokumentseite zeigt die Einheit mit Weblink (apps/web \`pickDocumentCatalog\`).

## Plattform-Dokumente, deren Katalogeinheit im Export fehlt: ${r.notInExport.length}

${[...notInExportBySeries].map(([s, n]) => `${s} ${n}`).join(", ") || "–"}.
`;
  await writeFile(join(opts.out, "abgleich.md"), md);
  await writeFile(join(opts.out, "abgleich-korrekturen.md"), correctionsMarkdown(r.corrections, created));
  await writeFile(join(opts.out, "abgleich-korrekturen.csv"), csv(r.corrections as unknown as Array<Record<string, unknown>>));
  await writeFile(join(opts.out, "abgleich-fehlt-auf-plattform.csv"), csv(r.missingOnPlatform));
  await writeFile(join(opts.out, "abgleich-widersprueche.csv"), csv(r.mismatches));
  console.log(
    `[catalog] Abgleich: ${r.missingOnPlatform.length} fehlen auf der Plattform, ${r.mismatches.length} Widersprüche, ${r.corrections.length} Korrekturen, ${r.notInExport.length} nicht im Export → ${opts.out}`,
  );
}
