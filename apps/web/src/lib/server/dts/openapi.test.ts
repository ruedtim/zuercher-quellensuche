/**
 * Unit-Tests für die DTS-OpenAPI-Spec. Sichern ab, dass die Spec nicht von der
 * Implementierung driftet (Pfade, Enums, Pflicht-Parameter, Fehlercodes). Lauf:
 *   npx tsx --test src/lib/server/dts/openapi.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { dtsOpenApiDocument } from "./openapi";
import { DTS_VERSION, NAV_VALUES, SUPPORTED_MEDIA_TYPES } from "./constants";

// Lose, aber typisierte Sicht auf die handgebaute Spec.
interface Param {
	name: string;
	required?: boolean;
	schema?: { enum?: readonly unknown[]; default?: unknown };
}
interface Operation {
	parameters?: Param[];
	responses: Record<string, { content?: Record<string, unknown> }>;
}
interface Spec {
	openapi: string;
	info: { version: string };
	paths: Record<string, { get: Operation }>;
	components: {
		schemas: {
			DtsError: { properties: { error: { properties: { code: { enum: string[] } } } } };
		};
	};
}
const spec = dtsOpenApiDocument as unknown as Spec;

const paramOf = (op: Operation, name: string): Param | undefined =>
	op.parameters?.find((p) => p.name === name);

test("OpenAPI-Version 3.1.0 und Info-Version = DTS_VERSION", () => {
	assert.equal(spec.openapi, "3.1.0");
	assert.equal(spec.info.version, DTS_VERSION);
});

test("genau die vier DTS-Pfade", () => {
	assert.deepEqual(Object.keys(spec.paths).sort(), [
		"/",
		"/collection",
		"/document",
		"/navigation",
	]);
});

test("collection.nav-Enum entspricht NAV_VALUES", () => {
	const nav = paramOf(spec.paths["/collection"].get, "nav");
	assert.deepEqual(nav?.schema?.enum, [...NAV_VALUES]);
	assert.equal(nav?.schema?.default, NAV_VALUES[0]);
});

test("document.mediaType-Enum entspricht SUPPORTED_MEDIA_TYPES", () => {
	const mt = paramOf(spec.paths["/document"].get, "mediaType");
	assert.deepEqual(mt?.schema?.enum, [...SUPPORTED_MEDIA_TYPES]);
	assert.equal(mt?.schema?.default, SUPPORTED_MEDIA_TYPES[0]);
});

test("document 200 bietet alle drei Content-Types an", () => {
	const content = spec.paths["/document"].get.responses["200"].content ?? {};
	for (const mediaType of SUPPORTED_MEDIA_TYPES) {
		assert.ok(mediaType in content, `200 fehlt Content-Type ${mediaType}`);
	}
});

test("navigation und document verlangen resource als Pflicht-Parameter", () => {
	for (const path of ["/navigation", "/document"] as const) {
		const resource = paramOf(spec.paths[path].get, "resource");
		assert.equal(resource?.required, true, `${path}: resource muss required sein`);
	}
});

test("ref/start/end sind flach (Enum [\"1\"]) auf navigation und document", () => {
	for (const path of ["/navigation", "/document"] as const) {
		for (const name of ["ref", "start", "end"] as const) {
			const p = paramOf(spec.paths[path].get, name);
			assert.deepEqual(p?.schema?.enum, ["1"], `${path}.${name} muss Enum ["1"] sein`);
		}
	}
});

test("DtsError-Code-Enum deckt die sechs stabilen Fehlercodes ab", () => {
	// Hartkodierter Vertrag (= der DtsErrorCode-Union in constants.ts); fängt
	// Drift in der Spec ab.
	const expected = [
		"invalid_parameter",
		"not_found",
		"method_not_allowed",
		"unsupported_media_type",
		"upstream_unavailable",
		"internal_error",
	];
	const enumCodes = spec.components.schemas.DtsError.properties.error.properties.code.enum;
	assert.deepEqual([...enumCodes].sort(), [...expected].sort());
});
