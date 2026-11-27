// Lauf: npx tsx --test src/lib/server/foldedSearch.test.ts
// Gefaltete Suchfelder: Schalter je Index, Rückfall bei einem 400, Formatierung am Original.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeiliSearchApiError } from "meilisearch";
import { createFoldSwitch, isFoldedFieldError, unfoldHit, withFolded } from "./foldedSearch";

const MARKS = { pre: '<mark class="match">', post: "</mark>" };

function apiError(status: number, code: string, message: string): MeiliSearchApiError {
	const cause = { message, code, type: "invalid_request", link: "" };
	return new MeiliSearchApiError({ status, statusText: "Bad Request", url: "" } as Response, cause);
}
const rejected = (field: string) =>
	apiError(400, "invalid_search_attributes_to_search_on", `Index \`catalog\`: Attribute \`${field}\` is not searchable. Available searchable attributes are: \`title\`.`);

test("withFolded: zu jedem Feld das gefaltete dahinter", () => {
	assert.deepEqual(withFolded(["title", "text"]), ["title", "titleSearch", "text", "textSearch"]);
	assert.deepEqual(withFolded([]), []);
});

const searched = async () => ({});

test("Schalter: an, sobald irgendein gefaltetes Feld im Index steht und durchsucht wird", async () => {
	const s = createFoldSwitch("test", ["title", "text"], searched);
	assert.equal(s.on, false);
	await s.update({ title: 10, text: 4 });
	assert.equal(s.on, false);
	await s.update({ title: 10, text: 4, textSearch: 2 });
	assert.equal(s.on, true);
	await s.update({ title: 10, titleSearch: 0, summarySearch: 5 });
	assert.equal(s.on, false, "nur Felder dieses Index, mindestens ein Dokument");
	await s.update({ title: 1, titleSearch: 1 });
	await s.update(null);
	assert.equal(s.on, false, "nicht lesbar");
});

test("Schalter: Felder im Index, die die Settings nicht durchsuchen, zählen nicht", async () => {
	let probe: () => Promise<unknown> = async () => Promise.reject(rejected("textSearch"));
	const probed: string[][] = [];
	const s = createFoldSwitch("test", ["title", "text"], (searchOn) => {
		probed.push(searchOn);
		return probe();
	});
	await s.update({ title: 10 });
	assert.deepEqual(probed, [], "ohne gefaltete Felder keine Probe");
	await s.update({ titleSearch: 3 });
	assert.deepEqual(probed, [["titleSearch", "textSearch"]], "geprüft werden alle");
	assert.equal(s.on, false);
	probe = searched;
	await s.update({ titleSearch: 3 });
	assert.equal(s.on, true);
	// Meili gerade nicht erreichbar: Der Stand bleibt; alte Settings (zurückgetauscht): aus.
	probe = async () => Promise.reject(new Error("fetch failed"));
	await s.update({ titleSearch: 3 });
	assert.equal(s.on, true);
	probe = async () => Promise.reject(rejected("titleSearch"));
	await s.update({ titleSearch: 3 });
	assert.equal(s.on, false);
	probe = async () => Promise.reject(new Error("fetch failed"));
	await s.update({ titleSearch: 3 });
	assert.equal(s.on, false);
});

test("Rückfall: abgelehntes gefaltetes Feld ⇒ einmal ohne Faltung, danach eine Minute aus", async () => {
	let time = 1_000;
	const s = createFoldSwitch("test", ["title"], searched, () => time);
	await s.update({ titleSearch: 3 });
	const states: boolean[] = [];
	const out = await s.withFallback(async () => {
		states.push(s.on);
		if (s.on) throw rejected("titleSearch");
		return "ohne";
	});
	assert.equal(out, "ohne");
	assert.deepEqual(states, [true, false]);
	await s.update({ titleSearch: 3 });
	assert.equal(s.on, false, "die nächste Prüfung schaltet noch nicht zurück");
	time += 60_000;
	await s.update({ titleSearch: 3 });
	assert.equal(s.on, true);
	// Gleichzeitige Anfragen: Auch die zweite, deren Fehler erst nach dem Ausschalten kommt, läuft neu.
	let first = true;
	const late = await s.withFallback(async () => {
		if (first) {
			first = false;
			await s.update(null);
			throw rejected("titleSearch");
		}
		return "nochmals";
	});
	assert.equal(late, "nochmals");
});

test("Rückfall: andere Fehler gehen weiter, auch der zweite Versuch", async () => {
	const s = createFoldSwitch("test", ["title"], searched);
	await s.update({ titleSearch: 3 });
	await assert.rejects(s.withFallback(async () => Promise.reject(new Error("fetch failed"))), /fetch failed/);
	assert.equal(s.on, true);
	await assert.rejects(s.withFallback(async () => Promise.reject(rejected("titleSearch"))), /titleSearch/);
	assert.equal(s.on, false);
	assert.equal(await s.withFallback(async () => 7), 7);
});

test("isFoldedFieldError: nur Meilis 400 zu einem gefalteten Feld", () => {
	assert.equal(isFoldedFieldError(rejected("titleSearch"), ["title"]), true);
	assert.equal(isFoldedFieldError(rejected("foo"), ["title"]), false);
	assert.equal(isFoldedFieldError(apiError(400, "invalid_search_filter", "titleSearch"), ["title"]), false);
	assert.equal(isFoldedFieldError(apiError(403, "invalid_api_key", "titleSearch"), ["title"]), false);
	assert.equal(isFoldedFieldError(new Error("titleSearch"), ["title"]), false);
});

test("unfoldHit: Hervorhebung und Auszug am Original, sonst derselbe Treffer", () => {
	const hit = {
		id: 1,
		title: "Straßen.",
		text: "Kauf der Mühle",
		_formatted: { title: "Straßen.", titleSearch: '<mark class="match">Strasse</mark>n.', text: "Kauf der <mark class=\"match\">Mühle</mark>" },
	};
	const out = unfoldHit(hit, ["title", "text"], MARKS);
	assert.equal(out._formatted.title, '<mark class="match">Straße</mark>n.');
	assert.equal(out._formatted.text, hit._formatted.text, "ohne gefaltetes Feld bleibt Meilis Formatierung");
	assert.equal(hit._formatted.title, "Straßen.", "Original unverändert");
	// Auszug ohne Hervorhebung (API, MCP).
	const api = { id: 2, title: "Plan", text: "eins zwei drei vier der Weg zur Straße nach Baden", _formatted: { text: "eins zwei…", textSearch: "…zur Strasse nach Baden" } };
	assert.equal(unfoldHit(api, ["title", "text"], MARKS)._formatted.text, "…zur Straße nach Baden");
	// Ohne gefaltetes Feld, ohne Formatierung, ohne Original oder mit unpassendem Text: derselbe Treffer.
	const plain = { id: 3, title: "Strasse", _formatted: { title: "Strasse" } };
	assert.equal(unfoldHit(plain, ["title"], MARKS), plain);
	const bare: { id: number; title: string; _formatted?: { title?: string } } = { id: 4, title: "Straße" };
	assert.equal(unfoldHit(bare, ["title"], MARKS), bare);
	const missing = { id: 5, _formatted: { titleSearch: "Strasse" } };
	assert.equal(unfoldHit(missing, ["title"], MARKS), missing);
	const odd = { id: 6, title: "Straße", _formatted: { title: "Straße", titleSearch: "etwas anderes" } };
	assert.equal(unfoldHit(odd, ["title"], MARKS), odd);
});
