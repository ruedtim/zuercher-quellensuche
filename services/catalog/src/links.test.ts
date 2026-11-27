import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldText, gndIds, isoDay, isZsUnit, krdbLinkIds, rmSessionRef, zsDoc } from "./links.ts";
import { matchRmSession, parseRmHeader, type RmSession } from "./rmSessions.ts";
import type { CatalogRecord } from "./types.ts";

function rec(over: Partial<CatalogRecord>, links: string[] = []): CatalogRecord {
  return {
    id: 1,
    url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=1",
    signature: null,
    title: null,
    level: "Dokument",
    date_text: null,
    parent_id: null,
    path: [],
    fields: {},
    sections: [
      {
        section: "Weitere Angaben",
        key: "weitere_angaben",
        fields: [
          { label: "Weblinks", key: "weblinks", text: links.join("\n"), links: links.map((href) => ({ text: href, href })) },
          { label: "Provenienz", key: "provenienz", text: "Muster-Direktion", links: [] },
        ],
      },
    ],
    ...over,
  };
}

test("ZS-Weblink → Plattform-ID und Serie", () => {
  assert.deepEqual(zsDoc(rec({}, ["https://www.zentraleserien.zh.ch/documents/rrb/MM_2_1_RRB_1831_0531"])), {
    series: "RRB",
    id: "MM_2_1_RRB_1831_0531",
  });
  assert.deepEqual(zsDoc(rec({}, ["https://www.zentraleserien.zh.ch/documents/abl/ABl_1980__S__11-16_"])), {
    series: "ABl",
    id: "ABl_1980__S__11-16_",
  });
  assert.equal(zsDoc(rec({}, ["https://hls-dhs-dss.ch/de/articles/1/"])), null);
});

test("Einheit der Zentralen Serien nur mit Signatur der Serien, sonst nur Verweis", () => {
  const link = (series: string, id: string) => [`https://www.zentraleserien.zh.ch/documents/${series}/${id}`];
  assert.equal(isZsUnit(rec({ signature: "MM 2.1 RRB 1831/0531" }, link("rrb", "MM_2_1_RRB_1831_0531"))), true);
  assert.equal(isZsUnit(rec({ signature: "MM 24.7 KRP 1830/0066" }, link("krp", "MM_24_7_KRP_1830_0066"))), true);
  assert.equal(isZsUnit(rec({ signature: "ABl 1980 (S. 11-16)" }, link("abl", "ABl_1980__S__11-16_"))), true);
  assert.equal(isZsUnit(rec({ signature: "OS 54 (S. 6)" }, link("os", "OS_54__S__6_"))), true);
  assert.equal(isZsUnit(rec({ signature: "OS NF 1 (S. 88-90)" }, link("os", "OS_NF_1__S__88-90_"))), true);
  // Urkunde mit Weblink auf einen Regierungsratsbeschluss: verweist nur, bildet ihn nicht ab.
  const urkunde = rec({ signature: "C I, Nr. 9999" }, link("rrb", "MM_2_1_RRB_1831_0531"));
  assert.equal(isZsUnit(urkunde), false);
  assert.deepEqual(zsDoc(urkunde), { series: "RRB", id: "MM_2_1_RRB_1831_0531" });
  // Signatur der Serien ohne Weblink: kein Plattform-Dokument bekannt.
  assert.equal(isZsUnit(rec({ signature: "MM 2.1 RRB 1831/0531" })), false);
  assert.equal(isZsUnit(rec({ signature: null }, link("rrb", "MM_2_1_RRB_1831_0531"))), false);
});

test("KRDB- und GND-Links, Feldtext", () => {
  const r = rec({}, [
    "https://www.web.statistik.zh.ch/webapp/KRRRPublic/app?id=3182",
    "https://d-nb.info/gnd/118569775",
    "https://www.web.statistik.zh.ch/webapp/KRRRPublic/app?id=3182",
  ]);
  assert.deepEqual(krdbLinkIds(r), [3182]);
  assert.deepEqual(gndIds(r), ["118569775"]);
  assert.equal(fieldText(r, "provenienz"), "Muster-Direktion");
  assert.equal(fieldText(r, "fehlt"), undefined);
});

test("Ratssitzung: Band und Seiten aus der Signatur", () => {
  const title = "Ratssitzung (Kleiner Rat) unter dem Vorsitz von Bürgermeister X";
  assert.deepEqual(rmSessionRef(rec({ signature: "B II 400 (S. 1-2)", title })), { band: "400", pageFrom: 1, pageTo: 2 });
  assert.deepEqual(rmSessionRef(rec({ signature: "B II 435 (S. 7)", title })), { band: "435", pageFrom: 7, pageTo: 7 });
  assert.deepEqual(rmSessionRef(rec({ signature: "B II 418 (S. 68, Eintrag 2)", title })), { band: "418", pageFrom: 68, pageTo: 68 });
  assert.equal(rmSessionRef(rec({ signature: "B II 400", title: "Ratsmanual" })), null);
  assert.equal(isoDay("02.07.1632"), "1632-07-02");
  assert.equal(isoDay("1632"), null);
});

test("RM-Kopf lesen", () => {
  const xml = `<bibl><date when="1780-04-08"/><ident>StAZH B II 0987, S. 48–50</ident></bibl>`;
  assert.deepEqual(parseRmHeader("RM_1780_0987_0040", xml), {
    id: "RM_1780_0987_0040",
    band: "987",
    date: "1780-04-08",
    pageFrom: 48,
    pageTo: 50,
  });
  assert.equal(parseRmHeader("x", "<bibl/>"), null);
});

test("Sitzung zuordnen: Anfangsseite, Überschneidung + Datum, Datum allein", () => {
  const s = (id: string, date: string, from: number, to: number): RmSession => ({ id, band: "400", date, pageFrom: from, pageTo: to });
  const band = [s("a", "1632-07-02", 1, 2), s("b", "1632-07-04", 2, 4), s("c", "1632-07-04", 5, 6)];
  assert.deepEqual(matchRmSession({ band: "400", pageFrom: 2, pageTo: 4 }, "1632-07-04", band), { id: "b", via: "page" });
  assert.deepEqual(matchRmSession({ band: "400", pageFrom: 3, pageTo: 3 }, null, band), { id: "b", via: "overlap" });
  // Seiten passen auf zwei Sitzungen, das Datum entscheidet.
  const two = [s("x", "1632-07-02", 1, 4), s("y", "1632-07-03", 4, 6)];
  assert.deepEqual(matchRmSession({ band: "400", pageFrom: 2, pageTo: 4 }, "1632-07-03", two), { id: "y", via: "overlap" });
  assert.deepEqual(matchRmSession({ band: "400", pageFrom: 2, pageTo: 4 }, null, two), { ambiguous: ["x", "y"] });
  // Seitenzählung weicht ab: nur das Datum.
  assert.deepEqual(matchRmSession({ band: "400", pageFrom: 90, pageTo: 91 }, "1632-07-02", band), { id: "a", via: "date" });
  assert.equal(matchRmSession({ band: "400", pageFrom: 90, pageTo: 91 }, "1700-01-01", band), null);
  assert.equal(matchRmSession({ band: "401", pageFrom: 1, pageTo: 1 }, null, undefined), null);
  // Gleiche Anfangsseite, aber anderes Datum: keine Zuordnung.
  assert.equal(matchRmSession({ band: "400", pageFrom: 114, pageTo: 120 }, "1796-09-24", [s("p", "1796-09-21", 114, 130)]), null);
  // RM-Sitzung ohne Datum widerspricht nie.
  assert.deepEqual(matchRmSession({ band: "400", pageFrom: 39, pageTo: 40 }, "1638-02-28", [{ id: "q", band: "400", date: null, pageFrom: 39, pageTo: 41 }]), {
    id: "q",
    via: "page",
  });
});
