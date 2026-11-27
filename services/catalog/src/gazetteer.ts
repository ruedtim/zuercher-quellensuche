/**
 * Ortsverzeichnis für die Erschliessungsregeln (ruleEntities.ts): Zürcher Gemeinden,
 * ehemalige Gemeinden, Ortsteile und Distrikte. Entsteht bei jedem Aufbau, nichts davon
 * ist committet: aus den Klassen der nach Gemeinden gegliederten Bestände (Gemeindearchive,
 * Zivilstandswesen, Wirtschaftswesen, Steueramt, Kirchenbücher E III, Distrikte der
 * Helvetik) und den Wohnorten im KRDB-Register. Abdeckung 2026-10-30 geprüft: von den
 * heutigen und ehemaligen Gemeinden fehlten nur Leimbach, Grafstal und Sennhof (`EXTRA`).
 * Namen, die auch Gattungswörter oder anderswo häufig sind («Wald», «Egg», «Baden»),
 * gelten nur in strengem Kontext (`strict` ohne sie). Pur, getestet in ruleEntities.test.ts.
 */

export interface Gazetteer {
  all: ReadonlySet<string>;
  /** Ohne mehrdeutige Namen: für Regeln mit schwachem Kontext («in X»). */
  strict: ReadonlySet<string>;
}

export const UP = "A-ZÄÖÜÀÁÂÈÉÊÌÍÎÒÓÔÙÚÛÇÑ";
export const LO = "a-zäöüßàáâèéêìíîòóôùúûçñëïÿœ";

const PLACE_NAME = new RegExp(
  `^(?:St\\.\\s+)?[${UP}][${LO}][${LO}\\-]*(?:-[${UP}][${LO}\\-]+)*(?:\\s+(?:am|an der|an|bei|ob|im)\\s+[${UP}][${LO}\\-]+)?$`,
  "u",
);

/** Klassentitel, die keine Orte sind. */
const STOP = new Set([
  "Armengemeinden", "Bürgergemeinde", "Friedhofsgemeinden", "Allgemeines", "Verschiedenes", "Diverses", "Abteilungen",
  "Billettsteuer", "Amnestiegesuche", "Aufsichtsbeschwerden", "Gemeinden", "Bezirke", "Stadt", "Kanton", "Akten", "Register",
  "Korrespondenz", "Protokolle", "Rekurse", "Personelles", "Finanzielles", "Statistik", "Varia", "Namen", "Diverse",
]);

/** Gemeindenamen, die auch Gattungswörter oder anderswo häufige Namen sind. */
const AMBIGUOUS = new Set([
  "Au", "Dorf", "Egg", "Wald", "Seen", "Enge", "Berg", "Zell", "Wangen", "Hütten", "Aesch", "Buchs", "Wil", "Töss", "Rheinau",
  "Balm", "Bänk", "Binz", "Forch", "Hausen", "Kempten", "Hegi", "Baden", "Bern", "Chur", "Ellikon", "Hofstetten", "Rickenbach",
  "Benken", "Bachs", "Schlatt", "Stadel", "Lindau", "Maur", "Thal",
]);

const EXTRA = ["Leimbach", "Grafstal", "Sennhof", "Zürich", "Winterthur"];

/** Bestände, deren Klassen Gemeinden sind (Präfix des Bestandsetiketts). */
const LOCAL_BESTAENDE: Array<[string, string]> = [
  ["ga", "GA Gemeindearchive"],
  ["nn", "NN 301 - NN 500"],
  ["wirtschaft", "Abteilung Wirtschaftswesen"],
  ["steuer", "Steueramt, 1899"],
];

/** KRDB-Wohnorte: «Affoltern a. A.» → «Affoltern am Albis». */
export function normalizePlaceAbbr(s: string): string {
  return s
    .replace(/\ba\.\s*A\./g, "am Albis")
    .replace(/\ba\.\s*S\./g, "am See")
    .replace(/\ba\.\s*I\./g, "am Irchel")
    .replace(/\ba\.\s*d\.\s*Th(?:ur|\.)/g, "an der Thur")
    .replace(/\ba\.\s*d\.\s*L(?:immat|\.)/g, "an der Limmat");
}

export class GazetteerBuilder {
  /** Quelle → Klassentitel. */
  private readonly classes = new Map<string, Set<string>>();
  private readonly krdb = new Set<string>();

  private addClassTitle(source: string, title: string): void {
    const set = this.classes.get(source) ?? new Set<string>();
    set.add(title.trim());
    this.classes.set(source, set);
  }

  /** Erster Durchlauf: jede Klasse mit ihrem Bestand. */
  addClass(bestand: string | null, title: string): void {
    const b = bestand ?? "";
    for (const [source, prefix] of LOCAL_BESTAENDE) if (b.startsWith(prefix)) this.addClassTitle(source, title);
    if (b.startsWith("E III Kirchenbücher")) {
      const m = /^E III \d+(?: [a-z])?\s+(.+)$/.exec(title.trim());
      if (m) this.addClassTitle("e3", m[1]);
    }
    const d = /^Distrikt\s+(.+)$/.exec(title.trim());
    if (d) this.addClassTitle("distrikt", d[1]);
  }

  addKrdbPlace(name: string): void {
    const n = normalizePlaceAbbr(name).replace("b/", "bei ").replace("§", "").replace(/\s+/g, " ").trim();
    if (n && !/^Zürich\s+\S+$/.test(n)) this.krdb.add(n);
  }

  build(): Gazetteer {
    const all = new Set<string>(EXTRA);
    const add = (name: string): void => {
      const n = name.trim();
      if (!n || STOP.has(n)) return;
      const bezirk = /^Bezirk\s+(.+?)(?:\s*\(.*\))?$/.exec(n);
      if (bezirk) return add(bezirk[1]);
      const paren = /^(.+?)\s*\((.+)\)$/.exec(n);
      if (paren) {
        add(paren[1]);
        if (paren[2] !== "ZH") add(paren[2]);
        return;
      }
      if (PLACE_NAME.test(n)) all.add(n);
    };
    // Gemeindearchive, Zivilstand, Wirtschaftswesen und Kirchenbücher sind nach Gemeinden
    // gegliedert; die Steueramt-Klassen zählen nur, wenn eine zweite Liste sie bestätigt.
    const seen = new Map<string, number>();
    for (const [source, titles] of this.classes) {
      if (source === "distrikt") continue;
      for (const t of titles) seen.set(t, (seen.get(t) ?? 0) + 1);
      if (source !== "steuer") for (const t of titles) add(t);
    }
    for (const [t, n] of seen) if (n >= 2) add(t);
    for (const t of this.classes.get("distrikt") ?? []) add(t);
    for (const p of this.krdb) add(p);
    const strict = new Set([...all].filter((p) => !AMBIGUOUS.has(p)));
    return { all, strict };
  }
}

/** Gazetteer direkt aus Ortsnamen (Tests). */
export function gazetteerOf(names: Iterable<string>): Gazetteer {
  const all = new Set(names);
  return { all, strict: new Set([...all].filter((p) => !AMBIGUOUS.has(p))) };
}
