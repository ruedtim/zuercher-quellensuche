/**
 * Namen der Ratsmanuale (Serie RM) für die geteilten Namensfilter: aus den Spans des NER
 * (`persName`/`placeName`/`orgName`, kuratiert oder `ft-hmbert-rm`) normalisierte Werte für
 * `persons`/`places`/`organizations`. Die TEI bleibt diplomatisch; normalisiert wird nur, was in
 * den Index geht. Auswertung und Stichproben: docs/ratsmanuale-namen-auswertung.md.
 *
 * - Personen: nur Vor- und Nachname (hat einen Vergleichsschlüssel). Ämter, Titel und Anreden
 *   vorne weg, Herkunft und Apposition hinten weg («Burgermeister Hanß Conrad Eschern zu
 *   Kyburg» → «Hans Konrad Escher»), Vornamen kanonisch, der Nachname ohne Flexion und in der
 *   häufigsten Schreibung (Tabelle `surnames` aus dem Bestand). Nachname allein, Vorname allein
 *   und zwei Wörter ohne bekannten Vornamen fallen weg.
 * - Orte: nur Einträge des Ortsverzeichnisses (`places`: kuratierte Liste, Wohnorte des
 *   KRDB-Registers, geprüfte ähnliche Schreibungen), heutiger Name. Gattungswörter fallen weg.
 *   Dazu Orte nach «zu/von …» in Personen- und Amts-Spans («Landvogt Escher zu Kyburg»).
 * - Organisationen: nur eine kuratierte Liste von Einrichtungen; die Räte selbst (das Gremium
 *   der Sitzung: «beid Räth», «Räth und Burger») gehen nicht in die Facette.
 *
 * Die Tabellen aus dem Bestand (`rmNames.data.json`) baut `rmNamesBuild.ts` (nur auf dem Mac,
 * aus den RM-TEI). Pur, getestet in rmNames.test.ts.
 */

import { readFileSync } from "node:fs";
import { rmSearchForm } from "./rmSearchForm.ts";
import { foldText, personKeyV2 } from "./vendor/entityKey.ts";

// ── Daten ──────────────────────────────────────────────────────────────────────────────────

export interface RmNamesData {
  version: number;
  /** RM-Ortsschlüssel (rmPlaceKey) → heutiger Name; "" = Gattungswort (fällt weg). */
  places: Record<string, string>;
  /** Gefaltetes letztes Namenswort → Schreibung des Familiennamens (Flexion, tz/z, rd/rt). */
  surnames: Record<string, string>;
  /** Familiennamen mit Partikel, gefaltet («von cham»): «Hans von Cham» ist kein Herkunftsort. */
  vonSurnames: string[];
}

export interface RmNamesIndex {
  places: ReadonlyMap<string, string>;
  surnames: ReadonlyMap<string, string>;
  von: ReadonlySet<string>;
}

export function rmNamesIndex(data: RmNamesData): RmNamesIndex {
  return {
    places: new Map(Object.entries(data.places)),
    surnames: new Map(Object.entries(data.surnames)),
    von: new Set(data.vonSurnames),
  };
}

let cached: RmNamesIndex | null = null;

/** Die Tabellen neben dieser Datei (einmal geladen). */
export function loadRmNames(): RmNamesIndex {
  if (!cached) {
    const raw = readFileSync(new URL("./rmNames.data.json", import.meta.url), "utf-8");
    cached = rmNamesIndex(JSON.parse(raw) as RmNamesData);
  }
  return cached;
}

// ── Wörter ─────────────────────────────────────────────────────────────────────────────────

const WORD_RE = /\p{L}+(?:[-'’]\p{L}+)*/gu;

interface Tok {
  w: string;
  /** Abkürzungspunkt bzw. Doppelpunkt direkt danach («Leüt.», «Statthaubt:»). */
  dot: boolean;
}

/** Wörter eines Textes in der Lesefassung (Buchstaben, Bindestrich, Apostroph). */
export function rmTokens(text: string): string[] {
  return [...rmSearchForm(text).matchAll(WORD_RE)].map((m) => m[0]);
}

function toks(s: string): Tok[] {
  const out: Tok[] = [];
  for (const m of s.matchAll(WORD_RE)) {
    const end = (m.index ?? 0) + m[0].length;
    out.push({ w: m[0], dot: s[end] === "." || s[end] === ":" });
  }
  return out;
}

const fold = (w: string) => foldText(w);
const cap = (w: string) => w.slice(0, 1).toUpperCase() + w.slice(1);
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const setOf = (s: string) => new Set(words(s));

// ── Personen ───────────────────────────────────────────────────────────────────────────────

/** Ämter, Titel und Anreden (gefaltet). Nicht: Familiennamen wie Schulthess, Vogel, Keller, Zoller. */
export const OFFICE = setOf(`
ambassador ambtman ambtmann ambtmans amman ammann ampt amptman amptmann amtman amtmann amtmans antistes bannerherr baron barons
bauherr bergherr bgm bgmr bm buherr burgermeister burgermeistern burgermeisters burgermeistr burgermr burgermrn burgermstr buwherr
camerer cammerer canonicus chorherr chorherren commendant commendanten constafelherr constaffelherr d decan dechan dechant dekan
diacon diaconus diakon doct doctor doktor dr dris drn edel edlen ehegaumer ehrsam ehrsamen envoye ersam ersamen examinator fanrich
feldweibel fendrich fendrichen fr frau frauw fraw freiherr freiherrn freyherr freyherren freyherrn fromm frommen fursprech furst
fursten general generals gerichtschreiber gerichtsherr gesandte gesandten gesandter graf grafen graff graffen grave grichtschreiber
grichtschryber grichtsherr grossweibel h hardherr haubtm haubtman haubtmann haubtmans hauptman hauptmann hauptmans hbtm helfer her
here heren hern herr herren herrn herzog herzogen hn hptm hr hrn husschryber hussschryber iunker jfr jgfr jkhr jkr jr juncker
junckfrau jungfrau jungfraw jungherr jungker jungkfrau jungkher junker junkher kamerer kammerer kay kayserlich keys kilchmeier
kilchmeyer knecht kon koniglich kornmeister korporal landamman landammann landrichter landschreiber landschryber landshaubtmann
landshauptmann landtamman landtammann landtschreiber landtschryber landtshauptmann landtvogt landtvogts landvogt landvogten
landvogts landvogtt laufer leutenant lieut lieutenant lieutenants louffer lutenant lv lvogt m mag magister major majors meister mm
mr mrs mster mstr oberist oberst obersten oberster obervogt obervogts obman obmann obmans obrist obristen obrister
obristwachtmeister panerherr pannerherr pfahrer pfahrrer pfarer pfarrer pfarrern pfarrers pfarrherr pfleger pflegern pflegers pfr
pfundtzoller pradicant predicant predicanten predikant predikanten procurator prof professor profos provisor quartierhaubtmann
quartierhauptmann rahtsherr rahtsherren rahtsherrn rathsh rathsherr rathsherren rathsherrens rathsherrn rathshr rathshrn
rathsprocurator rathsschreiber rathssubstitut ratsh ratsherr ratsherrn ratsschreiber rechenherr redner resident residenten rhr
richter ritter rittmeister salzherr schaffner schafner schiffmeister schirmvogt schreiber schryber schulmeister schultheis
schultheiss schultheissen seckelm seckelmeister seckelmeistern seckelmeisters seckelmr seckhelmeister secretair secretaire secretari
secretarii secretarius sekelm sekelmeister sekelmeisters sekelmr sekretar silherr sillherr spitalmeister stadthalter stadthalters
stadthaubtmann stadthauptmann stadtschreiber stadtschryber stallherr stath stathalter statrichter statth statthalter statthaltern
statthalters statthaubt statthaubtm statthaubtman statthaubtmann statthauptman statthauptmann statthltr statthr stattrichter
stattschreiber stattschryber stiftsverwalter stubenmeister substitut substituten underschreiber underschryber undervogt undervogts
unterschreiber untervogt untervogts verwalter vest vesten vicari vicarius vogt vogten vogts vorsprech vortrager wachtmeister waibel
weibel weibels witfrau wittib wittwe witwe wwe zeugherr zeugherren zm zugherr zunfftm zunfftmeister zunfftmeistern zunfftmeisters
zunfftmr zunftmeister zunftmeisters zunftmr zunnfftmeister
`);

/** Zweiteilige Ämter («Burger Meister», «Raths Herr», «Land Vogt»): erste und zweite Hälfte. */
const OFFICE_FIRST = setOf(`bau berg burger buw gerichts grichts haubt kilch korn land landt ober panner quartier rahts rath raths
salz schiff seckel seckhel sekel silh spital stadt statt stifts under unter zeug zunfft zunft`);
const OFFICE_SECOND = setOf(`haubtman haubtmann hauptman hauptmann herr herren hr m man mann meister mr mstr richter schreiber
schryber substitut vogt vogts`);
/** Zwischen Ämtern («Rathsherr und alt Landvogt»). */
const LINK = setOf("alt alten dem der des gewesenen gewesener gewesne gewesner jung jungen u und unnd");
/** Ende des Namens: Herkunft, Apposition, Verwandtschaft, Satzteile. */
const CUT = setOf(`ab aber alias als am an auch aus auss ausser bei beim bey bi bim bruder bruders by bym das daselbst daselbsten
dem den der des dess die dochter ehefrau fur gebohrne gebohrner geborne geborner gebornen geboren gegen genannt genant gewesenen
gewesener gewesnen gewesner gnant halb hausfrau hinder hinderlassenen hinderlassener hinterlassenen hinterlassener husfrau ihres im
in ires item knecht magd mit mutter nach nachgelassenen nachgelassener ouch salig saligen sampt samt sein seinem seiner seines sel
selig seligen sin sinem siner sines so sohn son sonst sun sune synes tochter u uber uf uff und unnd us uss usser vater vatter vom
von vor wegen wider wittib witwe ze zem zu zue zum zur`);
const TRAIL = setOf(`alt alten elter elteren eltern jung junger jungern salig saligen sel selig seligen verstorben verstorbenen
verstorbnen wittib wittwe`);
/** Fehltreffer als Nachname («hab», «der», «M»). */
const JUNK = setOf(`als also alss an b da dan dann das dem den der des dess die en er gnaden h hab hand hat herr herren hier hr ihr
im in ir j jkr m man min mr myn si sie sy und unser unsere unsern von wan wann ward weil wil wir wurd wyl zu`);
/** Berufe, die klein geschrieben hinter dem Namen stehen («Jacoben Kleiner wyber»). */
const OCCUPATION = setOf(`wyber weber wäber pfister schärer scherer schuhmacher schumacher schuomacher schnider schneider metzger
beck becken wirt würt wirth küfer kuefer zimmermann zimmerman maurer murer krämer kramer hafner tischmacher schlosser schmid müller
muller seiler sattler gerber färber glaser kessler steinmetz trumeter`.split(/\s+/).map((w) => foldText(w)).join(" "));
/** Partikel, die klein bleiben («Melchior von Muralt»). */
const PARTICLE = setOf("von vom zur zum zu de di");

/** Endungen von Ämtern und Titeln, nur vor dem Namen («Kilchenpfleger», «Spittahlmeister»). */
const OFFICE_SUFFIX = new RegExp(
  "(meister|mstr|herr|herren|vogt|vogts|pfleger|schreiber|schryber|schriber|weibel|richter|hauptmann|hauptman|haubtmann|" +
    "haubtman|amtmann|ambtman|amptman|ammann|verwalter|schaffner|procurator|secretari|secretario|secretarius|resident|" +
    "residenten|residen|gesandter|gesandten|ambassade|amsassade|commendant|commendanten|kommandant|officier|offizier|" +
    "lieutenant|kirchmeier|kilchmeier|kilchmeyer|profos|profoss|profass|provisor|prediger|predicant|pfarrer|pfahrer|vicari|" +
    "vicarius|diacon|decan|dechant|schulmeister|ischen|ischer|lischen|ichen)$",
);

/** Vornamen: kanonische Form ← gefaltete Varianten (Flexion, Kurzform, Abkürzung). */
const GIVEN: Record<string, string> = {
  Hans: "hans hanss hanns hannss hs hansen hanssen hannssen hannsen hanses hansens hensli hansli hannsli hanslin hanssli",
  Heinrich: "heinrich heinrichen heinrichs hainrich hainrichen heinr hch hrch heini heinin heinj heynrich heinrych",
  Jakob: "jacob jakob jacoben jakoben jacobs jacobus jac jagli jaggli jakli jackli jogli jacobli",
  Kaspar: "caspar kaspar casparen caspars casp kasparen",
  Johannes: "johannes johanes",
  Johann: "johann joh johan johanns johannen",
  Felix: "felix felixen felixs",
  Rudolf: "rudolf rudolff rudolffen rudolfen rudolph rudolphen rud rudolfs rudolffs rudi ruedi rudj",
  Ulrich: "ulrich ulrichen ulrichs ulr uolrich uli ueli ulin",
  Konrad: "conrad conradt conrat cunrat cunradt kunrat konrad conradten conraden cunraten conr cuonrat kunradt cunrad conradts cuni",
  Peter: "peter petern peters",
  Melchior: "melchior melchiorn melcher",
  Salomon: "salomon salomons salomonen",
  Georg: "georg georgen georgius jorg jorgen",
  Markus: "marx marxen marcus markus",
  Bernhard: "bernhart bernhard bernharten bernharden bernhardt",
  Josef: "joseph josef",
  Ludwig: "ludwig ludwigen ludwigs",
  Andreas: "andreas andres andresen andressen",
  Michael: "michel michael micheln michels",
  David: "david daviden",
  Abraham: "abraham abrahamen",
  Adam: "adam adamen",
  Martin: "martin martinen marti",
  Christoph: "christoph christoff christoffel stoffel christophel",
  Hartmann: "hartman hartmann hartmannen",
  Anton: "anthoni antoni anthonien anton anthonj",
  Beat: "beat beaten",
  Leonhard: "lienhart lienhard leonhart leonhard lienharten",
  Matthias: "mathys mathias matthias mathis",
  Franz: "frantz franz frantzen",
  Wilhelm: "wilhelm wilhelmen",
  Samuel: "samuel",
  Thomas: "thoman thomas tomas",
  Werner: "werner wernher",
  Wolfgang: "wolfgang wolffgang",
  Balthasar: "balthasar baltasar balthassar",
  Daniel: "daniel",
  Gabriel: "gabriel",
  Sebastian: "sebastian bastian",
  Oswald: "oswald",
  Jos: "jos joss",
  Gerold: "gerold",
  Lorenz: "lorenz lorentz",
  Niklaus: "niclaus niklaus clauss claus clewi",
  Bartholome: "bartholome bartlome",
  Erhard: "erhart erhard",
  Hieronymus: "hieronymus",
  Otmar: "othmar otmar",
  Burkhard: "burckhart burkhart burckhard burkhard burkart burckart burckharten burkharten burckharden",
  Diethelm: "diethelm diethelmen",
  Josias: "josias",
  Sigmund: "sigmund sigmunden",
  Adrian: "adrian adrianen",
  Friedrich: "fridrich friedrich fridli fridrichen friderich",
  Gottfried: "gottfried gotfrid",
  Kilian: "kilian",
  Elias: "elias",
  Isaak: "isaac isaak",
  Jonas: "jonas",
  Lukas: "lux lucas lukas",
  Philipp: "philip philipp philippen",
  Christian: "christian",
  Joachim: "joachim",
  Dietrich: "dietrich dietrichen",
  Benedikt: "bendicht benedict benedikt",
  Moritz: "moritz",
  Valentin: "valentin velti",
  Gregor: "gregorius gregor",
  Ambrosius: "ambrosius",
  Laurenz: "laurenz laurentz",
  Anna: "anna anni annen",
  Barbara: "barbara barbel",
  Regula: "regula",
  Maria: "maria",
  Magdalena: "magdalena madlena",
  Verena: "verena vrena frena verenen",
  Katharina: "catharina katharina cathrina catrina katrina",
  Susanna: "susanna",
  Elisabeth: "elisabeth elsbeth elssbeth elsbetha elisabetha elssbetha elssbet elsbet",
  Margaretha: "margaretha margretha margreth margret margaretta",
  Ursula: "ursula",
  Dorothea: "dorothea dorothe",
  Esther: "ester esther",
  Kleophea: "cleophea kleophea",
  Judith: "judith",
  Agatha: "agatha",
  Agnes: "agnes",
  Apollonia: "apollonia",
  Euphrosina: "euphrosina",
  Gertrud: "gertrud gerdrut",
  Küngold: "kungold",
  Salome: "salome",
  Sara: "sara",
  Veronika: "veronica veronika",
  Adelheid: "adelheid",
  Christina: "christina",
  Martha: "martha",
  Rosina: "rosina",
  Ottilia: "ottilia",
};
const GIVEN_MAP = new Map<string, string>();
for (const [canon, variants] of Object.entries(GIVEN)) for (const v of words(variants)) GIVEN_MAP.set(v, canon);

/** Kanonischer Vorname eines Wortes (auch mit Endung -en/-n/-s), sonst null. */
export function givenOf(w: string): string | null {
  const f = fold(w);
  const direct = GIVEN_MAP.get(f);
  if (direct) return direct;
  for (const suf of ["en", "n", "s"]) {
    if (f.endsWith(suf)) {
      const g = GIVEN_MAP.get(f.slice(0, -suf.length));
      if (g) return g;
    }
  }
  return null;
}

function isOffice(t: Tok, last: boolean): boolean {
  const f = fold(t.w);
  if (OFFICE.has(f)) return true;
  if (last || givenOf(t.w)) return false;
  if (f.length >= 5 && OFFICE_SUFFIX.test(f.replace(/ /g, ""))) return true;
  // Abkürzung vor dem Namen («Leüt.», «Ampt.»), aber nicht «Joh.», «Hs.»
  return t.dot && f.length <= 6;
}

function stripOffices(ws: Tok[]): { offices: Tok[]; rest: Tok[] } {
  const offices: Tok[] = [];
  let i = 0;
  while (i < ws.length) {
    const f = fold(ws[i].w);
    const next = i + 1 < ws.length ? fold(ws[i + 1].w) : "";
    if (isOffice(ws[i], i === ws.length - 1)) {
      offices.push(ws[i++]);
      continue;
    }
    if (OFFICE_FIRST.has(f) && OFFICE_SECOND.has(next)) {
      offices.push(ws[i], ws[i + 1]);
      i += 2;
      continue;
    }
    if (LINK.has(f) && offices.length > 0 && i + 1 < ws.length) {
      offices.push(ws[i++]);
      continue;
    }
    // Ämter mit Bindestrich («Raths-Substitut», «Quartier-Haubtmann»)
    if (ws[i].w.includes("-") && words(f).every((p) => OFFICE.has(p) || OFFICE_FIRST.has(p) || OFFICE_SECOND.has(p))) {
      offices.push(ws[i++]);
      continue;
    }
    break;
  }
  return { offices, rest: ws.slice(i) };
}

export interface RmPersonCore {
  offices: string[];
  /** Namenswörter wie im Text (Lesefassung). */
  name: string[];
  /** Abgeschnittener Rest: Herkunft, Apposition («zu Kyburg», «dem Pfister»). */
  rest: string[];
}

/** Namenskern eines Personen-Spans: Ämter vorne, Herkunft und Apposition hinten weg. */
export function rmPersonCore(text: string, von: ReadonlySet<string>): RmPersonCore {
  const rf = rmSearchForm(text);
  let ws = toks(rf.split(",")[0]);
  if (ws.length === 0) ws = toks(rf);
  const stripped = stripOffices(ws);
  ws = stripped.rest;
  while (ws.length > 0 && ["der", "die", "das", "dem", "den", "des"].includes(fold(ws[0].w))) ws = ws.slice(1);
  const offices = stripped.offices.map((t) => t.w);
  if (ws.length === 0) return { offices, name: [], rest: [] };
  if (fold(ws[0].w) === "v") ws = [{ w: "von", dot: false }, ...ws.slice(1)];
  const out: Tok[] = [ws[0]];
  let i = 1;
  if (PARTICLE.has(fold(ws[0].w)) && ws.length > 1) {
    out.push(ws[1]);
    i = 2;
  }
  while (i < ws.length) {
    const f = fold(ws[i].w);
    if (CUT.has(f)) {
      // «Hans von Cham»: «von X» ist selbst ein Familienname
      if (["von", "vom", "zur", "zum"].includes(f) && i + 1 < ws.length && von.has(`${f} ${fold(ws[i + 1].w)}`)) {
        out.push(ws[i], ws[i + 1]);
        i += 2;
        continue;
      }
      break;
    }
    if (OFFICE.has(f)) break;
    out.push(ws[i++]);
  }
  const rest = ws.slice(i).map((t) => t.w);
  while (out.length > 0 && TRAIL.has(fold(out[out.length - 1].w))) out.pop();
  // Beruf klein hinter dem Namen («Jacoben Kleiner wyber»)
  if (out.length >= 3) {
    const last = out[out.length - 1].w;
    if (/^\p{Ll}/u.test(last) && OCCUPATION.has(fold(last))) out.pop();
  }
  return { offices, name: out.map((t) => t.w), rest };
}

/**
 * Vor- und Nachname eines Personen-Spans oder null (Nachname allein, Vorname allein, kein
 * bekannter Vorname, Fehltreffer). Vornamen kanonisch, Nachname aus der Tabelle des Bestands.
 */
export function rmPersonName(text: string, idx: RmNamesIndex): string | null {
  const { name } = rmPersonCore(text, idx.von);
  if (name.length < 2) return null;
  const f = name.map(fold);
  if (f.every((x) => x.length <= 1)) return null;
  const last = f[f.length - 1];
  if (JUNK.has(last) || last.length <= 1) return null;
  if (name.every((w) => givenOf(w))) return null;
  if (!name.slice(0, -1).some((w) => givenOf(w))) return null;
  const out = name.map((w, j) => {
    if (j === name.length - 1) return idx.surnames.get(fold(w)) ?? cap(w);
    const g = givenOf(w);
    if (g) return g;
    return PARTICLE.has(fold(w)) ? fold(w) : cap(w);
  });
  const value = out.join(" ");
  return personKeyV2(value) ? value : null;
}

// ── Orte ───────────────────────────────────────────────────────────────────────────────────

/** Vorsätze vor dem Ortsnamen («Statt», «Grafschafft», «Herrschafft», «in der …»). */
const PLACE_PREFIX = setOf(`statt stat stadt grafschaft grafschafft graffschafft graffschaft grafschaf herrschaft herrschafft
herschafft herrschaf landvogtei landvogtey landvogti vogtei vogtey vogti amt ampt ambt kloster closter gotteshaus gottshus gottshuss
gottshauss gotzhus dorf dorff gemeind gmeind gemeinde gmeinde kilchhori pfarr pfarrei pfarrey pfarey land landschaft landschafft
landtschafft orth ort flecken schloss schlos ins inss inn im in am zu zum zur von gegen nach gen us uss aus der die das dem den des bi
by uff uf landvogteiamt landvogteyamt vogteiamt vogteyamt obervogtei obervogtey`);

/** Schlüssel-Faltung eines Worts (variantWord, Doppelkonsonanten), wie Fassung 2 von entityKey.ts. */
function fuzzyV2(w: string): string {
  return w
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/dt/g, "t")
    .replace(/ck/g, "k")
    .replace(/c(?!h)/g, "k")
    .replace(/y/g, "i")
    .replace(/([b-df-hj-np-tv-z])\1+/g, "$1");
}

/** RM-Faltung eines Ortsworts: dazu uw → u, tz → z, schw → sw, -ikon/-iken, -perg, -burch, -weil. */
function rmPlaceWord(w: string): string {
  let x = fuzzyV2(w).replace(/uw/g, "u").replace(/tz/g, "z").replace(/schw/g, "sw").replace(/gk/g, "g");
  x = x.replace(/([aeiou])w$/, "$1");
  x = x.replace(/([aeiou])\1+/g, "$1");
  x = x.replace(/(ikon|iken|ickon|icken|ikhon|ikhen|ichon|ikkon)$/, "ikon");
  x = x.replace(/(perg|berk)$/, "berg");
  x = x.replace(/(burch|purg|burk)$/, "burg");
  x = x.replace(/weil$/, "wil");
  return x.replace(/s+$/, "s");
}

/** RM-Ortsschlüssel: Lesefassung, gefaltet, Vorsätze weg, Wörter RM-gefaltet. */
export function rmPlaceKey(text: string): string {
  const ws = words(fold(rmSearchForm(text)));
  while (ws.length > 1 && PLACE_PREFIX.has(ws[0])) ws.shift();
  if (ws.length > 0 && ["sant", "sankt", "sanct", "s", "st"].includes(ws[0])) ws[0] = "st";
  return ws.map(rmPlaceWord).join(" ");
}

/** Ötenbach (Kloster in Zürich) ≠ Ottenbach (Dorf im Knonauer Amt): Form ohne Umlaut. */
const EXACT_PLACE: Record<string, string> = { ottenbach: "Ottenbach" };
/** Nur gross geschrieben ein Ort («Wyl» = Wil, «wyl» meist die Konjunktion, «wald» der Wald). */
const CAPITAL_ONLY: Record<string, string> = { wil: "Wil", wald: "Wald", berg: "Berg", au: "Au", eg: "Egg" };

/** Lesefassung und Schlüssel, unter denen ein Orts-Span nachgeschlagen wird («X im Thurgau» → X). */
export function rmPlaceLookup(text: string): { rf: string; key: string } | null {
  const head = ` ${text.trim()} `.split(/\s(?:in|im|inn)\s/u)[0].trim();
  const form = head || text;
  const rf = rmSearchForm(form).trim();
  const f = fold(rf);
  if (!/[a-z]/.test(f) || /\d/.test(f)) return null;
  return { rf, key: rmPlaceKey(form) };
}

/** Ortsname aus dem Ortsverzeichnis oder null. */
export function rmPlaceName(text: string, idx: RmNamesIndex): string | null {
  const look = rmPlaceLookup(text);
  if (!look) return null;
  const { rf, key: k } = look;
  const exact = EXACT_PLACE[rf.toLowerCase().replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")];
  if (exact) return exact;
  if (CAPITAL_ONLY[k]) return /^\p{Lu}/u.test(rf) ? CAPITAL_ONLY[k] : null;
  const v = idx.places.get(k);
  if (v !== undefined) return v || null;
  if (k.replace(/ /g, "").length < 3) return null;
  if (k.endsWith("s")) {
    const g = idx.places.get(k.slice(0, -1));
    if (g !== undefined) return g || null;
  }
  return null;
}

/** Herkunft und Amtsbereich in Personen-Spans («Landvogt Escher zu Kyburg», «Hans Meyer von Uster»). */
const PLACE_PREP = setOf("zu zue ze von vom uss us aus auss ab in im zum zur");
/** Amtsbereich vor dem Ort in Organisations-Spans («Landvogteyamt Kyburg», «Amt Knonau»). */
const ORG_AREA = setOf(`amt ambt ampt oberamt landvogteiamt landvogteyamt vogteiamt vogteyamt landvogtei landvogtey vogtei vogtey
obervogtei obervogtey herrschaft herrschafft grafschaft grafschafft graffschafft`);

/** Orte, die ein Personen- oder Organisations-Span nennt, ohne sie selbst zu markieren. */
export function rmPlacesInSpan(text: string, kind: "pers" | "org", idx: RmNamesIndex): string[] {
  const tryRun = (run: string[]): string | null => {
    for (let n = Math.min(4, run.length); n >= 1; n--) {
      const v = rmPlaceName(run.slice(0, n).join(" "), idx);
      if (v) return v;
    }
    return null;
  };
  if (kind === "pers") {
    const { rest } = rmPersonCore(text, idx.von);
    if (rest.length < 2 || !PLACE_PREP.has(fold(rest[0]))) return [];
    const run: string[] = [];
    for (const w of rest.slice(1)) {
      const f = fold(w);
      if (CUT.has(f) && !PLACE_PREFIX.has(f)) break;
      run.push(w);
      if (run.length >= 4) break;
    }
    const v = tryRun(run);
    return v ? [v] : [];
  }
  const ws = toks(rmSearchForm(text)).map((t) => t.w);
  if (ws.length < 2 || !ORG_AREA.has(fold(ws[0]))) return [];
  const v = tryRun(ws.slice(1));
  return v ? [v] : [];
}

// ── Organisationen ─────────────────────────────────────────────────────────────────────────

/** Die Räte: Gremium der Sitzung, nicht in die Facette (kuratierte Typen des Staatsarchivs). */
const COUNCIL: Array<[string, RegExp]> = [
  ["Grosser Rat", /\b(rat|rath|rat?e|rathe|raht|reth|ret|rete|rethe|raten|rathen|rhet)\b.{0,6}\b(und|unnd|u)\b.{0,4}\bburger/],
  ["Grosser Rat", /\b(grossen?|grosse)\b.{0,3}\b(rat|rath|rate|rathe|raten|rathen|raht|reth|rethen|raths|rats|rahts|reths)\b|coram ducentis|^und burger/],
  ["Geheimer Rat", /\b(geheim|gheim|heim)\w*\b.{0,3}\b(rat|rath|rate|rathe|raten|rathen|raht|reth|rethen|raths|rahts|reths)\b|secretioribus|^(geheimen|geheimbden|geheimden|geheime)$/],
  ["Neuer Rat", /\b(neu|nuw|nouw|neuw)\w*\b.{0,3}\b(rat|rath|rate|rathe|raten|rathen|reth|rethen)\b|novo senatu/],
  ["Kleiner Rat", /\b(beid|beyd|beide|beyde|beiden|beyden|boid|2|zwei)\b.{0,3}\b(rat|rath|rate|rathe|raten|rathen|raht|rahte|reth|rethe|rethen|ret|rech|recht|rhet|re|rett|ratt)\b/],
  ["Kleiner Rat", /\b(kleinen?|cleinen?|klein|clein|kleine)\b.{0,3}\b(rat|rath|rate|rathe|raten|rathen|reth|rethen|raths|rahten|rahte)\b|coram senatu|^(kleinen|klein|cleinen)$|\bsenatus?\b/],
  ["Rat", /^(der |die |den |dem )?(rat|rath|rate|rathe|raten|rathen|raht|rahte|reth|rethe|rethen)$/],
  ["Rat", /^(beid|beyd|beide|beyde)$/],
];

/** Kuratierte Einrichtungen (Name ← Muster über die gefaltete Lesefassung). */
const INSTITUTIONS: Array<[string, RegExp]> = [
  ["Seckelamt", /\bse(c|k|ck|ckh)h?e?l\s?-?\s?(am+|amb|amp)(b|p)?t/],
  ["Stadtgericht", /\bsta(d|t)?t?\s?-?\s?g(e)?richt/],
  ["Ehegericht", /\be(h|e)?e?h?\s?-?\s?g(e)?richt/],
  ["Ehrenkommission", /\behren\s?-?\s?(c|k)om+is+ion/],
  ["Constaffel", /\b(c|k)onstaf+el\b/],
  ["Kornamt", /\bkorn\s?-?\s?(am+|amb|amp)(b|p)?t/],
  ["Almosenamt", /\bal+mosen\s?-?\s?(am+|amb|amp)(b|p)?t/],
  ["Obmannamt", /\bobman+\s?-?\s?(am+|amb|amp)(b|p)?t/],
  ["Rechenrat", /\brechen\s?-?\s?(rat|rath|reth|herren)/],
  ["Kriegsrat", /\bkriegs\s?-?\s?(rat|rath|rate|rathen|reth|rethen)/],
  ["Sanitätsrat", /\bsanit(e|a)t/],
  ["Examinatorenkonvent", /\bexaminator/],
  ["Zuchthaus", /\bzucht\s?-?\s?h(au|u)s/],
  ["Reformationskammer", /\breformation/],
  ["Kaufmännisches Direktorium", /\bdirector/],
  ["Stift Grossmünster", /\bstif+t\b/],
  ["Evangelische Orte", /\bevang/],
  ["Tagsatzung", /\btag\s?-?\s?(satz|leistung)/],
  ["Zunft zur Meisen", /\bmeis(e|i)n\b/],
  ["Zunft zur Saffran", /\bsaf+r(a|o)n/],
  ["Zunft zur Schmiden", /\bzun+f+t\w*\s+(zur|zun)?\s*schmid/],
  ["Zunft zum Kämbel", /\bk(a|e)mbel|\bkembel/],
  ["Zunft zur Waag", /\bzun+f+t\w*\s+(zur|zun)?\s*wa+g\b/],
  ["Zunft zur Gerwe", /\bgerw(e|i)\b/],
  ["Zunft zur Schuhmachern", /\bschuo?h?macher/],
  ["Zunft zur Zimmerleuten", /\bzim+erl(e|u)/],
  ["Zunft zur Schneidern", /\bzun+f+t\w*\s+(zur|zun)?\s*schnid|\bschneidern\b/],
  ["Zunft zur Schiffleuten", /\bschif+l(e|u)/],
  ["Zunft zum Widder", /\bwid+er\b/],
  ["Zunft zur Weggen", /\bweg+en\b/],
  ["Schützengesellschaft", /\bschutzen/],
  ["Chorherren", /\bchorher/],
  ["Wundschau", /\bwund\s?-?\s?g?scha/],
  ["Bauamt", /\bbau\s?-?\s?(am+|amb|amp)(b|p)?t/],
  ["Studentenamt", /\bstudenten\s?-?\s?(am+|amb|amp)(b|p)?t/],
  ["Kelleramt", /\bkeller\s?-?\s?(am+|amb|amp)(b|p)?t/],
];

/** Einordnung eines Organisations-Spans: Rat (Gremium), kuratierte Einrichtung oder nichts. */
export function rmOrgClass(text: string): { kind: "rat" | "einrichtung"; name: string } | null {
  const f = fold(rmSearchForm(text));
  if (!/[a-z]{2}/.test(f)) return null;
  for (const [name, rx] of COUNCIL) if (rx.test(f)) return { kind: "rat", name };
  for (const [name, rx] of INSTITUTIONS) if (rx.test(f)) return { kind: "einrichtung", name };
  return null;
}

/** Name einer kuratierten Einrichtung oder null (Räte und Unbekanntes). */
export function rmOrgName(text: string): string | null {
  const c = rmOrgClass(text);
  return c?.kind === "einrichtung" ? c.name : null;
}
