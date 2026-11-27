/**
 * Archivbaum (Archivplan) aus dem Export: Jede Einheit trägt ihren Pfad von der
 * Wurzel bis zu sich selbst. Daraus ergeben sich die Kinder jedes Knotens und die
 * Stufen, die nur aus Pfaden bekannt sind – der Crawl läuft in zufälliger
 * ID-Reihenfolge, im Teilstand fehlen vielen gecrawlten Einheiten noch Klassen oder
 * Bestände darüber. Dazu der Sortierschlüssel, der Geschwister in die Reihenfolge des
 * Archivplans bringt, und die Position unter den Geschwistern (Nachbarn und «3 von 4»
 * auf der Detailseite). Pur, unit-getestet in tree.test.ts.
 */

import { parseCatalogDate } from "./dates.ts";
import type { CatalogDoc, CatalogPathNode, CatalogRecord, CatalogStub } from "./types.ts";
import { unitTitle } from "./unitTitle.ts";

const DETAIL_URL = "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=";

/** Ahnen ohne Wurzel und ohne die Einheit selbst (Brotkrumen der Detailseite). */
export function catalogPath(rec: CatalogRecord): CatalogDoc["path"] {
  return rec.path.filter((n, i) => i > 0 && n.id !== rec.id).map((n) => ({ id: n.id, label: n.label }));
}

/** Nächster Ahne der Stufe «Bestand», sonst «Abteilung» (Facette). */
export function bestandOf(rec: CatalogRecord): string | null {
  const ancestors = rec.path.filter((n) => n.id !== rec.id);
  const pick = [...ancestors].reverse().find((n) => n.level === "Bestand") ?? [...ancestors].reverse().find((n) => n.level === "Abteilung");
  return pick?.label ?? null;
}

export class ArchiveTree {
  private readonly records = new Set<number>();
  /** Stufen, die (noch) nur aus Pfaden bekannt sind: ID → Pfad bis zur Stufe selbst. */
  private readonly pathOnly = new Map<number, CatalogPathNode[]>();
  private readonly children = new Map<number, Set<number>>();

  add(rec: CatalogRecord): void {
    this.records.add(rec.id);
    this.pathOnly.delete(rec.id);
    rec.path.forEach((node, i) => {
      if (i > 0) this.link(rec.path[i - 1].id, node.id);
      if (node.id !== rec.id && !this.records.has(node.id) && !this.pathOnly.has(node.id)) {
        this.pathOnly.set(node.id, rec.path.slice(0, i + 1));
      }
    });
    if (rec.parent_id != null) this.link(rec.parent_id, rec.id);
  }

  private link(parent: number, child: number): void {
    if (parent === child) return;
    let set = this.children.get(parent);
    if (!set) this.children.set(parent, (set = new Set()));
    set.add(child);
  }

  childCount(id: number): number {
    return this.children.get(id)?.size ?? 0;
  }

  /** Stufen ohne eigenen Datensatz, mit dem Pfad von der Wurzel bis zu ihnen. */
  stubs(): Array<{ id: number; path: CatalogPathNode[] }> {
    return [...this.pathOnly].map(([id, path]) => ({ id, path }));
  }
}

/** Grösste römische Zahl, die als eigenes Signaturglied gelesen wird (B I … B XXXIX). */
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/;

function roman(token: string): number | null {
  const m = ROMAN.exec(token);
  if (!token || !m) return null;
  const tens = m[1].length * 10;
  const ones: Record<string, number> = { "": 0, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
  return tens + ones[m[2]];
}

const pad = (n: number) => String(n).padStart(10, "0");
/** Meili speichert Facetten- und Sortierwerte nur bis zu einer begrenzten Länge. */
const KEY_MAX = 160;

/**
 * Sortierschlüssel für die Archivplan-Reihenfolge: klein geschrieben, ohne Akzente,
 * Zahlen auf zehn Stellen aufgefüllt («U 110.6.9» vor «U 110.6.10») und römische
 * Zahlen nach dem ersten Glied als Zahl («B IX» vor «B X», «C» bleibt Abteilung C).
 * Eckige Klammern um eine Signatur («[C III 1, Nr. 53]») zählen nicht.
 */
export function naturalSortKey(text: string): string {
  const tokens = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[[\]]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/);
  return tokens
    .map((t, i) => {
      const r = i > 0 ? roman(t.replace(/[.,]$/, "")) : null;
      if (r !== null) return pad(r) + (/[.,]$/.test(t) ? t.at(-1) : "");
      return t.replace(/\d+/g, (d) => pad(Number(d)));
    })
    .join(" ")
    .slice(0, KEY_MAX);
}

/** Schlüssel einer Einheit unter ihren Geschwistern: Signatur vor Titel; Stufen aus dem
 *  Pfad tragen die Signatur am Anfang ihres Titels und sortieren so gleich mit. */
export function siblingSortKey(signature: string | null | undefined, title: string): string {
  const sig = (signature ?? "").trim();
  return naturalSortKey(sig ? `${sig} ${title}` : title);
}

/** Ein Gleichstand unter Geschwistern bekommt Leerzeichen + aufgefüllte ID angehängt. */
const TIE_SUFFIX = 11;

/**
 * Position jeder Einheit unter ihren Geschwistern (gleiche `parentId`), in der
 * Reihenfolge, in der der Archivbaum sie aus Meili liest (`sigSort:asc`, Zeichen für
 * Zeichen wie Meili, nicht nach Locale). Gleiche Schlüssel unter Geschwistern (gleiche
 * Signatur und gleicher Titel) bekommen die ID angehängt: Meili ordnete sie sonst
 * beliebig, und Baum und Position passten nicht zusammen. Erst alle Einheiten mit
 * `add`, dann `finish`, danach `place`.
 */
export class SiblingOrder {
  private groups = new Map<number | null, Array<{ id: number; key: string }>>();
  private readonly positions = new Map<number, number>();
  private readonly tieKeys = new Map<number, string>();

  add(rec: CatalogRecord): void {
    let group = this.groups.get(rec.parent_id);
    if (!group) this.groups.set(rec.parent_id, (group = []));
    group.push({ id: rec.id, key: siblingSortKey(rec.signature, unitTitle(rec).title) });
  }

  finish(): void {
    for (const group of this.groups.values()) {
      const count = new Map<string, number>();
      for (const e of group) count.set(e.key, (count.get(e.key) ?? 0) + 1);
      for (const e of group) {
        if ((count.get(e.key) ?? 0) < 2) continue;
        e.key = `${e.key.slice(0, KEY_MAX - TIE_SUFFIX)} ${pad(e.id)}`;
        this.tieKeys.set(e.id, e.key);
      }
      group.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id - b.id));
      group.forEach((e, i) => this.positions.set(e.id, i + 1));
    }
    this.groups = new Map();
  }

  /** `sigSort` (der eigene Schlüssel `key`, bei einem Gleichstand mit ID) und `sigPos`
   *  (ab 1; 0 für eine Einheit, die nie mit `add` kam). */
  place(id: number, key: string): { sigSort: string; sigPos: number } {
    return { sigSort: this.tieKeys.get(id) ?? key, sigPos: this.positions.get(id) ?? 0 };
  }

  /** Einheiten, deren Schlüssel unter Geschwistern doppelt war (Report). */
  get ties(): number {
    return this.tieKeys.size;
  }
}

/** Datensatz einer Archivplan-Stufe, die nur aus Pfaden bekannt ist (für Titel und Position). */
export function stubRecord(id: number, path: CatalogPathNode[]): CatalogRecord {
  return {
    id,
    url: `${DETAIL_URL}${id}`,
    signature: null,
    title: null,
    level: path.at(-1)?.level ?? null,
    date_text: null,
    parent_id: path.length > 1 ? path[path.length - 2].id : null,
    path,
    sections: [],
    fields: {},
  };
}

/** Archivplan-Stufe, die nur aus Pfaden bekannt ist: Name und Datum aus ihrem Etikett. */
export function stubDoc(id: number, path: CatalogPathNode[], childCount: number, order: SiblingOrder): CatalogStub {
  const rec = stubRecord(id, path);
  const named = unitTitle(rec);
  const range = parseCatalogDate(named.dateText);
  return {
    id,
    signature: "",
    title: named.title,
    level: rec.level ?? "",
    dateText: named.dateText,
    dateFrom: range?.from ?? null,
    dateTo: range?.to ?? null,
    path: catalogPath(rec),
    bestand: bestandOf(rec),
    parentId: rec.parent_id,
    hasDigitization: false,
    url: rec.url,
    ...order.place(id, siblingSortKey(null, named.title)),
    childCount,
    stub: true,
  };
}
