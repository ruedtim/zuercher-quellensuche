/**
 * Ehedatenbank (EDB) → Meili-Index `ehedaten`: ein Dokument je Eheeintrag («Zürcher Ehedaten
 * 16.–18. Jahrhundert» des Staatsarchivs). Zwei Eingänge liefern dieselben Felder (EdbEntry):
 * die Verzeichnungseinheiten des Online-Archivkatalogs aus dem Crawl (ehedatenCrawl.ts, seit
 * 2026-11 der Aufbau) und der Zenodo-Datensatz (Record 11191059, v6.0, Spalten EDB_COLUMNS in
 * edb.ts, `ID` = Katalog-ID; zenodoEntry).
 *
 * Fallstricke der Daten (2026-10-31 ausgezählt):
 * - Das Anzeige-Datum der Zenodo-CSV (`Datum`) lief durch Excel: «1696.10» steht als «1696.1».
 *   Die Werte kommen dort darum aus den ISO-Spalten `Datum_Von`/`Datum_Bis`, aus `Datum` nur
 *   die Genauigkeit (Tag, Monat, Jahr) und «(ca.)».
 * - Bis 1700 datierte Zürich julianisch; die Daten stehen wie in den Kirchenbüchern (die
 *   Web-App hängt «a. St.» an).
 * - Ein Eintrag ist eine Trauung oder eine Verkündung: Steht in der Zusatzinfo
 *   «Verkünddatum», ist das Datum das der Verkündung (17'807 Einträge), sonst das der
 *   Trauung («verkündet 22. Febr.; getraut zu …»).
 * - Namen sind normalisiert («Meier» auch für Meyer), die Originalschreibung steht in der
 *   Zusatzinfo; «N.» = unbekannt, « ?» = unsicher.
 *
 * Pur, unit-getestet in ehedaten.test.ts; Ein- und Ausgabe in ehedatenBuild.ts.
 */

import { nameWords, personKey } from "../../../apps/web/src/lib/entityKey.ts";
import { edbTitle, type EdbRow } from "./edb.ts";
import { herkunftKeys, parseHerkunft, type HerkunftRaum } from "./herkunft.ts";
import { EHEDATEN_FOLDED_FIELDS, foldedFields, type FoldedFields } from "./searchText.ts";

export type EhedatenArt = "trauung" | "verkuendung";

/** Ein Ehepartner im Index (flach als `mann…`/`frau…`). */
export interface EhedatenPerson {
  nachname: string;
  vorname: string;
  /** «Vorname Nachname» – Anzeigeform, wie die Personenfilter der Plattform sie führen. */
  name: string;
  /** Herkunft wie in der Ehedatenbank. */
  herkunft: string;
  /** Facettenwert der Herkunft (herkunft.ts), leer ohne Herkunft. */
  ort: string;
  raum: HerkunftRaum | null;
  zusatz: string;
  hls: string;
  gnd: string;
}

/** Dokument im Meili-Index `ehedaten`; Einträge mit ß dazu mit gefalteten Suchfeldern
 *  (searchText.ts). */
export interface EhedatenDoc extends FoldedFields<(typeof EHEDATEN_FOLDED_FIELDS)[number]> {
  /** Katalog-ID (detail.aspx?ID=…) – Primärschlüssel und Seite /archivkatalog/<id>. */
  id: number;
  signatur: string;
  /** Signatur ohne «, EDB n» (Kirchenbuch bzw. Abschrift). */
  band: string;
  /** Laufnummer «EDB n» der Ehedatenbank. */
  eintrag: number | null;
  /** Überlieferung: Kirchenbücher (E III) oder Abschriften aus anderen Archiven (TAI). */
  quelle: string;
  /** Seite bzw. Teil im Band (Katalog: «Anmerkungen», Zenodo: Spalte `Band`). */
  seite: string;
  kirchgemeinde: string;
  art: EhedatenArt;
  /** Datum zur Anzeige («28.08.1553», «10.1696», «ca. 23.07.1553 – ca. 30.07.1553»). */
  datum: string;
  isoVon: string;
  isoBis: string;
  /** Jahre (Filter und Zeitleiste nach Berührung, wie im Index `catalog`). */
  dateFrom: number;
  dateTo: number;
  /** JJJJMMTT des ersten Tages – Sortierung. */
  sortDate: number;
  /** Titel wie im Online-Katalog («Muster, Hans, Uster, getraut mit Beispiel, Anna»). */
  titel: string;
  mannNachname: string;
  mannVorname: string;
  mannName: string;
  mannHerkunft: string;
  mannOrt: string;
  mannZusatz: string;
  mannHls: string;
  mannGnd: string;
  frauNachname: string;
  frauVorname: string;
  frauName: string;
  frauHerkunft: string;
  frauOrt: string;
  frauZusatz: string;
  frauHls: string;
  frauGnd: string;
  /** Herkunft beider (Facette, Filter `herkunft IN`). */
  herkunft: string[];
  /** Herkunftsräume beider (Facette). */
  raum: HerkunftRaum[];
  /** Vergleichsschlüssel der Herkunft (Ortsfilter `places`, entityKey.ts). */
  herkunftKeys: string[];
  /** Anzeigeformen beider Namen (Vorschläge der Namensfelder). */
  persons: string[];
  /** Personenschlüssel beider (Personenfilter `persons`, entityKey.ts); Name ohne Vornamen
   *  bzw. «N.» ohne Schlüssel. */
  personKeys: string[];
  mannKey: string | null;
  frauKey: string | null;
  /** Namenswörter (nameWords) – Namensfilter mit Rolle, auch nur der Nachname. */
  mannTok: string[];
  frauTok: string[];
  /** Unsicher gelesene Angaben («?» in Name oder Herkunft). */
  unsicher: boolean;
}

/** Ein Ehepartner mit den Angaben der Ehedatenbank, wie der Eingang sie liefert. */
export interface EdbPersonInput {
  nachname: string;
  vorname: string;
  herkunft: string;
  /** Zusatzinfo; «-» und Excel-Fehler gelten als leer. */
  zusatz: string;
  /** HLS-Artikel bzw. GND-Eintrag als URL, leer ohne. */
  hls: string;
  gnd: string;
}

/** Ein Eheeintrag in den Feldern der Ehedatenbank – aus dem Katalog-Crawl (ehedatenCrawl.ts)
 *  oder der Zenodo-CSV (zenodoEntry). */
export interface EdbEntry {
  /** Katalog-ID. */
  id: number;
  signatur: string;
  /** Titel wie im Online-Katalog. */
  titel: string;
  /** Seite bzw. Teil im Band. */
  seite: string;
  kirchgemeinde: string;
  date: EhedatenDate;
  mann: EdbPersonInput;
  frau: EdbPersonInput;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** «-» und Excel-Fehler («#NAME?») stehen für eine leere Zusatzinfo. */
function zusatz(s: string): string {
  const v = norm(s);
  return v === "-" || /^#[A-ZÄÖÜ/0]+[?!]?$/.test(v) ? "" : v;
}

const GND = /gnd\/([0-9X-]+)/i;
function gndUrl(s: string): string {
  const m = GND.exec(norm(s));
  return m ? `https://d-nb.info/gnd/${m[1]}` : norm(s);
}

// --- Datum -----------------------------------------------------------------------

export interface EhedatenDate {
  text: string;
  isoVon: string;
  isoBis: string;
  dateFrom: number;
  dateTo: number;
  sortDate: number;
}

type Precision = 1 | 2 | 3;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SIDE = /^(\d{4})((?:\.\d{1,2}){0,2})( \(ca\.\))?$/;

function formatIso(iso: string, precision: Precision, ca: boolean): string {
  const [, y, m, d] = ISO.exec(iso)!;
  const core = precision === 3 ? `${d}.${m}.${y}` : precision === 2 ? `${m}.${y}` : y;
  return ca ? `ca. ${core}` : core;
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Genauigkeit nur aus den ISO-Grenzen (Anzeige-Datum unlesbar): ganzer Monat, ganzes Jahr, Tag. */
function isoPrecision(von: string, bis: string): Precision | null {
  if (von === bis) return 3;
  const [, y1, m1, d1] = ISO.exec(von)!;
  const [, y2, m2, d2] = ISO.exec(bis)!;
  if (y1 !== y2) return null;
  if (m1 === "01" && d1 === "01" && m2 === "12" && d2 === "31") return 1;
  if (m1 === m2 && d1 === "01" && Number(d2) === lastDay(Number(y1), Number(m1))) return 2;
  return null;
}

/**
 * Datum eines Eintrags: Werte aus den ISO-Spalten, Genauigkeit und «ca.» aus dem
 * Anzeige-Datum (Seiten «1553.07.23 (ca.)-1553.07.30 (ca.)»). null ohne gültige ISO-Daten.
 */
export function ehedatenDate(display: string, von: string, bis: string): EhedatenDate | null {
  const isoVon = norm(von);
  const isoBis = norm(bis) || isoVon;
  if (!ISO.test(isoVon) || !ISO.test(isoBis) || isoBis < isoVon) return null;
  const sides = norm(display).split("-").map((s) => SIDE.exec(s.trim()));
  let text: string;
  if (sides.length === 1 && sides[0]) {
    const precision = (sides[0][2].split(".").length) as Precision;
    text = formatIso(isoVon, isoVon === isoBis ? 3 : precision, !!sides[0][3]);
  } else if (sides.length === 2 && sides[0] && sides[1]) {
    const p = (s: RegExpExecArray) => s[2].split(".").length as Precision;
    text = `${formatIso(isoVon, p(sides[0]), !!sides[0][3])} – ${formatIso(isoBis, p(sides[1]), !!sides[1][3])}`;
  } else {
    const p = isoPrecision(isoVon, isoBis);
    text = p ? formatIso(isoVon, p, false) : `${formatIso(isoVon, 3, false)} – ${formatIso(isoBis, 3, false)}`;
  }
  return {
    text,
    isoVon,
    isoBis,
    dateFrom: Number(isoVon.slice(0, 4)),
    dateTo: Number(isoBis.slice(0, 4)),
    sortDate: Number(isoVon.replace(/-/g, "")),
  };
}

/** Verkündung, wenn eine der Zusatzinfos «Verkünddatum» vermerkt, sonst Trauung. */
export function ehedatenArt(zusatzMann: string, zusatzFrau: string): EhedatenArt {
  return /verkünddatum/i.test(`${zusatzMann} ${zusatzFrau}`) ? "verkuendung" : "trauung";
}

/** Überlieferung aus der Signatur: «E III 30.1, EDB 276» → «E III», «TAI 9.1; …» → «TAI». */
export function ehedatenQuelle(signatur: string): string {
  if (/^E III\b/.test(signatur)) return "E III";
  if (/^TAI\b/.test(signatur)) return "TAI";
  return signatur.split(/[\s;,]/)[0] ?? "";
}

function person(p: EdbPersonInput): EhedatenPerson {
  const nachname = norm(p.nachname);
  const vorname = norm(p.vorname);
  const herkunft = norm(p.herkunft);
  const h = parseHerkunft(herkunft);
  return {
    nachname,
    vorname,
    name: norm(`${vorname} ${nachname}`),
    herkunft,
    ort: h?.gemeinde ?? "",
    raum: h?.raum ?? null,
    zusatz: zusatz(p.zusatz),
    hls: norm(p.hls),
    gnd: gndUrl(p.gnd),
  };
}

const unique = <T>(values: Array<T | null | undefined | "">): T[] => [...new Set(values.filter((v): v is T => !!v))];

/** Namenswörter einer Person (Vor- und Nachname), wie der Namensfilter der Web-App sie faltet. */
function tokens(p: EhedatenPerson): string[] {
  return unique(nameWords(`${p.vorname} ${p.nachname}`));
}

/** Eine Zeile der Zenodo-CSV → Eintrag; null ohne gültige ID oder Datum. */
export function zenodoEntry(z: EdbRow): EdbEntry | null {
  const id = Number(norm(z.ID));
  if (!Number.isInteger(id) || id <= 0) return null;
  const date = ehedatenDate(z.Datum, z.Datum_Von, z.Datum_Bis);
  if (!date) return null;
  const who = (w: "Mann" | "Frau"): EdbPersonInput => ({
    nachname: z[`Nachname_${w}`],
    vorname: z[`Vorname_${w}`],
    herkunft: z[`Herkunft_${w}`],
    zusatz: z[`Zusatzinfo_${w}`],
    hls: z[`HLS_Artikel_${w}`],
    gnd: z[`GND_${w}`],
  });
  return { id, signatur: z.Signatur, titel: edbTitle(z), seite: z.Band, kirchgemeinde: z.Kirchgemeinde, date, mann: who("Mann"), frau: who("Frau") };
}

/** Eine Zeile der Zenodo-CSV → Index-Dokument; null ohne gültige ID oder Datum. */
export function ehedatenDoc(z: EdbRow): EhedatenDoc | null {
  const e = zenodoEntry(z);
  return e ? entryDoc(e) : null;
}

/** Eintrag (Crawl oder Zenodo) → Index-Dokument. */
export function entryDoc(e: EdbEntry): EhedatenDoc {
  const { date } = e;
  const signatur = norm(e.signatur);
  const nr = /, EDB (\d+)$/.exec(signatur);
  const mann = person(e.mann);
  const frau = person(e.frau);
  const mannKey = personKey(mann.name);
  const frauKey = personKey(frau.name);
  const herk = [parseHerkunft(mann.herkunft), parseHerkunft(frau.herkunft)].filter((h) => h !== null);
  const doc: EhedatenDoc = {
    id: e.id,
    signatur,
    band: nr ? signatur.slice(0, nr.index) : signatur,
    eintrag: nr ? Number(nr[1]) : null,
    quelle: ehedatenQuelle(signatur),
    seite: norm(e.seite),
    kirchgemeinde: norm(e.kirchgemeinde),
    art: ehedatenArt(mann.zusatz, frau.zusatz),
    datum: date.text,
    isoVon: date.isoVon,
    isoBis: date.isoBis,
    dateFrom: date.dateFrom,
    dateTo: date.dateTo,
    sortDate: date.sortDate,
    titel: norm(e.titel),
    mannNachname: mann.nachname,
    mannVorname: mann.vorname,
    mannName: mann.name,
    mannHerkunft: mann.herkunft,
    mannOrt: mann.ort,
    mannZusatz: mann.zusatz,
    mannHls: mann.hls,
    mannGnd: mann.gnd,
    frauNachname: frau.nachname,
    frauVorname: frau.vorname,
    frauName: frau.name,
    frauHerkunft: frau.herkunft,
    frauOrt: frau.ort,
    frauZusatz: frau.zusatz,
    frauHls: frau.hls,
    frauGnd: frau.gnd,
    herkunft: unique([mann.ort, frau.ort]),
    raum: unique([mann.raum, frau.raum]),
    herkunftKeys: unique(herk.flatMap(herkunftKeys)),
    persons: unique([mann.name, frau.name]),
    personKeys: unique([mannKey, frauKey]),
    mannKey,
    frauKey,
    mannTok: tokens(mann),
    frauTok: tokens(frau),
    unsicher: /\?/.test(`${mann.nachname} ${mann.vorname} ${frau.nachname} ${frau.vorname}`) || herk.some((h) => h.unsicher),
  };
  return { ...doc, ...foldedFields(doc, EHEDATEN_FOLDED_FIELDS) };
}
