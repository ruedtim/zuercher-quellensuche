import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEditionLinks,
  compareWords,
  containment,
  decideRmMatch,
  editionBodyText,
  matchRmEntry,
  origDateOf,
  otherArchivesLine,
  parseQzhText,
  parseRmIdent,
  parseRmSignature,
  parseSsrqText,
  pickByText,
  rmBodyText,
  scopeLinksOf,
  serializeEditionLinks,
  ssrqLabel,
  ssrqParts,
  stazhCatalogIdOf,
  textPool,
  textScore,
  compareSequence,
  type EditionLinksFile,
  type EditionText,
  type RmSessionSpan,
} from "./editionLinks.ts";

/** Kopf und Text wie in stazh/qzh-data bzw. stazh/erqzh-data, auf das Nötige gekürzt. */
function tei(opts: { idno: string; source?: string; head: string; origin?: string; body?: string }): string {
  return `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>Reihe</title></titleStmt>
<sourceDesc><msDesc><msIdentifier><idno${opts.source ? ` source="${opts.source}"` : ""}>${opts.idno}</idno></msIdentifier>
<head>${opts.head}</head><msContents><msItem><filiation type="original"><origDate when="1500-01-01"/></filiation></msItem></msContents>
<history><origin>${opts.origin ?? ""}</origin></history></msDesc></sourceDesc></fileDesc></teiHeader>
<text><body>${opts.body ?? ""}</body><back><div>Kommentar der Bearbeiterin</div></back></text></TEI>`;
}

test("QZH-Stück: Katalog-ID, Signatur, Titel, Datum, Permalink", () => {
  const xml = tei({
    idno: "StAZH B II 204, S. 24-25 (Manual des Stadtschreibers)",
    source: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=5354900",
    head: "Ratsbeschluss betreffend Verfolgung von <persName>Täufern</persName>",
    origin: '<origDate when="1583-09-21"/>',
  });
  assert.deepEqual(parseQzhText("QZH_401", xml), {
    edition: "qzh",
    id: "QZH_401",
    label: "QZH_401",
    url: "https://qzh.sources-online.org/quellenstuecke/QZH_401",
    witness: false,
    catalogIds: [5354900],
    otherArchives: [],
    signature: "StAZH B II 204, S. 24-25 (Manual des Stadtschreibers)",
    title: "Ratsbeschluss betreffend Verfolgung von Täufern",
    date: { from: "1583-09-21", to: "1583-09-21" },
  });
  // Klein geschriebenes id=, ohne Quelle keine Katalog-ID, Datum aus dem msDesc, wenn origin leer ist.
  assert.deepEqual(parseQzhText("QZH_026", tei({ idno: "x", source: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?id=4703943", head: "h" }))?.catalogIds, [4703943]);
  const noSource = parseQzhText("QZH_012", tei({ idno: "ZBZ Ms J 143", head: "h" }));
  assert.deepEqual(noSource?.catalogIds, []);
  assert.deepEqual(noSource?.date, { from: "1500-01-01", to: "1500-01-01" });
  assert.equal(parseQzhText("Register", tei({ idno: "x", head: "h" })), null);
});

test("Katalog-ID nur aus Links auf den Online-Katalog des Staatsarchivs", () => {
  assert.equal(stazhCatalogIdOf("https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1236054"), 1236054);
  assert.equal(stazhCatalogIdOf("http://suche.staatsarchiv.djiktzh.ch/detail.aspx?id=7"), 7);
  assert.equal(stazhCatalogIdOf("https://archivkatalog.ji.zh.ch/detail.aspx?id=42&x=1"), 42);
  assert.equal(stazhCatalogIdOf("HTTPS://Archivkatalog.JI.ZH.CH/Detail.aspx?Id=43"), 43);
  // Mitten im Wert, hinter der Signatur; ein fremder Link davor schadet nicht.
  assert.equal(stazhCatalogIdOf("StAZH X 1.2, Nr. 3 / https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=99"), 99);
  assert.equal(stazhCatalogIdOf("https://amsquery.stadt-zuerich.ch/detail.aspx?ID=5; https://archivkatalog.ji.zh.ch/detail.aspx?ID=6"), 6);
  // Kataloge anderer Archive (gleich gebaut, eigene IDs), Doppelgänger des Hosts, Fremdes.
  for (const value of [
    "https://amsquery.stadt-zuerich.ch/detail.aspx?ID=4711",
    "http://scope.stiftsarchiv.sg.ch/detail.aspx?ID=815",
    "https://suche.staatsarchiv.djiktzh.ch.example.org/detail.aspx?ID=1",
    "https://example.org/suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1",
    "suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1",
    "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1234567890",
    "https://example.org/detail?ID=1",
    "StAZH B II 19, S. 20",
    "",
  ]) {
    assert.equal(stazhCatalogIdOf(value), null, value);
  }
  assert.deepEqual(scopeLinksOf("StadtA X 1 / http://AMSQUERY.stadt-zuerich.ch:443/scope/detail.aspx?ID=4711&rec=2"), [
    { host: "amsquery.stadt-zuerich.ch", id: 4711, href: "http://AMSQUERY.stadt-zuerich.ch:443/scope/detail.aspx?ID=4711" },
  ]);
});

test("Rechtsquellen: Zitierform und Seite je Stück, weitere Überlieferungen", () => {
  assert.deepEqual(ssrqParts("SSRQ_ZH_NF_II_3_047_2"), { volume: "ZH_NF_II_3", nr: 47, part: 2 });
  assert.deepEqual(ssrqParts("SSRQ_ZH_NF_I_1_3_002_1"), { volume: "ZH_NF_I_1_3", nr: 2, part: 1 });
  assert.deepEqual(ssrqParts("SSRQ_ZH_NF_II_11_123"), { volume: "ZH_NF_II_11", nr: 123, part: null });
  for (const id of ["SSRQ_ZH_NF_I_1_3_000a_Vorwort", "SSRQ_ZH_NF_I_1_3_000c_Einleitung", "SSRQ_ZH_NF_II_3_volinfo", "SSRQ_ZH_NF_II_3_000"]) {
    assert.equal(ssrqParts(id), null, id);
  }
  assert.equal(ssrqLabel("ZH_NF_II_3", 40), "SSRQ ZH NF II/3 Nr. 40");
  assert.equal(ssrqLabel("ZH_NF_I_1_3", 2), "SSRQ ZH NF I/1/3 Nr. 2");

  const grund = parseSsrqText(
    "SSRQ_ZH_NF_II_3_040",
    tei({ idno: "StAZH B II 19, S. 20", source: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1236054", head: "Entscheid", origin: '<origDate when="1491-02-02"/>' }),
  );
  assert.equal(grund?.label, "SSRQ ZH NF II/3 Nr. 40");
  assert.equal(grund?.url, "https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_040");
  assert.equal(grund?.witness, false);
  assert.deepEqual(grund?.catalogIds, [1236054]);

  const ueberlieferung = parseSsrqText("SSRQ_ZH_NF_II_3_047_2", tei({ idno: "StAZH B II 40, S. 7", head: "Fähre" }));
  assert.equal(ueberlieferung?.label, "SSRQ ZH NF II/3 Nr. 47");
  assert.equal(ueberlieferung?.url, "https://rechtsquellen.sources-online.org/ZH_NF_II_3/SSRQ_ZH_NF_II_3_047");
  assert.equal(ueberlieferung?.witness, true);
  assert.equal(parseSsrqText("SSRQ_ZH_NF_II_3_047_1", tei({ idno: "C I", head: "Fähre" }))?.witness, false);

  // Vorlage in einem anderen Archiv: dessen ID ist keine Katalog-ID des Staatsarchivs.
  const stadtarchiv = parseSsrqText(
    "SSRQ_ZH_NF_II_3_015",
    tei({ idno: "StadtA Zürich X 1", source: "https://amsquery.stadt-zuerich.ch/detail.aspx?ID=4711", head: "Rodel" }),
  );
  assert.deepEqual(stadtarchiv?.catalogIds, []);
  assert.deepEqual(stadtarchiv?.otherArchives, [
    { host: "amsquery.stadt-zuerich.ch", id: 4711, href: "https://amsquery.stadt-zuerich.ch/detail.aspx?ID=4711", archive: "Stadtarchiv Zürich" },
  ]);
  assert.deepEqual(
    parseSsrqText("SSRQ_ZH_NF_II_3_001_1", tei({ idno: "StiASG X 1", source: "http://scope.stiftsarchiv.sg.ch/detail.aspx?ID=815", head: "Urkunde" }))?.otherArchives.map((o) => o.archive),
    ["Stiftsarchiv St. Gallen"],
  );
  // Unbekanntes Archiv: der Host steht für den Namen.
  assert.deepEqual(
    parseSsrqText("SSRQ_ZH_NF_II_3_002", tei({ idno: "Y 1", source: "https://scope.archiv.example.org/detail.aspx?ID=3", head: "h" }))?.otherArchives.map((o) => o.archive),
    ["scope.archiv.example.org"],
  );
  assert.deepEqual(grund?.otherArchives, []);
});

test("Entstehungsdatum: Tag, Monat, Jahr, Spanne", () => {
  const sd = (inner: string) => `<msDesc><history><origin>${inner}</origin></history></msDesc>`;
  assert.deepEqual(origDateOf(sd('<origDate when="1583-09-21"/>')), { from: "1583-09-21", to: "1583-09-21" });
  assert.deepEqual(origDateOf(sd('<origDate when="1588-02"/>')), { from: "1588-02-01", to: "1588-02-29" });
  assert.deepEqual(origDateOf(sd('<origDate when="1601"/>')), { from: "1601-01-01", to: "1601-12-31" });
  assert.deepEqual(origDateOf(sd('<origDate from="1572-01-02" to="1572-02-06"/>')), { from: "1572-01-02", to: "1572-02-06" });
  assert.deepEqual(origDateOf(sd('<origDate notBefore="1430" notAfter="1450"/>')), { from: "1430-01-01", to: "1450-12-31" });
  assert.equal(origDateOf(sd("")), null);
  assert.equal(origDateOf(sd('<origDate when="um 1500"/>')), null);
});

test("Ratsmanual-Stelle aus der Signatur der Vorlage", () => {
  assert.deepEqual(parseRmSignature("StAZH B II 204, S. 24-25 (Manual des Stadtschreibers)"), { band: "204", unit: "page", from: 24, to: 25, part: null });
  assert.deepEqual(parseRmSignature("StAZH B II 695, S. 35"), { band: "695", unit: "page", from: 35, to: 35, part: null });
  assert.deepEqual(parseRmSignature("StAZH B II 74, 2. Teil, S. 21"), { band: "74", unit: "page", from: 21, to: 21, part: 2 });
  assert.deepEqual(parseRmSignature("StAZH B II 29, S. 85, Eintrag 1"), { band: "29", unit: "page", from: 85, to: 85, part: null });
  assert.deepEqual(parseRmSignature("StAZH B II 12, S. 7f."), { band: "12", unit: "page", from: 7, to: 8, part: null });
  // Folio: Position 2n−1 (recto) bzw. 2n (verso).
  assert.deepEqual(parseRmSignature("StAZH B II 353, fol. 30v-31r"), { band: "353", unit: "folio", from: 60, to: 61, part: null });
  assert.deepEqual(parseRmSignature("StAZH B II 135, fol. 22v (Manual des Unterschreibers)"), { band: "135", unit: "folio", from: 44, to: 44, part: null });
  assert.deepEqual(parseRmSignature("StAZH B II 5, fol. 64r-v"), { band: "5", unit: "folio", from: 127, to: 128, part: null });
  assert.deepEqual(parseRmSignature("StAZH B II 4, Teil II, fol. 19v, Eintrag 1"), { band: "4", unit: "folio", from: 38, to: 38, part: 2 });
  assert.deepEqual(parseRmSignature("StAZH B II 555 a, S. 3"), { band: "555a", unit: "page", from: 3, to: 3, part: null });
  // Erste Nennung zählt, andere Vorlagen dahinter nicht.
  assert.equal(parseRmSignature("StAZH B II 227, S. 16 (Manual des Unterschreibers); StAZH E I 7.3, Nr. 41")?.band, "227");
  for (const sig of ["StAZH A 27.125, Nr. 54", "StAZH B IV 205, S. 118", "StAZH B II 2.1, S. 3", "ZBZ Ms A 72, S. 650-653", "StAZH B II 30"]) {
    assert.equal(parseRmSignature(sig), null, sig);
  }
});

test("Stelle einer Sitzung der Plattform", () => {
  assert.deepEqual(parseRmIdent("a", "StAZH B II 204, S. 24–25", "1583-09-21"), {
    id: "a",
    band: "204",
    date: "1583-09-21",
    unit: "page",
    from: 24,
    to: 25,
  });
  assert.deepEqual(parseRmIdent("b", "StAZH B II 353, fol. 16r–17r", null), { id: "b", band: "353", date: null, unit: "folio", from: 31, to: 33 });
  assert.deepEqual(parseRmIdent("c", "StAZH B II 353, fol. 1v", null), { id: "c", band: "353", date: null, unit: "folio", from: 2, to: 2 });
  assert.deepEqual(parseRmIdent("d", "StAZH B II 74, Aufn. 3–4", "1550-01-04"), { id: "d", band: "74", date: "1550-01-04", unit: "image", from: 3, to: 4 });
  assert.equal(parseRmIdent("e", "StAZH B II 555 a, S. 3", "1670-12-28")?.band, "555a");
  assert.equal(parseRmIdent("f", "StAZH B II 0019, S. 20", "1491")?.band, "19");
  assert.equal(parseRmIdent("f", "StAZH B II 19, S. 20", "1491")?.date, null);
  assert.equal(parseRmIdent("g", "Ratsmanual 1600", null), null);
});

function session(id: string, from: number, to: number, date: string | null, unit: RmSessionSpan["unit"] = "page"): RmSessionSpan {
  return { id, band: "1", date, unit, from, to };
}

test("Sitzung eines Eintrags: Seite abdecken, Datum schliesst aus", () => {
  const band = [session("s23", 19, 19, "1491-02-01"), session("s24", 20, 20, "1491-02-02"), session("s25", 20, 21, "1491-02-04"), session("s26", 21, 21, null)];
  const ref = { band: "1", unit: "page" as const, from: 20, to: 20, part: null };
  const day = (d: string) => ({ from: d, to: d });
  // Zwei Sitzungen auf S. 20: das Datum entscheidet.
  assert.deepEqual(matchRmEntry(ref, day("1491-02-02"), band), { id: "s24", via: "seite+datum" });
  assert.deepEqual(matchRmEntry(ref, day("1491-02-04"), band), { id: "s25", via: "seite+datum" });
  // Ohne Datum bleiben beide.
  assert.deepEqual(matchRmEntry(ref, null, band), { ambiguous: ["s24", "s25"] });
  // Eintrag am Ende einer Sitzung, die eine Seite früher beginnt (S. 21 gehört zu s25 und s26).
  assert.deepEqual(matchRmEntry({ ...ref, from: 21, to: 21 }, day("1491-02-04"), band), { id: "s25", via: "seite+datum" });
  // Sitzung ohne Datum widerspricht nicht; eine einzige an der Stelle genügt.
  assert.deepEqual(matchRmEntry({ ...ref, from: 21, to: 21 }, day("1491-03-01"), band), { id: "s26", via: "seite" });
  // Monat als Spanne: beide Sitzungen auf S. 20 liegen im Februar.
  assert.deepEqual(matchRmEntry(ref, { from: "1491-02-01", to: "1491-02-28" }, band), { ambiguous: ["s24", "s25"] });
  // Keine Sitzung an der Stelle: das Datum allein, wenn es im Band eindeutig ist.
  assert.deepEqual(matchRmEntry({ ...ref, from: 90, to: 90 }, day("1491-02-01"), band), { id: "s23", via: "datum" });
  assert.equal(matchRmEntry({ ...ref, from: 90, to: 90 }, day("1491-05-05"), band), null);
  assert.equal(matchRmEntry({ ...ref, from: 90, to: 90 }, null, band), null);
  assert.equal(matchRmEntry(ref, day("1491-02-02"), []), null);
});

test("Zählungen vergleichen nur untereinander", () => {
  const band = [session("bild", 3, 4, "1550-01-04", "image"), session("fol", 31, 33, "1620-09-30", "folio"), session("seite", 3, 3, null)];
  // Seite 3 trifft nicht die Aufnahme 3–4; Folio-Position 32 (16v) nur die Folio-Sitzung.
  assert.deepEqual(matchRmEntry({ band: "1", unit: "page", from: 3, to: 3, part: null }, null, band), { id: "seite", via: "seite" });
  assert.deepEqual(matchRmEntry({ band: "1", unit: "folio", from: 32, to: 32, part: null }, null, band), { id: "fol", via: "seite" });
  // Nur Aufnahmen bekannt: das Datum allein.
  assert.deepEqual(matchRmEntry({ band: "1", unit: "page", from: 2, to: 2, part: null }, { from: "1550-01-04", to: "1550-01-04" }, band), {
    id: "bild",
    via: "datum",
  });
});

test("Text: Anmerkungen, Lesarten und Kommentar zählen nicht, Wörter vereinheitlicht", () => {
  const ed = editionBodyText(
    tei({
      idno: "x",
      head: "h",
      body: '<p>Vogt zů <placeName>Gruͤningen</placeName> schryben<note type="editorial"> Mithelfer, Id. II, 1057.</note>, ver<lb break="no"/>warloßung <app><lem>toüffer</lem><rdg>töuffer</rdg></app> <del>bewart</del></p>',
    }),
  );
  assert.equal(ed, "Vogt zů Gruͤningen schryben , verwarloßung toüffer");
  assert.equal(rmBodyText("<TEI><teiHeader><title>Kopf</title></teiHeader><text><body><p>Sambstags den 21.ten Septembris</p></body></text></TEI>"), "Sambstags den 21.ten Septembris");
  assert.deepEqual([...compareWords(ed)].sort(), ["gruningen", "schriben", "toufer", "uerwarlosung"]);
  // HTR und Edition schreiben verschieden: v/u, y/i, Doppelbuchstaben, Diakritika.
  const htr = compareWords("Vogt zu Grüningen schriben, verwarlossung touffer");
  assert.equal(containment(compareWords(ed), htr), 1);
  assert.equal(containment(new Set(), htr), 0);
});

test("Textanteil: ganzer Text oder bester Ausschnitt", () => {
  const words = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}xx`);
  // Eintrag (40 Wörter) und eine angehängte Missive (80 Wörter), die Sitzung kennt nur den Eintrag.
  const eintrag = words("eint", 40);
  const missive = words("miss", 80);
  const sitzung = new Set(eintrag);
  assert.equal(containment(new Set([...eintrag, ...missive]), sitzung), 1 / 3);
  assert.equal(textScore([...eintrag, ...missive], sitzung), 1);
  assert.equal(textScore([...missive, ...eintrag], sitzung), 1);
  // Kurzer Text: nur der ganze.
  assert.equal(textScore(eintrag.slice(0, 20), new Set(eintrag.slice(0, 5))), 0.25);
  assert.equal(textScore([], sitzung), 0);
  assert.deepEqual(compareSequence("Vogt zů Gruͤningen schryben, Gruningen"), ["gruningen", "schriben", "gruningen"]);
});

test("Prüfkreis: Stelle ± 2 Seiten in derselben Zählung und derselbe Tag", () => {
  const band = [
    session("s1", 10, 13, "1547-04-06"),
    session("s2", 14, 21, "1547-04-30"),
    session("s3", 30, 31, "1547-04-18"),
    session("f1", 11, 12, null, "folio"),
    session("s4", 40, 41, null),
  ];
  const ref = { band: "1", unit: "page" as const, from: 12, to: 12, part: null };
  const ids = (date: { from: string; to: string } | null) => textPool(ref, date, band).map((s) => s.id);
  assert.deepEqual(ids({ from: "1547-04-18", to: "1547-04-18" }), ["s1", "s2", "s3"]);
  assert.deepEqual(ids(null), ["s1", "s2"]);
  assert.deepEqual(textPool({ ...ref, from: 38, to: 38 }, null, band).map((s) => s.id), ["s4"]);
});

test("Text entscheidet nur mit klarem Abstand, an der Stelle schon ab 40 %", () => {
  const at = (id: string, score: number) => ({ id, score, atPlace: true });
  const near = (id: string, score: number) => ({ id, score, atPlace: false });
  assert.deepEqual(pickByText([near("a", 0.8), near("b", 0.35)]), near("a", 0.8));
  assert.equal(pickByText([near("a", 0.8), near("b", 0.7)]), null);
  // Verrauschte HTR an der Stelle des Eintrags (QZH_200: 45 % gegen 14 %).
  assert.deepEqual(pickByText([at("a", 0.45), near("b", 0.14)]), at("a", 0.45));
  assert.equal(pickByText([near("a", 0.45), at("b", 0.14)]), null);
  assert.equal(pickByText([at("a", 0.45), near("b", 0.33)]), null);
  assert.equal(pickByText([at("a", 0.35)]), null);
  assert.equal(pickByText([]), null);
});

test("Übernehmen: Text bestätigt oder wählt, ohne Text genügt die Stelle", () => {
  const s = (id: string, score: number, atPlace = false) => ({ id, score, atPlace });
  const scores = [s("a", 0.9), s("b", 0.2, true)];
  assert.deepEqual(decideRmMatch({ id: "a", via: "seite+datum" }, 40, scores), { id: "a", via: "seite+datum", score: 0.9 });
  // Sitzung nach Stelle und Datum teilt kaum Text, eine Nachbarin klar mehr: die Nachbarin.
  assert.deepEqual(decideRmMatch({ id: "b", via: "seite" }, 40, scores), { id: "a", via: "text", score: 0.9 });
  assert.deepEqual(decideRmMatch({ ambiguous: ["a", "b"] }, 40, scores), { id: "a", via: "text", score: 0.9 });
  assert.deepEqual(decideRmMatch(null, 40, scores), { id: "a", via: "text", score: 0.9 });
  // Teilt genug, die andere nicht klar mehr: bleibt.
  const close = [s("a", 0.62), s("b", 0.55, true)];
  assert.deepEqual(decideRmMatch({ id: "b", via: "seite" }, 40, close), { id: "b", via: "seite", score: 0.55 });
  // Niemand teilt genug.
  const low = [s("a", 0.28, true), s("b", 0.1)];
  assert.deepEqual(decideRmMatch({ id: "a", via: "seite+datum" }, 40, low), { rejected: "Text weicht ab", candidates: ["a"], scores: low });
  assert.deepEqual(decideRmMatch({ ambiguous: ["a", "b"] }, 40, low), { rejected: "mehrdeutig", candidates: ["a", "b"], scores: low });
  assert.deepEqual(decideRmMatch(null, 40, low), { rejected: "keine Sitzung", candidates: [], scores: low });
  // Das Datum allein braucht so viel Text wie eine Wahl nach Text.
  assert.equal("id" in decideRmMatch({ id: "a", via: "datum" }, 40, [s("a", 0.45)]), false);
  assert.deepEqual(decideRmMatch({ id: "a", via: "datum" }, 40, [s("a", 0.8)]), { id: "a", via: "datum", score: 0.8 });
  // Weitere Überlieferung ohne Text: Stelle ja, Datum allein nein, Gleichstand nein.
  assert.deepEqual(decideRmMatch({ id: "a", via: "seite" }, 0, []), { id: "a", via: "seite", score: null });
  assert.deepEqual(decideRmMatch({ id: "a", via: "datum" }, 3, []), { rejected: "nur Datum", candidates: ["a"], scores: [] });
  assert.deepEqual(decideRmMatch({ ambiguous: ["a", "b"] }, 0, []), { rejected: "mehrdeutig", candidates: ["a", "b"], scores: [] });
  assert.deepEqual(decideRmMatch(null, 0, []), { rejected: "keine Sitzung", candidates: [], scores: [] });
});

function text(over: Partial<EditionText> & Pick<EditionText, "id">): EditionText {
  return {
    edition: "qzh",
    label: over.id,
    url: `https://qzh.sources-online.org/quellenstuecke/${over.id}`,
    witness: false,
    catalogIds: [],
    otherArchives: [],
    signature: "",
    title: "Titel",
    date: null,
    ...over,
  };
}

test("Liste: Katalog-IDs und RM-Sitzungen, Titel nur bei Ratsmanual-Verweisen und geteilten Einheiten", () => {
  const texts = [
    text({ id: "QZH_10", catalogIds: [5], title: "Missive" }),
    text({ id: "QZH_9", catalogIds: [700, 5], title: "Beschluss" }),
    text({ id: "QZH_11", catalogIds: [701], title: "Verhör" }),
    text({ id: "QZH_12" }), // weder Katalog-ID noch Sitzung
    // Vorlage in einem anderen Archiv: kein Katalog-Verweis (die ID dort ist keine des Staatsarchivs).
    text({
      id: "SSRQ_ZH_NF_II_3_015",
      edition: "ssrq",
      label: "SSRQ ZH NF II/3 Nr. 15",
      url: "u15",
      otherArchives: [{ host: "amsquery.stadt-zuerich.ch", id: 701, href: "https://amsquery.stadt-zuerich.ch/detail.aspx?ID=701", archive: "Stadtarchiv Zürich" }],
    }),
    text({ id: "SSRQ_ZH_NF_II_3_047_2", edition: "ssrq", label: "SSRQ ZH NF II/3 Nr. 47", url: "u47", witness: true, catalogIds: [3283081], title: "Fähre" }),
  ];
  const links = buildEditionLinks(texts, new Map([["QZH_9", "RM_1583_0204_0030"], ["SSRQ_ZH_NF_II_3_047_2", "RM_1507_0040_0002"]]));
  assert.deepEqual(links, {
    texts: {
      QZH_9: { edition: "qzh", label: "QZH_9", url: "https://qzh.sources-online.org/quellenstuecke/QZH_9", title: "Beschluss" },
      QZH_10: { edition: "qzh", label: "QZH_10", url: "https://qzh.sources-online.org/quellenstuecke/QZH_10", title: "Missive" },
      QZH_11: { edition: "qzh", label: "QZH_11", url: "https://qzh.sources-online.org/quellenstuecke/QZH_11" },
      SSRQ_ZH_NF_II_3_047_2: { edition: "ssrq", label: "SSRQ ZH NF II/3 Nr. 47", url: "u47", witness: true, title: "Fähre" },
    },
    catalog: { "5": ["QZH_9", "QZH_10"], "700": ["QZH_9"], "701": ["QZH_11"], "3283081": ["SSRQ_ZH_NF_II_3_047_2"] },
    rm: { RM_1507_0040_0002: ["SSRQ_ZH_NF_II_3_047_2"], RM_1583_0204_0030: ["QZH_9"] },
  });
  const file: EditionLinksFile = {
    meta: {
      built: "2026-10-31",
      hash: "h",
      editions: {
        qzh: { repo: "stazh/qzh-data", branch: "main", commit: "c", texts: 4 },
        ssrq: { repo: "stazh/erqzh-data", branch: "main", commit: "d", texts: 1 },
      },
      counts: { texts: 4, catalogIds: 4, rmDocs: 2 },
    },
    ...links,
  };
  const json = serializeEditionLinks(file);
  assert.deepEqual(JSON.parse(json), file);
  // Ein Eintrag pro Zeile.
  assert.match(json, /\n {4}"QZH_10": \{[^\n]*\},\n/);
});

test("Bericht: Vorlagen in anderen Archiven je Archiv gezählt", () => {
  const fremd = (id: string, archive: string, host: string) =>
    text({ id, edition: "ssrq", otherArchives: [{ host, id: 1, href: `https://${host}/detail.aspx?ID=1`, archive }] });
  const sg = fremd("SSRQ_ZH_NF_II_3_001_1", "Stiftsarchiv St. Gallen", "scope.stiftsarchiv.sg.ch");
  const stadt = ["SSRQ_ZH_NF_II_3_015", "SSRQ_ZH_NF_II_3_036"].map((id) => fremd(id, "Stadtarchiv Zürich", "amsquery.stadt-zuerich.ch"));
  const eigen = text({ id: "QZH_1", catalogIds: [5] });
  assert.equal(otherArchivesLine([eigen, sg, ...stadt]), "3 Vorlagen in anderen Archiven (Stadtarchiv Zürich 2, Stiftsarchiv St. Gallen 1), nicht verlinkt");
  assert.equal(otherArchivesLine([eigen, sg]), "1 Vorlage in einem anderen Archiv (Stiftsarchiv St. Gallen), nicht verlinkt");
  assert.equal(otherArchivesLine([eigen]), "keine Vorlagen in anderen Archiven");
});
