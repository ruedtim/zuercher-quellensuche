/**
 * Schreibungen eines Namens erkennen: Gehört eine Form aus einem Register oder einem Text
 * zum Namen («Hainrich Bullingern» zu Heinrich Bullinger, «Kyburch» zu Kyburg), oder ist sie
 * ein Titel, ein Amt, ein Gattungswort («dechan» für Rudolf Gwalther, «land» für Mähren)?
 *
 * Genutzt vom Editionen-Aufbau (services/catalog, editionRegisters.ts: GND-Namen, Ortsformen)
 * und von der Volltextsuche der Ratsmanuale mit den Schreibungen des Editionen-Registers
 * (rmNames.ts). Pur und nur mit entityKey.ts als Import, damit services/catalog die Datei
 * direkt importiert. Unit-getestet in nameSpelling.test.ts (und editionRegisters.test.ts).
 */

import { nameWords, personKey, placeKey } from "./entityKey.js";

export function editDistance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		let diag = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const up = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
			diag = up;
		}
	}
	return row[b.length];
}

/** Titel und Füllwörter, die zwei Namen nicht verbinden. */
const WEAK_WORDS = new Set(["von", "vom", "zum", "zur", "der", "die", "das", "den", "dem", "und", "her", "herr", "herrn", "sant", "sankt", "sanct", "heilig", "heilige", "heiliger", "meister", "junker"]);

/** Ein Wort (gefaltet wie nameWords) ohne Flexionsendung («veren» für «Verenen», «timote» für «Timotheo»). */
function wordForms(w: string): string[] {
	const stem = w.replace(/(?:en|es|um|us|n|s|e|o|i|a)$/, "");
	return stem.length >= 4 && stem !== w ? [w, stem] : [w];
}

/** Wörter eines Namens ohne Titel, dazu ohne Flexionsendung. */
const strongWords = (s: string) => nameWords(s).filter((w) => w.length >= 3 && !WEAK_WORDS.has(w)).flatMap(wordForms);

/** Zwei gefaltete Wörter: gleich, Wortanfang («bullinger» ~ «bullingern») oder ab 4 Zeichen ein Zeichen Abstand. */
function similarFolded(x: string, y: string): boolean {
	if (x === y) return true;
	const [s, l] = x.length <= y.length ? [x, y] : [y, x];
	return s.length >= 4 && (l.startsWith(s) || editDistance(x, y) <= 1);
}

/** Teilt ein Name der GND ein Wort mit einer Schreibung der Edition? Gleich, Wortanfang
 *  («bullinger» ~ «bullingern») oder ab 4 Zeichen ein Zeichen Abstand – auch ohne
 *  Flexionsendung. */
export function sharesNameWord(gndNames: readonly string[], forms: readonly string[]): boolean {
	const a = new Set(gndNames.flatMap(strongWords));
	const b = new Set(forms.flatMap(strongWords));
	for (const x of a) for (const y of b) if (similarFolded(x, y)) return true;
	return false;
}

/** Sind zwei Namenswörter Schreibungen voneinander («Lafatern» ~ «Lavater», «Hainrich» ~ «Heinrich»)? */
function similarWord(a: string, b: string): boolean {
	const xs = wordForms(a);
	const ys = wordForms(b);
	return xs.some((x) => ys.some((y) => similarFolded(x, y)));
}

/** Ist eine Ortsform im Text eine Schreibung des Namens («Kyburch» zu «Kyburg»)? Nicht bei
 *  Gattungswörtern, die die Edition als Ort auszeichnet («land» für Mähren): Schlüssel höchstens
 *  40 % (mindestens 2 Zeichen) auseinander. */
export function isPlaceSpelling(name: string, form: string): boolean {
	const a = placeKey(name);
	const b = placeKey(form);
	return !!a && !!b && editDistance(a, b) <= Math.max(2, Math.round(Math.max(a.length, b.length) * 0.4));
}

/**
 * Ist eine Personenform eine Schreibung des ganzen Namens, mit Vor- und Nachnamen
 * («Růdolff Lavather» zu Rudolf Lavater, «Ludwigen Lafatern» zu Ludwig Lavater)? Die Form
 * braucht einen Vergleichsschlüssel (zwei Wörter nach Titeln und Ämtern), ihr letztes Wort
 * muss dem Nachnamen ähneln (mit gleichem Anfangsbuchstaben) und ein weiteres einem Vornamen.
 * Nicht: Nachname allein («Walthern»), Amt («dechan»), Satzteile («mitt Jacob», «schribt er»),
 * ein anderer Familienname («Růdolf Walter» für Gwalther: in RM nur Namensvettern).
 */
export function isPersonSpelling(name: string, form: string): boolean {
	const n = personKey(name)?.split(" ");
	const f = personKey(form)?.split(" ");
	if (!n || !f) return false;
	const nameRest = n.slice(0, -1).filter((w) => !WEAK_WORDS.has(w));
	const formRest = f.slice(0, -1).filter((w) => !WEAK_WORDS.has(w));
	const [ns, fs] = [n[n.length - 1], f[f.length - 1]];
	return ns[0] === fs[0] && similarWord(ns, fs) && formRest.some((w) => nameRest.some((v) => similarWord(v, w)));
}
