// Markiert Begriffe im Snippet serverseitig nach, ohne bestehende
// <mark>-Blöcke (Meilis q-Highlight bzw. schon gesetzte Marks) zu
// verschachteln. Zwei Abnehmer: Entity-Surface-Formen (Personen/Orte/
// Organisationen, <mark class="entity-match">) und die ODER-/UND-Begriffe der
// zweistufigen Union-Pfade (<mark class="match"> – dort kennt Meili die
// Begriffe nicht, q ist das Thema bzw. leer). Reine Server-seitige
// Nachbearbeitung – kein Reindex, keine Indexer-Änderung. «ß» und «ss» gelten wie
// in der Suche als gleich: Die Begriffe sind gefaltet («Strasse»), der gezeigte
// Text des Archivkatalogs, der Ehedaten und der Titel steht im Original («Straße»).

import { sharpSPattern } from "$lib/sharpS";

const MARK_CLOSE = "</mark>";

// Splittet HTML in alternierende Segmente: bestehende <mark>...</mark>-Blöcke
// werden separiert, damit wir sie unangetastet lassen. Wir gehen davon aus,
// dass Meili keine verschachtelten Marks ausgibt.
function splitOnMarks(html: string): { text: string; isMark: boolean }[] {
	const segments: { text: string; isMark: boolean }[] = [];
	const re = /<mark\b[^>]*>[\s\S]*?<\/mark>/gi;
	let lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		if (m.index > lastIndex) {
			segments.push({ text: html.slice(lastIndex, m.index), isMark: false });
		}
		segments.push({ text: m[0], isMark: true });
		lastIndex = re.lastIndex;
	}
	if (lastIndex < html.length) {
		segments.push({ text: html.slice(lastIndex), isMark: false });
	}
	return segments;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Muster eines Begriffs: wörtlich, nur ss und ß gleich. */
function termPattern(term: string): string {
	return sharpSPattern(escapeRegex(term));
}

// "Wort-Grenze" für Unicode-Text: kein Buchstabe/Ziffer direkt davor/danach.
// JS-`\b` versteht Umlaute nicht zuverlässig, deshalb manuell.
function isWordChar(ch: string | undefined): boolean {
	if (!ch) return false;
	return /[\p{L}\p{N}]/u.test(ch);
}

// Exakte Wortgrenzen-Matches (case-insensitiv), ohne Stemming/Typo-Toleranz –
// «Hund» markiert «Hunden» nicht. Für Entities wie für ODER-Begriffe die
// akzeptierte Grenze dieser Nachbearbeitung.
export function markTerms(html: string, terms: string[], markClass: string): string {
	const filtered = terms.map((e) => e.trim()).filter((e) => e.length > 0);
	if (filtered.length === 0) return html;

	// Längster Match zuerst – sonst frisst "Zürich" den Anfang von
	// "Zürich-Affoltern" weg und das Restwort bleibt unmarkiert.
	const sorted = [...new Set(filtered)].sort((a, b) => b.length - a.length);
	const pattern = new RegExp(`(${sorted.map(termPattern).join("|")})`, "giu");
	const markOpen = `<mark class="${markClass}">`;

	return splitOnMarks(html)
		.map((seg) => {
			if (seg.isMark) return seg.text;
			return seg.text.replace(pattern, (match, _g1, offset: number, input: string) => {
				const before = input[offset - 1];
				const after = input[offset + match.length];
				if (isWordChar(before) || isWordChar(after)) return match;
				return `${markOpen}${match}${MARK_CLOSE}`;
			});
		})
		.join("");
}

export function markEntities(html: string, entities: string[]): string {
	return markTerms(html, entities, "entity-match");
}

// Findet den ersten Begriff im rohen Body und baut ein Snippet von ~cropLen
// Wörtern rundum. Liefert null, wenn keiner im Body auftaucht (dann
// Meili-Default-Crop behalten). `marker` steht wie Meilis cropMarker an einem
// abgeschnittenen Ende (Katalog: «…»); ohne ihn bleibt das Snippet unmarkiert.
export function cropAroundTerms(
	body: string,
	terms: string[],
	cropLen = 30,
	marker = "",
): string | null {
	const filtered = terms.map((e) => e.trim()).filter((e) => e.length > 0);
	if (filtered.length === 0 || body.length === 0) return null;

	const sorted = [...new Set(filtered)].sort((a, b) => b.length - a.length);
	const pattern = new RegExp(sorted.map(termPattern).join("|"), "iu");
	const m = pattern.exec(body);
	if (!m) return null;

	const matchStart = m.index;
	const matchEnd = m.index + m[0].length;

	// Wort-Fenster rundum: cropLen/2 Wörter vor und nach dem Match.
	const half = Math.max(1, Math.floor(cropLen / 2));
	const before = body.slice(0, matchStart);
	const after = body.slice(matchEnd);

	const beforeTokens = before.split(/\s+/);
	const afterTokens = after.split(/\s+/);
	const keptBefore = beforeTokens.slice(Math.max(0, beforeTokens.length - half));
	const keptAfter = afterTokens.slice(0, half);
	const sliceBefore = keptBefore.join(" ");
	const sliceAfter = keptAfter.join(" ");
	// Abgeschnitten, wenn ausserhalb des Fensters noch ein Wort steht.
	const cutStart = marker !== "" && beforeTokens.slice(0, beforeTokens.length - keptBefore.length).some(Boolean);
	const cutEnd = marker !== "" && afterTokens.slice(keptAfter.length).some(Boolean);

	return `${cutStart ? marker : ""}${sliceBefore}${sliceBefore ? " " : ""}${m[0]}${sliceAfter ? " " : ""}${sliceAfter}${cutEnd ? marker : ""}`;
}

/**
 * Auszug an der passendsten Stelle für eine Thema-Suche (Frage oder Thema ohne
 * Suchbegriff): das Fenster von `cropLen` Wörtern, in dem die meisten
 * verschiedenen Wörter der Frage stehen (Gleichstand: mehr Fundstellen, dann
 * die frühere), die gefundenen Wörter markiert (`<mark class="match">`). Ein
 * Wort der Frage trifft auch gebeugte Formen, die mit ihm beginnen («Hund» →
 * «Hunden»). null ohne Fundstelle – dann bleibt Meilis Auszug stehen. Meili
 * croppt dort um den ganzen Fragetext samt Füllwörtern («der», «gegen»), das
 * Fenster landete so oft auf einer Stelle ohne das Thema.
 */
export function cropAtBestWindow(body: string, terms: string[], cropLen = 30): string | null {
	const wanted = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3))];
	if (wanted.length === 0 || !body) return null;
	const words = body.split(/\s+/).filter(Boolean);
	if (words.length === 0) return null;
	// Frageworte nach ihren ersten drei Buchstaben (kürzere gibt es nicht), damit je Textwort nur die
	// möglichen geprüft werden – der Auszug läuft im einzigen Thread über ganze Volltexte.
	const byStart = new Map<string, number[]>();
	wanted.forEach((w, t) => byStart.set(w.slice(0, 3), [...(byStart.get(w.slice(0, 3)) ?? []), t]));
	// Je Wort der Index des getroffenen Frageworts (Wortanfang, ohne Satzzeichen davor).
	const hits: number[] = words.map((w) => {
		const core = w.replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase();
		for (const t of byStart.get(core.slice(0, 3)) ?? []) if (core.startsWith(wanted[t])) return t;
		return -1;
	});
	if (!hits.some((h) => h >= 0)) return null;
	const size = Math.max(1, Math.min(cropLen, words.length));
	// Gleitendes Fenster: Zahl der Fundstellen je Fragewort.
	const counts = new Int32Array(wanted.length);
	let distinct = 0;
	let total = 0;
	const move = (h: number, by: 1 | -1) => {
		if (h < 0) return;
		total += by;
		counts[h] += by;
		if (by === 1 && counts[h] === 1) distinct++;
		if (by === -1 && counts[h] === 0) distinct--;
	};
	for (let i = 0; i < size; i++) move(hits[i], 1);
	let best = { start: 0, distinct: -1, total: -1 };
	for (let s = 0; ; s++) {
		// Nur Fenster prüfen, die mit einer Fundstelle beginnen oder am Textanfang stehen –
		// das beste Fenster lässt sich immer so verschieben, dass es an einer Fundstelle beginnt.
		if ((s === 0 || hits[s] >= 0) && (distinct > best.distinct || (distinct === best.distinct && total > best.total))) {
			best = { start: s, distinct, total };
		}
		if (s + size >= words.length) break;
		move(hits[s], -1);
		move(hits[s + size], 1);
	}
	// Etwas Kontext vor der ersten Fundstelle im Fenster: das Fenster um ein Viertel nach vorn
	// schieben, soweit es die Fundstellen nicht verliert.
	let start = best.start;
	const lastHit = (() => {
		for (let i = start + size - 1; i >= start; i--) if (hits[i] >= 0) return i;
		return start;
	})();
	const shift = Math.min(Math.floor(size / 4), start, start + size - 1 - lastHit);
	start -= Math.max(0, shift);
	const slice = words.slice(start, start + size);
	const forms = new Set<string>();
	slice.forEach((w, i) => {
		if (hits[start + i] < 0) return;
		const m = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/u.exec(w);
		if (m) forms.add(m[0]);
	});
	return markTerms(slice.join(" "), [...forms], "match");
}
