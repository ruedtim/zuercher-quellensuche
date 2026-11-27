// Lauf: npx tsx --test src/lib/exampleQuestions.test.ts
// Sichert die Beispielfragen der Startseite ab: je Quelle eine, die Garantien (nach 2000,
// englisch), die Ziele (Reiter, Thema bzw. eigene Suche) und die Grenzen der Bestände.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_QUESTIONS, EXAMPLE_SOURCES, EXAMPLE_VIEW, exampleHref, pickHomepageExamples, type Example, type ExampleSource } from "./exampleQuestions";
import { EHEDATEN_YEAR_MAX, EHEDATEN_YEAR_MIN, parseEhedatenFilters } from "./ehedaten";
import { parseSearchParams } from "./searchParams";
import { isSearchView, parseSearchView } from "./searchViews";
import { askRedirectTarget } from "./server/askRedirect";
import { extractDateRange } from "./server/passageQuery";

const ALL = EXAMPLE_SOURCES.flatMap((source) => EXAMPLE_QUESTIONS[source].map((example) => ({ source, example })));
const BY_TEXT = new Map(ALL.map((e) => [e.example.text, e]));
const urlOf = (source: ExampleSource, example: Example) => new URL(exampleHref(source, example), "http://local");

test("Startseite: je Quelle eine Frage, mindestens eine nach 2000 und eine englische", () => {
	// Gegen den Zufall vielfach ziehen – die Garantien müssen jedes Mal gelten.
	for (let i = 0; i < 300; i++) {
		const out = pickHomepageExamples();
		const entries = out.map((e) => BY_TEXT.get(e.text));
		assert.ok(entries.every(Boolean), "jede Frage stammt aus einem Topf");
		assert.deepEqual(entries.map((e) => e!.source).sort(), [...EXAMPLE_SOURCES].sort());
		assert.ok(entries.some((e) => e!.example.post2000), "mindestens eine nach 2000");
		assert.ok(out.some((e) => e.lang === "en"), "mindestens eine englische");
		for (const [k, e] of entries.entries()) {
			assert.equal(out[k].href, exampleHref(e!.source, e!.example));
			assert.equal(out[k].lang, e!.example.lang);
		}
	}
});

test("eine fehlende Quelle lässt ihren Topf weg, die Garantien gelten weiter", () => {
	for (let i = 0; i < 100; i++) {
		const out = pickHomepageExamples({ catalog: false, ehedaten: false, rm: false });
		assert.deepEqual(out.map((e) => BY_TEXT.get(e.text)!.source).sort(), ["all", "documents", "editions"]);
		assert.ok(out.some((e) => e.lang === "en") && out.some((e) => BY_TEXT.get(e.text)!.example.post2000));
	}
});

test("Töpfe: jede Frage steht in genau einem, nie leer", () => {
	assert.equal(BY_TEXT.size, ALL.length);
	for (const source of EXAMPLE_SOURCES) assert.ok(EXAMPLE_QUESTIONS[source].length >= 5, source);
});

test("Ziel: der Reiter der Quelle", () => {
	for (const { source, example } of ALL) {
		assert.ok(isSearchView(EXAMPLE_VIEW[source]));
		assert.equal(parseSearchView(urlOf(source, example).searchParams), EXAMPLE_VIEW[source], example.text);
	}
});

test("Frage nach Bedeutung: Thema ohne Jahreszahlen, der Zeitraum als Filter", () => {
	for (const { source, example } of ALL.filter((e) => !e.example.search)) {
		const target = askRedirectTarget(urlOf(source, example), { semantic: true });
		assert.ok(target, example.text);
		const sp = new URL(target, "http://local").searchParams;
		assert.ok((sp.get("theme") ?? "").split(" ").length >= 3, example.text);
		assert.doesNotMatch(sp.get("theme")!, /\d/, `Jahre im Thema: ${sp.get("theme")}`);
		assert.equal(parseSearchView(sp), EXAMPLE_VIEW[source]);
		const range = extractDateRange(example.text, 700);
		assert.equal(sp.get("dateFrom"), range?.from != null ? String(range.from) : null, example.text);
		assert.equal(sp.get("dateTo"), range?.to != null ? String(range.to) : null, example.text);
		// Jede Jahreszahl der Frage wird zum Zeitraum.
		if (/\d{4}/.test(example.text)) assert.ok(range, example.text);
		// Ohne Embed-Service wird sie zur Stichwortsuche.
		const q = new URL(askRedirectTarget(urlOf(source, example), { semantic: false })!, "http://local").searchParams.get("q");
		assert.ok(q, example.text);
	}
});

test("Grenzen der Bestände", () => {
	for (const { source, example } of ALL.filter((e) => !e.example.search)) {
		const d = extractDateRange(example.text, 700);
		if (!d) continue;
		if (source === "documents") {
			assert.ok((d.from ?? 1803) >= 1803 && (d.to ?? 1803) >= 1803, `vor 1803: ${example.text}`);
			// RRB-Lücke 1995–2007: entweder historisch (≤ 1994) oder ab 2008.
			if (/Regierungsrat/.test(example.text)) {
				assert.ok((d.to !== null && d.to <= 1994) || (d.from !== null && d.from >= 2008), `RRB-Lücke: ${example.text}`);
			}
		}
		// Editionen: Stücke 1180–1800.
		if (source === "editions") assert.ok((d.from ?? 1800) <= 1800 && (d.to ?? 1180) >= 1180, example.text);
	}
});

test("Ratsmanuale und Ehedaten bringen ihre Suche mit (keine Vektoren)", () => {
	for (const { source, example } of ALL) assert.equal(example.search !== undefined, source === "rm" || source === "ehedaten", example.text);
	for (const example of EXAMPLE_QUESTIONS.rm) {
		const p = parseSearchParams(urlOf("rm", example));
		assert.deepEqual(p.series, ["RM"], example.text);
		assert.ok(p.anyTerms.length >= 2, example.text);
		assert.equal(p.theme, "");
	}
	for (const example of EXAMPLE_QUESTIONS.ehedaten) {
		const url = urlOf("ehedaten", example);
		const p = parseSearchParams(url);
		const e = parseEhedatenFilters(url);
		assert.ok(e.active, example.text);
		assert.ok(p.q || p.anyTerms.length >= 2 || p.persons.length || p.places.length || e.kirche.length, example.text);
		for (const year of [p.dateFrom, p.dateTo]) if (year !== null) assert.ok(year >= EHEDATEN_YEAR_MIN && year <= EHEDATEN_YEAR_MAX, example.text);
	}
});
