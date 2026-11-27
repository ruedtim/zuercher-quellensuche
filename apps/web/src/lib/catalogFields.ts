/**
 * Feldsuche im Reiter «Archivkatalog» nach dem Vorbild der «Feldsuche» im
 * Online-Katalog des Staatsarchivs: Suchbegriffe nur in einem Feld der
 * Verzeichnungseinheiten. Angeboten werden die durchsuchbaren Felder des Index
 * `catalog` (services/catalog settings.ts): Titel, Signatur, «Inhalt und Form»
 * (bei Urkunden das Regest, Feld `text`) und Provenienz. Die übrigen Felder der
 * Feldsuche des Staatsarchivs (Geschichte des Aktenbildners, Bestandsgeschichte,
 * Autorschaft, Frühere Signaturen) stehen nur in `sections` und sind nicht
 * durchsuchbar. Den Bestand wählt die Filterspalte als weiteres «Feld» aus
 * Vorschlägen (`catBestand`, catalog.ts).
 *
 * URL: je Feld ein wiederholbarer Parameter (`catTitle`, `catSig`, `catText`,
 * `catProv`), ein Wert je Eintrag in der Schreibweise des Suchbegriffs (Wörter,
 * "Phrase", -Ausschluss). Wie der Suchbegriff strikt: alle Wörter eines Eintrags
 * müssen im Feld stehen, das letzte als Wortanfang. Einträge desselben Feldes
 * gelten zusammen, Felder untereinander und mit Suchbegriff und Filtern ebenfalls
 * (UND, wie die Voreinstellung im Online-Katalog). Wie der Server die Bedingungen
 * schneidet, plant planFieldSearch (lib/server/catalogFieldSearch.ts führt aus).
 * Pur (Server und Browser), unit-getestet in catalogFields.test.ts.
 */

import { parseQueryTokens } from "./searchParams";
import { foldSharpS } from "./sharpS";

/** Durchsuchbare Felder des Index `catalog` (= Meili-Attribut). */
export type CatalogFieldKey = "title" | "signature" | "text" | "provenienz";

export interface CatalogFieldInfo {
	key: CatalogFieldKey;
	/** URL-Parameter, wiederholbar. */
	param: string;
	label: string;
	/** Wird das Feld in der Trefferliste mit Hervorhebungen gezeigt (Titel, Auszug)? */
	marked: boolean;
}

/** In der Reihenfolge der Auswahlliste (wie im Online-Katalog: Signatur zuerst). */
export const CATALOG_SEARCH_FIELDS: readonly CatalogFieldInfo[] = [
	{ key: "signature", param: "catSig", label: "Signatur", marked: false },
	{ key: "title", param: "catTitle", label: "Titel", marked: true },
	{ key: "text", param: "catText", label: "Inhalt und Form", marked: true },
	{ key: "provenienz", param: "catProv", label: "Provenienz", marked: false },
];

export interface CatalogFieldEntry {
	field: CatalogFieldKey;
	/** Suchbegriff in Meili-Schreibweise (Wörter, "Phrase", -Ausschluss). */
	value: string;
}

/**
 * «exakt» (Wortfolge) ist beim Feld Signatur voreingestellt: Signaturen bestehen aus kurzen
 * Gliedern, die als einzelne Wörter überall in anderen Signaturen vorkommen. Prod 2026-10-30
 * (Treffer mit Wörtern | als Wortfolge, davon jeweils mit dieser Signatur am Anfang): «C II 12»
 * 297 | 181 (180), «W I 3» 2'892 | 60 (60), «A 70» 139 | 16 (12). Ohne «exakt» gilt das letzte
 * Glied als Wortanfang («N 1» findet N 1133 …).
 */
export function catalogFieldExactByDefault(key: CatalogFieldKey | "bestand"): boolean {
	return key === "signature";
}

/** Je Feld höchstens so viele Einträge, je Eintrag so viele Zeichen (URL von Hand). */
const ENTRIES_PER_FIELD = 10;
const VALUE_MAX = 200;

export function catalogFieldInfo(key: CatalogFieldKey): CatalogFieldInfo {
	return CATALOG_SEARCH_FIELDS.find((f) => f.key === key) ?? CATALOG_SEARCH_FIELDS[0];
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Einträge der Feldsuche aus der URL: je Feld in Reihenfolge, leere und doppelte weg. */
export function parseCatalogFields(sp: URLSearchParams): CatalogFieldEntry[] {
	const out: CatalogFieldEntry[] = [];
	for (const f of CATALOG_SEARCH_FIELDS) {
		const seen = new Set<string>();
		for (const raw of sp.getAll(f.param)) {
			const value = squash(raw).slice(0, VALUE_MAX).trim();
			const key = value.toLowerCase();
			if (!value || seen.has(key) || seen.size >= ENTRIES_PER_FIELD) continue;
			seen.add(key);
			out.push({ field: f.key, value });
		}
	}
	return out;
}

/** Schreibt die Einträge (ersetzt die bisherigen Feld-Parameter). */
export function writeCatalogFields(sp: URLSearchParams, entries: readonly CatalogFieldEntry[]): void {
	for (const f of CATALOG_SEARCH_FIELDS) sp.delete(f.param);
	for (const e of entries) sp.append(catalogFieldInfo(e.field).param, e.value);
}

/**
 * Eingabe des Feldes als Eintrag: «exakt» (oder Anführungszeichen in der Eingabe)
 * ⇒ Phrase, «ausschliessen» ⇒ jedes Wort bzw. die Phrase verneint. Anders als beim
 * Suchbegriff kein ODER: «A OR B» bleibt wörtlich. "" = nichts zu übernehmen.
 */
export function catalogFieldValue(input: string, opts: { exact: boolean; exclude: boolean }): string {
	const txt = squash(input);
	if (!txt) return "";
	if (opts.exact || txt.includes('"')) {
		const t = squash(txt.replace(/"/g, ""));
		return t ? `${opts.exclude ? "-" : ""}"${t}"` : "";
	}
	return opts.exclude ? txt.split(" ").map((w) => (w.startsWith("-") ? w : `-${w}`)).join(" ") : txt;
}

/** Hängt einen Eintrag an; ein gleichlautender im selben Feld zählt nicht doppelt. */
export function addCatalogField(entries: readonly CatalogFieldEntry[], entry: CatalogFieldEntry): CatalogFieldEntry[] {
	const value = squash(entry.value);
	if (!value) return [...entries];
	const dup = entries.some((e) => e.field === entry.field && e.value.toLowerCase() === value.toLowerCase());
	return dup ? [...entries] : [...entries, { field: entry.field, value }];
}

/** Eine Bedingung je Feld: die Einträge zusammen (alle Wörter im Feld). */
export interface CatalogFieldCondition {
	field: CatalogFieldKey;
	/** Meili-Suche nur in diesem Feld (Einträge mit Leerzeichen verbunden). */
	q: string;
}

export function catalogFieldConditions(entries: readonly CatalogFieldEntry[] | undefined): CatalogFieldCondition[] {
	const out: CatalogFieldCondition[] = [];
	for (const f of CATALOG_SEARCH_FIELDS) {
		const values = (entries ?? [])
			.filter((e) => e.field === f.key)
			.map((e) => (f.key === "signature" ? dropArchive(e.value.trim()) : e.value.trim()))
			.filter(Boolean);
		if (values.length > 0) out.push({ field: f.key, q: values.join(" ") });
	}
	return out;
}

/**
 * Sucht die Feldsuche nach einer Signatur? Dann zählen auch die Einheiten, die ein Dokument der
 * Plattform abbilden (sonst keine eigenen Treffer): Wer eine Signatur eingibt, will genau diese
 * Einheit (Tim 2026-11-25). Ausschlüsse allein («-MM») genügen nicht.
 */
export function searchesSignature(entries: readonly CatalogFieldEntry[] | undefined): boolean {
	return (entries ?? []).some((e) => e.field === "signature" && parseQueryTokens(e.value).some((t) => !t.exclude && t.text.trim()));
}

/** Signaturen beginnen im Katalog ohne «StAZH», in Zitaten mit («StAZH MM 3.56 RRB 1938/1585»). */
const dropArchive = (s: string) => s.replace(/^("?)\s*StAZH[\s,:]+/i, "$1");

/** Sieht der Suchbegriff wie eine Signatur aus («MM 3.56 RRB 1938/1585», «StAZH C II 12»)? Dann
 *  der Eintrag für das Feld «Signatur» (Wortfolge), sonst null. */
export function signatureEntryOf(q: string): CatalogFieldEntry | null {
	const text = squash(dropArchive(squash(q.replace(/"/g, " "))));
	// Grossbuchstaben am Anfang, dann eine Zahl: «C II 12», «MM 24.35», «ABl 1915», «OS 81».
	if (!/^(?:[A-Z]{1,4}|ABl|Abl)(?:[ .]|$)/.test(text) || !/\d/.test(text) || text.length > VALUE_MAX - 2) return null;
	return { field: "signature", value: `"${text}"` };
}

/** Reiht die Liste mit dieser Feldsuche nach Worttreffern? Wie beim Suchbegriff
 *  (relevanceSortApplicable) zählt jeder Eintrag: Ohne Suchbegriff wird eine Feldbedingung
 *  selbst die Abfrage (planFieldSearch). */
export function catalogFieldsRankable(entries: readonly CatalogFieldEntry[] | undefined): boolean {
	return (entries ?? []).length > 0;
}

/** Anzeige eines Eintrags wie die Chips des Suchbegriffs: «„Phrase"», «− Wort». */
export function catalogFieldChip(entry: CatalogFieldEntry): { label: string; kind: "term" | "phrase" | "exclude" } {
	const tokens = parseQueryTokens(entry.value);
	const text = tokens.map((t) => (t.exclude ? `− ${t.phrase ? `„${t.text}"` : t.text}` : t.phrase ? `„${t.text}"` : t.text)).join(" ");
	const kind = tokens.length > 0 && tokens.every((t) => t.exclude) ? "exclude" : tokens.length === 1 && tokens[0].phrase ? "phrase" : "term";
	return { label: `${catalogFieldInfo(entry.field).label}: ${text || entry.value}`, kind };
}

/** Wörter, die der Server in Titel bzw. Auszug nachmarkiert, wenn Meili ihr Feld nicht
 *  selbst durchsucht hat (Bedingungen, die als ID-Menge wirken): nur vorkommende Wörter,
 *  Phrasen ganz, nur aus Feldern mit Hervorhebung. */
export function catalogFieldMarks(conditions: readonly CatalogFieldCondition[]): { title: string[]; text: string[] } {
	const marks = { title: [] as string[], text: [] as string[] };
	for (const c of conditions) {
		if (c.field !== "title" && c.field !== "text") continue;
		for (const t of parseQueryTokens(c.q)) if (!t.exclude && t.text.trim()) marks[c.field].push(t.text.trim());
	}
	return marks;
}

/**
 * Wie der Server die Bedingungen schneidet (eine Abfrage hat in Meili genau eine Suche
 * und ein Suchfeld-Set). Kandidaten sind der Suchbegriff (falls gesetzt, `mainIndex`)
 * und je Feld eine Bedingung, `counts` ihre Trefferzahlen unter denselben Filtern.
 * - Eine Bedingung allein: «native», die Abfrage sucht direkt in ihrem Feld.
 * - Sonst bleibt eine Bedingung die Abfrage (`main`: der Suchbegriff, ohne ihn die
 *   grösste Bedingung), die übrigen werden zur ID-Menge geschnitten (`chain`, kleinste
 *   zuerst; jede weitere nur noch innerhalb der bisherigen IDs). Die erste muss
 *   höchstens `cap` Treffer haben, sonst beginnt die Kette mit der Abfrage selbst, sonst
 *   ist die Suche zu breit («tooBroad»). Eine Bedingung ohne Treffer ⇒ «empty».
 */
export type FieldSearchPlan =
	| { kind: "none" }
	| { kind: "native"; main: number }
	| { kind: "empty" }
	| { kind: "chain"; main: number; chain: number[] }
	| { kind: "tooBroad" };

export function planFieldSearch(counts: readonly number[], opts: { mainIndex: number | null; cap: number }): FieldSearchPlan {
	if (counts.length === 0) return { kind: "none" };
	if (counts.length === 1) return { kind: "native", main: 0 };
	if (counts.some((c) => c <= 0)) return { kind: "empty" };
	let main = opts.mainIndex;
	if (main == null) {
		main = 0;
		for (let i = 1; i < counts.length; i++) if (counts[i] > counts[main]) main = i;
	}
	const others = counts
		.map((count, i) => ({ count, i }))
		.filter((c) => c.i !== main)
		.sort((a, b) => a.count - b.count || a.i - b.i)
		.map((c) => c.i);
	if (counts[others[0]] <= opts.cap) return { kind: "chain", main, chain: others };
	if (counts[main] <= opts.cap) return { kind: "chain", main, chain: [main, ...others] };
	return { kind: "tooBroad" };
}

/** So viele Bestände schlägt das Feld «Bestand» höchstens vor. */
export const BESTAND_SUGGEST_MAX = 20;

/** Kleinschreibung ohne diakritische Zeichen, ß als ss, in Wörter zerlegt (Buchstaben und Ziffern). */
function words(s: string): string[] {
	return foldSharpS(s)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/**
 * Vorschläge für das Feld «Bestand»: die Bestände der Facettenverteilung, deren Etikett jedes
 * Wort der Eingabe als Wortanfang enthält («kirchenb» findet «E III Kirchenbücher …», «e iii»
 * nicht «E II …»), häufigste zuerst; ohne Eingabe die häufigsten. Meilis eigene Facettensuche
 * vergleicht nur den Anfang des ganzen Etiketts.
 */
export function bestandSuggestions(dist: Record<string, number>, fq: string, max = BESTAND_SUGGEST_MAX): Array<{ value: string; count: number }> {
	const query = words(fq);
	return Object.entries(dist)
		.filter(([label, count]) => {
			if (count <= 0) return false;
			if (query.length === 0) return true;
			const labelWords = words(label);
			return query.every((q) => labelWords.some((w) => w.startsWith(q)));
		})
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
		.slice(0, max)
		.map(([value, count]) => ({ value, count }));
}
