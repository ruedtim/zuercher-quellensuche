// Lauf: npx tsx --test src/lib/krdbMentions.test.ts
// Personen-Nennungen im Text ↔ Zuordnungen (KRDB über die Form, Kleiner Rat über die GND)
// und Platzierung der Karte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMentionIndex, buildRefIndex, CARD_GAP, CARD_MARGIN, entitySurface, mentionIds, placeCard } from "./krdbMentions";

test("entitySurface normalisiert wie der Indexer", () => {
	assert.equal(entitySurface("  R.\n   Meier. "), "R. Meier");
	assert.equal(entitySurface("Herrn Walther,"), "Herrn Walther");
	assert.equal(entitySurface("Escher;:"), "Escher");
	// Punkte im Namen bleiben, nur Satzzeichen am Ende fallen weg.
	assert.equal(entitySurface("J. J. Keller"), "J. J. Keller");
	assert.equal(entitySurface("   "), "");
});

test("buildMentionIndex: Formen → Personen, Mehrpersonen-Form, keine Doppel", () => {
	const index = buildMentionIndex([
		{ id: 1, forms: ["Pfister, Meier & Schaufelberger", "Pfister"] },
		{ id: 2, forms: ["Pfister, Meier & Schaufelberger"] },
		{ id: 3, forms: ["R. Meier", "R.  Meier"] },
	]);
	assert.deepEqual(index.get("Pfister, Meier & Schaufelberger"), [1, 2]);
	assert.deepEqual(index.get("Pfister"), [1]);
	assert.deepEqual(index.get("R. Meier"), [3], "gleiche Form nach Normalisierung nur einmal");
	assert.equal(index.size, 3);
});

test("mentionIds: GND bzw. SSRQ-ID am Namen geht vor der Schreibung, ohne Treffer die Form", () => {
	const persons = [
		{ id: 21109, forms: [], gnd: "143681346", ssrq: "per002157" },
		{ id: 3, forms: ["R. Meier"] },
		{ id: 4, forms: [], gnd: null },
		{ id: -1, forms: [], gnd: "1089440073", ssrq: null },
	];
	const byRef = buildRefIndex(persons);
	const byForm = buildMentionIndex(persons);
	assert.deepEqual([...byRef], [["143681346", [21109]], ["per002157", [21109]], ["1089440073", [-1]]]);
	// Ratsmanuale: «Holtzhalb» trägt die GND, die Schreibung zählt nicht.
	assert.deepEqual(mentionIds({ gnd: "143681346", text: "Holtz halb" }, byRef, byForm), [21109]);
	// Unlesbare GND in Transkribus: die SSRQ-ID trägt.
	assert.deepEqual(mentionIds({ ssrq: "per002157", text: "Holtzhalb" }, byRef, byForm), [21109]);
	assert.deepEqual(mentionIds({ gnd: "1089440073", text: "Statthalter Ott" }, byRef, byForm), [-1]);
	// GND, die niemand kennt: wie ein Name ohne GND.
	assert.equal(mentionIds({ gnd: "119100142", text: "Holtzhalb" }, byRef, byForm), undefined);
	assert.deepEqual(mentionIds({ gnd: "119100142", text: "R. Meier." }, byRef, byForm), [3]);
	// Kantonsrat: kein data-gnd, Zuordnung über die Form.
	assert.deepEqual(mentionIds({ text: "R.  Meier" }, byRef, byForm), [3]);
});

const viewport = { width: 1280, height: 800 };

test("placeCard: unter dem Namen, bündig links", () => {
	const p = placeCard({ top: 100, bottom: 120, left: 300 }, viewport, 320);
	assert.deepEqual(p, { left: 300, top: 120 + CARD_GAP, maxHeight: 800 - 120 - CARD_GAP - CARD_MARGIN });
});

test("placeCard: über dem Namen, wenn unten zu wenig Platz ist", () => {
	const p = placeCard({ top: 700, bottom: 720, left: 300 }, viewport, 320);
	assert.ok("bottom" in p);
	if ("bottom" in p) {
		assert.equal(p.bottom, 800 - 700 + CARD_GAP);
		assert.equal(p.maxHeight, 700 - CARD_GAP - CARD_MARGIN);
	}
});

test("placeCard: unten bleibt, solange dort mehr Platz ist als oben", () => {
	const short = { width: 1280, height: 400 };
	const p = placeCard({ top: 150, bottom: 170, left: 10 }, short, 320);
	assert.ok("top" in p, "unten 216 px, oben 136 px ⇒ unten");
});

test("placeCard: am rechten und linken Rand geklemmt", () => {
	const right = placeCard({ top: 100, bottom: 120, left: 1200 }, viewport, 320);
	assert.equal(right.left, 1280 - 320 - CARD_MARGIN);
	const left = placeCard({ top: 100, bottom: 120, left: -40 }, viewport, 320);
	assert.equal(left.left, CARD_MARGIN);
});

test("placeCard: schmaler Viewport (375 px) ⇒ Karte füllt die Breite minus Rand", () => {
	const phone = { width: 375, height: 812 };
	const p = placeCard({ top: 200, bottom: 222, left: 180 }, phone, 320);
	// Karte ist 320 px breit und passt ab x = 47; rechts bleiben 8 px Rand.
	assert.equal(p.left, 375 - 320 - CARD_MARGIN);
	const tiny = placeCard({ top: 200, bottom: 222, left: 180 }, { width: 300, height: 600 }, 320);
	assert.equal(tiny.left, CARD_MARGIN, "Karte = Viewport − 2 × Rand ⇒ linksbündig am Rand");
});
