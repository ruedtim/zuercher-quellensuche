/**
 * Unit-Tests für Rate-Limit + Slots des Treffer-Exports. Lauf:
 *   npx tsx --test src/lib/server/exportGate.test.ts
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	EXPORT_MAX_ACTIVE,
	EXPORT_MAX_ACTIVE_PER_CLIENT,
	EXPORT_RATE_LIMIT,
	PACKAGE_MAX_ACTIVE_PER_CLIENT,
	PACKAGE_RATE_LIMIT,
	activeExports,
	resetExportGate,
	tryAcquireExport,
} from "./exportGate";
import { resetRateLimiter } from "./apiV1/rateLimit";

beforeEach(() => {
	resetExportGate();
	resetRateLimiter();
});

function mustAcquire(kind: "table" | "text" | "package", client: string) {
	const r = tryAcquireExport(kind, client);
	assert.ok(r.ok, `Slot erwartet für ${client}`);
	return r.release;
}

test("globale Volltext-Slots: voll ⇒ 503, Freigabe gibt frei", () => {
	const releases = Array.from({ length: EXPORT_MAX_ACTIVE.text }, (_, i) => mustAcquire("text", `c${i}`));
	const blocked = tryAcquireExport("text", "other");
	assert.equal(blocked.ok, false);
	if (!blocked.ok) {
		assert.equal(blocked.status, 503);
		assert.ok(blocked.retryAfterS > 0);
	}
	// Tabellen-Slots sind getrennt
	mustAcquire("table", "other");
	releases[0]();
	mustAcquire("text", "other2");
});

test("Freigabe wirkt genau einmal", () => {
	const release = mustAcquire("text", "a");
	release();
	release();
	release();
	assert.deepEqual(activeExports(), { table: 0, text: 0, package: 0, clients: 0 });
	const r1 = mustAcquire("text", "b");
	const r2 = mustAcquire("text", "c");
	assert.equal(tryAcquireExport("text", "d").ok, false);
	r1();
	r2();
});

test("pro Client höchstens EXPORT_MAX_ACTIVE_PER_CLIENT gleichzeitig (über beide Arten)", () => {
	const rs = [mustAcquire("table", "net"), mustAcquire("text", "net")];
	assert.equal(rs.length, EXPORT_MAX_ACTIVE_PER_CLIENT);
	const blocked = tryAcquireExport("table", "net");
	assert.equal(blocked.ok, false);
	if (!blocked.ok) assert.equal(blocked.status, 503);
	rs[0]();
	mustAcquire("table", "net");
});

test("Rate-Limit: nach EXPORT_RATE_LIMIT Starts ⇒ 429 mit Retry-After", () => {
	const now = 1_000_000;
	for (let i = 0; i < EXPORT_RATE_LIMIT; i++) {
		const r = tryAcquireExport("table", "busy", now + i);
		assert.ok(r.ok);
		r.release();
	}
	const r = tryAcquireExport("table", "busy", now + EXPORT_RATE_LIMIT);
	assert.equal(r.ok, false);
	if (!r.ok) {
		assert.equal(r.status, 429);
		assert.ok(r.retryAfterS > 0);
		assert.ok(r.message.includes("Minute"));
		assert.ok(!r.message.includes("\u2014"));
	}
	// anderer Client unberührt
	assert.ok(tryAcquireExport("table", "calm", now).ok);
});

test("ZIP-Pakete: je Client eigene Plätze, neben einem laufenden Export", () => {
	const exports = [mustAcquire("table", "net"), mustAcquire("text", "net")];
	const packages = Array.from({ length: PACKAGE_MAX_ACTIVE_PER_CLIENT }, () => mustAcquire("package", "net"));
	assert.ok(PACKAGE_MAX_ACTIVE_PER_CLIENT < EXPORT_MAX_ACTIVE.package);
	const blocked = tryAcquireExport("package", "net");
	assert.ok(!blocked.ok && blocked.status === 503);
	mustAcquire("package", "anderes Netz")();
	packages[0]();
	mustAcquire("package", "net")();
	for (const release of [...exports, ...packages]) release();
	assert.deepEqual(activeExports(), { table: 0, text: 0, package: 0, clients: 0 });
});

test("ZIP-Pakete: eigene Plätze und eigenes Kontingent neben den Exporten", () => {
	const held = Array.from({ length: EXPORT_MAX_ACTIVE.package }, (_, i) => mustAcquire("package", `p${i}`));
	const full = tryAcquireExport("package", "x");
	assert.ok(!full.ok && full.status === 503);
	const text = mustAcquire("text", "x");
	text();
	for (const release of held) release();
	for (let i = 0; i < PACKAGE_RATE_LIMIT; i++) mustAcquire("package", "viel")();
	const limited = tryAcquireExport("package", "viel");
	assert.ok(!limited.ok && limited.status === 429);
	mustAcquire("table", "viel")();
});
