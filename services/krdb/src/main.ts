/**
 * KRDB-Register-Builder.
 *
 * Holt die aktuelle Kantonsratsdatenbank (Live-Excel-Export), verknüpft die
 * Personen mit Wikidata (P13468, sonst exakte GND/HLS/VIAF-Treffer; Items mit
 * veralteter P13468 – die KRDB vergibt IDs bei Änderungen neu – über Name +
 * Geburtsdatum, siehe stale.ts), holt zu
 * den Items das Porträt (P18) samt Bildnachweis von Wikimedia Commons, ergänzt
 * kuratierte Commons-Porträts (data/portrait-overrides.json, overrides.ts),
 * füllt Lücken mit Fotoporträts aus dem Staatsarchiv-Bestand Z 1114 (data/z1114.json,
 * gebaut von z1114.ts) und schreibt das Register, gegen das die
 * KRP-Detailseiten die erwähnten Personen abgleichen:
 *   apps/web/src/lib/server/data/krdb-register.json   (committet, gebündelt)
 *   <out>/report.md                                  (Abdeckung, Konflikte)
 *   <out>/p13468-korrekturen.csv                     (veraltete P13468: alt → neu)
 *   services/indexer/src/krdb/krdb-register.json     (identische Kopie für den Indexer)
 *
 * Aufruf:
 *   npx tsx src/main.ts                    # Download + Wikidata + Commons
 *   npx tsx src/main.ts --xlsx=<datei>     # vorhandenen Export verwenden
 *
 * Flags:
 *   --out=<dir>        Arbeitsordner für Roh-Export und Report (Default ./output).
 *   --xlsx=<datei>     Lokalen Excel-Export statt Download verwenden.
 *   --register=<datei> Zielpfad des Registers (Default: Web-App).
 *   --z1114=<datei>    Z-1114-Porträts (Default data/z1114.json; fehlt ⇒ nur Commons).
 *   --overrides=<datei> Kuratierte Commons-Porträts (Default data/portrait-overrides.json).
 *   --indexer-register=<datei> Kopie für den Indexer (Default: services/indexer, nur beim
 *                      Standard-Registerpfad; der Indexer läuft auf dem Server ohne apps/web).
 *   --force            Plausibilitätsprüfungen übergehen.
 *
 * Datensparsam: nur Namen, Geschlecht, Todesjahr (Geburtsjahr nur bei
 * Verstorbenen oder vor über 100 Jahren), Einsitze, Parteien, Wohnorte
 * während der Amtszeit, QID und Bildnachweis. Das Register wird nur neu
 * geschrieben, wenn sich der Personen-Block ändert (Hash), und zwar atomar.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { KrdbImage, KrdbPerson, KrdbRegisterMeta } from "../../../apps/web/src/lib/server/krdbMatch.ts";
import { KRDB_EXPORT_URL, downloadExport, parseExport } from "./krdb.ts";
import { fetchImages, linkWikidata, type QidVia } from "./wikidata.ts";
import { fetchImageInfo, warmThumbs, type CommonsImage } from "./commons.ts";
import { DEFAULT_OVERRIDES, planOverrides, readOverrides, type OverridePlan } from "./overrides.ts";
import { CATALOG_PERMALINK, DEFAULT_DATA as DEFAULT_Z1114, type Z1114Data, type Z1114Dossier } from "./z1114.ts";
import { assignZ1114, type Z1114Assignment, type Z1114Unassigned } from "./z1114Match.ts";
import { carryAliases, type AliasResult } from "./aliases.ts";

const DEFAULT_REGISTER = fileURLToPath(
  new URL("../../../apps/web/src/lib/server/data/krdb-register.json", import.meta.url),
);

const DEFAULT_INDEXER_REGISTER = fileURLToPath(
  new URL("../../indexer/src/krdb/krdb-register.json", import.meta.url),
);

interface Args {
  out: string;
  xlsx?: string;
  register: string;
  z1114: string;
  overrides: string;
  /** Kopie des Registers für den Indexer; undefined = keine. */
  indexerRegister?: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    out: resolve("output"),
    register: DEFAULT_REGISTER,
    z1114: DEFAULT_Z1114,
    overrides: DEFAULT_OVERRIDES,
    force: false,
  };
  for (const arg of argv.slice(2)) {
    const [k, v] = arg.split(/=(.*)/s, 2);
    if (k === "--force") args.force = true;
    else if (k === "--out" && v) args.out = resolve(v);
    else if (k === "--xlsx" && v) args.xlsx = resolve(v);
    else if (k === "--register" && v) args.register = resolve(v);
    else if (k === "--z1114" && v) args.z1114 = resolve(v);
    else if (k === "--overrides" && v) args.overrides = resolve(v);
    else if (k === "--indexer-register" && v) args.indexerRegister = resolve(v);
    else throw new Error(`Unbekanntes Argument: ${arg}`);
  }
  // Die Kopie des Indexers gehört zum echten Register – ein abweichender
  // --register (Testlauf) lässt sie in Ruhe, ausser sie wird ausdrücklich genannt.
  if (!args.indexerRegister && args.register === DEFAULT_REGISTER) args.indexerRegister = DEFAULT_INDEXER_REGISTER;
  return args;
}

const clip = (s: string | undefined, n: number): string | undefined =>
  s && s.length > n ? `${s.slice(0, n - 1)}…` : s;

const UNKNOWN_ARTIST = /^(unknown|unbekannt|ohne angabe|anonym|n\/a)/i;

// Reste der Commons-Vorlage {{Institution}} («… institution QS:P195,…»).
const stripQs = (s: string): string => s.replace(/\s*institution QS:.*$/i, "").trim();

/** Urheber für den Bildnachweis: Platzhalter wie «Unknown author» fallen weg. */
function cleanArtist(artist: string | undefined): string | undefined {
  const a = artist ? stripQs(artist) : undefined;
  return a && !UNKNOWN_ARTIST.test(a) ? clip(a, 100) : undefined;
}

/** Knappe Quellenangabe: ETH-Boilerplate → «ETH-Bibliothek Zürich, Bildarchiv»;
 *  URLs, «Own work»/«Eigenes Werk» und lange Beschreibungen fallen weg (Link zur Dateiseite genügt). */
function cleanCredit(credit: string | undefined): string | undefined {
  if (!credit) return undefined;
  if (/ETH-Bibliothek/i.test(credit)) return "ETH-Bibliothek Zürich, Bildarchiv";
  credit = stripQs(credit);
  if (!credit) return undefined;
  if (/^https?:\/\//i.test(credit) || /^(own work|eigenes werk)$/i.test(credit) || credit.length > 100) return undefined;
  return credit;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  await mkdir(args.out, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  let buf: Uint8Array;
  if (args.xlsx) {
    buf = new Uint8Array(await readFile(args.xlsx));
    console.log(`[krdb] Export aus ${args.xlsx}`);
  } else {
    console.log(`[krdb] Lade Live-Export …`);
    buf = await downloadExport();
    const raw = join(args.out, `krdb-export-${today}.xlsx`);
    await writeFile(raw, buf);
    console.log(`[krdb] ${(buf.length / 1e6).toFixed(1)} MB → ${raw}`);
  }
  const data = parseExport(buf);
  console.log(`[krdb] ${data.persons.length} Personen, Blätter: ${JSON.stringify(data.sheetCounts)}`);

  console.log("[krdb] Wikidata-Verknüpfung …");
  const links = await linkWikidata(data.persons);
  const qids = [...new Set([...links.qid.values()].map((l) => l.qid))].sort();
  console.log(`[krdb] ${links.qid.size} Personen mit QID (${qids.length} Items)`);
  console.log(
    `[krdb] Veraltete P13468: ${links.staleP13468.length} Werte, ${links.staleResolved.length} Items zugeordnet, ${links.staleUnresolved.length} offen`,
  );

  const fileByQid = await fetchImages(qids);
  const overrides = await readOverrides(args.overrides);
  const infoByFile = await fetchImageInfo([...new Set([...fileByQid.values(), ...overrides.map((o) => o.file)])].sort());
  console.log(
    `[krdb] ${fileByQid.size} Items mit P18, ${overrides.length} kuratierte Porträts, ` +
      `${infoByFile.size} Bildinfos von Commons – wärme Vorschaubilder …`,
  );
  const brokenThumbs = new Set(await warmThumbs(infoByFile));

  const z1114 = await readZ1114(args.z1114);
  const zMatch = assignZ1114(
    (z1114?.dossiers ?? []).filter((d) => d.portraits.some((pt) => pt.img)),
    data.persons.map((p) => ({ id: p.id, first: p.first, last: p.last, born: p.born, seats: data.seats.get(p.id) ?? [] })),
  );
  const zByPerson = new Map(zMatch.assigned.map((a) => [a.personId, a]));
  console.log(
    `[krdb] Z 1114: ${zMatch.assigned.length} Personen mit Porträt zugeordnet, ${zMatch.unassigned.length} Dossiers offen oder doppelt`,
  );

  const nowYear = new Date().getUTCFullYear();
  const persons: KrdbPerson[] = [];
  const qidVia: Partial<Record<QidVia, number>> = {};
  let seats = 0;
  let openSeats = 0;
  const withP18 = new Set<number>();
  const z1114Shadowed: number[] = [];
  const missingInfo: Array<{ qid: string; file: string }> = [];
  for (const raw of data.persons) {
    const personSeats = data.seats.get(raw.id) ?? [];
    seats += personSeats.length;
    openSeats += personSeats.filter((st) => st[2] === null).length;
    const link = links.qid.get(raw.id);
    const file = link ? fileByQid.get(link.qid) : undefined;
    const info = file && !brokenThumbs.has(file) ? infoByFile.get(file) : undefined;
    if (link && file && !info) missingInfo.push({ qid: link.qid, file });
    if (info) withP18.add(raw.id);
    // Z 1114 nur, wo Commons kein Porträt liefert.
    const zHit = zByPerson.get(raw.id);
    if (zHit && info) z1114Shadowed.push(raw.id);
    const zImg = zHit && !info ? z1114Image(zHit.dossier) : undefined;
    const p: KrdbPerson = {
      id: raw.id,
      last: raw.last.trim(),
      first: raw.first.trim(),
      sex: raw.sex,
      born: raw.born && (raw.died || raw.born <= nowYear - 100) ? raw.born : undefined,
      died: raw.died,
      seats: personSeats,
      parties: data.parties.get(raw.id),
      places: placesDuringSeats(data.places.get(raw.id), personSeats),
      qid: link?.qid,
      qidVia: link?.via,
      img: info ? commonsImage(info) : zImg,
    };
    if (link) qidVia[link.via] = (qidVia[link.via] ?? 0) + 1;
    persons.push(p);
  }

  // Frühere IDs festhalten: die KRDB vergibt IDs bei Änderungen neu (aliases.ts).
  const aliasing = carryAliases(await readPreviousPersons(args.register), persons);
  console.log(
    `[krdb] Aliasse: ${aliasing.resolved.length} neu zugeordnet, ${aliasing.carried} übernommen, ` +
      `${aliasing.unresolved.length} ohne Zuordnung`,
  );

  // Kuratierte Commons-Porträts erst jetzt: ein Eintrag greift auch über eine Alias-ID.
  const overridePlan = planOverrides(
    persons.map((p) => ({
      id: p.id,
      last: p.last,
      aliases: p.aliases,
      hasP18: withP18.has(p.id),
      hasZ1114: p.img?.source === "z1114",
    })),
    overrides,
    (file) => infoByFile.has(file) && !brokenThumbs.has(file),
  );
  const personById = new Map(persons.map((p) => [p.id, p]));
  for (const a of overridePlan.apply) personById.get(a.personId)!.img = commonsImage(infoByFile.get(a.override.file)!);
  console.log(
    `[krdb] Kuratierte Porträts: ${overridePlan.apply.length} angewandt, ${overridePlan.shadowed.length} durch P18 überholt, ` +
      `${overridePlan.unknown.length + overridePlan.nameMismatch.length + overridePlan.noInfo.length} offen`,
  );
  const withImage = persons.filter((p) => p.img).length;
  const withZ1114 = persons.filter((p) => p.img?.source === "z1114").length;

  const personsBlock = persons.map((p) => JSON.stringify(p)).join(",\n");
  const hash = createHash("sha256").update(personsBlock).digest("hex").slice(0, 16);
  const meta: KrdbRegisterMeta = {
    generatedAt: new Date().toISOString(),
    hash,
    source: KRDB_EXPORT_URL,
    persons: persons.length,
    seats,
    withQid: links.qid.size,
    withImage,
    withZ1114,
    withOverride: overridePlan.apply.length,
    qidVia,
  };

  const previous = await readPreviousMeta(args.register);
  const problems = plausibility(meta, openSeats, links.staleP13468.length, byP13468Total(links), previous);
  const report = renderReport(meta, data.sheetCounts, links, missingInfo, [...brokenThumbs], problems, {
    data: z1114,
    assigned: zMatch.assigned,
    unassigned: zMatch.unassigned,
    shadowed: z1114Shadowed,
  }, aliasing, { total: overrides.length, plan: overridePlan });
  const reportPath = join(args.out, "report.md");
  await writeFile(reportPath, report);
  const csvPath = join(args.out, "p13468-korrekturen.csv");
  await writeFile(csvPath, correctionsCsv(links));
  console.log(`[krdb] Report → ${reportPath}, Korrekturen → ${csvPath}`);
  if (problems.length > 0 && !args.force) {
    throw new Error(`Plausibilitätsprüfung fehlgeschlagen (--force übergeht):\n  ${problems.join("\n  ")}`);
  }

  if (previous?.hash === hash) {
    console.log(`[krdb] Register unverändert (Hash ${hash}) – nichts geschrieben.`);
    await syncIndexerCopy(args.register, args.indexerRegister);
    return;
  }
  await mkdir(resolve(args.register, ".."), { recursive: true });
  const text = `{"meta":${JSON.stringify(meta)},\n"persons":[\n${personsBlock}\n]}\n`;
  JSON.parse(text); // Selbstkontrolle vor dem Ersetzen
  const tmp = `${args.register}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, args.register);
  console.log(`[krdb] Register → ${args.register}`);
  await syncIndexerCopy(args.register, args.indexerRegister);
  console.log(`[krdb] Fertig: ${JSON.stringify(meta)}`);
}

/** Kopie des Registers für den Indexer (src/krdb/): gleicher Inhalt, atomar ersetzt. */
async function syncIndexerCopy(source: string, target: string | undefined): Promise<void> {
  if (!target) return;
  const text = await readFile(source, "utf-8");
  if ((await readFile(target, "utf-8").catch(() => null)) === text) return;
  await mkdir(resolve(target, ".."), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, target);
  console.log(`[krdb] Kopie für den Indexer → ${target}`);
}

async function readPreviousPersons(path: string): Promise<KrdbPerson[]> {
  try {
    return (JSON.parse(await readFile(path, "utf-8")) as { persons: KrdbPerson[] }).persons;
  } catch {
    return [];
  }
}

async function readZ1114(path: string): Promise<Z1114Data | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Z1114Data;
  } catch (err) {
    console.warn(`[krdb] Z 1114 nicht lesbar (${path}) – nur Commons-Porträts: ${String(err)}`);
    return null;
  }
}

/** Autorschaft laut Katalog → Namen für den Bildnachweis: Wohnort-Zusätze
 *  («Beat Marti, Hombrechtikon») und Platzhalter fallen weg. Nennt das
 *  Subdossier mehrere Fotograf:innen, ist offen, wer das erste Bild gemacht
 *  hat – dann stehen alle da (ab vier: drei + «u. a.»). */
function cleanAuthor(author: string | undefined): string | undefined {
  const names = [
    ...new Set(
      (author ?? "")
        .split(/\s*(?:;|\\)\s*/)
        .map((a) => a.split(",")[0].trim())
        .filter((a) => a && !UNKNOWN_ARTIST.test(a) && !/^\[?unbekannt/i.test(a)),
    ),
  ];
  if (names.length === 0) return undefined;
  return clip(names.length > 3 ? `${names.slice(0, 3).join(" / ")} u. a.` : names.join(" / "), 100);
}

/** Register-Bild aus den Commons-Bildinfos (P18 oder kuratiert). */
function commonsImage(info: CommonsImage): KrdbImage {
  return {
    thumb: info.thumb,
    width: info.width,
    height: info.height,
    page: info.page,
    v: createHash("sha256").update(info.thumb).digest("hex").slice(0, 8),
    artist: cleanArtist(info.artist),
    credit: cleanCredit(info.credit),
    license: clip(info.license, 80),
    licenseUrl: info.licenseUrl,
  };
}

/** Register-Bild aus dem ersten Porträt-Subdossier mit Zuschnitt. */
function z1114Image(dossier: Z1114Dossier): KrdbImage | undefined {
  const pt = dossier.portraits.find((x) => x.img);
  if (!pt?.img) return undefined;
  return {
    thumb: pt.img.path,
    width: pt.img.width,
    height: pt.img.height,
    page: `${CATALOG_PERMALINK}${pt.ve}`,
    v: pt.img.v,
    artist: cleanAuthor(pt.author),
    credit: `Staatsarchiv Zürich, ${pt.signature}`,
    source: "z1114",
  };
}

/** Wohnorte nur, soweit sie eine Amtszeit (± 1 Jahr) berühren – mehr braucht der Abgleich nicht. */
function placesDuringSeats(
  places: Array<[string, string | null, string | null]> | undefined,
  seats: Array<[string, string, string | null, string | null]>,
): Array<[string, string | null, string | null]> | undefined {
  if (!places) return undefined;
  const year = (d: string | null, fallback: number) => (d ? Number(d.slice(0, 4)) : fallback);
  const kept = places.filter(([, from, to]) =>
    seats.some(([, sFrom, sTo]) => year(from, -Infinity) <= year(sTo, 9999) + 1 && year(sFrom, 0) - 1 <= year(to, 9999)),
  );
  return kept.length > 0 ? kept : undefined;
}

async function readPreviousMeta(path: string): Promise<KrdbRegisterMeta | null> {
  try {
    const head = (await readFile(path, "utf-8")).split("\n", 1)[0];
    return (JSON.parse(`${head.replace(/,$/, "")}}`) as { meta: KrdbRegisterMeta }).meta;
  } catch {
    return null;
  }
}

function byP13468Total(links: Awaited<ReturnType<typeof linkWikidata>>): number {
  return (
    links.staleP13468.length + [...links.qid.values()].filter((l) => l.via === "p13468").length
  );
}

/** Schutz vor kaputten Exporten und Netz-Aussetzern: lieber abbrechen als ein
 *  halbleeres Register committen. */
function plausibility(
  meta: KrdbRegisterMeta,
  openSeats: number,
  stale: number,
  p13468Total: number,
  previous: KrdbRegisterMeta | null,
): string[] {
  const problems: string[] = [];
  if (meta.persons < 4500) problems.push(`nur ${meta.persons} Personen (< 4500)`);
  if (meta.seats < 6500) problems.push(`nur ${meta.seats} Einsitze (< 6500)`);
  if (openSeats < 150 || openSeats > 230) problems.push(`${openSeats} offene Einsitze (erwartet 150–230)`);
  if (p13468Total > 0 && stale / p13468Total > 0.15) {
    problems.push(`${stale} von ${p13468Total} P13468-Werten zeigen auf unbekannte IDs – neu nummeriert?`);
  }
  if (previous && meta.withQid < previous.withQid * 0.9) {
    problems.push(`QIDs ${meta.withQid} < 90 % von bisher ${previous.withQid}`);
  }
  if (previous && meta.withImage < previous.withImage * 0.9) {
    problems.push(`Porträts ${meta.withImage} < 90 % von bisher ${previous.withImage}`);
  }
  return problems;
}

function renderReport(
  meta: KrdbRegisterMeta,
  sheetCounts: Record<string, number>,
  links: Awaited<ReturnType<typeof linkWikidata>>,
  missingInfo: Array<{ qid: string; file: string }>,
  brokenThumbs: string[],
  problems: string[],
  z1114: {
    data: Z1114Data | null;
    assigned: Array<Z1114Assignment<Z1114Dossier>>;
    unassigned: Array<Z1114Unassigned<Z1114Dossier>>;
    shadowed: number[];
  },
  aliasing: AliasResult,
  overrides: { total: number; plan: OverridePlan },
): string {
  const wd = (q: string) => `[${q}](https://www.wikidata.org/wiki/${q})`;
  const kr = (id: number | string) => `[${id}](https://www.web.statistik.zh.ch/webapp/KRRRPublic/app?id=${id})`;
  const out: string[] = [];
  out.push(`# KRDB-Register – Report`, "");
  out.push(`- Stand: ${meta.generatedAt}`, `- Quelle: ${meta.source}`);
  out.push(`- Blätter: ${Object.entries(sheetCounts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  out.push(`- Personen: ${meta.persons}, Einsitze: ${meta.seats}`);
  out.push(`- Mit Wikidata-QID: ${meta.withQid} (${Object.entries(meta.qidVia).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  out.push(
    `- Mit Porträt: ${meta.withImage} (davon Z 1114: ${meta.withZ1114 ?? 0}, kuratiert von Commons: ${meta.withOverride ?? 0})`,
    `- Hash: ${meta.hash}`,
    "",
  );
  if (problems.length > 0) {
    out.push(`## Plausibilitätsprüfung: ${problems.length} Problem(e)`, "");
    for (const p of problems) out.push(`- ${p}`);
    out.push("");
  }

  out.push(`## Routen-Konflikte (${links.conflicts.length})`, "");
  out.push("Verschiedene Items je Route; P13468 gewinnt, sonst nur bei Einigkeit der Normdaten verknüpft.", "");
  for (const c of links.conflicts) {
    const routes = Object.entries(c.routes)
      .map(([via, qs]) => `${via}: ${(qs ?? []).map(wd).join(", ")}`)
      .join(" · ");
    out.push(`- ${kr(c.id)} ${c.name} – ${routes}`);
  }
  out.push("", `## Veraltete P13468 auf Wikidata (${links.staleP13468.length})`, "");
  out.push(
    "Kantonsrats-IDs, die in der Live-KRDB nicht mehr vorkommen: Die KRDB vergibt die Personen-ID neu, wenn sich ein",
    "Datensatz ändert (Todesdatum, neue Einsitze, Korrekturen). Zugeordnete Items stehen mit Route `p13468alt` im",
    "Register. Für die Korrektur auf Wikidata (neue ID setzen, alten Wert entfernen oder als «missbilligt»",
    "markieren) steht die Zuordnung in `p13468-korrekturen.csv` für die linking-app.",
    "",
    `### Zugeordnet (${links.staleResolved.length})`,
    "",
  );
  for (const r of links.staleResolved) {
    const action = r.hasNew ? "neue ID schon gesetzt, alte bereinigen" : "neue ID setzen, alte bereinigen";
    const register = r.linkedAlready ? "Register-Link besteht schon (andere Route)" : "neu im Register";
    out.push(`- ${wd(r.qid)} ${r.name}: ${r.oldIds.join(", ")} → ${kr(r.newId)} · ${r.basis} · ${action} · ${register}`);
  }
  out.push("", `### Nicht zugeordnet (${links.staleUnresolved.length})`, "");
  for (const u of links.staleUnresolved) out.push(`- ${wd(u.qid)} ${u.name}: ${u.oldIds.join(", ")} – ${u.reason}`);
  out.push("", `## Items mit mehreren KRDB-Personen (${links.sharedQids.length})`, "");
  for (const s of links.sharedQids) out.push(`- ${wd(s.qid)}: ${s.ids.map(kr).join(", ")}`);
  out.push("", `## P18 ohne verwendbares Bild (${missingInfo.length})`, "");
  out.push("Keine Commons-Bildinfo oder Vorschaubild nicht abrufbar.", "");
  for (const m of missingInfo) out.push(`- ${wd(m.qid)}: ${m.file}${brokenThumbs.includes(m.file) ? " (Thumb-Fehler)" : ""}`);

  const op = overrides.plan;
  const file = (f: string) => `[${f}](https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f.replace(/ /g, "_"))})`;
  out.push("", `## Kuratierte Commons-Porträts (${op.apply.length} von ${overrides.total} angewandt)`, "");
  out.push(
    "Aus `data/portrait-overrides.json`: geprüfte Commons-Porträts für Personen ohne P18. P18 hat Vorrang, Z 1114",
    "weicht. Überholte Einträge entfernen; unbekannte IDs und Namensabweichungen prüfen (KRDB-ID neu vergeben?).",
    "",
  );
  const viaAlias = op.apply.filter((a) => a.via === "alias");
  const replaced = op.apply.filter((a) => a.replacesZ1114);
  if (viaAlias.length) out.push(`- Über alte ID: ${viaAlias.map((a) => `${a.override.id} → ${kr(a.personId)}`).join(", ")}`);
  if (replaced.length) out.push(`- Ersetzt Z 1114: ${replaced.map((a) => kr(a.personId)).join(", ")}`);
  for (const s of op.shadowed) out.push(`- Überholt (P18 vorhanden): ${kr(s.personId)} ${s.override.name}`);
  for (const u of op.unknown) out.push(`- Unbekannte ID: ${u.id} ${u.name}`);
  for (const m of op.nameMismatch) out.push(`- Name passt nicht: ${kr(m.personId)} «${m.last}» ≠ ${m.override.name}`);
  for (const n of op.noInfo) out.push(`- Datei fehlt oder Vorschaubild nicht abrufbar: ${kr(n.personId)} ${file(n.override.file)}`);
  for (const d of op.duplicate) out.push(`- Weiterer Eintrag ignoriert: ${d.id} ${d.name} – ${file(d.file)}`);

  out.push("", `## Neu vergebene KRDB-IDs (${aliasing.resolved.length} zugeordnet, ${aliasing.unresolved.length} offen)`, "");
  out.push(
    "Die KRDB vergibt Personen-IDs bei Änderungen neu. Verschwundene alte IDs werden der neuen ID derselben Person",
    "zugeordnet (Name, gemeinsamer Einsitz, Geburtsjahr) und als `aliases` im Register geführt: alte Personenseiten-",
    "URLs leiten um, und im Index noch unter der alten ID geführte Dokumente bleiben auffindbar (bis `--patch-krdb`).",
    "",
  );
  for (const r of aliasing.resolved) out.push(`- ${kr(r.newId)} ${r.name}: alt ${r.oldId}`);
  if (aliasing.unresolved.length > 0) out.push("", "Ohne Zuordnung (Person aus der KRDB verschwunden oder nicht eindeutig):", "");
  for (const u of aliasing.unresolved) out.push(`- ${u.id} ${u.name} – ${u.reason}`);

  const ve = (d: { ve: number; signature: string }) => `[${d.signature}](${CATALOG_PERMALINK}${d.ve})`;
  const zd = z1114.data;
  out.push("", "## Fotoporträts Z 1114 (Tamedia, Staatsarchiv)", "");
  if (!zd) out.push("Keine Daten (data/z1114.json fehlt).");
  else {
    const withImg = zd.dossiers.filter((d) => d.portraits.some((p) => p.img));
    const via = z1114.assigned.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.via]: (acc[a.via] ?? 0) + 1 }), {});
    out.push(
      `- Stand Katalog: ${zd.meta.generatedAt}, ${zd.meta.dossiers} Personendossiers, ${zd.meta.withScan} mit Digitalisat, ${withImg.length} mit erkanntem Foto`,
      `- Zugeordnet: ${z1114.assigned.length} (${Object.entries(via).map(([k, v]) => `${k} ${v}`).join(", ")}); im Register als Porträt: ${meta.withZ1114 ?? 0}; Commons hat Vorrang bei ${z1114.shadowed.length}`,
      "",
    );
    const extra = z1114.unassigned.filter((u) => u.reason.startsWith("weiteres Dossier"));
    const open = z1114.unassigned.filter((u) => !extra.includes(u));
    out.push(`### Nicht zugeordnet (${open.length})`, "");
    for (const u of open) out.push(`- ${ve(u.dossier)} ${u.dossier.title.split(" \\ ")[0]} – ${u.reason}`);
    out.push("", `### Weitere Dossiers derselben Person (${extra.length})`, "");
    for (const u of extra) out.push(`- ${ve(u.dossier)} ${u.dossier.title.split(" \\ ")[0]} – ${u.reason}`);
    const noted = z1114.assigned.filter((a) => a.note);
    out.push("", `### Abweichungen Katalog ↔ KRDB (${noted.length})`, "", "Über den Katalog-Link zugeordnet, Amtszeit passt, aber:", "");
    for (const a of noted) out.push(`- ${ve(a.dossier)} ${a.dossier.title.split(" \\ ")[0]} → ${kr(a.personId)}: ${a.note}`);
    const named = z1114.assigned.filter((a) => a.via === "name");
    out.push("", `### Über Name + Geburtsjahr zugeordnet (${named.length})`, "", "KRDB-Link im Katalog fehlt oder ist veraltet.", "");
    for (const a of named) out.push(`- ${ve(a.dossier)} ${a.dossier.title.split(" \\ ")[0]} → ${kr(a.personId)}${a.dossier.krdbIds.length ? ` (Katalog: ${a.dossier.krdbIds.join(", ")})` : ""}`);
  }
  out.push("");
  return out.join("\n");
}

/** Korrekturvorschläge für die linking-app: je Item alte ID(s) → neue ID. */
function correctionsCsv(links: Awaited<ReturnType<typeof linkWikidata>>): string {
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [["qid", "name", "alte_ids", "neue_id", "aktion", "grundlage"].join(",")];
  for (const r of links.staleResolved) {
    lines.push(
      [r.qid, r.name, r.oldIds.join(" "), r.newId, r.hasNew ? "alte bereinigen" : "neue setzen, alte bereinigen", r.basis]
        .map(cell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

main().catch((err) => {
  console.error(`[krdb] Fehler: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
