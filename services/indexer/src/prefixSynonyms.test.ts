import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  addMeiliWords,
  ENDINGS,
  MEILI_PREFIX_CAP,
  normalizeMeiliWord,
  prefixGapSynonyms,
  synonymDiff,
  synonymsUnchanged,
  toSynonymSetting,
} from "./prefixSynonyms.ts";

function words(text: string, minLength = 1): string[] {
  const vocab = new Set<string>();
  addMeiliWords(text, vocab, minLength);
  return [...vocab].sort();
}

test("addMeiliWords: Tokens wie charabia 0.9 (Testsatz aus dessen Latin-Segmenter, ohne camelCase)", () => {
  const text =
    "The quick (\"brown\") fox can’t jump 32.3 feet, right? Brr, it's 29.3°F! camelCase kebab-case snake_case 123 456";
  const expected = [
    "the", "quick", "brown", "fox", "can", "t", "jump", "32", "3", "feet", "right", "brr", "it", "s",
    "29", "3°f", "camelcase", "kebab", "case", "snake", "123", "456",
  ];
  assert.deepEqual(words(text), [...new Set(expected)].sort());
});

test("normalizeMeiliWord: klein, ohne Diakritika, NFKD, æ/œ, ß bleibt", () => {
  assert.equal(normalizeMeiliWord("Gemeinderäthe"), "gemeinderathe");
  assert.equal(normalizeMeiliWord("HÄUSER"), "hauser");
  assert.equal(normalizeMeiliWord("Straße"), "straße");
  assert.equal(normalizeMeiliWord("STRAẞE"), "straße");
  assert.equal(normalizeMeiliWord("Œuvre"), "oeuvre");
  assert.equal(normalizeMeiliWord("Cæsar"), "caesar");
  assert.equal(normalizeMeiliWord("ﬁnanz"), "finanz");
  assert.equal(normalizeMeiliWord("Zürich"), "zurich");
  // Weiches Trennzeichen (Cf) ist weder Trennzeichen noch Steuerzeichen: bleibt im Wort.
  assert.equal(normalizeMeiliWord("Ge­meinde"), "ge­meinde");
});

test("addMeiliWords: trennt an Bindestrich, §, ¬, Apostroph; nur ab minLength", () => {
  assert.deepEqual(words("Zürich-Oerlikon, § 12 Ge¬meinde l'Etat"), ["12", "etat", "ge", "l", "meinde", "oerlikon", "zurich"]);
  assert.deepEqual(words("Die Gemeinden des Kantons beschliessen", 5), ["beschliessen", "gemeinden", "kantons"]);
  const vocab = new Set<string>();
  addMeiliWords("", vocab);
  assert.equal(vocab.size, 0);
});

/** Wortschatz: Stamm, `n` Zusammensetzungen «<stamm>a0000…», die vor «<stamm>n» stehen, dazu Formen. */
function vocabWith(stem: string, n: number, forms: string[]): string[] {
  const out = [stem, ...forms];
  for (let i = 0; i < n; i++) out.push(`${stem}a${String(i).padStart(4, "0")}`);
  return [...new Set(out)].sort();
}

test("prefixGapSynonyms: Formen hinter der 1'000er-Grenze (wie Meili 1.57: «gemeinde» fand «gemeinden» nicht)", () => {
  const sorted = vocabWith("gemeinde", 1_200, ["gemeinden", "gemeindes", "gemeinderat"]);
  const gaps = prefixGapSynonyms(sorted);
  assert.deepEqual(gaps, [{ stem: "gemeinde", forms: ["gemeinden", "gemeindes"], extensions: 1_203 }]);
  assert.deepEqual(toSynonymSetting(gaps), { gemeinde: ["gemeinden", "gemeindes"] });
});

test("prefixGapSynonyms: Rang genau an der Grenze, mit und ohne Sicherheitsabstand", () => {
  // cap 10: Meili ergänzt die Ränge 0–9. «abcden» steht hinter n Zusammensetzungen → Rang n.
  const at = (n: number, margin: number) =>
    prefixGapSynonyms(vocabWith("abcde", n, ["abcden"]), { cap: 10, margin }).map((g) => g.forms);
  assert.deepEqual(at(10, 0), [["abcden"]]);
  assert.deepEqual(at(9, 0), []);
  assert.deepEqual(at(9, 1), [["abcden"]]);
  assert.deepEqual(at(8, 1), []);
  // Default: Rang ab 900 von 1'000.
  assert.equal(prefixGapSynonyms(vocabWith("gemeinde", 900, ["gemeinden"])).length, 1);
  assert.equal(prefixGapSynonyms(vocabWith("gemeinde", 899, ["gemeinden"])).length, 0);
  assert.equal(MEILI_PREFIX_CAP, 1_000);
});

test("prefixGapSynonyms: nur vorhandene Formen, nur Stämme ab 5 Zeichen", () => {
  // «steuer» mit 1'200 Zusammensetzungen, aber ohne Beugungsform im Wortschatz.
  assert.deepEqual(prefixGapSynonyms(vocabWith("steuer", 1_200, [])), []);
  // Vierbuchstabiger Stamm: läuft in Meili über die vollständige Prefix-Datenbank.
  assert.deepEqual(prefixGapSynonyms(vocabWith("bach", 1_200, ["bache", "bachen"])), []);
  // Zusammensetzungen nach der Form zählen nicht: «kantons» steht hinter 1'200 «kantona…»,
  // «kantone» ebenso; die 1'200 «kantonz…» dahinter ändern nichts.
  const sorted = [
    ...vocabWith("kanton", 1_200, ["kantons", "kantone"]),
    ...Array.from({ length: 1_200 }, (_, i) => `kantonz${String(i).padStart(4, "0")}`),
  ].sort();
  assert.deepEqual(
    prefixGapSynonyms(sorted).map((g) => [g.stem, g.forms, g.extensions]),
    [["kanton", ["kantone", "kantons"], 2_402]],
  );
});

test("prefixGapSynonyms: Formen VOR den Zusammensetzungen liegen vorn und brauchen kein Synonym", () => {
  // «abcdee» und «abcden» stehen vor allen 1'200 «abcdez…»: Rang 0 und 1.
  const sorted = [
    "abcde",
    "abcdee",
    "abcden",
    ...Array.from({ length: 1_200 }, (_, i) => `abcdez${String(i).padStart(4, "0")}`),
  ].sort();
  assert.deepEqual(prefixGapSynonyms(sorted), []);
});

test("prefixGapSynonyms: alle Endungen der Liste, Formen sortiert", () => {
  assert.ok(ENDINGS.includes("en") && ENDINGS.includes("s") && ENDINGS.includes("e"));
  const forms = ENDINGS.map((e) => `abcde${e}`);
  const gaps = prefixGapSynonyms(vocabWith("abcde", 1_200, forms));
  assert.deepEqual(gaps[0]?.forms, [...forms].sort());
});

test("synonymDiff: neu, entfernt, geändert, gleich (Formen ohne Reihenfolge)", () => {
  const cur = { gemeinde: ["gemeindes", "gemeinden"], steuer: ["steuern"], alt: ["alte"] };
  const next = { gemeinde: ["gemeinden", "gemeindes"], steuer: ["steuern", "steuers"], schul: ["schule"] };
  const d = synonymDiff(cur, next);
  assert.deepEqual(d, { added: 1, removed: 1, changed: 1, unchanged: 1 });
  assert.equal(synonymsUnchanged(d), false);
  assert.equal(synonymsUnchanged(synonymDiff(next, { ...next })), true);
  assert.equal(synonymsUnchanged(synonymDiff({}, {})), true);
});
