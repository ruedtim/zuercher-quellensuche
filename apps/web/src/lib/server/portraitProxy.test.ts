// Lauf: npx tsx --test src/lib/server/portraitProxy.test.ts
// Porträt-Proxy: nur Register-Schlüssel (QID bzw. K<KRDB-ID>), nur Wikimedia-Hosts und Rasterbilder,
// Cache + In-flight-Dedupe, Fehlschläge kurz gemerkt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPortraitProxy, PORTRAIT_MAX_BYTES, PORTRAIT_USER_AGENT } from "./portraitProxy";

const THUMB = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/250px-X.jpg";

function fakeFetch(respond: (url: string) => Response) {
	const calls: Array<{ url: string; ua: string | null }> = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
		return respond(url);
	}) as typeof fetch;
	return { fn, calls };
}

const jpeg = (n = 10) =>
	new Response(new Uint8Array(n).fill(1), { status: 200, headers: { "content-type": "image/jpeg" } });

test("liefert Register-Porträt, cacht es und schickt den User-Agent mit", async () => {
	const f = fakeFetch(() => jpeg());
	const proxy = createPortraitProxy({ lookup: (q) => (q === "Q1" ? { url: THUMB, v: "abc" } : null), fetch: f.fn });
	const a = await proxy.get("Q1");
	assert.ok(a.ok);
	if (a.ok) {
		assert.equal(a.body.type, "image/jpeg");
		assert.equal(a.body.bytes.byteLength, 10);
	}
	await proxy.get("Q1");
	assert.equal(f.calls.length, 1, "zweiter Abruf aus dem Cache");
	assert.equal(f.calls[0].ua, PORTRAIT_USER_AGENT);
	assert.equal(proxy.version("Q1"), "abc");
});

test("unbekannte oder ungültige QID ⇒ 404 ohne Upstream-Anfrage", async () => {
	const f = fakeFetch(() => jpeg());
	const proxy = createPortraitProxy({ lookup: () => null, fetch: f.fn });
	assert.deepEqual(await proxy.get("Q999"), { ok: false, status: 404 });
	assert.deepEqual(await proxy.get("../etc/passwd"), { ok: false, status: 404 });
	assert.equal(f.calls.length, 0);
});

test("K-Schlüssel (kuratiertes Porträt ohne Wikidata-Item) wie eine QID, andere Formen ⇒ 404", async () => {
	const f = fakeFetch(() => jpeg());
	const lookups: string[] = [];
	const proxy = createPortraitProxy({
		lookup: (key) => (lookups.push(key), key === "K22190" ? { url: THUMB, v: "k1" } : null),
		fetch: f.fn,
	});
	assert.ok((await proxy.get("K22190")).ok);
	assert.equal(proxy.version("K22190"), "k1");
	for (const bad of ["K0", "K", "k22190", "K12345678901", "X1"]) {
		assert.deepEqual(await proxy.get(bad), { ok: false, status: 404 }, bad);
	}
	assert.deepEqual(lookups.filter((k) => k !== "K22190"), [], "ungültige Schlüssel erreichen das Register nicht");
	assert.equal(f.calls.length, 1);
});

test("gleichzeitige Anfragen teilen sich einen Upstream-Abruf", async () => {
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => (release = r));
	let calls = 0;
	const fn = (async () => {
		calls++;
		await gate;
		return jpeg();
	}) as unknown as typeof fetch;
	const proxy = createPortraitProxy({ lookup: () => ({ url: THUMB }), fetch: fn });
	const both = Promise.all([proxy.get("Q1"), proxy.get("Q1")]);
	release();
	const [a, b] = await both;
	assert.ok(a.ok && b.ok);
	assert.equal(calls, 1);
});

test("SVG, fremde Hosts, Übergrösse und HTTP-Fehler ⇒ 502, kurz gemerkt", async () => {
	const svg = fakeFetch(() => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } }));
	assert.deepEqual(await createPortraitProxy({ lookup: () => ({ url: THUMB }), fetch: svg.fn }).get("Q1"), {
		ok: false,
		status: 502,
	});

	const foreign = fakeFetch(() => jpeg());
	const px = createPortraitProxy({ lookup: () => ({ url: "https://evil.example/x.jpg" }), fetch: foreign.fn });
	assert.deepEqual(await px.get("Q1"), { ok: false, status: 502 });
	assert.equal(foreign.calls.length, 0, "fremder Host wird gar nicht angefragt");

	const big = fakeFetch(() => jpeg(PORTRAIT_MAX_BYTES + 1));
	assert.deepEqual(await createPortraitProxy({ lookup: () => ({ url: THUMB }), fetch: big.fn }).get("Q1"), {
		ok: false,
		status: 502,
	});

	let now = 0;
	const down = fakeFetch(() => new Response("", { status: 503 }));
	const p2 = createPortraitProxy({ lookup: () => ({ url: THUMB }), fetch: down.fn, now: () => now });
	assert.deepEqual(await p2.get("Q1"), { ok: false, status: 502 });
	assert.deepEqual(await p2.get("Q1"), { ok: false, status: 502 });
	assert.equal(down.calls.length, 1, "Fehlschlag 10 min gemerkt");
	now += 11 * 60 * 1000;
	await p2.get("Q1");
	assert.equal(down.calls.length, 2, "danach neuer Versuch");
});
