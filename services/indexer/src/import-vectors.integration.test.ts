/**
 * Integrationstest für import-vectors.ts gegen einen Wegwerf-Meili – nie gegen
 * Prod oder den lokalen Mirror: läuft nur mit MEILI_IT_URL und bricht ab,
 * wenn der Server andere Indexe als die eigenen `itv_*` hat. Ohne
 * MEILI_IT_URL (CI) übersprungen.
 *
 *   docker run --rm -d --name zszh-meili-it -p 127.0.0.1:7799:7700 \
 *     -e MEILI_MASTER_KEY=test getmeili/meilisearch:v1.13
 *   MEILI_IT_URL=http://127.0.0.1:7799 MEILI_IT_KEY=test \
 *     npx tsx --test src/import-vectors.integration.test.ts
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
const PREFIX = `itv_${Date.now().toString(36)}_`;
const ONE_EMBEDDER: Settings["embedders"] = { e: { source: "userProvided", dimensions: 3 } };
const SEED = [
  { id: "d1", text: "eins", _vectors: { e: [1, 0, 0] } },
  { id: "d2", text: "zwei", _vectors: { e: [0, 1, 0] } },
  { id: "d3", text: "drei", _vectors: { e: [0, 0, 1] } },
];

type VecDoc = { id: string; _vectors?: Record<string, { embeddings: number[][] }> };

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
  const res = spawnSync(process.execPath, ["--import", "tsx", "src/import-vectors.ts", ...args], {
    cwd: INDEXER_DIR,
    encoding: "utf8",
    env: { ...process.env, MEILI_URL: url, MEILI_MASTER_KEY: key },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

async function vector(uid: string, id: string, embedder: string): Promise<number[] | null> {
  const res = await client.index(uid).getDocuments<VecDoc>({
    filter: `id = '${id}'`,
    retrieveVectors: true,
    limit: 1,
  });
  return res.results[0]?._vectors?.[embedder]?.embeddings[0] ?? null;
}

async function docCount(uid: string): Promise<number> {
  return (await client.index(uid).getStats()).numberOfDocuments;
}

describe("import-vectors gegen einen Wegwerf-Meili", { skip, timeout: 180_000 }, () => {
  before(async () => {
    const { results } = await client.getIndexes({ limit: 1000 });
    const foreign = results.map((i) => i.uid).filter((uid) => !uid.startsWith("itv_"));
    if (foreign.length > 0) {
      throw new Error(`MEILI_IT_URL hat fremde Indexe (${foreign.join(", ")}) – nur gegen einen leeren Wegwerf-Meili`);
    }
    tmp = mkdtempSync(join(tmpdir(), "zszh-itv-"));
  });

  after(async () => {
    for (const uid of created) await waitOk(await client.deleteIndex(uid));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("vorhandene IDs: Vektoren landen, übersprungene Zeilen zählen nicht als fehlend", async () => {
    const uid = await seed("ok", ONE_EMBEDDER, SEED);
    const file = input("ok", [
      { id: "d1", vector: [0, 0, 1] },
      { id: "d2", vectors: { e: [0, 1, 1] } },
      { id: "d3", _vectors: { e: [1, 1, 1] } },
      { id: "d4" }, // ohne Vektor – fehlt im Index, wird aber nie geschrieben
      { id: "d5", vector: [1, 2] }, // Dimensions-Mismatch zu --dims=3
    ]);
    // --batch=2 --max-in-flight=1: der zweite Flush wartet schon in der Drossel.
    const { code, out } = run(`--input=${file}`, "--embedder=e", `--index=${uid}`, "--dims=3", "--batch=2", "--max-in-flight=1");
    assert.equal(code, 0, out);
    assert.match(out, /Vorab-Check: alle 3 IDs im Index/);
    assert.match(out, /total=3, skipped=2 \(davon 1 Dimensions-Mismatch\)/);
    assert.match(out, /numberOfDocuments=3 \(vorher 3\)/);
    assert.deepEqual(await vector(uid, "d1", "e"), [0, 0, 1]);
    assert.deepEqual(await vector(uid, "d2", "e"), [0, 1, 1]);
    assert.deepEqual(await vector(uid, "d3", "e"), [1, 1, 1]);
  });

  test("fehlende ID: Abbruch vor dem ersten Schreib-Task", async () => {
    const uid = await seed("missing", ONE_EMBEDDER, SEED);
    const file = input("missing", [
      { id: "d1", vector: [0, 1, 1] },
      { id: "ghost", vector: [1, 1, 0] },
    ]);
    const { code, out } = run(`--input=${file}`, "--embedder=e", `--index=${uid}`);
    assert.equal(code, 1, out);
    assert.match(out, /1 von 2 IDs fehlen im Index .* \(z\. B\. ghost\) – Abbruch, nichts geschrieben/);
    assert.deepEqual(await vector(uid, "d1", "e"), [1, 0, 0]);
    assert.equal(await docCount(uid), 3);
    const tasks = await client.getTasks({ indexUids: [uid], types: ["documentAdditionOrUpdate"] });
    assert.equal(tasks.results.length, 1, "nur der Seed-Task");
  });

  test("--allow-new-ids überspringt den Check: Meili legt ein Rumpf-Doc an", async () => {
    const uid = await seed("allow", ONE_EMBEDDER, SEED);
    const file = input("allow", [
      { id: "d1", vector: [0, 1, 1] },
      { id: "ghost", vector: [1, 1, 0] },
    ]);
    const { code, out } = run(`--input=${file}`, "--embedder=e", `--index=${uid}`, "--allow-new-ids");
    assert.equal(code, 0, out);
    assert.match(out, /kein Vorab-Check \(--allow-new-ids\)/);
    assert.match(out, /numberOfDocuments=4 \(vorher 3\)/);
    assert.deepEqual(await client.index(uid).getDocument("ghost"), { id: "ghost" });
  });

  test("abgelehnter Task (falsche Dimension) bricht ab, der ganze Batch fehlt", async () => {
    const uid = await seed("dims", ONE_EMBEDDER, SEED);
    const file = input("dims", [
      { id: "d1", vector: [1, 2] },
      { id: "d2", vector: [1, 1, 1] },
    ]);
    const { code, out } = run(`--input=${file}`, "--embedder=e", `--index=${uid}`);
    assert.equal(code, 1, out);
    assert.match(out, /Task \d+ \(documentAdditionOrUpdate\) failed: /);
    assert.doesNotMatch(out, /DONE/);
    assert.deepEqual(await vector(uid, "d2", "e"), [0, 1, 0]);
  });

  test("zwei userProvided-Embedder: eine neue ID lässt den ganzen Batch scheitern", async () => {
    // Wie Prod-chunks (jina_de + qwen3_06b): ein neues Doc ohne `_vectors.a` lehnt Meili ab.
    const embedders: Settings["embedders"] = {
      a: { source: "userProvided", dimensions: 3 },
      b: { source: "userProvided", dimensions: 2 },
    };
    const uid = await seed("twoemb", embedders, [
      { id: "d1", _vectors: { a: [1, 0, 0], b: null } },
      { id: "d2", _vectors: { a: [0, 1, 0], b: null } },
    ]);
    const file = input("twoemb", [
      { id: "d1", vector: [1, 0] },
      { id: "ghost", vector: [0, 1] },
    ]);
    const { code, out } = run(`--input=${file}`, "--embedder=b", `--index=${uid}`, "--allow-new-ids");
    assert.equal(code, 1, out);
    assert.match(out, /failed: .*no vectors provided for document `ghost`/);
    assert.equal(await vector(uid, "d1", "b"), null);
    assert.equal(await docCount(uid), 2);
  });

  test("fehlender Index: Abbruch, auch mit --allow-new-ids wird keiner angelegt", async () => {
    const uid = `${PREFIX}gibtsnicht`;
    const file = input("noindex", [{ id: "d1", vector: [0, 0, 1] }]);
    const { code, out } = run(`--input=${file}`, "--embedder=e", `--index=${uid}`, "--allow-new-ids");
    assert.equal(code, 1, out);
    assert.match(out, /not found/);
    await assert.rejects(client.getIndex(uid), /not found/);
  });
});
