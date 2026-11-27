/**
 * Unit-Tests für die Begrenzung gleichzeitiger teurer Arbeit. Lauf:
 *   npx tsx --test src/lib/server/gate.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createGate, MCP_GATE, WEB_GATE, type GateOptions, type GateSlot } from "./gate";

const OPTS: GateOptions = { maxActive: 3, maxPerKey: 2, maxQueue: 4, maxQueuePerKey: 3, maxWaitMs: 10_000, maxHeld: 100, maxHeldPerKey: 60 };
const release = (s: GateSlot) => s.ok && s.release();

test("höchstens maxActive gleichzeitig, je Netz maxPerKey", async () => {
	const gate = createGate(OPTS);
	const a1 = await gate.acquire("a");
	const a2 = await gate.acquire("a");
	assert.ok(a1.ok && a2.ok);
	let third: GateSlot | null = null;
	void gate.acquire("a").then((s) => (third = s));
	await sleep(5);
	assert.equal(third, null, "dritter Aufruf desselben Netzes wartet");
	const b = await gate.acquire("b");
	assert.ok(b.ok, "ein anderes Netz kommt noch dran");
	assert.deepEqual(gate.stats(), { active: 3, waiting: 1, held: 0 });
	release(a1);
	await sleep(5);
	assert.ok(third !== null && (third as GateSlot).ok);
	for (const s of [a2, b, third!]) release(s);
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});

test("Reihenfolge der Wartenden; ein volles Netz hält andere nicht auf", async () => {
	const gate = createGate({ ...OPTS, maxActive: 2, maxPerKey: 1 });
	const a = await gate.acquire("a");
	const b = await gate.acquire("b");
	const order: string[] = [];
	const waits = ["a", "c", "b"].map((k) => gate.acquire(k).then((s) => (order.push(k), s)));
	release(b);
	await sleep(5);
	assert.deepEqual(order, ["c"], "a steht vorne, sein Netz ist aber belegt");
	release(a);
	await sleep(5);
	assert.deepEqual(order, ["c", "a"]);
	release(await waits[1]);
	await sleep(5);
	assert.deepEqual(order, ["c", "a", "b"]);
	release(await waits[0]);
	release(await waits[2]);
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});

test("volle Warteschlange: busy, je Netz und gesamt", async () => {
	const gate = createGate(OPTS);
	const held = [await gate.acquire("a"), await gate.acquire("a"), await gate.acquire("b")];
	const waiting = ["a", "a", "a"].map((k) => gate.acquire(k));
	assert.deepEqual(await gate.acquire("a"), { ok: false, reason: "busy" }, "je Netz höchstens drei Wartende");
	waiting.push(gate.acquire("c"));
	assert.deepEqual(await gate.acquire("d"), { ok: false, reason: "busy" }, "insgesamt höchstens vier");
	for (const s of held) release(s);
	for (const w of waiting) release(await w);
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});

test("zu lange gewartet: busy, der Platz bleibt frei für andere", async () => {
	const gate = createGate({ ...OPTS, maxActive: 1, maxWaitMs: 20 });
	const a = await gate.acquire("a");
	assert.deepEqual(await gate.acquire("b"), { ok: false, reason: "busy" });
	assert.deepEqual(gate.stats(), { active: 1, waiting: 0, held: 0 });
	release(a);
	const c = await gate.acquire("c");
	assert.ok(c.ok);
	release(c);
});

test("Client weg: verlässt die Warteschlange; schon getrennt beginnt nichts", async () => {
	const gate = createGate({ ...OPTS, maxActive: 1 });
	const a = await gate.acquire("a");
	const ac = new AbortController();
	const w = gate.acquire("b", ac.signal);
	ac.abort();
	assert.deepEqual(await w, { ok: false, reason: "aborted" });
	assert.deepEqual(gate.stats(), { active: 1, waiting: 0, held: 0 });
	assert.deepEqual(await gate.acquire("b", ac.signal), { ok: false, reason: "aborted" });
	release(a);
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});

test("release wirkt genau einmal", async () => {
	const gate = createGate(OPTS);
	const a = await gate.acquire("a");
	release(a);
	release(a);
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});

test("nicht abgeholte Antworten: je Netz begrenzt, andere Netze laufen weiter", async () => {
	const gate = createGate(OPTS);
	const sent = gate.hold("a", 60);
	let waiting: GateSlot | null = null;
	void gate.acquire("a").then((s) => (waiting = s));
	await sleep(5);
	assert.equal(waiting, null, "a hat sein Mass voll");
	const b = await gate.acquire("b");
	assert.ok(b.ok);
	release(b);
	assert.equal(waiting, null, "ein freier Platz hilft a nicht");
	sent();
	await sleep(5);
	assert.ok(waiting !== null && (waiting as GateSlot).ok, "abgeholt ⇒ es geht weiter");
	release(waiting!);
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});

test("nicht abgeholte Antworten: insgesamt begrenzt; Freigabe wirkt genau einmal", async () => {
	const gate = createGate({ ...OPTS, maxWaitMs: 20 });
	const holds = [gate.hold("a", 50), gate.hold("b", 50)];
	assert.deepEqual(await gate.acquire("c"), { ok: false, reason: "busy" });
	holds[0]();
	holds[0]();
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 50 });
	const c = await gate.acquire("c");
	assert.ok(c.ok);
	release(c);
	holds[1]();
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});

test("Vorgaben: je Netz weniger als insgesamt, sonst sperrt ein Netz alle aus", () => {
	for (const gate of [MCP_GATE, WEB_GATE]) {
		assert.ok(gate.maxPerKey < gate.maxActive);
		assert.ok(gate.maxQueuePerKey < gate.maxQueue);
	}
	assert.ok(MCP_GATE.maxHeldPerKey < MCP_GATE.maxHeld);
});

test("WEB_GATE: ohne Zählung der Antworten läuft alles bis zur Zahl der Plätze", async () => {
	const gate = createGate(WEB_GATE);
	gate.hold("a", 1e12)();
	const slots = await Promise.all(Array.from({ length: WEB_GATE.maxPerKey }, () => gate.acquire("a")));
	assert.ok(slots.every((s) => s.ok));
	const waiting = gate.acquire("a");
	assert.equal(gate.stats().waiting, 1);
	for (const s of slots) release(s);
	release(await waiting);
	assert.deepEqual(gate.stats(), { active: 0, waiting: 0, held: 0 });
});
