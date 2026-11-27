// Baut eine in sich geschlossene, druckfertige HTML-Seite aus dem vom Indexer
// gerenderten TEI-Fragment. Bewusst ohne $env-/$lib-Imports (nur relative),
// damit dieses reine Modul unter `tsx --test` läuft (wie apiV1/ und dts/).
//
// Verwendung: Package-Endpoint (legt das Ergebnis als document.html ins ZIP).
// Die `.tei-*`-Styles der App nutzen Tailwind @apply und sind nicht
// importierbar – darum bildet PRINT_CSS die wesentlichen Regeln als Plain-CSS
// nach (mit bewussten Druck-Abweichungen: Entities ohne Punktunterstreichung,
// Marginalie als Block statt Float, Links farbneutral).

import { LICENSE, LICENSE_URL } from "./apiV1/constants";
import { displayTitle, documentSource, formatDocDateDE, normalizeWhitespace, rmCitation } from "../format";
import { SERIES_LABEL, type SearchHit, type SeriesAbbr } from "../types";

export interface PrintHtmlInput {
	/** Validierter Serien-Wert aus dem Endpoint (für den Permalink). */
	series: SeriesAbbr;
	/** Dokument-ID aus dem Endpoint (für den Permalink). */
	id: string;
	/** Dokument-Metadaten (Rückgabe von getDocument). */
	doc: SearchHit;
	/** loadRenderedHtml-Ergebnis; null → Fallback aus doc.body. */
	fragment: string | null;
	/** apiBaseUrl(url), im Endpoint berechnet (respektiert PUBLIC_BASE_URL). */
	baseUrl: string;
}

/** HTML-Escaping für vom Index stammende Klartext-Felder (Header, Permalink). */
function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const PRINT_CSS = `
@page { margin: 2cm; }
html { font-size: 11pt; }
body { font-family: Georgia, "Source Serif", serif; line-height: 1.6; color: #2a2826; max-width: 46em; margin: 0 auto; padding: 1rem; }
.print-header { margin-bottom: 1.5em; padding-bottom: 1em; border-bottom: 1px solid #c8c3bb; }
.print-header h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 .3em; line-height: 1.2; }
.print-meta { font-size: .85rem; color: #575450; }
.print-meta > div { margin: .15em 0; }
.print-meta a { color: inherit; }
.print-empty { font-style: italic; color: #706c67; }
/* Im Fragment wiederholten Titel/Bibliographie ausblenden (wie .tei-document-body in app.css). */
.tei-document-body .tei > .tei-title,
.tei-document-body .tei > .tei-bibl { display: none; }
.tei-text p { margin: .75em 0; }
.tei-head { font-weight: 700; margin: 1.3em 0 .6em; line-height: 1.2; break-after: avoid; }
h2.tei-head { font-size: 1.25rem; }
h3.tei-head { font-size: 1.1rem; }
h4.tei-head { font-size: 1rem; }
.tei-pb { display: block; font-size: .75rem; color: #aeaaa3; margin: .8em 0; }
.tei-pb::before { content: "[" attr(data-n) "]"; }
.tei-lb { display: none; }
.tei-person, .tei-place, .tei-org { text-decoration: none; color: inherit; background: none; }
.tei-table { border-collapse: collapse; margin: .8em 0; max-width: 100%; }
.tei-table td, .tei-table th { border: 1px solid #b0b0b0; padding: .25em .5em; }
.tei-table tr { break-inside: avoid; }
.tei-note { font-size: .85rem; color: #575450; border-left: 2px solid #c8c3bb; padding-left: .5em; margin: .5em 0; }
.tei-marginal { display: block; float: none; width: auto; margin: .3em 0; padding-left: .5em; border-left: 2px solid #c8c3bb; font-family: sans-serif; font-size: .75rem; font-style: normal; color: #575450; }
.tei-archive-link { color: inherit; text-decoration: underline; }
.tei-unclear { color: #706c67; }
h1, h2, h3, h4 { break-after: avoid; }
a { color: inherit; }
mark, em.match { background: #fde68a; font-style: normal; }
`.trim();

/**
 * Baut aus doc.body (Klartext, vom Indexer aus dem TEI extrahiert) einen
 * Body-Fallback, wenn kein Render-Fragment vorliegt. Leerzeilen trennen
 * Absätze. Leerer Body → Hinweis-Markup.
 */
function bodyFallbackHtml(body: string): string {
	const trimmed = body.trim();
	if (!trimmed) {
		return `<div class="tei"><section class="tei-text"><p class="print-empty">Volltext nicht verfügbar.</p></section></div>`;
	}
	const paras = trimmed
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
		.join("\n");
	return `<div class="tei"><section class="tei-text">${paras}</section></div>`;
}

export function buildPrintHtml(input: PrintHtmlInput): string {
	const { series, id, doc, fragment, baseUrl } = input;

	const title = displayTitle(doc);
	const ident = normalizeWhitespace(doc.stazhIdent);
	// Ratsmanuale: Daten bis 1700 im alten Stil, «(a. St.)».
	const dateDE = formatDocDateDE(doc);
	const seriesLabel = SERIES_LABEL[series];
	const permalink = `${baseUrl}/documents/${series}/${id}`;
	const isRm = series === "RM";

	const metaLines: string[] = [];
	if (ident) metaLines.push(`<div>${esc(ident)}</div>`);
	const facets: string[] = [];
	if (dateDE) facets.push(esc(dateDE));
	facets.push(esc(seriesLabel));
	if (doc.volumeNr != null) {
		facets.push(`${isRm ? "B&nbsp;II" : "Bd."}&nbsp;${esc(String(doc.volumeNr))}`);
	}
	if (doc.resolutionId != null) facets.push(`Nr.&nbsp;${esc(String(doc.resolutionId))}`);
	metaLines.push(`<div>${facets.join(" · ")}</div>`);
	metaLines.push(
		`<div><a href="${esc(permalink)}">${esc(permalink)}</a></div>`,
	);
	metaLines.push(
		`<div>Quelle: ${esc(documentSource(doc.subset))} · <a href="${esc(LICENSE_URL)}">${esc(LICENSE)}</a></div>`,
	);
	if (isRm) {
		metaLines.push(
			"<div>Maschinelle Transkription (HTR) – Lesefehler möglich. Personen, Orte und Organisationen sind automatisch erkannt.</div>",
			`<div>Zitiervorschlag: ${esc(rmCitation(doc, permalink))}</div>`,
		);
	}

	const bodyHtml = fragment ?? bodyFallbackHtml(doc.body ?? "");

	return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} – Zentrale Serien</title>
<style>
${PRINT_CSS}
</style>
</head>
<body>
<header class="print-header">
<h1>${esc(title)}</h1>
<div class="print-meta">
${metaLines.join("\n")}
</div>
</header>
<main class="tei-document-body">
${bodyHtml}
</main>
</body>
</html>
`;
}
