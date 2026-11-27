/**
 * Unit-Tests für responseBody (echter archiver). Lauf:
 *   npx tsx --test src/lib/server/responseBody.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import { bytesBody, responseBody } from "./responseBody";

// Beides beendete bis 2026-11 den Webprozess: Tests scheitern, wenn eines auftritt.
const unhandled: unknown[] = [];
const uncaught: unknown[] = [];
process.on("unhandledRejection", (err) => unhandled.push(err));
process.on("uncaughtException", (err) => uncaught.push(err));

async function quiet(): Promise<void> {
	await sleep(30);
	assert.deepEqual(unhandled.splice(0), []);
	assert.deepEqual(uncaught.splice(0), []);
}

async function collect(body: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	for await (const c of body as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
	return Buffer.concat(chunks);
}

/** Das Muster von SvelteKits setResponse: Verbindung weg ⇒ `reader.cancel()` ohne catch. */
function cancelLikeSvelteKit(body: ReadableStream<Uint8Array>): void {
	void body.getReader().cancel();
}

test("liefert alle Bytes der Quelle, auch Strings", async () => {
	const data = randomBytes(300_000);
	assert.deepEqual(await collect(responseBody(Readable.from([data.subarray(0, 100_000), data.subarray(100_000)]))), data);
	assert.equal((await collect(responseBody(Readable.from(["ab", "cü"])))).toString("utf8"), "abcü");
	await quiet();
});

test("archiver: vollständiges ZIP", async () => {
	const zip = archiver("zip", { zlib: { level: 5 } });
	zip.append("hallo", { name: "a.txt" });
	zip.append(randomBytes(200_000), { name: "b.bin" });
	void zip.finalize();
	const out = await collect(responseBody(zip));
	assert.equal(out.subarray(0, 2).toString("latin1"), "PK");
	assert.ok(out.length > 200_000);
	await quiet();
});

test("ohne Lesen wird nichts aus der Quelle geholt", async () => {
	let reads = 0;
	const source = new Readable({
		read() {
			reads++;
			this.push(Buffer.alloc(1024));
		},
	});
	const body = responseBody(source);
	await sleep(20);
	assert.equal(reads, 0);
	await body.cancel();
	await quiet();
});

test("Client weg vor dem ersten Lesen: cancel zerstört die Quelle, kein unbehandelter Fehler", async () => {
	const zip = archiver("zip");
	const body = responseBody(zip);
	zip.append("x".repeat(50_000), { name: "a.txt" });
	zip.finalize().catch(() => {});
	cancelLikeSvelteKit(body);
	await sleep(20);
	assert.equal(zip.destroyed, true);
	await quiet();
});

test("Quelle scheitert, bevor jemand liest, dann trennt der Client: kein unbehandelter Fehler", async () => {
	const zip = archiver("zip");
	const body = responseBody(zip);
	zip.destroy(new Error("Export abgebrochen"));
	await sleep(10);
	cancelLikeSvelteKit(body);
	await quiet();
});

test("Abbruch während eines offenen Lesens", async () => {
	const source = new PassThrough();
	const body = responseBody(source);
	const reader = body.getReader();
	const pending = reader.read();
	await sleep(5);
	await reader.cancel();
	assert.equal((await pending).done, true);
	assert.equal(source.destroyed, true);
	await quiet();
});

test("Fehler der Quelle beim Lesen bricht den Body ab", async () => {
	const source = new PassThrough();
	const body = responseBody(source);
	const reader = body.getReader();
	source.write("teil");
	assert.equal(Buffer.from((await reader.read()).value!).toString(), "teil");
	source.destroy(new Error("Meili weg"));
	await assert.rejects(reader.read(), /Meili weg/);
	await quiet();
});

test("archiver schreibt nach dem Abbruch weiter: kein Absturz", async () => {
	for (let i = 0; i < 20; i++) {
		const zip = archiver("zip", { zlib: { level: 1 } });
		zip.on("error", () => {});
		const body = responseBody(zip);
		for (let k = 0; k < 4; k++) zip.append(randomBytes(80_000), { name: `${k}.bin` });
		zip.finalize().catch(() => {});
		if (i % 2) await sleep(i % 4);
		cancelLikeSvelteKit(body);
	}
	await quiet();
});

test("bytesBody: alle Stücke in Reihe; onEnd erst, wenn das letzte abgeholt ist", async () => {
	let ended = 0;
	const reader = bytesBody([Buffer.from("[1"), Buffer.from(",2]")], () => ended++).getReader();
	assert.equal(Buffer.from((await reader.read()).value!).toString(), "[1");
	assert.equal(Buffer.from((await reader.read()).value!).toString(), ",2]");
	await sleep(5);
	assert.equal(ended, 0, "das letzte Stück ist noch nicht quittiert");
	assert.equal((await reader.read()).done, true);
	assert.equal(ended, 1);
	await quiet();
});

test("bytesBody: Client weg, vor dem Lesen und mittendrin", async () => {
	let ended = 0;
	cancelLikeSvelteKit(bytesBody([Buffer.from("a")], () => ended++));
	await quiet();
	assert.equal(ended, 1);
	const reader = bytesBody([Buffer.from("a"), Buffer.from("b")], () => ended++).getReader();
	await reader.read();
	void reader.cancel();
	await quiet();
	assert.equal(ended, 2);
});
