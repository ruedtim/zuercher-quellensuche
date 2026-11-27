/**
 * «ß» und «ss» gelten in der Suche als gleich. Meili gleicht sie nicht an (ä wird zu a, ß
 * bleibt): «Strasse» fand «Straße» nicht. Die Indizes `catalog` und `ehedaten` führen darum
 * neben jedem durchsuchten Feld mit ß ein gefaltetes Suchfeld (`title` ⇒ `titleSearch`, gebaut
 * in services/catalog, searchText.ts); die Anfrage faltet die Web-App ebenso, sobald der Index
 * den Stand trägt (server/foldedSearch.ts). Gezeigt wird immer das Original: Hervorhebung und
 * Auszug, die Meili am gefalteten Feld rechnet, überträgt unfoldFormatted zurück.
 *
 * Die Dokumente (Index `documents`) haben ihre eigene Faltung (services/indexer searchText.ts,
 * foldRmSharpS in searchParams.ts).
 *
 * Pur und ohne Imports (Server, Browser, Tests; services/catalog prüft seine Kopie dagegen).
 * Unit-getestet in sharpS.test.ts.
 */

/** ß → ss, ẞ → SS – dieselbe Faltung für Suchfeld und Anfrage. */
export function foldSharpS(text: string): string {
	return text.replace(/ß/g, "ss").replace(/ẞ/g, "SS");
}

/** Name des gefalteten Suchfelds zu einem Feld (`title` ⇒ `titleSearch`). */
export function foldedField(field: string): string {
	return `${field}Search`;
}

/** So lang darf eine Folge von s sein, deren Schreibungen sharpSPattern einzeln aufzählt. */
const S_RUN_MAX = 6;

/** Alle Schreibungen einer Folge von `n` s mit s und ß (3 ⇒ sss, sß, ßs). */
function sRunSpellings(n: number): string[] {
	if (n <= 1) return ["s".repeat(Math.max(0, n))];
	return [...sRunSpellings(n - 1).map((r) => `s${r}`), ...sRunSpellings(n - 2).map((r) => `ß${r}`)];
}

/** Regex-Quelltext, der ss und ß gleich behandelt («Strasse» ⇒ «Stra(?:ss|ß)e», «usss» trifft auch
 *  «usß»); mit den Flags `iu` gelten auch SS und ẞ. `source` ist schon maskiert. */
export function sharpSPattern(source: string): string {
	return source.replace(/[sß]{2,}|ß/giu, (run) => {
		const n = foldSharpS(run).length;
		return n > S_RUN_MAX ? "[sß]+" : `(?:${sRunSpellings(n).join("|")})`;
	});
}

/** Schreibungen für Abfragen, die ß und ss nicht angleichen (Facettensuche, Filter auf ganze Werte):
 *  mit ss, wo eines steht mit ß, und wie geschrieben («Weiss» ⇒ «Weiss», «Weiß»). */
export function sharpSSpellings(text: string): string[] {
	const ss = foldSharpS(text);
	return [...new Set([ss, ss.replace(/ss/gi, "ß"), text])];
}

/** Marken, mit denen Meili hervorhebt, und das Zeichen an einem abgeschnittenen Ende. */
export interface FormatMarks {
	pre: string;
	post: string;
	/** Meilis `cropMarker` (Vorgabe «…»). */
	crop?: string;
}

/** Formatierten Text in reinen Text und die Positionen der hervorgehobenen Stellen zerlegen. */
function splitMarks(formatted: string, { pre, post }: FormatMarks): { plain: string; spans: Array<[number, number]> } {
	const spans: Array<[number, number]> = [];
	let plain = "";
	let at = 0;
	for (;;) {
		const open = formatted.indexOf(pre, at);
		const close = open < 0 ? -1 : formatted.indexOf(post, open + pre.length);
		if (close < 0) return { plain: plain + formatted.slice(at), spans };
		plain += formatted.slice(at, open);
		const from = plain.length;
		plain += formatted.slice(open + pre.length, close);
		spans.push([from, plain.length]);
		at = close + post.length;
	}
}

/** Wo ein (allenfalls an den Enden abgeschnittener) Text im ganzen steht; null, wenn nirgends. */
function locate(plain: string, whole: string, crop: string): { start: number; length: number; head: boolean; tail: boolean } | null {
	if (plain === whole) return { start: 0, length: whole.length, head: false, tail: false };
	const tailCut = plain.endsWith(crop);
	const headCut = plain.startsWith(crop);
	if (tailCut && whole.startsWith(plain.slice(0, -crop.length))) return { start: 0, length: plain.length - crop.length, head: false, tail: true };
	if (headCut && whole.endsWith(plain.slice(crop.length))) {
		const length = plain.length - crop.length;
		return { start: whole.length - length, length, head: true, tail: false };
	}
	if (headCut && tailCut && plain.length > 2 * crop.length) {
		const core = plain.slice(crop.length, -crop.length);
		const start = whole.indexOf(core);
		if (start >= 0) return { start, length: core.length, head: true, tail: true };
	}
	return null;
}

/**
 * Meilis Formatierung des gefalteten Felds auf das Original übertragen: dieselben Stellen
 * hervorgehoben, derselbe Auszug, aber mit ß, wo das Original eines hat. Eine Stelle, die mitten
 * in einem «ss» endet (Wortanfang «Stras»), schliesst das ganze ß ein. null, wenn der Text nicht
 * zum Original passt – dann gilt Meilis Formatierung des Originals.
 */
export function unfoldFormatted(formatted: string, original: string, marks: FormatMarks): string | null {
	const crop = marks.crop ?? "…";
	const { plain, spans } = splitMarks(formatted, marks);
	const found = locate(plain, foldSharpS(original), crop);
	if (!found) return null;
	// Je Zeichen des gefalteten Texts das Zeichen des Originals (ein ß steht für zwei).
	const source: number[] = [];
	for (let i = 0; i < original.length; i++) {
		source.push(i);
		if (original[i] === "ß" || original[i] === "ẞ") source.push(i);
	}
	source.push(original.length);
	const startOf = (p: number) => source[p];
	const endOf = (p: number) => (p === 0 ? 0 : source[p - 1] + 1);
	// Positionen in `plain` zählen das Auslassungszeichen am Anfang mit.
	const shift = found.start - (found.head ? crop.length : 0);
	const first = found.start;
	const last = found.start + found.length;
	const clamp = (p: number) => Math.min(last, Math.max(first, p + shift));
	let out = found.head ? crop : "";
	let at = startOf(first);
	for (const [a, b] of spans) {
		const from = Math.max(at, startOf(clamp(a)));
		const to = endOf(clamp(b));
		if (to <= from) continue;
		out += original.slice(at, from) + marks.pre + original.slice(from, to) + marks.post;
		at = to;
	}
	return out + original.slice(at, Math.max(at, endOf(last))) + (found.tail ? crop : "");
}
