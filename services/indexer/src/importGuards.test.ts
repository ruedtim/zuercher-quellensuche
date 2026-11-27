import { test } from "node:test";
import { strict as assert } from "node:assert";
import { assertTaskSucceeded, findMissingIds, isInternalCrash, missingIds } from "./importGuards.ts";

const UPDATE = "documentAdditionOrUpdate";

test("assertTaskSucceeded: nur succeeded geht durch", () => {
  assert.doesNotThrow(() => assertTaskSucceeded({ uid: 3, type: UPDATE, status: "succeeded", error: null }));
});

test("assertTaskSucceeded: failed/canceled werfen mit Meilis Fehlermeldung", () => {
  // Meili v1.13.3, neue ID neben einem zweiten userProvided-Embedder.
  const message = "Index `chunks`: While embedding documents for embedder `jina_de`: no vectors provided for document `x_c0001`";
  assert.throws(
    () => assertTaskSucceeded({ uid: 8, type: UPDATE, status: "failed", error: { message } }),
    (err: Error) => err.message === `Task 8 (${UPDATE}) failed: ${message}`,
  );
  assert.throws(
    () => assertTaskSucceeded({ uid: 9, type: UPDATE, status: "canceled", error: null }),
    /Task 9 \(documentAdditionOrUpdate\) canceled: ohne Fehlermeldung/,
  );
});

test("missingIds: Reihenfolge wie angefragt, Zahlen-IDs aus Meili zählen als String", () => {
  assert.deepEqual(missingIds(["c", "a", "b", "42"], [{ id: "a" }, { id: 42 }, { id: "a" }]), ["c", "b"]);
  assert.deepEqual(missingIds(["a"], [{}]), ["a"]);
  assert.deepEqual(missingIds([], [{ id: "a" }]), []);
});

/** Fake für POST /documents/fetch: liefert die vorhandenen der angefragten IDs. */
function fakeIndex(existing: string[]) {
  const have = new Set(existing);
  const calls: string[][] = [];
  const fetchExisting = async (ids: string[]) => {
    calls.push(ids);
    return ids.filter((id) => have.has(id)).map((id) => ({ id }));
  };
  return { calls, fetchExisting };
}

test("findMissingIds: volle Batches plus der angebrochene letzte", async () => {
  const idx = fakeIndex(["a", "b", "c", "d", "e", "f", "g"]);
  const docs = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
  const report = await findMissingIds(docs, idx.fetchExisting, { batchSize: 3 });
  assert.deepEqual(report, { checked: 7, missing: 0, sample: [] });
  assert.deepEqual(idx.calls, [["a", "b", "c"], ["d", "e", "f"], ["g"]]);
});

test("findMissingIds: zählt alle fehlenden, Stichprobe gedeckelt", async () => {
  const idx = fakeIndex(["a", "c"]);
  const docs = ["a", "x1", "c", "x2", "x3", "x4"].map((id) => ({ id }));
  const report = await findMissingIds(docs, idx.fetchExisting, { batchSize: 4, sampleSize: 3 });
  assert.deepEqual(report, { checked: 6, missing: 4, sample: ["x1", "x2", "x3"] });
});

test("findMissingIds: Duplikate im Batch nur einmal abgefragt, Zahlen-IDs als String", async () => {
  const idx = fakeIndex(["7", "a"]);
  const report = await findMissingIds([{ id: "a" }, { id: 7 }, { id: "a" }, { id: "b" }], idx.fetchExisting, {
    batchSize: 10,
  });
  assert.deepEqual(idx.calls, [["a", "7", "b"]]);
  assert.deepEqual(report, { checked: 3, missing: 1, sample: ["b"] });
});

test("findMissingIds: async-Quelle; leere Eingabe fragt nichts ab", async () => {
  async function* source() {
    yield { id: "a" };
    yield { id: "z" };
  }
  const idx = fakeIndex(["a"]);
  assert.deepEqual(await findMissingIds(source(), idx.fetchExisting, { batchSize: 1 }), {
    checked: 2,
    missing: 1,
    sample: ["z"],
  });
  assert.deepEqual(idx.calls, [["a"], ["z"]]);

  const empty = fakeIndex([]);
  assert.deepEqual(await findMissingIds([], empty.fetchExisting, { batchSize: 5 }), {
    checked: 0,
    missing: 0,
    sample: [],
  });
  assert.equal(empty.calls.length, 0);
});

test("isInternalCrash: nur ein gescheiterter Task mit Fehlercode internal", () => {
  const crash = {
    uid: 3757,
    type: "settingsUpdate",
    status: "failed",
    error: {
      message: "An unexpected crash occurred when processing the task: called `Result::unwrap()` on an `Err` value: Any { .. }",
      code: "internal",
    },
  };
  assert.equal(isInternalCrash(crash), true);
  assert.equal(isInternalCrash({ ...crash, status: "succeeded" }), false);
  assert.equal(
    isInternalCrash({ ...crash, error: { message: "no vectors provided for document `alt`", code: "vector_embedding_error" } }),
    false,
  );
  assert.equal(isInternalCrash({ ...crash, error: null }), false);
});
