/**
 * Unit-Tests für das Chunk-Alignment (node:test, Repo-Muster wie
 * services/indexer/src/parser.test.ts). Lauf:
 *   npx tsx --test src/lib/server/chunkAlign.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanWithMap, alignChunk } from "./chunkAlign";

// Referenz-Implementierung der deployten Cleaning-Kette (NUR generic_text_
// cleaning – ohne Offset-Map), um cleanWithMap.text gegenzuprüfen.
function referenceClean(d: string): string {
	d = d.trim();
	d = d.replace(
		/(\x04|\x1a|\xa0|\x00|\ue83a|\x19|\uf06c|\x10|\x17|\x13|\x11|<space>|\x16|\x18|\x1b|\x15|\t\x08|\f)/g,
		" ",
	);
	d = d.replace(/[;«»„“:()\[\]]/g, " ");
	d = d.replace(/\.{2,}/g, " ");
	d = d.replace(/(?<=\s)(I.|II.|III.|IV.|V.|VI.|VII.|VIII.|IX.|X.|XI.|XII.|XIII.|XIV.|XV.)(?=\s)/g, " ");
	d = d.replace(/&/g, " und ");
	d = d.replace(/§/g, " Paragraph ");
	d = d.replace(/=/g, " gleich ");
	d = d.replace(/\s+/g, " ");
	d = d.trim();
	return d;
}

const SAMPLES = [
	"Der Kantonsrat beschloss am 3. Mai 1920, dass die Vorlage mit 98 zu 12 Stimmen angenommen wird.",
	"A & B; «Zitat» (Klammer) §5 = 3 .... II. Teil mit\xa0NBSP und 51 Millionen Franken!!",
	"Vogelschutz 1923: Die Kommission [vgl. Protokoll] empfahl, 200 Nistkästen zu beschaffen.",
];

test("cleanWithMap.text entspricht der Referenz-Kette", () => {
	for (const s of SAMPLES) {
		assert.equal(cleanWithMap(s).text, referenceClean(s));
	}
});

test("cleanWithMap: Ziffern bleiben erhalten (deployter Stand ohne semantic_cleaning)", () => {
	const m = cleanWithMap(SAMPLES[0]);
	assert.match(m.text, /1920/);
	assert.match(m.text, /98 zu 12/);
});

test("cleanWithMap: Offsets zeigen auf Original-Positionen", () => {
	const original = "Im Jahr 1920 wurden 200 Nistkästen (für den Vogelschutz) beschafft.";
	const m = cleanWithMap(original);
	// Jedes gemappte Zeichen, das kein Ersatz ist, muss im Original an der
	// gemappten Stelle stehen.
	for (let i = 0; i < m.text.length; i++) {
		const ch = m.text[i];
		if (ch === " ") continue; // Ersatz-/Kollaps-Zeichen
		assert.equal(original[m.at(i)], ch, `Zeichen ${i} (${ch})`);
	}
});

// Gegenprobe: dieselbe Kette mit einem Offset je Zeichen.
function naiveMap(s: string): { text: string; orig: number[] } {
	const chain: [RegExp, string][] = [
		[/(\x04|\x1a|\xa0|\x00|\ue83a|\x19|\uf06c|\x10|\x17|\x13|\x11|<space>|\x16|\x18|\x1b|\x15|\t\x08|\f)/g, " "],
		[/[;«»„“:()\[\]]/g, " "],
		[/\.{2,}/g, " "],
		[/(?<=\s)(I.|II.|III.|IV.|V.|VI.|VII.|VIII.|IX.|X.|XI.|XII.|XIII.|XIV.|XV.)(?=\s)/g, " "],
		[/&/g, " und "],
		[/§/g, " Paragraph "],
		[/=/g, " gleich "],
		[/ß/g, "ss"],
		[/ẞ/g, "SS"],
		[/\s+/g, " "],
	];
	const trim = (cs: { ch: string; o: number }[]) => {
		const start = cs.findIndex((c) => c.ch.trim() !== "");
		return start < 0 ? [] : cs.slice(start, cs.findLastIndex((c) => c.ch.trim() !== "") + 1);
	};
	let chars = trim(s.split("").map((ch, o) => ({ ch, o })));
	for (const [re, by] of chain) {
		const text = chars.map((c) => c.ch).join("");
		const next: typeof chars = [];
		let last = 0;
		for (const m of text.matchAll(re)) {
			next.push(...chars.slice(last, m.index), ...by.split("").map((ch) => ({ ch, o: chars[m.index].o })));
			last = m.index + m[0].length;
		}
		chars = [...next, ...chars.slice(last)];
	}
	chars = trim(chars);
	return { text: chars.map((c) => c.ch).join(""), orig: chars.map((c) => c.o) };
}

test("cleanWithMap: Offsets wie Zeichen für Zeichen gerechnet (Zufallstexte)", () => {
	const parts = ["a", "ä", "ß", "ẞ", " ", "  ", "\n", "\t", "\t\x08", "\xa0", "\f", ";", "«", "(", ".", "..", "&", "§", "=", "<space>", "I", " II. ", " XIV. "];
	let seed = 7;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	for (let round = 0; round < 1500; round++) {
		const s = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => parts[Math.floor(rnd() * parts.length)]).join("");
		const want = naiveMap(s);
		const got = cleanWithMap(s);
		assert.equal(got.text, want.text, JSON.stringify(s));
		for (let i = 0; i < want.orig.length; i++) assert.equal(got.at(i), want.orig[i], `${JSON.stringify(s)} Zeichen ${i}`);
	}
});

test("alignChunk: Original-Interpunktion wird wiederhergestellt", () => {
	const body =
		"Der Regierungsrat behandelte die Vorlage über den Naturschutz im Kanton. " +
		"Im Jahr 1923 empfahl die Kommission («Naturschutzkommission»), 200 Nistkästen für den " +
		"Vogelschutz zu beschaffen und dafür 5000 Franken [aus dem Fonds] zu bewilligen. " +
		"Die Vorlage wurde mit 98 zu 12 Stimmen angenommen. " +
		"Der Beschluss trat am 1. Januar 1924 in Kraft und galt für die folgenden 10 Jahre.";
	// Chunk = gecleante Fassung eines Body-Ausschnitts (wie ihn die Pipeline erzeugt hätte)
	const chunkText = referenceClean(
		"Im Jahr 1923 empfahl die Kommission («Naturschutzkommission»), 200 Nistkästen für den " +
			"Vogelschutz zu beschaffen und dafür 5000 Franken [aus dem Fonds] zu bewilligen. " +
			"Die Vorlage wurde mit 98 zu 12 Stimmen angenommen.",
	);
	const aligned = alignChunk(body, chunkText);
	assert.ok(aligned, "Alignment muss gelingen");
	// Original-Zeichen, die das Cleaning entfernt hatte, sind zurück:
	assert.match(aligned.text, /«Naturschutzkommission»/);
	assert.match(aligned.text, /\[aus dem Fonds\]/);
	assert.match(aligned.text, /98 zu 12/);
});

test("alignChunk: Titel-Präfix (erster Chunk) stört den Anker nicht", () => {
	const body =
		"Die Direktion der öffentlichen Bauten berichtet über den Stand der Arbeiten am Seeufer. " +
		"Für die Ufersicherung wurden 1921 insgesamt 12000 Franken aufgewendet, wovon 4000 Franken " +
		"auf die Gemeinde entfielen. Die restlichen Mittel stammen aus dem kantonalen Fonds.";
	// Erster Chunk beginnt mit dem (gecleanten) Titel, der im Body fehlt:
	const chunkText = referenceClean(
		"Bericht über die Ufersicherung am Seeufer " + // Titel-Präfix
			"Die Direktion der öffentlichen Bauten berichtet über den Stand der Arbeiten am Seeufer. " +
			"Für die Ufersicherung wurden 1921 insgesamt 12000 Franken aufgewendet, wovon 4000 Franken " +
			"auf die Gemeinde entfielen.",
	);
	const aligned = alignChunk(body, chunkText);
	assert.ok(aligned, "Alignment muss trotz Titel-Präfix gelingen");
	assert.match(aligned.text, /12000 Franken|1921/);
});

test("alignChunk: & / § / = Ersetzungen", () => {
	const body =
		"Müller & Cie. beantragten gemäss §14, dass der Beitrag = 300 Franken festgesetzt wird, " +
		"was die Kommission nach eingehender Beratung der Vorlage auch tatsächlich so genehmigte.";
	const chunkText = referenceClean(body);
	const aligned = alignChunk(body, chunkText);
	assert.ok(aligned, "Alignment muss gelingen");
	assert.match(aligned.text, /§14|& Cie/);
});

test("alignChunk: kein Match → null (Fallback chunkText)", () => {
	const body = "Ein völlig anderer Text ohne jede Überschneidung mit dem gesuchten Inhalt des Chunks hier.";
	const chunkText =
		"die Kommission empfahl 200 Nistkästen für den Vogelschutz zu beschaffen und 5000 Franken zu bewilligen die Vorlage wurde angenommen";
	assert.equal(alignChunk(body, chunkText), null);
});

test("alignChunk: zu kurzer Chunk → null", () => {
	assert.equal(alignChunk("Etwas Text im Body.", "kurz"), null);
});

test("alignChunk: Body mit ss (Suchtext seit 2026-11-17), Chunk mit ß", () => {
	const original = "Der Regierungsrat beschliesst, daß die Straße nach Baden auf Kosten des Staates ausgebaut werde, und daß die Gemeinden beitragen.";
	const folded = original.replace(/ß/g, "ss");
	const chunk = "daß die Straße nach Baden auf Kosten des Staates ausgebaut werde, und daß die Gemeinden";
	const a = alignChunk(folded, chunk);
	assert.ok(a, "Anker gefunden");
	assert.ok(a.text.includes("dass die Strasse nach Baden"));
	// ungefalteter Body (Übergang) bleibt abgleichbar
	assert.ok(alignChunk(original, chunk));
});
