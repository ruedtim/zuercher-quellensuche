/**
 * Unit-Tests für den öffentlichen Parameter-Parser. Lauf:
 *   npx tsx --test src/lib/server/apiV1/params.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublicSearchParams, isParamError } from "./params";
import { ENTITY_VALUE_LENGTH_MAX, ENTITY_VALUES_MAX, LIMIT_DEFAULT, WINDOW_MAX } from "./constants";

const u = (qs: string) => new URL(`https://example.org/api/v1/documents${qs}`);

test("Defaults: leere Query", () => {
	const r = parsePublicSearchParams(u(""));
	assert.ok(!isParamError(r));
	assert.equal(r.offset, 0);
	assert.equal(r.limit, LIMIT_DEFAULT);
	assert.equal(r.params.q, "");
	assert.equal(r.params.theme, "");
	assert.deepEqual(r.params.series, []);
	assert.equal(r.params.sort, "relevance");
	assert.equal(r.params.page, 1);
	assert.equal(r.params.pageSize, LIMIT_DEFAULT);
	assert.deepEqual(r.facets, []);
	// Vertrag von 1.0: Namen exakt, solange niemand die Einzahl verwendet.
	assert.equal(r.params.entityMatch, "exact");
	assert.equal(r.keyedEntities, false);
});

test("pageSize = offset + limit (Fenster-Fetch, Route sliced)", () => {
	const r = parsePublicSearchParams(u("?offset=40&limit=20"));
	assert.ok(!isParamError(r));
	assert.equal(r.params.pageSize, 60);
	assert.equal(r.offset, 40);
	assert.equal(r.limit, 20);
});

test("Blätter-Fenster: offset+limit > WINDOW_MAX → eigener Fehlercode", () => {
	const r = parsePublicSearchParams(u(`?offset=${WINDOW_MAX - 10}&limit=20`));
	assert.ok(isParamError(r));
	assert.equal(r.code, "pagination_window_exceeded");
	assert.match(r.message, /bulk/i);
});

test("Grenzfall: offset+limit == WINDOW_MAX ist erlaubt", () => {
	const r = parsePublicSearchParams(u(`?offset=${WINDOW_MAX - 20}&limit=20`));
	assert.ok(!isParamError(r));
});

test("limit ausserhalb 1..100 → invalid_parameter", () => {
	for (const qs of ["?limit=0", "?limit=101", "?limit=abc", "?limit=2.5"]) {
		const r = parsePublicSearchParams(u(qs));
		assert.ok(isParamError(r), qs);
		assert.equal(r.code, "invalid_parameter");
	}
});

test("offset negativ → invalid_parameter", () => {
	const r = parsePublicSearchParams(u("?offset=-1"));
	assert.ok(isParamError(r));
});

test("series: gültige CSV ok, unbekannter Wert → 400", () => {
	const ok = parsePublicSearchParams(u("?series=ABl,KRP"));
	assert.ok(!isParamError(ok));
	assert.deepEqual(ok.params.series, ["ABl", "KRP"]);

	const bad = parsePublicSearchParams(u("?series=XYZ"));
	assert.ok(isParamError(bad));
	assert.match(bad.message, /XYZ/);
});

test("sort: Whitelist", () => {
	const ok = parsePublicSearchParams(u("?sort=date_desc"));
	assert.ok(!isParamError(ok));
	assert.equal(ok.params.sort, "date_desc");

	const bad = parsePublicSearchParams(u("?sort=foo"));
	assert.ok(isParamError(bad));
});

test("dateFrom > dateTo → 400", () => {
	const r = parsePublicSearchParams(u("?dateFrom=1990&dateTo=1980"));
	assert.ok(isParamError(r));
});

test("dateFrom ausserhalb 1483..2100 → 400", () => {
	const r = parsePublicSearchParams(u("?dateFrom=1482"));
	assert.ok(isParamError(r));
	const late = parsePublicSearchParams(u("?dateTo=2101"));
	assert.ok(isParamError(late));
});

test("Ratsmanuale: series=RM und Jahre ab 1483 sind gültig", () => {
	const r = parsePublicSearchParams(u("?series=RM&dateFrom=1484&dateTo=1798"));
	assert.ok(!isParamError(r));
	assert.deepEqual(r.params.series, ["RM"]);
	assert.equal(r.params.dateFrom, 1484);
	assert.equal(r.params.dateTo, 1798);
});

test("numerische CSV-Listen: gültig ok, Müll → 400", () => {
	const ok = parsePublicSearchParams(u("?volumeNr=40,41&years=1900,1901"));
	assert.ok(!isParamError(ok));
	assert.deepEqual(ok.params.volumeNr, [40, 41]);
	assert.deepEqual(ok.params.years, [1900, 1901]);

	const bad = parsePublicSearchParams(u("?volumeNr=40,abc"));
	assert.ok(isParamError(bad));
});

test("Entity-Filter: wiederholte Parameter, Kommas bleiben im Wert", () => {
	const r = parsePublicSearchParams(
		u("?persons=M%C3%BCller%2C%20Hans&persons=Meier&places=Z%C3%BCrich"),
	);
	assert.ok(!isParamError(r));
	assert.deepEqual(r.params.persons, ["Müller, Hans", "Meier"]);
	assert.deepEqual(r.params.places, ["Zürich"]);
});

test("Namensfilter Mehrzahl: exakte Namensform (entityMatch exact), ohne Deckel", () => {
	const r = parsePublicSearchParams(u("?persons=Alfred%20Escher&organizations=Escher%20Wyss"));
	assert.ok(!isParamError(r));
	assert.equal(r.params.entityMatch, "exact");
	assert.equal(r.keyedEntities, false);
	assert.deepEqual(r.params.persons, ["Alfred Escher"]);
	assert.deepEqual(r.params.organizations, ["Escher Wyss"]);

	// Die Mehrzahl bleibt, wie sie in 1.0 war: auch mehr als ENTITY_VALUES_MAX Werte und lange Formen.
	const many = Array.from({ length: ENTITY_VALUES_MAX + 5 }, (_, i) => `persons=P${i}`).join("&");
	const long = `places=${"x".repeat(ENTITY_VALUE_LENGTH_MAX + 1)}`;
	const r2 = parsePublicSearchParams(u(`?${many}&${long}`));
	assert.ok(!isParamError(r2));
	assert.equal(r2.params.persons.length, ENTITY_VALUES_MAX + 5);
	assert.equal(r2.params.entityMatch, "exact");
});

test("Namensfilter Einzahl: Form oder Vergleichsschlüssel, in die Mehrzahl-Felder", () => {
	const r = parsePublicSearchParams(
		u("?person=Escher%2C%20Alfred&person=Meier&place=Fischental&organization=Escher%20Wyss%20%26%20Cie."),
	);
	assert.ok(!isParamError(r));
	assert.equal(r.params.entityMatch, undefined);
	assert.equal(r.keyedEntities, true);
	assert.deepEqual(r.params.persons, ["Escher, Alfred", "Meier"]);
	assert.deepEqual(r.params.places, ["Fischental"]);
	assert.deepEqual(r.params.organizations, ["Escher Wyss & Cie."]);

	// Eine Dimension genügt; die übrigen bleiben leer.
	const one = parsePublicSearchParams(u("?place=W%C3%A4densweil"));
	assert.ok(!isParamError(one));
	assert.equal(one.keyedEntities, true);
	assert.equal(one.params.entityMatch, undefined);
	assert.deepEqual(one.params.places, ["Wädensweil"]);
	assert.deepEqual(one.params.persons, []);
	assert.deepEqual(one.params.organizations, []);
});

test("Namensfilter: Mehrzahl und Einzahl in einer Anfrage → 400, in jeder Kombination", () => {
	for (const qs of [
		"?persons=Alfred%20Escher&person=Alfred%20Escher",
		"?persons=Alfred%20Escher&place=Uster",
		"?organizations=Escher%20Wyss&person=Alfred%20Escher",
		"?place=Uster&places=Uster",
	]) {
		const r = parsePublicSearchParams(u(qs));
		assert.ok(isParamError(r), qs);
		assert.equal(r.code, "invalid_parameter");
		assert.match(r.message, /cannot be combined/);
	}
	const r = parsePublicSearchParams(u("?places=Uster&organization=Escher%20Wyss"));
	assert.ok(isParamError(r));
	assert.match(r.message, /'places'/);
	assert.match(r.message, /'organization'/);
});

test("Namensfilter: leere Werte zählen nicht als verwendet", () => {
	const keyed = parsePublicSearchParams(u("?persons=&places=%20&person=Alfred%20Escher"));
	assert.ok(!isParamError(keyed));
	assert.equal(keyed.keyedEntities, true);
	assert.deepEqual(keyed.params.persons, ["Alfred Escher"]);
	assert.deepEqual(keyed.params.places, []);

	const exact = parsePublicSearchParams(u("?person=&place=%20&persons=Alfred%20Escher"));
	assert.ok(!isParamError(exact));
	assert.equal(exact.keyedEntities, false);
	assert.equal(exact.params.entityMatch, "exact");
	assert.deepEqual(exact.params.persons, ["Alfred Escher"]);
});

test("Namensfilter Einzahl: höchstens ENTITY_VALUES_MAX Werte à ENTITY_VALUE_LENGTH_MAX Zeichen", () => {
	const values = (n: number) => Array.from({ length: n }, (_, i) => `person=Hans%20Meier${i}`).join("&");
	const ok = parsePublicSearchParams(u(`?${values(ENTITY_VALUES_MAX)}`));
	assert.ok(!isParamError(ok));
	assert.equal(ok.params.persons.length, ENTITY_VALUES_MAX);

	const tooMany = parsePublicSearchParams(u(`?${values(ENTITY_VALUES_MAX + 1)}`));
	assert.ok(isParamError(tooMany));
	assert.equal(tooMany.code, "invalid_parameter");
	assert.match(tooMany.message, new RegExp(`'person'.*at most ${ENTITY_VALUES_MAX} values`));

	// Doppelte Werte zählen einmal (wie bei /catalog und /editions).
	const dup = parsePublicSearchParams(u(`?${Array(ENTITY_VALUES_MAX + 5).fill("place=Uster").join("&")}`));
	assert.ok(!isParamError(dup));
	assert.deepEqual(dup.params.places, ["Uster"]);

	const atMax = parsePublicSearchParams(u(`?organization=${"x".repeat(ENTITY_VALUE_LENGTH_MAX)}`));
	assert.ok(!isParamError(atMax));
	const tooLong = parsePublicSearchParams(u(`?organization=${"x".repeat(ENTITY_VALUE_LENGTH_MAX + 1)}`));
	assert.ok(isParamError(tooLong));
	assert.equal(tooLong.code, "invalid_parameter");
	assert.match(tooLong.message, new RegExp(`'organization'.*at most ${ENTITY_VALUE_LENGTH_MAX} characters`));
});

test("theme setzt semanticRatio 0.7, ohne theme 0", () => {
	const mit = parsePublicSearchParams(u("?theme=Hundewesen"));
	assert.ok(!isParamError(mit));
	assert.equal(mit.params.semanticRatio, 0.7);

	const ohne = parsePublicSearchParams(u("?q=Hund"));
	assert.ok(!isParamError(ohne));
	assert.equal(ohne.params.semanticRatio, 0);
});

test("facets: Whitelist series,dateYear", () => {
	const ok = parsePublicSearchParams(u("?facets=series,dateYear"));
	assert.ok(!isParamError(ok));
	assert.deepEqual(ok.facets, ["series", "dateYear"]);

	const bad = parsePublicSearchParams(u("?facets=bogus"));
	assert.ok(isParamError(bad));
});

test("unbekannte Parameter-Namen werden ignoriert", () => {
	const r = parsePublicSearchParams(u("?foo=bar&page=7"));
	assert.ok(!isParamError(r));
});

test("resolutionId/serialNr als String-CSV", () => {
	const r = parsePublicSearchParams(u("?resolutionId=1803/0003,1804/0001&serialNr=632.31"));
	assert.ok(!isParamError(r));
	assert.deepEqual(r.params.resolutionId, ["1803/0003", "1804/0001"]);
	assert.deepEqual(r.params.serialNr, ["632.31"]);
});

test("Zahlenlisten: ausserhalb der sicheren Ganzzahlen → invalid_parameter (sonst «1e+26» im Meili-Filter)", () => {
	for (const qs of ["?volumeNr=1e26", `?years=1900,1${"0".repeat(26)}`, "?startPg=9007199254740993"]) {
		const r = parsePublicSearchParams(u(qs));
		assert.ok(isParamError(r), qs);
		assert.equal(r.code, "invalid_parameter");
	}
	const ok = parsePublicSearchParams(u(`?startPg=${Number.MAX_SAFE_INTEGER}`));
	assert.ok(!isParamError(ok));
});
