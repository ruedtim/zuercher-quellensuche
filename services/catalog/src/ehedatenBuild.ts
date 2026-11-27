/**
 * Aufbau des Index `ehedaten` (Mac): je Eheeintrag ein Dokument (ehedaten.ts), dazu ein Bericht
 * mit den Zählungen. Quelle ist der Export des Katalog-Crawls (Einheiten «…, EDB n»,
 * ehedatenCrawl.ts), wahlweise noch der Zenodo-Datensatz (CSV, bis 2026-11 die Quelle).
 *
 *   npx tsx src/main.ts ehedaten --input=<export.jsonl.gz> [--out=<dir>]
 *   npx tsx src/main.ts ehedaten --edb=<Zenodo-CSV> [--out=<dir>]
 *
 * Ausgabe: <out>/ehedaten-docs.jsonl.gz und <out>/ehedaten-report.md.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { edbRows, isEdbUnit } from "./edb.ts";
import { entryDoc, zenodoEntry, type EdbEntry, type EhedatenDoc } from "./ehedaten.ts";
import { crawlEntry, type CrawlNote, type CrawlNoteKind } from "./ehedatenCrawl.ts";
import { readJsonl, writeJsonl } from "./load.ts";
import { EHEDATEN_FOLDED_FIELDS, foldedField } from "./searchText.ts";
import type { CatalogRecord } from "./types.ts";

const fmt = (n: number) => n.toLocaleString("de-CH");
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "–");

function count<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
const top = <K>(map: Map<K, number>, n: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Herkunft der CSV aus der daneben gespeicherten Zenodo-Antwort (zenodo-record-*.json). */
async function zenodoVersion(csvPath: string): Promise<string> {
  const dir = dirname(csvPath);
  const meta = (await readdir(dir).catch(() => [])).find((f) => /^zenodo-record-\d+\.json$/.test(f));
  if (!meta) return `\`${basename(csvPath)}\``;
  const d = JSON.parse(await readFile(join(dir, meta), "utf8"));
  const m = d.metadata ?? {};
  return `\`${basename(csvPath)}\` (Zenodo-Record ${d.id}, Version ${m.version}, ${m.publication_date}, Lizenz ${m.license?.id ?? "?"})`;
}

/** Ein Eintrag der Quelle: Schlüssel für den Bericht, Eintrag oder Grund, Lesart-Notizen. */
interface SourceItem {
  key: string;
  entry: EdbEntry | null;
  reason?: string;
  notes?: CrawlNote[];
}

interface Source {
  items: AsyncIterable<SourceItem>;
  /** «aus …» im Kopf des Berichts, erst nach dem Durchlauf vollständig. */
  label: () => Promise<string>;
  /** «Einheiten im Export» bzw. «Zeilen in der CSV». */
  unit: string;
}

function zenodoSource(path: string): Source {
  return {
    unit: "Zeilen in der CSV",
    label: () => zenodoVersion(path),
    items: (async function* () {
      for (const z of edbRows(await readFile(path, "utf8"))) {
        const entry = zenodoEntry(z);
        yield { key: `${z.ID || "(ohne ID)"} ${z.Signatur}`, entry, reason: entry ? undefined : "ohne gültige ID oder Datum" };
      }
    })(),
  };
}

function crawlSource(path: string): Source {
  let first = "";
  let last = "";
  let units = 0;
  return {
    unit: "Eheeinträge im Export (Stufe Dokument, Signatur «…, EDB n»)",
    label: async () =>
      `\`${basename(path)}\` (Online-Archivkatalog des Staatsarchivs, Crawl; ${fmt(units)} Einheiten im Export, Eheeinträge abgerufen ${first.slice(0, 10)} bis ${last.slice(0, 10)})`,
    items: (async function* () {
      for await (const rec of readJsonl<CatalogRecord>(path)) {
        units++;
        if (!isEdbUnit(rec)) continue;
        const at = rec.fetched_at ?? "";
        if (at && (!first || at < first)) first = at;
        if (at > last) last = at;
        const r = crawlEntry(rec);
        yield { key: `${rec.id} ${rec.signature ?? ""}`, entry: r.entry, reason: r.reason, notes: r.notes };
      }
    })(),
  };
}

const NOTE_LABEL: Record<CrawlNoteKind, string> = {
  "titel-zusatz": "Weitere Zeilen im Titel als Zusatzinfo gelesen",
  bibelstelle: "«XXX» in einer Kapitelzahl wiederhergestellt (der Katalog machte daraus einen Umbruch)",
  "x-verschoben": "«x» am Wortende zurückgeholt («Peseu⏎X…» → «Peseux⏎…»)",
  mehrzeilig: "Mehr als zwei Zeilen Zusatzinfo, nach Regel getrennt",
  "link-zuordnung": "GND- bzw. HLS-Link ohne eindeutigen Namen zugeordnet",
  "link-ungueltig": "Link ohne gültige GND- bzw. HLS-Nummer übergangen",
};
const NOTE_ORDER = Object.keys(NOTE_LABEL) as CrawlNoteKind[];

export async function runEhedatenBuild(opts: { input?: string; edb?: string; out: string }): Promise<void> {
  if (!opts.input === !opts.edb) throw new Error("genau eine Quelle angeben: --input=<Katalog-Export> oder --edb=<Zenodo-CSV>");
  const t0 = Date.now();
  const source = opts.input ? crawlSource(opts.input) : zenodoSource(opts.edb!);
  const out = writeJsonl(join(opts.out, "ehedaten-docs.jsonl.gz"));
  const skipped: string[] = [];
  const notes = new Map<CrawlNoteKind, string[]>();
  const seen = new Set<number>();
  const byArt = new Map<string, number>();
  const byQuelle = new Map<string, number>();
  const byRaum = new Map<string, number>();
  const byKirche = new Map<string, number>();
  const byHerkunft = new Map<string, number>();
  const byDecade = new Map<number, number>();
  let items = 0;
  let docs = 0;
  let julian = 0;
  let span = 0;
  let unsicher = 0;
  let withKeys = 0;
  let bothKeys = 0;
  let withHerkunft = 0;
  let viaGemeinde = 0;
  let withGnd = 0;
  let withHls = 0;
  let withFolded = 0;
  let minYear = Infinity;
  let maxYear = -Infinity;

  for await (const item of source.items) {
    items++;
    const doc: EhedatenDoc | null = item.entry ? entryDoc(item.entry) : null;
    if (!doc || seen.has(doc.id)) {
      skipped.push(`${item.key}: ${doc ? "doppelte ID" : (item.reason ?? "kein Eintrag")}`);
      continue;
    }
    for (const n of item.notes ?? []) {
      const list = notes.get(n.kind) ?? [];
      list.push(`${item.key}: ${n.detail}`);
      notes.set(n.kind, list);
    }
    seen.add(doc.id);
    await out.write(doc);
    docs++;
    count(byArt, doc.art);
    count(byQuelle, doc.quelle);
    count(byKirche, doc.kirchgemeinde);
    count(byDecade, Math.floor(doc.dateFrom / 10) * 10);
    for (const r of doc.raum) count(byRaum, r);
    for (const h of doc.herkunft) count(byHerkunft, h);
    if (doc.dateFrom <= 1700) julian++;
    if (doc.isoVon !== doc.isoBis) span++;
    if (doc.unsicher) unsicher++;
    if (doc.personKeys.length > 0) withKeys++;
    if (doc.mannKey && doc.frauKey) bothKeys++;
    if (doc.herkunft.length > 0) withHerkunft++;
    if (doc.mannGnd || doc.frauGnd) withGnd++;
    if (doc.mannHls || doc.frauHls) withHls++;
    if (EHEDATEN_FOLDED_FIELDS.some((f) => !!doc[foldedField(f)])) withFolded++;
    if ([doc.mannHerkunft, doc.frauHerkunft].some((h) => /\)\s*$/.test(h) && !/\((Deutschland|Frankreich|Italien|Österreich)\)/.test(h))) viaGemeinde++;
    minYear = Math.min(minYear, doc.dateFrom);
    maxYear = Math.max(maxYear, doc.dateTo);
  }
  await out.close();

  const table = (rows: Array<[string | number, number]>, head: string) =>
    `| ${head} | Einträge | Anteil |\n|---|---:|---:|\n${rows.map(([k, v]) => `| ${k} | ${fmt(v)} | ${pct(v, docs)} |`).join("\n")}`;
  const noteBlocks = NOTE_ORDER.filter((k) => notes.has(k)).map((k) => {
    const list = notes.get(k)!;
    const shown = list.slice(0, 40).map((s) => `- ${s}`);
    return `### ${NOTE_LABEL[k]} (${fmt(list.length)})\n\n${shown.join("\n")}${list.length > shown.length ? `\n- … und ${fmt(list.length - shown.length)} weitere` : ""}`;
  });
  const md = `# Index ehedaten

Erzeugt ${new Date().toISOString()} aus ${await source.label()}.

## Umfang

- ${source.unit}: ${fmt(items)}; Dokumente: ${fmt(docs)}; übersprungen: ${fmt(skipped.length)}
- Jahre ${minYear}–${maxYear}; julianisch datiert (bis 1700): ${fmt(julian)} (${pct(julian, docs)}); Zeitspannen statt Tag: ${fmt(span)}
- ${fmt(byKirche.size)} Kirchgemeinden, ${fmt(byHerkunft.size)} Herkunftswerte (Facette)
- Personenschlüssel (Vor- und Nachname): ${fmt(withKeys)} Einträge mit mindestens einem, ${fmt(bothKeys)} mit beiden
- mit Herkunft: ${fmt(withHerkunft)} (${pct(withHerkunft, docs)}); davon mit «Weiler (Gemeinde)»: ${fmt(viaGemeinde)}
- unsicher gelesene Angaben («?»): ${fmt(unsicher)}
- mit GND-Link: ${fmt(withGnd)}; mit HLS-Artikel: ${fmt(withHls)}
- mit ß (gefaltete Suchfelder, searchText.ts): ${fmt(withFolded)}

## Art

${table(top(byArt, 5), "Art")}

Verkündung = «Verkünddatum» in der Zusatzinfo, sonst Trauung.

## Überlieferung

${table(top(byQuelle, 5), "Signatur")}

## Herkunftsraum (Einträge, in denen mindestens eine Person aus dem Raum stammt)

${table(top(byRaum, 5), "Raum")}

## Kirchgemeinden (häufigste 20)

${table(top(byKirche, 20), "Kirchgemeinde")}

## Herkunft (häufigste 20)

${table(top(byHerkunft, 20), "Herkunft")}

## Jahrzehnte

${table(
  [...byDecade.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => [`${d}er`, v] as [string, number]),
  "Jahrzehnt",
)}
${noteBlocks.length > 0 ? `\n## Lesart des Katalogs (ehedatenCrawl.ts)\n\n${noteBlocks.join("\n\n")}\n` : ""}${skipped.length > 0 ? `\n## Übersprungen\n\n${skipped.slice(0, 50).map((s) => `- ${s}`).join("\n")}\n` : ""}`;
  await writeFile(join(opts.out, "ehedaten-report.md"), md);
  console.log(
    `[ehedaten] ${fmt(docs)} Dokumente (${fmt(skipped.length)} übersprungen) in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${join(opts.out, "ehedaten-docs.jsonl.gz")}`,
  );
}
