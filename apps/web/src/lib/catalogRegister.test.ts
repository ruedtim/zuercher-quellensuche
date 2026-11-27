// Lauf: npx tsx --test src/lib/catalogRegister.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	catalogEntitySearchHref,
	classifyBestaende,
	CONSTANT_MIN_UNITS,
	documentEntitySearchHref,
	entityFilterClauses,
	hasEntityFilter,
	keyMatchesQuery,
	krdbNameMatchesKey,
	NO_ENTITY_FILTER,
	parseEntityFilter,
	parseRegisterQuery,
	pickDisplayForm,
	registerHref,
	registerKindBySlug,
	registerQueryWords,
	sortRegisterKeys,
	unkeyedEntityCount,
} from "./catalogRegister";
import { personKey, placeKey } from "./entityKey";

const sp = (qs: string) => new URLSearchParams(qs);

test("Entitätsfilter aus den geteilten Parametern: nur Formen mit Schlüssel, Varianten einmal", () => {
	const f = parseEntityFilter(sp("persons=Anna%20Meier&persons=Meier,%20Anna&persons=Meier&places=Z%C3%BCrich&organizations=AG&organizations=Escher%20Wyss%20AG"));
	assert.deepEqual(f, { person: ["Anna Meier"], place: ["Zürich"], org: ["Escher Wyss AG"] });
	assert.deepEqual(parseEntityFilter(sp("q=x&catPerson=Anna%20Meier")), NO_ENTITY_FILTER);
	assert.equal(hasEntityFilter(f), true);
	assert.equal(hasEntityFilter(NO_ENTITY_FILTER), false);
	assert.equal(hasEntityFilter(undefined), false);
});

test("Formen ohne Schlüssel wirken nur auf die Dokumente", () => {
	assert.equal(unkeyedEntityCount("person", ["Meier", "Herr Keller", "Anna Meier"]), 2);
	assert.equal(unkeyedEntityCount("place", ["Uster", "12"]), 1);
	assert.equal(unkeyedEntityCount("org", ["Escher Wyss AG"]), 0);
});

test("Filterklauseln über die Schlüssel, je Typ oder-verknüpft", () => {
	assert.deepEqual(entityFilterClauses({ person: ["Anna Meier", "Meyer, Anna", "Jakob Huber"], place: ["Gemeinde Uster"], org: [] }), [
		'personKeys IN ["ana meier", "jakob huber"]',
		'placeKeys IN ["uster"]',
	]);
	assert.deepEqual(entityFilterClauses(undefined), []);
	assert.deepEqual(entityFilterClauses(NO_ENTITY_FILTER), []);
});

test("Links in Katalog- und Dokumentsuche", () => {
	assert.equal(catalogEntitySearchHref("person", "Anna Meier"), "/search?view=catalog&persons=Anna+Meier");
	assert.equal(catalogEntitySearchHref("org", "Burger & Kehl"), "/search?view=catalog&organizations=Burger+%26+Kehl");
	assert.equal(catalogEntitySearchHref("place", "Uster", "E III (Bestand)"), "/search?view=catalog&places=Uster&catBestand=E+III+%28Bestand%29");
	assert.equal(documentEntitySearchHref("place", ["Zürich", "Zürich-Oerlikon"]), "/search?places=Z%C3%BCrich&places=Z%C3%BCrich-Oerlikon&view=documents");
	assert.equal(registerHref("orte"), "/archivkatalog/register/orte");
	assert.equal(registerHref("personen", { q: "Meier", sort: "name", page: 3 }), "/archivkatalog/register/personen?q=Meier&sort=name&page=3");
	assert.equal(registerHref("personen", { sort: "count", page: 1 }), "/archivkatalog/register/personen");
	assert.equal(registerKindBySlug("organisationen")?.keyField, "orgKeys");
	assert.equal(registerKindBySlug("x"), null);
});

test("Registerparameter: Seite, Sortierung, Suchtext", () => {
	assert.deepEqual(parseRegisterQuery(sp("q=%20Meier%20%20Anna%20&sort=name&page=4")), { q: "Meier Anna", sort: "name", page: 4 });
	assert.deepEqual(parseRegisterQuery(sp("sort=x&page=-2")), { q: "", sort: "count", page: 1 });
});

test("Suchwörter: Schlüssel einer vollständigen Form, sonst gefaltete Wortanfänge", () => {
	assert.deepEqual(registerQueryWords("person", "Meier, Anna"), [["ana"], ["meier"]]);
	assert.deepEqual(registerQueryWords("person", "Müller"), [["muler"]]);
	assert.deepEqual(registerQueryWords("person", "Phil"), [["fil"]]);
	assert.deepEqual(registerQueryWords("place", "Kanton Zürich"), [["zurich"]]);
	// «c» am Ende kann zu «ch» werden
	assert.deepEqual(registerQueryWords("person", "Sc"), [["sk", "sch"]]);
	assert.deepEqual(registerQueryWords("person", "  "), []);
	// ß und ss gelten als gleich.
	assert.deepEqual(registerQueryWords("person", "Großmann"), registerQueryWords("person", "Grossmann"));
});

test("Schlüssel trifft Suchwörter als Wortanfänge, Reihenfolge egal", () => {
	const key = personKey("Meier, Anna Barbara")!;
	assert.equal(keyMatchesQuery(key, registerQueryWords("person", "Meier")), true);
	assert.equal(keyMatchesQuery(key, registerQueryWords("person", "Anna Mei")), true);
	assert.equal(keyMatchesQuery(key, registerQueryWords("person", "Barb Mey")), true);
	assert.equal(keyMatchesQuery(key, registerQueryWords("person", "Huber")), false);
	assert.equal(keyMatchesQuery(personKey("Hans Schmid")!, registerQueryWords("person", "Sc")), true);
	assert.equal(keyMatchesQuery(placeKey("Zürich")!, []), false);
});

test("Sortierung nach Häufigkeit oder Name (Personen nach Nachnamen)", () => {
	const items = [
		{ key: "ana meier", count: 5 },
		{ key: "hans huber", count: 9 },
		{ key: "berta meier", count: 9 },
	];
	assert.deepEqual(sortRegisterKeys("person", items, "count").map((i) => i.key), ["berta meier", "hans huber", "ana meier"]);
	assert.deepEqual(sortRegisterKeys("person", items, "name").map((i) => i.key), ["hans huber", "ana meier", "berta meier"]);
	assert.deepEqual(sortRegisterKeys("place", [{ key: "uster", count: 1 }, { key: "adliswil", count: 2 }], "name").map((i) => i.key), ["adliswil", "uster"]);
});

test("Anzeigeform: häufigste Form mit genau diesem Schlüssel, Versalien zuletzt", () => {
	const key = personKey("Anna Meier")!;
	assert.equal(pickDisplayForm("person", key, ["Anna Meyer", "Anna Meier", "Jakob Huber", "Anna Meier"]), "Anna Meier");
	assert.equal(pickDisplayForm("person", key, ["ANNA MEIER", "Anna Meyer"]), "Anna Meyer");
	assert.equal(pickDisplayForm("person", key, ["ANNA MEIER"]), "ANNA MEIER");
	assert.equal(pickDisplayForm("person", key, ["Jakob Huber"]), null);
	assert.equal(pickDisplayForm("place", placeKey("Uster")!, ["Gemeinde  Uster", "Uster"]), "Uster");
	assert.equal(pickDisplayForm("place", placeKey("Uster")!, ["Gemeinde  Uster", "Uster", "Gemeinde Uster"]), "Gemeinde Uster");
});

test("Bestandsprägend: Urheber an fast jeder Einheit eines Bestands", () => {
	const sizes = { "Fotograf X (Bestand)": 1000, "Patente (Bestand)": 20_000, "Kirchenbücher (Bestand)": 30_000, "Nachlass Y (Bestand)": 40 };
	// Fotograf: 950 von 1000 Einheiten seines Bestands
	const foto = classifyBestaende(960, { "Fotograf X (Bestand)": 950, "Kirchenbücher (Bestand)": 10 }, sizes);
	assert.equal(foto.constant, true);
	assert.deepEqual(foto.bestaende, [{ bestand: "Fotograf X (Bestand)", count: 950, size: 1000 }]);
	// Patentinhaber: fast nur in den Patenten, dort aber selten – Schwerpunkt, nicht prägend
	const firma = classifyBestaende(1100, { "Patente (Bestand)": 1080, "Kirchenbücher (Bestand)": 20 }, sizes);
	assert.equal(firma.constant, false);
	assert.deepEqual(firma.bestaende, [{ bestand: "Patente (Bestand)", count: 1080, size: 20_000 }]);
	// Verstreut: kein Schwerpunkt
	assert.deepEqual(classifyBestaende(300, { "Patente (Bestand)": 100, "Kirchenbücher (Bestand)": 100, "Nachlass Y (Bestand)": 30 }, sizes), {
		constant: false,
		bestaende: [],
	});
	// Selten: auch bei voller Abdeckung eines kleinen Bestands nicht prägend
	assert.equal(classifyBestaende(CONSTANT_MIN_UNITS - 1, { "Nachlass Y (Bestand)": 39 }, sizes).constant, false);
	// Unbekannte Bestandsgrösse zählt nicht als Prägung
	assert.equal(classifyBestaende(500, { "Unbekannt (Bestand)": 500 }, sizes).constant, false);
});

test("Kantonsratsdatenbank: Nachname ganz, ein Vorname genügt", () => {
	const key = personKey("Eugen Muster")!;
	assert.equal(krdbNameMatchesKey({ first: "Paul Eugen", last: "Muster" }, key), true);
	assert.equal(krdbNameMatchesKey({ first: "Paul", last: "Muster" }, key), false);
	assert.equal(krdbNameMatchesKey({ first: "Eugen", last: "Muster-Huber" }, key), false);
	assert.equal(krdbNameMatchesKey({ first: "Eugen", last: "Muster (von Uster)" }, key), true);
	assert.equal(krdbNameMatchesKey({ first: "Eugen", last: "" }, key), false);
});
