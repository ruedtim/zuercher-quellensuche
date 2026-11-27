/**
 * Katalog-Dokumente für den Meili-Index `catalog` aus dem stazh-scraper-Export.
 *
 * Drei Durchläufe über den Export: (1) Archivbaum aus den Pfaden, Position jeder
 * Einheit unter ihren Geschwistern, Vornamen-Lexikon fürs Titelschema aus
 * Ehedatenbank, stark belegten Personendossiers und KRDB, Plattform-Dokument jedes
 * ZS-Weblinks (Stufe 1, platform.ts); (2) Häufigkeit jedes
 * Personennamens im Katalog (Bremse für KRDB-Vorschläge) und aller Entitäts-Schlüssel
 * (Grundformen der NER-Spans, entities.ts); (3) je Einheit Datum,
 * Archivplan-Pfad, Plattform-Bezug (ZS-Weblink, RM-Sitzung), Abschnitte der Detailseite,
 * Entitäten (Titelschema + Erschliessungsregeln + NER + Ortsregister) und KRDB-Zuordnung,
 * danach die Stufen, die
 * nur aus Pfaden bekannt sind (`stub`). Einheiten, die ein Plattform-Dokument abbilden
 * (`onPlatform`), bekommen keine Entitäten: die trägt das Dokument selbst.
 *
 * Mit `platform` (Abzug der Plattform-Dokumente, refresh.sh) trägt `docId` die ID der
 * Plattform («_t», Doppelbeschlüsse ohne Bindestrich, sonst über die `archiveId` des
 * Dokuments); ein ZS-Weblink ohne Plattform-Dokument macht die Einheit zum eigenen Treffer
 * ohne `docId`. Ohne `platform` bleibt `docId` die Weblink-ID (ungeprüft).
 *
 * Läuft nur auf dem Mac (Export, RM-TEI unter ~/zszh-rm/tei und KRDB-Rohexport
 * liegen dort). Ausgabe: output/catalog-docs.jsonl.gz, output/report.md und
 * Prüflisten der KRDB-Zuordnungen (CSV).
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { personKey } from "../../../apps/web/src/lib/entityKey.ts";
import { parseExport } from "../../krdb/src/krdb.ts";
import { parseCatalogDate } from "./dates.ts";
import {
  addKeyCounts,
  mergeEntities,
  nerText,
  newKeyCounts,
  newNerFilterStats,
  registerPlaces,
  textHash,
  type EntitySet,
  type NerSpans,
} from "./entities.ts";
import { GazetteerBuilder } from "./gazetteer.ts";
import { assignKrdb, buildKrdbIndex, type KrdbCandidate } from "./krdbAssign.ts";
import { fieldText, isoDay, isZsUnit, krdbLinkIds, rmSessionRef, zsDoc } from "./links.ts";
import { readJsonl, writeJsonl } from "./load.ts";
import { PlatformIndex, viaLabel, type PlatformDocRef, type PlatformTarget } from "./platform.ts";
import { loadRmSessions, matchRmSession, type RmSession } from "./rmSessions.ts";
import { ruleEntities } from "./ruleEntities.ts";
import { CATALOG_FOLDED_FIELDS, foldedFields } from "./searchText.ts";
import { catalogSections } from "./sections.ts";
import { GivenNameLexicon, parseTitleEntities, personDisplay, type TitlePerson } from "./titleSchema.ts";
import { ArchiveTree, bestandOf, catalogPath, SiblingOrder, siblingSortKey, stubDoc, stubRecord } from "./tree.ts";
import type { CatalogDoc, CatalogRecord, DocSeries } from "./types.ts";
import { unitTitle } from "./unitTitle.ts";

export interface BuildOptions {
  input: string;
  out: string;
  ner?: string;
  rmTei: string;
  register: string;
  krdbXlsx: string;
  /** Abzug der Plattform-Dokumente (JSONL, platform_docs.py); ohne: Weblinks ungeprüft. */
  platform?: string;
  limit?: number;
}

const DOC_SERIES = new Set<string>(["ABl", "KRP", "OS", "RRB"]);

const TEXT_MAX = 2000;
/** Höchstens so viele Digitalisat-Links je Einheit (selten mehr als zwei). */
const FILES_MAX = 10;
/** Ein Vorname zählt fürs Lexikon ab so vielen Belegen (KRDB-Vornamen immer). */
const LEXICON_MIN = 3;

/** Einheiten, die ein Plattform-Dokument abbilden: Einheit der Zentralen Serien (Signatur und
 *  Weblink) oder RM-Sitzung. Einheiten, die nur auf ein Dokument verweisen, zählen nicht.
 *  Ohne Blick auf den Abzug der Plattform: Lexikon, Namenszählung und NER-Auswahl lassen auch
 *  die wenigen ZS-Einheiten aus, deren Dokument fehlt (Prod 2026-11-09: 88). */
export function isOnPlatform(rec: CatalogRecord): boolean {
  return isZsUnit(rec) || rmSessionRef(rec) !== null;
}

/**
 * NER lohnt nur, wo das Titelschema (ohne Lexikon, also nur sichere Treffer)
 * nichts erfasst: Ehedatenbank, Patente, Dossiers mit Lebensdaten und Firmen
 * sind damit vollständig. Das NER-Modell schafft auf dem Mac ~10 Texte/s,
 * unabhängig von Batchgrösse und Prozesszahl – die Auswahl spart rund ein Drittel.
 */
export function needsNer(rec: CatalogRecord): boolean {
  return !isOnPlatform(rec) && parseTitleEntities(rec.title ?? "", rec.signature ?? "").schema === null && nerText(rec) !== "";
}

async function newestKrdbExport(dir: string): Promise<string> {
  const files = (await readdir(dir)).filter((f) => /^krdb-export-.*\.xlsx$/.test(f)).sort();
  if (files.length === 0) throw new Error(`Kein KRDB-Export in ${dir} – services/krdb einmal laufen lassen oder --krdb-xlsx setzen`);
  return join(dir, files[files.length - 1]);
}

export async function resolveKrdbXlsx(pathOrDir: string): Promise<string> {
  return pathOrDir.endsWith(".xlsx") ? pathOrDir : newestKrdbExport(pathOrDir);
}

async function loadKrdb(xlsx: string, register: string) {
  const data = parseExport(new Uint8Array(await readFile(xlsx)));
  const reg = JSON.parse(await readFile(register, "utf-8")) as {
    persons: Array<{ id: number; aliases?: number[]; places?: Array<[string, ...unknown[]]> }>;
  };
  const aliases = new Map<number, number>();
  for (const p of reg.persons) for (const a of p.aliases ?? []) aliases.set(a, p.id);
  /** Wohnorte der Rats- und Regierungsmitglieder (Ortsverzeichnis der Erschliessungsregeln). */
  const places = new Set(reg.persons.flatMap((p) => (p.places ?? []).map((pl) => pl[0])).filter((pl): pl is string => typeof pl === "string"));
  const candidates: KrdbCandidate[] = data.persons.map((p) => ({
    id: p.id,
    first: p.first,
    last: p.last,
    born: p.born,
    died: p.died,
    seats: data.seats.get(p.id) ?? [],
  }));
  return { candidates, aliases, places, byId: new Map(candidates.map((c) => [c.id, c])) };
}

async function loadNer(path: string | undefined): Promise<Map<number, NerSpans>> {
  const map = new Map<number, NerSpans>();
  if (!path) return map;
  for await (const row of readJsonl<NerSpans>(path)) map.set(row.id, row);
  return map;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

class Counter<K> extends Map<K, number> {
  add(k: K, n = 1) {
    this.set(k, (this.get(k) ?? 0) + n);
  }
}

export async function runBuild(opts: BuildOptions): Promise<void> {
  const t0 = Date.now();
  await mkdir(opts.out, { recursive: true });
  const krdb = await loadKrdb(opts.krdbXlsx, opts.register);
  const krdbIndex = buildKrdbIndex(krdb.candidates, krdb.aliases);
  console.log(`[catalog] KRDB: ${krdb.candidates.length} Personen (${opts.krdbXlsx})`);
  let rm = new Map<string, RmSession[]>();
  try {
    rm = await loadRmSessions(opts.rmTei);
  } catch (err) {
    console.warn(`[catalog] RM-TEI nicht lesbar (${opts.rmTei}): ${(err as Error).message} – keine Sitzungs-Zuordnung`);
  }
  console.log(`[catalog] RM: ${[...rm.values()].reduce((n, l) => n + l.length, 0)} Sitzungen in ${rm.size} Bänden`);
  const ner = await loadNer(opts.ner);
  console.log(`[catalog] NER: ${ner.size} Einheiten mit Spans${opts.ner ? ` (${opts.ner})` : " (ohne --ner)"}`);
  const platform = opts.platform ? await PlatformIndex.fromAsync(readJsonl<PlatformDocRef>(opts.platform)) : null;
  console.log(
    platform
      ? `[catalog] Plattform: ${platform.size} Dokumente (${opts.platform})`
      : "[catalog] ohne --platform: Weblinks ungeprüft, docId = Weblink-ID",
  );
  /** Plattform-Dokument jedes ZS-Weblinks nach Stufe 1 (für Stufe 2, PlatformIndex.settle). */
  const located = new Map<number, string>();
  const platformTarget = (unitId: number, zs: { series: DocSeries; id: string }): PlatformTarget | null =>
    platform ? platform.settle(unitId, platform.locate(unitId, zs), (id) => located.get(id)) : { ...zs, via: "id" };

  // 1. Archivbaum, Position unter den Geschwistern, Vornamen-Lexikon, Ortsverzeichnis und
  //    Plattform-Dokumente der Weblinks.
  const tree = new ArchiveTree();
  const order = new SiblingOrder();
  const lexicon = new GivenNameLexicon();
  const gazBuilder = new GazetteerBuilder();
  let seen = 0;
  for await (const rec of readJsonl<CatalogRecord>(opts.input)) {
    if (opts.limit && ++seen > opts.limit) break;
    tree.add(rec);
    order.add(rec);
    if (platform) {
      const zs = zsDoc(rec);
      const first = zs ? platform.locate(rec.id, zs) : null;
      if (first) located.set(rec.id, first.id);
    }
    if (rec.level === "Klasse") gazBuilder.addClass(bestandOf(rec), unitTitle(rec).title);
    if (isOnPlatform(rec)) continue;
    const t = parseTitleEntities(rec.title ?? "", rec.signature ?? "");
    if (t.schema !== "ehe" && t.schema !== "person") continue;
    for (const p of t.persons) lexicon.addTitlePerson(p.first);
  }
  for (const { id, path } of tree.stubs()) order.add(stubRecord(id, path));
  order.finish();
  for (const c of krdb.candidates) lexicon.addKrdb(c.first);
  const givenNames = lexicon.build(LEXICON_MIN);
  console.log(`[catalog] Vornamen-Lexikon: ${givenNames.size}`);
  for (const p of krdb.places) gazBuilder.addKrdbPlace(p);
  const gaz = gazBuilder.build();
  console.log(`[catalog] Ortsverzeichnis: ${gaz.all.size} Orte (${gaz.all.size - gaz.strict.size} mehrdeutig)`);

  /** Titelschema, Erschliessungsregeln, Ortsregister und gültige NER-Spans einer eigenen Einheit. */
  const entityParts = (rec: CatalogRecord, unitTitleText: string) => {
    const title = parseTitleEntities(rec.title ?? "", rec.signature ?? "", { givenNames });
    const rules = ruleEntities(
      {
        title: unitTitleText,
        signature: rec.signature ?? "",
        ancestors: rec.path.filter((n) => n.id !== rec.id),
        sections: rec.sections,
        hasTitlePersons: title.persons.length > 0,
      },
      { gaz, givenNames },
    );
    const spans = ner.get(rec.id);
    /** Spans zum aktuellen NER-Text (sonst veraltet); `ents` null = NER scheiterte. */
    const nerValid = !!spans && spans.hash === textHash(nerText(rec));
    return { title, rules, register: registerPlaces(rec), spans, nerValid, nerEnts: nerValid ? spans.ents : null };
  };

  // 2. Häufigkeit der Personennamen (Titelschema) und aller Schlüssel im ganzen Katalog
  //    (Bremse für KRDB-Vorschläge; Grundformen der NER-Spans).
  const nameCounts = new Counter<string>();
  const keyCounts = newKeyCounts();
  seen = 0;
  for await (const rec of readJsonl<CatalogRecord>(opts.input)) {
    if (opts.limit && ++seen > opts.limit) break;
    if (isOnPlatform(rec)) continue;
    const p = entityParts(rec, unitTitle(rec).title);
    for (const t of p.title.persons) {
      const k = personKey(personDisplay(t));
      if (k) nameCounts.add(k);
    }
    addKeyCounts(keyCounts, mergeEntities({ title: p.title, rules: p.rules, ner: p.nerEnts, registerPlaces: p.register }));
  }
  console.log(
    `[catalog] Schlüssel im Aufbau: ${keyCounts.person.size} Personen, ${keyCounts.place.size} Orte, ${keyCounts.org.size} Organisationen`,
  );
  const nameCount = (t: TitlePerson) => {
    const k = personKey(personDisplay(t));
    return k ? (nameCounts.get(k) ?? 0) : Infinity;
  };

  // 3. Dokumente.
  const docs = writeJsonl(join(opts.out, "catalog-docs.jsonl.gz"));
  const nerStats = newNerFilterStats();
  const strictCsv = ["krdbId,krdbName,via,katalogId,signatur,titel,datum"];
  const namesCsv = ["krdbId,krdbName,katalogId,signatur,titel,datum"];
  const s = {
    units: 0,
    levels: new Counter<string>(),
    titleSource: new Counter<string>(),
    dateOk: 0,
    dateMissing: 0,
    dateUnreadable: new Counter<string>(),
    zs: new Counter<DocSeries>(),
    zsRefs: new Counter<DocSeries>(),
    /** ZS-Weblinks: wie das Plattform-Dokument gefunden wurde (nur mit --platform). */
    zsVia: new Counter<string>(),
    /** ZS-Weblinks ohne Plattform-Dokument (eigene Treffer ohne docId). */
    zsMissing: new Counter<DocSeries>(),
    rm: new Counter<string>(),
    schema: new Counter<string>(),
    withPersons: 0,
    withPlaces: 0,
    withOrgs: 0,
    rulesUnits: 0,
    rulesNew: 0,
    nerUnits: 0,
    nerStale: 0,
    nerMissing: 0,
    strict: new Counter<string>(),
    names: 0,
    strictPersons: new Set<number>(),
    namePersons: new Set<number>(),
    searchable: 0,
    digitized: 0,
    withFiles: 0,
    withSections: 0,
    folded: new Counter<string>(),
    foldedUnits: 0,
    stubs: new Counter<string>(),
  };
  seen = 0;
  for await (const rec of readJsonl<CatalogRecord>(opts.input)) {
    if (opts.limit && ++seen > opts.limit) break;
    s.units++;
    const level = rec.level ?? "";
    s.levels.add(level || "(leer)");
    // Bestände, Klassen, Abteilungen: Titel aus «Name» bzw. dem Pfad-Etikett.
    const named = unitTitle(rec);
    s.titleSource.add(named.source ?? "keine");
    const range = parseCatalogDate(named.dateText);
    if (range) s.dateOk++;
    else if (!named.dateText) s.dateMissing++;
    else s.dateUnreadable.add(named.dateText.replace(/\d/g, "9"));

    const doc: CatalogDoc = {
      id: rec.id,
      signature: rec.signature ?? "",
      title: named.title,
      level,
      dateText: named.dateText,
      dateFrom: range?.from ?? null,
      dateTo: range?.to ?? null,
      path: catalogPath(rec),
      bestand: bestandOf(rec),
      parentId: rec.parent_id,
      hasDigitization: !!rec.has_digitization,
      url: rec.url,
      ...order.place(rec.id, siblingSortKey(rec.signature, named.title)),
      childCount: tree.childCount(rec.id),
      onPlatform: false,
      persons: [],
      places: [],
      organizations: [],
      personKeys: [],
      placeKeys: [],
      orgKeys: [],
    };
    const prov = fieldText(rec, "provenienz");
    if (prov) doc.provenienz = prov.split("\n")[0];
    const text = fieldText(rec, "regest") ?? fieldText(rec, "inhalt_und_form");
    if (text) doc.text = text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)} …` : text;
    const sections = catalogSections(rec);
    if (sections.length > 0) {
      doc.sections = sections;
      s.withSections++;
    }
    if (doc.hasDigitization) s.digitized++;

    const zs = zsDoc(rec);
    // Plattform-Dokument des Weblinks; null = fehlt auf der Plattform (dann eigener Treffer).
    const target = zs ? platformTarget(rec.id, zs) : null;
    const targetSeries = target && DOC_SERIES.has(target.series) ? (target.series as DocSeries) : zs?.series;
    if (zs && target && platform) s.zsVia.add(viaLabel(target, zs.id));
    const rmRef = rmSessionRef(rec);
    if (zs && target && isZsUnit(rec)) {
      doc.onPlatform = true;
      doc.docId = target.id;
      doc.docSeries = targetSeries;
      s.zs.add(zs.series);
    } else if (rmRef) {
      doc.onPlatform = true;
      const m = matchRmSession(rmRef, isoDay(rec.date_text), rm.get(rmRef.band));
      if (m && "id" in m) {
        doc.docId = m.id;
        doc.docSeries = "RM";
        s.rm.add(m.via);
      } else s.rm.add(m ? "mehrdeutig" : "ohne Treffer");
    } else {
      s.searchable++;
      const folded = foldedFields(doc, CATALOG_FOLDED_FIELDS);
      Object.assign(doc, folded);
      for (const field of Object.keys(folded)) s.folded.add(field);
      if (Object.keys(folded).length > 0) s.foldedUnits++;
      // Verweis auf ein Plattform-Dokument (Urkunde → Regierungsratsbeschluss): eigener Treffer
      // mit Dokumentlink; die Dokumentseite führt die Einheit unter den Verweisen. Fehlt das
      // Dokument auf der Plattform, bleibt der Weblink nur in den Abschnitten (ohne Link).
      if (zs && target) {
        doc.docId = target.id;
        doc.docSeries = targetSeries;
        s.zsRefs.add(zs.series);
      } else if (zs) s.zsMissing.add(zs.series);
      const files = (rec.files ?? []).filter((f) => /^https:\/\/suche\.staatsarchiv\.djiktzh\.ch\//.test(f.url));
      if (files.length > 0) {
        doc.files = files.slice(0, FILES_MAX).map((f) => ({ name: f.name, url: f.url, kind: f.kind === "image" ? "image" : "file" }));
        if (files.length > FILES_MAX) doc.fileCount = files.length;
        s.withFiles++;
      }
      const { title, rules, register, spans, nerValid, nerEnts } = entityParts(rec, named.title);
      s.schema.add(title.schema ?? "keines");
      if (spans) {
        if (nerValid) s.nerUnits++;
        else s.nerStale++;
      } else if (opts.ner && needsNer(rec)) s.nerMissing++;
      const merged = mergeEntities({ title, rules, ner: nerEnts, registerPlaces: register, keyCounts, nerStats });
      const keyCount = (e: EntitySet) => e.personKeys.length + e.placeKeys.length + e.orgKeys.length;
      const without = keyCount(mergeEntities({ title, ner: nerEnts, registerPlaces: register, keyCounts }));
      if (keyCount(merged) > without) {
        s.rulesUnits++;
        if (without === 0) s.rulesNew++;
      }
      Object.assign(doc, merged);
      if (doc.persons.length) s.withPersons++;
      if (doc.places.length) s.withPlaces++;
      if (doc.organizations.length) s.withOrgs++;

      const k = assignKrdb(
        { title: rec.title ?? "", dateFrom: doc.dateFrom, dateTo: doc.dateTo, linkIds: krdbLinkIds(rec), persons: title.persons },
        krdbIndex,
        nameCount,
      );
      const line = (rec.title ?? "").split("\n")[0];
      if (k.strict.length) {
        doc.krdbIds = k.strict.map((x) => x.id);
        for (const x of k.strict) {
          s.strict.add(x.via);
          s.strictPersons.add(x.id);
          const p = krdb.byId.get(x.id);
          strictCsv.push([x.id, p ? `${p.first} ${p.last}` : "", x.via, rec.id, doc.signature, line, doc.dateText].map(csvCell).join(","));
        }
      }
      if (k.names.length) {
        doc.krdbNameIds = k.names;
        for (const id of k.names) {
          s.names++;
          s.namePersons.add(id);
          const p = krdb.byId.get(id);
          namesCsv.push([id, p ? `${p.first} ${p.last}` : "", rec.id, doc.signature, line, doc.dateText].map(csvCell).join(","));
        }
      }
    }
    await docs.write(doc);
    if (s.units % 100_000 === 0) console.log(`[catalog] ${s.units} Einheiten …`);
  }
  // Stufen, die nur aus Pfaden bekannt sind (Archivbaum im Teilstand).
  for (const { id, path } of tree.stubs()) {
    const stub = stubDoc(id, path, tree.childCount(id), order);
    s.stubs.add(stub.level || "(leer)");
    await docs.write(stub);
  }
  await docs.close();
  await writeFile(join(opts.out, "krdb-gesichert.csv"), strictCsv.join("\n") + "\n");
  await writeFile(join(opts.out, "krdb-vorschlaege.csv"), namesCsv.join("\n") + "\n");

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : "–");
  const rows = (c: Map<string, number>, limit = 20) =>
    [...c].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, n]) => `| ${k} | ${n.toLocaleString("de-CH")} |`).join("\n");
  const rmTotal = [...s.rm.values()].reduce((a, b) => a + b, 0);
  const report = `# Archivkatalog – Aufbau-Report

Erzeugt ${new Date().toISOString()} aus \`${opts.input}\` in ${((Date.now() - t0) / 1000).toFixed(0)} s.

## Umfang

- Einheiten: **${s.units.toLocaleString("de-CH")}**, davon eigene Katalog-Treffer (nicht \`onPlatform\`): **${s.searchable.toLocaleString("de-CH")}**
- mit Digitalisat: ${s.digitized.toLocaleString("de-CH")}, davon eigene Treffer mit Digitalisat-Links: ${s.withFiles.toLocaleString("de-CH")}
- mit Abschnitten für die Detailseite: ${s.withSections.toLocaleString("de-CH")}
- eigene Treffer mit ß (gefaltete Suchfelder, searchText.ts): ${s.foldedUnits.toLocaleString("de-CH")}${[...s.folded].map(([k, n]) => `, ${k} ${n.toLocaleString("de-CH")}`).join("")}

| Stufe | Einheiten |
|---|---:|
${rows(s.levels)}

## Archivbaum

Stufen, die nur aus den Pfaden gecrawlter Einheiten bekannt sind (\`stub\`, kein eigener
Treffer, nur Baum und Seite): **${[...s.stubs.values()].reduce((a, b) => a + b, 0).toLocaleString("de-CH")}**

| Stufe | nur aus Pfaden |
|---|---:|
${rows(s.stubs)}

Geschwister mit gleicher Signatur und gleichem Titel (Sortierschlüssel mit angehängter ID,
damit Baum und Position \`sigPos\` übereinstimmen): ${order.ties.toLocaleString("de-CH")}

## Titel

Herkunft (Bestände führen «Name», Klassen und Abteilungen nur das Pfad-Etikett):

| Quelle | Einheiten |
|---|---:|
${rows(s.titleSource)}

## Datum

- lesbar: ${s.dateOk.toLocaleString("de-CH")} (${pct(s.dateOk, s.units)}), ohne Angabe: ${s.dateMissing.toLocaleString("de-CH")}, unlesbar: ${[...s.dateUnreadable.values()].reduce((a, b) => a + b, 0)}

| unlesbares Muster | Anzahl |
|---|---:|
${rows(s.dateUnreadable, 10)}

## Plattform-Bezug

Zentrale Serien über den Weblink «Volltext und Digitalisat»:

| Serie | Einheiten |
|---|---:|
${rows(s.zs as Map<string, number>)}

Eigene Treffer mit Weblink auf ein Plattform-Dokument (andere Signatur, z. B. Urkunde zu einem
Regierungsratsbeschluss; behalten den Dokumentlink): ${[...s.zsRefs].map(([k, n]) => `${k} ${n}`).join(", ") || "keine"}

${
  platform
    ? `Plattform-Dokument der Weblinks (${platform.size.toLocaleString("de-CH")} Dokumente im Abzug): ${[...s.zsVia].map(([k, n]) => `${k} ${n.toLocaleString("de-CH")}`).join(", ") || "–"}

Weblinks ohne Plattform-Dokument (eigene Treffer ohne Dokumentlink; Liste: \`main.ts abgleich\`): ${[...s.zsMissing].map(([k, n]) => `${k} ${n}`).join(", ") || "keine"}`
    : "Ohne Abzug der Plattform-Dokumente (`--platform`): Weblinks ungeprüft, `docId` = Weblink-ID."
}

Ratsmanuale-Sitzungen (${rmTotal.toLocaleString("de-CH")} Sitzungs-Subdossiers): ${[...s.rm].map(([k, n]) => `${k} ${n}`).join(", ")}

## Entitäten (eigene Treffer)

- mit Personen: ${s.withPersons.toLocaleString("de-CH")} (${pct(s.withPersons, s.searchable)}), Orten: ${s.withPlaces.toLocaleString("de-CH")} (${pct(s.withPlaces, s.searchable)}), Organisationen: ${s.withOrgs.toLocaleString("de-CH")} (${pct(s.withOrgs, s.searchable)})
- NER: ${s.nerUnits.toLocaleString("de-CH")} Einheiten mit gültigen Spans, ${s.nerStale} veraltet (Text geändert), ${s.nerMissing.toLocaleString("de-CH")} ohne Spans
- Erschliessungsregeln: ${s.rulesUnits.toLocaleString("de-CH")} Einheiten mit zusätzlichen Entitäten, davon ${s.rulesNew.toLocaleString("de-CH")} erstmals mit einer
- Vornamen-Lexikon: ${givenNames.size}, Ortsverzeichnis: ${gaz.all.size} Orte
- Schlüssel im Aufbau (Häufigkeitsliste für die Grundformen der NER): ${keyCounts.person.size.toLocaleString("de-CH")} Personen, ${keyCounts.place.size.toLocaleString("de-CH")} Orte, ${keyCounts.org.size.toLocaleString("de-CH")} Organisationen
- NER-Nachfilter: ${nerStats.base.toLocaleString("de-CH")} Formen auf die Grundform gebracht, ${nerStats.abbr.toLocaleString("de-CH")} Ortskürzel ausgeschrieben, ${nerStats.stopped.toLocaleString("de-CH")} verworfen (Sachgebiet, Versicherungszweig, Altar, «Kernen»)

| häufigste Grundformen der NER | Anzahl |
|---|---:|
${rows(nerStats.pairs, 30)}

| Titelschema | Einheiten |
|---|---:|
${rows(s.schema)}

## KRDB-Personen

- gesichert: ${[...s.strict].map(([k, n]) => `${k} ${n}`).join(", ") || "keine"} – ${s.strictPersons.size} Personen (Prüfliste \`krdb-gesichert.csv\`)
- Vorschläge gleichen Namens: ${s.names} – ${s.namePersons.size} Personen (Prüfliste \`krdb-vorschlaege.csv\`)
`;
  await writeFile(join(opts.out, "report.md"), report);
  console.log(`[catalog] DONE ${s.units} Einheiten, ${s.searchable} eigene Treffer → ${opts.out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

/** NER-Eingabe für ner_text.py: eigene Treffer ohne sicheres Titelschema (`needsNer`). */
export async function runNerInput(input: string, out: string, limit?: number): Promise<void> {
  const w = writeJsonl(out);
  let n = 0;
  let seen = 0;
  for await (const rec of readJsonl<CatalogRecord>(input)) {
    if (limit && ++seen > limit) break;
    if (!needsNer(rec)) continue;
    const text = nerText(rec);
    await w.write({ id: rec.id, hash: textHash(text), text });
    n++;
  }
  await w.close();
  console.log(`[catalog] NER-Eingabe: ${n} Texte → ${out}`);
}
