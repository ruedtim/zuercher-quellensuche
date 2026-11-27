// Lauf: npx tsx --test src/lib/quotedQuery.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { literalPhrase, phraseQuery, splitQuoted } from "./quotedQuery";

test("Wortfolgen in Anführungszeichen, der Rest gleich lang mit Lücken", () => {
	const text = 'Was tat der Rat gegen "die Pest" im "17. Jahrhundert"?';
	const q = splitQuoted(text)!;
	assert.deepEqual(q.phrases, ["die Pest", "17. Jahrhundert"]);
	assert.equal(q.outside.length, text.length);
	assert.equal(q.plain.length, text.length);
	assert.equal(q.outside.replace(/\s+/g, " "), "Was tat der Rat gegen im ?");
	assert.equal(q.plain.replace(/\s+/g, " "), "Was tat der Rat gegen die Pest im 17. Jahrhundert ?");
});

test("typografische Anführungszeichen wie gerade", () => {
	for (const text of ["“Pause”", "„Pause“", "«Pause»", "»Pause«", '"Pause"']) {
		assert.deepEqual(splitQuoted(text)?.phrases, ["Pause"], text);
	}
	assert.deepEqual(splitQuoted("«Escher  vom Glas» und „Hirzel“")?.phrases, ["Escher vom Glas", "Hirzel"]);
});

test("ohne, ungerade oder leer: keine Wortfolge", () => {
	assert.equal(splitQuoted("Massnahmen gegen die Tollwut"), null);
	assert.equal(splitQuoted('Escher "vom Glas'), null);
	assert.equal(splitQuoted('"a" "b'), null);
	assert.equal(splitQuoted('Pest "" Zürich'), null);
	assert.equal(splitQuoted('"  "'), null);
});

test("Suchbegriff aus Wortfolgen", () => {
	assert.equal(phraseQuery(["Pest", "Escher vom Glas"]), '"Pest" "Escher vom Glas"');
});

test("«wörtlich»: der ganze Text eine Wortfolge, alte Anführungszeichen fallen", () => {
	assert.equal(literalPhrase("  freiwillige   Feuerwehr "), '"freiwillige Feuerwehr"');
	assert.equal(literalPhrase('"Pest" in Zürich'), '"Pest in Zürich"');
	assert.equal(literalPhrase("«Escher vom Glas»"), '"Escher vom Glas"');
	assert.equal(literalPhrase('  ""  '), "");
});
