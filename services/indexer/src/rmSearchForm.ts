/**
 * Lesefassung der Ratsmanuale (Plan E4): Suchtext (`body`) für Serie RM. Die
 * TEI und das gerenderte HTML bleiben diplomatisch.
 *
 * - Nasalstrich (U+0304/U+0305) über m/n wird zum Doppelbuchstaben
 *   (kom̅en → kommen), ausser in einer Liste von Formen, in denen er nur
 *   entfällt (Im̅e, Nam̅*, Sam̅stag*, Am̅t*, -sam̅e(n) …).
 * - Ein übergeschriebenes e über a/o/u wird zum Umlaut (uͤ → ü).
 * - Übrige diakritische Zeichen entfallen (uͦ → u, ū → u), nur das Trema bleibt.
 * - ß → ss nach einem Buchstaben; das Schilling-«ß.» bleibt.
 *
 * 1:1 zu services/rm-transkribus/rmtk/lese.py (Titel der Sitzungen); beide
 * prüfen rmSearchForm.golden.json.
 */

const NASAL = new Set(["\u0304", "\u0305"]);
// kombinierende Zeichen ausser dem Trema U+0308
const COMB_RE = /[\u0300-\u0307\u0309-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;
const WORD_RE = /(?:\p{L}|[\u0300-\u036f])+/gu;
const SUPER_E_RE = /([aouAOU])\u0364/g;
const SS_RE = /(?<=\p{L})ß/gu;
const MARK_RE = /\p{Mn}/u;

const S = "\u0305+";
const EXCEPTIONS: Array<[string, RegExp]> = [
  ["ime", new RegExp(`^im${S}e$`)],
  ["nam", new RegExp(`^nam${S}`)],
  ["innam", new RegExp(`^innam${S}`)],
  ["ihme", new RegExp(`^ihm${S}e$`)],
  ["deme", new RegExp(`^dem${S}e$`)],
  ["samstag", new RegExp(`^sam${S}b?s?tag`)],
  ["amt", new RegExp(`^am${S}t`)],
  ["samt", new RegExp(`^sam${S}t$`)],
  ["-same", new RegExp(`(?<=[\\p{L}\\p{N}_])sam${S}en?$`, "u")],
  ["montag", new RegExp(`^mon${S}tag`)],
  ["denen", new RegExp(`^den${S}en$`)],
  ["jenig", new RegExp(`jen${S}ig`)],
  ["ihne", new RegExp(`^ihn${S}en?$`)],
  ["demnach", new RegExp(`^dem${S}e?nach$`)],
  ["nachdeme", new RegExp(`^nachdem${S}e$`)],
  ["im", new RegExp(`^im${S}$`)],
  ["samtl", new RegExp(`^sam${S}tl`)],
  ["nemlich", new RegExp(`^nem${S}lich`)],
];
// Gegen-Ausnahme zu -sam̅e(n): «zusammen» und Verwandte behalten «mm».
const ZUSAMMEN_RE = new RegExp(`(?:zu|ze|zuo|z|by|bey|bei|bi|in|ein)sam${S}en?$`);

function key(word: string): string {
  let out = "";
  for (const c of word) {
    const lc = c.toLowerCase();
    out += NASAL.has(c) ? "\u0305" : lc.length === c.length ? lc : c;
  }
  return out;
}

function doubleNasals(word: string): string {
  if (![...word].some((c) => NASAL.has(c))) return word;
  const k = key(word);
  const drop = new Array<boolean>(word.length).fill(false);
  for (const [name, rx] of EXCEPTIONS) {
    const m = rx.exec(k);
    if (!m) continue;
    if (name === "-same" && ZUSAMMEN_RE.test(k)) continue;
    for (let i = m.index; i < m.index + m[0].length; i++) drop[i] = true;
  }
  const upper = word === word.toUpperCase() && word !== word.toLowerCase();
  let out = "";
  let i = 0;
  while (i < word.length) {
    const c = word[i];
    let j = i + 1;
    let marks = "";
    while (j < word.length && MARK_RE.test(word[j])) marks += word[j++];
    if ("mnMN".includes(c) && [...marks].some((x) => NASAL.has(x))) {
      const rest = [...marks].filter((x) => !NASAL.has(x)).join("");
      out += drop[i] ? c + rest : c + (upper ? c : c.toLowerCase()) + rest;
    } else {
      out += c + marks;
    }
    i = j;
  }
  return out;
}

export function rmSearchForm(text: string): string {
  let s = text.normalize("NFD");
  s = s.replace(WORD_RE, (w) => doubleNasals(w));
  s = s.replace(SUPER_E_RE, "$1\u0308");
  s = s.replace(COMB_RE, "");
  s = s.normalize("NFC");
  return s.replace(SS_RE, "ss");
}
