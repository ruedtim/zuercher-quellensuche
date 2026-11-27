// Lauf: npx tsx --test src/lib/server/askRedirect.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { askRedirectTarget } from "./askRedirect";

const target = (qs: string, semantic = true) => {
	const t = askRedirectTarget(new URL(`http://local/search?${qs}`), { semantic });
	return t === null ? null : new URL(`http://local${t}`).searchParams;
};

test("ohne alte Parameter: keine Weiterleitung", () => {
	assert.equal(askRedirectTarget(new URL("http://local/search?q=Tollwut&theme=Seuchen"), { semantic: true }), null);
});

test("Frage wird Thema im Reiter der Adresse, Zeitraum aus der Frage als Filter", () => {
	const sp = target("ask=Was+beschloss+der+Kantonsrat+im+Jahr+1918+zur+Grippe%3F&allSources=1&model=agent")!;
	assert.equal(sp.get("dateFrom"), "1918");
	assert.equal(sp.get("dateTo"), "1918");
	assert.match(sp.get("theme")!, /Kantonsrat .*Grippe/);
	assert.doesNotMatch(sp.get("theme")!, /1918/, "das Jahr steckt im Filter");
	for (const k of ["ask", "allSources", "model", "view"]) assert.equal(sp.has(k), false, k);
	// Reiter bleibt; ein blosses Jahr gilt bewusst nicht als Zeitraum (wie bisher die KI-Antwort).
	const cat = target("ask=Grippe+1918&view=catalog")!;
	assert.equal(cat.get("view"), "catalog");
	assert.equal(cat.has("dateFrom"), false);
	assert.equal(cat.get("theme"), "Grippe 1918");
});

test("Präposition vor dem Zeitraum fällt mit ihm aus dem Thema", () => {
	assert.equal(target("ask=Bau+der+Eisenbahn+im+19.+Jahrhundert")!.get("theme"), "Bau der Eisenbahn");
	assert.equal(target("ask=Typhus+in+den+1920er+Jahren+in+Z%C3%BCrich")!.get("theme"), "Typhus in Zürich");
	const sp = target("ask=Wie+ver%C3%A4nderte+sich+die+Armenpflege+im+19.+Jahrhundert%3F")!;
	assert.equal(sp.get("theme"), "Wie veränderte sich die Armenpflege?");
	assert.equal(sp.get("dateFrom"), "1801");
});

test("Jahrhundert ab 700 wie der Archivkatalog", () => {
	const sp = target("ask=Urkunden+im+14.+Jahrhundert")!;
	assert.equal(sp.get("dateFrom"), "1301");
	assert.equal(sp.get("dateTo"), "1400");
});

test("ohne Zeitraum: die ganze Frage als Thema", () => {
	const sp = target("ask=Massnahmen+gegen+die+Tollwut")!;
	assert.equal(sp.get("theme"), "Massnahmen gegen die Tollwut");
	assert.equal(sp.has("dateFrom"), false);
});

test("gesetztes Thema, Suchbegriff und Zeitraum gehen vor; Seite fällt", () => {
	const sp = target("ask=Grippe+im+Jahr+1918&theme=Seuchen&dateFrom=1900&page=4")!;
	assert.equal(sp.get("theme"), "Seuchen");
	assert.equal(sp.get("dateFrom"), "1900");
	assert.equal(sp.has("dateTo"), false);
	assert.equal(sp.has("page"), false);
});

test("ohne Embed-Service: Stichwortsuche über die Inhaltswörter", () => {
	const sp = target("ask=Welche+Massnahmen+gegen+die+Tollwut+gab+es%3F", false)!;
	assert.equal(sp.has("theme"), false);
	assert.match(sp.get("q")!, /Tollwut/);
	assert.doesNotMatch(sp.get("q")!, /Welche|gab/);
});

test("gesetzter Zeitraum: die Datumswörter der Frage fallen trotzdem weg", () => {
	const lex = target("view=catalog&ask=Urkunden+im+14.+Jahrhundert&dateFrom=1350", false)!;
	assert.equal(lex.get("q"), "Urkunden");
	assert.equal(lex.get("dateFrom"), "1350");
	assert.equal(lex.has("dateTo"), false, "der gesetzte Zeitraum bleibt, wie er ist");
	const sem = target("ask=Bau+der+Eisenbahnlinien+zwischen+1850+und+1870&dateFrom=1840&dateTo=1880")!;
	assert.doesNotMatch(sem.get("theme")!, /1850|1870/);
	assert.match(sem.get("theme")!, /Eisenbahnlinien/);
	assert.equal(sem.get("dateFrom"), "1840");
});

test("nur alte Schalter (noai, confidential): sie fallen weg, sonst nichts", () => {
	const sp = target("q=Tollwut&noai=1&confidential=1")!;
	assert.equal(sp.get("q"), "Tollwut");
	assert.equal(sp.has("noai"), false);
	assert.equal(sp.has("confidential"), false);
	assert.equal(sp.has("theme"), false);
});

test("Wortfolge in Anführungszeichen: Suchbegriff; ohne Inhalt daneben eine reine Stichwortsuche", () => {
	for (const ask of ['"Pause"', "“Pause”", "«Pause»", 'Was steht über "Pause"?']) {
		const sp = target(`ask=${encodeURIComponent(ask)}`)!;
		assert.equal(sp.get("q"), '"Pause"', ask);
		assert.equal(sp.has("theme"), false, ask);
	}
	const two = target(`ask=${encodeURIComponent('"Escher vom Glas" "Hirzel"')}`)!;
	assert.equal(two.get("q"), '"Escher vom Glas" "Hirzel"');
	assert.equal(two.has("theme"), false);
});

test("Wortfolge und Frage: die ganze Frage reiht als Thema die Treffer der Wortfolge", () => {
	const sp = target(`ask=${encodeURIComponent('Was unternahm der Rat gegen „Tollwut“?')}`)!;
	assert.equal(sp.get("q"), '"Tollwut"');
	assert.equal(sp.get("theme"), "Was unternahm der Rat gegen Tollwut?");
	const dated = target(`ask=${encodeURIComponent('"Pest" Massnahmen der Obrigkeit im 17. Jahrhundert')}`)!;
	assert.equal(dated.get("q"), '"Pest"');
	assert.equal(dated.get("theme"), "Pest Massnahmen der Obrigkeit");
	assert.equal(dated.get("dateFrom"), "1601");
	assert.equal(dated.get("dateTo"), "1700");
});

test("Zeitraum nur ausserhalb der Anführungszeichen; nur ein Zeitraum daneben macht kein Thema", () => {
	const inside = target(`ask=${encodeURIComponent('"im 19. Jahrhundert"')}`)!;
	assert.equal(inside.get("q"), '"im 19. Jahrhundert"');
	assert.equal(inside.has("dateFrom"), false);
	const beside = target(`ask=${encodeURIComponent('"Gaswerk" im 19. Jahrhundert')}`)!;
	assert.equal(beside.get("q"), '"Gaswerk"');
	assert.equal(beside.get("dateFrom"), "1801");
	assert.equal(beside.has("theme"), false);
});

test("Anführungszeichen: ohne Embed-Service nur die Wortfolgen; gesetzter Suchbegriff geht vor", () => {
	const lex = target(`ask=${encodeURIComponent('Was weiss man über "Escher vom Glas"?')}`, false)!;
	assert.equal(lex.get("q"), '"Escher vom Glas"');
	assert.equal(lex.has("theme"), false);
	const kept = target(`ask=${encodeURIComponent('"Pause"')}&q=Urlaub`)!;
	assert.equal(kept.get("q"), "Urlaub");
	assert.equal(kept.get("theme"), '"Pause"');
	const odd = target(`ask=${encodeURIComponent('Escher "vom Glas')}`)!;
	assert.equal(odd.has("q"), false, "ungerade Zahl: wie ohne Anführungszeichen");
	assert.equal(odd.get("theme"), 'Escher "vom Glas');
});

test("Beispiel der Startseite: Name wörtlich, die Frage reiht", () => {
	const sp = target(`ask=${encodeURIComponent('Wann wurde "Susanna Ziegler" eingebürgert?')}`)!;
	assert.equal(sp.get("q"), '"Susanna Ziegler"');
	assert.equal(sp.get("theme"), "Wann wurde Susanna Ziegler eingebürgert?");
	assert.equal(sp.has("dateFrom"), false);
});
