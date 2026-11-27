// «Genau so geschrieben» zuerst, dann «ähnliche Schreibungen» (Trefferliste der Zentralen
// Serien, strikte Stichwortsuche; Entscheid Tim 2026-11-17). Pur, unit-getestet in
// tiers.test.ts; die Abfragen macht searchDocuments (meili.ts).
//
// Unscharf heisst hier: ein Wort der Anfrage steht im Dokument nicht genau so, sondern nur als
// Wortanfang (nur das LETZTE Wort, «Pause» → «Pausen»), mit Tippfehler (documents ab 7
// Zeichen) oder zerlegt («Seehof» → «See Hof»). Die beiden Stufen sind disjunkt und ergeben
// zusammen genau die Treffer der Anfrage:
// - Stufe A = die Anfrage mit jedem Wort in Anführungszeichen (exakt, ohne Nachbarschafts-
//   zwang, wie exactWrap in searchTools.ts): alle Wörter genau so geschrieben.
// - Stufe B = die Anfrage mit «-Wort» für ein Wort, je Wort ein Zweig (Vereinigung, ODER-
//   Föderation): Meili schliesst mit «-Wort» genau die Dokumente aus, die das Wort GENAU SO
//   enthalten (Negationen kennen weder Wortanfang noch Tippfehler), das Wort selbst bleibt als
//   unscharfer Pflicht-Term – übrig sind die Dokumente, die es nur unscharf enthalten. Lokal
//   mit Meili 1.13.3 und 1.57.0 geprüft: A und B ergeben zusammen die Treffer der Anfrage.
//
// Nach Relevanz reiht Meili schon so (rankingRules mit `exactness` vor `proximity`, Indexer
// meili.ts): die ersten |A| Treffer sind A. Die Liste zieht dort nur die Grenze. Nach Datum
// mischte `sort` beide Stufen; dort holt die Seite ihre Treffer aus A bzw. B, jede Stufe nach
// Datum.

import { parseQueryTokens } from "$lib/searchParams";
import { foldRmQueryMarks } from "$lib/rmText";

// Nur Tokens mit Buchstabe oder Zahl sind Wörter («-» oder Satzzeichen allein nicht).
const WORD_TOKEN_RE = /[\p{L}\p{N}]/u;

export interface TierPlan {
	/** Die Anfrage mit jedem freien Wort in Anführungszeichen (Stufe A). */
	exactQ: string;
	/** Die freien Wörter – je Wort ein Zweig «-Wort Anfrage» (Stufe B). */
	words: string[];
}

/**
 * Plan der beiden Stufen; null, wenn die Anfrage kein freies Wort hat (nur Phrasen oder
 * Ausschlüsse – dann ist alles «genau so»), oder bei unbalancierten Anführungszeichen
 * (Meili liest eine offene Phrase bis zum Ende, unsere Zerlegung wiche davon ab).
 */
export function tierPlan(q: string): TierPlan | null {
	// Wie die Abfrage selbst (exclusionsFirst): Nasalstrich und ¬ aufgelöst, dazu Umlaute in einem
	// Zeichen – aus macOS oder PDF kopiert kommen sie oft zerlegt («u» und Punkte).
	const t = foldRmQueryMarks(q).normalize("NFC").trim();
	if (!t || ((t.match(/"/g) ?? []).length & 1) === 1) return null;
	const tokens = parseQueryTokens(t);
	const words: string[] = [];
	const parts = tokens.map((tok) => {
		if (tok.phrase || tok.exclude || !WORD_TOKEN_RE.test(tok.text)) return tok.raw;
		// Meili trennt an jedem Zeichen ausser Buchstabe/Zahl («Zürich-Oerlikon», «1.5»): zwei
		// Wörter, beide Pflicht, Abstand frei. Zitiert als ein Token wäre es eine Phrase (Abstand
		// 1) und Treffer mit beiden Wörtern weiter auseinander fielen aus beiden Stufen. Ein
		// aufgesetztes Zeichen («uͤ») gehört zum Buchstaben davor.
		const subs = tok.text.split(/[^\p{L}\p{N}\p{M}]+/u).filter((w) => w !== "");
		words.push(...subs);
		return subs.map((w) => `"${w}"`).join(" ");
	});
	if (words.length === 0) return null;
	return { exactQ: parts.join(" "), words: [...new Set(words)] };
}

/** Die Zweige der Stufe B als ODER-Begriffe: «-Wort» je freiem Wort (an die Anfrage gehängt). */
export function fuzzyBranches(plan: TierPlan): string[] {
	return plan.words.map((w) => `-${w}`);
}

/** Ausschnitt einer Stufe. */
export interface TierSlice {
	offset: number;
	limit: number;
}

/**
 * Welche Treffer die Seite [offset, offset + limit) aus den Stufen braucht: aus A die
 * Positionen vor `exactTotal`, aus B den Rest (B beginnt bei Position `exactTotal`).
 */
export function splitTiers(offset: number, limit: number, exactTotal: number): { a: TierSlice | null; b: TierSlice | null } {
	const start = Math.max(0, Math.floor(offset));
	const end = start + Math.max(0, Math.floor(limit));
	const n = Math.max(0, Math.floor(exactTotal));
	const a = start < n && end > start ? { offset: start, limit: Math.min(end, n) - start } : null;
	const bStart = Math.max(start, n);
	const b = end > bStart ? { offset: bStart - n, limit: end - bStart } : null;
	return { a, b };
}
