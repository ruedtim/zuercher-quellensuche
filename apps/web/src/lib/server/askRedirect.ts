// Weiterleitung der Frage-Parameter in die Suche (Startseite, alte Links der
// KI-Antwort): `?ask=<Frage>` wird zum Thema (Suche nach Bedeutung) im Reiter
// der Adresse – ohne `view` «Alle Quellen» –, ein Zeitraum in der Frage («im Jahr
// 1918», «im 19. Jahrhundert», «seit 2008»; ein blosses «1918» nicht) zum sichtbaren
// Zeitraum-Filter, Wortfolgen in Anführungszeichen zum Suchbegriff. Die
// übrigen Parameter der KI-Antwort (bis 2026-11, Branch archiv/ki-antwort)
// fallen weg. Ohne Embed-Service wird die Frage zur Stichwortsuche über ihre
// Inhaltswörter. Pur → unit-testbar (askRedirect.test.ts).

import { CATALOG_YEAR_MIN } from "$lib/catalog";
import { phraseQuery, splitQuoted } from "$lib/quotedQuery";
import { buildSemanticQuery, extractDateRange, extractLexicalQuery, type ExtractedSpan } from "./passageQuery";

/** Parameter der früheren KI-Antwort: Frage, gewählte Quellen, Modell, limitierter Modus, Panel zu. */
export const RETIRED_ASK_PARAMS = ["ask", "allSources", "sources", "model", "confidential", "noai"] as const;

/** Längere Fragen werden gekürzt (Thema-Feld, Embedding-Text). */
export const ASK_MAX = 500;

// Präposition (mit Artikel) direkt vor einem erkannten Zeitraum: «im 19. Jahrhundert»,
// «in den 1920er Jahren». Die Spans von extractDateRange beginnen teils erst bei der Zahl.
const LEAD_RE = /(?:^|\s)(?:im|in|am|an|um|seit|ab|vor|bis|von|vom|zwischen|während|gegen)(?:\s+(?:den|der|dem|die|das|des))?\s+$/iu;

/** Spans samt vorangehender Präposition – sonst bliebe «Bau der Eisenbahn im» als Thema stehen. */
function withLeadingPreposition(q: string, spans: ExtractedSpan[]): ExtractedSpan[] {
	return spans.map((sp) => {
		const m = LEAD_RE.exec(q.slice(0, sp.start));
		return m ? { start: m.index + (m[0].length - m[0].trimStart().length), end: sp.end } : sp;
	});
}

/**
 * Ziel der Weiterleitung (Pfad + Query) oder null, wenn die Adresse keinen der
 * alten Parameter trägt. Ein gesetztes Thema bzw. ein gesetzter Suchbegriff und
 * ein gesetzter Zeitraum gehen vor (geteilte Links mit beidem).
 */
export function askRedirectTarget(url: URL, opts: { semantic: boolean }): string | null {
	const sp = url.searchParams;
	if (!RETIRED_ASK_PARAMS.some((k) => sp.has(k))) return null;
	const ask = (sp.get("ask") ?? "").replace(/\s+/g, " ").trim().slice(0, ASK_MAX);
	const target = new URL(url.href);
	for (const k of RETIRED_ASK_PARAMS) target.searchParams.delete(k);
	if (ask) {
		target.searchParams.delete("page");
		const hasDates = target.searchParams.has("dateFrom") || target.searchParams.has("dateTo");
		// Wortfolgen in Anführungszeichen werden zum Suchbegriff, der genau so vorkommen muss (quotedQuery.ts),
		// ausser die Adresse trägt schon einen. Zeitraum und Inhaltswörter kommen dann nur aus dem Text
		// daneben: «"19. Jahrhundert"» ist eine Wortfolge, kein Zeitraum.
		const quoted = target.searchParams.get("q") ? null : splitQuoted(ask);
		const question = quoted?.outside ?? ask;
		// Ab Jahr 700 wie der Archivkatalog: «Urkunden im 14. Jahrhundert» ist eine gültige Frage.
		const date = extractDateRange(question, CATALOG_YEAR_MIN);
		if (!hasDates && date?.from != null) target.searchParams.set("dateFrom", String(date.from));
		if (!hasDates && date?.to != null) target.searchParams.set("dateTo", String(date.to));
		// Die Datumswörter fallen auch bei gesetztem Zeitraum weg (alte Links tragen ihn oft
		// schon): als Stichwort verlangte «14» sonst die Zahl in jedem Treffer.
		const spans = withLeadingPreposition(question, date?.spans ?? []);
		if (quoted) {
			target.searchParams.set("q", phraseQuery(quoted.phrases));
			// Steht daneben nur der Rahmen einer Frage («Was steht über "…"?»), ist es eine reine
			// Stichwortsuche. Sonst reiht die ganze Frage samt den Wortfolgen (sie tragen ihre Bedeutung)
			// als Thema die Treffer des Suchbegriffs. Ohne Embed-Service bleibt es bei den Wortfolgen:
			// Wörter daneben («weiss» in «Was weiss man über "…"?») würden sonst Pflicht.
			if (opts.semantic && !target.searchParams.get("theme") && extractLexicalQuery(question, spans)) {
				const theme = spans.length > 0 ? buildSemanticQuery(quoted.plain, spans) : quoted.plain;
				target.searchParams.set("theme", theme.replace(/\s+/g, " ").replace(/\s+([?!.,;:])/g, "$1").trim());
			}
		} else if (opts.semantic) {
			// Die Jahreszahlen stecken im Filter; im Thema trügen sie wenig Bedeutung.
			if (!target.searchParams.get("theme")) target.searchParams.set("theme", spans.length > 0 ? buildSemanticQuery(ask, spans) : ask);
		} else if (!target.searchParams.get("q")) {
			target.searchParams.set("q", extractLexicalQuery(ask, spans) || ask);
		}
	}
	return `${target.pathname}${target.search}`;
}
