/**
 * Zwei Index-Dateien `ehedaten` vergleichen (nur lesend): Zahl der Einträge, Einträge nur in
 * einer der beiden, Abweichungen je Feld (inhaltlich, nur Anführungszeichen, neu, entfallen,
 * mit Beispielen) und Facetten. Gedacht vor einem Import: die neue Datei gegen die zuletzt
 * importierte (auf Hetzner `~/zszh-catalog/ehedaten-docs.jsonl.gz`, README «Ehedaten-Index»).
 *
 *   npx tsx src/main.ts ehedaten-vergleich --docs=<neu.jsonl.gz> --base=<alt.jsonl.gz> [--out=<dir>]
 *
 * Schreibt <out>/ehedaten-vergleich.md und <out>/ehedaten-vergleich.csv (alle Feldabweichungen).
 * diffDocs und countFacets sind pur und in ehedatenVergleich.test.ts getestet.
 */

import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { EhedatenDoc } from "./ehedaten.ts";
import { readJsonl } from "./load.ts";
import { EHEDATEN_FOLDED_FIELDS, foldedField } from "./searchText.ts";

export type DiffKind = "inhaltlich" | "anfuehrungszeichen" | "neu" | "entfallen";
export const DIFF_KINDS: DiffKind[] = ["inhaltlich", "anfuehrungszeichen", "neu", "entfallen"];

export interface FieldDiff {
  field: string;
  kind: DiffKind;
  base: string;
  next: string;
}

const show = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const unquoted = (s: string) => s.replace(/["„“”«»]/g, "").replace(/\s+/g, " ").trim();

/** Gefaltete Suchfelder folgen aus ihrem Original: Ihre Abweichungen zählen nicht (nur als Zahl). */
const FOLDED = new Set<string>(EHEDATEN_FOLDED_FIELDS.map(foldedField));

/** Abweichende Felder zweier Einträge mit derselben ID, in der Feldreihenfolge des neuen, ohne die
 *  gefalteten Suchfelder. */
export function diffDocs(base: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): FieldDiff[] {
  const fields = [...new Set([...Object.keys(next), ...Object.keys(base)])];
  const out: FieldDiff[] = [];
  for (const field of fields) {
    if (FOLDED.has(field)) continue;
    const a = base[field];
    const b = next[field];
    if (show(a) === show(b)) continue;
    const kind: DiffKind = empty(a) ? "neu" : empty(b) ? "entfallen" : unquoted(show(a)) === unquoted(show(b)) ? "anfuehrungszeichen" : "inhaltlich";
    out.push({ field, kind, base: show(a), next: show(b) });
  }
  return out;
}

/** Facetten wie im Index: Kirchgemeinde, Überlieferung, Art, Raum, Herkunft, Band, Jahrzehnt. */
export const FACETS = ["kirchgemeinde", "quelle", "art", "raum", "herkunft", "band", "jahrzehnt"] as const;
export type Facet = (typeof FACETS)[number];
export type FacetCounts = Record<Facet, Map<string, number>>;

export function emptyFacets(): FacetCounts {
  return Object.fromEntries(FACETS.map((f) => [f, new Map<string, number>()])) as FacetCounts;
}

export function countFacets(c: FacetCounts, d: EhedatenDoc): void {
  const add = (f: Facet, v: string) => c[f].set(v, (c[f].get(v) ?? 0) + 1);
  add("kirchgemeinde", d.kirchgemeinde);
  add("quelle", d.quelle);
  add("art", d.art);
  for (const r of d.raum) add("raum", r);
  for (const h of d.herkunft) add("herkunft", h);
  add("band", d.band);
  add("jahrzehnt", `${Math.floor(d.dateFrom / 10) * 10}er`);
}

/** Abgeleitete Zählungen, die eine Änderung der Lesart sichtbar machen. */
const DERIVED: Array<[string, (d: EhedatenDoc) => boolean]> = [
  ["mit Personenschlüssel (mindestens einer)", (d) => d.personKeys.length > 0],
  ["mit beiden Personenschlüsseln", (d) => !!d.mannKey && !!d.frauKey],
  ["mit Herkunft (Facette)", (d) => d.herkunft.length > 0],
  ["unsicher («?»)", (d) => d.unsicher],
  ["Verkündung", (d) => d.art === "verkuendung"],
  ["Zeitspanne statt Tag", (d) => d.isoVon !== d.isoBis],
  ["mit Zusatzinfo Bräutigam", (d) => !!d.mannZusatz],
  ["mit Zusatzinfo Braut", (d) => !!d.frauZusatz],
  ["mit Seite", (d) => !!d.seite],
  ["mit GND Bräutigam", (d) => !!d.mannGnd],
  ["mit GND Braut", (d) => !!d.frauGnd],
  ["mit HLS Bräutigam", (d) => !!d.mannHls],
  ["mit HLS Braut", (d) => !!d.frauHls],
  ["mit gefaltetem Suchfeld (ß)", (d) => EHEDATEN_FOLDED_FIELDS.some((f) => !!d[foldedField(f)])],
];

const fmt = (n: number) => n.toLocaleString("de-CH");
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const md = (s: string) => (s ? s.replace(/\|/g, "\\|").replace(/\n/g, " ⏎ ") : "–");
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EXAMPLES = 8;
const LIST_MAX = 100;

export async function runEhedatenVergleich(opts: { docs: string; base: string; out: string }): Promise<void> {
  const t0 = Date.now();
  const base = new Map<number, EhedatenDoc>();
  for await (const d of readJsonl<EhedatenDoc>(opts.base)) base.set(d.id, d);
  const baseFacets = emptyFacets();
  const nextFacets = emptyFacets();
  for (const d of base.values()) countFacets(baseFacets, d);
  const derived = DERIVED.map(() => ({ base: 0, next: 0 }));
  for (const d of base.values()) DERIVED.forEach(([, f], i) => (derived[i].base += f(d) ? 1 : 0));

  const onlyNext: EhedatenDoc[] = [];
  const perField = new Map<string, Map<DiffKind, number>>();
  const entriesPerField = new Map<string, number>();
  const examples = new Map<string, Array<[EhedatenDoc, FieldDiff]>>();
  const csv = ["id,signatur,feld,art,bisher,neu"];
  const seen = new Set<number>();
  let next = 0;
  let identical = 0;
  let quotesOnly = 0;

  for await (const d of readJsonl<EhedatenDoc>(opts.docs)) {
    next++;
    countFacets(nextFacets, d);
    DERIVED.forEach(([, f], i) => (derived[i].next += f(d) ? 1 : 0));
    const b = base.get(d.id);
    if (!b) {
      onlyNext.push(d);
      continue;
    }
    seen.add(d.id);
    const diffs = diffDocs(b as unknown as Record<string, unknown>, d as unknown as Record<string, unknown>);
    if (diffs.length === 0) identical++;
    else if (diffs.every((x) => x.kind === "anfuehrungszeichen")) quotesOnly++;
    for (const x of diffs) {
      const kinds = perField.get(x.field) ?? new Map<DiffKind, number>();
      kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
      perField.set(x.field, kinds);
      entriesPerField.set(x.field, (entriesPerField.get(x.field) ?? 0) + 1);
      const ex = examples.get(x.field) ?? [];
      if (x.kind !== "anfuehrungszeichen" && ex.length < EXAMPLES) ex.push([d, x]);
      examples.set(x.field, ex);
      csv.push([d.id, d.signatur, x.field, x.kind, x.base, x.next].map(csvCell).join(","));
    }
  }
  const onlyBase = [...base.values()].filter((d) => !seen.has(d.id));
  const both = seen.size;

  const fieldRows = [...entriesPerField.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `| ${f} | ${fmt(n)} | ${DIFF_KINDS.map((k) => fmt(perField.get(f)?.get(k) ?? 0)).join(" | ")} |`);
  const exampleBlocks = [...examples.entries()]
    .filter(([, ex]) => ex.length > 0)
    .sort((a, b) => (entriesPerField.get(b[0]) ?? 0) - (entriesPerField.get(a[0]) ?? 0))
    .map(
      ([f, ex]) =>
        `### ${f}\n\n| ID | Signatur | Art | bisher | neu |\n|---|---|---|---|---|\n${ex.map(([d, x]) => `| ${d.id} | ${md(d.signatur)} | ${x.kind} | ${md(x.base)} | ${md(x.next)} |`).join("\n")}`,
    );
  const facetBlocks = FACETS.map((f) => {
    const keys = [...new Set([...baseFacets[f].keys(), ...nextFacets[f].keys()])];
    const rows = keys
      .map((k) => [k, baseFacets[f].get(k) ?? 0, nextFacets[f].get(k) ?? 0] as const)
      .filter(([, a, b]) => a !== b)
      .sort((x, y) => Math.abs(y[2] - y[1]) - Math.abs(x[2] - x[1]) || String(x[0]).localeCompare(String(y[0]), "de"));
    const head = `### ${f}: ${fmt(baseFacets[f].size)} Werte bisher, ${fmt(nextFacets[f].size)} neu, ${fmt(rows.length)} mit anderer Zahl`;
    if (rows.length === 0) return head;
    const shown = rows.slice(0, 20).map(([k, a, b]) => `| ${md(String(k))} | ${fmt(a)} | ${fmt(b)} | ${signed(b - a)} |`);
    return `${head}\n\n| Wert | bisher | neu | Δ |\n|---|---:|---:|---:|\n${shown.join("\n")}${rows.length > 20 ? `\n\n… und ${fmt(rows.length - 20)} weitere Werte` : ""}`;
  });
  const listDoc = (d: EhedatenDoc) => `- ${d.id} ${d.signatur}: ${d.titel}, ${d.datum}`;

  const report = `# Index ehedaten: Vergleich

Erzeugt ${new Date().toISOString()}: neu \`${basename(opts.docs)}\` gegen bisher \`${basename(opts.base)}\`.

## Umfang

- bisher ${fmt(base.size)}, neu ${fmt(next)} Einträge (${signed(next - base.size)})
- in beiden (gleiche ID): ${fmt(both)}; nur bisher: ${fmt(onlyBase.length)}; nur neu: ${fmt(onlyNext.length)}
- in beiden und in allen Feldern gleich: ${fmt(identical)}; nur in Anführungszeichen verschieden: ${fmt(quotesOnly)}; inhaltlich verschieden: ${fmt(both - identical - quotesOnly)}

## Abweichungen je Feld (Einträge in beiden)

| Feld | Einträge | inhaltlich | nur Anführungszeichen | neu | entfallen |
|---|---:|---:|---:|---:|---:|
${fieldRows.join("\n") || "| – | 0 | 0 | 0 | 0 | 0 |"}

## Abgeleitete Zählungen

| | bisher | neu | Δ |
|---|---:|---:|---:|
${DERIVED.map(([label], i) => `| ${label} | ${fmt(derived[i].base)} | ${fmt(derived[i].next)} | ${signed(derived[i].next - derived[i].base)} |`).join("\n")}

## Facetten

${facetBlocks.join("\n\n")}

## Nur bisher (${fmt(onlyBase.length)})

${onlyBase.slice(0, LIST_MAX).map(listDoc).join("\n") || "–"}${onlyBase.length > LIST_MAX ? `\n- … und ${fmt(onlyBase.length - LIST_MAX)} weitere` : ""}

## Nur neu (${fmt(onlyNext.length)})

${onlyNext.slice(0, LIST_MAX).map(listDoc).join("\n") || "–"}${onlyNext.length > LIST_MAX ? `\n- … und ${fmt(onlyNext.length - LIST_MAX)} weitere` : ""}

## Beispiele (ohne «nur Anführungszeichen»; alle Abweichungen in \`ehedaten-vergleich.csv\`)

${exampleBlocks.join("\n\n") || "Keine Abweichungen."}
`;
  await writeFile(join(opts.out, "ehedaten-vergleich.md"), report);
  await writeFile(join(opts.out, "ehedaten-vergleich.csv"), csv.join("\n") + "\n");
  console.log(
    `[ehedaten-vergleich] bisher ${fmt(base.size)}, neu ${fmt(next)}, gleich ${fmt(identical)}, nur Anführungszeichen ${fmt(quotesOnly)} (${((Date.now() - t0) / 1000).toFixed(1)} s) → ${join(opts.out, "ehedaten-vergleich.md")}`,
  );
}
