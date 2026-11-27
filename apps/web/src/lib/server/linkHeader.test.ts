/**
 * Unit-Tests für die Länge der Link-Kopfzeile. Lauf:
 *   npx tsx --test src/lib/server/linkHeader.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINK_LENGTH, trimLinkHeader } from "./linkHeader";

const entry = (i: number) => `</_app/immutable/chunks/Chunk${String(i).padStart(3, "0")}.js>; rel="modulepreload"; nopush`;

test("kurze Kopfzeile bleibt", () => {
	const value = [1, 2, 3].map(entry).join(", ");
	assert.equal(trimLinkHeader(value), value);
});

test("lange Kopfzeile: ganze Einträge vom Anfang, höchstens die Grenze", () => {
	const all = Array.from({ length: 100 }, (_, i) => entry(i));
	const out = trimLinkHeader(all.join(", "));
	assert.ok(out.length <= MAX_LINK_LENGTH);
	const kept = out.split(", ");
	assert.deepEqual(kept, all.slice(0, kept.length));
	assert.ok(out.length + entry(0).length + 2 > MAX_LINK_LENGTH);
});

test("passt kein Eintrag, bleibt nichts", () => {
	assert.equal(trimLinkHeader(entry(1), 20), "");
});
