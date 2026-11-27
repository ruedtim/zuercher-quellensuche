/**
 * Unit-Tests für die Export-Streams (echter archiver, Fake-Meili). Lauf:
 *   npx tsx --test src/lib/server/exportStream.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import {
	TEXT_BATCH,
	createCsvStream,
	createExportStream,
	createXlsxStream,
	createZipStream,
	type ExportJob,
	type ExportStats,
	type FetchDocs,
} from "./exportStream";
import { DEFAULT_SEARCH, type SearchHit } from "../types";

const BASE = "https://zentraleserien.ch";

// Fehler in losgelösten Promises (void-IIFEs) sollen Tests scheitern lassen.
const unhandled: unknown[] = [];
process.on("unhandledRejection", (err) => unhandled.push(err));

function makeDoc(id: string, body = `Text von ${id}`): SearchHit {
	return {
		id,
		series: "RRB",
		title: `Titel ${id}`,
		date: "1900-01-01",
		dateYear: 1900,
		startPg: null,
		volumeNr: null,
		serialNr: null,
		resolutionId: null,
		stazhIdent: `StAZH ${id}`,
		archiveLink: null,
		manifestUrl: id.endsWith("0") ? `https://zszh.sources-online.org/manifests/RRB/${id}/info.json` : null,
		body,
	};
}

// Liefert die Docs bewusst in umgekehrter Reihenfolge (wie Meili: beliebig).
function fakeFetch(opts: { drop?: Set<string>; failTimes?: number; body?: (id: string) => string } = {}) {
	const calls: Array<{ ids: string[]; fields: string[]; signal: AbortSignal }> = [];
	let failures = opts.failTimes ?? 0;
	const fetchDocs: FetchDocs = async (ids, fields, signal) => {
		calls.push({ ids, fields, signal });
		await new Promise((r) => setTimeout(r, 1));
		if (signal.aborted) throw new Error("aborted");
		if (failures > 0) {
			failures--;
			throw new Error("Meili weg");
		}
		return ids
			.filter((id) => !opts.drop?.has(id))
			.map((id) => makeDoc(id, opts.body ? opts.body(id) : undefined))
			.reverse();
	};
	return { fetchDocs, calls };
}

function job(ids: string[], p: Partial<ExportJob> = {}): ExportJob {
	return {
		ids,
		content: "table",
		format: "csv",
		baseUrl: BASE,
		rootName: "zentraleserien_test_2026-09-25",
		readme: {
			content: p.content ?? "table",
			format: p.format ?? "csv",
			params: { ...DEFAULT_SEARCH, q: "test" },
			searchUrl: `${BASE}/search?q=test`,
			baseUrl: BASE,
			planned: { count: ids.length, total: ids.length, scope: "all" },
			generatedAt: new Date("2026-09-25T10:00:00Z"),
		},
		collection: { id: `${BASE}/search?q=test#iiif-collection`, label: "Treffer", summary: "Test" },
		...p,
	};
}

function deps(fetchDocs: FetchDocs, extra: { signal?: AbortSignal } = {}) {
	let releases = 0;
	const finished: ExportStats[] = [];
	return {
		deps: {
			fetchDocs,
			signal: extra.signal ?? new AbortController().signal,
			release: () => releases++,
			onFinish: (s: ExportStats) => finished.push(s),
			retryDelayMs: 1,
		},
		releases: () => releases,
		finished,
	};
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

/** Minimaler ZIP-Leser (Zentralverzeichnis; store + deflate) – nur für Tests. */
function unzip(buf: Buffer): Map<string, Buffer> {
	let eocd = buf.length - 22;
	while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
	assert.ok(eocd >= 0, "kein End-of-Central-Directory");
	const count = buf.readUInt16LE(eocd + 10);
	let p = buf.readUInt32LE(eocd + 16);
	const out = new Map<string, Buffer>();
	for (let i = 0; i < count; i++) {
		assert.equal(buf.readUInt32LE(p), 0x02014b50);
		const method = buf.readUInt16LE(p + 10);
		const compSize = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const localOffset = buf.readUInt32LE(p + 42);
		const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
		const lNameLen = buf.readUInt16LE(localOffset + 26);
		const lExtraLen = buf.readUInt16LE(localOffset + 28);
		const start = localOffset + 30 + lNameLen + lExtraLen;
		const data = buf.subarray(start, start + compSize);
		out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
		p += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("CSV: BOM einmal, Kopf, Reihenfolge der IDs, fehlende Docs übersprungen", async () => {
	const ids = Array.from({ length: 2500 }, (_, i) => `D${i}`);
	const { fetchDocs, calls } = fakeFetch({ drop: new Set(["D5"]) });
	const d = deps(fetchDocs);
	const csv = (await readAll(createCsvStream(job(ids), d.deps))).toString("utf8");
	assert.ok(csv.startsWith("\uFEFFrank,id,series,"));
	assert.equal(csv.split("\uFEFF").length, 2);
	const lines = csv.trimEnd().split("\r\n");
	assert.equal(lines.length, 1 + 2499);
	assert.ok(lines[1].startsWith("1,D0,RRB,"));
	assert.ok(lines[5].startsWith("5,D4,"));
	assert.ok(lines[6].startsWith("7,D6,"), "Rang-Lücke für das fehlende Dokument");
	assert.equal(calls.length, 3, "Batches à 1000");
	assert.ok(!calls[0].fields.includes("body"), "Tabelle ohne Body");
	assert.equal(d.releases(), 1);
	assert.equal(d.finished[0].exported, 2499);
	assert.equal(d.finished[0].missing, 1);
});

test("CSV: ohne Lesen wird nichts nachgeladen (Backpressure)", async () => {
	const { fetchDocs, calls } = fakeFetch();
	const d = deps(fetchDocs);
	const stream = createCsvStream(job(Array.from({ length: 5000 }, (_, i) => `D${i}`)), d.deps);
	await tick(50);
	assert.ok(calls.length <= 1, `höchstens ein Batch vorgeholt, war ${calls.length}`);
	await readAll(stream);
	assert.equal(calls.length, 5);
});

test("CSV: Abbruch durch den Client ⇒ Freigabe genau einmal, Abruf abgebrochen", async () => {
	const { fetchDocs, calls } = fakeFetch();
	const d = deps(fetchDocs);
	const reader = createCsvStream(job(Array.from({ length: 5000 }, (_, i) => `D${i}`)), d.deps).getReader();
	await reader.read();
	await reader.read();
	await reader.cancel("weg");
	await tick();
	assert.equal(d.releases(), 1);
	assert.ok(calls.at(-1)!.signal.aborted);
});

test("CSV: ein Fehler wird einmal wiederholt, zwei beenden den Stream mit Fehler", async () => {
	const ok = fakeFetch({ failTimes: 1 });
	const d1 = deps(ok.fetchDocs);
	const csv = (await readAll(createCsvStream(job(["A", "B"]), d1.deps))).toString("utf8");
	assert.ok(csv.includes("A,RRB"));
	const bad = fakeFetch({ failTimes: 2 });
	const d2 = deps(bad.fetchDocs);
	await assert.rejects(readAll(createCsvStream(job(["A", "B"]), d2.deps)), /Meili weg/);
	assert.equal(d2.releases(), 1);
	assert.equal(d2.finished[0].error, "Meili weg");
});

test("XLSX: gültiges Paket mit Kopf, Zeilen in ID-Reihenfolge, Autofilter", async () => {
	const ids = Array.from({ length: 1200 }, (_, i) => `D${i}`);
	const { fetchDocs } = fakeFetch();
	const d = deps(fetchDocs);
	const buf = await readAll(createXlsxStream(job(ids, { format: "xlsx" }), d.deps));
	const entries = unzip(buf);
	assert.deepEqual([...entries.keys()].sort(), [
		"[Content_Types].xml",
		"_rels/.rels",
		"xl/_rels/workbook.xml.rels",
		"xl/styles.xml",
		"xl/workbook.xml",
		"xl/worksheets/sheet1.xml",
	]);
	const sheet = entries.get("xl/worksheets/sheet1.xml")!.toString("utf8");
	assert.ok(sheet.includes('<c r="A1" t="inlineStr" s="1"><is><t>rank</t></is></c>'));
	assert.ok(sheet.includes('<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>D0</t>'));
	assert.ok(sheet.includes('<row r="1201"><c r="A1201"><v>1200</v></c><c r="B1201" t="inlineStr"><is><t>D1199</t>'));
	assert.ok(sheet.endsWith('<autoFilter ref="A1:S1201"/></worksheet>'));
	assert.ok(entries.get("xl/workbook.xml")!.toString("utf8").includes("Treffer!$A$1:$S$1201"));
	assert.equal(d.releases(), 1);
	assert.equal(d.finished[0].exported, 1200);
});

test("ZIP (Volltexte + IIIF): Texte, Tabelle, Sammlung, README im Ordner", async () => {
	const ids = Array.from({ length: 250 }, (_, i) => `D${i}`);
	const { fetchDocs, calls } = fakeFetch({ drop: new Set(["D7"]) });
	const d = deps(fetchDocs);
	const j = job(ids, { content: "iiif", format: "csv" });
	j.readme.content = "iiif";
	const entries = unzip(await readAll(createExportStream(j, d.deps)));
	const root = "zentraleserien_test_2026-09-25";
	const texts = [...entries.keys()].filter((n) => n.startsWith(`${root}/texte/`));
	assert.equal(texts.length, 249);
	assert.equal(texts[0], `${root}/texte/001_StAZH_D0.txt`);
	assert.ok(calls.every((c) => c.fields.includes("body")));
	assert.equal(calls.length, Math.ceil(250 / TEXT_BATCH));
	assert.ok(entries.get(`${root}/texte/002_StAZH_D1.txt`)!.toString("utf8").endsWith("Text von D1\n"));
	const csv = entries.get(`${root}/treffer.csv`)!.toString("utf8");
	assert.ok(csv.startsWith("\uFEFFrank,"));
	assert.ok(csv.split("\r\n")[0].endsWith(",textFile"));
	assert.ok(csv.includes(",texte/001_StAZH_D0.txt\r\n"));
	const coll = JSON.parse(entries.get(`${root}/iiif-collection.json`)!.toString("utf8"));
	assert.equal(coll.items.length, 25, "nur Docs mit Manifest (IDs auf 0)");
	const readme = entries.get(`${root}/README.txt`)!.toString("utf8");
	assert.ok(readme.includes("Tatsächlich exportiert: 249 Dokumente"));
	assert.ok(readme.includes("iiif-collection.json"));
	assert.equal(d.releases(), 1);
	assert.deepEqual(unhandled, []);
});

test("ZIP mit Excel-Tabelle", async () => {
	const { fetchDocs } = fakeFetch();
	const d = deps(fetchDocs);
	const j = job(["A", "B", "C"], { content: "text", format: "xlsx" });
	j.readme.content = "text";
	j.readme.format = "xlsx";
	const entries = unzip(await readAll(createExportStream(j, d.deps)));
	const root = "zentraleserien_test_2026-09-25";
	const xlsx = entries.get(`${root}/treffer.xlsx`);
	assert.ok(xlsx);
	const inner = unzip(xlsx);
	assert.ok(inner.get("xl/worksheets/sheet1.xml")!.toString("utf8").includes("<t>texte/1_StAZH_A.txt</t>") === false);
	assert.ok(inner.get("xl/worksheets/sheet1.xml")!.toString("utf8").includes("<t>texte/001_StAZH_A.txt</t>"));
	assert.ok(!entries.has(`${root}/iiif-collection.json`));
});

test("ZIP: ohne Lesen bleibt die Pipeline stehen (Backpressure), danach komplett", async () => {
	// Nicht komprimierbarer Text, damit archivers Puffer schnell voll sind.
	const big = () => randomBytes(24 * 1024).toString("base64");
	const ids = Array.from({ length: 2000 }, (_, i) => `D${i}`);
	const { fetchDocs, calls } = fakeFetch({ body: big });
	const d = deps(fetchDocs);
	const j = job(ids, { content: "text" });
	j.readme.content = "text";
	const stream = createZipStream(j, d.deps);
	await tick(300);
	const fetchedBeforeRead = calls.length;
	assert.ok(fetchedBeforeRead < 8, `Produzent darf nicht davonlaufen, holte ${fetchedBeforeRead} Batches`);
	const entries = unzip(await readAll(stream));
	assert.equal([...entries.keys()].filter((n) => n.includes("/texte/")).length, 2000);
	assert.equal(calls.length, 20);
	assert.equal(d.releases(), 1);
});

test("ZIP: Client-Abbruch ⇒ Freigabe einmal, Produzent stoppt, keine unhandled rejection", async () => {
	const big = () => randomBytes(24 * 1024).toString("base64");
	const ids = Array.from({ length: 3000 }, (_, i) => `D${i}`);
	const { fetchDocs, calls } = fakeFetch({ body: big });
	const ac = new AbortController();
	const d = deps(fetchDocs, { signal: ac.signal });
	const j = job(ids, { content: "text" });
	j.readme.content = "text";
	const reader = createZipStream(j, d.deps).getReader();
	await reader.read();
	ac.abort(new Error("Client weg"));
	await reader.cancel("weg");
	await tick(100);
	const n = calls.length;
	await tick(100);
	assert.equal(calls.length, n, "nach Abbruch keine weiteren Abrufe");
	assert.ok(n < 30);
	assert.equal(d.releases(), 1);
	assert.deepEqual(unhandled, []);
});

test("ZIP: Meili-Fehler (2×) ⇒ Stream-Fehler statt abgeschnittener Datei", async () => {
	const { fetchDocs } = fakeFetch({ failTimes: 2 });
	const d = deps(fetchDocs);
	const j = job(["A", "B"], { content: "text" });
	j.readme.content = "text";
	await assert.rejects(readAll(createZipStream(j, d.deps)));
	await tick();
	assert.equal(d.releases(), 1);
	assert.deepEqual(unhandled, []);
});
