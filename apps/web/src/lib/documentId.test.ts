// Lauf: npx tsx --test src/lib/documentId.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocumentId } from "./documentId";

test("isDocumentId: IDs der Plattform", () => {
	for (const id of [
		"ABl_1904__S__1-13_",
		"KRP_2015_gca05cc996e7d4f24acdecbdf198bb3c1_t04",
		"MM_3_198_RRB_1992_1860_t",
		"RRB_2023_0877",
		"OS_2025_131_1-81-75",
		"RM_1552_0001_0001",
		"x".repeat(511),
	]) {
		assert.ok(isDocumentId(id), id);
	}
});

test("isDocumentId: Pfade, Trennzeichen und Leeres sind keine ID", () => {
	for (const id of ["", "..", "../search", "..\\stats", "ABl_1#/../x", "a?b", "a/b", "a%2Fb", "a b", "a.b", "a\u0000", "ä", "x".repeat(512), null, 7, undefined]) {
		assert.equal(isDocumentId(id), false, String(id));
	}
});
