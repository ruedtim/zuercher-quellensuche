/**
 * Protokoll Ehedaten: Crawl ↔ Zenodo (nur lesend). Vergleicht die gecrawlten
 * Eheeinträge eines Exports mit dem Zenodo-Datensatz der Ehedatenbank über die
 * Katalog-ID und schreibt `edb-abgleich.md` (Zahlen, Abweichungen je Feld mit
 * Beispielen) sowie `edb-abweichungen.csv` und `edb-nur-crawl.csv`. Läuft bei jedem
 * `refresh.sh build`, sobald die CSV in `~/zszh-catalog/edb-zenodo/` liegt.
 *
 *   npx tsx src/main.ts edb-abgleich --input=<export.jsonl.gz> --edb=<Zenodo-CSV> [--out=<dir>]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { EDB_FIELDS, classifyDiff, compareEdb, edbRows, fromCrawl, fromZenodo, isEdbUnit, type EdbDiff, type EdbDiffKind } from "./edb.ts";
import { readJsonl } from "./load.ts";
import type { CatalogRecord } from "./types.ts";

const EXAMPLES = 8;
const KINDS: EdbDiffKind[] = ["inhaltlich", "anfuehrungszeichen", "excel"];
const KIND_LABEL: Record<EdbDiffKind, string> = {
  inhaltlich: "inhaltlich",
  anfuehrungszeichen: "nur Anführungszeichen (fehlen in Zenodo)",
  excel: "Excel-Fehler in Zenodo",
};
const FIELD_LABEL: Record<(typeof EDB_FIELDS)[number], string> = {
  signatur: "Signatur",
  titel: "Titel (Namen, Herkunft)",
  datum: "Datum",
  zusatzMann: "Zusatzinfo Mann",
  zusatzFrau: "Zusatzinfo Frau",
  kirchgemeinde: "Kirchgemeinde",
  band: "Band (Seite)",
  gnd: "GND",
  hls: "HLS",
};

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const mdCell = (s: string) => (s ? s.replace(/\|/g, "\\|").replace(/\n/g, " ") : "–");
const fmt = (n: number) => n.toLocaleString("de-CH");
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "–");

/** Herkunft der CSV aus der daneben gespeicherten Zenodo-Antwort (zenodo-record-*.json). */
async function zenodoSource(csvPath: string): Promise<string> {
  const dir = dirname(csvPath);
  const meta = (await readdir(dir).catch(() => [])).find((f) => /^zenodo-record-\d+\.json$/.test(f));
  if (!meta) return `\`${basename(csvPath)}\``;
  const d = JSON.parse(await readFile(join(dir, meta), "utf8"));
  const m = d.metadata ?? {};
  return `\`${basename(csvPath)}\` (Zenodo-Record ${d.id}, Version ${m.version}, ${m.publication_date}, Lizenz ${m.license?.id ?? "?"})`;
}

export async function runEdbAbgleich(opts: { input: string; edb: string; out: string }): Promise<void> {
  const rows = edbRows(await readFile(opts.edb, "utf8"));
  const zenodo = new Map(rows.map((r) => [Number(r.ID), r]));
  const seen = new Set<number>();
  const perField = new Map<string, number>();
  const examples = new Map<string, Array<[number, string, EdbDiff]>>();
  const diffCsv = ["id,signatur,feld,art,crawl,zenodo"];
  const onlyCrawl = ["id,signatur,titel"];
  let crawlEdb = 0;
  let identical = 0;
  let sameContent = 0;

  for await (const rec of readJsonl<CatalogRecord>(opts.input)) {
    const z = zenodo.get(rec.id);
    if (!z) {
      if (isEdbUnit(rec)) {
        crawlEdb++;
        onlyCrawl.push([rec.id, rec.signature ?? "", rec.title ?? ""].map(csvCell).join(","));
      }
      continue;
    }
    crawlEdb++;
    seen.add(rec.id);
    const crawlFields = fromCrawl(rec);
    const diffs = compareEdb(crawlFields, fromZenodo(z));
    if (diffs.length === 0) identical++;
    let content = true;
    for (const d of diffs) {
      const kind = classifyDiff(d, z, crawlFields);
      if (kind === "inhaltlich") content = false;
      const key = `${d.field}:${kind}`;
      perField.set(key, (perField.get(key) ?? 0) + 1);
      const ex = examples.get(key) ?? [];
      if (ex.length < (kind === "inhaltlich" ? EXAMPLES : 3)) ex.push([rec.id, rec.signature ?? "", d]);
      examples.set(key, ex);
      diffCsv.push([rec.id, rec.signature ?? "", d.field, kind, d.crawl, d.zenodo].map(csvCell).join(","));
    }
    if (content) sameContent++;
  }

  const both = seen.size;
  const onlyZenodo = rows.length - both;
  const count = (f: string, k: EdbDiffKind) => perField.get(`${f}:${k}`) ?? 0;
  const fieldRows = EDB_FIELDS.map((f) => {
    const [a, b, c] = KINDS.map((k) => count(f, k));
    return `| ${FIELD_LABEL[f]} | ${fmt(a)} | ${pct(a, both)} | ${fmt(b)} | ${fmt(c)} |`;
  }).join("\n");
  const exampleBlocks = EDB_FIELDS.flatMap((f) => KINDS.map((k) => [f, k] as const))
    .filter(([f, k]) => examples.has(`${f}:${k}`))
    .map(([f, k]) => {
      const lines = examples.get(`${f}:${k}`)!.map(([id, sig, d]) => `| ${id} | ${mdCell(sig)} | ${mdCell(d.crawl)} | ${mdCell(d.zenodo)} |`);
      return `### ${FIELD_LABEL[f]}: ${KIND_LABEL[k]}\n\n| ID | Signatur | Crawl | Zenodo |\n|---|---|---|---|\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const md = `# Ehedaten: Crawl ↔ Zenodo

Erzeugt ${new Date().toISOString()} aus \`${opts.input}\` und ${await zenodoSource(opts.edb)}.
Grundlage für den Entscheid, ob der Index die Ehedaten aus dem Crawl oder aus Zenodo nimmt.

## Umfang

- Zenodo: ${fmt(rows.length)} Eheeinträge
- Crawl: ${fmt(crawlEdb)} Eheeinträge, davon ${fmt(both)} mit Zenodo-Zeile (gleiche Katalog-ID)
- nur im Crawl (EDB-Signatur, keine Zenodo-Zeile): ${fmt(crawlEdb - both)}
- nur in Zenodo: ${fmt(onlyZenodo)} – solange der Crawl läuft, meist noch nicht abgerufen; nach dem Vollstand im Online-Katalog nicht (mehr) vorhanden
- in beiden und in allen Feldern gleich: ${fmt(identical)} von ${fmt(both)} (${pct(identical, both)})
- inhaltlich gleich (höchstens Anführungszeichen oder Excel-Fehler in Zenodo): ${fmt(sameContent)} (${pct(sameContent, both)})

## Abweichungen je Feld

| Feld | inhaltlich | Anteil | nur Anführungszeichen | Excel-Fehler in Zenodo |
|---|---:|---:|---:|---:|
${fieldRows}

Verglichen nach Vereinheitlichung von Leerraum, Datumsschreibweise, «-» als leerer Zusatzinfo,
«Kirchgemeinde » vor der Provenienz und GND/HLS als IDs. Die Zenodo-CSV lief durch Excel: Zellen,
die mit einem Zitat beginnen, verlieren die Anführungszeichen, «-X» wird «#NAME?», und
«1696.10» wird als Zahl zu «1696.1» (\`Datum_Von\`/\`Datum_Bis\` stimmen dort); ein unpaariges
Anführungszeichen in den Zusatzinfos des Katalogs lässt die Zellen Mann/Frau verschmelzen.
Alle Abweichungen mit Art: \`edb-abweichungen.csv\`; Einträge nur im Crawl: \`edb-nur-crawl.csv\`.

## Beispiele

${exampleBlocks || "Keine Abweichungen."}
`;
  await writeFile(join(opts.out, "edb-abgleich.md"), md);
  await writeFile(join(opts.out, "edb-abweichungen.csv"), diffCsv.join("\n") + "\n");
  await writeFile(join(opts.out, "edb-nur-crawl.csv"), onlyCrawl.join("\n") + "\n");
  console.log(
    `[edb] Zenodo ${fmt(rows.length)}, Crawl ${fmt(crawlEdb)}, beide ${fmt(both)}, gleich ${fmt(identical)} (${pct(identical, both)}) → ${join(opts.out, "edb-abgleich.md")}`,
  );
}
