import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { krdbFieldsFor, loadKrdbMatcher, requireKrdb, sameIds } from "./krdbFields.ts";
import type { KrdbRegister } from "./krdb/krdbMatch.ts";

const register = JSON.parse(
  readFileSync(new URL("./krdb/krdb-register.json", import.meta.url), "utf-8"),
) as KrdbRegister;
const idOf = (first: string, last: string): number => {
  const p = register.persons.find((x) => x.first === first && x.last === last);
  assert.ok(p, `${first} ${last} fehlt im Register`);
  return p.id;
};

test("Register der Kopie ist ladbar und nicht leer", () => {
  const m = loadKrdbMatcher();
  assert.equal(m.persons, register.persons.length);
  assert.ok(m.persons > 4500);
  assert.equal(requireKrdb("test").persons, m.persons);
});

test("krdbFieldsFor: erkannte Personen am echten Register, Titel-Teilmenge", () => {
  const sulser = idOf("Jürg", "Sulser");
  const lenggenhager = idOf("Marcel", "Lenggenhager");
  const doc = {
    series: "KRP" as const,
    date: "2018-09-24",
    title: "Interpellation Marcel Lenggenhager (BDP, Gossau) betreffend Verkehr",
    body: "Marcel Lenggenhager (BDP, Gossau): Ich begründe. Ratspräsident Jürg Sulser: Das Wort hat der Regierungsrat.",
    persons: ["Marcel Lenggenhager", "Jürg Sulser"],
  };
  assert.deepEqual(krdbFieldsFor(doc), {
    krdbIds: [sulser, lenggenhager].sort((a, b) => a - b),
    krdbTitleIds: [lenggenhager],
  });
  // Ohne erkannte Personen keine Zuordnung – auch wenn die Namen im Text stehen.
  assert.deepEqual(krdbFieldsFor({ ...doc, persons: [] }), { krdbIds: [], krdbTitleIds: [] });
});

test("krdbFieldsFor: Amtszeit am Datum entscheidet, ohne Treffer leere Listen", () => {
  // Sulser sitzt ab 2015 im Kantonsrat – 2010 ist «Jürg Sulser» kein Mitglied.
  const early = krdbFieldsFor({
    series: "KRP",
    date: "2010-06-14",
    title: "Mitteilungen",
    body: "Ratspräsident Jürg Sulser: Wünschen Sie das Wort?",
    persons: ["Jürg Sulser"],
  });
  assert.deepEqual(early, { krdbIds: [], krdbTitleIds: [] });
  // Ohne Datum kein Abgleich.
  assert.deepEqual(
    krdbFieldsFor({ series: "KRP", date: null, title: "", body: "Jürg Sulser", persons: ["Jürg Sulser"] }),
    { krdbIds: [], krdbTitleIds: [] },
  );
});

test("krdbFieldsFor: andere Serien bekommen keine Felder", () => {
  for (const series of ["ABl", "OS", "RRB"] as const) {
    assert.equal(
      krdbFieldsFor({ series, date: "2018-09-24", title: "Jürg Sulser", body: "Jürg Sulser", persons: ["Jürg Sulser"] }),
      null,
    );
  }
});

test("sameIds: fehlendes Feld = leere Liste, sonst exakt", () => {
  assert.ok(sameIds(undefined, []));
  assert.ok(sameIds(null, []));
  assert.ok(sameIds([], []));
  assert.ok(sameIds([1, 5], [1, 5]));
  assert.ok(!sameIds([1, 5], [1]));
  assert.ok(!sameIds(undefined, [3]));
  assert.ok(!sameIds([1, 5], [1, 6]));
});
