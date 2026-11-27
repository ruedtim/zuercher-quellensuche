/**
 * Unit-Tests für die OpenAPI-Spec von /api/v1: die Namensfilter der Suche stehen
 * so in der Spec, wie params.ts sie liest (Mehrzahl und Einzahl, Deckel der Einzahl).
 * Lauf:
 *   npx tsx --test src/lib/server/apiV1/openapi.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { openApiDocument } from "./openapi";
import { API_V1_VERSION, ENTITY_PARAMS, ENTITY_VALUE_LENGTH_MAX, ENTITY_VALUES_MAX } from "./constants";

interface Param {
	name: string;
	description?: string;
	schema?: { type?: string; maxItems?: number; items?: { maxLength?: number } };
	explode?: boolean;
}
interface Spec {
	info: { version: string };
	paths: Record<string, { get: { parameters?: Param[] } }>;
}
const spec = openApiDocument as unknown as Spec;

const paramOf = (path: string, name: string): Param | undefined =>
	spec.paths[path].get.parameters?.find((p) => p.name === name);

test("Info-Version = API_V1_VERSION", () => {
	assert.equal(spec.info.version, API_V1_VERSION);
});

test("Namensfilter: Mehrzahl exakt, Einzahl mit Deckel – in /documents und /facets/{dim}", () => {
	for (const path of ["/documents", "/facets/{dim}"]) {
		for (const { dim, singular } of ENTITY_PARAMS) {
			const plural = paramOf(path, dim);
			assert.ok(plural, `${path} ${dim}`);
			assert.match(plural.description ?? "", /exakte Namensform/);
			assert.equal(plural.explode, true);

			const one = paramOf(path, singular);
			assert.ok(one, `${path} ${singular}`);
			assert.equal(one.explode, true);
			assert.equal(one.schema?.type, "array");
			assert.equal(one.schema?.maxItems, ENTITY_VALUES_MAX);
			assert.equal(one.schema?.items?.maxLength, ENTITY_VALUE_LENGTH_MAX);
		}
	}
});
