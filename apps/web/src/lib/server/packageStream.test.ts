/**
 * Unit-Tests für das ZIP-Paket mit Faksimiles (echter archiver, Fake-Bildserver). Lauf:
 *   npx tsx --test src/lib/server/packageStream.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";
import { createPackageStream, imageFetcher, MAX_IMAGE_BYTES, MAX_IMAGES, type PackageJob } from "./packageStream";

// Fehler in losgelösten Promises sollen Tests scheitern lassen.
const unhandled: unknown[] = [];
process.on("unhandledRejection", (err) => unhandled.push(err));

/** Namen und Inhalte in der Reihenfolge des Zentralverzeichnisses. */
function unzip(buf: Buffer): Map<string, Buffer> {
	const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	assert.ok(eocd >= 0, "kein ZIP-Ende");
	const out = new Map<string, Buffer>();
	let at = buf.readUInt32LE(eocd + 16);
	for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
		const method = buf.readUInt16LE(at + 10);
		const size = buf.readUInt32LE(at + 20);
		const nameLen = buf.readUInt16LE(at + 28);
		const local = buf.readUInt32LE(at + 42);
		const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
		const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const data = buf.subarray(start, start + size);
		out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
		at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
	}
	return out;
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	for await (const c of body as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
	return Buffer.concat(chunks);
}

function job(images: string[], p: Partial<PackageJob> = {}): PackageJob {
	return {
		root: "paket",
		files: [{ name: "document.txt", content: "Text" }],
		images,
		errors: [],
		closing: ({ imageCount, errors }) => [{ name: "README.txt", content: `${imageCount} Bilder, ${errors.length} Meldungen` }],
		...p,
	};
}

function deps(fetchImage: (url: string, signal: AbortSignal) => Promise<Uint8Array>) {
	const ac = new AbortController();
	let released = 0;
	return { ac, count: () => released, deps: { fetchImage, signal: ac.signal, release: () => void released++ } };
}

const URLS = (n: number) => Array.from({ length: n }, (_, i) => `https://bilder.example/${i + 1}`);

test("vollständiges Paket: Texte, Bilder, README am Ende mit dem tatsächlichen Stand", async () => {
	const pics = [randomBytes(300_000), randomBytes(200_000), randomBytes(100)];
	const d = deps(async (url) => pics[Number(url.split("/").pop()) - 1]);
	const entries = unzip(await readAll(createPackageStream(job(URLS(3)), d.deps)));
	assert.deepEqual([...entries.keys()], ["paket/document.txt", "paket/images/01.jpg", "paket/images/02.jpg", "paket/images/03.jpg", "paket/README.txt"]);
	for (let i = 0; i < 3; i++) assert.deepEqual(entries.get(`paket/images/0${i + 1}.jpg`), pics[i]);
	assert.equal(entries.get("paket/README.txt")!.toString(), "3 Bilder, 0 Meldungen");
	assert.equal(d.count(), 1);
});

test("ohne Leser liegen nur wenige Bilder im Speicher, nach dem Abbruch kommt nichts mehr", async () => {
	let fetched = 0;
	const d = deps(async () => (fetched++, randomBytes(1_000_000)));
	const reader = createPackageStream(job(URLS(60)), d.deps).getReader();
	await sleep(250);
	assert.ok(fetched <= 8, `${fetched} MB ohne Leser (Puffer des Archivs)`);
	await reader.read();
	await sleep(50);
	assert.ok(fetched <= 12, `${fetched} MB nach einem Stück`);
	await reader.cancel();
	await sleep(20);
	const after = fetched;
	await sleep(100);
	assert.equal(fetched, after, "nach dem Abbruch kommt nichts mehr");
	assert.equal(d.count(), 1);
});

test("Client trennt während eines Bildabrufs: Abruf endet, Platz frei", async () => {
	let aborted = false;
	const d = deps(
		(_, signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => {
					aborted = true;
					reject(new Error("abgebrochen"));
				});
			}),
	);
	const reader = createPackageStream(job(URLS(5)), d.deps).getReader();
	const pending = reader.read().catch(() => {});
	await sleep(20);
	d.ac.abort();
	await pending;
	await reader.cancel().catch(() => {});
	await sleep(30);
	assert.ok(aborted);
	assert.equal(d.count(), 1);
});

test("einzelne Fehler stehen im errors.log, das Paket geht weiter", async () => {
	const d = deps(async (url) => {
		if (url.endsWith("/2")) throw new Error("HTTP 404");
		return randomBytes(50);
	});
	const entries = unzip(await readAll(createPackageStream(job(URLS(3), { errors: ["[xml] fehlt"] }), d.deps)));
	assert.deepEqual([...entries.keys()].filter((n) => n.includes("images")), ["paket/images/01.jpg", "paket/images/03.jpg"]);
	assert.equal(entries.get("paket/README.txt")!.toString(), "2 Bilder, 2 Meldungen");
	assert.equal(entries.get("paket/errors.log")!.toString(), "[xml] fehlt\n[image 2/3] HTTP 404 – https://bilder.example/2\n");
});

test("Bildserver weg: nach fünf Fehlern in Folge nicht weiter versuchen", async () => {
	let tries = 0;
	const d = deps(async () => {
		tries++;
		throw new Error("HTTP 502");
	});
	const entries = unzip(await readAll(createPackageStream(job(URLS(40)), d.deps)));
	assert.equal(tries, 5);
	assert.match(entries.get("paket/errors.log")!.toString(), /nach 5 Fehlern in Folge abgebrochen, 35 Bilder nicht versucht/);
});

test("zu grosse Bilder und zu viele: ausgelassen, mit Meldung", async () => {
	let n = 0;
	const d = deps(async () => (n++ === 0 ? new Uint8Array(MAX_IMAGE_BYTES + 1) : randomBytes(10)));
	const entries = unzip(await readAll(createPackageStream(job(URLS(MAX_IMAGES + 5)), d.deps)));
	const log = entries.get("paket/errors.log")!.toString();
	assert.match(log, /nur die ersten 400 von 405 Bildern/);
	assert.match(log, /\[image 1\/400\] zu gross/);
	assert.equal([...entries.keys()].filter((k) => k.includes("images/")).length, MAX_IMAGES - 1);
});

test("imageFetcher: nur vorgesehene Bildserver, keine Weiterleitung, Grösse vorab", async () => {
	const calls: Array<{ url: string; redirect?: string }> = [];
	const fake = (async (url: string, init: RequestInit) => {
		calls.push({ url, redirect: init.redirect });
		if (url.endsWith("/gross")) return new Response("x", { headers: { "content-length": String(MAX_IMAGE_BYTES + 1) } });
		if (url.endsWith("/fehlt")) return new Response("weg", { status: 404 });
		return new Response(new Uint8Array([1, 2, 3]));
	}) as unknown as typeof fetch;
	const get = imageFetcher(["https://bilder.example"], fake);
	const s = new AbortController().signal;
	assert.deepEqual(await get("https://bilder.example/a", s), new Uint8Array([1, 2, 3]));
	assert.equal(calls[0].redirect, "error");
	await assert.rejects(get("https://bilder.example/gross", s), /zu gross/);
	await assert.rejects(get("https://bilder.example/fehlt", s), /HTTP 404/);
	const before = calls.length;
	for (const bad of ["http://meili:7700/keys", "http://bilder.example/a", "https://bilder.example.evil/a", "https://bilder.example:8443/a", "file:///etc/passwd", "kein url"]) {
		await assert.rejects(get(bad, s), /nicht vorgesehen|ungültige/, bad);
	}
	assert.equal(calls.length, before, "kein Abruf");
});

test("keine unbehandelten Fehler", async () => {
	await sleep(50);
	assert.deepEqual(unhandled, []);
});
