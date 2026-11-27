import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildKrdbIndex,
	dayEnd,
	dayStart,
	displayLastName,
	foldName,
	surnameKeys,
	krdbIndexFields,
	matchKrdbDocument,
	matchKrdbPersons,
	placeKeysOf,
	portraitKey,
	portraitOf,
	sortPersonViews,
	toPersonView,
	type KrdbPerson,
	type KrdbRegister,
} from "./krdbMatch";

// Fixture: kleines Register mit den Fallstricken aus dem echten Korpus.
const P: KrdbPerson[] = [
	{ id: 1, last: "Walther", first: "Gustav", sex: "m", born: 1900, died: 1975,
		seats: [["Kantonsrat", "1951-05-14", "1963-05-12", "10. Wahlkreis (Uster)"]],
		parties: [["BGB", null, "1951-05-14", "1963-05-12"]], places: [["Dübendorf", "1951-05-14", "1963-05-12"]] },
	{ id: 2, last: "Walther", first: "Hans", sex: "m",
		seats: [["Kantonsrat", "1955-05-16", "1959-05-10", "14. Wahlkreis (Winterthur Stadt)"]],
		places: [["Winterthur", "1955-05-16", "1959-05-10"]] },
	{ id: 3, last: "Meier", first: "Rudolf", sex: "m", born: 1897, died: 1980,
		seats: [["Regierungsrat", "1947-07-01", "1963-06-30", null]], parties: [["BGB", null, "1947", "1963"]] },
	{ id: 4, last: "Meier", first: "Hans", sex: "m",
		seats: [["Kantonsrat", "1951-05-14", "1959-05-10", "01. Wahlkreis Zürich"]],
		parties: [["SP", null, "1951", "1959"]], places: [["Zürich", null, null]] },
	{ id: 5, last: "Meier", first: "Ulrich", sex: "m",
		seats: [["Kantonsrat", "1991-05-13", "1999-05-09", "Wahlkreis Küsnacht"]],
		parties: [["SVP", null, "1991", "1999"]], places: [["Küsnacht (ZH)", "1991", "1999"]] },
	{ id: 6, last: "Meier", first: "Paul", sex: "m",
		seats: [["Kantonsrat", "1991-05-13", "1995-05-07", "01. Wahlkreis Zürich"]],
		parties: [["SP", null, "1991", "1995"]], places: [["Zürich", "1991", "1995"]] },
	{ id: 7, last: "Stapfer", first: "Heinrich", sex: "m", seats: [["Grosser Rat", "1803-04-12", "1814-06-30", "Zünfte und Los"]] },
	{ id: 8, last: "Pfister", first: "Jakob", sex: "m", seats: [["Grosser Rat", "1803", "1808", null]] },
	{ id: 9, last: "Schaufelberger", first: "Heinrich", sex: "m", seats: [["Grosser Rat", "1803", "1809", null]] },
	{ id: 10, last: "Habegger", first: "Beat", sex: "m", born: 1969,
		seats: [["Kantonsrat", "2015-05-18", null, "13. Wahlkreis (Pfäffikon)"]], parties: [["FDP", "FDP", "2015-05-18", null]],
		qid: "Q111", qidVia: "p13468",
		img: { thumb: "https://thumb.wikimedia.org/x/250px-Beat.jpg", width: 250, height: 330,
			page: "https://commons.wikimedia.org/wiki/File:Beat.jpg", artist: "Parlamentsdienste", license: "CC BY-SA 4.0",
			licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" } },
	{ id: 11, last: "Wirth", first: "Thomas", sex: "m", seats: [["Kantonsrat", "2007-05-21", "2025-09-29", "Wahlkreis Meilen"]],
		img: { thumb: "/portraits/z1114/Z_1114_9_2.webp", width: 240, height: 290, v: "abcd1234",
			page: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=5",
			artist: "Beat Marti", credit: "Staatsarchiv Zürich, Z 1114.9.2", source: "z1114" } },
	{ id: 12, last: "Wirth", first: "Anna", sex: "w", seats: [["Kantonsrat", "2023-05-08", null, "Wahlkreis Uster"]] },
	{ id: 13, last: "Thomas", first: "Erika", sex: "w", seats: [["Kantonsrat", "2019-05-13", null, "Wahlkreis Horgen"]] },
	{ id: 14, last: "Forrer", first: "Thomas", sex: "m", seats: [["Kantonsrat", "2019-05-13", null, "Wahlkreis Meilen"]] },
	{ id: 15, last: "Kessler", first: "Thomas", sex: "m", seats: [["Kantonsrat", "1999-05-10", "2011-05-08", null]] },
	{ id: 16, last: "Frey-Nägeli", first: "Kaspar Theodor", sex: "m", seats: [["Kantonsrat", "1896-05-01", "1911-05-01", null]] },
	{ id: 17, last: "Wyss von", first: "Georg", sex: "m", seats: [["Grosser Rat", "1850", "1860", null]], died: 1893 },
	{ id: 18, last: "Neukom", first: "Albert", sex: "m", seats: [["Kantonsrat", "1935", "1947", null]] },
	{ id: 19, last: "Neukomm", first: "Hans", sex: "m", seats: [["Kantonsrat", "1935", "1943", null]] },
	{ id: 20, last: "Hess", first: "Hans Kaspar", sex: "m", seats: [["Grosser Rat", "1814", "1830", null]] },
	{ id: 21, last: "Offen", first: "Otto", sex: "m", seats: [["Grosser Rat", "1850", null, null]] },
	{ id: 22, last: "Kägi", first: "Viviane", sex: "w", born: 1997,
		seats: [["Kantonsrat", "2026-06-29", null, "15. Wahlkreis (Winterthur Land)"]], parties: [["GLP", "GLP", "2026-06-29", null]] },
	{ id: 23, last: "Keller", first: "Ernst", sex: "m", seats: [["Kantonsrat", "1917", "1920", "Wahlkreis Winterthur"]],
		places: [["Winterthur", null, null]] },
	{ id: 24, last: "Keller", first: "Emil", sex: "m", seats: [["Kantonsrat", "1880", "1890", null]] },
	{ id: 25, last: "Keller", first: "Emma", sex: "w", seats: [["Kantonsrat", "1990", "1995", null]] },
	{ id: 26, last: "Rüegg", first: "Heinrich", sex: "m", seats: [["Regierungsrat", "1831", "1839", null]] },
	{ id: 27, last: "Escher (v. Glas)", first: "Hans", sex: "m", seats: [["Grosser Rat", "1830", "1840", null]] },
	{ id: 28, last: "Häusser (Heusser)", first: "Jakob", sex: "m", seats: [["Kantonsrat", "1870", "1880", null]] },
	{ id: 29, last: "Mestral, de", first: "Armand", sex: "m", seats: [["Grosser Rat", "1840", "1845", null]] },
	{ id: 30, last: "Bosshart", first: "Hans Jakob", sex: "m", seats: [["Grosser Rat", "1803", "1810", null]] },
	{ id: 31, last: "Keller", first: "Kaspar", sex: "m", seats: [["Kantonsrat", "1900", "1910", null]] },
	{ id: 32, last: "Graf", first: "Emil", sex: "m", seats: [["Kantonsrat", "1920", "1930", "Wahlkreis Zürich"]],
		parties: [["S", null, "1920", "1930"]] },
	{ id: 33, last: "Ernst", first: "Paul", sex: "m", seats: [["Kantonsrat", "1950", "1960", null]] },
	{ id: 34, last: "Frei", first: "Ernst", sex: "m", seats: [["Kantonsrat", "1880", "1884", null]] },
	{ id: 35, last: "Weber", first: "Ernst", sex: "m", seats: [["Kantonsrat", "1884", "1888", null]] },
	// Dokument-Abgleich (Protokolle ab 1995).
	{ id: 38, last: "Sulser", first: "Jürg", sex: "m", seats: [["Kantonsrat", "2015-05-11", null, "Wahlkreis Dielsdorf"]],
		parties: [["SVP", null, "2015", null]], places: [["Otelfingen", "2015", null]] },
	{ id: 39, last: "Lenggenhager", first: "Marcel", sex: "m", seats: [["Kantonsrat", "2011-05-16", null, "Wahlkreis Bülach"]],
		parties: [["BDP", null, "2011", null]], places: [["Gossau (ZH)", "2011", null]] },
];

const REGISTER: KrdbRegister = {
	meta: { generatedAt: "2026-09-26T00:00:00Z", hash: "test", source: "test", persons: P.length, seats: 0, withQid: 1, withImage: 1, qidVia: { p13468: 1 } },
	persons: P,
};
const INDEX = buildKrdbIndex(REGISTER);
const ids = (ms: ReturnType<typeof matchKrdbPersons>) => ms.map((m) => m.person.id);
const match = (persons: string[], date: string, extra: { title?: string; body?: string } = {}) =>
	matchKrdbPersons(INDEX, { persons, date, ...extra });

test("foldName: Umlaute, ß, Diakritika, OCR-Klammern, Initialen", () => {
	assert.equal(foldName("Georg von Wyß"), "georg von wyss");
	assert.equal(foldName("Frey-Nägeli"), "frey-naegeli");
	assert.equal(foldName("Neukom[m"), "neukomm");
	assert.equal(foldName("R.Meier"), "r meier");
	assert.equal(foldName("Michèle Dünki-Bättig"), "michele duenki-baettig");
});

test("dayStart/dayEnd: Teil-Datumsangaben", () => {
	assert.equal(dayStart("1956"), Date.UTC(1956, 0, 1) / 86_400_000);
	assert.equal(dayEnd("1956"), Date.UTC(1956, 11, 31) / 86_400_000);
	assert.equal(dayEnd("1956-02"), Date.UTC(1956, 1, 29) / 86_400_000);
	assert.equal(dayStart("1956-05-14"), Date.UTC(1956, 4, 14) / 86_400_000);
	assert.equal(dayStart(null), null);
});

test("surnameKeys/displayLastName: Klammern, nachgestellte Partikel, Umlaut-Varianten", () => {
	const escher = surnameKeys("Escher (v. Glas)");
	assert.ok(escher.includes("escher") && escher.includes("escher vom glas") && escher.includes("escher v glas"));
	const haeusser = surnameKeys("Häusser (Heusser)");
	assert.ok(haeusser.includes("haeusser") && haeusser.includes("hausser") && haeusser.includes("heusser"));
	assert.ok(surnameKeys("Mestral, de").includes("de mestral"));
	assert.ok(surnameKeys("Euw von").includes("von euw"));
	assert.ok(surnameKeys("Rüegg").includes("ruegg") && surnameKeys("Rüegg").includes("rueegg"));
	assert.ok(!surnameKeys("Müller-Kern").includes("kern"));
	assert.equal(displayLastName("Euw von"), "von Euw");
	assert.equal(displayLastName("Mestral, de"), "de Mestral");
	assert.equal(displayLastName("Escher (v. Glas)"), "Escher (v. Glas)");
});

test("placeKeysOf: Kantonszusatz, Ortsteil, Wahlkreis-Namen", () => {
	assert.ok(placeKeysOf("Küsnacht (ZH)").includes("kuesnacht"));
	assert.ok(placeKeysOf("Winterberg (Lindau)").includes("lindau"));
	assert.ok(placeKeysOf("12. Wahlkreis (Uster)").includes("uster"));
	const dv = placeKeysOf("27. Wahlkreis Dübendorf-Volketswil");
	assert.ok(dv.includes("duebendorf") && dv.includes("volketswil"));
});

test("Vollname mit aktivem Einsitz wird zugeordnet", () => {
	const ms = match(["Beat Habegger"], "2025-09-29");
	assert.deepEqual(ids(ms), [10]);
	assert.equal(ms[0].via, "name");
	assert.equal(ms[0].party, "FDP");
});

test("Vollname ausserhalb der Amtszeit ⇒ keine Zuordnung", () => {
	assert.deepEqual(ids(match(["Beat Habegger"], "1990-01-01")), []);
});

test("Seltener Nachname allein, eindeutig aktiv ⇒ Zuordnung", () => {
	const ms = match(["Stapfer"], "1804-06-01");
	assert.deepEqual(ids(ms), [7]);
	assert.equal(ms[0].via, "surname");
});

test("Initiale trennt gleichnamige Mitglieder", () => {
	assert.deepEqual(ids(match(["R. Meier"], "1956-05-14")), [3]);
	assert.deepEqual(ids(match(["E Stutz", "H. Meier"], "1956-05-14")), [4]);
});

test("Mehrdeutiger Nachname ohne Indizien ⇒ keine Zuordnung", () => {
	assert.deepEqual(ids(match(["Meier"], "1956-05-14")), []);
});

test("Amtsbezeichnung im Text entscheidet (Regierung vs. Parlament)", () => {
	const ms = match(["Meier"], "1956-05-14", { body: "Finanzdirektor Meier nimmt die Motion namens des Regierungsrates entgegen." });
	assert.deepEqual(ids(ms), [3]);
	assert.equal(ms[0].via, "context");
});

test("«Name - Ort» im Text entscheidet", () => {
	const ms = match(["Walther"], "1956-05-14", { title: "Motion Walther - Dübendorf über die Revision des Steuergesetzes" });
	assert.deepEqual(ids(ms), [1]);
});

test("«Name (Partei, Ort)» im Text entscheidet", () => {
	const ms = match(["Meier"], "1994-03-07", { body: "Meier (SVP, Küsnacht): Das vorliegende Konkordat …" });
	assert.deepEqual(ids(ms), [5]);
});

test("Ort in der Nennung selbst schränkt ein", () => {
	assert.deepEqual(ids(match(["Walther - Winterthur"], "1956-05-14")), [2]);
	assert.deepEqual(ids(match(["Meier (SP, Zürich)"], "1994-03-07")), [6]);
});

test("Koreferenz: Nachname allein folgt dem voll aufgelösten Namen", () => {
	const ms = match(["Thomas Wirth", "Wirth"], "2025-09-29");
	assert.deepEqual(ids(ms), [11]);
	assert.deepEqual(ms[0].forms.sort(), ["Thomas Wirth", "Wirth"]);
	assert.equal(ms[0].via, "name");
});

test("Nur-Vorname trifft keine Person mit diesem Nachnamen", () => {
	assert.deepEqual(ids(match(["Thomas"], "2025-09-29")), []);
});

test("Häufiger Nachname braucht Indizien", () => {
	const idx = buildKrdbIndex(REGISTER, { commonSurnameMin: 3 });
	assert.deepEqual(ids(matchKrdbPersons(idx, { persons: ["Keller"], date: "1918-01-01" })), []);
	assert.deepEqual(
		ids(matchKrdbPersons(idx, { persons: ["Keller"], date: "1918-01-01", body: "Keller - Winterthur stellt den Antrag" })),
		[23],
	);
	assert.deepEqual(ids(matchKrdbPersons(idx, { persons: ["Ernst Keller"], date: "1918-01-01" })), [23]);
});

test("Allianzname: voller Name und Familienname allein", () => {
	assert.deepEqual(ids(match(["Frey-Nägeli"], "1909-03-01")), [16]);
	assert.deepEqual(ids(match(["Theodor Frey-Nägeli"], "1909-03-01")), [16]);
	assert.deepEqual(ids(match(["Frey"], "1909-03-01")), [16]);
});

test("Partikel und ß: «von Wyss» / «Georg von Wyß» ↔ KRDB «Wyss von»", () => {
	assert.deepEqual(ids(match(["von Wyss"], "1855-01-01")), [17]);
	assert.deepEqual(ids(match(["Georg von Wyß"], "1855-01-01")), [17]);
});

test("Gedrehte Form «Nachname, Vorname» und OCR-Rest", () => {
	assert.deepEqual(ids(match(["Neukom, Albert"], "1940-01-01")), [18]);
	assert.deepEqual(ids(match(["Neukom[m"], "1940-01-01")), [19]);
});

test("Mehrpersonen-String wird zerlegt", () => {
	assert.deepEqual(ids(match(["Pfister, Stapfer & Schaufelberger"], "1804-06-01")).sort(), [7, 8, 9]);
});

test("Historische Schreibweise: Caspar Heß ↔ Hans Kaspar Hess", () => {
	assert.deepEqual(ids(match(["Caspar Heß"], "1820-01-01")), [20]);
});

test("Umlaut-Varianten: «Ruegg» und «Rüegg» treffen beide", () => {
	assert.deepEqual(ids(match(["Ruegg"], "1835-01-26")), [26]);
	assert.deepEqual(ids(match(["Rüegg"], "1835-01-26")), [26]);
});

test("KRDB-Klammerformen: Familienzweig und Schreibvariante", () => {
	assert.deepEqual(ids(match(["Escher vom Glas"], "1835-01-01")), [27]);
	assert.deepEqual(ids(match(["Hans Escher"], "1835-01-01")), [27]);
	assert.deepEqual(ids(match(["Heusser"], "1875-01-01")), [28]);
	assert.deepEqual(ids(match(["de Mestral"], "1842-01-01")), [29]);
});

test("Lose Schreibvariante nur mit Vornamen", () => {
	assert.deepEqual(ids(match(["Jakob Boßhard"], "1805-01-01")), [30]);
	assert.deepEqual(ids(match(["Boßhard"], "1805-01-01")), []);
});

test("Widersprechende vollere Form bremst den nackten Nachnamen", () => {
	assert.deepEqual(ids(match(["Keller"], "1905-01-01")), [31]);
	assert.deepEqual(ids(match(["Hans Keller", "Keller"], "1905-01-01")), []);
});

test("Nachname, der eher ein Vorname ist, braucht Indizien", () => {
	assert.deepEqual(ids(match(["Ernst"], "1955-01-01")), []);
	assert.deepEqual(ids(match(["Paul Ernst"], "1955-01-01")), [33]);
});

test("Genitiv-s wird abgestreift", () => {
	assert.deepEqual(ids(match(["Stapfers"], "1804-06-01")), [7]);
});

test("Toleranz nach dem Austritt (Nachruf), aber nicht beliebig lange", () => {
	assert.deepEqual(ids(match(["Stapfer"], "1814-08-15")), [7]);
	assert.deepEqual(ids(match(["Stapfer"], "1815-06-01")), []);
});

test("Offener Alt-Einsitz ohne Austritt wird gedeckelt", () => {
	assert.deepEqual(ids(match(["Offen"], "1855-01-01")), [21]);
	assert.deepEqual(ids(match(["Offen"], "1900-01-01")), []);
});

test("Ohne Datum oder ohne Personen ⇒ leer", () => {
	assert.deepEqual(matchKrdbPersons(INDEX, { persons: ["Beat Habegger"], date: null }), []);
	assert.deepEqual(matchKrdbPersons(INDEX, { persons: [], date: "2025-01-01" }), []);
});

test("toPersonView: Rolle, Lebensdaten, Links, Porträt-Nachweis", () => {
	const [beat] = match(["Beat Habegger"], "2025-09-29");
	const view = (m: (typeof beat)) =>
		toPersonView(m, { portraitSrc: (q, ver) => `/api/portrait/${q}${ver ? `?v=${ver}` : ""}`, nowYear: 2026 });
	const v = view(beat);
	assert.equal(v.name, "Beat Habegger");
	assert.equal(v.lifespan, null, "keine Geburtsjahre lebender Personen");
	assert.deepEqual(v.forms, ["Beat Habegger"]);
	assert.equal(v.role, "Kantonsrat · FDP · 13. Wahlkreis (Pfäffikon)");
	assert.equal(v.wikidataUrl, "https://www.wikidata.org/wiki/Q111");
	assert.equal(v.krdbUrl, "https://www.web.statistik.zh.ch/webapp/KRRRPublic/app?id=10");
	assert.equal(v.portrait?.src, "/api/portrait/Q111");
	assert.equal(v.portrait?.credit, "Parlamentsdienste");

	assert.equal(v.portrait?.source, "commons");

	// Z 1114: statische Datei auch ohne QID, Nachweis «Fotograf:in · Staatsarchiv Zürich, Signatur».
	const [wirth] = match(["Thomas Wirth"], "2024-01-01");
	const vw = view(wirth);
	assert.equal(vw.qid, null);
	assert.deepEqual(vw.portrait, {
		src: "/portraits/z1114/Z_1114_9_2.webp?v=abcd1234",
		source: "z1114",
		width: 240,
		height: 290,
		page: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=5",
		credit: "Beat Marti · Staatsarchiv Zürich, Z 1114.9.2",
		license: null,
		licenseUrl: null,
	});

	// Kuratiertes Commons-Porträt ohne Wikidata-Item: Proxy-Schlüssel «K» + KRDB-ID.
	const curated: KrdbPerson = {
		id: 22190, last: "Gehrig Schmidt", first: "Sonja", sex: "w", seats: [["Kantonsrat", "2019-05-13", null, null]],
		img: { thumb: "https://upload.wikimedia.org/x/250px-Sonja.jpg", width: 250, height: 300,
			page: "https://commons.wikimedia.org/wiki/File:Sonja.jpg", v: "v1" },
	};
	assert.equal(portraitKey(curated), "K22190");
	assert.equal(portraitKey({ id: 10, qid: "Q111" }), "Q111");
	assert.equal(
		portraitOf(curated, { portraitSrc: (k, ver) => `/api/portrait/${k}${ver ? `?v=${ver}` : ""}`, nowYear: 2026 })?.src,
		"/api/portrait/K22190?v=v1",
	);

	const [kaegi] = match(["Viviane Kägi"], "2026-07-06");
	const vk = view(kaegi);
	assert.equal(vk.role, "Kantonsrätin · GLP · 15. Wahlkreis (Winterthur Land)");
	assert.equal(vk.portrait, null);
	assert.equal(vk.wikidataUrl, null);

	const [meier] = match(["R. Meier"], "1956-05-14");
	assert.equal(view(meier).role, "Regierungsrat · BGB");
	assert.equal(view(meier).lifespan, "1897–1980");

	const [graf] = match(["Emil Graf"], "1925-01-01");
	assert.equal(view(graf).role, "Kantonsrat · Wahlkreis Zürich", "Einbuchstaben-Kürzel «S» weglassen");

	const [wyss] = match(["von Wyss"], "1855-01-01");
	assert.equal(view(wyss).name, "Georg von Wyss");
});

test("sortPersonViews: Porträts zuerst, sonst Reihenfolge behalten", () => {
	const ms = match(["Viviane Kägi", "Beat Habegger", "Thomas Wirth"], "2025-09-29");
	const views = sortPersonViews(ms.map((m) => toPersonView(m, { portraitSrc: (q) => q, nowYear: 2026 })));
	assert.deepEqual(views.map((v) => v.id), [10, 11]);
});

// --- Dokument-Abgleich: erkannte Personen, Nennung im Titel ---------------------

test("matchKrdbDocument: erkannte Personen, Titel-Nennung über die eigene Namensform", () => {
	const { matches, titleIds } = matchKrdbDocument(INDEX, {
		persons: ["Marcel Lenggenhager", "Jürg Sulser"],
		date: "2018-09-24",
		title: "Interpellation Marcel Lenggenhager (BDP, Gossau) betreffend Verkehr",
		body: "Marcel Lenggenhager (BDP, Gossau): Ich begründe. Ratspräsident Jürg Sulser: Das Wort hat der Regierungsrat.",
	});
	assert.deepEqual(ids(matches), [39, 38]);
	assert.deepEqual(titleIds, [39]);
	// Vor dem Einsitz: Sulser war 2012 noch nicht Mitglied, Lenggenhager schon.
	assert.deepEqual(
		ids(matchKrdbDocument(INDEX, { persons: ["Marcel Lenggenhager", "Jürg Sulser"], date: "2012-09-24" }).matches),
		[39],
	);
	assert.deepEqual(matchKrdbDocument(INDEX, { persons: ["Jürg Sulser"], date: null }), { matches: [], titleIds: [] });
});

test("matchKrdbDocument: ohne erkannte Personen keine Zuordnung, auch wenn Namen im Text stehen", () => {
	assert.deepEqual(
		matchKrdbDocument(INDEX, {
			persons: [],
			date: "2018-09-24",
			title: "Interpellation Marcel Lenggenhager (BDP, Gossau)",
			body: "Ratspräsident Jürg Sulser: Das Wort hat der Interpellant.",
		}),
		{ matches: [], titleIds: [] },
	);
});

test("matchKrdbDocument: Titel zählt nur, wenn die Form dort für sich allein dieselbe Person ergibt", () => {
	// «Walther» im Titel ist erst über «Gustav Walther» im Text eindeutig (Koreferenz) –
	// der Titel allein lässt offen, welcher der beiden Walther gemeint ist.
	const coref = matchKrdbDocument(INDEX, {
		persons: ["Gustav Walther", "Walther"],
		date: "1956-01-01",
		title: "Motion Walther betreffend Strassenbau",
	});
	assert.deepEqual(ids(coref.matches), [1]);
	assert.deepEqual(coref.titleIds, []);
	const full = matchKrdbDocument(INDEX, {
		persons: ["Gustav Walther"],
		date: "1956-01-01",
		title: "Motion Gustav Walther, Dübendorf, betreffend Strassenbau",
	});
	assert.deepEqual(full.titleIds, [1]);
	// Altbestand: Titel «Motion Name - Ort», im Text nur der Nachname erkannt.
	const old = matchKrdbDocument(INDEX, {
		persons: ["Habegger"],
		date: "2025-09-29",
		title: "Motion Beat Habegger - Pfäffikon vom 12. Mai 2025 betreffend Strassen",
	});
	assert.deepEqual(old.titleIds, [10]);
	// Im Text nur die Initiale, im Titel der volle Vorname («W. Hochuli» ↔ «Dr. Willy Hochuli»).
	const initial = matchKrdbDocument(INDEX, {
		persons: ["B. Habegger"],
		date: "2025-09-29",
		title: "Interpellation Dr. Beat Habegger (FDP, Pfäffikon) vom 12. Mai 2025 betreffend Strassen",
	});
	assert.deepEqual(initial.titleIds, [10]);
	// Ein Vorname, der nicht passt, nennt die zugeordnete Person nicht – auch nicht,
	// wenn der Nachname allein (Formvergleich) auf sie führen würde.
	assert.deepEqual(
		matchKrdbDocument(INDEX, { persons: ["B. Habegger"], date: "2025-09-29", title: "Anfrage Kurt Habegger betreffend Strassen" }).titleIds,
		[],
	);
	assert.deepEqual(
		matchKrdbDocument(INDEX, { persons: ["Habegger"], date: "2025-09-29", title: "Einzelinitiative Dr. Hans Habegger, Pfäffikon, betreffend Strassen" })
			.titleIds,
		[],
	);
	// Doppelname: «Keller Habegger» ist nicht der Kantonsrat Beat Habegger.
	assert.deepEqual(
		matchKrdbDocument(INDEX, {
			persons: ["Habegger"],
			date: "2025-09-29",
			title: "Wahl eines Mitglieds des Verwaltungsgerichts für die zurücktretende Leana Keller Habegger",
		}).titleIds,
		[],
	);
	// Nachname ohne Vornamen, mit Anrede und Ort («Herrn Habegger in Pfäffikon»).
	assert.deepEqual(
		matchKrdbDocument(INDEX, { persons: ["Habegger"], date: "2025-09-29", title: "Entlassung des Herrn Habegger in Pfäffikon" }).titleIds,
		[10],
	);
	// Komma trennt: «a. S.» vor dem Komma sind keine Initialen.
	assert.deepEqual(
		matchKrdbDocument(INDEX, {
			persons: ["B. Habegger"],
			date: "2025-09-29",
			title: "Dringliche Interpellation Peter Muster, Oetwil a. S., Beat Habegger, Pfäffikon, betreffend Strassen",
		}).titleIds,
		[10],
	);
	// Zwei zugeordnete Walther, im Titel nur die gemeinsame Initiale ⇒ keine Titel-Nennung.
	const both = matchKrdbDocument(INDEX, {
		persons: ["Gustav Walther", "Hans Walther"],
		date: "1956-01-01",
		title: "Motion G. Walther und H. Walther betreffend Strassenbau",
	});
	assert.deepEqual(ids(both.matches), [1, 2]);
	assert.deepEqual(both.titleIds, [1, 2]);
	assert.deepEqual(
		matchKrdbDocument(INDEX, { persons: ["Gustav Walther", "Hans Walther"], date: "1956-01-01", title: "Motion Walther betreffend Strassenbau" })
			.titleIds,
		[],
	);
	// Eine widersprechende vollere Form im Dokument bremst den nackten Nachnamen auch im Titel.
	assert.deepEqual(
		matchKrdbDocument(INDEX, { persons: ["Hans Keller", "Keller"], date: "1905-01-01", title: "Petition Keller" }),
		{ matches: [], titleIds: [] },
	);
	assert.deepEqual(matchKrdbDocument(INDEX, { persons: ["Keller"], date: "1905-01-01", title: "Petition Keller" }).titleIds, [31]);
});

test("krdbIndexFields: IDs aufsteigend, Titel-Teilmenge", () => {
	const f = krdbIndexFields(INDEX, {
		persons: ["Jürg Sulser", "Marcel Lenggenhager"],
		date: "2018-09-24",
		title: "Interpellation Marcel Lenggenhager (BDP, Gossau)",
		body: "Marcel Lenggenhager (BDP, Gossau): Ich begründe. Ratspräsident Jürg Sulser: Das Wort hat der Regierungsrat.",
	});
	assert.deepEqual(f, { krdbIds: [38, 39], krdbTitleIds: [39] });
	assert.deepEqual(krdbIndexFields(INDEX, { persons: [], date: "2018-09-24", title: "Mitteilungen", body: "" }), {
		krdbIds: [],
		krdbTitleIds: [],
	});
});
