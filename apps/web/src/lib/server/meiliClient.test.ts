// Lauf: npx tsx --test src/lib/server/meiliClient.test.ts
// Client der Web-App: unkomprimierte Antworten (Accept-Encoding) und Key;
// mit dem echten meilisearch-js-Client gegen ein ersetztes globalThis.fetch.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { MEILI_REQUEST_HEADERS, createMeiliClient } from "./meiliClient";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function stubFetch(responses: Array<() => Response>) {
	const calls: Array<{ url: string; headers: Headers }> = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), headers: new Headers(init?.headers) });
		const next = responses.shift();
		if (!next) throw new Error("keine Antwort mehr vorgesehen");
		return next();
	}) as typeof fetch;
	return calls;
}

const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("createMeiliClient: jede Anfrage verlangt unkomprimierte Antworten und trägt den Key", async () => {
	assert.deepEqual(MEILI_REQUEST_HEADERS, { "Accept-Encoding": "identity" });
	const calls = stubFetch([json({ hits: [], estimatedTotalHits: 0, processingTimeMs: 1, query: "x" }), json({ results: [] })]);
	const client = createMeiliClient("http://meili.test:7700", "geheim");
	await client.index("documents").search("x", { limit: 0 });
	await client.multiSearch({ queries: [{ indexUid: "documents", q: "x" }] });
	assert.equal(calls.length, 2);
	for (const call of calls) {
		assert.equal(call.headers.get("accept-encoding"), "identity");
		assert.equal(call.headers.get("authorization"), "Bearer geheim");
		assert.equal(call.headers.get("content-type"), "application/json");
	}
	assert.equal(calls[0].url, "http://meili.test:7700/indexes/documents/search");
});
