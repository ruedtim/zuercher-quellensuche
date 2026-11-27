// Lauf: npx tsx --test src/lib/searchViews.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	documentsSearchHref,
	parseSearchView,
	SEARCH_VIEWS,
	searchViewHref,
	searchViewUrl,
	unappliedNote,
	unappliedSharedFilters,
	writeSearchView,
} from "./searchViews";

const u = (qs: string) => new URL(`http://localhost/search?${qs}`);

test("Reiter aus der URL: view=<id>, alte Links catView=1 = Katalog, sonst «Alle Quellen»", () => {
	assert.equal(parseSearchView(u("").searchParams), "all");
	assert.equal(parseSearchView(u("q=M%C3%BChle").searchParams), "all");
	assert.equal(parseSearchView(u("view=all").searchParams), "all");
	assert.equal(parseSearchView(u("view=documents").searchParams), "documents");
	assert.equal(parseSearchView(u("view=catalog").searchParams), "catalog");
	assert.equal(parseSearchView(u("view=ehedaten").searchParams), "ehedaten");
	assert.equal(parseSearchView(u("view=editions").searchParams), "editions");
	assert.equal(parseSearchView(u("catView=1").searchParams), "catalog");
	assert.equal(parseSearchView(u("view=ehedaten&catView=1").searchParams), "ehedaten");
	assert.equal(parseSearchView(u("view=unbekannt").searchParams), "all");
	assert.equal(parseSearchView(u("view=unbekannt&catView=1").searchParams), "catalog");
	assert.deepEqual(
		SEARCH_VIEWS.map((v) => v.id),
		["all", "catalog", "documents", "editions", "ehedaten"],
	);
	for (const v of SEARCH_VIEWS) assert.ok(v.mobileLabel.length > 0 && v.mobileLabel.length <= v.label.length, v.id);
});

test("Reiter schreiben: view setzen, catView entfernen, «Alle Quellen» ohne Parameter", () => {
	assert.equal(writeSearchView(u("catView=1&q=x"), "all").search, "?q=x");
	assert.equal(writeSearchView(u("view=ehedaten&q=x"), "all").search, "?q=x");
	assert.equal(writeSearchView(u("catView=1&q=x"), "catalog").search, "?q=x&view=catalog");
	assert.equal(writeSearchView(u("q=x"), "documents").search, "?q=x&view=documents");
	assert.equal(writeSearchView(u("q=x"), "ehedaten").search, "?q=x&view=ehedaten");
});

test("Reiterwechsel: alle Eingaben und Filter aller Reiter bleiben, nur die Seite nicht", () => {
	const docs = searchViewUrl(u("catView=1&q=Mühle&theme=Mühlen&dateFrom=900&page=3&catLevel=Dossier&catDigital=1&persons=Anna%20Meier"), "documents");
	assert.equal(docs.search, "?q=M%C3%BChle&theme=M%C3%BChlen&dateFrom=900&catLevel=Dossier&catDigital=1&persons=Anna+Meier&view=documents");
	const all = searchViewUrl(u("view=documents&q=Mühle&page=4&series=RRB&titleOnly=1&eheKirche=Uster"), "all");
	assert.equal(all.searchParams.has("view"), false);
	assert.equal(all.searchParams.has("page"), false);
	assert.equal(all.searchParams.get("series"), "RRB");
	assert.equal(all.searchParams.get("eheKirche"), "Uster");
	const ehe = searchViewUrl(u("view=catalog&q=Heusser&catLevel=Dokument&page=2"), "ehedaten");
	assert.equal(ehe.search, "?view=ehedaten&q=Heusser&catLevel=Dokument");
});

test("Links auf einen Reiter von anderen Seiten", () => {
	assert.equal(searchViewHref("all"), "/search");
	assert.equal(searchViewHref("catalog"), "/search?view=catalog");
	assert.equal(searchViewHref("ehedaten", { q: "Heusser" }), "/search?q=Heusser&view=ehedaten");
	assert.equal(searchViewHref("documents", { q: "x" }), "/search?q=x&view=documents");
	assert.equal(documentsSearchHref({ series: "RM" }), "/search?series=RM&view=documents");
});

test("Reiterzahl: geteilte Felder, die ein Reiter nicht anwenden kann", () => {
	const p = (
		over: Partial<{ persons: string[]; places: string[]; organizations: string[]; theme: string; sort: "relevance" | "date_asc" | "date_desc" }> = {},
	) => ({
		persons: [],
		places: [],
		organizations: [],
		theme: "",
		sort: "date_asc" as const,
		...over,
	});
	const semantic = { catalogSemantic: true, editionsSemantic: true };
	// Archivkatalog: Namen ohne Vergleichsschlüssel (Person ohne Vornamen) wirken nicht.
	assert.deepEqual(unappliedSharedFilters("catalog", p({ persons: ["Grebel", "Konrad Grebel"] }), semantic), ["Person «Grebel» (ohne Vornamen)"]);
	assert.deepEqual(unappliedSharedFilters("catalog", p({ persons: ["Konrad Grebel"], places: ["Kyburg"] }), semantic), []);
	assert.deepEqual(unappliedSharedFilters("catalog", p({ theme: "Täufer" }), { ...semantic, catalogSemantic: false }), ["Thema"]);
	// Ehedaten: Personen über die Namenswörter (auch nur der Nachname), keine Organisationen, kein Thema.
	assert.deepEqual(unappliedSharedFilters("ehedaten", p({ persons: ["Grebel"], organizations: ["Rat"], theme: "Ehe" }), semantic), [
		"Organisation «Rat»",
		"Thema",
	]);
	// Editionen: Namen immer (genau oder über den Schlüssel), das Thema nur mit Vektoren.
	assert.deepEqual(unappliedSharedFilters("editions", p({ persons: ["Grebel"], theme: "Täufer" }), semantic), []);
	assert.deepEqual(unappliedSharedFilters("editions", p({ theme: "Täufer" }), { ...semantic, editionsSemantic: false }), ["Thema"]);
	// Nach Relevanz reiht das Thema nur, die Zahlen bleiben vergleichbar.
	assert.deepEqual(unappliedSharedFilters("ehedaten", p({ theme: "Ehe", sort: "relevance" }), semantic), []);
	assert.deepEqual(unappliedSharedFilters("catalog", p({ theme: "Täufer", sort: "relevance" }), { ...semantic, catalogSemantic: false }), []);
	// Zentrale Serien: alle Namen, auch ohne Vergleichsschlüssel (dann genau diese Form).
	assert.deepEqual(unappliedSharedFilters("documents", p({ persons: ["Grebel"], organizations: ["Rat"] }), semantic), []);
	assert.equal(unappliedNote(["Thema"]), "Keine Trefferzahl: Thema wirkt in diesem Reiter nicht.");
	assert.equal(unappliedNote(["Ort «X»", "Thema"]), "Keine Trefferzahl: Ort «X», Thema wirken in diesem Reiter nicht.");
	assert.equal(unappliedNote(["Thema"], "dort"), "Keine Trefferzahl: Thema wirkt dort nicht.");
});
