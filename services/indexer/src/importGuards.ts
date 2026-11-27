/**
 * Schutz für Skripte, die per updateDocuments in bestehende Meili-Docs
 * schreiben (import-vectors.ts, patch-null-vectors.ts). Zwei Fallen, geprüft
 * gegen Meili v1.13.3:
 *
 * - meilisearch-js' waitForTask wirft nur bei Timeout. Ein abgelehnter Task
 *   (falsche Vektor-Dimension, Meili-Fehler) kommt als `failed` zurück – und
 *   mit ihm fehlt der ganze Batch, auch seine gültigen Docs.
 * - Eine ID, die im Index fehlt, legt updateDocuments als neues Doc an. Trägt
 *   es alle userProvided-Embedder des Index (Vektor oder `null`; documents hat
 *   nur jina_de), bleibt ein Rumpf-Doc `{id, _vectors}` zurück: von Suche und
 *   Filtern nie gefunden, in numberOfDocuments aber mitgezählt. Fehlt ihm
 *   einer (chunks: jina_de + qwen3_06b; Null-Opt-out für einen noch nicht
 *   konfigurierten Embedder), scheitert stattdessen der ganze Batch («no
 *   vectors provided for document …»).
 */

/** Was von einem abgeschlossenen Meili-Task gebraucht wird (meilisearch-js `Task`). */
export interface SettledTask {
  uid: number;
  type: string;
  status: string;
  error?: { message: string; code?: string } | null;
}

/**
 * Meili ist im Task abgestürzt (Panik im Indexer, Fehlercode `internal`, Meldung «An unexpected crash
 * occurred when processing the task: …»). Die eigentliche Ursache steht nur im Server-Log. Nach dem
 * Upgrade von v1.13 auf v1.57 (2026-11-18) war das Meili #6636, s. `ensureIndex` in meili.ts.
 */
export function isInternalCrash(task: SettledTask): boolean {
  return task.status === "failed" && task.error?.code === "internal";
}

/** Wirft mit Meilis Fehlermeldung, wenn der Task nicht `succeeded` ist. */
export function assertTaskSucceeded(task: SettledTask): void {
  if (task.status !== "succeeded") {
    throw new Error(
      `Task ${task.uid} (${task.type}) ${task.status}: ${task.error?.message ?? "ohne Fehlermeldung"}`,
    );
  }
}

export interface MissingIdReport {
  /** Abgeglichene IDs (je Batch ohne Duplikate). */
  checked: number;
  /** Davon ohne Doc im Index. */
  missing: number;
  /** Die ersten fehlenden IDs, fürs Log. */
  sample: string[];
}

/** IDs aus `wanted`, zu denen `found` kein Doc enthält (Reihenfolge wie `wanted`). */
export function missingIds(
  wanted: readonly string[],
  found: ReadonlyArray<{ id?: unknown }>,
): string[] {
  const have = new Set(found.map((d) => String(d.id)));
  return wanted.filter((id) => !have.has(id));
}

/**
 * Gleicht die IDs von `docs` batchweise gegen den Index ab. `fetchExisting`
 * liefert zu einer ID-Liste die vorhandenen Docs (import-vectors,
 * patch-null-vectors: `id IN […]` über POST /documents/fetch, nur Feld `id`).
 */
export async function findMissingIds(
  docs: AsyncIterable<{ id: string | number }> | Iterable<{ id: string | number }>,
  fetchExisting: (ids: string[]) => Promise<ReadonlyArray<{ id?: unknown }>>,
  opts: { batchSize: number; sampleSize?: number },
): Promise<MissingIdReport> {
  const sampleSize = opts.sampleSize ?? 10;
  const report: MissingIdReport = { checked: 0, missing: 0, sample: [] };
  let batch = new Set<string>();
  const check = async () => {
    if (batch.size === 0) return;
    const ids = [...batch];
    batch = new Set();
    const lost = missingIds(ids, await fetchExisting(ids));
    report.checked += ids.length;
    report.missing += lost.length;
    report.sample.push(...lost.slice(0, sampleSize - report.sample.length));
  };
  for await (const doc of docs) {
    batch.add(String(doc.id));
    if (batch.size >= opts.batchSize) await check();
  }
  await check();
  return report;
}
