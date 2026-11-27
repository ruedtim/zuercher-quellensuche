/**
 * Integrationstest für main.ts (Task-Status von --all und ensureIndex, KRDB-Felder,
 * Vergleichsschlüssel der Namen, Synonyme gegen die Wortanfang-Lücke) gegen einen Wegwerf-Meili – nie gegen Prod oder
 * den lokalen Mirror: läuft nur mit MEILI_IT_URL und bricht ab, wenn der Server
 * andere Indexe als `itv_*` hat.
 * Das Präfix teilt er mit den übrigen Integrationstests, damit alle parallel
 * laufen können (`npx tsx --test src/*.integration.test.ts`). Ohne
 * MEILI_IT_URL (CI) übersprungen.
 *
 *   docker run --rm -d --name zszh-meili-it -p 127.0.0.1:7799:7700 \
 *     -e MEILI_MASTER_KEY=test -e MEILI_NO_ANALYTICS=true getmeili/meilisearch:v1.13
 *   MEILI_IT_URL=http://127.0.0.1:7799 MEILI_IT_KEY=test \
 *     npx tsx --test src/main.integration.test.ts
 *   docker stop zszh-meili-it
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { MeiliSearch, type EnqueuedTask } from "meilisearch";
import { assertTaskSucceeded } from "./importGuards.ts";
import { readFileSync } from "node:fs";
import type { KrdbRegister } from "./krdb/krdbMatch.ts";

const url = process.env["MEILI_IT_URL"];
const key = process.env["MEILI_IT_KEY"] ?? "test";
const client = new MeiliSearch({ host: url ?? "http://127.0.0.1:7799", apiKey: key });
const skip = url ? false : "MEILI_IT_URL nicht gesetzt (Wegwerf-Meili, siehe Dateikopf)";

const INDEXER_DIR = fileURLToPath(new URL("..", import.meta.url));
const PREFIX = `itv_${Date.now().toString(36)}_main_`;

const created: string[] = [];
let tmp = "";

async function waitOk(task: EnqueuedTask) {
  assertTaskSucceeded(await client.waitForTask(task.taskUid, { timeOutMs: 30_000 }));
}

async function createIndex(name: string): Promise<string> {
  const uid = PREFIX + name;
  created.push(uid);
  await waitOk(await client.createIndex(uid, { primaryKey: "id" }));
  return uid;
}

function tei(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc>
    <titleStmt><title>${title}</title></titleStmt>
    <sourceDesc><bibl><title>${title}</title><date when="1965-03-15">15. März 1965</date></bibl></sourceDesc>
  </fileDesc></teiHeader>
  <text><body><p>Text zu ${title}.</p></body></text>
</TEI>`;
}

/** KRP-Protokoll ohne erkannte Personen: Namen stehen nur in Titel und Text (wie krp-late). */
function teiKrp(title: string, date: string, text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc>
    <titleStmt><title>${title}</title></titleStmt>
    <sourceDesc><bibl><title>${title}</title><date when="${date}">${date}</date></bibl></sourceDesc>
  </fileDesc></teiHeader>
  <text><body><p>${text}</p></body></text>
</TEI>`;
}

/** Korpus wie ~/zszh-corpus: data/<Serie>/<id>.xml – die ID ist der Dateiname. */
function corpus(name: string, files: Record<string, string[]>): string {
  const dir = join(tmp, name);
  for (const [series, ids] of Object.entries(files)) {
    for (const id of ids) {
      const path = join(dir, "data", series, `${id}.xml`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, tei(id));
    }
  }
  return dir;
}

/** Startet die echte CLI (wie auf Hetzner, nur gegen den Wegwerf-Meili). */
function run(
  uid: string,
  dataDir: string,
  args: string[],
  env: Record<string, string> = {},
): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts", ...args], {
    cwd: INDEXER_DIR,
    encoding: "utf8",
    env: {
      ...process.env,
      MEILI_URL: url,
      MEILI_MASTER_KEY: key,
      MEILI_INDEX: uid,
      MEILI_BATCH: "5000",
      MEILI_TASK_WAIT_S: "60",
      ZSZH_DATA_DIR: dataDir,
      RENDER_OUTPUT_DIR: join(dataDir, "output"),
      PUBLIC_BASE_URL: "https://zentraleserien.example",
      EMBED_URL: "http://127.0.0.1:9", // --skip-embed: nie angefragt
      ...env,
    },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

async function docCount(uid: string): Promise<number> {
  return (await client.index(uid).getStats()).numberOfDocuments;
}

async function taskCount(
  uid: string,
  type: "documentAdditionOrUpdate" | "indexCreation" | "settingsUpdate",
): Promise<number> {
  return (await client.getTasks({ indexUids: [uid], types: [type] })).results.length;
}

describe("main.ts gegen einen Wegwerf-Meili", { skip, timeout: 180_000 }, () => {
  before(async () => {
    const { results } = await client.getIndexes({ limit: 1000 });
    const foreign = results.map((i) => i.uid).filter((uid) => !uid.startsWith("itv_"));
    if (foreign.length > 0) {
      throw new Error(`MEILI_IT_URL hat fremde Indexe (${foreign.join(", ")}) – nur gegen einen leeren Wegwerf-Meili`);
    }
    tmp = mkdtempSync(join(tmpdir(), "zszh-iti-"));
  });

  after(async () => {
    for (const uid of created) await waitOk(await client.deleteIndex(uid));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("--all: abgelehnter Batch ⇒ Exit 1 mit Meilis Meldung, FAILED statt DONE; die übrigen Batches landen", async () => {
    const uid = PREFIX + "bad";
    created.push(uid); // legt ensureIndex an
    // --series=ABl,KRP: erst beide ABl-Docs (Batch 1), dann KRP (Batch 2 mit ungültiger ID).
    const dir = corpus("bad", { ABl: ["a1", "a2"], KRP: ["k1", "k.bad"] });
    const { code, out } = run(uid, dir, ["--all", "--skip-embed", "--series=ABl,KRP"], { MEILI_BATCH: "2" });
    assert.equal(code, 1, out);
    assert.match(
      out,
      /Meili-Task \d+ fehlgeschlagen \(2 Docs nicht geschrieben\): invalid_document_id: Document identifier `"k\.bad"` is invalid/,
    );
    assert.match(out, /\[indexer\] FAILED in .* \| tasks=2 taskFailed=1 pending=0 meiliIndexed=2/);
    assert.doesNotMatch(out, /\[indexer\] DONE/);
    assert.equal(await docCount(uid), 2);
    // Das gültige k1 ging mit seinem Batch verloren.
    await assert.rejects(client.index(uid).getDocument("k1"), /not found/);
    assert.equal(await taskCount(uid, "indexCreation"), 1);
  });

  test("ensureIndex: abgelehnter Settings-Task ⇒ Exit 1, bevor ein Batch eingereicht ist", async () => {
    // Bestands-Doc ohne _vectors: den userProvided-Embedder jina_de lehnt Meili dann ab.
    const uid = await createIndex("settings");
    await waitOk(await client.index(uid).addDocuments([{ id: "alt", title: "ohne Vektor" }]));
    const dir = corpus("settings", { ABl: ["a1", "a2"] });
    const { code, out } = run(uid, dir, ["--all", "--skip-embed", "--series=ABl"]);
    assert.equal(code, 1, out);
    assert.match(out, /Task \d+ \(settingsUpdate\) failed: .*no vectors provided for document [`"]alt[`"]/);
    assert.doesNotMatch(out, /DONE/);
    assert.equal(await taskCount(uid, "documentAdditionOrUpdate"), 1, "nur der Seed-Task");
    assert.equal(await docCount(uid), 1);
  });

  test("ensureIndex: Index jenseits der ersten 20 von GET /indexes wird gefunden, Lauf DONE", async () => {
    // GET /indexes liefert ohne limit 20, alphabetisch – `…_zz` steht hinter den 20 `…_pad*`.
    await Promise.all(Array.from({ length: 20 }, (_, i) => createIndex(`pad${String(i).padStart(2, "0")}`)));
    const uid = await createIndex("zz");
    const dir = corpus("zz", { ABl: ["a1", "a2"] });
    const { code, out } = run(uid, dir, ["--all", "--skip-embed", "--series=ABl"]);
    assert.equal(code, 0, out);
    assert.match(out, /\[indexer\] DONE in .* \| tasks=1 taskFailed=0 pending=0 meiliIndexed=2/);
    assert.equal(await docCount(uid), 2);
    assert.equal(await taskCount(uid, "indexCreation"), 1, "kein zweites createIndex");
  });

  test("--patch-manifests: gemeinsamer Warte- und Prüfweg, DONE mit Task-Zusammenfassung", async () => {
    const uid = await createIndex("manifests");
    await waitOk(
      await client.index(uid).updateSettings({
        filterableAttributes: ["id"],
        embedders: { jina_de: { source: "userProvided", dimensions: 768 } },
      }),
    );
    const localhost = "http://localhost:5173/iiif/ABl/a1/manifest.json";
    await waitOk(
      await client.index(uid).addDocuments([{ id: "a1", manifestUrl: localhost, _vectors: { jina_de: null } }]),
    );
    // a2 fehlt im Index: übersprungen statt als Rumpf-Doc angelegt.
    const dir = corpus("manifests", { ABl: ["a1", "a2"] });
    const { code, out } = run(uid, dir, ["--patch-manifests", "--series=ABl"]);
    assert.equal(code, 0, out);
    assert.match(out, /changed=1 \(localhost=1\) unchanged=0 missing=1/);
    assert.match(out, /\[patch-manifests\] DONE in .* \| tasks=1 taskFailed=0 pending=0 meiliIndexed=1/);
    assert.equal((await client.index(uid).getDocument("a1")).manifestUrl, null);
  });

  test("KRP: --all schreibt krdbIds/krdbTitleIds, --patch-krdb stellt beschädigte Felder wieder her", async () => {
    const register = JSON.parse(
      readFileSync(new URL("./krdb/krdb-register.json", import.meta.url), "utf-8"),
    ) as KrdbRegister;
    const idOf = (first: string, last: string) => register.persons.find((p) => p.first === first && p.last === last)!.id;
    const sulser = idOf("Jürg", "Sulser");
    const lenggenhager = idOf("Marcel", "Lenggenhager");

    const uid = PREFIX + "krdb";
    created.push(uid); // legt ensureIndex an
    const dir = corpus("krdb", { ABl: ["a1"] });
    const krp = join(dir, "data", "KRP", "k1.xml");
    mkdirSync(dirname(krp), { recursive: true });
    writeFileSync(
      krp,
      teiKrp(
        "Interpellation Marcel Lenggenhager (BDP, Gossau) betreffend Verkehr",
        "2018-09-24",
        // Namenserkennung wie im Korpus: <persName> im Text ⇒ `persons`.
        'Ratspräsident <persName n="1">Jürg Sulser</persName>: Das Wort hat <persName n="2">Marcel Lenggenhager</persName> (BDP, Gossau).',
      ),
    );

    // Normalpfad: KRP-Doc bekommt die Felder, andere Serien nicht.
    let r = run(uid, dir, ["--all", "--skip-embed", "--series=ABl,KRP"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /KRDB-Register: \d+ Personen/);
    const doc = await client.index(uid).getDocument("k1");
    assert.deepEqual(doc.krdbIds, [sulser, lenggenhager].sort((a, b) => a - b));
    assert.deepEqual(doc.krdbTitleIds, [lenggenhager]);
    assert.equal((await client.index(uid).getDocument("a1")).krdbIds, undefined);
    // Filterbar: Personenseite = krdbIds IN […].
    const hits = await client.index(uid).search("", { filter: `krdbIds IN [${sulser}]`, limit: 0 });
    assert.equal(hits.estimatedTotalHits, 1);

    // Felder beschädigen (leer): --patch-krdb liest, rechnet neu, patcht nur Abweichendes.
    await waitOk(await client.index(uid).updateDocuments([{ id: "k1", krdbIds: [], krdbTitleIds: [] }]));
    r = run(uid, dir, ["--patch-krdb", "--dry-run"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /docs=1 mit Personen=1 .* changed=1 unchanged=0/);
    assert.match(r.out, /dry-run: nichts geschrieben/);
    assert.deepEqual((await client.index(uid).getDocument("k1")).krdbIds, [], "Dry-Run schreibt nichts");

    r = run(uid, dir, ["--patch-krdb"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[patch-krdb\] DONE in .* changed=1 unchanged=0 \| tasks=1 taskFailed=0 pending=0/);
    const fixed = await client.index(uid).getDocument("k1");
    assert.deepEqual(fixed.krdbIds, [sulser, lenggenhager].sort((a, b) => a - b));
    assert.deepEqual(fixed.krdbTitleIds, [lenggenhager]);

    // Idempotent: ein weiterer Lauf findet nichts mehr.
    r = run(uid, dir, ["--patch-krdb", "--dry-run"]);
    assert.match(r.out, /changed=0 unchanged=1/);
  });

  test("Vergleichsschlüssel: --all schreibt personKeys/placeKeys/orgKeys (RM aus den vereinheitlichten Namen), --patch-entity-keys rüstet nach", async () => {
    const keysOf = (d: Record<string, unknown>) => ({ personKeys: d.personKeys, placeKeys: d.placeKeys, orgKeys: d.orgKeys });

    // Normalpfad: ABl mit erkannten Namen, RM-Sitzung mit Namen nur als Markup im Text.
    const uid = PREFIX + "keys";
    created.push(uid); // legt ensureIndex an
    const dir = corpus("keys", {});
    const abl = join(dir, "data", "ABl", "a1.xml");
    mkdirSync(dirname(abl), { recursive: true });
    writeFileSync(
      abl,
      teiKrp( // dasselbe TEI-Gerüst
        "Bekanntmachung",
        "1934-05-02",
        '<persName>Frey, Hans</persName> in <placeName>Fischenthal</placeName> und <placeName>Stadt Zürich</placeName>; ' +
          "<orgName>Regierungsrath</orgName>, <persName>Meier</persName>.",
      ),
    );
    const rmFile = join(dir, "data", "RM", "0441", "RM_1642_0441_0012.xml");
    mkdirSync(dirname(rmFile), { recursive: true });
    writeFileSync(
      rmFile,
      `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc>
    <titleStmt><title>Ratssitzung 17.10.1642 (a. St.)</title></titleStmt>
    <sourceDesc><bibl><title>Ratssitzung 17.10.1642 (a. St.)</title><date when="1642-10-17" calendar="#julian"/>
      <ident>StAZH B II 441, S. 22–25</ident></bibl></sourceDesc>
  </fileDesc></teiHeader>
  <text><body><div type="session"><p>Herr <persName resp="#ner">Burgermeister Waser</persName>,
    Mühle zu <placeName resp="#ner">Küsnacht</placeName></p></div></body></text>
</TEI>`,
    );
    let r = run(uid, dir, ["--all", "--skip-embed", "--series=ABl,RM"]);
    assert.equal(r.code, 0, r.out);
    const idx = client.index(uid);
    // «Meier» allein hat keinen Schlüssel, «Stadt Zürich» = «zurich».
    assert.deepEqual(keysOf(await idx.getDocument("a1")), {
      personKeys: ["hans frei"],
      placeKeys: ["fischental", "zurich"],
      orgKeys: ["regierungsrat"],
    });
    // RM: Schlüssel aus den vereinheitlichten Namen (rmNames.ts, seit 2026-11-16): «Küsnacht» steht im
    // Ortsverzeichnis, «Burgermeister Waser» hat nur den Nachnamen und fällt weg.
    assert.deepEqual(keysOf(await idx.getDocument("RM_1642_0441_0012")), {
      personKeys: [],
      placeKeys: ["kusnacht"],
      orgKeys: [],
    });
    // Filterbar, nicht displayed: die Suche liefert die Felder nicht aus.
    const hit = await idx.search("", { filter: "placeKeys IN ['fischental']" });
    assert.deepEqual(hit.hits.map((h) => h.id), ["a1"]);
    assert.equal(hit.hits[0].placeKeys, undefined);
    assert.ok(Array.isArray(hit.hits[0].places));

    // Nachrüsten: Bestands-Docs ohne die Felder (bzw. mit Fassung-1-Schlüssel), Felder
    // noch nicht filterbar – wie Prod vor dem ersten Lauf.
    const uid2 = await createIndex("keys-alt");
    const alt = client.index(uid2);
    await waitOk(
      await alt.updateSettings({
        filterableAttributes: ["id", "series"],
        embedders: { jina_de: { source: "userProvided", dimensions: 768 } },
      }),
    );
    const v = { jina_de: null };
    await waitOk(
      await alt.addDocuments([
        { id: "a1", series: "ABl", persons: ["Hans Frey"], places: ["Fischenthal"], organizations: [], _vectors: v },
        { id: "a2", series: "ABl", persons: [], places: [], organizations: [], _vectors: v },
        // Fassung 1 fasste «Staat» zu «stat» (= «Stadt»).
        { id: "k1", series: "KRP", persons: ["Frey, Hans"], places: [], organizations: ["Staat"],
          personKeys: ["hans frei"], placeKeys: [], orgKeys: ["stat"], _vectors: v },
        { id: "o1", series: "OS", persons: [], places: ["Wädensweil"], organizations: [],
          personKeys: [], placeKeys: ["wadenswil"], orgKeys: [], _vectors: v },
        { id: "r1", series: "RM", persons: [], places: [], organizations: [], _vectors: v },
      ]),
    );

    // Dry-Run: zählt, schreibt nichts, auch keine Settings (Probe dann nicht möglich).
    r = run(uid2, dir, ["--patch-entity-keys", "--dry-run"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[patch-entity-keys\] ABl: docs=2 mit Schlüsseln=1 missing=2 changed=0 unchanged=0/);
    assert.match(
      r.out,
      /\[patch-entity-keys\] DONE in .* docs=5 mit Schlüsseln=3 missing=3 changed=1 unchanged=1 patched=0 \| ohne Felder: nicht prüfbar .*dry-run: nichts geschrieben/,
    );
    assert.equal((await alt.getDocument("a1")).personKeys, undefined, "Dry-Run schreibt nichts");
    assert.equal(await taskCount(uid2, "settingsUpdate"), 1, "nur die Seed-Settings");
    assert.equal(await taskCount(uid2, "documentAdditionOrUpdate"), 1, "nur der Seed-Task");

    // Echter Lauf mit Seiten à 2 Docs, Batches à 2 und einem Task in der Queue: patcht
    // nur die vier fehlenden/abweichenden Docs, prüft beide Tasks, Probe bestanden.
    r = run(uid2, dir, ["--patch-entity-keys"], { MEILI_FETCH_PAGE: "2", MEILI_BATCH: "2", MEILI_MAX_IN_FLIGHT: "1" });
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /KRDB-Register/, "kein Register nötig");
    assert.match(
      r.out,
      /\[patch-entity-keys\] DONE in .* missing=3 changed=1 unchanged=1 patched=4 \| ohne Felder: 0 \| tasks=2 taskFailed=0 pending=0 meiliIndexed=4/,
    );
    assert.deepEqual(keysOf(await alt.getDocument("a1")), { personKeys: ["hans frei"], placeKeys: ["fischental"], orgKeys: [] });
    assert.deepEqual(keysOf(await alt.getDocument("k1")), { personKeys: ["hans frei"], placeKeys: [], orgKeys: ["staat"] });
    assert.deepEqual(keysOf(await alt.getDocument("r1")), { personKeys: [], placeKeys: [], orgKeys: [] });
    assert.equal((await alt.getDocument("o1")).placeKeys?.[0], "wadenswil");
    // So prüft die Web-App die Bereitschaft: EXISTS zählt auch leere Listen.
    assert.equal((await alt.search("", { filter: "placeKeys EXISTS", limit: 0 })).estimatedTotalHits, 5);
    const frei = await alt.search("", { filter: "personKeys IN ['hans frei']", limit: 10 });
    assert.deepEqual(frei.hits.map((h) => h.id).sort(), ["a1", "k1"]);

    // Idempotent.
    r = run(uid2, dir, ["--patch-entity-keys", "--dry-run"]);
    assert.match(r.out, /docs=5 mit Schlüsseln=3 missing=0 changed=0 unchanged=5 patched=0 \| ohne Felder: 0/);

    // Ein Doc ausserhalb der Serien bleibt ohne Felder: die Probe meldet es, Exit 1.
    await waitOk(await alt.addDocuments([{ id: "x1", series: "XX", persons: [], places: [], organizations: [], _vectors: v }]));
    r = run(uid2, dir, ["--patch-entity-keys"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Docs ohne Schlüsselfelder nach dem Lauf: andere Serien=1/);
    assert.match(r.out, /\[patch-entity-keys\] FAILED in .* patched=0 \| ohne Felder: andere Serien=1/);
  });
  test("--patch-synonyms: Formen hinter der 1'000er-Grenze; Dry-Run und Teil-Lauf schreiben nichts, zweiter Lauf unverändert", async () => {
    const uid = await createIndex("synonyms");
    // maxTotalHits über den 1'204 Docs: sonst füllten die Zusammensetzungen das Ergebnis.
    await waitOk(
      await client.index(uid).updateSettings({ filterableAttributes: ["series"], pagination: { maxTotalHits: 10_000 } }),
    );
    // 1'200 Zusammensetzungen «gemeindea…» stehen vor «gemeinden»: Meili ergänzt «gemeinde» nur um
    // die ersten 1'000 Wörter und findet die Dokumente mit «gemeinden» nicht.
    const docs: Array<Record<string, string>> = Array.from({ length: 1_200 }, (_, i) => ({
      id: `k${i}`,
      series: "RRB",
      title: "",
      body: `Text gemeindea${String(i).padStart(4, "0")} Ende`,
    }));
    docs.push(
      { id: "n1", series: "KRP", title: "Die Gemeinden", body: "Die Gemeinden beschliessen." },
      { id: "n2", series: "KRP", title: "", body: "Zürich und die Gemeinden" },
      { id: "e1", series: "ABl", title: "", body: "Die Gemeinde beschliesst." },
      // Ohne Serie: der Lauf liest auch diese Docs (Wortschatz wie Meilis).
      { id: "s1", title: "", body: "des Gemeindes wegen" },
    );
    await waitOk(await client.index(uid).addDocuments(docs));
    const ids = async (q: string) =>
      (await client.index(uid).search(q, { matchingStrategy: "all", limit: 2_000, attributesToRetrieve: ["id"] })).hits
        .map((h) => String(h["id"]))
        .filter((id) => !id.startsWith("k"))
        .sort();
    assert.deepEqual(await ids("gemeinde"), ["e1"], "ohne Synonyme fehlen die Formen hinter der Grenze");
    const out = join(tmp, "prefix-synonyms.json");

    const dry = run(uid, tmp, ["--patch-synonyms", "--dry-run"], { SYNONYMS_OUT: out });
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /gemeinde \(1202 Fortsetzungen\) → gemeinden, gemeindes/);
    assert.match(dry.out, /dry-run: nichts geschrieben/);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")).synonyms, { gemeinde: ["gemeinden", "gemeindes"] });
    assert.deepEqual(await client.index(uid).getSynonyms(), {});

    const part = run(uid, tmp, ["--patch-synonyms", "--series=KRP,RRB"], { SYNONYMS_OUT: out });
    assert.equal(part.code, 0, part.out);
    assert.match(part.out, /--series\/--limit: nichts geschrieben/);
    assert.deepEqual(await client.index(uid).getSynonyms(), {});

    const write = run(uid, tmp, ["--patch-synonyms"], { SYNONYMS_OUT: out });
    assert.equal(write.code, 0, write.out);
    assert.match(write.out, /Synonyme geschrieben \(Task \d+\): neu=1 geändert=0 entfernt=0 gleich=0/);
    assert.deepEqual(await client.index(uid).getSynonyms(), { gemeinde: ["gemeinden", "gemeindes"] });
    assert.deepEqual(await ids("gemeinde"), ["e1", "n1", "n2", "s1"]);
    assert.deepEqual(await ids("zurich gemeinde"), ["n2"], "auch als letztes von zwei Wörtern");
    assert.deepEqual(await ids('"gemeinde"'), ["e1"], "in Anführungszeichen wirkt kein Synonym");
    assert.deepEqual(await ids("-gemeinde gemeinde"), ["n1", "n2", "s1"], "Ausschluss bleibt genau (Stufe B)");

    const again = run(uid, tmp, ["--patch-synonyms"], { SYNONYMS_OUT: out });
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /Synonyme unverändert \(neu=0 geändert=0 entfernt=0 gleich=1\)/);
  });
});
