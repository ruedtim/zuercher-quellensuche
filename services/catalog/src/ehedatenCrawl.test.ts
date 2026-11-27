import { test } from "node:test";
import assert from "node:assert/strict";
import { entryDoc } from "./ehedaten.ts";
import { crawlDate, crawlEntry, crawlLinks, splitEdbTitle, splitZusatz } from "./ehedatenCrawl.ts";
import type { CatalogField, CatalogLink, CatalogRecord } from "./types.ts";

// Erfundene Namen in den Mustern der Ehedatenbank, wie sie die Katalogseiten zeigen.

const field = (key: string, text: string, links: CatalogLink[] = []): CatalogField => ({ label: key, key, text, lines: text.split("\n"), links });

function rec(over: Partial<CatalogRecord> = {}, extra: CatalogField[] = []): CatalogRecord {
  return {
    id: 1999001,
    url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1999001",
    signature: "E III 30.1, EDB 276",
    title: "Muster, Hans Jakob, Ottikon (Illnau-Effretikon), getraut mit Beispiel, Elisabeth, Nussbaumen TG",
    level: "Dokument",
    date_text: "03.03.1689",
    parent_id: 1,
    path: [],
    sections: [
      {
        section: "Identifikation und Inhalt",
        key: "identifikation_und_inhalt",
        fields: [field("inhalt_und_form", 'Zusatzinformation:\n"Hans Jogli Muoster"; verkündet 22. Febr.; getraut zu Wädenswil\n-')],
      },
      {
        section: "Weitere Angaben",
        key: "weitere_angaben",
        fields: [field("provenienz", "Kirchgemeinde Wädenswil"), field("anmerkungen", "S. 12"), ...extra],
      },
    ],
    fields: {},
    ...over,
  };
}

test("Titel: Nachname, Vorname, Herkunft je Person; weitere Zeilen getrennt", () => {
  const t = splitEdbTitle("Muster, Hans Jakob, Ottikon (Illnau-Effretikon), getraut mit Beispiel, Elisabeth");
  assert.deepEqual(t, {
    titel: "Muster, Hans Jakob, Ottikon (Illnau-Effretikon), getraut mit Beispiel, Elisabeth",
    mann: { nachname: "Muster", vorname: "Hans Jakob", herkunft: "Ottikon (Illnau-Effretikon)" },
    frau: { nachname: "Beispiel", vorname: "Elisabeth", herkunft: "" },
    rest: [],
  });
  const zwei = splitEdbTitle("Muster, Heinrich, Rüti, getraut mit Beispiel, Anna, Bauma\nIn Bauma zweimal eingetragen.\n-");
  assert.equal(zwei?.titel, "Muster, Heinrich, Rüti, getraut mit Beispiel, Anna, Bauma");
  assert.equal(zwei?.frau.herkunft, "Bauma");
  assert.deepEqual(zwei?.rest, ["In Bauma zweimal eingetragen.", "-"]);
  assert.equal(splitEdbTitle("Ratssitzung vom 1. Mai 1650"), null);
  assert.equal(splitEdbTitle(null), null);
});

test("Zusatzinfo: Bräutigam und Braut je eine Zeile, «-» und fehlende Zeile leer", () => {
  assert.deepEqual(splitZusatz('Zusatzinformation:\n"Muoster"\n-'), { mann: '"Muoster"', frau: "-", notes: [] });
  assert.deepEqual(splitZusatz("Zusatzinformation:\n-\nJf."), { mann: "-", frau: "Jf.", notes: [] });
  assert.deepEqual(splitZusatz("Zusatzinformation:\ngetraut zu Zürich"), { mann: "getraut zu Zürich", frau: "", notes: [] });
  // Später im Katalog ergänzt: ohne Kopfzeile.
  assert.deepEqual(splitZusatz('-\n"Beispielin"'), { mann: "-", frau: '"Beispielin"', notes: [] });
  assert.deepEqual(splitZusatz(undefined), { mann: "", frau: "", notes: [] });
});

test("Zusatzinfo: «XXX» einer Kapitelzahl wiederhergestellt, auch beim Bräutigam", () => {
  const frau = splitZusatz('Zusatzinformation:\nHerr; Pfarrer zu Beispielwil\nJf.; "Ps. C\nII.16."');
  assert.equal(frau.mann, "Herr; Pfarrer zu Beispielwil");
  assert.equal(frau.frau, 'Jf.; "Ps. CXXXII.16."');
  assert.equal(frau.notes[0].kind, "bibelstelle");
  assert.equal(splitZusatz('Zusatzinformation:\n-\n"concionatus ex Prov.\nI.12."').frau, '"concionatus ex Prov. XXXI.12."');
  assert.equal(splitZusatz('Zusatzinformation:\n-\n"T[ext]. Psalm\nVII:5."').frau, '"T[ext]. Psalm XXXVII:5."');
  assert.equal(splitZusatz('Zusatzinformation:\n-\n"T[ext]. Prov.\n. 8 b."').frau, '"T[ext]. Prov. XXX. 8 b."');
  // Der Umbruch im Text des Bräutigams: die zweite Zeile gehört noch ihm.
  const mann = splitZusatz('Zusatzinformation:\nLeutnant; viduus; "Ps.\nIII. 22."\nJf.');
  assert.equal(mann.mann, 'Leutnant; viduus; "Ps. XXXIII. 22."');
  assert.equal(mann.frau, "Jf.");
  // «CXXVIII» hat nur zwei X und bleibt, wie es ist; ein Wort nach dem Bibelbuch ist keine Kapitelzahl.
  assert.deepEqual(splitZusatz('Zusatzinformation:\n"Ps. CXXVIII. 1. 2."\n-'), { mann: '"Ps. CXXVIII. 1. 2."', frau: "-", notes: [] });
  assert.deepEqual(splitZusatz('Zusatzinformation:\nText "Ps.\nIhre Mutter'), { mann: 'Text "Ps.', frau: "Ihre Mutter", notes: [] });
});

test("Zusatzinfo: «x» am Wortende vor dem Umbruch zurückgeholt, «Xander» bleibt", () => {
  const p = splitZusatz('Zusatzinformation:\ngetraut zu Peseu\nX"b. d. 24sten 9br. 1743"');
  assert.equal(p.mann, "getraut zu Peseux");
  assert.equal(p.frau, '"b. d. 24sten 9br. 1743"');
  assert.equal(p.notes[0].kind, "x-verschoben");
  assert.deepEqual(splitZusatz("Zusatzinformation:\ngetraut zu Sa\nX-"), { mann: "getraut zu Sax", frau: "-", notes: [{ kind: "x-verschoben", detail: "«getraut zu Sa⏎X-» → «getraut zu Sax»" }] });
  assert.equal(splitZusatz("Zusatzinformation:\ngetraut zu Sa\nXJf.").frau, "Jf.");
  assert.deepEqual(splitZusatz('Zusatzinformation:\n"Jagli Beispiels" Sohn\nXander Musters Tochter'), {
    mann: '"Jagli Beispiels" Sohn',
    frau: "Xander Musters Tochter",
    notes: [],
  });
});

test("Zusatzinfo: mehr als zwei Zeilen – erste Zeile Bräutigam, ausser die letzte ist «-»", () => {
  const dup = splitZusatz('Zusatzinformation:\nKirchenpfleger\naet. 19\n"aet. 19"');
  assert.equal(dup.mann, "Kirchenpfleger");
  assert.equal(dup.frau, 'aet. 19\n"aet. 19"');
  assert.equal(dup.notes[0].kind, "mehrzeilig");
  const leer = splitZusatz("Zusatzinformation:\nverkündet 6. Juli. [Die Abschrift gibt den 14. Juli.]\nTrauung um 9 Uhr.]\n-");
  assert.equal(leer.mann, "verkündet 6. Juli. [Die Abschrift gibt den 14. Juli.]\nTrauung um 9 Uhr.]");
  assert.equal(leer.frau, "");
});

test("Links: GND über den Namen im Linktext, HLS zur Person mit GND, sonst zum Bräutigam", () => {
  const mann = { nachname: "Muster", vorname: "Hans Jakob", herkunft: "" };
  const frau = { nachname: "Beispiel", vorname: "Elisabeth", herkunft: "" };
  const links = (gnd: CatalogLink[], web: CatalogLink[]) => rec({}, [field("gnd_links", "", gnd), field("weblinks", "", web)]);
  const hls = { text: "Artikel im HLS", href: "https://hls-dhs-dss.ch/de/articles/012345/2005-08-29/" };

  const braut = crawlLinks(links([{ text: "Elisabeth Beispiel", href: "http://d-nb.info/gnd/123456789" }], [hls]), mann, frau);
  assert.deepEqual(braut.frau, { gnd: "https://d-nb.info/gnd/123456789", hls: "https://hls-dhs-dss.ch/de/articles/012345/" });
  assert.deepEqual(braut.mann, { gnd: "", hls: "" });
  assert.deepEqual(braut.notes, []);

  // Nur der Nachname passt («der Ältere», andere Vornamen).
  const nach = crawlLinks(links([{ text: "Jakob Muster (der Ältere)", href: "https://d-nb.info/gnd/10724901X" }], []), mann, frau);
  assert.equal(nach.mann.gnd, "https://d-nb.info/gnd/10724901X");

  // Kein Name im Linktext: Bräutigam, wie die Ehedatenbank fast immer.
  const ohne = crawlLinks(links([{ text: "", href: "http://<br />" }], [hls]), mann, frau);
  assert.deepEqual(ohne.mann, { gnd: "", hls: "https://hls-dhs-dss.ch/de/articles/012345/" });
  assert.deepEqual(
    ohne.notes.map((n) => n.kind),
    ["link-ungueltig", "link-zuordnung"],
  );
  // Andere Weblinks (Hochzeitsgedichte bei e-rara) sind kein HLS.
  assert.deepEqual(crawlLinks(links([], [{ text: "Gedrucktes Hochzeitsgedicht", href: "https://doi.org/10.3931/e-rara-1" }]), mann, frau).mann, { gnd: "", hls: "" });
});

test("Datum: Schreibweise des Katalogs, Halbgeviertstrich, ohne «a. St.»", () => {
  assert.deepEqual(crawlDate("ca. 23.07.1553 - ca. 13.08.1553"), {
    text: "ca. 23.07.1553 – ca. 13.08.1553",
    isoVon: "1553-07-23",
    isoBis: "1553-08-13",
    dateFrom: 1553,
    dateTo: 1553,
    sortDate: 15530723,
  });
  assert.equal(crawlDate("zwischen ca. 10.03.1683 und ca. 07.09.1683")?.text, "zwischen ca. 10.03.1683 und ca. 07.09.1683");
  assert.equal(crawlDate("zwischen ca. 10.03.1683 und ca. 07.09.1683")?.isoVon, "1683-03-11");
  assert.equal(crawlDate("12.05.1639 (a. St.)")?.text, "12.05.1639");
  assert.equal(crawlDate("18. Jh."), null);
});

test("Eintrag: gecrawlte Einheit → Dokument wie aus der Zenodo-CSV", () => {
  const r = crawlEntry(rec());
  assert.ok(r.entry);
  const d = entryDoc(r.entry);
  assert.equal(d.id, 1999001);
  assert.equal(d.band, "E III 30.1");
  assert.equal(d.eintrag, 276);
  assert.equal(d.kirchgemeinde, "Wädenswil");
  assert.equal(d.seite, "S. 12");
  assert.equal(d.datum, "03.03.1689");
  assert.equal(d.mannName, "Hans Jakob Muster");
  assert.equal(d.mannOrt, "Illnau-Effretikon");
  assert.equal(d.mannZusatz, '"Hans Jogli Muoster"; verkündet 22. Febr.; getraut zu Wädenswil');
  assert.equal(d.frauZusatz, "");
  assert.equal(d.frauOrt, "Nussbaumen TG");
  assert.deepEqual(d.raum, ["zh", "ch"]);
  assert.equal(d.art, "trauung");
});

test("Eintrag: Zusatzinfo, die im Titel steht; ohne lesbares Datum keiner", () => {
  const sections = rec().sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== "inhalt_und_form") }));
  const r = crawlEntry(rec({ title: "Muster, Heinrich, Rüti, getraut mit Beispiel, Anna, Bauma\nIn Bauma zweimal eingetragen.\n-", sections }));
  assert.equal(r.entry?.titel, "Muster, Heinrich, Rüti, getraut mit Beispiel, Anna, Bauma");
  assert.equal(r.entry?.mann.zusatz, "In Bauma zweimal eingetragen.");
  assert.equal(r.entry?.frau.zusatz, "-");
  assert.equal(r.notes[0].kind, "titel-zusatz");
  const ohne = crawlEntry(rec({ date_text: "s. d. (sine dato)" }));
  assert.equal(ohne.entry, null);
  assert.match(ohne.reason ?? "", /Datum nicht lesbar/);
});
