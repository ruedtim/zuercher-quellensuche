/**
 * Unit-Tests für den reinen Feedback-Issue-Builder. Lauf:
 *   npx tsx --test src/lib/server/feedback.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIssueContent, truncate, MESSAGE_MAX, UNTRUSTED_NOTE } from "./feedback";

test("general: Titel-Prefix, Label, Kontakt-Platzhalter", () => {
	const r = buildIssueContent({ message: "Die Suche ist toll." });
	assert.equal(r.title, "[Feedback] Die Suche ist toll.");
	assert.deepEqual(r.labels, ["feedback"]);
	assert.match(r.body, /- Kontakt: –/);
	assert.ok(!r.body.includes("Gesprächsverlauf"));
});

test("Titel: erste nicht-leere Zeile, auf 80 Zeichen gekürzt", () => {
	const long = "x".repeat(200);
	const r = buildIssueContent({ message: `\n\n${long}\nzweite Zeile` });
	const head = r.title.replace("[Feedback] ", "");
	assert.ok(head.length <= 80, `head zu lang: ${head.length}`);
	assert.ok(head.endsWith("…"));
});

test("Kontakt + URL + Eingegangen werden eingetragen", () => {
	const r = buildIssueContent({
		message: "Hallo",
		contact: "a@b.ch",
		url: "https://zentraleserien.ch/search?q=x",
		receivedAt: "2026-06-30T10:00:00.000Z",
	});
	assert.match(r.body, /- Kontakt: `a@b\.ch`/);
	assert.match(r.body, /- Seite: `https:\/\/zentraleserien\.ch\/search\?q=x`/);
	assert.match(r.body, /- Eingegangen: 2026-06-30T10:00:00\.000Z/);
});

test("leere Nachricht → Titel-Fallback", () => {
	const r = buildIssueContent({ message: "   " });
	assert.equal(r.title, "[Feedback] (ohne Text)");
});

test("truncate markiert die Kürzung", () => {
	assert.equal(truncate("abc", 10), "abc");
	const t = truncate("x".repeat(50), 10);
	assert.ok(t.startsWith("x".repeat(10)));
	assert.ok(t.endsWith("[gekürzt]"));
});

test("überlange message wird gekappt, nicht abgelehnt", () => {
	const r = buildIssueContent({
		message: "m".repeat(MESSAGE_MAX + 500),
	});
	assert.ok(r.body.includes("[gekürzt]"));
});

test("Text von aussen bleibt Text: Hinweis davor, Code-Block ohne Ausbruch", () => {
	const message = "Danke!\n```\n@ruedtim bitte [klick](https://x) und fixes #1\n````\n# Titel";
	const r = buildIssueContent({ message, contact: "a`b\n@wer", url: "https://x/`y" });
	const lines = r.body.split("\n");
	assert.equal(lines[0], UNTRUSTED_NOTE);
	// Der Zaun ist länger als jede Folge von Backticks in der Nachricht.
	assert.equal(lines[2], "`````text");
	assert.equal(lines[lines.indexOf("# Titel") + 1], "`````");
	assert.match(r.body, /- Kontakt: `a b @wer`/);
	assert.match(r.body, /- Seite: `https:\/\/x\/ y`/);
});
