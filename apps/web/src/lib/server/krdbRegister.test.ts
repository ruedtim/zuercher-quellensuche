// Lauf: npx tsx --test src/lib/server/krdbRegister.test.ts
// Prüft das committete Register (data/krdb-register.json, gebaut von
// services/krdb) und friert echte Referenzfälle ein. Schlägt ein Fall nach
// einem Register-Refresh fehl, hat sich die KRDB (z. B. neu nummerierte IDs)
// oder Wikidata geändert – erst prüfen, dann den Fall nachführen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildKrdbIndex, matchKrdbPersons, portraitKey, type KrdbRegister } from "./krdbMatch";

const register = JSON.parse(
	readFileSync(new URL("./data/krdb-register.json", import.meta.url), "utf-8"),
) as KrdbRegister;
const index = buildKrdbIndex(register);
const ids = (persons: string[], date: string, extra: { title?: string; body?: string } = {}) =>
	matchKrdbPersons(index, { persons, date, ...extra }).map((m) => m.person.id);

test("Register: Schema, Zähler, eindeutige und sortierte IDs", () => {
	const { meta, persons } = register;
	assert.equal(persons.length, meta.persons);
	assert.ok(meta.persons >= 4500, "KRDB hat über 4500 Personen");
	assert.equal(persons.reduce((n, p) => n + p.seats.length, 0), meta.seats);
	for (let i = 1; i < persons.length; i++) assert.ok(persons[i - 1].id < persons[i].id, `IDs sortiert/eindeutig bei ${persons[i].id}`);
	assert.equal(persons.filter((p) => p.qid).length, meta.withQid);
	assert.equal(persons.filter((p) => p.img).length, meta.withImage);
});

test.skip("Register: Z-1114-Porträts als statische Datei mit Katalog-Link und Signatur", () => {
	const z = register.persons.filter((p) => p.img?.source === "z1114");
	assert.equal(z.length, register.meta.withZ1114 ?? 0);
	const files = new Set<string>();
	for (const p of z) {
		const img = p.img!;
		assert.match(img.thumb, /^\/portraits\/z1114\/Z_1114_[0-9_]+\.webp$/, `Pfad bei ${p.id}`);
		assert.ok(existsSync(new URL(`../../../static${img.thumb}`, import.meta.url)), `Datei fehlt: ${img.thumb}`);
		assert.ok(!files.has(img.thumb), `Datei doppelt vergeben: ${img.thumb}`);
		files.add(img.thumb);
		assert.match(img.page, /^https:\/\/suche\.staatsarchiv\.djiktzh\.ch\/detail\.aspx\?ID=\d+$/);
		assert.match(img.credit ?? "", /^Staatsarchiv Zürich, Z 1114\.\d+(\.\d+)+$/);
		assert.match(img.v ?? "", /^[0-9a-f]{8}$/);
		assert.ok(img.width > 0 && img.height > 0);
	}
});

test("Register: Commons-Porträts mit Proxy-Schlüssel, Wikimedia-Thumb, Dateiseite und Versions-Token", () => {
	let withoutQid = 0;
	for (const p of register.persons) {
		if (!p.img || p.img.source === "z1114") continue;
		if (!p.qid) withoutQid++;
		assert.match(portraitKey(p), /^(?:Q[1-9]\d*|K[1-9]\d*)$/, `Proxy-Schlüssel bei ${p.id}`);
		const host = new URL(p.img.thumb).hostname;
		assert.ok(host === "thumb.wikimedia.org" || host === "upload.wikimedia.org", `Thumb-Host ${host} bei ${p.id}`);
		assert.ok(!p.img.thumb.includes("utm_"), `Tracking-Parameter bei ${p.id}`);
		assert.match(p.img.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
		assert.match(p.img.v ?? "", /^[0-9a-f]{8}$/);
	}
	// P18 kommt immer über ein Item – ohne QID gibt es nur kuratierte Porträts.
	assert.ok(withoutQid <= (register.meta.withOverride ?? 0), `${withoutQid} Commons-Porträts ohne QID`);
});

test("Register: keine Geburtsjahre lebender Personen (jünger als 100 Jahre)", () => {
	const year = Number(register.meta.generatedAt.slice(0, 4));
	for (const p of register.persons) {
		if (!p.died && p.born) assert.ok(p.born <= year - 100, `Geburtsjahr einer lebenden Person bei ${p.id}`);
	}
});

test("Referenzfälle aus echten Protokollen", () => {
	// 1956: «Finanzdirektor R. Meier» = Regierungsrat Rudolf Meier.
	assert.deepEqual(ids(["R. Meier"], "1956-05-14"), [22818]);
	// «Walther» allein ist zu vornamen-ähnlich – der Titel «Walther - Dübendorf» entscheidet.
	assert.deepEqual(ids(["Walther"], "1956-05-14"), []);
	assert.deepEqual(
		ids(["Walther"], "1956-05-14", { title: "Motion Gustav Walther - Dübendorf vom 9. April 1956 über die Revision des Steuergesetzes" }),
		[21754],
	);
	// KRDB-Klammerform «Escher (v. Glas)» mit Initiale.
	assert.deepEqual(ids(["A. Escher"], "1870-01-17"), [22852]);
	assert.deepEqual(ids(["Neukomm"], "1870-01-17"), [13311]);
	// «Rüegg» ist häufig (≥ 12 Personen) ⇒ nackt keine Zuordnung, mit Vorname schon.
	assert.deepEqual(ids(["Ruegg"], "1835-01-26"), []);
	assert.deepEqual(ids(["Heinrich Ruegg"], "1835-01-26"), [22914]);
	// krp-late: volle Namen, Nur-Vornamen und Genitive bleiben liegen.
	// (Andreas Schlagmüller ist Protokollführer, kein Ratsmitglied.)
	assert.deepEqual(
		ids(["Beat Habegger", "Florian", "Florian Meier", "Jean-Philippes", "Thomas Wirth", "Wirth", "Andreas Schlagmüller"], "2025-09-29"),
		[23373, 23229, 23227],
	);
	assert.deepEqual(ids(["Emil Klöti"], "1920-01-01"), [22413]);
});
