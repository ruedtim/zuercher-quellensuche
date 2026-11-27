import { test } from "node:test";
import { strict as assert } from "node:assert";
import { MeiliSearchTimeOutError } from "meilisearch";
import { settleReport, settleTaskList, TaskThrottle, type FinishedTask, type SettleResult } from "./taskSettle.ts";

// Wortlaut von Meili v1.13.3: eine ungültige ID unter 3 Docs, der ganze Batch fehlt.
const INVALID_ID = {
  code: "invalid_document_id",
  message:
    'Document identifier `"bad.id"` is invalid. A document identifier can be of type integer or ' +
    "string, only composed of alphanumeric characters (a-z A-Z 0-9), hyphens (-) and underscores " +
    "(_), and can not be more than 511 bytes.",
};

const ok = (uid: number, indexed: number): FinishedTask => ({
  uid,
  status: "succeeded",
  error: null,
  details: { receivedDocuments: indexed, indexedDocuments: indexed },
});

/** Fake für client.waitForTask: liefert den Task oder wirft den hinterlegten Fehler. */
function fakeWait(outcomes: Record<number, FinishedTask | Error>) {
  const calls: Array<[number, number]> = [];
  const wait = async (uid: number, timeoutMs: number): Promise<FinishedTask> => {
    calls.push([uid, timeoutMs]);
    const outcome = outcomes[uid];
    if (outcome === undefined) throw new Error(`unerwarteter Task ${uid}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { calls, wait };
}

const timeout = (uid: number) =>
  new MeiliSearchTimeOutError(`timeout of 1000ms has exceeded on process ${uid} when waiting a task to be resolved.`);

test("settleTaskList: alle succeeded – indexedDocuments summiert, der Reihe nach gewartet", async () => {
  const { calls, wait } = fakeWait({ 3: ok(3, 5000), 7: ok(7, 5000), 9: ok(9, 1234) });
  const res = await settleTaskList([3, 7, 9], 60_000, wait);
  assert.deepEqual(res, { indexedDocuments: 11_234, failed: [], pending: [] });
  assert.deepEqual(
    calls.map(([uid]) => uid),
    [3, 7, 9],
  );
});

test("settleTaskList: failed/canceled mit Meilis Fehler bzw. Status, Docs aus receivedDocuments", async () => {
  const { wait } = fakeWait({
    1: ok(1, 2),
    2: { uid: 2, status: "failed", error: INVALID_ID, details: { receivedDocuments: 3, indexedDocuments: 0 } },
    3: { uid: 3, status: "canceled", error: null, details: { receivedDocuments: 4 } },
    4: { uid: 4, status: "failed", error: { code: "internal", message: "kaputt" } },
  });
  const res = await settleTaskList([1, 2, 3, 4], 60_000, wait);
  assert.deepEqual(res, {
    indexedDocuments: 2,
    failed: [
      { uid: 2, docs: 3, error: `invalid_document_id: ${INVALID_ID.message}` },
      { uid: 3, docs: 4, error: "canceled" },
      { uid: 4, docs: 0, error: "internal: kaputt" },
    ],
    pending: [],
  });
});

test("settleTaskList: Timeout – dieser und alle späteren Tasks pending, auf sie wird nicht mehr gewartet", async () => {
  const failed: FinishedTask = { uid: 1, status: "failed", error: INVALID_ID, details: { receivedDocuments: 2 } };
  const { calls, wait } = fakeWait({ 1: failed, 2: timeout(2), 3: ok(3, 1), 4: ok(4, 1) });
  const res = await settleTaskList([1, 2, 3, 4], 60_000, wait);
  assert.deepEqual(res.pending, [2, 3, 4]);
  assert.equal(res.failed.length, 1, "Fehler vor dem Timeout bleiben gemeldet");
  assert.deepEqual(
    calls.map(([uid]) => uid),
    [1, 2],
  );
});

test("settleTaskList: gemeinsame Frist – jeder Wait bekommt nur die Restzeit, mindestens 1 s", async () => {
  let clock = 0;
  const calls: Array<[number, number]> = [];
  const wait = async (uid: number, timeoutMs: number): Promise<FinishedTask> => {
    calls.push([uid, timeoutMs]);
    clock += 4_000; // jeder Task braucht 4 s
    return ok(uid, 1);
  };
  await settleTaskList([1, 2, 3, 4], 10_000, wait, () => clock);
  assert.deepEqual(calls, [
    [1, 10_000],
    [2, 6_000],
    [3, 2_000],
    [4, 1_000],
  ]);
});

test("settleTaskList: andere Fehler (Netz, 404) gehen durch; leere Liste wartet nicht", async () => {
  const { wait } = fakeWait({ 1: ok(1, 1), 2: new Error("fetch failed") });
  await assert.rejects(settleTaskList([1, 2], 60_000, wait), /fetch failed/);

  const empty = fakeWait({});
  assert.deepEqual(await settleTaskList([], 60_000, empty.wait), { indexedDocuments: 0, failed: [], pending: [] });
  assert.equal(empty.calls.length, 0);
});

const OPTS = { waitS: 3600, pendingHint: "Status später prüfen." };

test("settleReport: alles erfolgreich – ok, keine Meldungen", () => {
  const res: SettleResult = { indexedDocuments: 10_000, failed: [], pending: [] };
  assert.deepEqual(settleReport("indexer", 2, res, OPTS), {
    ok: true,
    errors: [],
    warnings: [],
    summary: " | tasks=2 taskFailed=0 pending=0 meiliIndexed=10000",
  });
});

test("settleReport: fehlgeschlagener Task ⇒ nicht ok, Zeile mit verlorenen Docs und Meilis Meldung", () => {
  const res: SettleResult = {
    indexedDocuments: 5000,
    failed: [{ uid: 42, docs: 5000, error: `invalid_document_id: ${INVALID_ID.message}` }],
    pending: [],
  };
  const report = settleReport("indexer", 2, res, OPTS);
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, [
    `[indexer] Meili-Task 42 fehlgeschlagen (5000 Docs nicht geschrieben): invalid_document_id: ${INVALID_ID.message}`,
  ]);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.summary, " | tasks=2 taskFailed=1 pending=0 meiliIndexed=5000");
});

test("settleReport: noch anstehende Tasks ⇒ nicht ok, Warnung mit uids, Frist und Hinweis", () => {
  const res: SettleResult = { indexedDocuments: 0, failed: [], pending: [8, 9] };
  const report = settleReport("patch-manifests", 2, res, OPTS);
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, [
    "[patch-manifests] 2 Meili-Task(s) nach 3600s (MEILI_TASK_WAIT_S) noch in der Queue (8, 9) – " +
      "sie laufen weiter; Status später prüfen.",
  ]);
  assert.equal(report.summary, " | tasks=2 taskFailed=0 pending=2 meiliIndexed=0");
});

/** TaskThrottle mit fakeWait; `settled` protokolliert, worauf wann gewartet wurde. */
function throttle(maxInFlight: number, outcomes: Record<number, FinishedTask | Error>) {
  const { wait } = fakeWait(outcomes);
  const settled: number[][] = [];
  const t = new TaskThrottle(maxInFlight, 60_000, (uids, ms) => {
    settled.push([...uids]);
    return settleTaskList(uids, ms, wait);
  });
  return { t, settled };
}

/** Reicht `uids` der Reihe nach ein, solange die Drossel annimmt; liefert die angenommenen. */
async function submitAll(t: TaskThrottle, uids: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const uid of uids) {
    if (!(await t.admit())) break;
    t.add(uid);
    out.push(uid);
  }
  return out;
}

test("TaskThrottle: höchstens maxInFlight offen, wartet auf den ältesten, finish auf den Rest", async () => {
  const { t, settled } = throttle(2, { 1: ok(1, 10), 2: ok(2, 10), 3: ok(3, 10), 4: ok(4, 5) });
  assert.deepEqual(await submitAll(t, [1, 2, 3, 4]), [1, 2, 3, 4]);
  assert.deepEqual(settled, [[1], [2]], "vor Task 3 auf 1, vor Task 4 auf 2");
  assert.deepEqual(await t.finish(), { indexedDocuments: 35, failed: [], pending: [] });
  assert.deepEqual(settled.at(-1), [3, 4], "der Rest gemeinsam");
  assert.equal(t.submitted, 4);
  assert.ok(!t.stopped);
});

test("TaskThrottle: abgelehnter Task stoppt, die schon eingereichten werden noch abgewartet", async () => {
  const failed: FinishedTask = { uid: 1, status: "failed", error: INVALID_ID, details: { receivedDocuments: 7 } };
  const { t, settled } = throttle(2, { 1: failed, 2: ok(2, 3), 3: ok(3, 3) });
  assert.deepEqual(await submitAll(t, [1, 2, 3, 4]), [1, 2], "nach dem Fehler nichts mehr eingereicht");
  assert.ok(t.stopped);
  const res = await t.finish();
  assert.deepEqual(res.failed, [{ uid: 1, docs: 7, error: `invalid_document_id: ${INVALID_ID.message}` }]);
  assert.equal(res.indexedDocuments, 3, "Task 2 lief noch durch");
  assert.deepEqual(settled, [[1], [2]]);
  assert.equal(settleReport("t", t.submitted, res, OPTS).ok, false);
});

test("TaskThrottle: Timeout stoppt, die übrigen gelten ohne weiteres Warten als pending", async () => {
  const { t, settled } = throttle(2, { 1: timeout(1), 2: ok(2, 1), 3: ok(3, 1) });
  assert.deepEqual(await submitAll(t, [1, 2, 3]), [1, 2]);
  assert.deepEqual(await t.finish(), { indexedDocuments: 0, failed: [], pending: [1, 2] });
  assert.deepEqual(settled, [[1]], "auf Task 2 nicht mehr gewartet");
});

test("TaskThrottle: maxInFlight < 1 wie 1, ohne Tasks kein Warten", async () => {
  const { t, settled } = throttle(0, { 1: ok(1, 1), 2: ok(2, 1) });
  assert.deepEqual(await submitAll(t, [1, 2]), [1, 2]);
  assert.deepEqual(settled, [[1]]);
  const empty = throttle(4, {});
  assert.deepEqual(await empty.t.finish(), { indexedDocuments: 0, failed: [], pending: [] });
  assert.deepEqual(empty.settled, []);
});
