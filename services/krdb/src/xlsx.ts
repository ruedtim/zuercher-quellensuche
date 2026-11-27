/**
 * Minimaler XLSX-Leser für den KRDB-Export: entzippt mit fflate, liest
 * sharedStrings + Blätter mit fast-xml-parser und liefert pro Blatt die Zeilen
 * als Objekte (Spaltenname aus der Kopfzeile → Zellwert als String).
 *
 * Bewusst ohne Typ-Interpretation: Zahlen kommen als "1964" bzw. "28.0"
 * zurück, Datumsspalten des Exports sind ohnehin Text.
 */

import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type SheetRow = Record<string, string>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Werte NICHT als Zahlen parsen ("0815" bliebe sonst 815) und nicht trimmen.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ["si", "r", "row", "c", "sheet", "Relationship"].includes(name),
});

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("#text" in o) return textOf(o["#text"]);
  }
  return "";
}

/** Text eines <si>/<is>: direktes <t> oder Rich-Text-Runs <r><t>. */
function richText(node: Record<string, unknown>): string {
  if (node["t"] !== undefined) return textOf(node["t"]);
  const runs = node["r"] as Array<Record<string, unknown>> | undefined;
  return runs ? runs.map((r) => textOf(r["t"])).join("") : "";
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(buf: Uint8Array): Map<string, SheetRow[]> {
  const files = unzipSync(buf);
  const read = (path: string): string => {
    const f = files[path];
    if (!f) throw new Error(`XLSX: ${path} fehlt`);
    return strFromU8(f);
  };

  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    const sst = parser.parse(read("xl/sharedStrings.xml"))["sst"];
    for (const si of (sst?.["si"] ?? []) as Array<Record<string, unknown>>) shared.push(richText(si));
  }

  const rels = parser.parse(read("xl/_rels/workbook.xml.rels"))["Relationships"]["Relationship"] as Array<
    Record<string, string>
  >;
  const relTarget = new Map(rels.map((r) => [r["@Id"], r["@Target"]]));
  const sheets = parser.parse(read("xl/workbook.xml"))["workbook"]["sheets"]["sheet"] as Array<Record<string, string>>;

  const out = new Map<string, SheetRow[]>();
  for (const sheet of sheets) {
    const target = relTarget.get(sheet["@r:id"]);
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const ws = parser.parse(read(path))["worksheet"];
    const rows = (ws?.["sheetData"]?.["row"] ?? []) as Array<Record<string, unknown>>;
    const matrix: string[][] = rows.map((row) => {
      const cells: string[] = [];
      for (const c of (row["c"] ?? []) as Array<Record<string, unknown>>) {
        const type = c["@t"] as string | undefined;
        let value: string;
        if (type === "s") value = shared[Number(textOf(c["v"]))] ?? "";
        else if (type === "inlineStr") value = richText((c["is"] ?? {}) as Record<string, unknown>);
        else value = textOf(c["v"]);
        cells[colIndex(String(c["@r"] ?? "A"))] = value;
      }
      return Array.from(cells, (v) => v ?? "");
    });
    const [header, ...data] = matrix;
    if (!header) {
      out.set(sheet["@name"], []);
      continue;
    }
    out.set(
      sheet["@name"],
      data
        .filter((r) => r.some((v) => v !== ""))
        .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))),
    );
  }
  return out;
}
