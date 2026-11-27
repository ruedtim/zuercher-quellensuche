/**
 * Baut die Tabellen der RM-Namen (rmNames.data.json) aus den TEI der Ratsmanuale. Läuft nur auf
 * dem Mac, wo die RM-TEI liegen (die Datei ist committet, der Indexer auf dem Server liest sie):
 *
 *   npx tsx src/rmNamesBuild.ts --data=~/zszh-rm/tei [--report=<dir>]
 *
 * - vonSurnames: «von X» als ganze Personenform (mindestens 5-mal, X gross): Familienname mit
 *   Partikel («Hans von Cham»), nicht Herkunft.
 * - surnames: letztes Namenswort → Schreibung des Familiennamens. Flexionsendung weg, wenn die
 *   Grundform mindestens so oft belegt ist («Holtzhalben» → Holzhalb, «Müllers» → Müller,
 *   «Greblin» → Grebel); Schreibungen, die sich nur in tz/z oder rd/rt unterscheiden, zur
 *   häufigsten zusammen («Hirtzel» → Hirzel, «Werdtmüller» → Werdmüller).
 * - places: RM-Ortsschlüssel → heutiger Name. Die kuratierte Liste unten (die häufigsten Cluster,
 *   von Hand), die Wohnorte des KRDB-Registers (heutige Zürcher Gemeinden) und ähnliche
 *   Schreibungen (Editierabstand 1 ab 5, 2 ab 9 Zeichen, eindeutig) nur aus der geprüften Liste
 *   FUZZY_ALLOW. Der Bericht (--report) listet alle Kandidaten mit Zahlen zum Prüfen.
 *
 * Auswertung: docs/ratsmanuale-namen-auswertung.md.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { rmEntitySpansFromXml } from "./parser.ts";
import { rmPersonCore, rmPlaceLookup, rmTokens, givenOf, type RmNamesData } from "./rmNames.ts";
import { foldText } from "./vendor/entityKey.ts";
import { walkData } from "./walker.ts";

/** Kuratiert: RM-Ortsschlüssel → heutiger Name ("" = Gattungswort, fällt weg). */
const CURATED = `
bern=Bern; barn=Bern; baden=Baden; otenbach=Ötenbach; basel=Basel; kiburg=Kyburg; glarus=Glarus
welenberg=Wellenberg; st galen=St. Gallen; galen=St. Gallen; wintertur=Winterthur; lukern=Luzern; luzern=Luzern
stein=Stein; schafhausen=Schaffhausen; schafhusen=Schaffhausen; andelfingen=Andelfingen; eglisau=Eglisau
gruningen=Grüningen; gruning=Grüningen; knonau=Knonau; knono=Knonau; horgen=Horgen; frauenfeld=Frauenfeld
fraunfeld=Frauenfeld; zug=Zug; sweiz=Schwyz; soloturn=Solothurn; kostanz=Konstanz; konstanz=Konstanz
kusnacht=Küsnacht; genf=Genf; wadenswil=Wädenswil; wadeswil=Wädenswil; wadiswil=Wädenswil; wedenswil=Wädenswil
wediswil=Wädenswil; wedeswil=Wädenswil; regensberg=Regensberg; lauis=Lugano; turgau=Thurgau; turgou=Thurgau
turgeu=Thurgau; turgaus=Thurgau; turgo=Thurgau; turga=Thurgau; meilen=Meilen; uri=Uri; togenburg=Toggenburg
zurich=Zürich; hong=Höngg; swiz=Schwyz; frankreich=Frankreich; frankrich=Frankreich; bremgarten=Bremgarten
eitgnoschaft=Eidgenossenschaft; eidgnoschaft=Eidgenossenschaft; eidsgenosenschaft=Eidgenossenschaft
eidgenosenschaft=Eidgenossenschaft; eidgenoschaft=Eidgenossenschaft; raperswil=Rapperswil; arau=Aarau
bulach=Bülach; rheintal=Rheintal; rintal=Rheintal; rhintal=Rheintal; wiedikon=Wiedikon; lugarus=Locarno
laufen=Laufen; sargans=Sargans; weinfelden=Weinfelden; winfelden=Weinfelden; diesenhofen=Diessenhofen
altsteten=Altstetten; greifense=Greifensee; grifense=Greifensee; kapel=Kappel; apenzel=Appenzell; ruti=Rüti
zolikon=Zollikon; hotingen=Hottingen; embrach=Embrach; freiburg=Freiburg; friburg=Freiburg; einsidlen=Einsiedeln
grosen munster=Grossmünster; flach=Flaach; sax=Sax; wald=Wald; birmenstorf=Birmensdorf; strasburg=Strassburg
arbon=Arbon; richtenswil=Richterswil; regenstorf=Regensdorf; dubendorf=Dübendorf; uster=Uster; kloten=Kloten
rumlang=Rümlang; hedingen=Hedingen; talwil=Thalwil; spanweid=Spanweid; stafen=Stäfa; stafa=Stäfa
punten=Graubünden; hirslanden=Hirslanden; bischofzel=Bischofszell; lindau=Lindau; elg=Elgg; osingen=Ossingen
wetingen=Wettingen; martalen=Marthalen; holand=Holland; zurzach=Zurzach; steineg=Steinegg
wolishofen=Wollishofen; biel=Biel; manedorf=Männedorf; menedorf=Männedorf; manidorf=Männedorf
mulhausen=Mülhausen; mulhusen=Mülhausen; dorflingen=Dörflingen; tos=Töss; st jakob=St. Jakob; preusen=Preussen
stamheim=Stammheim; stokach=Stockach; glatfelden=Glattfelden; brug=Brugg; regensburg=Regensburg
wulflingen=Wülflingen; otelfingen=Otelfingen; eg=Egg; riespach=Riesbach; zuchtaus=Zuchthaus; sulz=Sulz
underwalden=Unterwalden; unterwalden=Unterwalden; feurtalen=Feuerthalen; stadel=Stadel; bonsteten=Bonstetten
maswanden=Maschwanden; neun turm=Neuer Turm; neuen turm=Neuer Turm; nuen turn=Neuer Turm; neuen turn=Neuer Turm
nouen turn=Neuer Turm; erlibach=Erlenbach; ehrlibach=Erlenbach; meiland=Mailand; mailand=Mailand
swamendingen=Schwamendingen; ulm=Ulm; baserstorf=Bassersdorf; ruschlikon=Rüschlikon; bubikon=Bubikon
kilchberg=Kilchberg; wezikon=Wetzikon; langnau=Langnau; hinwil=Hinwil; sebach=Seebach; wien=Wien
trulikon=Trüllikon; utikon=Uetikon; pfefikon=Pfäffikon; pfafikon=Pfäffikon; altikon=Altikon; ramsen=Ramsen
afholteren=Affoltern; afolteren=Affoltern; buchs=Buchs; altorf=Altdorf; walis=Wallis
niderweningen=Niederweningen; pfin=Pfyn; chur=Chur; mendris=Mendrisio; mandris=Mendrisio; wangen=Wangen
heidelberg=Heidelberg; winingen=Weiningen; benken=Benken; schonau=Schönau; lenzburg=Lenzburg; insprug=Innsbruck
tur=Thur; rheinau=Rheinau; rinau=Rheinau; rhinau=Rheinau; engeland=England; stadelhofen=Stadelhofen
st peter=St. Peter; rafz=Rafz; elikon=Ellikon; flunteren=Fluntern; tobel=Tobel; venedig=Venedig
dietikon=Dietikon; urdorf=Urdorf; dielstorf=Dielsdorf; weiach=Weiach; rheineg=Rheineck; neftenbach=Neftenbach
frau munster=Fraumünster; melingen=Mellingen; neunburg=Neuenburg; fischingen=Fischingen; sil=Sihl
turbental=Turbenthal; oberwintertur=Oberwinterthur; kempten=Kempten; swaben=Schwaben; oberglat=Oberglatt
wisendangen=Wiesendangen; metmensteten=Mettmenstetten; niderdorf=Niederdorf; adorf=Aadorf; selnau=Selnau
landenberg=Landenberg; dietlikon=Dietlikon; oberwil=Oberwil; wipkingen=Wipkingen; wipchingen=Wipkingen
rhein=Rhein; riferswil=Rifferswil; pfalz=Pfalz; lion=Lyon; esch=Aesch; gosau=Gossau; husen=Hausen
sirnach=Sirnach; oberieden=Oberrieden; nurenberg=Nürnberg; schlieren=Schlieren; brandenburg=Brandenburg
adliswil=Adliswil; hochfelden=Hochfelden; busnang=Bussnang; zeughaus=Zeughaus; augst=Augst; elsas=Elsass
gutingen=Güttingen; komo=Como; albis=Albis; munsterhof=Münsterhof; stalikon=Stallikon; paris=Paris
ermatingen=Ermatingen; hegi=Hegi; baretswil=Bäretswil; kornhus=Kornhaus; zel=Zell; schonenberg=Schönenberg
siterdorf=Sitterdorf; rorbas=Rorbas; augsburg=Augsburg; waldshut=Waldshut; maur=Maur; haus zu st jakob=St. Jakob
fischental=Fischenthal; cham=Cham; swerzenbach=Schwerzenbach; rikenbach=Rickenbach; basadingen=Basadingen
klingnau=Klingnau; waliselen=Wallisellen; kernwald=Kernwald; lachen=Lachen; durnten=Dürnten
huntwangen=Hüntwangen; altstaten=Altstätten; stekboren=Steckborn; rogwil=Roggwil; ebmatingen=Ebmatingen
wilen=Wilen; horgerberg=Horgerberg; keiserstul=Kaiserstuhl; goldbach=Goldbach; berlin=Berlin; dorlikon=Dorlikon
nusbaumen=Nussbaumen; apenzel a r=Appenzell Ausserrhoden; engi=Enge; meintal=Maggiatal; hirzel=
weningen=; otikon=Ötikon; stat=; rathus=; rathaus=; ratus=; rataus=; rat haus=; spital=; spitahl=
gmeind=; land=; dorf=; herschaft=; ober=; zu=; da=; dem=; auf=; alten=; feld=; burg=; hof=; tal=; turm=; turn=
munster=; mur=; wisen=; oberen stras=; st=; buch=; weilen=
werdenberg=Werdenberg; wirtenberg=Württemberg; hutlingen=Hüttlingen; menzingen=Menzingen; memingen=Memmingen
marstaten=Märstetten; werikon=Werrikon; nelenburg=Nellenburg; kasel=Kassel; ravensburg=Ravensburg
schelenberg=Schellenberg; rudlingen=Rüdlingen; apenzel i r=Appenzell Innerrhoden; reutlingen=Reutlingen
neuenburg=Neuenburg; rieden=Rieden; bernang=Berneck; balgach=Balgach; berneg=Bernegg; otwil=Oetwil; sulgen=Sulgen
altnau=Altnau; wartau=Wartau; uberlingen=Überlingen; morsburg=Mörsburg; egnach=Egnach; gronenbach=Grönenbach
tiengen=Tiengen; gachnang=Gachnang; marpach=Marbach; bunten=Graubünden; punt=Graubünden; goldenberg=Goldenberg
gotlieben=Gottlieben; kreuzlingen=Kreuzlingen; bar=Baar; limat=Limmat; mulheim=Müllheim; uznach=Uznach
zurichse=Zürichsee; piemont=Piemont; schlat=Schlatt; schafhus=Schaffhausen; muri=Muri; belenz=Bellinzona
savoi=Savoyen; waisenhaus=Waisenhaus; walenstat=Walenstadt; uisen=Uhwiesen; rhin=Rhein; afeltrangen=Affeltrangen
glat=Glatt; st blasi=St. Blasien; st blasien=St. Blasien; stein am rhin=Stein am Rhein; stein am rhein=Stein am Rhein
rorschach=Rorschach; roschach=Rorschach; rheinfelden=Rheinfelden; sardinien=Sardinien; zughus=Zeughaus
urzlikon=Uerzlikon; niderhaslen=Niederhasli; elgou=Elgg; elgo=Elgg; herbishofen=Herbishofen; frankfurt=Frankfurt
burglen=Bürglen; tagerfelden=Tegerfelden; furstenberg=Fürstenberg; osterich=Österreich; rotwil=Rottweil
ebertswil=Ebertswil; egliso=Eglisau; eglis=Eglisau; mazingen=Matzingen; lustorf=Lustdorf; laufenburg=Laufenburg
brifense=Greifensee; askona=Ascona; sihl=Sihl; italien=Italien; kadelburg=Kadelburg; munsterlingen=Münsterlingen
berner gebiet=Bern; stampfenbach=Stampfenbach; meienfeld=Maienfeld; ragaz=Bad Ragaz; st margreten=St. Margrethen
buslingen=Büsslingen; halwil=Hallwil; nurenstorf=Nürensdorf; rafzerfeld=Rafzerfeld; neuamt=Neuamt
unteren freien amteren=Freiamt; jonen=Jonen; gros britanien=Grossbritannien; glatbrug=Glattbrugg; keswilen=Kesswil
kesweilen=Kesswil; underen stras=Unterstrass; senwald=Sennwald; kapelerhof=Kappelerhof; pfefers=Pfäfers
wurenlos=Würenlos; huningen=Hüningen; haus st jakob=St. Jakob; feldbach=Feldbach; scherzingen=Scherzingen
liechtensteig=Lichtensteig; baden durlach=Baden-Durlach; oberhaslen=Oberhasli; silbrug=Sihlbrugg; kaperswil=Rapperswil
unterwalden ob dem kernwald=Obwalden
schanz=; widen=; birch=; rahtaus=; pfar=; bach=; grafschaft=; burgen=; ambt=; hard=; rat=; gemeind=; salis=; haus=
der=; riet=; hesen=; sar=; alment=; die=; frau=; herberig=; wat=; hag=; quartier=; hiesiger stat=; muli=; nach=
stamen=; rumlingen=; laus=; swil=; sen=; ur=; bei=; apenzel u r=; rut=; in=; salz=; oberen=; religion=; linden=
landvogtei=; kalwil=; hofingen=; wolenberg=; abt=; am=
`;

/**
 * Ähnliche Schreibungen (Editierabstand), von Hand geprüft 2026-11-16 an den häufigsten
 * Kandidaten: nur diese gelten. Abgelehnt u. a. Werdenberg → Wellenberg, Wirtenberg →
 * Winterberg, Hessen → Hausen, Ravensburg → Regensburg, Memmingen/Menzingen → Mellingen;
 * die echten Orte stehen oben in der kuratierten Liste.
 */
const FUZZY_ALLOW = new Set(`maintal martelen schoflistorf richtiswil niderglat kusnach kostenz silwald kibung mandorf sargaus
insbrug eidsgenoschaft benkhen wiach nuen_turm greifensen afholtern furtalen neunturm wislingen felanden stefen barentswil
reintal dinhart stambheimb rhineg neun_turn ortenbach mendorf grunigen knonou kornhaus fraumunster brembgarten frankhrich
andelfing kaiserstuhl muhlhausen lanis arben nouen_turm grosenmunster gosan rorbis langwisen oten_bach rambsen fr_munster
glaus wolischofen eglisou frauenfelt wolflingen feiburg turger fraun_feld diebendorf groningen stefa naftenbach
ober_wintertur delikon alsteten stamheimb keiserstuhl stafan volkentswil horger_berg regenberg horgenberg frowenfeld solotun
schaf_hausen mailant waltelingen bischofel regenburg soloturm fuhrtalen wilberg angsburg niederdorf stamhein
ehrlenbach landemberg obern_stras humbrechtikon fehr_altorf welen_berg klein_andelfingen ober_stamheim waden_swil stafe
emberach lugern greifenser einsiedlen munchaltorf garus franenfeld abenzel ober_glat weitertur meilant kaiserstul senbach
hombrachtikon waltshut albis_rieden frauen_munster hus_zu_st_jakob metmenstaten kiberg waderswil fraunfelt st_gelen
munch_altorf winterter kembten wietertur stekbohren schafhauser luhern wintertun steinmur obenbach turgen
wurtenberg wurtemberg marsteten atliswil lukarus frauenmunster fraufeld turgan reuti zunikon metmansteten enbrach solotur
unterwelden gruninger diesen_hofen durten diestorf udorf schafhaus lutern windlich nuenturn frauen_feld neuenturn bastel
eglisan birmen_storf hieslanden falenden waserkingen frau_enfeld bonstaten schafhause luzer obereden luker horger stanheim
ober_meilen pfein otembach weden_swil schlinikon`
  .split(/\s+/).filter(Boolean).map((k) => k.replace(/_/g, " ")));

/** Wohnorte des KRDB-Registers, die in RM meist Gattungswörter sind. */
const KRDB_GENERIC = new Set(["dorf", "sen", "berg", "au", "feld", "huten", "tal", "wald", "husen", "hof", "bach", "buch", "zel"]);
/** «von X» ohne Familiennamen. */
const VON_STOP = new Set(["daselbst", "daselbsten", "hier", "hie", "da", "dannen", "dort", "selbst", "uns", "inen", "ime", "ihm", "ihnen", "im",
  // Orte, die das NER als «von X» allein für eine Person hielt
  "horgen", "osterrich", "pfafers", "schannis", "wyl", "thurm"]);

const fold = (w: string) => foldText(w);
const cap = (w: string) => w.slice(0, 1).toUpperCase() + w.slice(1);

function editDistance(a: string, b: string): number {
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

/** «Affoltern a. A.» → «Affoltern am Albis» (wie normalizePlaceAbbr im Katalog-Aufbau). */
function placeAbbr(s: string): string {
  return s
    .replace(/\ba\.\s*A\./g, "am Albis")
    .replace(/\ba\.\s*S\./g, "am See")
    .replace(/\ba\.\s*I\./g, "am Irchel")
    .replace(/\ba\.\s*d\.\s*Th(?:ur|\.)/g, "an der Thur")
    .replace(/\ba\.\s*d\.\s*L(?:immat|\.)/g, "an der Limmat")
    .replace("b/", "bei ")
    .replace(/\s+/g, " ")
    .trim();
}

function inc<K>(m: Map<K, number>, k: K, n = 1): void {
  m.set(k, (m.get(k) ?? 0) + n);
}

function top<K>(m: Map<K, number>): K | undefined {
  let best: K | undefined;
  let bestN = -1;
  for (const [k, n] of m) {
    if (n > bestN || (n === bestN && String(k) < String(best))) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function arg(name: string, fallback: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  const v = a ? a.slice(name.length + 3) : fallback;
  return v.replace(/^~(?=$|\/)/, homedir());
}

async function main(): Promise<void> {
  const dataDir = arg("data", "~/zszh-rm/tei");
  const reportDir = arg("report", "");
  const outFile = new URL("./rmNames.data.json", import.meta.url);

  // 1. Spans sammeln
  const persons: string[] = [];
  const placeSpans = new Map<string, number>();
  const placeDocs = new Map<string, Set<string>>();
  const placeForms = new Map<string, Map<string, number>>();
  let files = 0;
  for await (const file of walkData({ dataDir, series: ["RM"] })) {
    const doc = file.relPath.replace(/^.*\//, "").replace(/\.xml$/, "");
    for (const span of rmEntitySpansFromXml(await readFile(file.absPath, "utf-8"))) {
      if (span.tag === "persName") persons.push(span.text);
      else if (span.tag === "placeName") {
        const look = rmPlaceLookup(span.text);
        if (!look) continue;
        inc(placeSpans, look.key);
        let docs = placeDocs.get(look.key);
        if (!docs) placeDocs.set(look.key, (docs = new Set()));
        docs.add(doc);
        let forms = placeForms.get(look.key);
        if (!forms) placeForms.set(look.key, (forms = new Map()));
        inc(forms, look.rf);
      }
    }
    if (++files % 10_000 === 0) console.log(`[rm-names] ${files} Sitzungen …`);
  }
  console.log(`[rm-names] ${files} Sitzungen, ${persons.length} Personen-Spans, ${placeSpans.size} Ortsschlüssel`);
  if (files < 1000) throw new Error(`nur ${files} RM-Sitzungen unter ${dataDir} – falscher Ordner?`);

  // 2. Familiennamen mit Partikel
  const vonCount = new Map<string, number>();
  for (const text of persons) {
    const ws = rmTokens(text);
    if (ws.length !== 2) continue;
    const [a, b] = ws.map(fold);
    if (["von", "vom", "zur", "zum"].includes(a) && /^\p{Lu}/u.test(ws[1]) && !VON_STOP.has(b)) inc(vonCount, `${a} ${b}`);
  }
  const von = new Set([...vonCount].filter(([, n]) => n >= 5).map(([k]) => k));

  // 3. Nachnamen: Zählung der letzten Namenswörter, Grundform, Schreibung
  const lastCount = new Map<string, number>();
  const lastForms = new Map<string, Map<string, number>>();
  const fullLast = new Set<string>();
  for (const text of persons) {
    const { name } = rmPersonCore(text, von);
    if (name.length === 0) continue;
    const last = name[name.length - 1];
    const f = fold(last);
    inc(lastCount, f);
    let forms = lastForms.get(f);
    if (!forms) lastForms.set(f, (forms = new Map()));
    inc(forms, last);
    if (name.length >= 2 && name.slice(0, -1).some((w) => givenOf(w))) fullLast.add(f);
  }
  const base = (w: string): string => {
    const f = fold(w);
    if (f.length < 5) return w;
    const own = lastCount.get(f) ?? 0;
    for (const suf of ["ens", "ins", "en", "in", "n", "s", "e"]) {
      if (f.endsWith(suf) && f.length - suf.length >= 3) {
        if ((lastCount.get(f.slice(0, -suf.length)) ?? 0) >= Math.max(3, own)) return w.slice(0, -suf.length);
      }
    }
    // Frauenform «Greblin» zu «Grebel»
    if (f.endsWith("lin") && (lastCount.get(`${f.slice(0, -3)}el`) ?? 0) >= Math.max(3, own)) return `${w.slice(0, -3)}el`;
    return w;
  };
  const skel = (w: string) =>
    fold(w)
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/ph/g, "f").replace(/th/g, "t")
      .replace(/dt/g, "t").replace(/ck/g, "k").replace(/c(?!h)/g, "k").replace(/y/g, "i")
      .replace(/([b-df-hj-np-tv-z])\1+/g, "$1").replace(/tz/g, "z").replace(/rd/g, "rt");
  const skelForms = new Map<string, Map<string, number>>();
  for (const [, forms] of lastForms) {
    for (const [w, n] of forms) {
      const b = cap(base(w));
      let m = skelForms.get(skel(b));
      if (!m) skelForms.set(skel(b), (m = new Map()));
      inc(m, b, n);
    }
  }
  const surnames: Record<string, string> = {};
  for (const f of [...fullLast].sort()) {
    const forms = lastForms.get(f);
    if (!forms) continue;
    const w = top(forms) as string;
    const b = cap(base(w));
    const canon = top(skelForms.get(skel(b)) ?? new Map([[b, 1]])) ?? b;
    if ([...forms.keys()].some((s) => cap(s) !== canon)) surnames[f] = canon;
  }

  // 4. Ortsverzeichnis: kuratiert, KRDB-Wohnorte, ähnliche Schreibungen
  const places = new Map<string, string>();
  for (const part of CURATED.replace(/\n/g, ";").split(";")) {
    const p = part.trim();
    if (!p) continue;
    const [k, v] = p.split("=");
    places.set(k.trim(), (v ?? "").trim());
  }
  const curatedN = places.size;
  const krdb = JSON.parse(await readFile(new URL("./krdb/krdb-register.json", import.meta.url), "utf-8")) as {
    persons?: Array<{ places?: Array<[string, ...unknown[]]> }>;
  };
  const krdbNames = new Set<string>(["Zürich", "Winterthur"]);
  for (const p of krdb.persons ?? []) {
    for (const [name] of p.places ?? []) {
      const n = placeAbbr(String(name).replace("§", ""));
      if (n && !/^Zürich\s+\S+$/.test(n) && /^\p{Lu}/u.test(n)) krdbNames.add(n);
    }
  }
  const krdbAdded: string[] = [];
  for (const name of [...krdbNames].sort()) {
    const look = rmPlaceLookup(name);
    if (!look || places.has(look.key) || KRDB_GENERIC.has(look.key) || !placeSpans.has(look.key)) continue;
    places.set(look.key, name);
    krdbAdded.push(`${look.key}\t${name}\t${placeSpans.get(look.key)}\t${placeDocs.get(look.key)?.size ?? 0}`);
  }
  const mapped = [...places].filter(([, v]) => v).map(([k]) => k);
  const fuzzy: Array<{ key: string; target: string; name: string; spans: number; docs: number; forms: string; taken: boolean }> = [];
  for (const [key, spans] of placeSpans) {
    if (places.has(key) || spans < 2 || key.replace(/ /g, "").length < 5) continue;
    if (key.endsWith("s") && places.has(key.slice(0, -1))) continue;
    const lim = key.length >= 9 ? 2 : 1;
    let best = 99;
    let hit: string | null = null;
    let ambiguous = false;
    for (const c of mapped) {
      if (c[0] !== key[0] || Math.abs(c.length - key.length) > 2) continue;
      const d = editDistance(key, c);
      if (d > lim) continue;
      if (d < best) {
        best = d;
        hit = c;
        ambiguous = false;
      } else if (d === best && hit && places.get(c) !== places.get(hit)) ambiguous = true;
    }
    if (!hit || ambiguous) continue;
    const forms = [...(placeForms.get(key) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 4);
    fuzzy.push({
      key,
      target: hit,
      name: places.get(hit) as string,
      spans,
      docs: placeDocs.get(key)?.size ?? 0,
      forms: forms.map(([f, n]) => `${f.replace(/\s+/g, " ")} ${n}`).join(", "),
      taken: FUZZY_ALLOW.has(key),
    });
  }
  for (const f of fuzzy) if (f.taken) places.set(f.key, f.name);
  const missing = [...FUZZY_ALLOW].filter((k) => !fuzzy.some((f) => f.key === k && f.taken));
  if (missing.length > 0) console.warn(`[rm-names] geprüfte ähnliche Schreibungen ohne Kandidat: ${missing.join(", ")}`);

  // 5. Schreiben
  const sortObj = (m: Iterable<[string, string]>) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const data: RmNamesData = {
    version: 1,
    places: sortObj(places),
    surnames: sortObj(Object.entries(surnames)),
    vonSurnames: [...von].sort(),
  };
  await writeFile(outFile, `${JSON.stringify(data, null, 0).replace(/,"/g, ',\n"')}\n`, "utf-8");
  console.log(
    `[rm-names] places ${places.size} (kuratiert ${curatedN}, KRDB ${krdbAdded.length}, ähnlich ${fuzzy.filter((f) => f.taken).length} ` +
      `von ${fuzzy.length} Kandidaten), ` +
      `surnames ${Object.keys(surnames).length}, vonSurnames ${von.size} → ${outFile.pathname}`,
  );
  if (reportDir) {
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "places-krdb.tsv"), `key\tname\tspans\tdocs\n${krdbAdded.join("\n")}\n`);
    fuzzy.sort((a, b) => b.spans - a.spans);
    await writeFile(
      join(reportDir, "places-fuzzy.tsv"),
      `key\tname\tvia\ttaken\tspans\tdocs\tforms\n${fuzzy.map((f) => `${f.key}\t${f.name}\t${f.target}\t${f.taken ? "ja" : "nein"}\t${f.spans}\t${f.docs}\t${f.forms}`).join("\n")}\n`,
    );
    const unmapped = [...placeSpans]
      .filter(([k]) => !places.has(k) && !(k.endsWith("s") && places.has(k.slice(0, -1))))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 600);
    await writeFile(
      join(reportDir, "places-unmapped.tsv"),
      `key\tspans\tdocs\tforms\n${unmapped
        .map(([k, n]) => {
          const forms = [...(placeForms.get(k) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 4);
          return `${k}\t${n}\t${placeDocs.get(k)?.size ?? 0}\t${forms.map(([f, c]) => `${f.replace(/\s+/g, " ")} ${c}`).join(", ")}`;
        })
        .join("\n")}\n`,
    );
    console.log(`[rm-names] Bericht in ${reportDir}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
