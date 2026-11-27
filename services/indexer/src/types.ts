// Gemeinsame Typen für den Indexer.

export type SeriesAbbr = "ABl" | "KRP" | "OS" | "RRB" | "RM";

export const ALL_SERIES: SeriesAbbr[] = ["ABl", "KRP", "OS", "RRB", "RM"];

/**
 * Serien ohne Embeddings: Der Indexer schreibt für sie immer `jina_de: null`
 * und fragt den embed-Service nicht an. RM (Ratsmanuale 1552–1798): jina
 * versteht das Frühneuhochdeutsch nicht (Plan E10), die erste Stufe ist
 * bewusst rein lexikalisch.
 */
export const UNEMBEDDED_SERIES: ReadonlySet<SeriesAbbr> = new Set<SeriesAbbr>(["RM"]);

/**
 * Eine Querverweis-Relation aus `<sourceDesc><bibl><listRelation><relation>`.
 * `name` ist der Relations-Typ (z. B. "Änderung_von", "Fortsetzung_siehe"),
 * `targetId` die Staatsarchiv-Katalog-ID des Zieldokuments (aus dem `passive`-
 * Attribut), `url` die volle Katalog-URL als externer Fallback-Link. `targetId`
 * lässt sich gegen `archiveId` anderer Dokumente joinen → interner Link.
 */
export interface DocRelation {
  name: string;
  targetId: number | null;
  url: string;
}

/**
 * Aus einem TEI-Header extrahierte Felder. Ist 1:1-Quelle für MeiliDoc.
 * Body wird separat als Plaintext und als TeiTree gehalten, weil der Render-
 * Transformer auf dem Tree arbeitet, der Indexer aber nur den Plaintext braucht.
 */
export interface TeiMetadata {
  /** Eindeutige ID, abgeleitet aus dem Dateipfad (ohne `.xml`-Suffix). */
  id: string;
  series: SeriesAbbr;
  /** Relativer Pfad zur Datei, ausgehend vom data-Root des zszh-data-Repos. */
  relativePath: string;
  title: string;
  /**
   * Titel als Suchtext (ß → ss, searchText.ts), nur durchsuchbar; null, wenn er sich vom
   * Titel nicht unterscheidet. `title` bleibt im Original.
   */
  titleSearch: string | null;
  /** Sort-Variante des Titels (lowercased, normalisiert). */
  titleSort: string;
  /** ISO 8601 Datum (YYYY-MM-DD) oder null wenn nicht vorhanden. */
  date: string | null;
  /** Jahr aus date abgeleitet, oder aus Filename als Fallback. */
  dateYear: number | null;
  /** Für OS-Serie: Volume-Nummer (z. B. 40). */
  volumeNr: number | null;
  /**
   * OS-Ordnungsnummer (LS-Loseblatt-Systematik, ab 1981, z. B. "632.31").
   * String, weil die Systematik Punkt-Notation nutzt; Integer würde Nachkomma
   * verlieren.
   */
  serialNr: string | null;
  /**
   * RRB-Beschluss-Identifier im Format "JJJJ/NNNN" (z. B. "1803/0003").
   * Aus `<sourceDesc><bibl><ident>StAZH MM 1.1 RRB 1803/0003</ident>` oder als
   * Fallback aus dem Dateinamen `..._RRB_<Jahr>_<NNNN>` extrahiert. Läuft pro
   * Jahr neu, ist also nur zusammen mit dem Jahr eindeutig – das Format trägt
   * das Jahr aber bereits mit.
   */
  resolutionId: string | null;
  /** Erste Seite des Dokuments (für OS-Sortierung relevant). */
  startPg: number | null;
  /** StAZH-Identifier aus `<bibl><ident>`, z. B. "StAZH OS 40 (S. 511-513)". */
  stazhIdent: string | null;
  /** Externe Archiv-URL aus `<bibl><ref @target>`, falls vorhanden. */
  archiveLink: string | null;
  /**
   * IIIF-Presentation-Manifest-URL für die Detail-Seite. Frontend lädt direkt.
   * - Lokal generiert (ABl mit `<surface>`): `/iiif/{abbr}/{id}/manifest.json`
   * - Extern (OS/KRP/RRB mit `<bibl><figure><graphic url="*.pdf">`):
   *   `https://zszh.sources-online.org/manifests/{abbr}/{base}/info.json`
   * - null wenn kein Faksimile
   */
  manifestUrl: string | null;
  /**
   * Optionaler Teilbestands-Marker für born-digital Spätbestände:
   * - "krp-late": KRP-Gever-Traktanden (`data/KRP/KRP_late/`, `<edition>` enthält "Gever").
   * - "rrb-late": RRB von zh.ch ab Okt. 2008 (`data/RRB/RRB_late/`, pfadbasiert).
   * - "os-late": OS von ZH-Lex ab 1999 (`data/OS/OS_late/`, pfadbasiert).
   * Sonst null. Ermöglicht sauberes Filtern/Löschen/Kennzeichnen dieser
   * explorativen Teilbestände ohne den kuratierten Altbestand anzufassen.
   */
  subset: string | null;
  /**
   * Staatsarchiv-Katalog-ID aus `archiveLink` (`…detail.aspx?ID=<n>`), als Zahl.
   * Join-Schlüssel für `relations.targetId` → interne Querverweis-Links.
   * null, wenn kein archiveLink (z. B. born-digital Spätbestände).
   */
  archiveId: number | null;
  /**
   * Querverweise auf verwandte Dokumente aus `<bibl><listRelation>`. Leeres
   * Array, wenn keine vorhanden (nur KRP- + OS-Altbestand pflegen sie).
   */
  relations: DocRelation[];
}

/**
 * Was an Meilisearch geht. _vectors wird vom embed-Pipeline-Stage gefüllt.
 */
export interface MeiliDoc extends TeiMetadata {
  /** Plaintext aus `<tei:text>` als Suchtext (ß → ss), gecuttet auf MAX_BODY_BYTES. */
  body: string;
  /**
   * Unique Personen-Namen (Surface-Form, normalisiert) aus `<persName>`-Tags
   * im Body, ohne `type="deriv"`. Sortiert. Für Filter-Facetten in Meili.
   */
  persons: string[];
  /** Wie persons, aus `<placeName>`. */
  places: string[];
  /** Wie persons, aus `<orgName>`. */
  organizations: string[];
  /**
   * Vergleichsschlüssel zu persons (Fassung 2 von entityKey.ts, ohne Dubletten,
   * sortiert, leer ohne Schlüssel; entityKeyFields.ts). Ein Namensfilter der
   * Web-App trifft die Form ODER denselben Schlüssel. Nur filterable.
   */
  personKeys: string[];
  /** Wie personKeys, zu places. */
  placeKeys: string[];
  /** Wie personKeys, zu organizations. */
  orgKeys: string[];
  /**
   * Nur KRP: Rats- und Regierungsmitglieder (KRDB-Personen-IDs, aufsteigend), die
   * dem Dokument zugeordnet sind – Namenserkennung + Vollnamen aus Titel/Text
   * (krdbFields.ts). Grundlage der Personenseiten; filterable.
   */
  krdbIds?: number[];
  /** Nur KRP: Teilmenge von krdbIds, die im Titel genannt ist (Vorstösse, Anträge). */
  krdbTitleIds?: number[];
  /** Optional: gefüllt vom embed-Pipeline-Stage. */
  _vectors?: { jina_de: number[] };
}

export interface PageBreak {
  /** Wert aus @n. */
  n: string;
  /** Wert aus @facs ohne führendes "#". Null wenn nicht vorhanden. */
  facs: string | null;
}

export interface Surface {
  /** Wert aus @xml:id. */
  id: string;
  /** Wert aus child `<graphic>/@url`. */
  graphicUrl: string | null;
  /** Maße aus `<graphic>/@width`/`@height`, in Pixel. */
  width: number | null;
  height: number | null;
}

/**
 * Ergebnis eines vollen Datei-Parses. Wird gemeinsam von Render und IIIF-Builder
 * konsumiert.
 */
export interface ParsedTei {
  meta: TeiMetadata;
  /** Plaintext für Meili-Body. Bereits auf MAX_BODY_BYTES geclipt. */
  body: string;
  /** Unique Personen-Namen (Surface-Form, sortiert) aus `<persName>` im Body. */
  persons: string[];
  /** Unique Orte aus `<placeName>` im Body. */
  places: string[];
  /** Unique Organisationen aus `<orgName>` im Body. */
  organizations: string[];
  pageBreaks: PageBreak[];
  surfaces: Surface[];
  /**
   * URL aus `<bibl><figure><graphic url="…"/></figure></bibl>`. Wird zur
   * IIIF-Auflösung benutzt: endet auf `.pdf` → externes Manifest, sonst lokal.
   */
  biblGraphicUrl: string | null;
  /** Rohes XML der Datei. render-Transformer parst hieraus mit preserveOrder=true. */
  rawXml: string;
}
