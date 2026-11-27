// Lauf: npx tsx --test src/lib/server/analyticsRetention.test.ts
// Aufbewahrungsfrist des Nutzungs-Logs (analytics/retention.ts): welche
// Tagesdateien log.ts löscht. Liegt bewusst unter src/lib/server/ (nicht
// analytics/), damit der CI-Glob `src/lib/server/*.test.ts` greift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RETENTION_DAYS, expiredLogFiles, parseRetentionDays } from "./analytics/retention";

test("expiredLogFiles: löscht nur Tagesdateien älter als die Frist", () => {
	const names = [
		"2025-05-13.jsonl",
		"2025-05-14.jsonl",
		"2025-05-15.jsonl", // genau 365 Tage alt → bleibt
		"2026-05-14.jsonl",
		"2026-05-15.jsonl",
	];
	assert.deepEqual(expiredLogFiles(names, "2026-05-15", 365), ["2025-05-13.jsonl", "2025-05-14.jsonl"]);
});

test("expiredLogFiles: fremde Dateinamen bleiben unangetastet", () => {
	const names = ["README", "2020-01-01.jsonl.gz", "x-2020-01-01.jsonl", "2020-01-01.json", ".keep"];
	assert.deepEqual(expiredLogFiles(names, "2026-09-25", 365), []);
});

test("expiredLogFiles: Frist <= 0 oder ungültiger Tag löscht nichts", () => {
	const names = ["2000-01-01.jsonl"];
	assert.deepEqual(expiredLogFiles(names, "2026-09-25", 0), []);
	assert.deepEqual(expiredLogFiles(names, "2026-09-25", -1), []);
	assert.deepEqual(expiredLogFiles(names, "2026-09-25", Number.NaN), []);
	assert.deepEqual(expiredLogFiles(names, "kein-datum", 365), []);
});

test("expiredLogFiles: Schaltjahr – die Frist zählt Tage, nicht Kalenderjahre", () => {
	// 2028-03-01 minus 365 Tage = 2027-03-02 (2028 ist ein Schaltjahr).
	const names = ["2027-03-01.jsonl", "2027-03-02.jsonl"];
	assert.deepEqual(expiredLogFiles(names, "2028-03-01", 365), ["2027-03-01.jsonl"]);
});

test("parseRetentionDays: Default, Zahlen, Abschalten", () => {
	assert.equal(parseRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
	assert.equal(parseRetentionDays(""), DEFAULT_RETENTION_DAYS);
	assert.equal(parseRetentionDays("  "), DEFAULT_RETENTION_DAYS);
	assert.equal(parseRetentionDays("abc"), DEFAULT_RETENTION_DAYS);
	assert.equal(parseRetentionDays("90"), 90);
	assert.equal(parseRetentionDays("30.7"), 30);
	assert.equal(parseRetentionDays("0"), 0);
	assert.equal(parseRetentionDays("-5"), -5);
	assert.equal(DEFAULT_RETENTION_DAYS, 365);
});
