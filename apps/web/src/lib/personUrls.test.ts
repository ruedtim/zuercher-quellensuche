import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_DIRECTORY_QUERY,
	directoryUrl,
	parseDirectoryQuery,
	parsePersonQuery,
	personUrl,
} from "./personUrls";

const NOW = 2026;
const qs = (s: string) => new URLSearchParams(s);

test("parsePersonQuery: Defaults, gültige Werte, Ungültiges fällt auf den Default", () => {
	assert.deepEqual(parsePersonQuery(qs(""), NOW), { scope: "all", sort: "date_desc", from: null, to: null, page: 1 });
	assert.deepEqual(parsePersonQuery(qs("umfang=titel&sort=date_asc&von=1990&bis=1995&seite=3"), NOW), {
		scope: "title",
		sort: "date_asc",
		from: 1990,
		to: 1995,
		page: 3,
	});
	assert.equal(parsePersonQuery(qs("umfang=text"), NOW).scope, "text");
	// vertauschte Grenzen werden geordnet, ausserhalb 1803..heute entfällt die Grenze
	const q = parsePersonQuery(qs("von=1995&bis=1990"), NOW);
	assert.deepEqual([q.from, q.to], [1990, 1995]);
	const bad = parsePersonQuery(qs("von=1700&bis=3000&seite=0&sort=x&umfang=y"), NOW);
	assert.deepEqual(bad, { scope: "all", sort: "date_desc", from: null, to: null, page: 1 });
	assert.equal(parsePersonQuery(qs("seite=-4"), NOW).page, 1);
	assert.equal(parsePersonQuery(qs("seite=abc"), NOW).page, 1);
});

test("personUrl: nur Abweichungen vom Default, Rundreise mit parsePersonQuery", () => {
	assert.equal(personUrl(23404), "/personen/23404");
	assert.equal(personUrl(23404, { scope: "all", sort: "date_desc", page: 1 }), "/personen/23404");
	const url = personUrl(23404, { scope: "text", sort: "date_asc", from: 1990, to: 1995, page: 2 });
	assert.equal(url, "/personen/23404?umfang=text&sort=date_asc&von=1990&bis=1995&seite=2");
	const back = parsePersonQuery(new URL(url, "http://x").searchParams, NOW);
	assert.deepEqual(back, { scope: "text", sort: "date_asc", from: 1990, to: 1995, page: 2 });
});

test("parseDirectoryQuery/directoryUrl: Rundreise, Unsinn fällt auf den Default", () => {
	assert.deepEqual(parseDirectoryQuery(qs("")), DEFAULT_DIRECTORY_QUERY);
	const q = parseDirectoryQuery(qs("q=%20%20Müller%20%20Hans&amt=Regierungsrat&alle=1&sort=docs&seite=2"));
	assert.deepEqual(q, { q: "Müller Hans", council: "Regierungsrat", withDocs: false, sort: "docs", page: 2 });
	assert.equal(directoryUrl(q), "/personen?q=M%C3%BCller+Hans&amt=Regierungsrat&alle=1&sort=docs&seite=2");
	assert.equal(directoryUrl(), "/personen");
	assert.equal(parseDirectoryQuery(qs("amt=Bundesrat&sort=x&seite=zz")).council, "");
});

