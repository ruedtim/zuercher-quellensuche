import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planOverrides, readOverrides, type OverridePerson, type PortraitOverride } from "./overrides.ts";

const person = (id: number, last: string, extra: Partial<OverridePerson> = {}): OverridePerson => ({
  id,
  last,
  hasP18: false,
  hasZ1114: false,
  ...extra,
});
const entry = (id: number, name: string, file = `${name}.jpg`): PortraitOverride => ({ id, name, file, basis: "Test" });
const all = () => true;

test("Eintrag greift über die aktuelle ID, Z 1114 wird ersetzt und gemeldet", () => {
  const plan = planOverrides([person(1, "Meier"), person(2, "Frei", { hasZ1114: true })], [entry(1, "Hans Meier"), entry(2, "Anna Frei")], all);
  assert.deepEqual(
    plan.apply.map((a) => [a.personId, a.via, a.replacesZ1114]),
    [
      [1, "id", false],
      [2, "id", true],
    ],
  );
});

test("neu vergebene KRDB-ID: Eintrag greift über den Alias", () => {
  const plan = planOverrides([person(900, "Meier", { aliases: [100] })], [entry(100, "Hans Meier")], all);
  assert.deepEqual(plan.apply.map((a) => [a.personId, a.via]), [[900, "alias"]]);
});

test("P18 hat Vorrang ⇒ Eintrag überflüssig", () => {
  const plan = planOverrides([person(1, "Meier", { hasP18: true })], [entry(1, "Hans Meier")], all);
  assert.equal(plan.apply.length, 0);
  assert.deepEqual(plan.shadowed.map((s) => s.personId), [1]);
});

test("Nachname passt nicht ⇒ nicht angewandt (Akzente und Doppelnamen egal)", () => {
  const plan = planOverrides(
    [person(1, "Müller"), person(2, "Gehrig Schmidt"), person(3, "Fehr Düsel")],
    [entry(1, "Hans Meier"), entry(2, "Sonja Gehrig Schmidt"), entry(3, "Nina Fehr Dusel")],
    all,
  );
  assert.deepEqual(plan.nameMismatch.map((m) => m.personId), [1]);
  assert.deepEqual(plan.apply.map((a) => a.personId), [2, 3]);
});

test("Nachname nur als ganzes Wort (Rickli ≠ Ricklin)", () => {
  const plan = planOverrides([person(1, "Rickli")], [entry(1, "Hans Ricklin")], all);
  assert.equal(plan.nameMismatch.length, 1);
});

test("unbekannte ID, fehlende Datei, Dublette", () => {
  const plan = planOverrides(
    [person(1, "Meier"), person(2, "Frei")],
    [entry(7, "Otto Kunz"), entry(1, "Hans Meier", "weg.jpg"), entry(2, "Anna Frei"), entry(2, "Anna Frei", "b.jpg")],
    (f) => f !== "weg.jpg",
  );
  assert.deepEqual(plan.unknown.map((o) => o.id), [7]);
  assert.deepEqual(plan.noInfo.map((n) => n.personId), [1]);
  assert.deepEqual(plan.apply.map((a) => a.override.file), ["Anna Frei.jpg"]);
  assert.deepEqual(plan.duplicate.map((o) => o.file), ["b.jpg"]);
});

test("readOverrides: normalisiert Dateinamen, verlangt alle Felder, fehlende Datei = leer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "krdb-ov-"));
  const ok = join(dir, "ok.json");
  await writeFile(ok, JSON.stringify({ entries: [{ id: 5, name: "Hans Meier", file: "File:Hans_Meier.jpg", basis: "Test" }] }));
  assert.deepEqual(await readOverrides(ok), [{ id: 5, name: "Hans Meier", file: "Hans Meier.jpg", basis: "Test" }]);
  const bad = join(dir, "bad.json");
  await writeFile(bad, JSON.stringify({ entries: [{ id: 5, name: "Hans Meier", file: "x.jpg" }] }));
  await assert.rejects(readOverrides(bad), /Eintrag 1 unvollständig/);
  assert.deepEqual(await readOverrides(join(dir, "fehlt.json")), []);
});
