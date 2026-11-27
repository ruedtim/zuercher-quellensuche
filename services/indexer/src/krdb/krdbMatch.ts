// Abgleich der Named-Entity-Personen eines Kantonsratsprotokolls (KRP) mit der
// Kantonsratsdatenbank (KRDB, «Kantonsratsmitglieder ab 1803» von Staatsarchiv
// und Statistischem Amt).
//
// Pure und import-frei (kein $lib/$env): unit-getestet (krdbMatch.test.ts) und
// vom Register-Builder bzw. evaluate.ts in services/krdb per relativem Pfad
// importiert. Der Typ KrdbRegister ist die Single Source of Truth für das
// JSON-Schema von data/krdb-register.json.
//
// Zwei Ebenen: matchKrdbPersons gleicht eine Liste von Namensformen ab (die
// erkannten Personen eines Dokuments); matchKrdbDocument bestimmt zusätzlich,
// wen davon der Titel nennt, und liefert die Felder, die der Indexer in Meili
// schreibt (krdbIds/krdbTitleIds, Personenseiten) – ein einziger Abgleich für
// Detailseite und Index.
//
// Grundregel: Eine Personen-Nennung wird nur zugeordnet, wenn genau EIN
// Rats- bzw. Regierungsmitglied passt – Nachname (inkl. Allianz- und
// Partikelformen), verträgliche Vornamen/Initialen und ein Einsitz, der am
// Dokumentdatum aktiv war. Bleiben mehrere Kandidaten (oder ist der Nachname
// allein zu häufig), entscheiden nur harte Indizien aus demselben Dokument:
// ein voll aufgelöster Name, «Name - Ort», «Name (Partei, Ort)» oder eine
// Amtsbezeichnung davor. Sonst keine Zuordnung – lieber eine Person weniger
// als eine falsche.

// --- Register-Schema -------------------------------------------------------

/** Einsitz: [Rat, Eintritt, Austritt|null, Wahlkreis|null]; Datumsangaben
 *  als "YYYY", "YYYY-MM" oder "YYYY-MM-DD" (die KRDB ist nicht überall
 *  tagesgenau). Rat: "Kantonsrat" | "Grosser Rat" | "Regierungsrat" | "Kleiner Rat". */
export type KrdbSeat = [council: string, from: string, to: string | null, district: string | null];
/** Parteizugehörigkeit: [Partei, Fraktion|null, von|null, bis|null]. */
export type KrdbParty = [party: string, faction: string | null, from: string | null, to: string | null];
/** Wohnort: [Gemeinde, von|null, bis|null]. */
export type KrdbResidence = [place: string, from: string | null, to: string | null];

/** Porträt: aus Wikidata (P18) mit Bildnachweis von Wikimedia Commons oder –
 *  wo Commons keines hat – ein Fotoporträt aus dem Staatsarchiv-Bestand Z 1114
 *  (Tamedia, 1971–1999; services/krdb/src/z1114.ts). */
export interface KrdbImage {
	/** Commons-Vorschaubild (~250 px breit; lädt nur der Porträt-Proxy) bzw. bei
	 *  Z 1114 der Pfad des eigenen Zuschnitts (/portraits/z1114/….webp, statisch). */
	thumb: string;
	width: number;
	height: number;
	/** Commons-Dateiseite bzw. Katalogeintrag (Ziel des Bildnachweises). */
	page: string;
	/** Versions-Token (Hash der Thumb-URL bzw. des Bildes) – Cache-Busting. */
	v?: string;
	/** Urheber:in (Z 1114: Fotograf:in laut Katalog). */
	artist?: string;
	/** Quelle (Z 1114: «Staatsarchiv Zürich, <Signatur>»). */
	credit?: string;
	license?: string;
	licenseUrl?: string;
	/** Fehlt = Wikimedia Commons (P18 oder kuratiert); "z1114" = Staatsarchiv Zürich, Bestand Z 1114. */
	source?: "z1114";
}

/** Schlüssel eines Commons-Porträts im Proxy: die QID, ohne Wikidata-Item
 *  (kuratiertes Porträt) «K» + KRDB-ID. */
export function portraitKey(p: Pick<KrdbPerson, "id" | "qid">): string {
	return p.qid ?? `K${p.id}`;
}

/** Herkunft der Wikidata-Verknüpfung: P13468 (Kantonsrats-ID, kuratiert),
 *  exakter Treffer über eine Normdaten-ID der KRDB oder – p13468alt – ein Item
 *  mit veralteter P13468 (KRDB-ID neu vergeben), über Name + Geburtsdatum
 *  zugeordnet (services/krdb/src/stale.ts). */
export type KrdbQidVia = "p13468" | "gnd" | "hls" | "viaf" | "p13468alt";

export interface KrdbPerson {
	/** ID_PERSON_NEW der Live-KRDB (= Wikidata P13468). */
	id: number;
	last: string;
	first: string;
	sex?: "m" | "w";
	born?: number;
	died?: number;
	seats: KrdbSeat[];
	parties?: KrdbParty[];
	places?: KrdbResidence[];
	qid?: string;
	qidVia?: KrdbQidVia;
	img?: KrdbImage;
	/** Frühere IDs derselben Person: die KRDB vergibt `ID_PERSON_NEW` bei
	 *  Änderungen neu (services/krdb/src/aliases.ts hält sie fest). Alte
	 *  Personenseiten-URLs leiten auf die aktuelle ID um, und im Index noch unter
	 *  der alten ID geführte Dokumente bleiben auffindbar. */
	aliases?: number[];
}

export interface KrdbRegisterMeta {
	generatedAt: string;
	/** sha256 (gekürzt) über den Personen-Block – der Builder schreibt nur bei Änderung. */
	hash: string;
	source: string;
	persons: number;
	seats: number;
	withQid: number;
	withImage: number;
	/** Davon Fotoporträts aus Z 1114 (Personen ohne Commons-Porträt). */
	withZ1114?: number;
	/** Davon kuratierte Commons-Porträts (services/krdb/data/portrait-overrides.json). */
	withOverride?: number;
	qidVia: Partial<Record<KrdbQidVia, number>>;
}

export interface KrdbRegister {
	meta: KrdbRegisterMeta;
	persons: KrdbPerson[];
}

// --- Parameter ---------------------------------------------------------------

export interface KrdbMatchOptions {
	/** Toleranz um Ein-/Austritt (Vereidigung, Rücktritt, Nachruf kurz danach). */
	slackDays: number;
	/** Ein reiner Nachname mit mindestens so vielen KRDB-Personen braucht
	 *  zusätzliche Indizien (Meier, Keller, Müller …). */
	commonSurnameMin: number;
	/** Offene Einsitze (ohne Austritt), die vor diesem Jahr begannen, gelten
	 *  als Datenlücke und werden auf `openSeatMaxYears` gedeckelt. */
	openSeatCurrentFrom: number;
	openSeatMaxYears: number;
}

export const KRDB_MATCH_DEFAULTS: KrdbMatchOptions = {
	slackDays: 60,
	commonSurnameMin: 12,
	openSeatCurrentFrom: 1990,
	openSeatMaxYears: 12,
};

// --- Normalisierung ------------------------------------------------------------

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", æ: "ae", œ: "oe" };

/** Faltet Text für Vergleiche: klein, Diakritika weg, Umlaute ausgeschrieben
 *  (ä → ae) bzw. mit `umlauts: "strip"` nur ohne Punkte (ä → a – für OCR-/
 *  Schreibvarianten wie «Ruegg» ↔ «Rüegg»). Satzzeichen bleiben erhalten
 *  (Kontext-Suche braucht «-», «(», «,»). */
export function foldText(s: string, umlauts: "expand" | "strip" = "expand"): string {
	const lower = s.toLowerCase();
	return (umlauts === "expand" ? lower.replace(/[äöüßæœ]/g, (c) => UMLAUTS[c] ?? c) : lower.replace(/ß/g, "ss"))
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "");
}

/** Faltet einen Namen auf Tokens aus a–z und Bindestrich: Klammer-/OCR-Reste
 *  und Anführungszeichen verschwinden ohne Lücke («Neukom[m» → «neukomm»),
 *  übrige Zeichen werden Wortgrenzen («R.Meier» → «r meier»). */
export function foldName(s: string, umlauts: "expand" | "strip" = "expand"): string {
	// Trennstrich aus Zeilenumbruch («Löh- rer») – kleiner Buchstabe danach.
	return foldText(s.replace(/(\p{Ll})-\s+(\p{Ll})/gu, "$1$2"), umlauts)
		.replace(/[[\]{}|*'’‘`´"«»‹›“”„]/g, "")
		.replace(/[^a-z-]+/g, " ")
		.replace(/\s*-+\s*/g, "-")
		.replace(/(^|\s)-+|-+(?=\s|$)/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

/** Lose Faltung für historische Schreibvarianten (Caspar/Kaspar, Weydmann/
 *  Weidmann, Heß/Hess, Bosshard/Bosshart, Doppelkonsonanten). Nur für Vornamen und als
 *  Nachnamen-Fallback, wenn die exakte Faltung nichts findet. */
export function looseFold(folded: string): string {
	return folded
		.replace(/ph/g, "f")
		.replace(/th/g, "t")
		.replace(/ck/g, "k")
		.replace(/c(?=[aou])/g, "k")
		.replace(/y/g, "i")
		.replace(/dt/g, "t")
		.replace(/([a-z])d\b/g, "$1t")
		.replace(/tz/g, "z")
		.replace(/([a-z])\1+/g, "$1");
}

const PARTICLES = new Set(["von", "vom", "de", "zum", "zur", "am", "im", "van", "der"]);

// Titel und Funktionen, die NER mitunter in den Namen zieht; die Rolle zählt
// als Indiz (Regierung vs. Parlament).
const GOV_TITLES = new Set([
	"regierungsrat", "regierungsrath", "regierungsraetin", "regierungspraesident",
	"regierungspraesidentin", "statthalter", "buergermeister",
]);
const PARL_TITLES = new Set([
	"kantonsrat", "kantonsrath", "kantonsraetin", "kantonsraete", "ratspraesident",
	"ratspraesidentin", "grossrat", "grossrath",
]);
const OTHER_TITLES = new Set([
	"herr", "herrn", "hr", "frau", "fr", "fraeulein", "dr", "prof", "professor", "oberst",
	"oberstleutnant", "major", "hauptmann", "praesident", "praesidentin", "vizepraesident",
	"vizepraesidentin", "nationalrat", "nationalraetin", "staenderat", "staenderaetin",
	"stadtrat", "stadtraetin", "stadtpraesident", "stadtpraesidentin", "gemeindepraesident",
	"gemeindepraesidentin", "gemeindeammann", "pfarrer", "dekan", "alt", "sel", "selig",
	"lic", "phil", "iur", "jur", "med", "dipl", "ing", "sen", "jun", "junior", "senior",
	"sekretaer", "ratssekretaer", "ratssekretaerin", "direktor", "direktorin",
	"kollege", "kollega", "kollegin", "ratskollege", "ratskollegin",
]);

type Role = "gov" | "parl";

function titleRole(token: string): Role | null | undefined {
	if (GOV_TITLES.has(token) || /direktor(in)?$/.test(token)) return "gov";
	if (PARL_TITLES.has(token)) return "parl";
	if (OTHER_TITLES.has(token)) return null;
	return undefined; // kein Titel
}

// Abkürzungen und Kurzformen historischer Vornamen (lose gefaltet).
const GIVEN_ALIASES: Record<string, string[]> = {
	hch: ["heinrich"],
	hs: ["hans"],
	jb: ["jakob"],
	jak: ["jakob"],
	joh: ["johan", "johanes"],
	jos: ["josef", "josef"],
	wm: ["wilhelm"],
	wilh: ["wilhelm"],
	fr: ["friedrich", "franz", "friz"],
	frdr: ["friedrich"],
	ferd: ["ferdinand"],
	ed: ["eduard"],
	alb: ["albert"],
	alfr: ["alfred"],
	gotfr: ["gotfried"],
	gotl: ["gotlieb"],
	konr: ["konrad"],
	rud: ["rudolf"],
	ulr: ["ulrich"],
	chr: ["kristian", "kristof", "christian", "christof"],
	hans: ["johan", "johanes"],
	heiri: ["heinrich"],
	ruedi: ["rudolf"],
	koebi: ["jakob"],
	fritz: ["friedrich"],
	friz: ["friedrich"],
};

function givenTokens(name: string): string[] {
	return foldName(name)
		.split(/[\s-]+/)
		.filter(Boolean)
		.map(looseFold);
}

function tokenMatches(t: string, g: string): boolean {
	if (t.length === 1) return g.startsWith(t); // Initiale
	if (g === t) return true;
	if (t.length >= 3 && g.startsWith(t)) return true; // «Rud», «Hans» → «Hansjakob»
	const aliases = GIVEN_ALIASES[t];
	return !!aliases && aliases.some((a) => g === a || g.startsWith(a));
}

/** Vornamen einer Nennung passen zur KRDB-Person, wenn der erste passt und
 *  entweder alle passen oder die KRDB weniger Vornamen führt als die Nennung. */
function givenCompatible(doc: string[], krdb: string[]): boolean {
	if (doc.length === 0) return true;
	if (krdb.length === 0) return false;
	const hits = doc.map((t) => krdb.some((g) => tokenMatches(t, g)));
	if (!hits[0]) return false;
	return hits.every(Boolean) || krdb.length < doc.length;
}

// --- Datumslogik ------------------------------------------------------------

const DAY_MS = 86_400_000;
const PARTIAL_DATE = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/;

/** Erster Tag des (Teil-)Datums als Tageszahl seit 1970. */
export function dayStart(d: string | null | undefined): number | null {
	const m = d ? PARTIAL_DATE.exec(d) : null;
	if (!m) return null;
	return Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1) / DAY_MS;
}

/** Letzter Tag des (Teil-)Datums als Tageszahl seit 1970. */
export function dayEnd(d: string | null | undefined): number | null {
	const m = d ? PARTIAL_DATE.exec(d) : null;
	if (!m) return null;
	const y = Number(m[1]);
	if (m[3]) return Date.UTC(y, Number(m[2]) - 1, Number(m[3])) / DAY_MS;
	if (m[2]) return Date.UTC(y, Number(m[2]), 0) / DAY_MS;
	return Date.UTC(y, 11, 31) / DAY_MS;
}

// --- Index ------------------------------------------------------------------

interface Span {
	from: number;
	to: number;
	seat: KrdbSeat;
}

interface PlaceSpan {
	keys: string[];
	from: number;
	to: number;
}

interface IndexedPerson {
	p: KrdbPerson;
	given: string[];
	spans: Span[];
	places: PlaceSpan[];
	partyKeys: Array<{ key: string; from: number; to: number }>;
}

export interface KrdbIndex {
	opts: KrdbMatchOptions;
	persons: IndexedPerson[];
	bySurname: Map<string, number[]>;
	bySurnameLoose: Map<string, number[]>;
	givenFreq: Map<string, number>;
	placeKeys: Set<string>;
}

/** Ortsschlüssel: «Küsnacht (ZH)» → küsnacht; «Winterberg (Lindau)» →
 *  winterberg + lindau; «12. Wahlkreis (Uster)» → uster;
 *  «27. Wahlkreis Dübendorf-Volketswil» → duebendorf + volketswil. */
export function placeKeysOf(raw: string): string[] {
	const f = foldName(raw.replace(/\b\d+\.?\s*/g, " ").replace(/\bwahlkreis\b/gi, " "));
	const keys = new Set<string>();
	for (const part of f.split(/\s+/)) {
		if (part.length <= 2 || part === "stadt" || part === "land" || part === "kreis") continue;
		keys.add(part);
		for (const sub of part.split("-")) if (sub.length > 2) keys.add(sub);
	}
	const whole = f.replace(/\s*\bzh\b\s*/g, " ").trim();
	if (whole) keys.add(whole);
	return [...keys];
}

function addSurnameVariants(keys: Set<string>, f: string): void {
	if (!f) return;
	keys.add(f);
	const toks = f.split(" ");
	// «Wyss von» (KRDB-Schreibweise) ↔ «von Wyss» (Text).
	if (toks.length >= 2 && PARTICLES.has(toks[toks.length - 1])) {
		const particle = toks[toks.length - 1];
		const rest = toks.slice(0, -1).join(" ");
		keys.add(`${particle} ${rest}`);
		keys.add(rest);
	}
	// «von Orelli» → auch «orelli»; «Meyer von Knonau» → auch «meyer».
	if (toks.length >= 2 && PARTICLES.has(toks[0])) keys.add(toks.slice(1).join(" "));
	if (toks.length >= 2 && !PARTICLES.has(toks[0]) && toks[0].length > 2) keys.add(toks[0]);
	// Allianzname «Frey-Nägeli» → auch «frey» (Familienname vorne, nie der
	// zweite Teil: «Kern» soll nicht «Müller-Kern» treffen).
	const firstPart = toks[0].split("-")[0];
	if (firstPart !== toks[0] && firstPart.length > 2) keys.add(firstPart);
}

/** Nachnamen-Schlüssel einer KRDB-Person. Klammern: «Escher (v. Glas)» ist
 *  ein Familienzweig (zusätzlich «escher von glas» usw.), «Häusser (Heusser)»
 *  eine Schreibvariante (eigener Schlüssel). «Mestral, de» → «de mestral».
 *  Jede Form doppelt gefaltet: Umlaute ausgeschrieben und ohne Punkte. */
export function surnameKeys(last: string): string[] {
	const names: string[] = [];
	let base = last.trim();
	const paren = /^(.*?)\s*\(([^()]*)\)\s*(.*)$/.exec(base);
	if (paren) {
		base = `${paren[1]} ${paren[3]}`.trim();
		const inner = paren[2].trim();
		const qualifier = /^(?:v\.?|von|vom)\s+(.+)$/i.exec(inner);
		if (qualifier) {
			for (const particle of ["von", "vom", "v"]) names.push(`${base} ${particle} ${qualifier[1]}`);
		} else if (inner) {
			names.push(inner);
		}
	}
	const comma = /^(.*?),\s*(\S+)$/.exec(base);
	if (comma && PARTICLES.has(foldName(comma[2]))) base = `${comma[2]} ${comma[1]}`;
	names.unshift(base);
	const keys = new Set<string>();
	for (const name of names) {
		addSurnameVariants(keys, foldName(name));
		addSurnameVariants(keys, foldName(name, "strip"));
	}
	return [...keys];
}

/** Anzeigeform des Nachnamens: «Euw von» → «von Euw», «Mestral, de» → «de Mestral». */
export function displayLastName(last: string): string {
	const t = last.trim().replace(/\s+/g, " ");
	const comma = /^(.*?),\s*(de|von|vom|van|di|da)$/i.exec(t);
	if (comma) return `${comma[2]} ${comma[1]}`;
	const trail = /^(.*\S)\s+(von|vom|de|van)$/i.exec(t);
	if (trail) return `${trail[2]} ${trail[1]}`;
	return t;
}

function pushTo(map: Map<string, number[]>, key: string, i: number): void {
	const arr = map.get(key);
	if (!arr) map.set(key, [i]);
	else if (arr[arr.length - 1] !== i) arr.push(i);
}

function seatSpan(seat: KrdbSeat, p: KrdbPerson, opts: KrdbMatchOptions): Span | null {
	const from = dayStart(seat[1]);
	if (from == null) return null;
	let to = dayEnd(seat[2]);
	if (to == null) {
		const fromYear = Number(seat[1].slice(0, 4));
		if (p.died) to = dayEnd(String(p.died));
		else if (fromYear >= opts.openSeatCurrentFrom) to = Number.POSITIVE_INFINITY;
		else to = dayEnd(String(fromYear + opts.openSeatMaxYears));
	}
	return to == null ? null : { from, to, seat };
}

export function buildKrdbIndex(register: KrdbRegister, options: Partial<KrdbMatchOptions> = {}): KrdbIndex {
	const opts = { ...KRDB_MATCH_DEFAULTS, ...options };
	const persons: IndexedPerson[] = [];
	const bySurname = new Map<string, number[]>();
	const bySurnameLoose = new Map<string, number[]>();
	const givenFreq = new Map<string, number>();
	const placeKeys = new Set<string>();

	register.persons.forEach((p, i) => {
		const given = givenTokens(p.first);
		for (const g of new Set(given)) givenFreq.set(g, (givenFreq.get(g) ?? 0) + 1);
		const spans = p.seats.map((s) => seatSpan(s, p, opts)).filter((s): s is Span => s !== null);
		const places: PlaceSpan[] = [];
		for (const [place, from, to] of p.places ?? []) {
			const keys = placeKeysOf(place);
			keys.forEach((k) => placeKeys.add(k));
			places.push({ keys, from: dayStart(from) ?? -Infinity, to: dayEnd(to) ?? Infinity });
		}
		for (const s of spans) {
			// «Grosser Rat (Kooptation)», «Zünfte und Los» sind keine Orte.
			if (!s.seat[3] || !/wahlkreis/i.test(s.seat[3])) continue;
			const keys = placeKeysOf(s.seat[3]);
			keys.forEach((k) => placeKeys.add(k));
			places.push({ keys, from: s.from, to: s.to });
		}
		const partyKeys = (p.parties ?? [])
			.filter(([party]) => party.trim() !== "")
			.flatMap(([party, faction, from, to]) =>
				[party, faction]
					.filter((x): x is string => !!x)
					.map((x) => ({ key: foldName(x), from: dayStart(from) ?? -Infinity, to: dayEnd(to) ?? Infinity })),
			);
		persons.push({ p, given, spans, places, partyKeys });
		for (const k of surnameKeys(p.last)) {
			pushTo(bySurname, k, i);
			pushTo(bySurnameLoose, looseFold(k), i);
		}
	});
	return { opts, persons, bySurname, bySurnameLoose, givenFreq, placeKeys };
}

// --- Nennungen zerlegen -------------------------------------------------------

interface NameOption {
	key: string;
	loose: boolean;
	given: string[];
}

interface Mention {
	form: string;
	options: NameOption[];
	place: string | null;
	party: string | null;
	role: Role | null;
}

function looksLikeGiven(index: KrdbIndex, segment: string): boolean {
	const toks = foldName(segment).split(/[\s-]+/).filter(Boolean);
	if (toks.length === 0 || toks.length > 4) return false;
	return toks.every((t) => t.length === 1 || index.givenFreq.has(looseFold(t)) || !!GIVEN_ALIASES[looseFold(t)]);
}

/** «A, B & C» / «Neukom, Albert» / «Meier und Keller» → einzelne Namen. */
function splitNames(index: KrdbIndex, raw: string): string[] {
	const out: string[] = [];
	for (const part of raw.split(/\s*(?:&|;|\/|\bund\b|\bu\.\s)\s*/)) {
		if (!part.trim()) continue;
		// «Welti (SVP, Küsnacht)»: Komma in Klammern trennt keine Namen.
		if (part.includes("(")) {
			out.push(part);
			continue;
		}
		const segs = part.split(/\s*,\s*/).filter(Boolean);
		if (segs.length === 2 && looksLikeGiven(index, segs[1])) out.push(`${segs[1]} ${segs[0]}`);
		else out.push(...segs);
	}
	return out;
}

function parseName(index: KrdbIndex, form: string, raw: string): Mention | null {
	let name = raw.trim();
	let place: string | null = null;
	let party: string | null = null;
	// «Walther - Dübendorf»
	const dash = /^(.*?\S)\s+[-–]\s+(\S.*)$/.exec(name);
	if (dash) {
		name = dash[1];
		place = dash[2];
	}
	// «Welti (SVP, Küsnacht)» / «Meier (Zürich)»
	const paren = /^(.*?)\s*\(([^()]*)\)?\s*$/.exec(name);
	if (paren && paren[1].trim()) {
		name = paren[1];
		const segs = paren[2].split(",").map((x) => x.trim()).filter(Boolean);
		if (segs.length >= 2) party = segs[0];
		if (segs.length) place = segs[segs.length - 1];
	}
	let toks = foldName(name).split(" ").filter(Boolean);
	let role: Role | null = null;
	toks = toks.filter((t) => {
		const r = titleRole(t);
		if (r === undefined) return true;
		if (r) role = r;
		return false;
	});
	// «Moser in Oerlingen», «Weidmann v. Niederweningen» («v» nur vor einem
	// bekannten Ort – sonst ist es eine Initiale wie in «Hans V. Meier»).
	const inIdx = toks.findIndex(
		(t, i) =>
			i > 0 &&
			(t === "in" || t === "aus" || (t === "v" && index.placeKeys.has(toks.slice(i + 1).join(" ")))),
	);
	if (inIdx > 0) {
		place = place ?? toks.slice(inIdx + 1).join(" ");
		toks = toks.slice(0, inIdx);
	}
	const vonIdx = toks.findIndex((t, i) => i > 0 && t === "von");
	if (vonIdx > 0) {
		const after = toks.slice(vonIdx + 1).join(" ");
		const asSurname = toks.slice(vonIdx - 1).join(" ");
		if (index.placeKeys.has(after) && !index.bySurname.has(asSurname) && !index.bySurname.has(toks.slice(vonIdx).join(" "))) {
			place = place ?? after;
			toks = toks.slice(0, vonIdx);
		}
	}
	if (toks.length === 0) return null;

	const options: NameOption[] = [];
	const n = toks.length;
	for (let k = Math.min(3, n); k >= 1; k--) {
		const key = toks.slice(n - k).join(" ");
		const given = toks.slice(0, n - k).flatMap((t) => t.split("-")).map(looseFold);
		if (index.bySurname.has(key)) options.push({ key, loose: false, given });
	}
	// «Bopp Jacques», «Schinz Hans» (Namenslisten ohne Komma): Nachname vorne,
	// wenn der Rest nur aus Vornamen/Initialen besteht. Vorrang, falls der
	// letzte Token kein Nachname ist oder eindeutig wie ein Vorname aussieht.
	if (n >= 2) {
		for (let k = Math.min(3, n - 1); k >= 1; k--) {
			const key = toks.slice(0, k).join(" ");
			const rest = toks.slice(k);
			if (!index.bySurname.has(key) || !looksLikeGiven(index, rest.join(" "))) continue;
			const inverted = { key, loose: false, given: rest.flatMap((t) => t.split("-")).map(looseFold) };
			const lastIsGiven = index.givenFreq.has(looseFold(toks[n - 1])) || toks[n - 1].length === 1;
			if (options.length === 0 || lastIsGiven) options.unshift(inverted);
			else options.push(inverted);
			break;
		}
	}
	const last = toks[n - 1];
	const given = toks.slice(0, n - 1).flatMap((t) => t.split("-")).map(looseFold);
	if (options.length === 0) {
		// «Meier-Zürich»: Name plus Ort in einem Token.
		const hy = /^([a-z]+)-([a-z-]+)$/.exec(last);
		if (hy && index.placeKeys.has(hy[2]) && index.bySurname.has(hy[1])) {
			options.push({ key: hy[1], loose: false, given });
			place = place ?? hy[2];
		}
	}
	if (options.length === 0 && last.length > 3 && last.endsWith("s") && index.bySurname.has(last.slice(0, -1))) {
		options.push({ key: last.slice(0, -1), loose: false, given }); // Genitiv «Walthers»
	}
	if (options.length === 0 && index.bySurnameLoose.has(looseFold(last))) {
		options.push({ key: looseFold(last), loose: true, given });
	}
	if (options.length === 0) return null;
	return { form, options, place, party, role };
}

// --- Abgleich -----------------------------------------------------------------

export interface KrdbMatchInput {
	persons: readonly string[] | null | undefined;
	date: string | null | undefined;
	title?: string | null;
	body?: string | null;
}

/** Stärke der Evidenz: name = Vorname/Initiale passt; surname = eindeutiger
 *  seltener Nachname; context = Ort/Partei/Amt im Dokument; coref = derselbe
 *  Nachname ist im Dokument schon voll aufgelöst. */
export type KrdbMatchVia = "name" | "surname" | "context" | "coref";

export interface KrdbMatch {
	person: KrdbPerson;
	forms: string[];
	via: KrdbMatchVia;
	seat: KrdbSeat | null;
	party: string | null;
}

const VIA_RANK: Record<KrdbMatchVia, number> = { name: 4, context: 3, coref: 2, surname: 1 };

function activeAt(ip: IndexedPerson, day: number, slack: number): boolean {
	return ip.spans.some((s) => s.from - slack <= day && day <= s.to + slack);
}

function placeMatches(ip: IndexedPerson, placeText: string, day: number): boolean {
	const toks = foldName(placeText).split(" ").filter(Boolean);
	if (toks.length === 0) return false;
	const probes = new Set<string>();
	for (let k = 1; k <= Math.min(3, toks.length); k++) probes.add(toks.slice(0, k).join(" "));
	for (const t of toks) for (const sub of t.split("-")) probes.add(sub);
	return ip.places.some(
		(pl) => pl.from - 366 <= day && day <= pl.to + 366 && pl.keys.some((k) => probes.has(k)),
	);
}

function partyMatches(ip: IndexedPerson, partyText: string, day: number): boolean {
	const key = foldName(partyText);
	if (!key) return false;
	return ip.partyKeys.some((pk) => pk.from - 366 <= day && day <= pk.to + 366 && pk.key === key);
}

function roleMatches(ip: IndexedPerson, role: Role, day: number, slack: number): boolean {
	return ip.spans.some((s) => {
		if (!(s.from - slack <= day && day <= s.to + slack)) return false;
		const gov = s.seat[0] === "Regierungsrat" || s.seat[0] === "Kleiner Rat";
		return role === "gov" ? gov : !gov;
	});
}

interface Evidence {
	places: string[];
	parties: string[];
	roles: Set<Role>;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sucht den Nachnamen im gefalteten Dokumenttext und sammelt Indizien aus
 *  der unmittelbaren Umgebung jeder Fundstelle. */
function collectEvidence(index: KrdbIndex, text: string, key: string): Evidence {
	const ev: Evidence = { places: [], parties: [], roles: new Set() };
	const re = new RegExp(`(?<![a-z])${escapeRe(key).replace(/ /g, "\\s+")}(?![a-z])`, "g");
	let m: RegExpExecArray | null;
	let seen = 0;
	while ((m = re.exec(text)) && seen++ < 40) {
		const after = text.slice(m.index + m[0].length, m.index + m[0].length + 70);
		const dash = /^\s*[-–]\s*([a-z][a-z .-]{1,40})/.exec(after);
		if (dash) ev.places.push(dash[1]);
		const paren = /^\s*\(([^()]{1,60})\)/.exec(after);
		if (paren) {
			const segs = paren[1].split(",").map((x) => x.trim()).filter(Boolean);
			if (segs.length >= 2) ev.parties.push(segs[0]);
			if (segs.length) ev.places.push(segs[segs.length - 1]);
		}
		const prep = /^\s+(?:in|von|v\.|aus)\s+([a-z][a-z .-]{1,40})/.exec(after);
		if (prep) ev.places.push(prep[1]);
		// Amtsbezeichnung davor, dazwischen nur Titel, Initialen und Vornamen.
		const before = text.slice(Math.max(0, m.index - 80), m.index);
		const btoks = foldName(before).split(" ").filter(Boolean);
		for (let i = btoks.length - 1, steps = 0; i >= 0 && steps < 5; i--, steps++) {
			const t = btoks[i];
			const r = titleRole(t);
			if (r) {
				ev.roles.add(r);
				break;
			}
			if (r === null || t.length === 1 || index.givenFreq.has(looseFold(t))) continue;
			break;
		}
	}
	return ev;
}

function evidenceScore(ip: IndexedPerson, ev: Evidence, day: number, slack: number): number {
	let score = 0;
	if (ev.places.some((pl) => placeMatches(ip, pl, day))) score++;
	if (ev.parties.some((pa) => partyMatches(ip, pa, day))) score++;
	for (const r of ev.roles) if (roleMatches(ip, r, day, slack)) score++;
	return score;
}

/** Wählt unter Kandidaten den einzigen mit der höchsten positiven Punktzahl. */
function pickByEvidence(index: KrdbIndex, cands: number[], ev: Evidence, day: number): number | null {
	let best = -1;
	let bestScore = 0;
	let tie = false;
	for (const c of cands) {
		const s = evidenceScore(index.persons[c], ev, day, index.opts.slackDays);
		if (s > bestScore) {
			best = c;
			bestScore = s;
			tie = false;
		} else if (s === bestScore && s > 0) tie = true;
	}
	return bestScore > 0 && !tie ? best : null;
}

function seatAt(ip: IndexedPerson, day: number, slack: number): KrdbSeat | null {
	let best: Span | null = null;
	for (const s of ip.spans) {
		if (s.from - slack <= day && day <= s.to + slack && (!best || s.from > best.from)) best = s;
	}
	return best?.seat ?? null;
}

/** Partei am Datum (sonst die letzte davor); leere Einträge (vor 1917 häufig) zählen nicht. */
export function partyAt(p: KrdbPerson, date: string | null | undefined): string | null {
	const day = dayStart(date);
	if (day == null) return null;
	let covering: string | null = null;
	let before: { party: string; to: number } | null = null;
	for (const [party, , from, to] of p.parties ?? []) {
		if (!party.trim()) continue;
		const f = dayStart(from) ?? -Infinity;
		const t = dayEnd(to) ?? Infinity;
		if (f - 366 <= day && day <= t + 366) covering = party;
		else if (t < day && (!before || t > before.to)) before = { party, to: t };
	}
	return covering ?? before?.party ?? null;
}

interface Pending {
	mention: Mention;
	cands: number[];
	key: string;
}

export function matchKrdbPersons(index: KrdbIndex, input: KrdbMatchInput): KrdbMatch[] {
	const day = dayStart(input.date);
	if (day == null || !input.persons || input.persons.length === 0) return [];
	const { slackDays, commonSurnameMin } = index.opts;

	const matched = new Map<number, { forms: Set<string>; via: KrdbMatchVia }>();
	const accept = (i: number, form: string, via: KrdbMatchVia) => {
		const cur = matched.get(i);
		if (!cur) matched.set(i, { forms: new Set([form]), via });
		else {
			cur.forms.add(form);
			if (VIA_RANK[via] > VIA_RANK[cur.via]) cur.via = via;
		}
	};
	const pending: Pending[] = [];

	// 1) Nennungen zerlegen, Kandidaten bestimmen (aktiv am Datum, Vornamen
	//    verträglich, Hinweise aus der Nennung selbst).
	interface Resolved {
		mention: Mention;
		opt: NameOption;
		cands: number[];
		hinted: boolean;
	}
	const resolved: Resolved[] = [];
	// Vornamen der volleren Formen je Nachnamen-Schlüssel – auch ohne Kandidat:
	// steht «Hans Keller» im Dokument und ist nur Kaspar Keller aktiv, darf
	// ein nacktes «Keller» nicht still auf Kaspar fallen.
	const fullerGiven = new Map<string, string[][]>();
	for (const form of new Set(input.persons)) {
		for (const raw of splitNames(index, form)) {
			const mention = parseName(index, form, raw);
			if (!mention) continue;
			for (const o of mention.options) {
				if (o.given.length > 0) fullerGiven.set(o.key, [...(fullerGiven.get(o.key) ?? []), o.given]);
			}
			for (const opt of mention.options) {
				const ids = (opt.loose ? index.bySurnameLoose : index.bySurname).get(opt.key) ?? [];
				let cands = ids.filter((i) => {
					const ip = index.persons[i];
					return activeAt(ip, day, slackDays) && givenCompatible(opt.given, ip.given);
				});
				if (cands.length === 0) continue;
				// Hinweise aus der Nennung selbst («- Ort», «(Partei, Ort)», Titel)
				// schränken ein; wer ihnen widerspricht, fällt raus.
				let hinted = false;
				if (mention.place || mention.party || mention.role) {
					const ev: Evidence = {
						places: mention.place ? [mention.place] : [],
						parties: mention.party ? [mention.party] : [],
						roles: new Set(mention.role ? [mention.role] : []),
					};
					const scored = cands.filter((c) => evidenceScore(index.persons[c], ev, day, slackDays) > 0);
					if (scored.length > 0) {
						cands = scored;
						hinted = true;
					}
				}
				resolved.push({ mention, opt, cands, hinted });
				break; // längste passende Nachnamen-Variante gewinnt
			}
		}
	}

	// 2) Eindeutige Treffer übernehmen; ein nackter Nachname braucht Indizien,
	//    wenn er häufig ist, eher ein Vorname ist (Ernst, Walther, Thomas), nur
	//    lose passt oder einer volleren Form im Dokument widerspricht.
	for (const { mention, opt, cands, hinted } of resolved) {
		const hasGiven = opt.given.length > 0;
		const surnameFreq = (opt.loose ? index.bySurnameLoose : index.bySurname).get(opt.key)?.length ?? 0;
		const givenFreq = index.givenFreq.get(looseFold(opt.key)) ?? 0;
		const conflictingFuller =
			!hasGiven &&
			cands.length === 1 &&
			(fullerGiven.get(opt.key) ?? []).some((g) => !givenCompatible(g, index.persons[cands[0]].given));
		const guarded =
			!hasGiven &&
			!hinted &&
			(surnameFreq >= commonSurnameMin ||
				(givenFreq >= 3 && givenFreq >= surnameFreq) ||
				opt.loose ||
				conflictingFuller);
		if (cands.length === 1 && !guarded) {
			accept(cands[0], mention.form, hasGiven ? "name" : hinted ? "context" : "surname");
		} else {
			pending.push({ mention, cands, key: opt.key });
		}
	}

	if (pending.length > 0) {
		// Koreferenz: derselbe Nachname ist im Dokument schon eindeutig aufgelöst.
		const unresolved: Pending[] = [];
		for (const pe of pending) {
			const known = pe.cands.filter((c) => matched.has(c));
			if (known.length === 1) accept(known[0], pe.mention.form, "coref");
			else unresolved.push(pe);
		}
		// Kontext im Dokument: «Name - Ort», «Name (Partei, Ort)», Amt davor.
		if (unresolved.length > 0 && (input.title || input.body)) {
			const text = foldText(`${input.title ?? ""}\n${input.body ?? ""}`);
			const evCache = new Map<string, Evidence>();
			for (const pe of unresolved) {
				if (pe.mention.options.every((o) => o.loose)) continue;
				let ev = evCache.get(pe.key);
				if (!ev) {
					ev = collectEvidence(index, text, pe.key);
					evCache.set(pe.key, ev);
				}
				const pick = pickByEvidence(index, pe.cands, ev, day);
				if (pick != null) accept(pick, pe.mention.form, "context");
			}
		}
	}

	const out: KrdbMatch[] = [];
	for (const [i, m] of matched) {
		const ip = index.persons[i];
		out.push({
			person: ip.p,
			forms: [...m.forms],
			via: m.via,
			seat: seatAt(ip, day, slackDays),
			party: partyAt(ip.p, input.date),
		});
	}
	out.sort(
		(a, b) =>
			a.person.last.localeCompare(b.person.last, "de") ||
			a.person.first.localeCompare(b.person.first, "de") ||
			a.person.id - b.person.id,
	);
	return out;
}

// --- Dokument-Abgleich: erkannte Personen, Nennung im Titel -------------------

/** Eingabe für den Abgleich eines ganzen Dokuments (wie matchKrdbPersons). */
export type KrdbDocInput = KrdbMatchInput;

export interface KrdbDocMatch {
	/** Zugeordnete Personen (= matchKrdbPersons). */
	matches: KrdbMatch[];
	/** IDs der Personen, die im Titel selbst genannt sind (Vorstösse, Anträge), aufsteigend. */
	titleIds: number[];
}

/** Faltung für den Vergleich mit dem Titel: «Gnehm - Horgen» trennt wie ein
 *  Leerzeichen (foldName zöge es zu «gnehm-horgen» zusammen). */
function foldForTitle(s: string): string {
	return foldName(s.replace(/\s+[-–]+\s+/g, " "));
}

/** Abschnittsgrenze im Titel (Komma, runde Klammer, Semikolon): «Oetwil a. S., Max
 *  Keller» – «a. S.» sind keine Initialen von Keller. Eckige Klammern trennen nicht
 *  (editorische Ergänzung «[Hans] Meier»). */
const TITLE_SEP = "|";

/** Vornamen/Initialen direkt vor Token `end` im selben Abschnitt (höchstens drei,
 *  «Hans-Peter» zählt einfach). Als Vorname gilt, was die KRDB als Vornamen führt. */
function givenBefore(index: KrdbIndex, toks: string[], end: number): string[] {
	const out: string[] = [];
	for (let j = end - 1; j >= 0 && end - j <= 3 && toks[j] !== TITLE_SEP; j--) {
		const parts = toks[j].split("-").map(looseFold);
		if (!parts.every((t) => t.length === 1 || index.givenFreq.has(t) || !!GIVEN_ALIASES[t])) break;
		out.unshift(...parts);
	}
	return out;
}

/**
 * IDs der zugeordneten Personen, die der Titel nennt – der Titel fügt keine
 * Personen hinzu, er zeigt nur, wer davon dort steht:
 *  - Nachname mit Vornamen bzw. Initiale davor: der Vorname muss passen, und unter
 *    den zugeordneten Personen nur eine («Interpellation Dr. Willy Hochuli - Uster»,
 *    im Text nur «W. Hochuli»; nicht «Einzelinitiative Bernhard Wehrli» für den
 *    Kantonsrat Martin Wehrli);
 *  - Nachname ohne Vornamen («Herr Statthalter Billeter», «Motion Gnehm - Horgen»):
 *    eine erkannte Form steht im Titel und führt dort für sich allein – ohne
 *    Koreferenz oder Indizien aus dem Text – auf dieselbe Person. Steht direkt davor
 *    ein anderer Nachname, ist es ein Doppelname («Leana Reich Isler» ist nicht der
 *    Kantonsrat René Isler).
 */
function titleIdsOf(index: KrdbIndex, matches: KrdbMatch[], input: KrdbDocInput): number[] {
	const title = input.title ?? "";
	const toks = title.split(/[,;()]/).flatMap((part) => [TITLE_SEP, ...foldForTitle(part).split(" ").filter(Boolean)]);
	const cands = matches.map((m) => ({
		id: m.person.id,
		given: givenTokens(m.person.first),
		keys: surnameKeys(m.person.last).map((k) => k.split(" ")),
	}));
	const ids = new Set<number>();
	const bare = new Set<number>();
	for (let i = 0; i < toks.length; i++) {
		const named = new Set<number>();
		for (const c of cands) {
			if (!c.keys.some((kt) => kt.every((t, j) => toks[i + j] === t))) continue;
			const given = givenBefore(index, toks, i);
			if (given.length > 0) {
				if (givenCompatible(given, c.given)) named.add(c.id);
			} else if (!index.bySurname.has(toks[i - 1])) bare.add(c.id);
		}
		if (named.size === 1) ids.add([...named][0]);
	}

	const padded = ` ${foldForTitle(title)} `;
	const bareForms = [...new Set(matches.filter((m) => bare.has(m.person.id) && !ids.has(m.person.id)).flatMap((m) => m.forms))]
		.filter((f) => {
			const ff = foldForTitle(f);
			return ff !== "" && padded.includes(` ${ff} `);
		});
	if (bareForms.length > 0) {
		const formsOf = new Map(matches.map((m) => [m.person.id, new Set(m.forms)]));
		for (const m of matchKrdbPersons(index, { persons: bareForms, date: input.date, title })) {
			if (bare.has(m.person.id) && m.forms.some((f) => formsOf.get(m.person.id)?.has(f))) ids.add(m.person.id);
		}
	}
	return [...ids].sort((a, b) => a - b);
}

/**
 * Abgleich eines ganzen Dokuments: die erkannten Personen wie matchKrdbPersons,
 * dazu `titleIds` – die Personen, die der Titel selbst nennt (Urheber:in eines
 * Vorstosses, Antragsteller:in), nicht nur der Text.
 */
export function matchKrdbDocument(index: KrdbIndex, input: KrdbDocInput): KrdbDocMatch {
	const matches = matchKrdbPersons(index, input);
	if (matches.length === 0 || !input.title) return { matches, titleIds: [] };
	return { matches, titleIds: titleIdsOf(index, matches, input) };
}

/** Felder, die der Indexer an KRP-Dokumente schreibt (Meili: filterable). */
export interface KrdbIndexFields {
	/** Alle zugeordneten Personen (KRDB-IDs), aufsteigend. */
	krdbIds: number[];
	/** Davon im Titel genannt, aufsteigend. */
	krdbTitleIds: number[];
}

export function krdbIndexFields(index: KrdbIndex, input: KrdbDocInput): KrdbIndexFields {
	const { matches, titleIds } = matchKrdbDocument(index, input);
	return {
		krdbIds: matches.map((m) => m.person.id).sort((a, b) => a - b),
		krdbTitleIds: titleIds,
	};
}

// --- Anzeige ------------------------------------------------------------------

export interface KrdbPortraitView {
	src: string;
	/** Herkunft – bestimmt die Form des Bildnachweises. */
	source: "commons" | "z1114";
	width: number;
	height: number;
	page: string;
	credit: string | null;
	license: string | null;
	licenseUrl: string | null;
}

export interface KrdbPersonView {
	id: number;
	name: string;
	/** Surface-Forms im Dokument («R. Meier»). */
	forms: string[];
	lifespan: string | null;
	role: string | null;
	krdbUrl: string;
	qid: string | null;
	wikidataUrl: string | null;
	portrait: KrdbPortraitView | null;
}

export const KRDB_PERSON_URL = "https://www.web.statistik.zh.ch/webapp/KRRRPublic/app?id=";

export function councilLabel(council: string, sex: KrdbPerson["sex"]): string {
	const w = sex === "w";
	switch (council) {
		case "Kantonsrat":
			return w ? "Kantonsrätin" : "Kantonsrat";
		case "Regierungsrat":
			return w ? "Regierungsrätin" : "Regierungsrat";
		case "Grosser Rat":
			return "Mitglied des Grossen Rats";
		case "Kleiner Rat":
			return "Mitglied des Kleinen Rats";
		default:
			return council;
	}
}

/** Lebensdaten nur für Verstorbene bzw. Geburtsjahre vor über 100 Jahren –
 *  keine Geburtsjahre lebender Personen auf der Seite. */
export function lifespanOf(p: KrdbPerson, nowYear: number): string | null {
	if (p.died) return p.born ? `${p.born}–${p.died}` : `† ${p.died}`;
	if (p.born && p.born <= nowYear - 100) return `* ${p.born}`;
	return null;
}

// Alte Einbuchstaben-Kürzel der KRDB (S, F, B, D, L, Ch, E) ohne gesicherte
// Auflösung – lieber weglassen als falsch deuten.
const OPAQUE_PARTY = /^[A-Z][a-z]?$/;

/** Parteikürzel zur Anzeige: die alten Einbuchstaben-Kürzel ohne gesicherte Auflösung entfallen. */
export function displayParty(party: string | null | undefined): string | null {
	const p = party?.trim();
	return p && !OPAQUE_PARTY.test(p) ? p : null;
}

/** Bildnachweis «Urheber / Quelle» (der Builder hat Platzhalter und
 *  Boilerplate schon bereinigt); null ⇒ nur Lizenz + Commons-Link.
 *  Z 1114: «Fotograf:in · Staatsarchiv Zürich, Signatur». */
function creditOf(img: KrdbImage): string | null {
	const parts = [...new Set([img.artist, img.credit].filter((x): x is string => !!x && x.trim() !== ""))];
	if (parts.length === 0) return null;
	const credit = parts.join(img.source === "z1114" ? " · " : " / ");
	return credit.length > 140 ? `${credit.slice(0, 139)}…` : credit;
}

export function portraitOf(p: KrdbPerson, opts: KrdbViewOptions): KrdbPortraitView | null {
	const img = p.img;
	if (!img) return null;
	// Z 1114 liegt als eigene statische Datei vor, Commons nur über den Proxy.
	const src =
		img.source === "z1114"
			? `${img.thumb}${img.v ? `?v=${encodeURIComponent(img.v)}` : ""}`
			: opts.portraitSrc(portraitKey(p), img.v);
	return {
		src,
		source: img.source ?? "commons",
		width: img.width,
		height: img.height,
		page: img.page,
		credit: creditOf(img),
		license: img.license ?? null,
		licenseUrl: img.licenseUrl ?? null,
	};
}

export interface KrdbViewOptions {
	/** Proxy-URL eines Commons-Porträts (Schlüssel aus `portraitKey` + Versions-Token). */
	portraitSrc: (key: string, v: string | undefined) => string;
	/** Aktuelles Jahr (injiziert, damit die Funktion pur bleibt). */
	nowYear: number;
}

/** Anzeige-DTO für die Detailseite. */
export function toPersonView(m: KrdbMatch, opts: KrdbViewOptions): KrdbPersonView {
	const p = m.person;
	const party = m.party && !OPAQUE_PARTY.test(m.party) ? m.party : null;
	// Regierung: der «Wahlkreis» ist das Wahlgremium («Kanton Zürich», «Grosser Rat») – weglassen.
	const gov = m.seat?.[0] === "Regierungsrat" || m.seat?.[0] === "Kleiner Rat";
	const district = gov ? null : (m.seat?.[3]?.replace(/\s+/g, " ").replace(/^0(\d)\./, "$1.") ?? null);
	const role = m.seat
		? [councilLabel(m.seat[0], p.sex), party, district]
				.filter((x): x is string => !!x && x.trim() !== "")
				.join(" · ")
		: null;
	return {
		id: p.id,
		name: `${p.first.trim()} ${displayLastName(p.last)}`.trim(),
		forms: m.forms,
		lifespan: lifespanOf(p, opts.nowYear),
		role: role || null,
		krdbUrl: `${KRDB_PERSON_URL}${p.id}`,
		qid: p.qid ?? null,
		wikidataUrl: p.qid ? `https://www.wikidata.org/wiki/${p.qid}` : null,
		portrait: portraitOf(p, opts),
	};
}

/** Porträts zuerst, dann nach Nachname/Vorname (Reihenfolge von matchKrdbPersons). */
export function sortPersonViews(views: KrdbPersonView[]): KrdbPersonView[] {
	return views
		.map((v, i) => ({ v, i }))
		.sort((a, b) => Number(!!b.v.portrait) - Number(!!a.v.portrait) || a.i - b.i)
		.map((x) => x.v);
}
