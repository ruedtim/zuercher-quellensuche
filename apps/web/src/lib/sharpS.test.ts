// Lauf: npx tsx --test src/lib/sharpS.test.ts
// ß und ss in der Suche: Faltung, Muster und das Zurückübertragen von Meilis Formatierung.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSharpS, foldedField, sharpSPattern, sharpSSpellings, unfoldFormatted } from "./sharpS";

const MARKS = { pre: '<mark class="match">', post: "</mark>" };
const M = (s: string) => `${MARKS.pre}${s}${MARKS.post}`;

test("foldSharpS: ß und ẞ, sonst unverändert", () => {
	assert.equal(foldSharpS("Straße, Schloß, daß"), "Strasse, Schloss, dass");
	assert.equal(foldSharpS("GROẞE"), "GROSSE");
	assert.equal(foldSharpS("10 ß"), "10 ss");
	assert.equal(foldSharpS("Strasse"), "Strasse");
	assert.equal(foldedField("title"), "titleSearch");
});

test("sharpSPattern: ss, ß, SS und ẞ treffen einander", () => {
	const re = (w: string) => new RegExp(`^${sharpSPattern(w)}$`, "iu");
	for (const w of ["Strasse", "Straße", "STRASSE", "STRAẞE"]) for (const v of ["Strasse", "Straße", "STRASSE", "STRAẞE"]) assert.ok(re(w).test(v), `${w} / ${v}`);
	assert.equal(sharpSPattern("Strasse"), "Stra(?:ss|ß)e");
	// Drei s: ss und ß in jeder Folge (frühneuhochdeutsch auch «usß»).
	for (const w of ["usss", "usß", "ußs"]) for (const v of ["usss", "usß", "ußs", "UẞS"]) assert.ok(re(w).test(v), `${w} / ${v}`);
	assert.ok(re("Missstand").test("Mißstand"));
	assert.ok(re("Schloßsee").test("Schlosssee"));
	assert.ok(re("Flußstraße").test("Flussstrasse"));
	assert.ok(!re("Strasse").test("Strase"));
	assert.ok(!re("uss").test("usß"));
	assert.equal(sharpSPattern("Uster"), "Uster");
	// Lange Folgen zählt das Muster nicht auf.
	assert.equal(sharpSPattern("s".repeat(500)), "[sß]+");
});

test("sharpSSpellings: mit ss und, wo eines steht, mit ß", () => {
	assert.deepEqual(sharpSSpellings("Weiß"), ["Weiss", "Weiß"]);
	assert.deepEqual(sharpSSpellings("Weissenb"), ["Weissenb", "Weißenb"]);
	assert.deepEqual(sharpSSpellings("GROSS"), ["GROSS", "GROß"]);
	assert.deepEqual(sharpSSpellings("Uster"), ["Uster"]);
	assert.deepEqual(sharpSSpellings(""), [""]);
	// Drei s: nur die ersten zwei sind ein ß. Beides gemischt: auch wie geschrieben.
	assert.deepEqual(sharpSSpellings("Grosssachsenheim"), ["Grosssachsenheim", "Großsachsenheim"]);
	assert.deepEqual(sharpSSpellings("Großsachsenheim"), ["Grosssachsenheim", "Großsachsenheim"]);
	assert.deepEqual(sharpSSpellings("Großstrasse"), ["Grossstrasse", "Großstraße", "Großstrasse"]);
});

test("unfoldFormatted: ganzer Text, Hervorhebung am ß", () => {
	assert.equal(unfoldFormatted(`Bau der ${M("Strasse")} nach Baden`, "Bau der Straße nach Baden", MARKS), `Bau der ${M("Straße")} nach Baden`);
	// Mehrere Stellen, ss und ß gemischt, ß auch ausserhalb der Stellen.
	assert.equal(
		unfoldFormatted(`${M("Schloss")}gasse, grosser ${M("Schloss")}platz, dass ${M("Schloss")}`, "Schloßgasse, grosser Schlossplatz, daß Schloß", MARKS),
		`${M("Schloß")}gasse, grosser ${M("Schloss")}platz, daß ${M("Schloß")}`,
	);
	// Ohne Stellen: das Original.
	assert.equal(unfoldFormatted("dass Strasse", "daß Straße", MARKS), "daß Straße");
	assert.equal(unfoldFormatted(M("GROSSE"), "GROẞE", MARKS), M("GROẞE"));
});

test("unfoldFormatted: eine Stelle, die mitten im ss endet oder beginnt, schliesst das ß ein", () => {
	assert.equal(unfoldFormatted(`${M("Stras")}senbau`, "Straßenbau", MARKS), `${M("Straß")}enbau`);
	assert.equal(unfoldFormatted(`Gros${M("se")} Halde`, "Große Halde", MARKS), `Gro${M("ße")} Halde`);
	// Zwei Stellen teilen sich ein ß: es steht nur einmal da.
	assert.equal(unfoldFormatted(`${M("Stras")}${M("se")}`, "Straße", MARKS), `${M("Straß")}${M("e")}`);
});

test("unfoldFormatted: Auszug am Anfang, am Ende und in der Mitte", () => {
	const original = "Kauf des Schlosses. Der Weg bei der Straße nach Baden, daß er offen bleibe.";
	assert.equal(unfoldFormatted("Kauf des Schlosses. Der Weg…", original, MARKS), "Kauf des Schlosses. Der Weg…");
	assert.equal(unfoldFormatted(`…bei der ${M("Strasse")} nach Baden…`, original, MARKS), `…bei der ${M("Straße")} nach Baden…`);
	assert.equal(unfoldFormatted(`…nach Baden, ${M("dass")} er offen bleibe.`, original, MARKS), `…nach Baden, ${M("daß")} er offen bleibe.`);
	// Ein eigenes «…» am Textanfang ist kein Auszug.
	assert.equal(unfoldFormatted(`…und ${M("dass")}`, "…und daß", MARKS), `…und ${M("daß")}`);
	// Am Ende gekürzter Katalogtext («… …» aus dem Aufbau) und abgeschnitten.
	assert.equal(unfoldFormatted(`…er ${M("dass")} …`, "Der Rat, daß er daß …", MARKS), `…er ${M("daß")} …`);
});

test("unfoldFormatted: Zeichen ausserhalb der Grundebene, Umbrüche, spitze Klammern", () => {
	assert.equal(unfoldFormatted(`𝔄 <i> & ${M("Fuss")}\nweg`, "𝔄 <i> & Fuß\nweg", MARKS), `𝔄 <i> & ${M("Fuß")}\nweg`);
});

test("unfoldFormatted: passt der Text nicht zum Original, null", () => {
	assert.equal(unfoldFormatted("ganz anderer Text", "Straße", MARKS), null);
	assert.equal(unfoldFormatted("…anderer Auszug…", "Straße nach Baden", MARKS), null);
	// Eine offene Marke ist gewöhnlicher Text und passt darum nicht.
	assert.equal(unfoldFormatted(`${MARKS.pre}Strasse`, "Straße", MARKS), null);
});
