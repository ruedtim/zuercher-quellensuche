/**
 * Vorschläge der Namensfelder (Personen, Orte, Organisationen) im Reiter «Zentrale Serien»
 * (und «Alle Quellen»), sobald der documents-Index die Vergleichsschlüssel trägt
 * (entityKeysReady, meili.ts): ein Eintrag je Schlüssel (Fassung 2, lib/entityFilter.ts)
 * statt je Schreibung. Gewählt filtert ein Name nach Form oder Schlüssel – die Zahl eines
 * Eintrags zählt darum die Dokumente der Auswahl mit diesem Schlüssel, so viele liefert die
 * Wahl («Fischenthal» samt «Fischental» und «Fischenthal ZH»). Angezeigt wird die häufigste
 * Form des Schlüssels. Formen ohne Schlüssel (ein Nachname allein) bleiben einzelne Einträge
 * mit ihrer eigenen Zahl.
 *
 * Mit Eingabe: Meilis Facettensuche über die Formen (tippfehlertolerant, Anfang des ganzen
 * Werts) liefert Formen, gezählt wird ihr Schlüssel; dazu die Schlüssel der Auswahl, deren
 * Wörter mit den getippten beginnen («Escher» findet «Alfred Escher», wie keyMatchesQuery im
 * Register des Archivkatalogs).
 *
 * Pur: Planung, Rangliste und Anzeigeform; die Abfragen (Facetten der Auswahl, Nachzählung,
 * Caches) in lib/server/documentEntitySuggestions.ts. Unit-getestet in
 * entitySuggestions.test.ts.
 */

import { keyMatchesQuery } from "./catalogRegister";
import { documentEntityKey, type EntityDim } from "./entityFilter";
import { foldText, orgKeyV2, personQueryWordsV2, placeKeyV2 } from "./entityKey";

export interface EntitySuggestion {
	/** Anzeigeform: die häufigste Form des Schlüssels bzw. die Form ohne Schlüssel. */
	value: string;
	/** Dokumente der Auswahl, die die Wahl dieses Eintrags liefert. */
	count: number;
}

/** Facettenverteilung: Wert → Dokumente. */
export type FacetCounts = Readonly<Record<string, number>>;

const ALL_CAPS = /^[^\p{Ll}]*$/u;

/**
 * Anzeigeform eines Schlüssels: die häufigste Form mit genau diesem Schlüssel, bei
 * Gleichstand ohne Versalien («ZÜRICH») und die kürzere (wie pickDisplayForm des Registers,
 * hier mit Dokumentzahlen); null ohne passende Form.
 */
export function pickKeyForm(dim: EntityDim, key: string, forms: Iterable<readonly [string, number]>): string | null {
	let best: string | null = null;
	let bestScore = -Infinity;
	for (const [form, n] of forms) {
		if (documentEntityKey(dim, form) !== key) continue;
		const score = n - (ALL_CAPS.test(form) ? 0.5 : 0);
		const shorter = best != null && (form.length < best.length || (form.length === best.length && form < best));
		if (score > bestScore || (score === bestScore && shorter)) {
			best = form;
			bestScore = score;
		}
	}
	return best;
}

/** Ein Buchstabe: c wie im Schlüssel als k (das «c»-Ende ergänzt «ch»), y als i. */
const SINGLE_LETTER: Record<string, string> = { c: "k", y: "i" };

/** Ein getipptes Wort eines Orts oder einer Organisation in Schlüsselform. */
function foldQueryWord(dim: EntityDim, w: string): string {
	if (w.length === 1) return SINGLE_LETTER[w] ?? w;
	return (dim === "organizations" ? orgKeyV2(w) : null) ?? placeKeyV2(w) ?? w;
}

/**
 * Getippte Wörter in Schlüsselform, je Wort die möglichen Anfänge (wie registerQueryWords
 * des Registers, hier Fassung 2): eine vollständige Form ergibt ihren Schlüssel («Escher,
 * Alfred» → alfred, escher), sonst je Wort. Endet die Eingabe auf «c», darf das letzte Wort
 * auch mit «ch» weitergehen («Esc» → Escher): der Schlüssel macht aus «c» sonst «k».
 */
export function suggestionQueryWords(dim: EntityDim, q: string): string[][] {
	const clean = q.replace(/\s+/g, " ").trim().slice(0, 100);
	if (!clean) return [];
	// Personen je Wort (personQueryWordsV2): der Schlüssel striche auch Anreden, die
	// Nachnamen sein können («Vogt Hans Jakob» ergäbe nur hans, jakob).
	const key = dim === "persons" ? null : documentEntityKey(dim, clean);
	const folded =
		dim === "persons"
			? personQueryWordsV2(clean)
			: key
				? key.split(" ")
				: foldText(clean)
						.split(" ")
						.filter(Boolean)
						.map((w) => foldQueryWord(dim, w));
	const out = [...new Set(folded.filter(Boolean))].slice(0, 6).map((w) => [w]);
	const last = out[out.length - 1];
	if (last && /c$/i.test(clean) && last[0].endsWith("k")) last.push(`${last[0].slice(0, -1)}ch`);
	return out;
}

/** Abfragen, die die Auswahl allein nicht beantwortet (lib/server/documentEntitySuggestions.ts). */
export interface SuggestionLookups {
	/** Dokumente der Auswahl je Schlüssel (Nachzählung). */
	count(keys: string[]): Promise<ReadonlyMap<string, number>>;
	/** Anzeigeform je Schlüssel, wenn weder die Facette der Auswahl noch die Facettensuche eine
	 *  Form des Schlüssels kennt; null = keine passende Form. */
	form(keys: string[]): Promise<ReadonlyMap<string, string | null>>;
}

export interface KeyedSuggestionInput {
	dim: EntityDim;
	/** Schlüssel der Auswahl (Facette des Schlüsselfelds, häufigste zuerst, gekappt). */
	keyDist: FacetCounts;
	/** Formen der Auswahl (Facette des Namensfelds, ebenso). */
	formDist: FacetCounts;
	/** Mit Eingabe: Treffer der Facettensuche über die Formen (Zahl in der Auswahl). */
	hits?: ReadonlyArray<{ value: string; count: number }>;
	/** Mit Eingabe: die Wörter in Schlüsselform (suggestionQueryWords). */
	words?: string[][];
}

interface Ranked {
	key: string | null;
	form: string | null;
	count: number;
}

/**
 * Vorschläge je Schlüssel. Ohne Eingabe alle Schlüssel und alle Formen ohne Schlüssel der
 * Auswahl; mit Eingabe die Schlüssel der gefundenen Formen und die Schlüssel der Auswahl
 * (Verteilung und Formen), deren Wörter passen. Die Zahl eines Schlüssels kommt aus der
 * Verteilung der Auswahl. Kennt die gekappte Verteilung ihn nicht, ist er höchstens so häufig
 * wie ihr seltenster Schlüssel: nachgezählt (höchstens `recountMax`, die mit der häufigsten
 * Form zuerst) nur, wenn er damit noch unter die ersten `limit` käme. Häufigste zuerst. Die
 * Anzeigeform kommt aus den Formen der Auswahl und der Facettensuche, sonst aus
 * `lookups.form`; ein Schlüssel ohne passende Form fällt weg.
 */
export async function keyedSuggestions(
	input: KeyedSuggestionInput,
	lookups: SuggestionLookups,
	opts: { limit: number; recountMax: number },
): Promise<EntitySuggestion[]> {
	const { dim } = input;
	const typed = input.hits !== undefined;
	// Als Map: Facettenwerte sind Daten, keine Objekt-Eigenschaften.
	const keyDist = new Map(Object.entries(input.keyDist));
	const forms = new Map<string, Array<readonly [string, number]>>();
	const keyless = new Map<string, number>();
	const note = (form: string, count: number, entry: boolean): string | null => {
		const key = documentEntityKey(dim, form);
		if (key) {
			const list = forms.get(key);
			if (list) list.push([form, count]);
			else forms.set(key, [[form, count]]);
		} else if (entry) {
			keyless.set(form, Math.max(keyless.get(form) ?? 0, count));
		}
		return key;
	};
	for (const [form, count] of Object.entries(input.formDist)) note(form, count, !typed);

	const counts = new Map<string, number>();
	const bounds = new Map<string, number>();
	if (!typed) {
		for (const [key, count] of keyDist) counts.set(key, count);
	} else {
		for (const hit of input.hits ?? []) {
			const key = note(hit.value, hit.count, true);
			if (!key) continue;
			const known = keyDist.get(key);
			if (known !== undefined) counts.set(key, known);
			else bounds.set(key, Math.max(bounds.get(key) ?? 0, hit.count));
		}
		const words = input.words ?? [];
		if (words.length > 0) {
			for (const [key, count] of keyDist) if (keyMatchesQuery(key, words)) counts.set(key, count);
			// Formen der Auswahl, deren Schlüssel die gekappte Verteilung nicht kennt.
			for (const [key, list] of forms) {
				if (keyDist.has(key) || !keyMatchesQuery(key, words)) continue;
				for (const [, n] of list) bounds.set(key, Math.max(bounds.get(key) ?? 0, n));
			}
		}
	}

	let ceiling = Infinity;
	for (const n of keyDist.values()) ceiling = Math.min(ceiling, n);
	let above = 0;
	for (const n of [...counts.values(), ...keyless.values()]) if (n > ceiling) above++;
	const recount =
		above >= opts.limit
			? []
			: [...bounds]
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
					.slice(0, opts.recountMax)
					.map(([key]) => key);
	if (recount.length > 0) {
		const recounted = await lookups.count(recount);
		for (const key of recount) {
			const n = recounted.get(key) ?? 0;
			if (n > 0) counts.set(key, n);
		}
	}

	const ranked: Ranked[] = [
		...[...counts].map(([key, count]) => ({ key, form: null, count })),
		...[...keyless].map(([form, count]) => ({ key: null, form, count })),
	];
	ranked.sort((a, b) => b.count - a.count || (a.key ?? a.form ?? "").localeCompare(b.key ?? b.form ?? "", "de"));
	const top = ranked.slice(0, opts.limit);
	for (const e of top) if (e.key) e.form = pickKeyForm(dim, e.key, forms.get(e.key) ?? []);
	const unnamed = top.flatMap((e) => (e.key && !e.form ? [e.key] : []));
	if (unnamed.length > 0) {
		const named = await lookups.form(unnamed);
		for (const e of top) if (e.key && !e.form) e.form = named.get(e.key) ?? null;
	}
	return top.flatMap((e) => (e.form ? [{ value: e.form, count: e.count }] : []));
}
