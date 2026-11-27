/**
 * Plattform-Dokumente zu den Weblinks «Volltext und Digitalisat» der Katalogeinheiten
 * (Aufbau und Abgleich).
 *
 * Der Weblink nennt die ID der Plattform des Staatsarchivs (www.zentraleserien.zh.ch). Die
 * Dateien der Plattform heissen nicht immer so:
 * - getippte Fassungen tragen «_t» (RRB ab 1903, die ganze OS; der Weblink ohne «_t» gilt auch
 *   beim Staatsarchiv),
 * - Doppelbeschlüsse heissen «…_1811_MM_2_26_RRB_1835_1812»; der Weblink mit «_-_» führt auch
 *   beim Staatsarchiv ins Leere (geprüft 2026-11-09).
 * Trifft keine dieser Formen, gilt das einzige Dokument derselben Serie, das die Einheit als
 * `archiveId` nennt (Weblink mit falscher ID, etwa «ABl_1996__S__1217-1222_» für die Seiten
 * 1217–1225). Trifft auch das nicht, fehlt das Dokument auf der Plattform.
 *
 * Pur, unit-getestet in platform.test.ts.
 */

/** Ein Plattform-Dokument, wie es der Abzug aus dem Index `documents` liefert (platform_docs.py). */
export interface PlatformDocRef {
  id: string;
  series: string;
  archiveId?: number | string | null;
  dateYear?: number | null;
  resolutionId?: string | null;
}

/** Plattform-Dokument eines Weblinks und wie es gefunden wurde. */
export interface PlatformTarget {
  id: string;
  series: string;
  /** `id`: Weblink-ID; `variant`: mit «_t» bzw. ohne Bindestrich; `archiveId`: das Dokument nennt
   *  die Einheit; `switched`: wie `archiveId`, obwohl der Weblink ein Dokument trifft (settleTarget). */
  via: "id" | "variant" | "archiveId" | "switched";
}

/** Wie das Plattform-Dokument eines Weblinks gefunden wurde (Report des Aufbaus, Abgleich). */
export function viaLabel(t: PlatformTarget, weblinkId: string): string {
  if (t.via === "variant") return t.id === `${weblinkId}_t` ? "mit «_t»" : "ohne Bindestrich";
  return { id: "Weblink-ID", archiveId: "über die archiveId des Dokuments", switched: "archiveId statt Weblink" }[t.via];
}

/** Plattform-IDs, unter denen das Dokument eines Weblinks liegen kann, in dieser Reihenfolge. */
export function platformIdVariants(docId: string): string[] {
  const out = [docId, `${docId}_t`];
  const joined = docId.replace(/_-_/g, "_");
  if (joined !== docId) out.push(joined, `${joined}_t`);
  return out;
}

/** Katalog-ID eines Plattform-Dokuments (die Plattform liefert sie als Zahl, ältere Abzüge als Text). */
export function archiveIdOf(d: Pick<PlatformDocRef, "archiveId">): number | null {
  const n = typeof d.archiveId === "string" ? Number(d.archiveId) : d.archiveId;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

export class PlatformIndex {
  private readonly byId = new Map<string, PlatformDocRef>();
  private readonly byArchive = new Map<number, PlatformDocRef[]>();

  constructor(docs: Iterable<PlatformDocRef> = []) {
    for (const d of docs) this.add(d);
  }

  /** Aus einem Strom (readJsonl über den Abzug). */
  static async fromAsync(docs: AsyncIterable<PlatformDocRef>): Promise<PlatformIndex> {
    const index = new PlatformIndex();
    for await (const d of docs) index.add(d);
    return index;
  }

  private add(d: PlatformDocRef): void {
    this.byId.set(d.id, d);
    const a = archiveIdOf(d);
    if (a === null) return;
    const list = this.byArchive.get(a);
    if (list) list.push(d);
    else this.byArchive.set(a, [d]);
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): PlatformDocRef | undefined {
    return this.byId.get(id);
  }

  docs(): IterableIterator<PlatformDocRef> {
    return this.byId.values();
  }

  /** Dokumente, die die Katalog-ID als `archiveId` nennen. */
  claiming(catalogId: number): PlatformDocRef[] {
    return this.byArchive.get(catalogId) ?? [];
  }

  /** Das einzige Dokument der Serie, das die Einheit als `archiveId` nennt. */
  private claimedIn(catalogId: number, series: string): PlatformDocRef | null {
    const own = this.claiming(catalogId).filter((d) => d.series === series);
    return own.length === 1 ? own[0] : null;
  }

  /**
   * Stufe 1: das Dokument des Weblinks (auch mit «_t» bzw. ohne Bindestrich), sonst das einzige
   * Dokument derselben Serie, das die Einheit als `archiveId` nennt; null = fehlt auf der Plattform.
   */
  locate(unitId: number, weblink: { series: string; id: string }): PlatformTarget | null {
    const variants = platformIdVariants(weblink.id);
    for (const [i, id] of variants.entries()) {
      const d = this.byId.get(id);
      if (d) return { id: d.id, series: d.series, via: i === 0 ? "id" : "variant" };
    }
    const claimed = this.claimedIn(unitId, weblink.series);
    return claimed ? { id: claimed.id, series: claimed.series, via: "archiveId" } : null;
  }

  /**
   * Stufe 2 (braucht Stufe 1 aller Einheiten, `located`): Gehört das Dokument des Weblinks per
   * `archiveId` einer anderen Einheit, die es ebenfalls per Weblink abbildet, und nennt genau ein
   * anderes Dokument derselben Serie diese Einheit, gilt dieses – zwei Weblinks auf ein Dokument,
   * und das Dokument stützt den anderen (Prod 2026-11-09: «MM 3.204 RRB 1994/1750» verlinkt
   * 1994/1749, «ABl 1972 (S. 1216-1235)» die Seiten 1109–1143). Sonst bleibt Stufe 1.
   */
  settle(unitId: number, first: PlatformTarget | null, located: (unitId: number) => string | undefined): PlatformTarget | null {
    if (!first || (first.via !== "id" && first.via !== "variant")) return first;
    const owner = archiveIdOf(this.byId.get(first.id) ?? {});
    if (owner === null || owner === unitId || located(owner) !== first.id) return first;
    const claimed = this.claimedIn(unitId, first.series);
    return claimed && claimed.id !== first.id ? { id: claimed.id, series: claimed.series, via: "switched" } : first;
  }
}
