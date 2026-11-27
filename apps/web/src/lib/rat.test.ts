// Lauf: npx tsx --test src/lib/rat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_RAT_DIRECTORY_QUERY,
	gndUrl,
	hlsUrl,
	parseRatDirectoryQuery,
	personRefsInHtml,
	ratDirectoryUrl,
	ratPersonUrl,
	rmSessionsHref,
	ssrqUrl,
} from "./rat";

const parse = (qs: string) => parseRatDirectoryQuery(new URLSearchParams(qs));

test("Verzeichnis: Parameter lesen, Ungültiges fällt auf den Default", () => {
	assert.deepEqual(parse(""), DEFAULT_RAT_DIRECTORY_QUERY);
	assert.deepEqual(parse("q=%20Escher%20%20Luchs%20&zunft=Saffran&funktion=B%C3%BCrgermeister&jh=17&rm=1&sort=eintritt&seite=3"), {
		q: "Escher Luchs",
		guild: "Saffran",
		office: "Bürgermeister",
		century: 17,
		rmOnly: true,
		sort: "entry",
		page: 3,
	});
	assert.equal(parse("jh=19").century, null, "kein 19. Jahrhundert im Register");
	assert.equal(parse("jh=abc").century, null);
	assert.equal(parse("seite=0").page, 1);
	assert.equal(parse("seite=2.5").page, 1);
	assert.equal(parse("sort=docs").sort, "name");
	assert.equal(parse(`q=${"x".repeat(200)}`).q.length, 80);
});

test("Verzeichnis: URL und Parameter gehen ineinander über", () => {
	assert.equal(ratDirectoryUrl(), "/rat");
	assert.equal(ratDirectoryUrl({ page: 1 }), "/rat", "Seite 1 fällt weg");
	const q = { ...DEFAULT_RAT_DIRECTORY_QUERY, q: "Hirzel", guild: "Kämbel", century: 16 as const, rmOnly: true, sort: "entry" as const, page: 2 };
	const url = ratDirectoryUrl(q);
	assert.deepEqual(parse(url.split("?")[1]), q);
});

test("Links: Person, Sitzungen der Amtszeit, GND, HLS", () => {
	assert.equal(ratPersonUrl(38509), "/rat/38509");
	const href = rmSessionsHref([300, 301, 470]);
	const params = new URLSearchParams(href.split("?")[1]);
	assert.equal(params.get("series"), "RM");
	assert.equal(params.get("volumeNr"), "300,301,470");
	assert.equal(params.get("sort"), "date_asc");
	assert.equal(params.get("view"), "documents");
	assert.equal(params.get("q"), null);
	assert.equal(new URLSearchParams(rmSessionsHref([300], "Rahn").split("?")[1]).get("q"), "Rahn");
	assert.equal(gndUrl("128508590"), "https://d-nb.info/gnd/128508590");
	assert.equal(hlsUrl("018087"), "https://hls-dhs-dss.ch/de/articles/018087/");
	assert.equal(ssrqUrl("per002157"), "https://personae.ssrq-sds-fds.ch/?query=per002157");
});

test("personRefsInHtml: Normdaten der ausgezeichneten Namen, je Person einmal, erste Nennung zuerst", () => {
	const html =
		'<head>Prnt. Herr <span class="tei-person" data-gnd="143681346" data-hls="018060">Holtzhalb</span> und ' +
		'<span class="tei-person" data-id="p2" data-gnd="105381173X">Landolt</span></head><p>… ' +
		// unlesbare GND in Transkribus, nur die SSRQ-ID: eigener Eintrag (die Karte führt beide über das
		// Register zusammen); die spätere Nennung mit beidem ergänzt den ersten Eintrag
		'<span class="tei-person" data-ssrq="per002157">Holzhalb</span> ' +
		'<span class="tei-person" data-gnd="143681346" data-hls="018060" data-ssrq="per002157">Holzhalb</span> ' +
		'<span class="tei-person">Rahn</span> <span class="tei-place" data-gnd="4068038-6">Zürich</span></p>';
	assert.deepEqual(personRefsInHtml(html), [
		{ gnd: "143681346", hls: "018060", ssrq: "per002157" },
		{ gnd: "105381173X", hls: null, ssrq: null },
		{ gnd: null, hls: null, ssrq: "per002157" },
	]);
	assert.deepEqual(personRefsInHtml(null), []);
	assert.deepEqual(
		personRefsInHtml('<span class="tei-person" data-gnd="x" data-hls="018060">A</span>'),
		[],
		"nur GND-Nummern und SSRQ-IDs machen eine Person",
	);
});
