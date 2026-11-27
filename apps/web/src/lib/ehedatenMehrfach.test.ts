// Lauf: npx tsx --test src/lib/ehedatenMehrfach.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EHEDATEN_MEHRFACH_ATTRIBUTION, EHEDATEN_MEHRFACH_URL, indexEhedatenMehrfach, type EhedatenMehrfachData } from "./ehedatenMehrfach";

const data: EhedatenMehrfachData = {
	ehen: { "19389": [1972592, 1998353], "36532": [1972853, 1998825] },
	wahrscheinlich: ["36532"],
	verschieden: { "110021": { ids: [1959266, 1959267], grund: "vermerk" } },
};

test("Übrige Einträge derselben Ehe je Katalog-ID, Sicherheit laut Liste", () => {
	const idx = indexEhedatenMehrfach(data);
	assert.equal(idx.size, 2);
	assert.deepEqual(idx.forEntry(1998353), { ehe: "19389", ids: [1972592], sicher: true });
	assert.deepEqual(idx.forEntry(1972592), { ehe: "19389", ids: [1998353], sicher: true });
	assert.deepEqual(idx.forEntry(1972853), { ehe: "36532", ids: [1998825], sicher: false });
	assert.equal(idx.forEntry(1), null);
	assert.equal(idx.forEntry(Number.NaN), null);
	// Verworfene Paare sind keine Ehe, aber auch nie «dasselbe Paar».
	assert.equal(idx.forEntry(1959266), null);
	assert.deepEqual(idx.distinctFrom(1959266), [1959267]);
	assert.deepEqual(idx.distinctFrom(1998353), []);
});

test("Unlesbare oder fehlerhafte Listen ergeben keine Ehen", () => {
	for (const raw of [null, "x", 42, [], {}, { ehen: [] }, { ehen: null }]) {
		assert.equal(indexEhedatenMehrfach(raw).forEntry(1998353), null, JSON.stringify(raw));
	}
	const bad = indexEhedatenMehrfach({
		ehen: { a: [5], b: "1,2", c: [7, 7], d: [8, -1, 9.5, 10], e: [11, 12], f: [12, 13] },
		wahrscheinlich: "a",
		verschieden: { x: null, y: { ids: [1] } },
	});
	// Weniger als zwei gültige IDs: keine Ehe; eine ID in zwei Ehen gilt in keiner, und die
	// beiden Ehen, denen danach ein Eintrag fehlt, fallen mit ihr weg.
	assert.equal(bad.size, 1);
	assert.equal(bad.forEntry(5), null);
	assert.equal(bad.forEntry(7), null);
	assert.deepEqual(bad.forEntry(8), { ehe: "d", ids: [10], sicher: true });
	for (const id of [11, 12, 13]) assert.equal(bad.forEntry(id), null, String(id));
	assert.deepEqual(bad.distinctFrom(1), []);
});

test("Nennung der Liste, ohne Geviertstrich", () => {
	assert.ok(EHEDATEN_MEHRFACH_ATTRIBUTION.startsWith("Staatsarchiv des Kantons Zürich"));
	assert.match(EHEDATEN_MEHRFACH_URL, /^https:\/\/github\.com\/stazh\/sw-ehedaten\//);
	assert.ok(!/—/.test(EHEDATEN_MEHRFACH_ATTRIBUTION));
});

test("Die committete Liste: jede Ehe mit mindestens zwei Einträgen, jede Katalog-ID einmal, Zähler stimmen", () => {
	const raw = JSON.parse(readFileSync(new URL("./server/data/ehedaten-mehrfach.json", import.meta.url), "utf8"));
	const idx = indexEhedatenMehrfach(raw);
	const ehen = Object.entries(raw.ehen as Record<string, number[]>);
	assert.ok(ehen.length > 5000, `${ehen.length} Ehen`);
	assert.equal(idx.size, ehen.length);
	assert.equal(raw.meta.counts.marriages, ehen.length);
	const ids = ehen.flatMap(([, v]) => v);
	assert.equal(raw.meta.counts.entries, ids.length);
	assert.equal(new Set(ids).size, ids.length, "keine Katalog-ID in zwei Ehen");
	for (const [ehe, v] of ehen) {
		assert.match(ehe, /^\d+$/);
		assert.ok(v.length >= 2, ehe);
		for (const id of v) {
			assert.ok(Number.isInteger(id) && id > 0, `${ehe}: ${id}`);
			const m = idx.forEntry(id);
			assert.ok(m && m.ehe === ehe && !m.ids.includes(id), `${ehe}: ${id}`);
		}
	}
	for (const ehe of raw.wahrscheinlich as string[]) {
		assert.ok(raw.ehen[ehe], ehe);
		assert.equal(idx.forEntry(raw.ehen[ehe][0])?.sicher, false, ehe);
	}
	assert.equal(raw.meta.counts.probable, raw.wahrscheinlich.length);
	// Verworfene Paare sind keine Ehe der Liste.
	for (const [ehe, v] of Object.entries(raw.verschieden as EhedatenMehrfachData["verschieden"])) {
		assert.ok(!raw.ehen[ehe], ehe);
		assert.ok(v.grund === "vornamen" || v.grund === "vermerk", ehe);
		for (const id of v.ids) assert.equal(idx.forEntry(id), null, `${ehe}: ${id}`);
	}
	assert.equal(raw.meta.counts.distinct, Object.keys(raw.verschieden).length);
	assert.equal(raw.meta.source.repo, "stazh/sw-ehedaten");
});
