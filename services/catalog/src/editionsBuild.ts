/**
 * Aufbau des Index `editions` (Reiter «Editionen», Detailseiten /editionen/<edition>/<id>)
 * auf dem Mac. Ein Lauf baut alle Editionen (der Import ersetzt den ganzen Index):
 * - QZH aus einem Klon von stazh/qzh-data (Branch `main` = veröffentlicht; `pre_publish` ist
 *   es nicht),
 * - Zürcher Rechtsquellen (SSRQ ZH) aus einem Klon von stazh/erqzh-data (eingefroren 2024).
 *
 *   npx tsx src/main.ts editionen-index --qzh=<Klon qzh-data> [--ssrq=<Klon erqzh-data>] [--ner=<Spans>] [--out=<dir>]
 *
 * Ausgabe in <out>: editions-docs.jsonl.gz (Index-Datei, Vektoren danach mit
 * embed/embed_catalog.py), editions-embed-input.jsonl.gz (Titel, Schlagwörter, Regest und
 * Kommentar – modernes Deutsch; den frühneuhochdeutschen Quellentext versteht jina kaum),
 * editions-ner-input.jsonl.gz (Lesefassung je Stück für das NER der Ratsmanuale,
 * editionNer.ts) und editions-report.md. Caches: Bildgrössen <out>/editions-iiif-cache.json
 * (QZH) bzw. editions-iiif-cache-<edition>.json, GND-Vorzugsnamen (lobid-gnd, für
 * QZH-Personen ohne Normnamen in den Ergänzungen) <out>/editions-gnd-cache.json. Heutige
 * Ortsnamen kennt der Aufbau aus den Wohnorten des KRDB-Registers (gazetteer.ts).
 *
 * Faksimiles: `pb/@facs` ist ein Dateiname auf dem IIIF-Bildserver der Edition
 * (media.sources-online.org, Kennung `qzh!<Datei>` bzw. `erqzh!<Datei>`) oder ein Canvas von
 * e-manuscripta.ch (Bilder der Zentralbibliothek Zürich). Die Web-App baut das Manifest aus
 * `facs` (Bilddienst, Breite, Höhe) – darum holt der Aufbau die Grössen einmal und merkt sie
 * sich. Was je Edition anders ist (Kennung, Zitierform, Permalink, Bildserver), steht in
 * editionSources.ts.
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { orgKey, personKey, placeKey } from "../../../apps/web/src/lib/entityKey.ts";
import { editionSearchForm } from "../../../apps/web/src/lib/rmText.ts";
import { buildRegisters, gndRecordOf, isPlaceSpelling, type EditionRegisters, type GndRecord } from "./editionRegisters.ts";
import {
  EDITION_SOURCES,
  groupSsrqFiles,
  ssrqPart,
  type EditionId,
  type EditionSource,
} from "./editionSources.ts";
import { addNerEval, nerEntitiesFor, nerEvalReport, nerInputOf, newNerEval, readNerSpans, type NerEntities, type NerSpansById } from "./editionNer.ts";
import { parseEditionTei, type EditionCalendar, type EditionTei, type RenderOptions } from "./editionTei.ts";
import { GazetteerBuilder } from "./gazetteer.ts";
import { writeJsonl } from "./load.ts";
import { buildSsrqRegisters } from "./ssrqRegisters.ts";

export { EDITION_SOURCES, type EditionId, type EditionSource };

/** KRDB-Register der Web-App (Wohnorte = heutige Ortsnamen für die Orte der Edition). */
const KRDB_REGISTER = fileURLToPath(new URL("../../../apps/web/src/lib/server/data/krdb-register.json", import.meta.url));

const UA = "archivquellen.ch Index-Aufbau Editionen (https://archivquellen.ch/impressum)";

/** Ein Bild des Stücks, wie die Web-App es fürs Manifest braucht. */
export interface FacsImage {
  /** IIIF-Image-API-2-Dienst (ohne /info.json). */
  service: string;
  width: number;
  height: number;
  /** Seite der Vorlage (`pb/@n`). */
  n: string;
  /** Herkunft des Digitalisats, wenn nicht das Staatsarchiv (e-manuscripta, Stadtarchiv …). */
  credit?: string;
}

export interface EditionPerson {
  name: string;
  gnd: string | null;
  forms: string[];
  count: number;
}

export interface EditionPlace {
  name: string;
  lat: number | null;
  lon: number | null;
  forms: string[];
  count: number;
}

/** Weitere Überlieferung eines Stücks (Rechtsquellen `_2` …): nur die Vorlage. */
export interface EditionWitness {
  /** Kennung des Texts in der Edition («SSRQ_ZH_NF_II_3_047_2»; Querverweise, edition-links.json). */
  textId: string;
  signature: string;
  /** Link der Edition auf die Vorlage (auch in einem anderen Archiv). */
  sourceUrl: string | null;
  catalogIds: number[];
  filiation: string | null;
  physical: string[];
  isoFrom: string | null;
  isoTo: string | null;
  textLang: string[];
}

/** Dokument des Index `editions` (Settings: editionsSettings.ts). */
export interface EditionDoc {
  id: string;
  edition: EditionId;
  localId: string;
  /** Zitierform («QZH_401», «SSRQ ZH NF II/3 Nr. 47»). */
  label: string;
  /** Laufnummer (Sortierung, Nachbarn); Rechtsquellen je Band. */
  nr: number | null;
  permalink: string;
  /** Titel zeichengetreu (Anzeige) und als Suchtext. */
  displayTitle: string;
  title: string;
  part: string;
  editors: string[];
  transcription: string[];
  tagging: string[];
  publisher: string | null;
  published: string | null;
  signature: string;
  sourceUrl: string | null;
  catalogIds: number[];
  textLang: string[];
  filiation: string | null;
  physical: string[];
  origPlace: string | null;
  witnesses: EditionWitness[];
  /** Pfad der TEI-Datei des Grundtexts im Repo der Edition («quellenstuecke/QZH_401.xml»,
   *  «ZH_NF_II_3/SSRQ_ZH_NF_II_3_047_1.xml»). */
  sourceFile: string;
  dated: boolean;
  isoFrom: string | null;
  isoTo: string | null;
  calendar: EditionCalendar | null;
  dateFrom: number | null;
  dateTo: number | null;
  sortDate: number | null;
  bibl: Array<{ head: string; html: string; text: string }>;
  keywords: string[];
  /** Erklärung je Schlagwort (Rechtsquellen: Taxonomie), Tooltip der Detailseite. */
  keywordGlosses: Record<string, string>;
  regestHtml: string | null;
  html: string;
  backHtml: string | null;
  notes: Array<{ key: string; label: string; type: string; html: string; inBack: boolean }>;
  /** Suchtexte (editionSearchForm). */
  regest: string;
  text: string;
  comment: string;
  noteText: string;
  persons: string[];
  personKeys: string[];
  personList: EditionPerson[];
  places: string[];
  placeKeys: string[];
  placeList: EditionPlace[];
  orgs: string[];
  orgKeys: string[];
  /** Woher die Namen stammen: «edition» (Auszeichnung der Bearbeitung) oder «ner» (automatisch
   *  erkannt mit dem Modell der Ratsmanuale, nur Stücke ohne Auszeichnung; editionNer.ts). */
  entitySource: "edition" | "ner" | null;
  /** Seiten der Vorlage in Textreihenfolge; `image` = Index in `facs`. */
  pages: Array<{ n: string; image: number | null }>;
  facs: FacsImage[];
  hasFacsimile: boolean;
}

/** Bildgrösse bzw. Canvas eines Faksimiles nachschlagen (null = nicht auf dem Bildserver). */
export type FacsResolver = (facs: string) => Omit<FacsImage, "n"> | null;

const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];

/** Name des Registers zu einer Nennung, wie Facette, Filter und `data-name` ihn führen. */
export function registerName(reg: EditionRegisters, kind: "person" | "place" | "org", form: string, ref: string | null): string {
  const name = kind === "person" ? reg.person(form, ref).name : kind === "place" ? reg.place(form, ref).name : reg.org(form, ref).name;
  return name.replace(/\s+/g, " ").trim();
}

/** Renderer-Optionen mit dem Register: jeder Name im HTML trägt seinen Filterwert. */
export function renderOptionsFor(reg: EditionRegisters, linkFor?: RenderOptions["linkFor"]): RenderOptions {
  return { linkFor, entityName: (kind, form, ref) => registerName(reg, kind, form, ref) || null };
}

function persons(tei: EditionTei, reg: EditionRegisters): EditionPerson[] {
  const by = new Map<string, EditionPerson>();
  for (const m of tei.persons) {
    const r = reg.person(m.form, m.ref);
    const name = registerName(reg, "person", m.form, m.ref);
    if (!name) continue;
    const p = by.get(name) ?? { name, gnd: r.gnd, forms: [], count: 0 };
    p.count++;
    if (!p.gnd && r.gnd) p.gnd = r.gnd;
    if (m.form && !p.forms.includes(m.form)) p.forms.push(m.form);
    by.set(name, p);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
}

function places(tei: EditionTei, reg: EditionRegisters): EditionPlace[] {
  const by = new Map<string, EditionPlace>();
  for (const m of tei.places) {
    const r = reg.place(m.form, m.ref);
    const name = registerName(reg, "place", m.form, m.ref);
    if (!name) continue;
    const p = by.get(name) ?? { name, lat: r.lat, lon: r.lon, forms: [], count: 0 };
    p.count++;
    if (p.lat === null && r.lat !== null) {
      p.lat = r.lat;
      p.lon = r.lon;
    }
    if (m.form && !p.forms.includes(m.form)) p.forms.push(m.form);
    by.set(name, p);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
}

/** Vergleichsschlüssel: die Namen des Stücks, bei Orten dazu die Schreibungen, die es selbst
 *  verwendet («Kyburch»; nicht Gattungswörter wie «land» für Mähren). Nicht die übrigen Formen
 *  des Registereintrags – person.xml und place.xml sammeln auch Fehlgriffe einzelner Stücke
 *  (editionRegisters.ts). */
function keysOf(names: readonly string[], forms: readonly string[], key: (s: string) => string | null): string[] {
  return uniq([...names, ...forms].map(key).filter((k): k is string => !!k));
}

const year = (iso: string | null) => (iso ? Number(iso.slice(0, 4)) : null);

/** Weitere Überlieferung aus ihrem TEI (nur der Kopf zählt). */
export function witnessOf(tei: EditionTei): EditionWitness {
  return {
    textId: tei.localId,
    signature: tei.signature,
    sourceUrl: tei.sourceUrl,
    catalogIds: tei.catalogIds,
    filiation: tei.filiation,
    physical: tei.physical,
    // Datum dieser Vorlage (bei einer Abschrift ihre Entstehung), nicht das des Rechtsakts.
    isoFrom: (tei.witnessDate ?? tei.date)?.from ?? null,
    isoTo: (tei.witnessDate ?? tei.date)?.to ?? null,
    textLang: tei.textLang,
  };
}

/** Was der Leser zu einem Stück weiss, das nicht im TEI steht: Kennung (Rechtsquellen ohne
 *  Textnummer), Teil (Band) und die weiteren Überlieferungen. */
export interface PieceExtra {
  localId?: string;
  part?: string;
  /** Pfad der TEI-Datei im Repo der Edition (ohne Angabe: `<fileId>.xml`). */
  sourceFile?: string;
  witnesses?: EditionWitness[];
  /** Namen aus dem NER der Ratsmanuale, nur für Stücke ohne Auszeichnung (editionNer.ts). */
  ner?: NerEntities | null;
}

/** Ein Stück als Index-Dokument. */
export function editionDoc(source: EditionSource, tei: EditionTei, reg: EditionRegisters, resolve: FacsResolver, extra: PieceExtra = {}): EditionDoc {
  const localId = extra.localId ?? tei.localId;
  const marked = tei.persons.length + tei.places.length + tei.orgs.length > 0;
  const ner = !marked && extra.ner ? extra.ner : null;
  const pl = ner ? ner.persons : persons(tei, reg);
  const pc = ner ? ner.places : places(tei, reg);
  const credit = source.imageCredit(tei.signature);
  const facs: FacsImage[] = [];
  const pages = tei.pages.map((p) => {
    const hit = p.facs ? resolve(p.facs) : null;
    if (!hit) return { n: p.n, image: null };
    facs.push({ ...hit, ...(credit && !hit.credit ? { credit } : {}), n: p.n });
    return { n: p.n, image: facs.length - 1 };
  });
  const isoFrom = tei.date?.from ?? null;
  const isoTo = tei.date?.to ?? null;
  const nr = /(\d+)$/.exec(localId)?.[1];
  const orgs = ner ? ner.orgs : uniq(tei.orgs.map((m) => registerName(reg, "org", m.form, m.ref)).filter(Boolean));
  const keywordGlosses: Record<string, string> = {};
  for (const k of tei.keywords) {
    const g = reg.keywordGloss(k.term, k.ref);
    if (g) keywordGlosses[k.term] = g;
  }
  return {
    id: `${source.edition}-${localId}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    edition: source.edition,
    localId,
    label: source.label(localId),
    nr: nr ? Number(nr) : null,
    permalink: source.permalink(localId),
    displayTitle: tei.title,
    title: editionSearchForm(tei.title),
    part: extra.part ?? tei.part,
    editors: tei.editors,
    transcription: tei.transcription,
    tagging: tei.tagging,
    publisher: tei.publisher,
    published: tei.published,
    signature: tei.signature,
    sourceUrl: tei.sourceUrl,
    catalogIds: tei.catalogIds,
    textLang: tei.textLang,
    filiation: tei.filiation,
    physical: tei.physical,
    origPlace: tei.origPlace,
    witnesses: extra.witnesses ?? [],
    sourceFile: extra.sourceFile ?? `${tei.localId}.xml`,
    dated: isoFrom !== null,
    isoFrom,
    isoTo,
    calendar: tei.calendar,
    dateFrom: year(isoFrom),
    dateTo: year(isoTo),
    sortDate: isoFrom ? Number(isoFrom.replace(/-/g, "")) : null,
    bibl: tei.bibl,
    keywords: tei.keywords.map((k) => k.term),
    keywordGlosses,
    regestHtml: tei.regestHtml,
    html: tei.html,
    backHtml: tei.backHtml,
    notes: tei.notes.map(({ key, label, type, html, inBack }) => ({ key, label, type, html, inBack })),
    regest: editionSearchForm(tei.regestText),
    text: editionSearchForm(tei.text),
    comment: editionSearchForm(tei.backText),
    noteText: editionSearchForm(tei.notes.map((n) => n.text).join("\n")),
    persons: pl.map((p) => p.name),
    personKeys: keysOf(pl.map((p) => p.name), [], personKey),
    personList: pl,
    places: pc.map((p) => p.name),
    placeKeys: keysOf(
      pc.map((p) => p.name),
      pc.flatMap((p) => p.forms.filter((f) => isPlaceSpelling(p.name, f))),
      placeKey,
    ),
    placeList: pc,
    orgs,
    orgKeys: uniq(orgs.map((o) => orgKey(o)).filter((k): k is string => !!k)),
    entitySource: marked ? "edition" : ner && pl.length + pc.length + orgs.length > 0 ? "ner" : null,
    pages,
    facs,
    hasFacsimile: facs.length > 0,
  };
}

/** jina liest bis 512 Token; mehr Zeichen braucht kein Stück. */
export const EMBED_MAX_CHARS = 2000;

/** Text fürs Embedding: modernes Deutsch der Bearbeitung (Titel, Schlagwörter, Regest,
 *  Kommentar), nicht der Quellentext. */
export function embedText(doc: Pick<EditionDoc, "displayTitle" | "keywords">, tei: Pick<EditionTei, "regestText" | "backText">): string | null {
  const parts = [doc.displayTitle, doc.keywords.length > 0 ? `Schlagwörter: ${doc.keywords.join(", ")}` : "", tei.regestText, tei.backText]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const text = parts.join("\n");
  return text ? text.slice(0, EMBED_MAX_CHARS) : null;
}

// ── Bildgrössen (Netz, gecacht) ───────────────────────────────────────────────

type CacheEntry = { width: number; height: number; service: string; credit?: string } | { missing: true };

/** Pause zwischen zwei Abrufen beim Bildserver der Edition. */
const IMAGE_PAUSE_MS = 400;

const E_MANUSCRIPTA_CANVAS = /^https:\/\/www\.e-manuscripta\.ch\/i3f\/v20\/(\d+)\/canvas\/(\d+)$/;

/** JSON holen; 429 und 5xx mit Pause wiederholen (Retry-After), andere Antworten sofort. */
async function fetchJson(url: string, attempts = 6): Promise<{ status: number; body: unknown }> {
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let wait = 2_000 * attempt;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      status = res.status;
      if (res.ok) return { status, body: await res.json() };
      if (status !== 429 && status < 500) return { status, body: null };
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) wait = Math.min(retryAfter, 120) * 1000;
      else if (status === 429) wait = 15_000 * attempt;
    } catch (err) {
      if (attempt >= attempts) throw err;
    }
    if (attempt >= attempts) return { status, body: null };
    await new Promise((r) => setTimeout(r, wait));
  }
}

interface ManifestCanvas {
  "@id": string;
  width: number;
  height: number;
  images?: Array<{ resource?: { service?: { "@id"?: string } | Array<{ "@id"?: string }> } }>;
}

/** Grössen der Bilder aller `facs` holen (nur, was der Cache noch nicht kennt). */
async function resolveImages(all: string[], source: EditionSource, cachePath: string): Promise<{ resolve: FacsResolver; fetched: number }> {
  let cache: Record<string, CacheEntry> = {};
  try {
    cache = JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    /* erster Lauf */
  }
  const todo = uniq(all).filter((f) => !(f in cache));
  let fetched = 0;
  // e-manuscripta: ein Manifest je Handschrift, daraus Canvas → Bilddienst, Grösse, Bibliothek.
  const manifests = uniq(todo.flatMap((f) => E_MANUSCRIPTA_CANVAS.exec(f)?.[1] ?? []));
  for (const m of manifests) {
    const { status, body } = await fetchJson(`https://www.e-manuscripta.ch/i3f/v20/${m}/manifest`);
    fetched++;
    const man = body as { sequences?: Array<{ canvases?: ManifestCanvas[] }>; metadata?: Array<{ label?: string; value?: string }> } | null;
    const holder = man?.metadata?.find((e) => e.label === "Besitzende Institution")?.value;
    const credit = `${holder ? `${holder}, ` : ""}e-manuscripta.ch`;
    for (const c of man?.sequences?.[0]?.canvases ?? []) {
      const svc = c.images?.[0]?.resource?.service;
      const id = (Array.isArray(svc) ? svc[0] : svc)?.["@id"];
      if (id && c.width > 0 && c.height > 0) cache[c["@id"]] = { service: id, width: c.width, height: c.height, credit };
    }
    for (const f of todo) if (E_MANUSCRIPTA_CANVAS.exec(f)?.[1] === m && !(f in cache)) cache[f] = { missing: true };
    if (status !== 200) console.warn(`[editionen] e-manuscripta-Manifest ${m}: HTTP ${status}`);
  }
  // Bildserver der Edition: info.json je Bild, eins nach dem anderen mit kurzer Pause (der
  // Server antwortet sonst mit 429). Nur 404 gilt als «kein Bild»; andere Fehler merkt sich
  // der Cache nicht, der nächste Lauf fragt nochmals.
  const files = todo.filter((f) => !E_MANUSCRIPTA_CANVAS.test(f) && !(f in cache));
  let failed = 0;
  for (const f of files) {
    const service = source.imageService(f);
    const { status, body } = await fetchJson(`${service}/info.json`);
    fetched++;
    const info = body as { width?: number; height?: number } | null;
    if (info && info.width && info.height) cache[f] = { service, width: info.width, height: info.height };
    else if (status === 404) cache[f] = { missing: true };
    else {
      failed++;
      console.warn(`[editionen] ${f}: HTTP ${status} – beim nächsten Lauf nochmals`);
    }
    if (fetched % 100 === 0) {
      console.log(`[editionen] ${fetched} von ${files.length + manifests.length} Bildgrössen geholt …`);
      await writeFile(cachePath, JSON.stringify(cache));
    }
    await new Promise((r) => setTimeout(r, IMAGE_PAUSE_MS));
  }
  if (failed > 0) console.warn(`[editionen] ${failed} Bildgrössen nicht erhalten`);
  if (fetched > 0) await writeFile(cachePath, JSON.stringify(cache));
  return {
    resolve: (f) => {
      const e = cache[f];
      return e && !("missing" in e) ? { service: e.service, width: e.width, height: e.height, ...(e.credit ? { credit: e.credit } : {}) } : null;
    },
    fetched,
  };
}

// ── GND-Vorzugsnamen (Netz, gecacht) ──────────────────────────────────────────

type GndEntry = { record: GndRecord } | { missing: true } | { error: number; at: string };

/** Pause zwischen zwei Abrufen bei lobid-gnd. */
const GND_PAUSE_MS = 150;
/** Nach so vielen Fehlschlägen in Folge gilt lobid als nicht erreichbar: der Lauf bricht die
 *  Abfrage ab (die Personen behalten die erste Schreibung, der Bericht nennt die Zahl). */
const GND_MAX_FAILURES = 5;
/** Fehlerantworten (lobid gibt für manche gelöschte Nummer dauerhaft 500) fragt der Aufbau
 *  erst nach dieser Frist wieder. */
const GND_RETRY_MS = 7 * 24 * 3600_000;

/** Vorzugsnamen, Varianten und Lebensjahre der GND-Personen holen (nur, was der Cache noch
 *  nicht kennt). 404 gilt als «gibt es nicht», andere Fehler merkt sich der Cache mit Datum. */
async function resolveGndRecords(
  ids: Iterable<string>,
  cachePath: string,
): Promise<{ records: Map<string, GndRecord>; fetched: number; missing: number; aborted: boolean }> {
  let cache: Record<string, GndEntry> = {};
  try {
    cache = JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    /* erster Lauf */
  }
  const now = Date.now();
  const fresh = (e: GndEntry | undefined) =>
    !!e && ("record" in e || "missing" in e || ("error" in e && now - Date.parse(e.at) < GND_RETRY_MS));
  const todo = uniq(ids).filter((id) => !fresh(cache[id]));
  let fetched = 0;
  let failures = 0;
  let aborted = false;
  for (const id of todo) {
    let status = 0;
    try {
      const res = await fetchJson(`https://lobid.org/gnd/${encodeURIComponent(id)}.json`, 2);
      status = res.status;
      if (status === 200) cache[id] = { record: gndRecordOf(res.body) };
      else if (status === 404) cache[id] = { missing: true };
    } catch {
      /* Netzfehler */
    }
    fetched++;
    if (status === 200 || status === 404) failures = 0;
    else {
      cache[id] = { error: status, at: new Date(now).toISOString() };
      console.warn(`[editionen] GND ${id}: ${status ? `HTTP ${status}` : "nicht erreichbar"} – in ${GND_RETRY_MS / 86_400_000} Tagen nochmals`);
      if (++failures >= GND_MAX_FAILURES) {
        aborted = true;
        console.warn(`[editionen] lobid-gnd: ${failures} Fehlschläge in Folge – Abfrage abgebrochen`);
        break;
      }
    }
    if (fetched % 25 === 0) await writeFile(cachePath, JSON.stringify(cache));
    await new Promise((r) => setTimeout(r, GND_PAUSE_MS));
  }
  if (fetched > 0) await writeFile(cachePath, JSON.stringify(cache));
  const records = new Map<string, GndRecord>();
  let missing = 0;
  for (const id of uniq(ids)) {
    const e = cache[id];
    if (e && "record" in e) records.set(id, e.record);
    else missing++;
  }
  return { records, fetched, missing, aborted };
}

/** Heutige Ortsnamen aus den Wohnorten des KRDB-Registers (wie im Ortsverzeichnis des Katalogs). */
async function knownPlaceNames(registerPath: string): Promise<ReadonlySet<string>> {
  const gaz = new GazetteerBuilder();
  try {
    const reg = JSON.parse(await readFile(registerPath, "utf8")) as { persons?: Array<{ places?: Array<[string, ...unknown[]]> }> };
    for (const p of reg.persons ?? []) for (const [name] of p.places ?? []) gaz.addKrdbPlace(name);
  } catch (err) {
    console.warn(`[editionen] KRDB-Register nicht lesbar (${(err as Error).message}) – Orte mit erster Form`);
  }
  return gaz.build().all;
}

// ── Lauf ─────────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("de-CH");

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Ein Stück, wie der Leser es liefert: Grundtext, weitere Überlieferungen, Teil. */
interface PieceInput {
  localId: string;
  /** Pfad der Grundtext-Datei im Repo der Edition. */
  sourceFile: string;
  main: { fileId: string; xml: string };
  witnesses: Array<{ fileId: string; xml: string }>;
  part?: string;
}

/** Eine Edition, eingelesen: Quelle, Stücke, Register, Zeilen für den Bericht. */
interface LoadedEdition {
  source: EditionSource;
  root: string;
  pieces: PieceInput[];
  reg: EditionRegisters;
  /** Cache der Bildgrössen (QZH behält den bisherigen Dateinamen). */
  iiifCache: string;
  report: string[];
  /** Zeilen für den Bericht, die erst nach dem Lesen der Stücke feststehen. */
  lateReport?: () => string[];
}

async function loadQzh(root: string, out: string, krdbRegister: string): Promise<LoadedEdition> {
  const source = EDITION_SOURCES.qzh;
  const dir = join(root, "quellenstuecke");
  const files = (await readdir(dir)).filter((f) => /^QZH_\d+\.xml$/.test(f)).sort();
  const pieces: PieceInput[] = await Promise.all(
    files.map(async (f) => ({
      localId: f.slice(0, -4),
      sourceFile: `quellenstuecke/${f}`,
      main: { fileId: f.slice(0, -4), xml: await readFile(join(dir, f), "utf8") },
      witnesses: [],
    })),
  );
  const personXml = await readOptional(join(root, "person/person.xml"));
  // GND-Personen der Stücke und des Registers: Vorzugsname, wo die Ergänzungen keinen nennen.
  const gndIds = uniq([...pieces.map((p) => p.main.xml), personXml ?? ""].flatMap((x) => [...x.matchAll(/(?:ref|xml:id)="GND_([0-9X-]+)"/g)].map((m) => m[1])));
  const gnd = await resolveGndRecords(gndIds, join(out, "editions-gnd-cache.json"));
  const reg = buildRegisters({
    person: personXml,
    personAdditions: await readOptional(join(root, "person/person-additions.xml")),
    place: await readOptional(join(root, "place/place.xml")),
    placeAdditions: await readOptional(join(root, "place/place-additions.xml")),
    gndRecords: gnd.records,
    knownPlaces: await knownPlaceNames(krdbRegister),
  });
  const modernized = reg.modernizedPlaces();
  const gndUsed = reg.gndReport();
  const report = [
    `- GND-Personen: ${fmt(gndIds.length)}, Datensätze von lobid-gnd ${fmt(gnd.records.size)} (${gnd.fetched} Abrufe, ohne Datensatz ${gnd.missing}${gnd.aborted ? ", ABFRAGE ABGEBROCHEN – lobid nicht erreichbar" : ""}); Namen aus der GND ${fmt(gndUsed.used.length)}, verworfen ${fmt(gndUsed.rejected.length)}`,
    "",
    ...(modernized.length ? ["### Orte mit heutiger Schreibung (statt der ersten Form)", "", ...modernized.map(([from, to]) => `- ${from} → ${to}`), ""] : []),
    ...(gndUsed.used.length
      ? ["### Personen mit dem Namen aus der GND (statt der ersten Schreibung)", "", ...gndUsed.used.map(([g, from, to]) => `- ${from || "–"} → ${to} (GND ${g})`), ""]
      : []),
    ...(gndUsed.rejected.length
      ? [
          "### GND-Namen verworfen (kein Wort gemeinsam mit den Schreibungen der Edition – Verweis der Edition prüfen)",
          "",
          ...gndUsed.rejected.map(([g, from, to]) => `- ${from || "–"} ≠ ${to} (GND ${g})`),
          "",
        ]
      : []),
  ];
  // Verweise mit Lebensjahren sammelt das Register erst beim Lesen der Stücke.
  const lateReport = () => {
    const dated = reg.gndReport().dated;
    return dated.length
      ? [
          "### Verweise mit Lebensjahren (als Name; gleiche GND-Person = gleicher Name)",
          "",
          ...dated.map(
            ([ref, name, g, similar]) =>
              `- ${ref} → ${name}${g ? ` (GND ${g})` : ""}${similar.length ? ` – prüfen, ähnlich: GND ${similar.join(", GND ")}` : ""}`,
          ),
          "",
        ]
      : [];
  };
  return { source, root, pieces, reg, iiifCache: join(out, "editions-iiif-cache.json"), report, lateReport };
}

async function loadSsrq(root: string, out: string): Promise<LoadedEdition> {
  const source = EDITION_SOURCES.ssrq;
  const volumes = (await readdir(root)).filter((d) => /^ZH_(?:NF|AF)_[IVX]+(?:_\d{1,2}){0,2}$/.test(d)).sort();
  const pieces: PieceInput[] = [];
  for (const volume of volumes) {
    if (!(await isDir(join(root, volume)))) continue;
    const part = ssrqPart(volume, await readOptional(join(root, volume, "volinfo.xml")));
    for (const p of groupSsrqFiles(await readdir(join(root, volume)))) {
      const read = async (fileId: string) => ({ fileId, xml: await readFile(join(root, volume, `${fileId}.xml`), "utf8") });
      pieces.push({
        localId: p.localId,
        sourceFile: `${volume}/${p.main.fileId}.xml`,
        main: await read(p.main.fileId),
        witnesses: await Promise.all(p.witnesses.map((w) => read(w.fileId))),
        part,
      });
    }
  }
  const reg = buildSsrqRegisters({
    person: await readOptional(join(root, "person/person.xml")),
    place: await readOptional(join(root, "place/place.xml")),
    organization: await readOptional(join(root, "organization/organization.xml")),
    taxonomy: await readOptional(join(root, "taxonomy/taxonomy.xml")),
  });
  const c = reg.counts;
  const report = [
    `- Bände: ${volumes.join(", ")}`,
    `- Register: ${fmt(c.persons)} Personen (${fmt(c.namesakes)} mit gleichem Namen, Datierung dahinter), ${fmt(c.places)} Orte, ${fmt(c.orgs)} Organisationen, ${fmt(c.keywords)} Schlagwörter`,
    "",
  ];
  return { source, root, pieces, reg, iiifCache: join(out, "editions-iiif-cache-ssrq.json"), report };
}

/** Formen je Art in einem Stück (für den Vergleich mit dem NER). */
function formsOf(tei: EditionTei): Record<"PER" | "LOC" | "ORG", string[]> {
  const f = (ms: Array<{ form: string }>) => ms.map((m) => m.form).filter(Boolean);
  return { PER: f(tei.persons), LOC: f(tei.places), ORG: f(tei.orgs) };
}

export async function runEditionsBuild(opts: { qzh?: string; ssrq?: string; ner?: string; out: string; krdbRegister?: string }): Promise<void> {
  const t0 = Date.now();
  const loaded: LoadedEdition[] = [];
  if (opts.qzh) loaded.push(await loadQzh(opts.qzh, opts.out, opts.krdbRegister ?? KRDB_REGISTER));
  if (opts.ssrq) loaded.push(await loadSsrq(opts.ssrq, opts.out));
  if (loaded.length === 0) throw new Error("editionen-index: --qzh und/oder --ssrq angeben");
  const ner: NerSpansById = opts.ner ? await readNerSpans(opts.ner) : new Map();

  // Verweise der Editionen auf eigene Stücke (auch über die Edition hinweg) zeigen auf die
  // Detailseiten der Plattform.
  const known = new Map<EditionId, Set<string>>(loaded.map((e) => [e.source.edition, new Set(e.pieces.map((p) => p.localId))]));
  const linkFor = (target: string) => {
    for (const e of loaded) {
      const id = e.source.ownTarget(target);
      if (id && known.get(e.source.edition)?.has(id)) return `/editionen/${e.source.edition}/${id}`;
    }
    return target;
  };

  const docsOut = writeJsonl(join(opts.out, "editions-docs.jsonl.gz"));
  const embedOut = writeJsonl(join(opts.out, "editions-embed-input.jsonl.gz"));
  const nerOut = writeJsonl(join(opts.out, "editions-ner-input.jsonl.gz"));
  const sections: string[] = [];
  const nerEval = newNerEval();
  let totalDocs = 0;
  for (const e of loaded) {
    const renderOpts = { ...renderOptionsFor(e.reg, linkFor), originalDateFirst: e.source.originalDateFirst };
    const parsed: Array<{ piece: PieceInput; tei: EditionTei; witnesses: EditionWitness[] }> = [];
    const failed: string[] = [];
    for (const piece of e.pieces) {
      try {
        const tei = parseEditionTei(piece.main.xml, piece.main.fileId, renderOpts);
        const witnesses = piece.witnesses.map((w) => witnessOf(parseEditionTei(w.xml, w.fileId, renderOpts)));
        parsed.push({ piece, tei, witnesses });
      } catch (err) {
        failed.push(`${piece.main.fileId}: ${(err as Error).message}`);
      }
    }
    const allFacs = parsed.flatMap((p) => p.tei.pages.flatMap((pg) => (pg.facs ? [pg.facs] : [])));
    const { resolve, fetched } = await resolveImages(allFacs, e.source, e.iiifCache);

    const byPart = new Map<string, number>();
    const unknown = new Map<string, number>();
    let withFacs = 0;
    let images = 0;
    let missingImages = 0;
    let embedded = 0;
    let notes = 0;
    let undated = 0;
    let witnesses = 0;
    let unmarked = 0;
    let withNer = 0;
    let datedNames = 0;
    let minYear = Infinity;
    let maxYear = -Infinity;
    for (const { piece, tei, witnesses: ws } of parsed) {
      const input = nerInputOf(`${e.source.edition}-${piece.localId}`.replace(/[^A-Za-z0-9_-]/g, "_"), e.source.edition, tei);
      const entry = ner.get(input.id);
      const nerEntities = nerEntitiesFor(entry, input.hash);
      const doc = editionDoc(e.source, tei, e.reg, resolve, { localId: piece.localId, part: piece.part, sourceFile: piece.sourceFile, witnesses: ws, ner: nerEntities });
      await docsOut.write(doc);
      if (input.text) await nerOut.write(input);
      const et = embedText(doc, tei);
      if (et) {
        await embedOut.write({ id: doc.id, text: et });
        embedded++;
      }
      if (input.marked) addNerEval(nerEval, formsOf(tei), entry, input.hash, { PER: doc.persons, LOC: doc.places, ORG: doc.orgs });
      else if (input.text) unmarked++;
      if (doc.entitySource === "ner") withNer++;
      datedNames += tei.datedNames;
      byPart.set(doc.part, (byPart.get(doc.part) ?? 0) + 1);
      for (const u of tei.unknown) unknown.set(u, (unknown.get(u) ?? 0) + 1);
      if (doc.hasFacsimile) withFacs++;
      images += doc.facs.length;
      missingImages += tei.pages.filter((p) => p.facs).length - doc.facs.length;
      notes += doc.notes.length;
      witnesses += doc.witnesses.length;
      if (doc.dateFrom === null) undated++;
      else {
        minYear = Math.min(minYear, doc.dateFrom);
        maxYear = Math.max(maxYear, doc.dateTo ?? doc.dateFrom);
      }
    }
    totalDocs += parsed.length;
    sections.push(
      `## ${e.source.edition.toUpperCase()}`,
      "",
      `- Quelle: ${e.root}`,
      `- Stücke: ${fmt(parsed.length)}${failed.length ? `, ${failed.length} nicht lesbar` : ""}${witnesses ? `; weitere Überlieferungen: ${fmt(witnesses)}` : ""}`,
      `- Zeitraum: ${minYear}–${maxYear}, ohne Datum: ${undated}`,
      `- Anmerkungen: ${fmt(notes)}`,
      `- Faksimile: ${fmt(withFacs)} Stücke, ${fmt(images)} Bilder (${missingImages} Verweise ohne Bild auf dem Server), ${fetched} Abrufe`,
      `- Embedding-Texte: ${fmt(embedded)}`,
      `- Namen in Datumsangaben (nicht im Register): ${fmt(datedNames)}`,
      `- Stücke ohne Auszeichnung von Namen: ${fmt(unmarked)}${opts.ner ? `, davon mit Namen aus dem NER: ${fmt(withNer)}` : " (NER: --ner nicht gesetzt)"}`,
      ...e.report,
      ...(e.lateReport?.() ?? []),
      "### Teile",
      "",
      ...[...byPart].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([p, n]) => `- ${p}: ${fmt(n)}`),
      "",
      ...(unknown.size ? ["### Unbekannte Elemente (durchgereicht)", "", ...[...unknown].map(([u, n]) => `- \`${u}\`: ${n} Stücke`), ""] : []),
      ...(failed.length ? ["### Nicht lesbar", "", ...failed.map((m) => `- ${m}`), ""] : []),
    );
  }
  await docsOut.close();
  await embedOut.close();
  await nerOut.close();

  const report = [
    "# Index `editions` – Aufbau",
    "",
    `- Dokumente: ${fmt(totalDocs)} (${loaded.map((e) => e.source.edition).join(", ")})`,
    "",
    ...sections,
    ...nerEvalReport(nerEval, opts.ner ?? null),
  ].join("\n");
  await writeFile(join(opts.out, "editions-report.md"), report);
  console.log(report);
  console.log(`[editionen] fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${join(opts.out, "editions-docs.jsonl.gz")}`);
}
