// Lauf: npx tsx --test src/lib/server/highlight.test.ts
// Serverseitiges Nach-Markieren/-Croppen: Entity-Marks und die ODER-/UND-
// Begriffe der zweistufigen Union-Pfade (markTerms/cropAroundTerms) – exakte
// Wortgrenzen, Schutz bestehender <mark>-Blöcke, Crop um die erste Fundstelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { markTerms, markEntities, cropAroundTerms, cropAtBestWindow } from "./highlight";

test("markTerms: Wortgrenzen inkl. Umlaute, Klasse parametrisiert, case-insensitiv", () => {
	assert.equal(
		markTerms("Der Hund bellt.", ["Hund"], "match"),
		'Der <mark class="match">Hund</mark> bellt.',
	);
	// Kein Teilwort-Match: «Hunden» bleibt unmarkiert (akzeptierte Grenze,
	// kein Stemming wie bei Meili).
	assert.equal(markTerms("Mit den Hunden.", ["Hund"], "match"), "Mit den Hunden.");
	// Manuelle Unicode-Wortgrenze (JS-\b versteht Umlaute nicht): «Wuth»
	// enthält «Wut», darf aber nicht anschlagen.
	assert.equal(
		markTerms("Die Wuth über die Wut.", ["Wut"], "match"),
		'Die Wuth über die <mark class="match">Wut</mark>.',
	);
	assert.equal(
		markTerms("KOKAIN gefunden", ["Kokain"], "match"),
		'<mark class="match">KOKAIN</mark> gefunden',
	);
	// Leere Begriffsliste → Eingabe unverändert.
	assert.equal(markTerms("Text bleibt.", [" ", ""], "match"), "Text bleibt.");
});

test("markTerms: längster Begriff zuerst, mehrere Begriffe", () => {
	assert.equal(
		markTerms("Zürich-Affoltern und Zürich", ["Zürich", "Zürich-Affoltern"], "match"),
		'<mark class="match">Zürich-Affoltern</mark> und <mark class="match">Zürich</mark>',
	);
	assert.equal(
		markTerms("Kokain oder Koks", ["Kokain", "Koks"], "match"),
		'<mark class="match">Kokain</mark> oder <mark class="match">Koks</mark>',
	);
});

test("markTerms: bestehende <mark>-Blöcke bleiben unangetastet (keine Verschachtelung)", () => {
	const pre = 'Der <mark class="match">Hund</mark> und der Hund';
	assert.equal(
		markTerms(pre, ["Hund"], "match"),
		'Der <mark class="match">Hund</mark> und der <mark class="match">Hund</mark>',
	);
	// Begriff, der nur INNERHALB eines bestehenden Marks vorkommt → nichts tun.
	assert.equal(
		markTerms('<mark class="match">Zürichsee</mark>', ["Zürichsee"], "entity-match"),
		'<mark class="match">Zürichsee</mark>',
	);
});

test("markTerms → markEntities: Reihenfolge Union-Begriffe vor Entities, keine Verschachtelung", () => {
	const step1 = markTerms("Kokain in Zürich", ["Kokain"], "match");
	const step2 = markEntities(step1, ["Zürich"]);
	assert.equal(
		step2,
		'<mark class="match">Kokain</mark> in <mark class="entity-match">Zürich</mark>',
	);
});

test("cropAroundTerms: Fenster um die erste Fundstelle, null ohne Fundstelle", () => {
	const words = Array.from({ length: 100 }, (_, i) => `wort${i}`);
	words[60] = "Tollwut";
	const body = words.join(" ");
	const crop = cropAroundTerms(body, ["Tollwut"], 10);
	assert.ok(crop, "Fundstelle vorhanden → Crop");
	assert.ok(crop.includes("Tollwut"));
	assert.ok(crop.includes("wort58"), "Wörter vor der Fundstelle");
	assert.ok(crop.includes("wort62"), "Wörter nach der Fundstelle");
	assert.ok(!crop.includes("wort45"), "weit davor gekappt");
	assert.ok(!crop.includes("wort75"), "weit danach gekappt");
	assert.equal(cropAroundTerms(body, ["fehlt"], 10), null);
	assert.equal(cropAroundTerms("", ["Tollwut"], 10), null);
	assert.equal(cropAroundTerms(body, [], 10), null);
});

test("cropAroundTerms: Auslassungszeichen nur an abgeschnittenen Enden (Katalog)", () => {
	const words = Array.from({ length: 100 }, (_, i) => `wort${i}`);
	words[60] = "Tollwut";
	const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ");
	assert.match(norm(cropAroundTerms(words.join(" "), ["Tollwut"], 10, "…")), /^…wort5\d .*Tollwut.* wort6\d…$/);
	// Ganzer Text im Fenster: kein Zeichen.
	assert.equal(norm(cropAroundTerms("Akten zur Tollwut im Bezirk", ["Tollwut"], 10, "…")), "Akten zur Tollwut im Bezirk");
	// Fundstelle am Anfang: nur hinten abgeschnitten.
	const head = norm(cropAroundTerms(`Tollwut ${words.slice(0, 20).join(" ")}`, ["Tollwut"], 10, "…"));
	assert.ok(head.startsWith("Tollwut wort0 ") && head.endsWith("…"), head);
	// Ohne marker wie bisher.
	assert.equal(cropAroundTerms(words.join(" "), ["Tollwut"], 10)?.includes("…"), false);
});

test("cropAtBestWindow: Fenster mit den meisten Wörtern der Frage, markiert, gebeugte Formen zählen", () => {
	const words = Array.from({ length: 200 }, (_, i) => `wort${i}`);
	words[10] = "Regierungsrat"; // einzelnes, häufiges Wort früh im Text
	words[120] = "Massnahmen";
	words[124] = "gegen";
	words[126] = "Tollwut,";
	words[131] = "Hunden";
	const crop = cropAtBestWindow(words.join(" "), ["Regierungsrat", "Massnahmen", "Tollwut", "Hund"], 20);
	assert.ok(crop, "Fundstellen → Auszug");
	assert.match(crop!, /<mark class="match">Massnahmen<\/mark>/);
	assert.match(crop!, /<mark class="match">Tollwut<\/mark>,/);
	assert.match(crop!, /<mark class="match">Hunden<\/mark>/);
	assert.doesNotMatch(crop!, /Regierungsrat/, "nicht die frühe Einzelnennung");
	assert.ok(crop!.replace(/<[^>]+>/g, "").split(" ").length <= 20, "höchstens 20 Wörter");
});

test("cropAtBestWindow: ohne Fundstelle bzw. ohne brauchbare Wörter null, kurze Texte ganz", () => {
	assert.equal(cropAtBestWindow("Beschluss über Strassenbau im Bezirk", ["Tollwut"], 30), null);
	assert.equal(cropAtBestWindow("Beschluss über Strassenbau", ["im", "zu"], 30), null, "Wörter unter drei Zeichen zählen nicht");
	assert.equal(cropAtBestWindow("", ["Tollwut"], 30), null);
	assert.equal(
		cropAtBestWindow("Verordnung über die Tollwut im Kanton", ["tollwut"], 30),
		'Verordnung über die <mark class="match">Tollwut</mark> im Kanton',
	);
});

test("markTerms und cropAroundTerms: ß und ss gelten als gleich, angezeigt wird das Original", () => {
	assert.equal(markTerms("Straße und Strasse, Straßen", ["Strasse"], "match"), '<mark class="match">Straße</mark> und <mark class="match">Strasse</mark>, Straßen');
	assert.equal(markTerms("Schloss, SCHLOSS", ["Schloß"], "match"), '<mark class="match">Schloss</mark>, <mark class="match">SCHLOSS</mark>');
	// Wortgrenzen gelten weiter: «Fluss» nicht in «Flußbett».
	assert.equal(markTerms("Flußbett am Fluß", ["Fluss"], "match"), 'Flußbett am <mark class="match">Fluß</mark>');
	const words = Array.from({ length: 60 }, (_, i) => `wort${i}`);
	words[40] = "Schloß";
	assert.match(cropAroundTerms(words.join(" "), ["Schloss"], 10, "…") ?? "", /^…wort\d+ .*Schloß\s+wort41 /);
});
