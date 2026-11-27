import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fuzzyBranches, splitTiers, tierPlan } from "./tiers";

test("tierPlan: freie Wörter zitiert, Phrasen und Ausschlüsse unverändert", () => {
	assert.deepEqual(tierPlan("Polizei Zürich"), { exactQ: '"Polizei" "Zürich"', words: ["Polizei", "Zürich"] });
	assert.deepEqual(tierPlan('"Mario Fehr" Velo -Auto'), { exactQ: '"Mario Fehr" "Velo" -Auto', words: ["Velo"] });
	assert.deepEqual(tierPlan("Pause"), { exactQ: '"Pause"', words: ["Pause"] });
});

test("tierPlan: Wörter mit Trennzeichen wie Meili in Teile", () => {
	assert.deepEqual(tierPlan("Zürich-Oerlikon"), { exactQ: '"Zürich" "Oerlikon"', words: ["Zürich", "Oerlikon"] });
	assert.deepEqual(tierPlan("Art. 5"), { exactQ: '"Art" "5"', words: ["Art", "5"] });
});

test("tierPlan: zusammengesetzte Zeichen trennen kein Wort (zerlegte Umlaute, uͤ, Nasalstrich, ¬)", () => {
	assert.deepEqual(tierPlan("Ku\u0308snacht Schulhaus"), { exactQ: '"Küsnacht" "Schulhaus"', words: ["Küsnacht", "Schulhaus"] });
	assert.deepEqual(tierPlan("uͤbergab"), { exactQ: '"uͤbergab"', words: ["uͤbergab"] });
	assert.deepEqual(tierPlan("kom̅en"), { exactQ: '"kommen"', words: ["kommen"] });
	assert.deepEqual(tierPlan("Burger¬ meister"), { exactQ: '"Burgermeister"', words: ["Burgermeister"] });
});

test("tierPlan: null ohne freies Wort oder bei offener Phrase", () => {
	assert.equal(tierPlan(""), null);
	assert.equal(tierPlan('"Mario Fehr"'), null);
	assert.equal(tierPlan("-Auto"), null);
	assert.equal(tierPlan('Polizei "Zürich'), null);
	assert.equal(tierPlan("- ,"), null);
});

test("tierPlan: doppelte Wörter nur einmal als Zweig", () => {
	assert.deepEqual(tierPlan("Rat Rat")?.words, ["Rat"]);
});

test("fuzzyBranches: je Wort ein Ausschluss", () => {
	assert.deepEqual(fuzzyBranches({ exactQ: "", words: ["Polizei", "Zürich"] }), ["-Polizei", "-Zürich"]);
});

test("splitTiers: Seite ganz in A, ganz in B, über die Grenze", () => {
	assert.deepEqual(splitTiers(0, 20, 50), { a: { offset: 0, limit: 20 }, b: null });
	assert.deepEqual(splitTiers(60, 20, 50), { a: null, b: { offset: 10, limit: 20 } });
	assert.deepEqual(splitTiers(40, 20, 50), { a: { offset: 40, limit: 10 }, b: { offset: 0, limit: 10 } });
	assert.deepEqual(splitTiers(0, 20, 0), { a: null, b: { offset: 0, limit: 20 } });
	assert.deepEqual(splitTiers(30, 20, 50), { a: { offset: 30, limit: 20 }, b: null });
	assert.deepEqual(splitTiers(50, 20, 50), { a: null, b: { offset: 0, limit: 20 } });
	assert.deepEqual(splitTiers(0, 0, 50), { a: null, b: null });
});
