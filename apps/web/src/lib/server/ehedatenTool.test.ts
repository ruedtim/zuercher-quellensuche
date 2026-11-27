// Lauf: npx tsx --test src/lib/server/ehedatenTool.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EhedatenEntry } from "$lib/ehedaten";
import { namesakeNote, normalizeEhedatenArgs } from "./ehedatenTool";

// Erfundene Namen in den Mustern der Ehedatenbank.
const entry = (over: Partial<EhedatenEntry> = {}): EhedatenEntry => ({
	id: 1944835,
	signatur: "E III 30.1, EDB 276",
	band: "E III 30.1",
	eintrag: 276,
	quelle: "E III",
	seite: "S. 12",
	kirchgemeinde: "Wädenswil",
	art: "trauung",
	datum: "03.03.1689",
	isoVon: "1689-03-03",
	isoBis: "1689-03-03",
	dateFrom: 1689,
	dateTo: 1689,
	titel: "Muster, Hans, Uster, getraut mit Beispiel, Anna",
	mann: { vorname: "Hans", nachname: "Muster", name: "Hans Muster", herkunft: "Uster", ort: "Uster", zusatz: "Schuhmacher; verkündet 22. Febr.", hls: "", gnd: "" },
	frau: { vorname: "Anna", nachname: "Beispiel", name: "Anna Beispiel", herkunft: "", ort: "", zusatz: "", hls: "", gnd: "" },
	unsicher: false,
	...over,
});

test("Argumente: Namen mit Rolle, Herkunft als Ort, Jahre geklemmt und getauscht, Unbekanntes fällt weg", () => {
	const q = normalizeEhedatenArgs({
		name: "  Heusser ",
		braut: "Anna Meier",
		herkunft: "Thurgau",
		kirchgemeinde: "Stadt Zürich",
		query: "Witwer",
		dateFrom: 1900,
		dateTo: "1650",
		art: "hochzeit",
		groupBy: "jahrzehnt",
		sort: "date_desc",
		topK: 99,
	});
	assert.equal(q.q, "Witwer");
	assert.equal(q.sort, "date_desc");
	assert.equal(q.limit, 30);
	assert.deepEqual(q.groupBy, ["jahrzehnt"]);
	assert.deepEqual(q.shared, { dateFrom: 1650, dateTo: 1800, persons: ["Heusser"], places: ["Thurgau"] });
	assert.deepEqual(q.filters.frau, ["Anna Meier"]);
	assert.deepEqual(q.filters.kirche, ["Stadt Zürich"]);
	assert.equal(q.filters.art, null);
	assert.deepEqual(q.criteria, ["Name «Heusser»", "Braut «Anna Meier»", "Herkunft «Thurgau»", "Kirchgemeinde Stadt Zürich", "Volltext «Witwer»", "1650–1800"]);
	// Herkunftsraum: nur die drei Werte.
	const r = normalizeEhedatenArgs({ raum: "ch", name: "Heusser" });
	assert.deepEqual(r.filters.raum, ["ch"]);
	assert.deepEqual(r.criteria, ["Name «Heusser»", "Herkunftsraum andere Kantone"]);
	assert.deepEqual(normalizeEhedatenArgs({ raum: "Thurgau" }).filters.raum, []);
	// Platzhalter statt Namen filtern nicht und erscheinen nicht in den Kriterien.
	const star = normalizeEhedatenArgs({ braut: "*", name: "?", raum: "ch" });
	assert.deepEqual([star.filters.frau, star.shared.persons, star.criteria], [[], [], ["Herkunftsraum andere Kantone"]]);
	// nur zählen
	assert.equal(normalizeEhedatenArgs({ groupBy: "kirchgemeinde", topK: 0 }).limit, 0);
	assert.equal(normalizeEhedatenArgs({ topK: 0 }).limit, 1);
	assert.equal(normalizeEhedatenArgs({}).limit, 10);
});

test("Namensvettern: gleicher Name mehr als 40 Jahre auseinander ⇒ Hinweis, sonst keiner", () => {
	const later = entry({ id: 2, dateFrom: 1791, dateTo: 1791, datum: "09.05.1791", frau: { ...entry().frau, name: "Maria Kunz", vorname: "Maria", nachname: "Kunz" } });
	assert.equal(namesakeNote([entry(), entry({ id: 3 })]), "");
	const note = namesakeNote([entry(), later]);
	assert.match(note, /^Achtung, Namensvettern: «Hans Muster» erscheint 1689, 1791 – mehr als 40 Jahre auseinander/);
	assert.doesNotMatch(note, /Anna Beispiel|Maria Kunz/);
});

// --- Geprüfte Mehrfacheinträge (Liste des Staatsarchivs) ------------------------------
