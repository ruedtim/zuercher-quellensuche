/**
 * TEI eines Editionsstücks → Einheit des Index `editions` (Reiter «Editionen» der Suchseite,
 * Detailseite /editionen/<edition>/<id>). QZH (Quellen zur Zürcher Geschichte, stazh/qzh-data):
 * eine Datei je Stück, zwei Ausprägungen (SSRQ-nah mit `group/text`, aus Word gesplittet mit
 * `body`), wohlgeformt, aber nicht schema-valide. Zürcher Rechtsquellen (SSRQ ZH,
 * stazh/erqzh-data): SSRQ-TEI, eine Datei je Text eines Stücks (Grundtext und weitere
 * Überlieferungen); dazu Artikelnummern (`seg/@n`), Unterschriften (`signed`), Spaltenwechsel
 * (`cb`) und Streichungen bzw. Ergänzungen über Elementgrenzen (`delSpan`/`addSpan`).
 *
 * Eigener Renderer (Vorbild services/indexer/src/render.ts), nicht der ODD der Edition:
 * - Text: Absätze, Überschriften, Seitenwechsel (`pb`, Sprung ins Faksimile), Zeilenfall
 *   (`lb`, auf der Seite zuschaltbar), Auflösungen (`choice`: Abkürzung mit Auflösung im
 *   Tooltip, Korrektur mit der Lesart der Vorlage), Streichungen, Ergänzungen, Lücken,
 *   Randnotizen und Dorsualvermerke (`ab`), Tabellen, Personen, Orte, Organisationen.
 * - Anmerkungen stehen im TEI inline (`note`): textkritische (`critical`) mit Buchstaben,
 *   Sachanmerkungen (`editorial`) mit Zahlen wie in den Rechtsquellen; im Text bleibt die
 *   Marke, die Anmerkungen gehen in eine eigene Liste.
 * - Kommentar (`back`) und Regest (`msContents/summary`) mit demselben Renderer.
 *
 * Neben dem HTML entsteht der Lesetext (ohne Anmerkungen und Gestrichenes, Abkürzungen
 * aufgelöst), aus dem der Aufbau den Suchtext macht (editionSearchForm). MUFI-Zeichen aus
 * dem Privatbereich (Münzzeichen) werden lesbar abgebildet, weiche Trennstriche fallen weg.
 *
 * Pur, unit-getestet in editionTei.test.ts (nur ausgedachte Beispiele, kein Editionstext).
 */

import { XMLParser } from "fast-xml-parser";
import { stazhCatalogIdOf } from "./editionLinks.ts";

type XNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  preserveOrder: true,
  trimValues: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

// ── Baum ─────────────────────────────────────────────────────────────────────

function tagOf(n: XNode): string | null {
  for (const k of Object.keys(n)) if (k !== ":@" && k !== "#text") return k;
  return null;
}

function kids(n: XNode): XNode[] {
  const t = tagOf(n);
  const v = t ? n[t] : null;
  return Array.isArray(v) ? (v as XNode[]) : [];
}

function attr(n: XNode, name: string): string | undefined {
  const a = n[":@"] as Record<string, unknown> | undefined;
  const v = a?.[name];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

function child(n: XNode | null | undefined, tag: string): XNode | null {
  if (!n) return null;
  return kids(n).find((c) => tagOf(c) === tag) ?? null;
}

function children(n: XNode | null | undefined, tag: string): XNode[] {
  return n ? kids(n).filter((c) => tagOf(c) === tag) : [];
}

function path(n: XNode | null, tags: string[]): XNode | null {
  let cur = n;
  for (const t of tags) cur = child(cur, t);
  return cur;
}

/** Alle Nachfahren mit diesem Namen (Dokumentreihenfolge). */
function descendants(n: XNode | null, tag: string, out: XNode[] = []): XNode[] {
  if (!n) return out;
  for (const c of kids(n)) {
    if (tagOf(c) === tag) out.push(c);
    descendants(c, tag, out);
  }
  return out;
}

function rawText(n: XNode): string {
  const t = n["#text"];
  if (typeof t === "string") return t;
  if (typeof t === "number") return String(t);
  return kids(n).map(rawText).join("");
}

/** Text eines Header-Elements, Leerraum vereinheitlicht. */
export function plainText(n: XNode | null | undefined): string {
  return n ? cleanChars(rawText(n)).replace(/\s+/g, " ").trim() : "";
}

// ── Zeichen ──────────────────────────────────────────────────────────────────

/**
 * Zeichen aus dem Privatbereich (MUFI) der QZH: Münzzeichen, die nur die Schrift der
 * Edition darstellt (Glyphennamen der SSRQ-Schrift «Lexia Fontes»: schillgerm, libradut,
 * florloop). Auf der Seite lesbar, mit der Bedeutung im Tooltip.
 */
export const PUA_SIGNS: Readonly<Record<string, { text: string; title: string }>> = {
  "": { text: "ß", title: "Schilling" },
  "": { text: "lb", title: "Pfund" },
  "": { text: "fl", title: "Gulden" },
};

const PUA_RE = /[-]/g;

/** Weiche Trennstriche weg, Sonderleerzeichen als Leerzeichen, MUFI-Zeichen lesbar. */
function cleanChars(s: string): string {
  return s
    .replace(/­/g, "")
    .replace(/[  -  ]/g, " ")
    .replace(PUA_RE, (c) => PUA_SIGNS[c]?.text ?? "");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

/** Text für HTML: MUFI-Zeichen als Zeichen mit Tooltip, sonst wie cleanChars. */
function textHtml(s: string): string {
  const cleaned = s.replace(/­/g, "").replace(/[  -  ]/g, " ");
  let out = "";
  let last = 0;
  for (const m of cleaned.matchAll(PUA_RE)) {
    out += esc(cleaned.slice(last, m.index));
    const sign = PUA_SIGNS[m[0]];
    out += sign
      ? `<span class="ed-sign" title="${escAttr(sign.title)}">${esc(sign.text)}</span>`
      : `<span class="ed-sign" title="Sonderzeichen U+${m[0].codePointAt(0)!.toString(16).toUpperCase()}">?</span>`;
    last = m.index! + m[0].length;
  }
  return out + esc(cleaned.slice(last));
}

// ── Ergebnis ─────────────────────────────────────────────────────────────────

export type NoteType = "critical" | "editorial";

export interface EditionNote {
  /** Anker: «a3» (textkritisch) bzw. «n7» (Sachanmerkung). */
  key: string;
  /** Marke im Text: Buchstaben bzw. Zahlen. */
  label: string;
  type: NoteType;
  html: string;
  text: string;
  /** Steht im Kommentar statt im Text. */
  inBack: boolean;
}

export interface EntityMention {
  /** Form im Text; leer bei einem Registereintrag ohne Text (`<persName ref="…"/>` hinter dem Namen). */
  form: string;
  /** Verweis der Edition (`@ref`): GND_…, LOC_…, SSRQ-Kennung (per…, loc…, org…), eigener
   *  Schlüssel oder Normname. */
  ref: string | null;
}

/** Kalender des Datums, wenn die Edition ihn nennt (`origDate/@calendar`). */
export type EditionCalendar = "julian" | "gregorian";

export type EntityKind = "person" | "place" | "org";

export interface PageBreak {
  /** Seiten- bzw. Blattzählung der Vorlage (`pb/@n`). */
  n: string;
  /** Bild (`pb/@facs`): Dateiname auf dem Bildserver der Edition oder IIIF-Canvas. */
  facs: string | null;
}

export interface BiblEntry {
  head: string;
  html: string;
  text: string;
}

export interface DateSpan {
  /** ISO-Tage. */
  from: string;
  to: string;
}

export interface EditionTei {
  /** Kennung der Edition (`seriesStmt/idno`, sonst der Dateiname). */
  localId: string;
  title: string;
  /** Teil der Edition (`seriesStmt/title`; bei QGTS mit Band). */
  part: string;
  /** Herausgeberschaft des Teils. */
  editors: string[];
  /** Transkription und Auszeichnung (`titleStmt/respStmt`). */
  transcription: string[];
  tagging: string[];
  publisher: string | null;
  /** Online seit (`publicationStmt/date[@type=electronic]`). */
  published: string | null;
  signature: string;
  /** Link der Edition auf die Vorlage (`msIdentifier/idno/@source`), auch in einem anderen Archiv. */
  sourceUrl: string | null;
  /** Katalog-IDs der Vorlage, nur aus Links auf den Online-Katalog des Staatsarchivs. */
  catalogIds: number[];
  textLang: string[];
  /** Überlieferungsform («Eintrag», «Abschrift», «Aufzeichnung (Doppelblatt)»). */
  filiation: string | null;
  /** Beschreibstoff, Umfang, Masse, Siegel. */
  physical: string[];
  /** Datum des Stücks (RenderOptions.originalDateFirst: das des Originals, sonst das der Vorlage). */
  date: DateSpan | null;
  /** Datum der Vorlage selbst (`history/origin/origDate`; bei einer Abschrift deren Entstehung). */
  witnessDate: DateSpan | null;
  /** Kalender des Datums (`origDate/@calendar`), sonst null. */
  calendar: EditionCalendar | null;
  origPlace: string | null;
  regestHtml: string | null;
  regestText: string;
  bibl: BiblEntry[];
  keywords: Array<{ ref: string | null; term: string }>;
  html: string;
  backHtml: string | null;
  notes: EditionNote[];
  /** Lesetext des Stücks (ohne Anmerkungen und Gestrichenes, Abkürzungen aufgelöst). */
  text: string;
  /** Text des Kommentars. */
  backText: string;
  /** Nennungen aus Text, Kommentar, Anmerkungen und Regest (Register des Stücks), ohne Namen in
   *  Datumsangaben («uff sant Martis tag» ist ein Termin, keine Nennung des Heiligen). */
  persons: EntityMention[];
  places: EntityMention[];
  orgs: EntityMention[];
  /** Namen in Datumsangaben, die nicht ins Register gehen (Bericht). */
  datedNames: number;
  pages: PageBreak[];
  /** Elemente, die der Renderer nicht kennt (nur durchgereicht, fürs Protokoll). */
  unknown: string[];
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Ziel eines Links der Edition: eigene Seite statt Original, sonst unverändert; null = kein Link. */
  linkFor?: (target: string) => string | null;
  /** Name des Registers zu einer Nennung (so filtert die Suche). Steht als `data-name` am
   *  Namen, die Detailseite sucht damit – nicht mit dem angezeigten Text, der Abkürzungen,
   *  Gestrichenes und Anmerkungsmarken enthält. */
  entityName?: (kind: EntityKind, form: string, ref: string | null) => string | null;
  /** Datum des Stücks aus `msItem/filiation[@type=original]/origDate` vor dem der Vorlage
   *  (`history/origin/origDate`): Die Rechtsquellen datieren eine Abschrift dort mit ihrer
   *  eigenen Entstehung («1801–1900»), den Rechtsakt unter `filiation`. Die QZH bleiben beim
   *  Datum der Vorlage (beide Angaben weichen dort in 20 Stücken ab, teils um die zehn Tage der
   *  Kalenderreform). */
  originalDateFirst?: boolean;
}

interface Ctx {
  notes: EditionNote[];
  critical: number;
  editorial: number;
  persons: EntityMention[];
  places: EntityMention[];
  orgs: EntityMention[];
  datedNames: number;
  pages: PageBreak[];
  unknown: Set<string>;
  inBack: boolean;
  inNote: boolean;
  /** Namen zählen fürs Register des Stücks (Text, Kommentar, Anmerkungen, Regest), nicht in der Literatur. */
  register: boolean;
  /** Innerhalb einer Datumsangabe (`date`): Heilige und Feste dort sind Termine, keine Nennungen. */
  inDate: boolean;
  /** Offene Streichung bzw. Ergänzung über Elementgrenzen (`delSpan`/`addSpan` bis `anchor`). */
  spanDel: string | null;
  spanAdd: string | null;
  opts: RenderOptions;
}

interface Out {
  h: string;
  t: string;
}

/** Beschriftung eines Seitenwechsels wie in der QZH-App: Folios («16r») als «fol. 16r»,
 *  Zahlen als «S. 2», anderes unverändert. */
export function pbLabel(n: string): string {
  if (/^\d+[rv]$/.test(n)) return `fol. ${n}`;
  return /^\d+$/.test(n) ? `S. ${n}` : n;
}

/** Zeilenwechsel ohne Worttrennung (`lb/@break="no"`): löst Leerraum um sich auf. */
const JOIN = "\u0001";
const NONE: Out = { h: "", t: "" };

/** Buchstabenzählung der textkritischen Anmerkungen: a … z, aa, ab … */
export function letterLabel(n: number): string {
  let s = "";
  let i = n;
  while (i > 0) {
    i--;
    s = String.fromCharCode(97 + (i % 26)) + s;
    i = Math.floor(i / 26);
  }
  return s;
}

const AB_LABEL: Record<string, string> = {
  dorsal: "Dorsualvermerk",
  "marginal note": "Randnotiz",
  sigillant: "Siegler",
  chancery_notation: "Kanzleivermerk",
  plica: "Plica",
};

const ADD_PLACE: Record<string, string> = {
  above: "über der Zeile",
  below: "unter der Zeile",
  inline: "auf der Zeile",
  margin: "am Rand",
  "left margin": "am linken Rand",
  left_margin: "am linken Rand",
  "right margin": "am rechten Rand",
  right: "rechts",
  "left top": "oben links",
  "right top": "oben rechts",
  bottom: "unten",
  verso: "auf der Rückseite",
};

const GAP_REASON: Record<string, string> = {
  illegible: "unleserlich",
  irrelevant: "ausgelassen",
};

function renderKids(n: XNode, ctx: Ctx): Out {
  let h = "";
  let t = "";
  for (const c of kids(n)) {
    const o = renderNode(c, ctx);
    h += o.h;
    t += o.t;
  }
  return { h, t };
}

function wrap(tag: string, cls: string | null, o: Out, extra = ""): Out {
  return { h: `<${tag}${cls ? ` class="${cls}"` : ""}${extra}>${o.h}</${tag}>`, t: o.t };
}

const block = (o: Out): Out => ({ h: o.h, t: `\n${o.t}\n` });

function titleAttr(s: string): string {
  const v = s.replace(/\s+/g, " ").trim();
  return v ? ` title="${escAttr(v.length > 300 ? `${v.slice(0, 299)}…` : v)}"` : "";
}

function note(n: XNode, ctx: Ctx, type: NoteType, content?: Out): Out {
  const isCritical = type === "critical";
  const num = isCritical ? ++ctx.critical : ++ctx.editorial;
  const label = isCritical ? letterLabel(num) : String(num);
  const key = `${isCritical ? "a" : "n"}${num}`;
  const wasInNote = ctx.inNote;
  ctx.inNote = true;
  const body = content ?? renderKids(n, ctx);
  ctx.inNote = wasInNote;
  const html = finishInline(body.h);
  const text = finishText(body.t).replace(/\n+/g, " ").trim();
  ctx.notes.push({ key, label, type, html, text, inBack: ctx.inBack });
  return {
    h: `<sup class="ed-note-ref ed-note-${type}"><a href="#ed-note-${key}" id="ed-ref-${key}" data-note="${key}"${titleAttr(text)}>${label}</a></sup>`,
    t: "",
  };
}

/** Name im Text: Nennung fürs Register, Attribute für die Detailseite (`data-ref` der
 *  Edition, `data-name` = Filterwert; nur mit sichtbarem Text und nur im Register). */
function entity(kind: EntityKind, cls: string, n: XNode, ctx: Ctx): Out {
  const o = renderKids(n, ctx);
  const ref = attr(n, "ref")?.trim() || null;
  const form = finishText(o.t).replace(/\s+/g, " ").trim();
  const registered = ctx.register && !ctx.inDate;
  if (registered && (form || ref)) {
    if (kind === "person") ctx.persons.push({ form, ref });
    else if (kind === "place") ctx.places.push({ form, ref });
    else ctx.orgs.push({ form, ref });
  } else if (ctx.register && ctx.inDate && (form || ref)) ctx.datedNames++;
  const name = registered && form ? ctx.opts.entityName?.(kind, form, ref)?.replace(/\s+/g, " ").trim() : null;
  const attrs = `${ref ? ` data-ref="${escAttr(ref)}"` : ""}${name ? ` data-name="${escAttr(name)}"` : ""}`;
  return wrap("span", cls, o, attrs);
}

function link(target: string | undefined, o: Out, ctx: Ctx): Out {
  const raw = (target ?? "").trim();
  const href = raw && ctx.opts.linkFor ? ctx.opts.linkFor(raw) : raw;
  if (!href || !/^(https?:\/\/|\/)/.test(href)) return o;
  const external = /^https?:\/\//.test(href);
  return { h: `<a href="${escAttr(href)}"${external ? ' rel="noopener external" target="_blank"' : ""}>${o.h}</a>`, t: o.t };
}

function renderNode(n: XNode, ctx: Ctx): Out {
  const text = n["#text"];
  if (typeof text === "string" || typeof text === "number") {
    const s = String(text).replace(/[\t\r\n ]+/g, " ");
    // Streichung bzw. Ergänzung über Elementgrenzen (delSpan/addSpan bis zum anchor): jeder
    // Textknoten dazwischen trägt sie; Gestrichenes fehlt in der Lesefassung.
    if (ctx.spanDel && s.trim()) return { h: `<del class="ed-del" title="gestrichen">${textHtml(s)}</del>`, t: "" };
    if (ctx.spanAdd && s.trim()) return { h: `<ins class="ed-add" title="ergänzt">${textHtml(s)}</ins>`, t: cleanChars(s) };
    return { h: textHtml(s), t: cleanChars(s) };
  }
  const tag = tagOf(n);
  if (!tag) return NONE;
  switch (tag) {
    case "p": {
      const o = renderKids(n, ctx);
      return block(wrap("p", attr(n, "rend") === "margin-top" ? "ed-mt" : null, { h: o.h, t: o.t }));
    }
    case "div":
      return block(wrap("div", "ed-div", renderKids(n, ctx)));
    case "head": {
      const type = attr(n, "type") ?? attr(n, "n") ?? "";
      const level = type === "subsubtitle" ? "h4" : type === "Originalsprache" ? "p" : "h3";
      const cls = type === "Originalsprache" ? "ed-head ed-head-orig" : `ed-head${type ? ` ed-head-${type.replace(/[^a-z]/gi, "")}` : ""}`;
      return block(wrap(level, cls, renderKids(n, ctx)));
    }
    case "ab": {
      const type = attr(n, "type") ?? "";
      const label = AB_LABEL[type] ?? "";
      const o = renderKids(n, ctx);
      const head = label ? `<span class="ed-ab-label">${esc(label)}:</span> ` : "";
      return block({ h: `<div class="ed-ab ed-ab-${type.replace(/[^a-z]/gi, "") || "plain"}">${head}${o.h}</div>`, t: o.t });
    }
    case "lb":
      // break="no" (vereinzelt type="no"): die Zeile trennt ein Wort.
      if (attr(n, "break") === "no" || attr(n, "type") === "no") return { h: `${JOIN}<span class="ed-lb ed-lb-join" aria-hidden="true"></span>${JOIN}`, t: JOIN };
      return { h: ` <span class="ed-lb" aria-hidden="true"></span>`, t: " " };
    case "br":
      return { h: ` <span class="ed-lb" aria-hidden="true"></span>`, t: " " };
    case "pb": {
      const pn = (attr(n, "n") ?? "").trim();
      const facs = (attr(n, "facs") ?? "").trim() || null;
      ctx.pages.push({ n: pn, facs });
      const idx = ctx.pages.length - 1;
      const join = attr(n, "break") === "no" || attr(n, "reak") === "no";
      const marker = `<span class="ed-pb" data-page="${idx}"${facs ? " data-facs" : ""} title="${escAttr(pn ? `${pbLabel(pn)} der Vorlage` : "Seitenwechsel")}">${esc(pn ? pbLabel(pn) : "|")}</span>`;
      return join ? { h: `${JOIN}${marker}${JOIN}`, t: JOIN } : { h: ` ${marker} `, t: " " };
    }
    case "note": {
      const type = attr(n, "type") === "critical" ? "critical" : "editorial";
      if (ctx.inNote) return renderKids(n, ctx);
      return note(n, ctx, type);
    }
    case "persName":
      return entity("person", "ed-person", n, ctx);
    case "placeName":
      return entity("place", "ed-place", n, ctx);
    case "orgName":
      return entity("org", "ed-org", n, ctx);
    case "choice": {
      const abbr = child(n, "abbr");
      const expan = child(n, "expan");
      if (abbr && expan) {
        const a = renderKids(abbr, ctx);
        const e = renderKids(expan, ctx);
        return { h: `<abbr class="ed-abbr"${titleAttr(finishText(e.t))}>${a.h}</abbr>`, t: e.t };
      }
      const sic = child(n, "sic");
      const corr = child(n, "corr");
      if (sic && corr) {
        const s = renderKids(sic, ctx);
        const c = renderKids(corr, ctx);
        return { h: `<span class="ed-corr"${titleAttr(`Vorlage: ${finishText(s.t)}`)}>${c.h}</span>`, t: c.t };
      }
      const orig = child(n, "orig");
      const reg = child(n, "reg");
      if (orig && reg) {
        const o = renderKids(orig, ctx);
        const r = renderKids(reg, ctx);
        return { h: `<span class="ed-orig"${titleAttr(`normalisiert: ${finishText(r.t)}`)}>${o.h}</span>`, t: r.t };
      }
      const first = kids(n).find((c) => tagOf(c) !== null);
      return first ? renderKids(first, ctx) : NONE;
    }
    case "app": {
      const lem = child(n, "lem");
      const o = lem ? renderKids(lem, ctx) : NONE;
      const readings = children(n, "rdg");
      let marks = "";
      for (const r of readings) {
        const wit = attr(r, "wit")?.replace(/^#/, "").trim();
        const ro = renderKids(r, ctx);
        const content: Out = { h: `${wit ? `${esc(wit)}: ` : ""}${ro.h || "fehlt"}`, t: `${wit ? `${wit}: ` : ""}${ro.t || "fehlt"}` };
        if (!ctx.inNote) marks += note(r, ctx, "critical", content).h;
      }
      return { h: o.h + marks, t: o.t };
    }
    case "abbr":
      return wrap("abbr", "ed-abbr", renderKids(n, ctx));
    case "del": {
      const o = renderKids(n, ctx);
      return { h: `<del class="ed-del" title="gestrichen">${o.h}</del>`, t: "" };
    }
    case "add": {
      const place = ADD_PLACE[attr(n, "place") ?? ""];
      return wrap("ins", "ed-add", renderKids(n, ctx), titleAttr(place ? `ergänzt ${place}` : "ergänzt"));
    }
    case "subst":
      return renderKids(n, ctx);
    case "unclear":
      return wrap("span", "ed-unclear", renderKids(n, ctx), ' title="unsicher gelesen"');
    case "supplied": {
      const o = renderKids(n, ctx);
      return { h: `<span class="ed-supplied" title="ergänzt von der Bearbeitung">[${o.h}]</span>`, t: o.t };
    }
    case "gap": {
      const reason = GAP_REASON[attr(n, "reason") ?? ""] ?? "Lücke";
      const qty = [attr(n, "quantity"), attr(n, "unit")].filter(Boolean).join(" ");
      return { h: `<span class="ed-gap"${titleAttr(qty ? `${reason} (${qty})` : reason)}>[…]</span>`, t: " " };
    }
    case "damage":
      return wrap("span", "ed-damage", renderKids(n, ctx), ' title="beschädigt"');
    case "space":
      return { h: `<span class="ed-space" title="Leerraum in der Vorlage"> </span>`, t: " " };
    case "sic": {
      const o = renderKids(n, ctx);
      return { h: `${o.h}<span class="ed-sic" title="so in der Vorlage">(!)</span>`, t: o.t };
    }
    case "corr":
      return wrap("span", "ed-corr", renderKids(n, ctx), ' title="korrigiert"');
    case "hi": {
      const rend = attr(n, "rend") ?? "";
      const o = renderKids(n, ctx);
      if (rend === "sup") return wrap("sup", null, o);
      if (rend === "italic") return wrap("em", null, o);
      if (rend === "underline") return wrap("u", null, o);
      if (rend === "framed") return wrap("span", "ed-framed", o);
      return o;
    }
    case "sup":
      return wrap("sup", null, renderKids(n, ctx));
    case "sub":
      return wrap("sub", null, renderKids(n, ctx));
    case "q":
    case "quote":
      return wrap("q", "ed-q", renderKids(n, ctx));
    case "foreign": {
      const lang = attr(n, "lang");
      return wrap("span", "ed-foreign", renderKids(n, ctx), lang ? ` lang="${escAttr(lang)}"` : "");
    }
    case "ref":
      return link(attr(n, "target"), renderKids(n, ctx), ctx);
    case "hl":
      return link(attr(n, "to"), renderKids(n, ctx), ctx);
    case "bibl":
      return wrap("span", "ed-bibl", renderKids(n, ctx));
    case "table":
      return block(wrap("table", "ed-table", renderKids(n, ctx)));
    case "row":
      return block(wrap("tr", null, renderKids(n, ctx)));
    case "cell": {
      const o = renderKids(n, ctx);
      return { h: `<td>${o.h}</td>`, t: ` ${o.t} ` };
    }
    case "figure":
      return { h: `<span class="ed-figure">[Abbildung]</span>`, t: " " };
    case "bm":
    case "nswk":
    case "handShift":
      return NONE;
    case "abstand":
      return { h: " ", t: " " };
    case "seg": {
      // Artikel einer Ordnung (`seg/@n` = 1, 2 …, wie im Druck «[1]»); sonst durchgereicht.
      const segN = (attr(n, "n") ?? "").trim();
      const o = renderKids(n, ctx);
      if (!/^\d{1,3}[a-z]?$/.test(segN)) return o;
      return { h: `<span class="ed-seg-n">[${esc(segN)}]</span> ${o.h}`, t: o.t };
    }
    case "date": {
      // Heilige und Feste in Datumsangaben («uff sant Martis tag») sind Termine: im Text
      // ausgezeichnet, aber nicht im Register des Stücks.
      const was = ctx.inDate;
      ctx.inDate = true;
      const o = renderKids(n, ctx);
      ctx.inDate = was;
      return o;
    }
    case "signed":
      return block(wrap("div", "ed-signed", renderKids(n, ctx)));
    case "cb":
      return { h: ` <span class="ed-cb" title="Spaltenwechsel" aria-hidden="true">‖</span> `, t: " " };
    case "delSpan":
      ctx.spanDel = (attr(n, "spanTo") ?? "").replace(/^#/, "").trim() || "*";
      return NONE;
    case "addSpan":
      ctx.spanAdd = (attr(n, "spanTo") ?? "").replace(/^#/, "").trim() || "*";
      return NONE;
    case "anchor": {
      const id = (attr(n, "id") ?? "").trim();
      if (ctx.spanDel && (ctx.spanDel === id || ctx.spanDel === "*")) ctx.spanDel = null;
      if (ctx.spanAdd && (ctx.spanAdd === id || ctx.spanAdd === "*")) ctx.spanAdd = null;
      return NONE;
    }
    // Durchgereicht: Auszeichnung ohne eigene Darstellung.
    case "num":
    case "measure":
    case "measureGrp":
    case "time":
    case "TIMEX3":
    case "origDate":
    case "origPlace":
    case "orig":
    case "reg":
    case "expan":
    case "lem":
    case "Hyperlink":
    case "color":
    case "e1":
    case "s1":
    case "right":
    case "term":
    case "name":
    case "rs":
    case "title":
      return renderKids(n, ctx);
    default:
      ctx.unknown.add(tag);
      return renderKids(n, ctx);
  }
}

/** HTML eines Blocks bzw. Inline-Stücks fertigstellen: Worttrennung schliessen, Leerraum. */
function finishInline(h: string): string {
  return h
    .replace(new RegExp(`\\s*${JOIN}\\s*`, "g"), "")
    .replace(/ {2,}/g, " ")
    .replace(/(<(?:p|div|h3|h4|td|tr|table|q)(?: [^>]*)?>) +/g, "$1")
    .replace(/ +(<\/(?:p|div|h3|h4|td|tr|table|q)>)/g, "$1")
    .trim();
}

function finishText(t: string): string {
  return t
    .replace(new RegExp(`[ \\t]*${JOIN}[ \\t]*`, "g"), "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function newCtx(opts: RenderOptions): Ctx {
  return {
    notes: [],
    critical: 0,
    editorial: 0,
    persons: [],
    places: [],
    orgs: [],
    datedNames: 0,
    pages: [],
    unknown: new Set(),
    inBack: false,
    inNote: false,
    register: true,
    inDate: false,
    spanDel: null,
    spanAdd: null,
    opts,
  };
}

/** Ein Teilbaum (Regest, Literatur) mit eigenem Zähler: Anmerkungen darin bleiben inline.
 *  `register`: seine Namen zählen fürs Register (Regest), sonst nicht (Literatur). */
function renderLoose(
  n: XNode | null,
  opts: RenderOptions,
  register = false,
): { html: string; text: string; persons: EntityMention[]; places: EntityMention[]; orgs: EntityMention[]; datedNames: number } {
  if (!n) return { html: "", text: "", persons: [], places: [], orgs: [], datedNames: 0 };
  const ctx = newCtx(opts);
  ctx.inNote = true;
  ctx.register = register;
  const o = renderKids(n, ctx);
  return { html: finishInline(o.h), text: finishText(o.t), persons: ctx.persons, places: ctx.places, orgs: ctx.orgs, datedNames: ctx.datedNames };
}

// ── Kopf ─────────────────────────────────────────────────────────────────────

function isoDay(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** «1583-09-21», «1530-05», «1530» → Tagesspanne; ungültig → null. */
export function isoSpan(value: string | undefined, end: "from" | "to" | "both" = "both"): DateSpan | null {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec((value ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : null;
  const d = m[3] ? Number(m[3]) : null;
  if (mo !== null && (mo < 1 || mo > 12)) return null;
  if (d !== null && mo !== null && (d < 1 || d > lastDay(y, mo))) return null;
  const from = isoDay(y, mo ?? 1, d ?? 1);
  const to = isoDay(y, mo ?? 12, d ?? (mo ? lastDay(y, mo) : 31));
  if (end === "from") return { from, to: from };
  if (end === "to") return { from: to, to };
  return { from, to };
}

/** Datum des Stücks aus `origDate` (@when bzw. @from/@to, auch @notBefore/@notAfter). */
export function dateOf(n: XNode | null): DateSpan | null {
  if (!n) return null;
  const when = isoSpan(attr(n, "when"));
  if (when) return when;
  const from = isoSpan(attr(n, "from") ?? attr(n, "notBefore"));
  const to = isoSpan(attr(n, "to") ?? attr(n, "notAfter"));
  if (from && to) return from.from <= to.to ? { from: from.from, to: to.to } : { from: to.from, to: from.to };
  return from ?? to;
}

/** Namen eines `respStmt` mit dieser Rolle: Personen, auch Körperschaften (die Rechtsquellen
 *  nennen als Herausgeberin die Rechtsquellenstiftung, `orgName`). */
function respNames(stmt: XNode | null, key: string): string[] {
  const out: string[] = [];
  for (const rs of children(stmt, "respStmt")) {
    const resp = child(rs, "resp");
    const k = resp ? (attr(resp, "key") ?? plainText(resp)) : "";
    if (k !== key) continue;
    for (const p of kids(rs).filter((c) => tagOf(c) === "persName" || tagOf(c) === "orgName")) {
      const name = plainText(p);
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** Kalender eines `origDate`, wenn die Edition ihn nennt («Julian», «Gregorian»); sonst null. */
export function calendarOf(n: XNode | null): EditionCalendar | null {
  const c = (n ? (attr(n, "calendar") ?? "") : "").trim().toLowerCase().replace(/^#/, "");
  return c === "julian" ? "julian" : c === "gregorian" ? "gregorian" : null;
}

/** Kalender des Stückdatums: am `origDate` der Beschreibung oder – so die Rechtsquellen, deren
 *  Kopf nur das Datum trägt – am `origDate` der Datierung im Text mit demselben Datum
 *  («Mentags, den letsten octobris», when="1586-10-31" calendar="Julian"). */
export function pieceCalendar(head: XNode | null, textDates: readonly XNode[]): EditionCalendar | null {
  const own = calendarOf(head);
  if (own || !head) return own;
  const key = (n: XNode) => attr(n, "when") ?? attr(n, "from") ?? attr(n, "notBefore") ?? null;
  const k = key(head);
  if (!k) return null;
  for (const d of textDates) {
    const c = calendarOf(d);
    if (c && key(d) === k) return c;
  }
  return null;
}

/** Teil der Edition: Titel der Reihe, bei den Täuferquellen mit dem Band aus der Druckausgabe
 *  («QGTS, Bd. 5, Nr. 287»), damit ein späterer Band eine eigene Facette bekommt. */
export function partOf(seriesTitle: string, bibl: readonly BiblEntry[]): string {
  const printed = bibl.find((b) => b.head === "Edition")?.text ?? "";
  const vol = /\bQGTS\b,?\s*Bd\.\s*(\d+)/.exec(printed)?.[1];
  return vol && !/Bd\.\s*\d/.test(seriesTitle) ? `${seriesTitle}, Bd. ${vol}` : seriesTitle;
}

// ── Stück ────────────────────────────────────────────────────────────────────

/** Ein Stück der Edition aus seinem TEI; `fileId` = Dateiname ohne .xml. */
export function parseEditionTei(xml: string, fileId: string, opts: RenderOptions = {}): EditionTei {
  // Verarbeitungsanweisungen weg: in QZH_001 schliesst ein typografisches Anführungszeichen
  // das href eines xml-stylesheet, daran scheitert der Parser. Dazu die BOM.
  const doc = parser.parse(xml.replace(/^﻿/, "").replace(/<\?[\s\S]*?\?>/g, "")) as XNode[];
  const tei = doc.find((n) => tagOf(n) === "TEI");
  if (!tei) throw new Error(`${fileId}: kein TEI-Element`);
  const header = child(tei, "teiHeader");
  const fileDesc = child(header, "fileDesc");
  const series = child(fileDesc, "seriesStmt");
  const msDesc = path(fileDesc, ["sourceDesc", "msDesc"]);
  const msIdno = path(msDesc, ["msIdentifier", "idno"]);
  const msItem = path(msDesc, ["msContents", "msItem"]);
  const sourceUrl = msIdno ? (attr(msIdno, "source")?.trim() ?? null) : null;
  // Nur Links auf den Katalog des Staatsarchivs: Verweise auf die scopeQuery-Kataloge anderer
  // Archive (Stadtarchiv Zürich, Stiftsarchiv St. Gallen) tragen deren eigene IDs.
  const catalogIds = [...new Set(descendants(path(msDesc, ["msIdentifier"]), "idno").flatMap((i) => {
    const id = stazhCatalogIdOf(attr(i, "source") ?? "");
    return id == null ? [] : [id];
  }))];

  const bibl: BiblEntry[] = [];
  for (const lb of descendants(path(msDesc, ["additional"]), "listBibl")) {
    const head = plainText(child(lb, "head"));
    for (const b of children(lb, "bibl")) {
      const r = renderLoose(b, opts);
      if (r.text) bibl.push({ head, html: r.html, text: r.text.replace(/\s+/g, " ") });
    }
  }

  const physical: string[] = [];
  const support = path(msDesc, ["physDesc", "objectDesc", "supportDesc"]);
  const material = plainText(path(support, ["support"]));
  if (material) physical.push(material);
  const extent = plainText(child(support, "extent"));
  if (extent) physical.push(extent);
  for (const seal of descendants(path(msDesc, ["physDesc"]), "seal")) {
    const s = plainText(seal);
    if (s) physical.push(`Siegel: ${s}`);
  }

  const keywords: EditionTei["keywords"] = [];
  for (const term of descendants(header, "term")) {
    const t = plainText(term);
    if (t && !keywords.some((k) => k.term === t)) keywords.push({ ref: attr(term, "ref") ?? null, term: t });
  }

  const summary = path(msDesc, ["msContents", "summary"]);
  const regest = renderLoose(summary, opts, true);
  const filiation = children(msItem, "filiation").find((f) => attr(f, "type") === "current");
  const pubDate = children(path(fileDesc, ["publicationStmt"]), "date").find((d) => attr(d, "type") === "electronic");

  // Text: `text/group/text` (SSRQ-nah) oder `text` (aus Word), darin body und back.
  const outer = child(tei, "text");
  const inner = path(outer, ["group", "text"]) ?? outer;
  const ctx = newCtx(opts);
  const body = child(inner, "body");
  const bodyOut = body ? renderKids(body, ctx) : NONE;
  const back = child(inner, "back");
  ctx.inBack = true;
  const backOut = back ? renderKids(back, ctx) : NONE;

  const seriesTitle = plainText(child(series, "title"));
  const backHtml = finishInline(backOut.h);
  const witnessDateNode = path(msDesc, ["history", "origin", "origDate"]);
  const originalDateNode =
    children(msItem, "filiation")
      .filter((f) => attr(f, "type") === "original")
      .map((f) => child(f, "origDate"))
      .find((d): d is XNode => d != null) ?? null;
  const origDate = (opts.originalDateFirst ? (originalDateNode ?? witnessDateNode) : (witnessDateNode ?? originalDateNode)) ?? descendants(msItem, "origDate")[0] ?? null;
  return {
    localId: plainText(child(series, "idno")) || fileId,
    title: plainText(child(msDesc, "head")),
    part: partOf(seriesTitle, bibl),
    editors: respNames(series, "Herausgeberschaft"),
    transcription: respNames(child(fileDesc, "titleStmt"), "transcript"),
    tagging: respNames(child(fileDesc, "titleStmt"), "tagging"),
    publisher: plainText(path(fileDesc, ["publicationStmt", "publisher"])) || null,
    published: pubDate ? (attr(pubDate, "when") ?? null) : null,
    signature: plainText(msIdno),
    sourceUrl: sourceUrl && /^https?:\/\//.test(sourceUrl) ? sourceUrl : null,
    catalogIds,
    textLang: children(msItem, "textLang").map(plainText).filter(Boolean),
    filiation: filiation ? plainText(filiation) || null : null,
    physical,
    date: dateOf(origDate) ?? (opts.originalDateFirst ? dateOf(witnessDateNode) : null) ?? dateOf(descendants(msItem, "origDate")[0] ?? null),
    witnessDate: dateOf(witnessDateNode),
    calendar: pieceCalendar(origDate, body ? descendants(body, "origDate") : []),
    origPlace: plainText(descendants(msDesc, "origPlace")[0]) || null,
    regestHtml: regest.html || null,
    regestText: regest.text,
    bibl,
    keywords,
    html: finishInline(bodyOut.h),
    backHtml: backHtml || null,
    notes: ctx.notes,
    text: finishText(bodyOut.t),
    backText: finishText(backOut.t),
    persons: [...ctx.persons, ...regest.persons],
    places: [...ctx.places, ...regest.places],
    orgs: [...ctx.orgs, ...regest.orgs],
    datedNames: ctx.datedNames + regest.datedNames,
    pages: ctx.pages,
    unknown: [...ctx.unknown].sort(),
  };
}
