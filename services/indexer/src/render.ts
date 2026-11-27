import { XMLParser } from "fast-xml-parser";
import { personRefsOf, type PersonRefs } from "./rmGnd.ts";
import type { ParsedTei } from "./types.ts";

/**
 * Pure-TS TEI → HTML Transformer. Walkt den per fast-xml-parser mit preserveOrder
 * geparsten Baum und emittiert ein HTML-Fragment.
 *
 * Output-Struktur:
 *   <article class="tei tei-{series}">
 *     <h1 class="tei-title">…</h1>
 *     <div class="tei-bibl">…</div>
 *     <section class="tei-text">
 *       … gerenderte Body-Inhalte …
 *     </section>
 *   </article>
 */

type NodeMap = Record<string, unknown>;
type NodeChildren = NodeMap[];

const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  preserveOrder: true,
  trimValues: false,
  removeNSPrefix: true,
});

export function renderTeiHtml(parsed: ParsedTei): string {
  const ordered = orderedParser.parse(parsed.rawXml) as NodeMap[];
  const tei = findChild(ordered, "TEI");
  if (!tei) return "";
  const teiChildren = childrenOf(tei) ?? [];
  const text = findChild(teiChildren, "text");
  const body = text ? findChild(childrenOf(text) ?? [], "body") : null;

  const titleHtml = `<h1 class="tei-title">${escapeHtml(parsed.meta.title)}</h1>`;
  const biblHtml = renderBibl(parsed);
  const bodyHtml = body ? renderChildren(childrenOf(body) ?? []) : "";

  return [
    `<article class="tei tei-${parsed.meta.series}" data-id="${escapeAttr(parsed.meta.id)}">`,
    titleHtml,
    biblHtml,
    `<section class="tei-text">${bodyHtml}</section>`,
    `</article>`,
  ].join("");
}

function renderBibl(parsed: ParsedTei): string {
  const parts: string[] = [];
  if (parsed.meta.stazhIdent) {
    parts.push(`<span class="tei-ident">${escapeHtml(parsed.meta.stazhIdent)}</span>`);
  }
  if (parsed.meta.date) {
    parts.push(`<time class="tei-date" datetime="${escapeAttr(parsed.meta.date)}">${escapeHtml(parsed.meta.date)}</time>`);
  }
  if (parsed.meta.archiveLink) {
    parts.push(
      `<a class="tei-archive-link" href="${escapeAttr(safeHref(parsed.meta.archiveLink))}" rel="external">Archiv</a>`,
    );
  }
  if (parts.length === 0) return "";
  return `<div class="tei-bibl">${parts.join(" · ")}</div>`;
}

function renderChildren(children: NodeChildren): string {
  let out = "";
  for (const node of children) {
    out += renderNode(node);
  }
  return out;
}

function renderNode(node: NodeMap): string {
  // text-Node
  const text = node["#text"];
  if (typeof text === "string") return escapeHtml(text);
  if (typeof text === "number") return escapeHtml(String(text));

  const tag = Object.keys(node).find((k) => k !== ":@");
  if (!tag) return "";
  const attrs = (node[":@"] ?? {}) as Record<string, string>;
  const kidsRaw = node[tag];
  const kids = (Array.isArray(kidsRaw) ? kidsRaw : []) as NodeChildren;

  switch (tag) {
    case "p":
      return `<p>${renderChildren(kids)}</p>`;

    case "div": {
      const type = attrs["type"];
      const cls = type ? `tei-div tei-div--${escapeAttr(type)}` : "tei-div";
      return `<section class="${cls}">${renderChildren(kids)}</section>`;
    }

    case "head": {
      // Default h3 (analog alter Stack zszh.xsl: alle <head> → <h3>). H1 ist
      // im SvelteKit-Header für den Doc-Titel reserviert; Body-Subheadings
      // sind h3, in Sonderfällen mit explizitem @level h2 oder h4.
      const level = attrs["level"];
      const tagH = level === "h2" || level === "h4" ? level : "h3";
      return `<${tagH} class="tei-head">${renderChildren(kids)}</${tagH}>`;
    }

    case "pb": {
      const n = attrs["n"] ?? "";
      const facs = attrs["facs"] ? attrs["facs"].replace(/^#/, "") : "";
      const facsAttr = facs ? ` data-facs="${escapeAttr(facs)}"` : "";
      return `<a class="tei-pb" id="pb-${escapeAttr(n)}" data-n="${escapeAttr(n)}"${facsAttr} aria-label="Seitenwechsel zu Seite ${escapeAttr(n)}"></a>`;
    }

    case "lb":
      // TEI P5: <lb break="no"/> = Wort umbricht ohne Trennung – kein Space.
      //         <lb/> (default break="yes") = Zeilenumbruch im Original; im
      // Fließtext rendern wir ihn als sichtbares Space, sonst kleben Wörter
      // aneinander (".tei-lb { display: hidden }" lässt visuell nichts übrig).
      return attrs["break"] === "no" ? "" : " ";

    case "milestone": {
      const unit = attrs["unit"] ?? "";
      return `<span class="tei-milestone" data-unit="${escapeAttr(unit)}"></span>`;
    }

    case "lg":
      return `<div class="tei-lg">${renderChildren(kids)}</div>`;
    case "l":
      return `<div class="tei-l">${renderChildren(kids)}</div>`;

    case "list": {
      const type = attrs["type"];
      const isOrdered = type === "ordered" || type === "numbered";
      const tagL = isOrdered ? "ol" : "ul";
      return `<${tagL} class="tei-list">${renderChildren(kids)}</${tagL}>`;
    }
    case "item":
      return `<li>${renderChildren(kids)}</li>`;

    case "table":
      return `<table class="tei-table">${renderChildren(kids)}</table>`;
    case "row":
      return `<tr>${renderChildren(kids)}</tr>`;
    case "cell": {
      const role = attrs["role"];
      const tagC = role === "label" ? "th" : "td";
      return `<${tagC}>${renderChildren(kids)}</${tagC}>`;
    }

    case "note": {
      const place = attrs["place"];
      const cls = place ? `tei-note tei-note--${escapeAttr(place)}` : "tei-note";
      return `<aside class="${cls}">${renderChildren(kids)}</aside>`;
    }

    case "ref": {
      const target = attrs["target"];
      if (target) {
        return `<a class="tei-ref" href="${escapeAttr(safeHref(target))}" rel="external">${renderChildren(kids)}</a>`;
      }
      return renderChildren(kids);
    }

    case "persName":
      // Normdaten aus @ref (Ratsmanuale: in Transkribus ausgezeichnet) → data-gnd, data-hls und
      // data-ssrq für die Personenkarte.
      return wrapEntity("person", attrs["n"], kids, personRefsOf(attrs["ref"]));
    case "placeName":
      return wrapEntity("place", attrs["n"], kids);
    case "orgName":
      return wrapEntity("org", attrs["n"], kids);
    case "name":
      return `<span class="tei-name">${renderChildren(kids)}</span>`;

    case "title":
      return `<em class="tei-title-inline">${renderChildren(kids)}</em>`;

    case "hi": {
      const rend = attrs["rend"] ?? "";
      const tagHi = rendToTag(rend);
      const cls = `tei-hi${rend ? ` tei-hi--${escapeAttr(rend)}` : ""}`;
      return `<${tagHi} class="${cls}">${renderChildren(kids)}</${tagHi}>`;
    }

    case "corr":
      return `<span class="tei-corr">${renderChildren(kids)}</span>`;
    case "sic":
      return `<span class="tei-sic">${renderChildren(kids)}</span>`;
    case "del":
      return `<del class="tei-del">${renderChildren(kids)}</del>`;
    case "add": {
      // Marginalien sind im Korpus als <add> mit Rand-Marker ausgezeichnet:
      // OS `place="margin right|left"` (kein @type), ABl `place="left|right"`
      // mit `type="marginal"`. Die rendern wir als echte Randnotiz; alle
      // anderen <add> (editorische Einschübe) bleiben inline-<ins>.
      const place = attrs["place"] ?? "";
      const isMarginal = attrs["type"] === "marginal" || /margin|^left$|^right$/.test(place);
      if (isMarginal) {
        const side = /left/.test(place) ? "left" : "right";
        return `<aside class="tei-marginal tei-marginal--${side}">${renderChildren(kids)}</aside>`;
      }
      return `<ins class="tei-add">${renderChildren(kids)}</ins>`;
    }
    case "supplied":
      return `<span class="tei-supplied">[${renderChildren(kids)}]</span>`;
    case "unclear":
      return `<span class="tei-unclear">${renderChildren(kids)}</span>`;
    case "abbr":
      return `<abbr class="tei-abbr">${renderChildren(kids)}</abbr>`;
    case "expan":
      return `<span class="tei-expan">${renderChildren(kids)}</span>`;
    case "choice":
      return `<span class="tei-choice">${renderChildren(kids)}</span>`;

    case "figure":
      return `<figure class="tei-figure">${renderChildren(kids)}</figure>`;
    case "graphic": {
      const url = attrs["url"];
      if (!url) return "";
      // Verlinkung als Hint im Frontend; konkretes Image-Loading läuft über Facsimile-Tab/IIIF
      return `<a class="tei-graphic" href="${escapeAttr(safeHref(url))}" rel="external">${escapeHtml(url)}</a>`;
    }
    case "facsimile":
      // Faksimile-Block wird nicht inline gerendert (kommt im Facsimile-Tab via IIIF)
      return "";

    case "label":
      return `<span class="tei-label">${renderChildren(kids)}</span>`;

    case "foreign":
      return `<span class="tei-foreign" lang="${escapeAttr(attrs["lang"] ?? "")}">${renderChildren(kids)}</span>`;

    case "quote":
      return `<q class="tei-quote">${renderChildren(kids)}</q>`;

    case "date": {
      const when = attrs["when"] ?? attrs["from"] ?? "";
      const dt = when ? ` datetime="${escapeAttr(when)}"` : "";
      return `<time class="tei-inline-date"${dt}>${renderChildren(kids)}</time>`;
    }

    case "num":
      return `<span class="tei-num">${renderChildren(kids)}</span>`;

    case "seg":
      return `<span class="tei-seg">${renderChildren(kids)}</span>`;

    default:
      // Unbekannte Elemente: Inhalt durchreichen, Markup verwerfen
      return renderChildren(kids);
  }
}

function wrapEntity(
  kind: "person" | "place" | "org",
  id: string | undefined,
  kids: NodeChildren,
  refs: PersonRefs | null = null,
): string {
  const idAttr = id ? ` data-id="${escapeAttr(id)}"` : "";
  const refAttrs = refs
    ? (["gnd", "hls", "ssrq"] as const).map((k) => (refs[k] ? ` data-${k}="${escapeAttr(refs[k])}"` : "")).join("")
    : "";
  return `<span class="tei-${kind}"${idAttr}${refAttrs}>${renderChildren(kids)}</span>`;
}

function rendToTag(rend: string): string {
  switch (rend) {
    case "italic":
    case "italics":
      return "em";
    case "bold":
      return "strong";
    case "underline":
      return "u";
    case "smallcaps":
    case "small-caps":
      return "span";
    case "strikethrough":
      return "s";
    case "superscript":
      return "sup";
    case "subscript":
      return "sub";
    default:
      return "span";
  }
}

function findChild(children: NodeChildren, tag: string): NodeMap | null {
  for (const c of children) {
    if (Object.prototype.hasOwnProperty.call(c, tag)) return c;
  }
  return null;
}

function childrenOf(node: NodeMap): NodeChildren | null {
  const tag = Object.keys(node).find((k) => k !== ":@");
  if (!tag) return null;
  const val = node[tag];
  return Array.isArray(val) ? (val as NodeChildren) : null;
}

const HTML_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESC[c] ?? c);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/**
 * Linkziele aus der TEI: nur http(s), mailto und Adressen ohne Schema. Die Spätbestände stammen aus fremden
 * Quellen; «javascript:» wäre ein Skript. Leerraum und Steuerzeichen im Schema übergeht der Browser, darum hier
 * ebenso.
 */
export function safeHref(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/[\u0000-\u0020]+/g, ""))?.[1]?.toLowerCase();
  return scheme === undefined || ["http", "https", "mailto"].includes(scheme) ? url : "#";
}
