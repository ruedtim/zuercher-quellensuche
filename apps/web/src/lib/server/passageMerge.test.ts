import test from "node:test";
import assert from "node:assert/strict";
import { mergeLexicalPage, mergeLexicalSources } from "./passageMerge";

function src(id: string) {
	return { hit: { id } };
}
function ids(list: Array<{ hit: { id: string } }>): string[] {
	return list.map((s) => s.hit.id);
}

test("mergeLexicalSources: 1/3-Reserve bei topK 6 (4 semantisch + 2 lexikalisch)", () => {
	const sem = ["s1", "s2", "s3", "s4", "s5", "s6"].map(src);
	const lex = ["l1", "l2", "l3"].map(src);
	assert.deepEqual(ids(mergeLexicalSources(sem, lex, 6)), ["s1", "s2", "s3", "s4", "l1", "l2"]);
});

test("mergeLexicalSources: 1/3-Reserve bei topK 10 (7 semantisch + 3 lexikalisch)", () => {
	const sem = Array.from({ length: 10 }, (_, i) => src(`s${i + 1}`));
	const lex = Array.from({ length: 5 }, (_, i) => src(`l${i + 1}`));
	assert.deepEqual(
		ids(mergeLexicalSources(sem, lex, 10)),
		["s1", "s2", "s3", "s4", "s5", "s6", "s7", "l1", "l2", "l3"],
	);
});

test("mergeLexicalSources: Voll-Überschneidung ⇒ rein semantische Tranche", () => {
	const sem = ["a", "b", "c", "d", "e", "f"].map(src);
	const lex = ["c", "a", "f"].map(src);
	assert.deepEqual(ids(mergeLexicalSources(sem, lex, 6)), ["a", "b", "c", "d", "e", "f"]);
});

test("mergeLexicalSources: leere lexikalische Tranche ⇒ rein semantisch", () => {
	const sem = ["a", "b", "c"].map(src);
	assert.deepEqual(ids(mergeLexicalSources(sem, [], 6)), ["a", "b", "c"]);
});

test("mergeLexicalSources: dünnes Semantik-Set ⇒ lexikalisch füllt über die Reserve hinaus", () => {
	const sem = ["s1", "s2"].map(src);
	const lex = ["l1", "l2", "l3", "l4", "l5"].map(src);
	assert.deepEqual(ids(mergeLexicalSources(sem, lex, 6)), ["s1", "s2", "l1", "l2", "l3", "l4"]);
});

test("mergeLexicalSources: Überschneidung bleibt am semantischen Rang, frische Lex-Docs hinten", () => {
	const sem = ["s1", "l2", "s3", "s4", "s5", "s6"].map(src);
	const lex = ["l1", "l2", "l3"].map(src);
	// l2 ist schon semantisch platziert; frisch sind l1+l3 → 2 Reserve-Slots.
	assert.deepEqual(ids(mergeLexicalSources(sem, lex, 6)), ["s1", "l2", "s3", "s4", "l1", "l3"]);
});

test("mergeLexicalSources: Länge ≤ topK und keine Duplikate", () => {
	const sem = Array.from({ length: 12 }, (_, i) => src(`s${i + 1}`));
	const lex = Array.from({ length: 12 }, (_, i) => src(i % 2 === 0 ? `s${i + 1}` : `l${i + 1}`));
	const merged = mergeLexicalSources(sem, lex, 6);
	assert.equal(merged.length, 6);
	assert.equal(new Set(ids(merged)).size, 6);
});

test("mergeLexicalSources: beide Tranchen leer ⇒ leer", () => {
	assert.deepEqual(mergeLexicalSources([], [], 6), []);
});

test("mergeLexicalPage: Seite 1 (offset 0) ist unverändert mergeLexicalSources", () => {
	const sem = Array.from({ length: 20 }, (_, i) => src(`s${i + 1}`));
	const lex = Array.from({ length: 10 }, (_, i) => src(`l${i + 1}`));
	assert.deepEqual(ids(mergeLexicalPage(sem, lex, 0, 8)), ids(mergeLexicalSources(sem, lex, 8)));
});

test("mergeLexicalPage: Folgeseiten ohne Doppelte und ohne Lücke", () => {
	const sem = Array.from({ length: 40 }, (_, i) => src(`s${i + 1}`));
	const lex = Array.from({ length: 20 }, (_, i) => src(`l${i + 1}`));
	const topK = 8;
	const seen: string[] = [];
	for (let offset = 0; offset < 32; offset += topK) {
		const page = ids(mergeLexicalPage(sem, lex, offset, topK));
		assert.equal(page.length, topK, `Seite ab ${offset} ist voll`);
		seen.push(...page);
	}
	assert.equal(new Set(seen).size, seen.length, "keine Doppelten über die Seiten");
	// Lückenlos: die vier Seiten sind zusammen genau das Fenster 32 der gemischten
	// Liste. Die Reihenfolge ist eine andere – jede Seite trägt ihre eigene
	// lexikalische Reserve am Ende, statt sie wie das grosse Fenster zu bündeln.
	assert.deepEqual(new Set(seen), new Set(ids(mergeLexicalSources(sem, lex, 32))));
});

test("mergeLexicalPage: naives slice(offset) würde die lexikalische Reserve doppeln", () => {
	const sem = Array.from({ length: 20 }, (_, i) => src(`s${i + 1}`));
	const lex = Array.from({ length: 10 }, (_, i) => src(`l${i + 1}`));
	const seite1 = ids(mergeLexicalPage(sem, lex, 0, 8));
	const naiv = ids(mergeLexicalSources(sem, lex, 16)).slice(8);
	assert.ok(
		naiv.some((id) => seite1.includes(id)),
		"das naive Schneiden liefert schon gezeigte Treffer erneut",
	);
	assert.ok(
		!ids(mergeLexicalPage(sem, lex, 8, 8)).some((id) => seite1.includes(id)),
		"mergeLexicalPage nicht",
	);
});

test("mergeLexicalPage: hinter dem Ende der Listen leer", () => {
	const sem = ["s1", "s2", "s3"].map(src);
	const lex = ["l1"].map(src);
	assert.deepEqual(ids(mergeLexicalPage(sem, lex, 0, 8)), ["s1", "s2", "s3", "l1"]);
	assert.deepEqual(mergeLexicalPage(sem, lex, 8, 8), []);
});
