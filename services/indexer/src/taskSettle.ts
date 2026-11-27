/**
 * Warten auf die Meili-Tasks eines Indexer-Laufs, mit Status-Prüfung.
 *
 * meilisearch-js' `waitForTask` löst auch bei `failed`/`canceled` auf und
 * wirft nur bei Timeout. Ein abgelehnter documentAdditionOrUpdate-Task
 * verwirft den ganzen Batch, auch seine gültigen Docs (geprüft gegen Meili
 * v1.13.3: eine ungültige ID unter 3 Docs ⇒ 0 indexiert) – ohne Prüfung
 * meldete der Lauf trotzdem «DONE».
 *
 * Meili arbeitet die Tasks global der Reihe nach ab, auch hinter fremden
 * (chunks- oder Vektor-Import): darum eine gemeinsame Frist für alle Tasks
 * eines Laufs; was danach noch ansteht, kommt als `pending` zurück, statt zu
 * werfen – die Tasks laufen in Meili weiter.
 */

import { MeiliSearchTimeOutError } from "meilisearch";

/** Was hier von einem abgeschlossenen Meili-Task gebraucht wird (meilisearch-js `Task`). */
export interface FinishedTask {
  uid: number;
  status: string;
  error?: { code: string; message: string } | null;
  details?: { receivedDocuments?: number; indexedDocuments?: number } | null;
}

export interface FailedTask {
  uid: number;
  /** Docs des verworfenen Batches (`details.receivedDocuments`). */
  docs: number;
  /** Meilis Fehlercode und -meldung, ohne Fehlerobjekt der Status (`canceled`). */
  error: string;
}

export interface SettleResult {
  /** Summe von `details.indexedDocuments` über die erfolgreichen Tasks. */
  indexedDocuments: number;
  failed: FailedTask[];
  /** Nach Ablauf der Frist noch nicht abgeschlossen (laufen in Meili weiter). */
  pending: number[];
}

/**
 * Wartet der Reihe nach auf `taskUids`, alle zusammen höchstens `timeoutMs`.
 * `wait(uid, ms)` ist `client.waitForTask` (wirft MeiliSearchTimeOutError,
 * andere Fehler gehen durch).
 */
export async function settleTaskList(
  taskUids: readonly number[],
  timeoutMs: number,
  wait: (uid: number, timeoutMs: number) => Promise<FinishedTask>,
  now: () => number = Date.now,
): Promise<SettleResult> {
  const deadline = now() + timeoutMs;
  const out: SettleResult = { indexedDocuments: 0, failed: [], pending: [] };
  for (const [i, uid] of taskUids.entries()) {
    let task: FinishedTask;
    try {
      task = await wait(uid, Math.max(1_000, deadline - now()));
    } catch (err) {
      if (!(err instanceof MeiliSearchTimeOutError)) throw err;
      // Meili arbeitet die Queue der Reihe nach ab: steht dieser Task noch
      // an, gilt das auch für alle späteren.
      out.pending.push(...taskUids.slice(i));
      break;
    }
    if (task.status === "succeeded") {
      out.indexedDocuments += task.details?.indexedDocuments ?? 0;
    } else {
      out.failed.push({
        uid,
        docs: task.details?.receivedDocuments ?? 0,
        error: task.error ? `${task.error.code}: ${task.error.message}` : task.status,
      });
    }
  }
  return out;
}

/**
 * Log-Zeilen und Urteil zu einem settleTaskList-Ergebnis: fehlgeschlagene
 * oder noch anstehende Tasks ⇒ `ok: false` (Exit 1). `summary` ist der
 * Zusatz für die Schlusszeile des Laufs.
 */
export function settleReport(
  tag: string,
  taskCount: number,
  result: SettleResult,
  opts: { waitS: number; pendingHint: string },
): { ok: boolean; errors: string[]; warnings: string[]; summary: string } {
  const errors = result.failed.map(
    (f) => `[${tag}] Meili-Task ${f.uid} fehlgeschlagen (${f.docs} Docs nicht geschrieben): ${f.error}`,
  );
  const warnings =
    result.pending.length > 0
      ? [
          `[${tag}] ${result.pending.length} Meili-Task(s) nach ${opts.waitS}s (MEILI_TASK_WAIT_S) ` +
            `noch in der Queue (${result.pending.join(", ")}) – sie laufen weiter; ${opts.pendingHint}`,
        ]
      : [];
  return {
    ok: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    summary:
      ` | tasks=${taskCount} taskFailed=${result.failed.length} ` +
      `pending=${result.pending.length} meiliIndexed=${result.indexedDocuments}`,
  };
}

/**
 * Drossel für Läufe, die schon während des Lesens schreiben (--patch-entity-keys):
 * höchstens `maxInFlight` eingereichte Tasks zugleich – vor jedem weiteren wartet
 * `admit()` auf den ältesten (Prüfung wie settleTaskList, Frist `timeoutMs` je
 * Wartevorgang, der Lauf selbst dauert länger). Hunderte gequeuete Tasks brächten
 * nichts und hielten fremde Tasks auf. Ein abgelehnter oder nach der Frist noch
 * anstehender Task stoppt die Drossel: `admit()` liefert dann false, der Lauf
 * reicht nichts mehr ein. `finish()` wartet auf den Rest (gemeinsame Frist) und
 * liefert das Gesamtergebnis für settleReport – nach einem Timeout ohne weiteres
 * Warten: Meili arbeitet der Reihe nach ab, die späteren stehen ebenfalls noch an.
 * `settle` ist MeiliBulkImporter.settleTasks.
 */
export class TaskThrottle {
  private readonly maxInFlight: number;
  private readonly inFlight: number[] = [];
  private readonly result: SettleResult = { indexedDocuments: 0, failed: [], pending: [] };
  /** Eingereichte Tasks (für settleReport). */
  submitted = 0;

  constructor(
    maxInFlight: number,
    private readonly timeoutMs: number,
    private readonly settle: (taskUids: number[], timeoutMs: number) => Promise<SettleResult>,
  ) {
    this.maxInFlight = Math.max(1, maxInFlight);
  }

  /** Ein Task abgelehnt oder nach der Frist noch offen ⇒ nichts mehr einreichen. */
  get stopped(): boolean {
    return this.result.failed.length > 0 || this.result.pending.length > 0;
  }

  /** Wartet, bis ein weiterer Task Platz hat; false = gestoppt. */
  async admit(): Promise<boolean> {
    while (!this.stopped && this.inFlight.length >= this.maxInFlight) {
      await this.collect(this.inFlight.splice(0, 1));
    }
    return !this.stopped;
  }

  add(taskUid: number): void {
    this.inFlight.push(taskUid);
    this.submitted++;
  }

  async finish(): Promise<SettleResult> {
    const rest = this.inFlight.splice(0);
    if (this.result.pending.length > 0) this.result.pending.push(...rest);
    else await this.collect(rest);
    return this.result;
  }

  private async collect(taskUids: number[]): Promise<void> {
    if (taskUids.length === 0) return;
    const r = await this.settle(taskUids, this.timeoutMs);
    this.result.indexedDocuments += r.indexedDocuments;
    this.result.failed.push(...r.failed);
    this.result.pending.push(...r.pending);
  }
}
