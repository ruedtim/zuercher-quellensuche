/**
 * Wortanfang-Lücke schliessen: Synonyme für die Beugungsformen, die Meili beim letzten
 * Suchwort abschneidet (Modus --patch-synonyms in main.ts). Pur, unit-getestet in
 * prefixSynonyms.test.ts.
 *
 * Meili ergänzt das LETZTE Suchwort um die Wörter, die mit ihm beginnen – ab 5 Zeichen aber
 * nur um die ersten 1'000 in Byte-Folge (milli `MAX_PREFIX_COUNT` in
 * `find_zero_typo_prefix_derivations`, v1.13.3 wie v1.57.0; Anfänge bis 4 Zeichen laufen über
 * die vollständige Prefix-Datenbank, Tippfehler-Varianten haben eine eigene Grenze). Bei Stämmen
 * mit vielen Zusammensetzungen fallen so gerade die Beugungsformen weg: vor «gemeinden» stehen
 * über 1'000 Wörter «gemeindea…» bis «gemeindem…»; auf Prod erreichte «Gemeinde» 5'645 der
 * 42'074 Dokumente, die nur «Gemeinden» enthalten (13 %), «Steuer» 3'630 von 11'225 «Steuern».
 *
 * Synonyme hängen an der genauen (normalisierten) Suchform und werden zusätzlich gesucht, genau
 * so – ohne Wortanfang und Tippfehler. Lokal mit Meili 1.57 geprüft (2026-11-17):
 * - Die abgeschnittenen Formen werden gefunden, als letztes Wort wie davor.
 * - Nicht in Anführungszeichen und nicht bei Ausschlüssen: «"gemeinde"» und «-gemeinde» bleiben
 *   genau. Die beiden Stufen der Trefferliste (apps/web tiers.ts) ergeben weiter genau die
 *   Treffer der Anfrage.
 * - Für die Regel `exactness` zählt ein Synonym nicht als genau: nach Relevanz stehen die genau
 *   geschriebenen Treffer weiter vorn.
 * - Ein Settings-Task mit 10'000 Schlüsseln dauert auf 120'000 Dokumenten 0,1 s (kein
 *   Neuaufbau, die Indexierung dauerte 91 s), die Suche wird nicht langsamer.
 * Nebenwirkung: Ein Synonym wirkt an jeder Stelle der Anfrage. Ein Wort, das NICHT am Schluss
 * steht, hat keinen Wortanfang; mit Synonym findet es auch die Formen der Liste (ab 7 Zeichen
 * fand es Formen mit einem Buchstaben mehr ohnehin über die Tippfehler-Toleranz).
 *
 * Der Wortschatz wird hier nachgebildet, wie ihn charabia 0.9 (Tokenizer von Meili) bildet:
 * getrennt an Satzzeichen (Unicode P*), mathematischen Zeichen (Sm), Leerraum (Z*), Tab und
 * Zeilenumbruch sowie «`»; dann NFKD, klein, ohne diakritische Zeichen (Mn), ohne übrige
 * Steuerzeichen, «æ»/«œ» → «ae»/«oe». «ß» bleibt (charabia faltet es nicht), camelCase wird
 * nicht getrennt (Meili baut charabia ohne `latin-camelcase`). Weicht der nachgebildete
 * Wortschatz ab, verschiebt sich der Rang einer Form ein wenig – darum nimmt die Liste eine
 * Form schon ab Rang `cap − margin` auf; eine Form, die Meili doch ergänzt hätte, schadet
 * als Synonym nicht.
 */

/** Höchstzahl der Wörter, um die Meili ein letztes Suchwort ergänzt (milli `MAX_PREFIX_COUNT`). */
export const MEILI_PREFIX_CAP = 1_000;

/** Kürzere Anfänge laufen über die vollständige Prefix-Datenbank (milli `max_prefix_length` 4). */
export const MIN_STEM_LENGTH = 5;

/** Sicherheitsabstand zur Grenze (Wortschatz nur nachgebildet, s. Dateikopf). */
export const DEFAULT_MARGIN = 100;

/**
 * Endungen, deren Formen gesucht werden: Plural und Kasus von Nomen und Adjektiven (Umlaute
 * fallen im Index weg, «Räte» = «rate», «Häuser» = «hauser»). Synonyme nur für Formen, die im
 * Index stehen und hinter der Grenze liegen.
 */
export const ENDINGS: readonly string[] = ["e", "n", "s", "en", "er", "es", "em", "ern", "ens"];

/** Meili höchstens 50 Synonym-Phrasen je Wort (milli `MAX_SYNONYM_PHRASE_COUNT`). */
const MAX_FORMS = 50;

// Trennzeichen wie charabia DEFAULT_SEPARATORS (Kategorien Pc Pd Pe Pf Pi Po Ps Sm Zl Zp Zs,
// dazu \t \n \r \0 und «`»). Andere Symbole (°, $, ^) bleiben Teil des Worts.
const SEPARATOR_CLASS = "\\p{P}\\p{Sm}\\p{Z}\\t\\n\\r\\0`";
// Übrige Steuerzeichen (Cc ohne \t \n \r \0): kein Trennzeichen, charabia löscht sie im Wort.
const CONTROL_RE = /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
const HAS_CONTROL_RE = /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const NON_ASCII_RE = /[^\x00-\x7f]/;
const MARK_RE = /\p{Mn}/gu;

/**
 * Text, wie Meili seine Wörter normalisiert (charabia, s. Dateikopf): Steuerzeichen weg, NFKD,
 * ohne diakritische Zeichen, klein, «æ»/«œ» → «ae»/«oe». Auf dem ganzen Text statt je Wort –
 * bis auf Sonderfälle wie «½» (NFKD «1⁄2» mit Bruchstrich, ein Trennzeichen) dasselbe, nur
 * schneller.
 */
export function normalizeMeiliText(text: string): string {
  let t = text;
  if (HAS_CONTROL_RE.test(t)) t = t.replace(CONTROL_RE, "");
  if (NON_ASCII_RE.test(t)) t = t.normalize("NFKD").replace(MARK_RE, "");
  t = t.toLowerCase();
  if (t.includes("æ") || t.includes("œ")) t = t.replace(/æ/g, "ae").replace(/œ/g, "oe");
  return t;
}

/** Ein Wort, wie Meili es im Index führt. */
export const normalizeMeiliWord = normalizeMeiliText;

const wordRe = (minLength: number) => new RegExp(`[^${SEPARATOR_CLASS}]{${minLength},}`, "gu");
const WORD_RES = new Map<number, RegExp>();

/**
 * Nimmt die Wörter eines Textes mit mindestens `minLength` Zeichen in den Wortschatz auf (nur
 * diese brauchen die Ränge: Stämme ab 5 Zeichen und ihre Fortsetzungen).
 */
export function addMeiliWords(text: string, vocab: Set<string>, minLength = MIN_STEM_LENGTH): void {
  if (!text) return;
  let re = WORD_RES.get(minLength);
  if (!re) WORD_RES.set(minLength, (re = wordRe(minLength)));
  for (const m of normalizeMeiliText(text).matchAll(re)) {
    const w = m[0];
    if (!vocab.has(w)) vocab.add(detach(w));
  }
}

/**
 * Kopie ohne Verweis auf den Ausgangstext: V8 führt Teilstrings ab 13 Zeichen als «sliced
 * string» auf dem ganzen Text – der Wortschatz hielte sonst jeden gelesenen Text im Speicher
 * (gemessen: 9,9 Mio. Wörter aus 924 MB Text 3,3 GB Heap statt 1,0 GB).
 */
function detach(w: string): string {
  return (" " + w).slice(1);
}

/** Erster Index in `sorted` ab `from` mit `sorted[i] >= key` (Byte-Folge = UTF-16-Folge in der BMP). */
function lowerBound(sorted: readonly string[], key: string, from = 0): number {
  let lo = from;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface PrefixGapOptions {
  /** Höchstzahl ergänzter Wörter (Default MEILI_PREFIX_CAP). */
  cap?: number;
  /** Formen schon ab Rang cap − margin aufnehmen (Default DEFAULT_MARGIN). */
  margin?: number;
  /** Kürzeste Stämme (Default MIN_STEM_LENGTH). */
  minStemLength?: number;
  endings?: readonly string[];
}

/** Ein Stamm mit seinen Formen hinter der Grenze und der Zahl seiner Fortsetzungen. */
export interface PrefixGap {
  stem: string;
  forms: string[];
  /** Wörter im Wortschatz, die mit dem Stamm beginnen (ohne ihn selbst). */
  extensions: number;
}

/**
 * Die Beugungsformen, die Meili beim letzten Suchwort abschneidet: je Wort `w` des Wortschatzes
 * (ab `minStemLength` Zeichen) die Formen `w + Endung`, die im Wortschatz stehen und deren Rang
 * unter den Fortsetzungen von `w` (0 = erste nach `w` in Byte-Folge) mindestens `cap − margin`
 * ist. `sorted` = Wortschatz ohne Dubletten, aufsteigend sortiert (Array.prototype.sort; für
 * Zeichen der BMP dieselbe Folge wie Meilis FST). Reihenfolge der Antwort = die von `sorted`.
 */
export function prefixGapSynonyms(sorted: readonly string[], opts: PrefixGapOptions = {}): PrefixGap[] {
  const cap = opts.cap ?? MEILI_PREFIX_CAP;
  const threshold = Math.max(0, cap - (opts.margin ?? DEFAULT_MARGIN));
  const minStem = opts.minStemLength ?? MIN_STEM_LENGTH;
  const endings = opts.endings ?? ENDINGS;
  const out: PrefixGap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.length < minStem) continue;
    // Die Fortsetzung mit Rang `threshold` steht bei i + 1 + threshold; fehlt sie, hat `w`
    // zu wenige Fortsetzungen, und keine Form kann hinter der Grenze liegen.
    const probe = sorted[i + 1 + threshold];
    if (probe === undefined || !probe.startsWith(w)) continue;
    const forms: string[] = [];
    for (const e of endings) {
      const f = w + e;
      const j = lowerBound(sorted, f, i + 1);
      if (sorted[j] === f && j - i - 1 >= threshold) forms.push(f);
    }
    if (forms.length === 0) continue;
    // Ende der Fortsetzungen: erstes Wort, das nicht mehr mit `w` beginnt.
    const end = lowerBound(sorted, w + "￿", i + 1);
    out.push({ stem: w, forms: forms.sort().slice(0, MAX_FORMS), extensions: end - i - 1 });
  }
  return out;
}

/** Die Liste als `synonyms`-Setting von Meili: Stamm → Formen, Schlüssel sortiert. */
export function toSynonymSetting(gaps: readonly PrefixGap[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of [...gaps].sort((a, b) => (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0))) {
    out[g.stem] = [...g.forms];
  }
  return out;
}

export interface SynonymDiff {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

/** Was ein Schreiben gegenüber den Synonymen des Index ändert (Formen ohne Reihenfolge verglichen). */
export function synonymDiff(current: Record<string, string[]>, next: Record<string, string[]>): SynonymDiff {
  const d: SynonymDiff = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const same = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((x, i) => x === sb[i]);
  };
  for (const [k, forms] of Object.entries(next)) {
    const cur = current[k];
    if (cur === undefined) d.added++;
    else if (same(cur, forms)) d.unchanged++;
    else d.changed++;
  }
  for (const k of Object.keys(current)) if (!(k in next)) d.removed++;
  return d;
}

/** True, wenn das Schreiben nichts ändern würde. */
export function synonymsUnchanged(d: SynonymDiff): boolean {
  return d.added === 0 && d.removed === 0 && d.changed === 0;
}
