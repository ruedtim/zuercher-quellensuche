import { CORPUS_YEAR_MIN } from "../types";

// Frage-Analyse der Passagen-Suche (passageSearch.ts) und der Frage von der Startseite
// (askRedirect.ts): Stichwort-Extraktion, Zeitraum-Erkennung (inkl. Treffer-Spans) und die daraus
// abgeleiteten Embedding-Text und BM25-Query. Entstanden für die KI-Antwort (bis
// 2026-11, Branch archiv/ki-antwort). Bewusst ohne $lib-Alias (relative Imports),
// damit die Unit-Tests direkt mit `npx tsx --test` laufen (Muster: apiV1).

/** Zeichen-Span [start, end) auf der Original-Frage. */
export interface ExtractedSpan {
	start: number;
	end: number;
}

// Funktions- und Fragewörter, die bei der Stichwort-Extraktion entfallen –
// bewusst kompakt (häufigste Formen), kein Anspruch auf Vollständigkeit.
export const KEYWORD_STOPWORDS = new Set([
	// deutsche Frage-/Funktionswörter
	"was", "wie", "wann", "wo", "warum", "wer", "wen", "wem", "wieso", "weshalb", "wozu",
	"welche", "welcher", "welches", "welchen", "welchem",
	"gab", "gibt", "hat", "hatte", "hatten", "haben", "ist", "sind", "war", "waren",
	"wird", "werden", "wurde", "wurden", "kann", "können", "konnte", "konnten", "soll", "sollen", "sollte",
	"der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
	"und", "oder", "aber", "auch", "noch", "nur", "schon", "sehr", "mehr", "alle", "allen", "aller",
	"in", "im", "an", "am", "auf", "aus", "bei", "mit", "nach", "von", "vom", "vor", "zu", "zum", "zur",
	"über", "unter", "durch", "für", "gegen", "ohne", "um", "bis", "seit", "ab",
	"es", "er", "sie", "man", "sich", "nicht", "kein", "keine", "da", "dazu", "dafür", "darüber",
	"jahr", "jahre", "jahren", "jahrhundert", "zeit", "thema", "bezüglich", "betreffend",
	// englische Pendants
	"what", "which", "how", "when", "where", "why", "who", "whom", "whose",
	"did", "do", "does", "done", "is", "are", "were", "be", "been", "being",
	"have", "has", "had", "can", "could", "shall", "should", "will", "would", "may", "might",
	"the", "a", "an", "and", "or", "but", "not", "no",
	"on", "at", "of", "to", "from", "by", "with", "without", "about", "against",
	"there", "their", "they", "it", "its", "this", "that", "these", "those",
	"year", "years", "century", "time", "topic", "regarding",
]);

// Frage-Rahmen, der in der BM25-Query nur rauscht: Berichts-Verben und
// Gattungswörter für «Meldung» («Was stand im …», «Welche Mitteilungen
// erschienen …»). Nur für extractLexicalQuery – der Embedding-Guard
// (buildSemanticQuery) zählt sie weiter als Inhaltswörter. Gemessen 2026-09-25
// am Prod-chunks-Index: neben kurzen Themenwörtern ziehen sie Tippfehler-
// Nachbarn nach oben (Treffer mit «Mitteilungen … erschienen» und «Wolle» vor
// solchen mit «Wölfe»).
export const LEXICAL_FILLER_WORDS = new Set([
	"stand", "standen", "steht", "stehen", "meldete", "meldeten", "berichtete", "berichteten",
	"erschien", "erschienen", "sagte", "sagten", "schrieb", "schrieben", "geschah",
	"mitteilung", "mitteilungen", "bekanntmachung", "bekanntmachungen", "hinweis", "hinweise",
	"nachricht", "nachrichten", "angaben", "informationen",
]);

/**
 * Extrahiert Stichwörter aus einer Frage für die lexikalische
 * Korpus-Erweiterung (Retry-Strategie „lexical"): Funktions-/Fragewörter weg,
 * Inhaltswörter (inkl. Eigennamen und Jahreszahlen) bleiben in Original-
 * Reihenfolge. Liefert "" wenn nichts übrig bleibt – dann lohnt kein
 * lexikalischer Versuch.
 */
export function extractKeywords(q: string): string {
	const tokens = q
		.replace(/[„“”«»"'’`?!.,;:()[\]]/g, " ")
		.split(/\s+/)
		// Rand-Bindestriche weg: ein «-Wort» läse Meili als Ausschluss (etwa der
		// Rest von «Amtsblatt-Archiv», wenn extractLexicalQuery die Serie schneidet).
		.map((t) => t.replace(/^[-–]+|[-–]+$/g, ""))
		.filter(Boolean);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of tokens) {
		const lower = t.toLowerCase();
		if (KEYWORD_STOPWORDS.has(lower)) continue;
		// Kurz-Tokens ohne Informationsgehalt (Artikelreste etc.) weg; Zahlen
		// (Jahre, Beschluss-Nummern) bleiben unabhängig von der Länge.
		if (!/\d/.test(t) && lower.length < 3) continue;
		if (seen.has(lower)) continue;
		seen.add(lower);
		out.push(t);
	}
	return out.join(" ");
}

// "Wort-Grenze" für Unicode-Text: kein Buchstabe/Ziffer direkt davor/danach.
// JS-`\b` versteht Umlaute nicht zuverlässig, deshalb manuell (wie highlight.ts).
function isWordChar(ch: string | undefined): boolean {
	if (!ch) return false;
	return /[\p{L}\p{N}]/u.test(ch);
}

function spanOf(m: RegExpMatchArray): ExtractedSpan {
	const start = m.index ?? 0;
	return { start, end: start + m[0].length };
}

// Span auf ganze Wörter ausdehnen, damit beim Strippen keine Wortfragmente
// stehen bleiben („1920er" in „1920ern"). Für Datums-Spans unbedenklich –
// Zahlwörter sind keine Komposita.
function expandToWordBounds(text: string, span: ExtractedSpan): ExtractedSpan {
	let { start, end } = span;
	while (start > 0 && isWordChar(text[start - 1])) start--;
	while (end < text.length && isWordChar(text[end])) end++;
	return { start, end };
}

export interface ExtractedDateRange {
	from: number | null;
	to: number | null;
	/** Treffer-Spans der erkannten Zeitraum-Phrasen (für buildSemanticQuery). */
	spans: ExtractedSpan[];
}

// Korpus-Fenster: ab 1483 (Ratsmanuale, CORPUS_YEAR_MIN). Der Archivkatalog
// reicht weiter zurück, sein Aufrufer gibt `minYear` mit.
const YEAR_MAX = 2100;

const RANGE_UNIT_AFTER_RE = /^\s*(?:fr\.|fr\b|franken|chf|gulden|pfund|batzen|schilling|kronen)/;

function validYear(raw: string, min: number): number | null {
	const n = Number.parseInt(raw, 10);
	return n >= min && n <= YEAR_MAX ? n : null;
}

/**
 * Erkennt deutsche Zeitraum-Angaben in einer Frage („von 1920 bis 1950",
 * „in den 1920er Jahren", „im 19. Jahrhundert", „ab 1995", „vor 1900",
 * „um 1850") und liefert sie als Jahres-Range fürs Retrieval. Ohne diesen
 * Filter dominieren bei Fragen nach historischen Epochen die wortreichen
 * modernen Born-digital-Bestände (krp-/rrb-/os-late) die Vektor-Ähnlichkeit.
 * `minYear` = untere Grenze (Default Korpus-Beginn 1483); eine Spanne, die
 * davor beginnt, wird auf sie gekürzt («1450–1550» → 1483–1550).
 * Liefert null, wenn keine Angabe erkannt wird.
 */
export function extractDateRange(q: string, minYear: number = CORPUS_YEAR_MIN): ExtractedDateRange | null {
	let text = q.toLowerCase();
	const YEAR_MIN = minYear;

	// Explizite Ranges zuerst – sie enthalten die Einzel-Muster („bis 1950").
	// Deutsch + Englisch (Embeddings sind bilingual, Fragen entsprechend auch).
	const matchRange = (t: string) =>
		t.match(/(?:von|zwischen|from|between)\s+(\d{4})\s+(?:bis|und|to|until|till|and)\s+(\d{4})/) ??
		t.match(/(\d{4})\s*(?:[-–]|bis|to)\s*(\d{4})/);
	let m = matchRange(text);
	// Beträge sind keine Zeiträume («von 1200 bis 1600 Franken»): ausblenden
	// (gleich lang, die Spans bleiben gültig) und den Rest weiter prüfen.
	while (m && RANGE_UNIT_AFTER_RE.test(text.slice((m.index ?? 0) + m[0].length))) {
		const at = m.index ?? 0;
		text = text.slice(0, at) + " ".repeat(m[0].length) + text.slice(at + m[0].length);
		m = matchRange(text);
	}
	if (m) {
		const a = Number.parseInt(m[1], 10);
		const b = Number.parseInt(m[2], 10);
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		if (hi >= YEAR_MIN && hi <= YEAR_MAX) {
			const spans = [expandToWordBounds(text, spanOf(m))];
			return { from: Math.max(lo, YEAR_MIN), to: hi, spans };
		}
	}

	// Dekade: „in den 1920er Jahren", „1920er-Jahre", engl. „the 1920s"
	m = text.match(/(\d{3})0er(?:[ -]?jahren?)?/) ?? text.match(/\b(\d{3})0s\b/);
	if (m) {
		const start = validYear(`${m[1]}0`, YEAR_MIN);
		if (start !== null) {
			return { from: start, to: start + 9, spans: [expandToWordBounds(text, spanOf(m))] };
		}
	}

	// Jahrhundert: „im 19. Jahrhundert", engl. „19th century". Zählt, sobald es
	// ins Korpus-Fenster reicht; das 15. Jahrhundert beginnt dann mit dem
	// Korpus (1483–1500).
	m = text.match(/(\d{1,2})\.\s*jahrhunderts?/) ?? text.match(/(\d{1,2})(?:st|nd|rd|th)\s+century/);
	if (m) {
		const c = Number.parseInt(m[1], 10);
		const from = (c - 1) * 100 + 1;
		const to = c * 100;
		if (to >= YEAR_MIN && from <= YEAR_MAX) {
			return { from: Math.max(from, YEAR_MIN), to, spans: [expandToWordBounds(text, spanOf(m))] };
		}
	}

	// „um 1900" / „around 1900" → ±5 Jahre
	m = text.match(/\b(?:um|around|circa)\s+(\d{4})\b/);
	if (m) {
		const y = validYear(m[1], YEAR_MIN);
		if (y !== null) return { from: y - 5, to: y + 5, spans: [expandToWordBounds(text, spanOf(m))] };
	}

	// „im Jahr(e) 1920" / „in (the year) 1920"
	m = text.match(/\bim jahre?\s+(\d{4})\b/) ?? text.match(/\bin (?:the year )?(\d{4})\b/);
	if (m) {
		const y = validYear(m[1], YEAR_MIN);
		if (y !== null) return { from: y, to: y, spans: [expandToWordBounds(text, spanOf(m))] };
	}

	// Einseitige Angaben, kombinierbar („ab 1920", „vor 1950", „since/before").
	let from: number | null = null;
	let to: number | null = null;
	const spans: ExtractedSpan[] = [];
	m = text.match(/\b(?:ab|seit|nach|since|after)\s+(\d{4})\b/);
	if (m) {
		from = validYear(m[1], YEAR_MIN);
		if (from !== null) spans.push(expandToWordBounds(text, spanOf(m)));
	}
	m = text.match(/\b(?:vor|before)\s+(\d{4})\b/);
	if (m) {
		const y = validYear(m[1], YEAR_MIN);
		if (y !== null) {
			to = y - 1;
			spans.push(expandToWordBounds(text, spanOf(m)));
		}
	} else {
		m = text.match(/\b(?:bis|until|till)\s+(\d{4})\b/);
		if (m) {
			to = validYear(m[1], YEAR_MIN);
			if (to !== null) spans.push(expandToWordBounds(text, spanOf(m)));
		}
	}
	if (from !== null || to !== null) {
		if (from !== null && to !== null && from > to) return { from: to, to: from, spans };
		return { from, to, spans };
	}

	return null;
}

function mergeSpans(spans: ExtractedSpan[]): ExtractedSpan[] {
	const sorted = spans
		.filter((s) => s.end > s.start)
		.sort((a, b) => a.start - b.start);
	const out: ExtractedSpan[] = [];
	for (const s of sorted) {
		const last = out[out.length - 1];
		if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
		else out.push({ ...s });
	}
	return out;
}

// Gemergte, innerhalb der Frage liegende Spans (Eingabe für cutSpans).
function validSpans(q: string, spans: ExtractedSpan[]): ExtractedSpan[] {
	return mergeSpans(spans).filter((s) => s.start >= 0 && s.end <= q.length);
}

// Frage ohne die Spans (aus validSpans); jeder Schnitt wird ein Leerzeichen,
// damit die Nachbarwörter nicht verkleben.
function cutSpans(q: string, merged: ExtractedSpan[]): string {
	let rest = "";
	let cursor = 0;
	for (const s of merged) {
		rest += q.slice(cursor, s.start) + " ";
		cursor = s.end;
	}
	return rest + q.slice(cursor);
}

/**
 * Embedding-Text der Frage: die Treffer-Spans der erkannten (und wirklich
 * angewandten!) Filter werden entfernt – eine Jahreszahl oder ein Einzelname
 * trägt im Vektor wenig Bedeutung, als harter Filter dafür umso mehr. Guard:
 * bleiben weniger als zwei Inhaltswörter übrig (reine Namens-Eingabe wie
 * «Willy Hochuli»), trägt der Rumpf keine eigene Bedeutung – dann wird die
 * volle Frage embedded; der Filter greift ja trotzdem.
 */
export function buildSemanticQuery(q: string, spans: ExtractedSpan[]): string {
	const merged = validSpans(q, spans);
	if (merged.length === 0) return q;
	const cleaned = cutSpans(q, merged)
		.replace(/\s+/g, " ")
		.replace(/\s+([?!.,;:])/g, "$1")
		.replace(/[,;:]+(?=\s*[?!.])/g, "")
		.trim();
	const contentWords = cleaned
		.replace(/[„“”«»"'’`?!.,;:()[\]]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.filter((t) => {
			const lower = t.toLowerCase();
			if (KEYWORD_STOPWORDS.has(lower)) return false;
			return /\d/.test(t) || lower.length >= 3;
		});
	if (contentWords.length < 2) return q;
	return cleaned;
}

/**
 * BM25-Query einer Frage – für die lexikalische Tranche, die Stichwort-
 * Retries und den Stichwort-Arm der Chunk-Hybrid-Suche: extractKeywords ohne
 * die Wörter der erkannten Filter (Zeitraum-/Serien-Spans) und ohne Frage-
 * Rahmen (LEXICAL_FILLER_WORDS). Die Filter-Wörter fallen, egal ob der Filter
 * greift oder gelockert wurde: Greift er, erledigt er die Einschränkung selbst –
 * als Suchwort träfe die «19» aus «19. Jahrhundert» bloss Tagesdaten und
 * Paragraphen, und unter matchingStrategy "frequency" bliebe ein seltenes
 * «1930er» als letztes Pflichtwort stehen. Fiel er, beschrieb das Wort die
 * Quelle, nicht den Inhalt – «Amtsblatt» trifft in RRB/KRP die Publikations-
 * vermerke («im Amtsblatt bekannt zu machen»). Der Embedding-Text behält
 * gelockerte Filter-Wörter dagegen (buildSemanticQuery, Invariante im
 * Answer-Endpoint). Liefert "" wenn nichts übrig bleibt.
 */
export function extractLexicalQuery(q: string, filterSpans: ExtractedSpan[]): string {
	return extractKeywords(cutSpans(q, validSpans(q, filterSpans)))
		.split(" ")
		.filter((t) => t && !LEXICAL_FILLER_WORDS.has(t.toLowerCase()))
		.join(" ");
}

/** Ein Thema als Stichwörter: seine Inhaltswörter, sonst der ganze Text. */
export function themeKeywords(theme: string): string {
	return extractLexicalQuery(theme, []) || theme;
}
