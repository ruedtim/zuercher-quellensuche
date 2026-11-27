// Lauf: npx tsx --test src/lib/server/catalogFieldSearch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { markFieldTerms, resolveFieldSet, type FieldSetDeps } from "./catalogFieldSearch";

/** Attrappe: jeder Kandidat ist eine ID-Menge; protokolliert die Abfragen. */
function fake(sets: number[][]): FieldSetDeps & { log: string[] } {
	const log: string[] = [];
	return {
		log,
		async counts() {
			log.push("counts");
			return sets.map((s) => s.length);
		},
		async ids(i, within, limit) {
			log.push(`ids ${i}${within ? ` in ${within.length}` : ""} limit ${limit}`);
			const inside = within ? new Set(within) : null;
			return sets[i].filter((id) => !inside || inside.has(id)).slice(0, limit);
		},
	};
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

test("resolveFieldSet: ein Kandidat allein ohne Zählen und ohne IDs", async () => {
	const deps = fake([range(0, 50_000)]);
	assert.deepEqual(await resolveFieldSet(1, null, 10_000, deps), { main: 0, ids: null, tooBroad: false });
	assert.deepEqual(deps.log, []);
});

test("resolveFieldSet: Schnitt der übrigen, kleinste zuerst, die grösste bleibt die Abfrage", async () => {
	// Signatur «C II» (4'917), Titel «Rüti» (1'931), Inhalt «Kauf» (sehr gross).
	const sig = range(0, 4_917);
	const title = range(4_000, 5_931);
	const text = range(0, 120_000);
	const deps = fake([sig, title, text]);
	const set = await resolveFieldSet(3, null, 10_000, deps);
	assert.equal(set.main, 2);
	assert.equal(set.tooBroad, false);
	assert.deepEqual(set.ids, range(4_000, 4_917));
	// Die grösste wird nie als IDs geholt; die zweite nur innerhalb der ersten.
	assert.deepEqual(deps.log, ["counts", "ids 1 limit 10000", "ids 0 in 1931 limit 1931"]);
});

test("resolveFieldSet: Suchbegriff bleibt die Abfrage; ist alles andere zu gross, beginnt die Kette mit ihm", async () => {
	const q = range(100, 312);
	const sig = range(0, 132_498);
	const deps = fake([q, sig]);
	const set = await resolveFieldSet(2, 0, 10_000, deps);
	assert.equal(set.main, 0);
	assert.deepEqual(set.ids, q);
	assert.deepEqual(deps.log, ["counts", "ids 0 limit 10000", "ids 1 in 212 limit 212"]);
});

test("resolveFieldSet: leere Bedingung ⇒ keine Treffer ohne IDs-Abfrage; zu breit ⇒ Hinweis", async () => {
	const empty = fake([range(0, 30_000), []]);
	assert.deepEqual(await resolveFieldSet(2, null, 10_000, empty), { main: 0, ids: [], tooBroad: false });
	assert.deepEqual(empty.log, ["counts"]);
	const broad = fake([range(0, 30_000), range(0, 20_000)]);
	assert.deepEqual(await resolveFieldSet(2, null, 10_000, broad), { main: 0, ids: [], tooBroad: true });
	assert.deepEqual(broad.log, ["counts"]);
});

test("resolveFieldSet: leerer Zwischenschnitt bricht die Kette ab", async () => {
	const deps = fake([range(0, 10), range(100, 110), range(0, 200_000), range(0, 500)]);
	const set = await resolveFieldSet(4, null, 10_000, deps);
	assert.deepEqual(set.ids, []);
	assert.equal(set.main, 2);
	assert.deepEqual(deps.log, ["counts", "ids 0 limit 10000", "ids 1 in 10 limit 10"]);
});

test("markFieldTerms: Titel und Auszug nachmarkieren, Auszug auf Wunsch um die Fundstelle", () => {
	const text = `${"Wort ".repeat(60)}Kauf des Zehnten zu Rüti ${"Ende ".repeat(60)}`.trim();
	const hits = [
		{
			id: 1,
			title: "Kauf der Mühle",
			text,
			_formatted: { title: 'Kauf der <mark class="match">Mühle</mark>', text: "Wort Wort …" },
		},
	];
	const [kept] = markFieldTerms(hits, { title: ["Kauf"], text: ["Zehnten"] }, { recrop: false, cropLength: 10 });
	assert.equal(kept._formatted?.title, '<mark class="match">Kauf</mark> der <mark class="match">Mühle</mark>');
	// Ohne Neuschnitt bleibt Meilis Auszug (ohne das Wort).
	assert.equal(kept._formatted?.text, "Wort Wort …");
	const [recropped] = markFieldTerms(hits, { title: [], text: ["Zehnten"] }, { recrop: true, cropLength: 10 });
	assert.match(recropped._formatted?.text ?? "", /<mark class="match">Zehnten<\/mark>/);
	assert.equal(recropped._formatted?.title, hits[0]._formatted.title);
	// Ohne Wörter unverändert.
	assert.equal(markFieldTerms(hits, { title: [], text: [] }, { recrop: true, cropLength: 10 }), hits);
});
