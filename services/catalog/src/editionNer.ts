/**
 * NER der Ratsmanuale (Modell `ft-hmbert-rm` aus einem nicht veröffentlichten Repo, nur auf dem Mac) für die Texte
 * der Editionen. Der Aufbau (editionsBuild.ts) schreibt je Stück die Lesefassung nach
 * `editions-ner-input.jsonl.gz`; services/rm-transkribus `rmtk.tag_texts` taggt sie in der
 * Umgebung dieses Modells und schreibt `editions-ner-spans.jsonl`; der nächste Aufbau liest
 * sie mit `--ner=<Datei>`.
 *
 * Regel wie bei den Ratsmanualen (rmtk.tag: «Trägt eine Seite schon Entitäten, wird sie
 * unverändert übernommen»): Die Auszeichnung der Bearbeitung hat Vorrang. Nur Stücke ganz ohne
 * ausgezeichnete Namen bekommen die Namen aus dem NER (Register, Facetten, Filter; die
 * Detailseite sagt «automatisch erkannt»), und zwar vereinheitlicht wie die Namen der
 * Ratsmanuale im Index `documents` (services/indexer rmNames.ts: Personen nur mit Vor- und
 * Nachname, Orte nur aus dem Ortsverzeichnis mit heutigem Namen, nur kuratierte Einrichtungen) –
 * so treffen die Namensfilter in beiden Reitern dieselben Werte. Für alle übrigen Stücke
 * vergleicht der Bericht das NER mit der Auszeichnung der Edition: die Formen (findet das Modell
 * die Stellen?) und die vereinheitlichten Namen gegen die Namen des Registers (taugen sie als
 * Filterwerte?) – so lässt sich messen, ob das Modell auf edierten Texten etwas taugt, bevor es
 * mehr darf.
 *
 * Eine Ausgabe gilt nur für den Text, aus dem sie stammt (`hash` der Lesefassung); nach einer
 * Änderung der Edition fällt sie weg, bis das NER neu gelaufen ist.
 *
 * Pur bis auf readNerSpans; unit-getestet in editionNer.test.ts.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { orgKey, personKey, placeKey } from "../../../apps/web/src/lib/entityKey.ts";
import { loadRmNames, rmOrgName, rmPersonName, rmPlaceName, rmPlacesInSpan, type RmNamesIndex } from "../../indexer/src/rmNames.ts";
import type { EditionTei } from "./editionTei.ts";

export type NerLabel = "PER" | "LOC" | "ORG";

/** Eine Zeile von editions-ner-input.jsonl.gz. */
export interface NerInput {
  /** Meili-ID des Stücks. */
  id: string;
  edition: string;
  /** Prüfsumme der Lesefassung (die Ausgabe gilt nur für genau diesen Text). */
  hash: string;
  /** Trägt das Stück ausgezeichnete Namen (dann gewinnt die Auszeichnung)? */
  marked: boolean;
  /** Lesefassung: ohne Anmerkungen und Gestrichenes, Abkürzungen aufgelöst, Absätze mit «\n». */
  text: string;
}

/** Eine Zeile von editions-ner-spans.jsonl: Zeichen-Offsets in `text` der Eingabe. */
export interface NerOutput {
  id: string;
  hash: string;
  model?: string;
  spans: Array<[NerLabel, number, number, string]>;
}

export type NerSpansById = Map<string, NerOutput>;

export function textHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export function nerInputOf(id: string, edition: string, tei: Pick<EditionTei, "text" | "persons" | "places" | "orgs">): NerInput {
  return { id, edition, hash: textHash(tei.text), marked: tei.persons.length + tei.places.length + tei.orgs.length > 0, text: tei.text };
}

const LABELS: ReadonlySet<string> = new Set(["PER", "LOC", "ORG"]);

/** Eine Zeile der Ausgabe prüfen; Unbrauchbares ⇒ null. */
export function parseNerLine(line: string): NerOutput | null {
  let r: unknown;
  try {
    r = JSON.parse(line);
  } catch {
    return null; // angeschnittene letzte Zeile nach Abbruch
  }
  const o = r as Partial<NerOutput> | null;
  if (!o || typeof o.id !== "string" || typeof o.hash !== "string" || !Array.isArray(o.spans)) return null;
  const spans = o.spans.filter(
    (s): s is [NerLabel, number, number, string] =>
      Array.isArray(s) && LABELS.has(s[0]) && Number.isInteger(s[1]) && Number.isInteger(s[2]) && s[2] > s[1] && typeof s[3] === "string",
  );
  return { id: o.id, hash: o.hash, model: typeof o.model === "string" ? o.model : undefined, spans };
}

/** Ausgabe des NER lesen (JSONL, auch .gz); fehlt die Datei, eine leere Liste. Spätere Zeilen
 *  derselben ID gewinnen (das Skript schreibt fort). */
export async function readNerSpans(path: string): Promise<NerSpansById> {
  const out: NerSpansById = new Map();
  try {
    await access(path);
  } catch {
    console.warn(`[editionen] NER-Ausgabe ${path} fehlt – ohne NER`);
    return out;
  }
  const stream = createReadStream(path);
  const input = path.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    const r = line.trim() ? parseNerLine(line) : null;
    if (r) out.set(r.id, r);
  }
  return out;
}

/** Form eines erkannten Namens: Leerraum vereinheitlicht, Satzzeichen am Rand weg; weniger als
 *  zwei Buchstaben ⇒ "" (verworfen). */
export function nerForm(text: string): string {
  const f = text.replace(/\s+/g, " ").replace(/^[\s.,;:!?()[\]«»"'„“”-]+|[\s.,;:!?()[\]«»"'„“”-]+$/g, "").trim();
  return (f.match(/\p{L}/gu) ?? []).length >= 2 ? f : "";
}

export interface NerEntities {
  persons: Array<{ name: string; gnd: null; forms: string[]; count: number }>;
  places: Array<{ name: string; lat: null; lon: null; forms: string[]; count: number }>;
  orgs: string[];
}

/**
 * Namen eines Stücks aus der NER-Ausgabe, wenn sie zu seinem Text passt (sonst null),
 * vereinheitlicht wie bei den Ratsmanualen (rmNames.ts): Personen-Spans ⇒ «Vorname Nachname»
 * (Nachname oder Vorname allein fällt weg) und der Ort nach «von/zu …», Orts-Spans ⇒ heutiger
 * Name aus dem Ortsverzeichnis, Organisations-Spans ⇒ kuratierte Einrichtung und der Amtsbereich.
 * `forms` = die Schreibungen im Text (bei Orten aus einem Personen-Span keine).
 */
export function nerEntitiesFor(entry: NerOutput | undefined, hash: string, idx: RmNamesIndex = loadRmNames()): NerEntities | null {
  if (!entry || entry.hash !== hash) return null;
  const count = <T extends { name: string; forms: string[]; count: number }>(m: Map<string, T>, name: string, form: string | null, make: () => T) => {
    const e = m.get(name) ?? make();
    e.count++;
    if (form && !e.forms.includes(form)) e.forms.push(form);
    m.set(name, e);
  };
  const persons = new Map<string, NerEntities["persons"][number]>();
  const places = new Map<string, NerEntities["places"][number]>();
  const place = (name: string, form: string | null) => count(places, name, form, () => ({ name, lat: null, lon: null, forms: [], count: 0 }));
  const orgs: string[] = [];
  for (const [label, , , raw] of entry.spans) {
    const form = nerForm(raw);
    if (!form) continue;
    if (label === "PER") {
      const name = rmPersonName(form, idx);
      if (name) count(persons, name, form, () => ({ name, gnd: null, forms: [], count: 0 }));
      for (const p of rmPlacesInSpan(form, "pers", idx)) place(p, null);
    } else if (label === "LOC") {
      const name = rmPlaceName(form, idx);
      if (name) place(name, form);
    } else {
      const name = rmOrgName(form);
      if (name && !orgs.includes(name)) orgs.push(name);
      for (const p of rmPlacesInSpan(form, "org", idx)) place(p, null);
    }
  }
  const byCount = <T extends { name: string; count: number }>(xs: Iterable<T>) => [...xs].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  return { persons: byCount(persons.values()), places: byCount(places.values()), orgs: orgs.sort((a, b) => a.localeCompare(b, "de")) };
}

// ── Vergleich mit der Auszeichnung der Edition ───────────────────────────────

const cmp = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

interface Counts {
  edition: number;
  found: number;
  ner: number;
  confirmed: number;
}

export interface NerEval {
  /** Stücke mit Auszeichnung und passender NER-Ausgabe. */
  pieces: number;
  /** ohne Ausgabe oder mit veraltetem Text. */
  missing: number;
  /** je Art: Formen der Edition, davon vom NER gefunden; Formen des NER, davon in der Edition. */
  byLabel: Record<NerLabel, Counts>;
  /** je Art: Namen des Registers im Stück gegen die vereinheitlichten Namen des NER (Mengen je
   *  Stück, verglichen über den Vergleichsschlüssel). */
  names: Record<NerLabel, Counts>;
}

export function newNerEval(): NerEval {
  const z = (): Counts => ({ edition: 0, found: 0, ner: 0, confirmed: 0 });
  return { pieces: 0, missing: 0, byLabel: { PER: z(), LOC: z(), ORG: z() }, names: { PER: z(), LOC: z(), ORG: z() } };
}

const KEY_OF: Record<NerLabel, (s: string) => string | null> = { PER: personKey, LOC: placeKey, ORG: orgKey };

/** Namen des Registers gegen die vereinheitlichten Namen des NER (je Stück als Mengen). */
function addNames(c: Counts, edition: readonly string[], ner: readonly string[], key: (s: string) => string | null): void {
  const ed = new Set(edition.map(key).filter((k): k is string => Boolean(k)));
  const nr = new Set(ner.map(key).filter((k): k is string => Boolean(k)));
  c.edition += ed.size;
  c.ner += nr.size;
  for (const k of ed) if (nr.has(k)) c.found++;
  for (const k of nr) if (ed.has(k)) c.confirmed++;
}

/** Ein Stück mit Auszeichnung: Formen der Edition gegen die Formen des NER (je Art als
 *  Mehrfachmenge, ohne Gross-/Kleinschreibung); mit `names` (Namen des Registers im Stück) auch
 *  die vereinheitlichten Namen des NER gegen diese. */
export function addNerEval(
  ev: NerEval,
  edition: Record<NerLabel, string[]>,
  entry: NerOutput | undefined,
  hash: string,
  names?: Record<NerLabel, readonly string[]>,
  idx: RmNamesIndex = loadRmNames(),
): void {
  if (!entry || entry.hash !== hash) {
    ev.missing++;
    return;
  }
  ev.pieces++;
  if (names) {
    const ner = nerEntitiesFor(entry, hash, idx);
    addNames(ev.names.PER, names.PER, ner?.persons.map((p) => p.name) ?? [], KEY_OF.PER);
    addNames(ev.names.LOC, names.LOC, ner?.places.map((p) => p.name) ?? [], KEY_OF.LOC);
    addNames(ev.names.ORG, names.ORG, ner?.orgs ?? [], KEY_OF.ORG);
  }
  for (const label of ["PER", "LOC", "ORG"] as const) {
    const ed = edition[label].map(cmp).filter(Boolean);
    const ner = entry.spans.filter((s) => s[0] === label).map((s) => cmp(nerForm(s[3]))).filter(Boolean);
    const b = ev.byLabel[label];
    b.edition += ed.length;
    b.ner += ner.length;
    const pool = new Map<string, number>();
    for (const f of ner) pool.set(f, (pool.get(f) ?? 0) + 1);
    for (const f of ed) {
      const n = pool.get(f) ?? 0;
      if (n > 0) {
        b.found++;
        pool.set(f, n - 1);
      }
    }
    const edPool = new Map<string, number>();
    for (const f of ed) edPool.set(f, (edPool.get(f) ?? 0) + 1);
    for (const f of ner) {
      const n = edPool.get(f) ?? 0;
      if (n > 0) {
        b.confirmed++;
        edPool.set(f, n - 1);
      }
    }
  }
}

const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)} %` : "–");

/** Abschnitt im Bericht: Vergleich des NER mit der Auszeichnung der Edition. */
export function nerEvalReport(ev: NerEval, nerPath: string | null): string[] {
  if (!nerPath) return ["## NER der Ratsmanuale", "", "- nicht gelesen (`--ner` fehlt); Eingabe für das Tagging: editions-ner-input.jsonl.gz", ""];
  const names: Record<NerLabel, string> = { PER: "Personen", LOC: "Orte", ORG: "Organisationen" };
  return [
    "## NER der Ratsmanuale gegen die Auszeichnung der Edition",
    "",
    `- Ausgabe: ${nerPath}; verglichen ${ev.pieces} Stücke mit Auszeichnung, ohne passende Ausgabe ${ev.missing}`,
    "- «gefunden» = Formen der Edition, die das NER im selben Stück auch erkennt (Mehrfachmenge je Stück, ohne Gross-/Kleinschreibung, nicht nach Stelle); «bestätigt» = Formen des NER, die die Edition im Stück auszeichnet.",
    "",
    "| Art | Formen der Edition | gefunden | Formen des NER | bestätigt |",
    "|---|---|---|---|---|",
    ...(["PER", "LOC", "ORG"] as const).map((l) => {
      const b = ev.byLabel[l];
      return `| ${names[l]} | ${b.edition} | ${b.found} (${pct(b.found, b.edition)}) | ${b.ner} | ${b.confirmed} (${pct(b.confirmed, b.ner)}) |`;
    }),
    "",
    "Vereinheitlichte Namen (wie die Ratsmanuale im Index `documents`, rmNames.ts) gegen die Namen des Registers im Stück, je Stück als Mengen über den Vergleichsschlüssel. Organisationen nur kuratierte Einrichtungen der Ratsmanuale, Orte nur aus deren Ortsverzeichnis – niedrige Werte dort heissen «nicht vorgesehen», nicht «falsch».",
    "",
    "| Art | Namen des Registers | vom NER | Namen des NER | im Register |",
    "|---|---|---|---|---|",
    ...(["PER", "LOC", "ORG"] as const).map((l) => {
      const b = ev.names[l];
      return `| ${names[l]} | ${b.edition} | ${b.found} (${pct(b.found, b.edition)}) | ${b.ner} | ${b.confirmed} (${pct(b.confirmed, b.ner)}) |`;
    }),
    "",
  ];
}
