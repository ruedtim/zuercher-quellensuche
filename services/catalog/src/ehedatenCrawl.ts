/**
 * Eheeinträge aus dem Crawl des Online-Archivkatalogs → EdbEntry (ehedaten.ts). Die Katalogseite
 * führt die Spalten der Ehedatenbank nicht einzeln, sondern setzt sie zusammen; die Lesart ist am
 * Export vom 2026-11-09 (296'293 Einträge) gegen den Zenodo-Datensatz v6.0 geprüft:
 *
 * - Titel «Nachname, Vorname[, Herkunft], getraut mit Nachname, Vorname[, Herkunft]». Jede Person
 *   hat Vor- und Nachnamen, keine Angabe enthält ein Komma. Weitere Zeilen im Titel sind eine dorthin
 *   geratene Zusatzinfo (ein Eintrag).
 * - «Inhalt und Form»: «Zusatzinformation:», dann die Zusatzinfo des Bräutigams und die der Braut, je
 *   eine Zeile («-» = leer; fehlt die der Braut, steht nur eine Zeile). Die Ehedatenbank trennte
 *   Zeilen mit «XXX», der Katalog macht aus jedem «XXX» einen Umbruch, ohne auf Gross- und
 *   Kleinschreibung zu achten: auch in römischen Kapitelzahlen («Ps. CXXXII» → «Ps. C⏎II») und nach
 *   einem Wort auf «x» («Peseux» + «XXX» → «Peseu⏎X»). splitZusatz macht beides rückgängig und trennt
 *   Bräutigam und Braut; die Zenodo-CSV trennte dieselben Zeilen schlechter (erste Zeile = Bräutigam).
 * - GND-Links und Weblinks (HLS): im Katalog je Eintrag höchstens einer. Der GND-Link nennt die
 *   Person, der HLS-Link nicht: er gehört zur Person mit GND, sonst zum Bräutigam (Zenodo: 714 von
 *   719 HLS-Artikeln beim Bräutigam). Hat Zenodo für beide einen (ein Eintrag), zeigt der Katalog
 *   nur den des Bräutigams.
 * - Provenienz «Kirchgemeinde X», Anmerkungen = Seite bzw. Teil im Band, Entstehungszeitraum in der
 *   Schreibweise des Katalogs («23.07.1553», «zwischen ca. 10.03.1683 und ca. 07.09.1683»).
 *
 * Pur, unit-getestet in ehedatenCrawl.test.ts.
 */

import { parseCatalogDays } from "./dates.ts";
import type { EdbEntry, EdbPersonInput, EhedatenDate } from "./ehedaten.ts";
import { fieldText } from "./links.ts";
import type { CatalogLink, CatalogRecord } from "./types.ts";

/** Was der Aufbau beim Lesen einer Einheit ergänzt oder angenommen hat (für den Bericht). */
export type CrawlNoteKind =
  /** weitere Zeilen im Titel, als Zusatzinfo gelesen */
  | "titel-zusatz"
  /** «XXX» einer Kapitelzahl wiederhergestellt */
  | "bibelstelle"
  /** «x» am Wortende vor dem Umbruch zurückgeholt */
  | "x-verschoben"
  /** mehr als zwei Zeilen Zusatzinfo, nach Regel getrennt */
  | "mehrzeilig"
  /** GND- bzw. HLS-Link ohne eindeutigen Namen der Person zugeordnet */
  | "link-zuordnung"
  /** Link ohne gültige GND- bzw. HLS-Nummer übergangen */
  | "link-ungueltig";

export interface CrawlNote {
  kind: CrawlNoteKind;
  detail: string;
}

export interface CrawlEntry {
  entry: EdbEntry | null;
  /** Warum kein Eintrag entstand. */
  reason?: string;
  notes: CrawlNote[];
}

type NameParts = Pick<EdbPersonInput, "nachname" | "vorname" | "herkunft">;

export interface TitleParts {
  /** Erste Zeile des Titels (die Zeile, die der Online-Katalog als Titel meint). */
  titel: string;
  mann: NameParts;
  frau: NameParts;
  /** Weitere Zeilen des Titels. */
  rest: string[];
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** «Nachname, Vorname[, Herkunft], getraut mit …» → Teile; null, wenn das Muster fehlt. */
export function splitEdbTitle(title: string | null | undefined): TitleParts | null {
  const [first = "", ...rest] = (title ?? "").split("\n").map(norm);
  const sides = first.split(", getraut mit ");
  if (sides.length !== 2) return null;
  const [mann, frau] = sides.map((side): NameParts => {
    const [nachname = "", vorname = "", ...herkunft] = side.split(", ").map(norm);
    return { nachname, vorname, herkunft: herkunft.join(", ") };
  });
  if (!mann.nachname || !frau.nachname) return null;
  return { titel: first, mann, frau, rest: rest.filter(Boolean) };
}

/** Bibelbücher vor einer Kapitelzahl, wie die Ehedatenbank sie abkürzt, wahlweise mit dem Anfang
 *  der römischen Zahl («Ps. C» für CXXXII, «Ps. L» für LXXXIV). */
const BEFORE_CHAPTER = /(?:^|[^\p{L}])(?:Ps|Psalm|Pslm|Prov|Cap|Deut|Deutr|Exod|Gen|Genes|Jer)\.?(?: [CL])?$/u;
/** Rest der Kapitelzahl nach dem Umbruch: «II.16.», «VII:4.», «I, v. 10.», «. 8 b.». */
const CHAPTER_REST = /^(?:[IVXLC]+(?=[\s.,:;"]|$)|\.)/;

export interface ZusatzParts {
  mann: string;
  frau: string;
  notes: CrawlNote[];
}

/**
 * «Inhalt und Form» → Zusatzinfo des Bräutigams und der Braut. Zeilen, die ein «XXX» des
 * Datensatzes trennte, werden wieder verbunden (Kapitelzahlen, «x» am Wortende). Bleiben mehr als
 * zwei Zeilen, gehört die erste dem Bräutigam und der Rest der Braut – ausser die letzte Zeile ist
 * «-» (dann hat die Braut keine Zusatzinfo).
 */
export function splitZusatz(text: string | null | undefined): ZusatzParts {
  const notes: CrawlNote[] = [];
  const lines = (text ?? "")
    .split("\n")
    .map(norm)
    .filter(Boolean);
  if (/^Zusatzinformation:?$/.test(lines[0] ?? "")) lines.shift();
  const merged: string[] = [];
  for (const line of lines) {
    const prev = merged.at(-1);
    if (prev !== undefined && BEFORE_CHAPTER.test(prev) && CHAPTER_REST.test(line)) {
      const glue = / [CL]$/.test(prev) ? "XXX" : " XXX";
      const joined = prev + glue + line;
      const at = Math.max(0, prev.length - 12);
      notes.push({ kind: "bibelstelle", detail: `«${prev.slice(at)}⏎${line.slice(0, 12)}» → «${joined.slice(at, prev.length + glue.length + 12)}»` });
      merged[merged.length - 1] = joined;
    } else merged.push(line);
  }
  for (let i = 1; i < merged.length; i++) {
    if (/^X(?!\p{Ll})/u.test(merged[i]) && /\p{Ll}$/u.test(merged[i - 1])) {
      notes.push({ kind: "x-verschoben", detail: `«${merged[i - 1].slice(-16)}⏎${merged[i].slice(0, 8)}» → «${merged[i - 1].slice(-16)}x»` });
      merged[i - 1] += "x";
      merged[i] = merged[i].slice(1).trim();
    }
  }
  const parts = merged.filter(Boolean);
  if (parts.length <= 2) return { mann: parts[0] ?? "", frau: parts[1] ?? "", notes };
  if (parts.at(-1) === "-") {
    notes.push({ kind: "mehrzeilig", detail: `${parts.length} Zeilen, letzte «-»: Bräutigam = Zeilen 1–${parts.length - 1}` });
    return { mann: parts.slice(0, -1).join("\n"), frau: "", notes };
  }
  notes.push({ kind: "mehrzeilig", detail: `${parts.length} Zeilen: Bräutigam = Zeile 1, Braut = Zeilen 2–${parts.length}` });
  return { mann: parts[0], frau: parts.slice(1).join("\n"), notes };
}

const GND = /d-nb\.info\/gnd\/(\d[\dX-]*)\/?$/i;
const HLS = /hls-dhs-dss\.ch\/(de|fr|it)\/articles\/(\d+)\b/;

function fieldLinks(rec: CatalogRecord, key: string): CatalogLink[] {
  return rec.sections.flatMap((s) => s.fields.filter((f) => f.key === key).flatMap((f) => f.links));
}

const fold = (s: string) => norm(s).normalize("NFC").toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wessen Name steht im Linktext? Voller Name, sonst ein Nachname, der nur bei einer Person passt. */
function ownerOf(text: string, mann: NameParts, frau: NameParts): "mann" | "frau" | null {
  const t = fold(text);
  const full = (p: NameParts) => fold(`${p.vorname} ${p.nachname}`);
  if (t === full(mann) && t !== full(frau)) return "mann";
  if (t === full(frau) && t !== full(mann)) return "frau";
  const has = (p: NameParts) => new RegExp(`(?:^|[^\\p{L}])${escapeRe(fold(p.nachname))}(?![\\p{L}])`, "u").test(t);
  const m = has(mann);
  const f = has(frau);
  return m && !f ? "mann" : f && !m ? "frau" : null;
}

export interface CrawlLinks {
  mann: { gnd: string; hls: string };
  frau: { gnd: string; hls: string };
  notes: CrawlNote[];
}

/** GND- und HLS-Links der Einheit, den Personen zugeordnet (nur gültige Nummern). */
export function crawlLinks(rec: CatalogRecord, mann: NameParts, frau: NameParts): CrawlLinks {
  const out: CrawlLinks = { mann: { gnd: "", hls: "" }, frau: { gnd: "", hls: "" }, notes: [] };
  for (const l of fieldLinks(rec, "gnd_links")) {
    const id = GND.exec(l.href)?.[1];
    if (!id) {
      out.notes.push({ kind: "link-ungueltig", detail: `GND-Links: «${l.href}»` });
      continue;
    }
    const who = ownerOf(l.text, mann, frau);
    if (!who) out.notes.push({ kind: "link-zuordnung", detail: `GND «${norm(l.text) || id}» ohne passenden Namen → Bräutigam` });
    const target = out[who ?? "mann"];
    if (target.gnd) out.notes.push({ kind: "link-ungueltig", detail: `zweiter GND-Link für dieselbe Person: «${l.href}»` });
    else target.gnd = `https://d-nb.info/gnd/${id}`;
  }
  const withGnd = (["mann", "frau"] as const).filter((w) => out[w].gnd);
  for (const l of fieldLinks(rec, "weblinks")) {
    const m = HLS.exec(l.href);
    if (!m) continue;
    const url = `https://hls-dhs-dss.ch/${m[1]}/articles/${m[2]}/`;
    const who = withGnd.length === 1 ? withGnd[0] : !out.mann.hls ? "mann" : "frau";
    if (withGnd.length !== 1) out.notes.push({ kind: "link-zuordnung", detail: `HLS ${m[2]} ohne GND-Link → ${who === "mann" ? "Bräutigam" : "Braut"}` });
    if (out[who].hls) out.notes.push({ kind: "link-ungueltig", detail: `zweiter HLS-Link für dieselbe Person: «${l.href}»` });
    else out[who].hls = url;
  }
  return out;
}

/** Entstehungszeitraum des Katalogs → Datum des Eintrags; null, wenn er sich nicht in Tage fassen lässt. */
export function crawlDate(text: string | null | undefined): EhedatenDate | null {
  // Ein «a. St.» stünde doppelt: die Web-App hängt es selbst an (bis 1700).
  const t = norm(text).replace(/\s*\(?a\. ?St\.\)?$/, "");
  const days = parseCatalogDays(t);
  if (!days) return null;
  return {
    text: t.replace(/ - /g, " – "),
    isoVon: days.from,
    isoBis: days.to,
    dateFrom: Number(days.from.slice(0, 4)),
    dateTo: Number(days.to.slice(0, 4)),
    sortDate: Number(days.from.replace(/-/g, "")),
  };
}

/** Eine gecrawlte Einheit der Ehedatenbank (edb.ts isEdbUnit) → Eintrag. */
export function crawlEntry(rec: CatalogRecord): CrawlEntry {
  const notes: CrawlNote[] = [];
  const title = splitEdbTitle(rec.title);
  if (!title) return { entry: null, reason: `Titel ohne «…, getraut mit …»: «${norm(rec.title)}»`, notes };
  const date = crawlDate(rec.date_text);
  if (!date) return { entry: null, reason: `Datum nicht lesbar: «${norm(rec.date_text)}»`, notes };
  let zusatzText = fieldText(rec, "inhalt_und_form");
  if (title.rest.length > 0) {
    const rest = title.rest.join(" ⏎ ");
    if (zusatzText) notes.push({ kind: "titel-zusatz", detail: `weitere Titelzeilen neben «Inhalt und Form» übergangen: «${rest}»` });
    else {
      zusatzText = title.rest.join("\n");
      notes.push({ kind: "titel-zusatz", detail: `Titelzeilen als Zusatzinfo: «${rest}»` });
    }
  }
  const zusatz = splitZusatz(zusatzText);
  const links = crawlLinks(rec, title.mann, title.frau);
  notes.push(...zusatz.notes, ...links.notes);
  return {
    entry: {
      id: rec.id,
      signatur: norm(rec.signature),
      titel: title.titel,
      seite: fieldText(rec, "anmerkungen") ?? "",
      kirchgemeinde: norm(fieldText(rec, "provenienz")).replace(/^Kirchgemeinde /, ""),
      date,
      mann: { ...title.mann, zusatz: zusatz.mann, ...links.mann },
      frau: { ...title.frau, zusatz: zusatz.frau, ...links.frau },
    },
    notes,
  };
}
