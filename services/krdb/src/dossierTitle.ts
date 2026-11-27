/**
 * Name, Lebensjahre und Amtszeiten aus dem Titel eines Personendossiers im Archivkatalog
 * («Nachname, Vorname (Lebensjahre), Beruf \ Partei, Kantonsrat 1973-1979»). Pur, unit-getestet in
 * dossierTitle.test.ts; genutzt von z1114Match.ts und services/catalog (krdbAssign.ts).
 */

export interface DossierName {
  last: string;
  first: string;
  born?: number;
  died?: number;
}

/** Dossiertitel «Abplanalp, Peter (1936-2005), Malermeister \ SVP, …» bzw.
 *  «Achermann, Christian (geb. 1945), …» → Name und Lebensjahre. Titel und
 *  Zusätze (Dr. med., lic. iur.) nach dem Vornamen fallen weg. */
export function parseDossierName(title: string): DossierName | null {
  // Lebensjahre fehlen selten («Förtsch, Peter, Unternehmensberater \ …»),
  // ebenso das Komma («Zweifel Paul (geb. 1936), …»).
  const m =
    /^\s*([^,(\\]+),\s*([^(\\]+?)\s*\(([^)]*)\)/.exec(title) ??
    /^\s*([^,(\\]+),\s*([^,(\\]+)/.exec(title) ??
    /^\s*([^\s,(\\]+)\s+([^\s,(\\]+)\s*\(([^)]*)\)/.exec(title);
  if (!m) return null;
  const first = m[2]
    .split(",")[0]
    .replace(/\b(Dr|Prof|lic|med|iur|phil|oec|rer|pol|sc|nat|dipl|Ing)\b\.?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!first) return null;
  const life = m[3] ?? "";
  const span = /(\d{4})\s*-\s*(\d{4})/.exec(life);
  const geb = /geb\.\s*(\d{4})/.exec(life);
  return {
    last: m[1].trim(),
    first,
    born: span ? Number(span[1]) : geb ? Number(geb[1]) : undefined,
    died: span ? Number(span[2]) : undefined,
  };
}

export interface DossierTerm {
  council: "Kantonsrat" | "Regierungsrat";
  from: number;
  /** null = offen («Kantonsrat ab 1996»). */
  to: number | null;
}

/** Amtszeiten aus dem Dossiertitel («SP, Kantonsrat 1973-1979», «Kantonsrat ab 1996»,
 *  «Kantonsrätin 1987-1995, Regierungsrätin 1995-2007»). */
export function parseDossierTerms(title: string): DossierTerm[] {
  const out: DossierTerm[] = [];
  for (const m of title.matchAll(/\b(Kantonsr|Regierungsr)(?:at|ätin)\s+(?:ab\s+)?(\d{4})(?:\s*-\s*(\d{4}))?/g)) {
    out.push({
      council: m[1] === "Kantonsr" ? "Kantonsrat" : "Regierungsrat",
      from: Number(m[2]),
      to: m[3] ? Number(m[3]) : /\bab\s+\d{4}/.test(m[0]) ? null : Number(m[2]),
    });
  }
  return out;
}
