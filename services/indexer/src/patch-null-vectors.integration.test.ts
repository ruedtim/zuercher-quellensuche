/**
 * Integrationstest für patch-null-vectors.ts gegen einen Wegwerf-Meili – nie
 * gegen Prod oder den lokalen Mirror: läuft nur mit MEILI_IT_URL und bricht
 * ab, wenn der Server andere Indexe als `itv_*` hat. Das Präfix teilt er mit
 * import-vectors.integration.test.ts, damit beide Dateien parallel laufen
 * können (`npx tsx --test src/*.integration.test.ts`). Ohne MEILI_IT_URL (CI)
 * übersprungen.
 *
 *   docker run --rm -d --name zszh-meili-it -p 127.0.0.1:7799:7700 \
 *     -e MEILI_MASTER_KEY=test -e MEILI_NO_ANALYTICS=true getmeili/meilisearch:v1.13
 *   MEILI_IT_URL=http://127.0.0.1:7799 MEILI_IT_KEY=test \
 *     npx tsx --test src/patch-null-vectors.integration.test.ts
 *   docker stop zszh-meili-it
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { MeiliSearch, type EnqueuedTask, type Settings } from "meilisearch";
import { assertTaskSucceeded } from "./importGuards.ts";

const url = process.env["MEILI_IT_URL"];
const key = process.env["MEILI_IT_KEY"] ?? "test";
const client = new MeiliSearch({ host: url ?? "http://127.0.0.1:7799", apiKey: key });
const skip = url ? false : "MEILI_IT_URL nicht gesetzt (Wegwerf-Meili, siehe Dateikopf)";

const INDEXER_DIR = fileURLToPath(new URL("..", import.meta.url));
const PREFIX = `itv_${Date.now().toString(36)}_null_`;
// Wie chunks vor dem qwen3_06b-PATCH: nur `a` konfiguriert.
const ONE_EMBEDDER: Settings["embedders"] = { a: { source: "userProvided", dimensions: 3 } };
// Wie Prod-chunks heute (jina_de + qwen3_06b).
const TWO_EMBEDDERS: Settings["embedders"] = {
  a: { source: "userProvided", dimensions: 3 },
  b: { source: "userProvided", dimensions: 2 },
};
const SEED_ONE = [
  { id: "d1", text: "eins", _vectors: { a: [1, 0, 0] } },
  { id: "d2", text: "zwei", _vectors: { a: [0, 1, 0] } },
  { id: "d3", text: "drei", _vectors: { a: [0, 0, 1] } },
];
const SEED_TWO = [
  { id: "d1", text: "eins", _vectors: { a: [1, 0, 0], b: [1, 0] } },
  { id: "d2", text: "zwei", _vectors: { a: [0, 1, 0], b: [0, 1] } },
  { id: "d3", text: "drei", _vectors: { a: [0, 0, 1], b: [1, 1] } },
];
// So liefert Meili einen Opt-out (`null`) für einen konfigurierten Embedder.
const OPTED_OUT = { embeddings: [], regenerate: false };

type VecDoc = { id: string; _vectors?: Record<string, unknown> };

const created: string[] = [];
let tmp = "";

async function waitOk(task: EnqueuedTask) {
  assertTaskSucceeded(await client.waitForTask(task.taskUid, { timeOutMs: 30_000 }));
}

async function seed(name: string, embedders: Settings["embedders"], docs: object[]) {
  const uid = PREFIX + name;
  created.push(uid);
  await waitOk(await client.createIndex(uid, { primaryKey: "id" }));
  const index = client.index(uid);
  await waitOk(await index.updateSettings({ filterableAttributes: ["id"], embedders }));
  await waitOk(await index.addDocuments(docs));
  return uid;
}

function input(name: string, records: object[]): string {
  const path = join(tmp, `${name}.jsonl`);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

/** Startet die echte CLI (wie auf Hetzner, nur gegen den Wegwerf-Meili). */
function run(...args: string[]): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, ["--import", "tsx", "src/patch-null-vectors.ts", ...args], {
    cwd: INDEXER_DIR,
    encoding: "utf8",
    env: { ...process.env, MEILI_URL: url, MEILI_MASTER_KEY: key },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

/** `_vectors.<embedder>` eines Docs, wie Meili es mit retrieveVectors liefert. */
async function vectors(uid: string, id: string, embedder: string): Promise<unknown> {
  const res = await client.index(uid).getDocuments<VecDoc>({
    filter: `id = '${id}'`,
    retrieveVectors: true,
    limit: 1,
  });
  return res.results[0]?._vectors?.[embedder];
}

function vec(...values: number[]) {
  return { embeddings: [values], regenerate: false };
}

async function docCount(uid: string): Promise<number> {
  return (await client.index(uid).getStats()).numberOfDocuments;
}

describe("patch-null-vectors gegen einen Wegwerf-Meili", { skip, timeout: 180_000 }, () => {
  before(async () => {
    const { results } = await client.getIndexes({ limit: 1000 });
    const foreign = results.map((i) => i.uid).filter((uid) => !uid.startsWith("itv_"));
    if (foreign.length > 0) {
      throw new Error(`MEILI_IT_URL hat fremde Indexe (${foreign.join(", ")}) – nur gegen einen leeren Wegwerf-Meili`);
    }
    tmp = mkdtempSync(join(tmpdir(), "zszh-itn-"));
  });

  after(async () => {
    for (const uid of created) await waitOk(await client.deleteIndex(uid));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("vorhandene IDs: Opt-out landet, der andere Embedder bleibt, Zeilen ohne id zählen nicht", async () => {
    const uid = await seed("ok", TWO_EMBEDDERS, SEED_TWO);
    const file = input("ok", [{ id: "d1" }, {}, { id: "d2", text: "egal" }]);
    // --batch=1 --max-in-flight=1: der zweite Flush wartet schon in der Drossel.
    const { code, out } = run(`--ids=${file}`, "--embedder=b", `--index=${uid}`, "--batch=1", "--max-in-flight=1");
    assert.equal(code, 0, out);
    assert.match(out, /Vorab-Check: alle 2 IDs im Index/);
    assert.match(out, /total=2, skipped=1, numberOfDocuments=3 \(vorher 3\)/);
    assert.deepEqual(await vectors(uid, "d1", "b"), OPTED_OUT);
    assert.deepEqual(await vectors(uid, "d2", "b"), OPTED_OUT);
    assert.deepEqual(await vectors(uid, "d3", "b"), vec(1, 1));
    assert.deepEqual(await vectors(uid, "d1", "a"), vec(1, 0, 0));
    // Nur `_vectors` wird geschrieben, weitere Felder der Eingabe nicht.
    assert.deepEqual(await client.index(uid).getDocument("d2"), { id: "d2", text: "zwei" });
  });

  test("Backfill vor dem Settings-PATCH: danach lässt sich der neue Embedder konfigurieren", async () => {
    const uid = await seed("backfill", ONE_EMBEDDER, SEED_ONE);
    const file = input("backfill", SEED_ONE.map(({ id }) => ({ id })));
    const { code, out } = run(`--ids=${file}`, "--embedder=b", `--index=${uid}`);
    assert.equal(code, 0, out);
    // Ohne den Key auf JEDEM Doc lehnte Meili diesen Task ab («no vectors provided»).
    await waitOk(await client.index(uid).updateEmbedders({ b: { source: "userProvided", dimensions: 2 } }));
    for (const { id } of SEED_ONE) assert.deepEqual(await vectors(uid, id, "b"), OPTED_OUT, id);
    assert.deepEqual(await vectors(uid, "d2", "a"), vec(0, 1, 0));
  });

  test("fehlende ID: Abbruch vor dem ersten Schreib-Task", async () => {
    const uid = await seed("missing", TWO_EMBEDDERS, SEED_TWO);
    const file = input("missing", [{ id: "d1" }, { id: "ghost" }]);
    const { code, out } = run(`--ids=${file}`, "--embedder=b", `--index=${uid}`);
    assert.equal(code, 1, out);
    assert.match(out, /1 von 2 IDs fehlen im Index .* \(z\. B\. ghost\) – Abbruch, nichts geschrieben/);
    assert.deepEqual(await vectors(uid, "d1", "b"), vec(1, 0));
    assert.equal(await docCount(uid), 3);
    const tasks = await client.getTasks({ indexUids: [uid], types: ["documentAdditionOrUpdate"] });
    assert.equal(tasks.results.length, 1, "nur der Seed-Task");
  });

  test("--allow-new-ids überspringt den Check: Meili legt ein Rumpf-Doc an", async () => {
    // Opt-out auf den einzigen userProvided-Embedder: das neue Doc «trägt» ihn.
    const uid = await seed("allow", ONE_EMBEDDER, SEED_ONE);
    const file = input("allow", [{ id: "d1" }, { id: "ghost" }]);
    const { code, out } = run(`--ids=${file}`, "--embedder=a", `--index=${uid}`, "--allow-new-ids");
    assert.equal(code, 0, out);
    assert.match(out, /kein Vorab-Check \(--allow-new-ids\)/);
    assert.match(out, /numberOfDocuments=4 \(vorher 3\)/);
    assert.deepEqual(await client.index(uid).getDocument("ghost"), { id: "ghost" });
    assert.deepEqual(await vectors(uid, "d1", "a"), OPTED_OUT);
  });

  test("abgelehnter Task (neue ID beim Backfill) bricht ab, der ganze Batch fehlt", async () => {
    // Dem neuen Doc fehlt `_vectors.a` – Meili lehnt den Batch ab, genauso bei
    // zwei konfigurierten Embeddern (Prod-chunks).
    const uid = await seed("rejected", ONE_EMBEDDER, SEED_ONE);
    const file = input("rejected", [{ id: "d1" }, { id: "ghost" }]);
    const { code, out } = run(`--ids=${file}`, "--embedder=b", `--index=${uid}`, "--allow-new-ids");
    assert.equal(code, 1, out);
    assert.match(out, /Task \d+ \(documentAdditionOrUpdate\) failed: .*no vectors provided for document `ghost`/);
    assert.doesNotMatch(out, /DONE/);
    assert.equal(await vectors(uid, "d1", "b"), undefined);
    assert.equal(await docCount(uid), 3);
  });

  test("fehlender Index: Abbruch, auch mit --allow-new-ids wird keiner angelegt", async () => {
    const uid = `${PREFIX}gibtsnicht`;
    const file = input("noindex", [{ id: "d1" }]);
    const { code, out } = run(`--ids=${file}`, "--embedder=b", `--index=${uid}`, "--allow-new-ids");
    assert.equal(code, 1, out);
    assert.match(out, /not found/);
    await assert.rejects(client.getIndex(uid), /not found/);
  });
});
