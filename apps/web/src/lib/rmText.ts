// Lesefassung der Ratsmanuale (RM) auf der Anfrage-Seite. Der Indexer schreibt
// in `body` die Lesefassung (docs/ratsmanuale-plan.md, E4), die Detailseite
// zeigt den diplomatischen Text. Damit ein Name oder Wort aus der Detailseite
// trifft, gleichen diese Funktionen die Anfrage an.
//
// rmSearchForm ist eine KOPIE von services/indexer/src/rmSearchForm.ts (das Web
// läuft ohne services/, der Docker-Build sieht nur apps/web). rmText.test.ts
// prüft sie gegen dieselben Golden-Vektoren (rmSearchForm.golden.json) – bei
// einer Änderung im Indexer hier nachziehen. Bewusst ohne Imports, damit der
// Unit-Test direkt mit `npx tsx --test` läuft und das Modul im Browser läuft.

// --- Kopie von services/indexer/src/rmSearchForm.ts --------------------------

const NASAL = new Set(["̄", "̅"]);
// kombinierende Zeichen ausser dem Trema U+0308
const COMB_RE = /[̀-̇̉-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const WORD_RE = /(?:\p{L}|[̀-ͯ])+/gu;
const SUPER_E_RE = /([aouAOU])ͤ/g;
const SS_RE = /(?<=\p{L})ß/gu;
const MARK_RE = /\p{Mn}/u;

const S = "̅+";
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
		out += NASAL.has(c) ? "̅" : lc.length === c.length ? lc : c;
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

/** Lesefassung (Suchtext) eines diplomatischen RM-Texts – identisch zum Indexer. */
export function rmSearchForm(text: string): string {
	let s = text.normalize("NFD");
	s = s.replace(WORD_RE, (w) => doubleNasals(w));
	s = s.replace(SUPER_E_RE, "$1̈");
	s = s.replace(COMB_RE, "");
	s = s.normalize("NFC");
	return s.replace(SS_RE, "ss");
}

// --- Anfrage-Seite -------------------------------------------------------------

/** ¬-Trennung am Zeilenende auflösen («Burger¬ meister» → «Burgermeister»); im
 *  Index ist sie über die TEI (`<lb break="no"/>`) schon aufgelöst. */
function joinBrokenWords(text: string): string {
	return text.replace(/¬\s*/g, "");
}

/**
 * Leichte Angleichung JEDER Suchanfrage an die RM-Lesefassung: nur ¬ und
 * Nasalstrich (Plan E4). Die übrigen Diakritika gleicht Meili selbst an
 * (Akzente zählen nicht), den Nasalstrich aber nicht als Doppelbuchstaben –
 * «kom̅en» würde zu «komen». ß bleibt: die übrigen Serien schreiben es
 * zeichengetreu. Ohne ¬ und Nasalstrich gibt die Funktion den String
 * unverändert zurück.
 */
export function foldRmQueryMarks(q: string): string {
	const nfd = q.normalize("NFD");
	if (!q.includes("¬") && ![...nfd].some((c) => NASAL.has(c))) return q;
	return joinBrokenWords(nfd)
		.replace(WORD_RE, (w) => doubleNasals(w))
		.normalize("NFC");
}

/**
 * Lesefassung eines diplomatischen RM-Textstücks (z. B. eines Namens aus der
 * Detailseite) für eine Phrasensuche in RM: ¬ aufgelöst, dann rmSearchForm,
 * Leerraum vereinheitlicht.
 */
export function rmReadingForm(text: string): string {
	return rmSearchForm(joinBrokenWords(text)).replace(/\s+/g, " ").trim();
}

// --- Editionen ---------------------------------------------------------------------

/**
 * Suchtext der Editionen (Index `editions`, Reiter «Editionen»): Frühneuhochdeutsch wie
 * die RM-Lesefassung (rmSearchForm: Nasalstrich über m/n als Doppelbuchstabe, uͤ → ü,
 * übrige kombinierende Zeichen weg – ů → u, uͦ → u –, ß → ss), dazu ohne weiche
 * Trennstriche (U+00AD, in QZH oft mitten im Wort: «­toüf­fer») und mit aufgelöster
 * ¬-Trennung. Der Aufbau (services/catalog, editionTei.ts) schreibt so den Suchtext, die
 * Suchseite gleicht damit im Reiter «Editionen» die Anfrage an; die Detailseite zeigt den
 * Text zeichengetreu. Hier statt in einem eigenen Modul, weil services/catalog die Datei
 * importiert (ohne Imports, wie entityKey.ts).
 */
export function editionSearchForm(text: string): string {
	return rmSearchForm(joinBrokenWords(text.replace(/­/g, "")));
}
