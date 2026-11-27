import { MeiliSearch, MeiliSearchApiError, type Settings } from "meilisearch";
import { assertTaskSucceeded, isInternalCrash, type SettledTask } from "./importGuards.ts";
import { settleTaskList, type SettleResult } from "./taskSettle.ts";
import type { DocRelation, MeiliDoc } from "./types.ts";

// `synonyms` bewusst NICHT hier: die pflegt --patch-synonyms (prefixSynonyms.ts) aus dem
// Wortschatz des Index, und ensureIndex (updateSettings = PATCH) lässt sie stehen. Ein
// `synonyms` hier würde sie bei jedem Indexer-Lauf ersetzen.
export const INDEX_SETTINGS: Settings = {
  // titleSearch: der Titel mit ss statt ß (searchText.ts), nur bei Titeln mit ß gesetzt
  // und nicht angezeigt. Er steht direkt hinter `title`, damit die Regel `attribute` ihn
  // wie den Titel wertet; «nur im Titel» sucht in beiden (apps/web DOC_TITLE_FIELDS).
  searchableAttributes: ["title", "titleSearch", "body"],
  filterableAttributes: [
    "series",
    "dateYear",
    "date",
    "volumeNr",
    "serialNr",
    "resolutionId",
    "startPg",
    "id",
    // Teilbestands-Marker (z. B. "krp-late") für sauberes Filtern/Löschen.
    "subset",
    // Staatsarchiv-Katalog-ID – Join-Schlüssel für Querverweis-Auflösung
    // (relations.targetId → internes Dokument via `archiveId IN [...]`).
    "archiveId",
    // Named-Entity-Facetten (serienübergreifend, exact-match auf Surface-Form).
    "persons",
    "places",
    "organizations",
    // Vergleichsschlüssel dazu (Fassung 2 von entityKey.ts, entityKeyFields.ts): ein
    // Namensfilter trifft die Form ODER denselben Schlüssel (apps/web
    // lib/entityFilter.ts). Nur filterbar – bewusst weder displayed noch searchable.
    "personKeys",
    "placeKeys",
    "orgKeys",
    // KRP: zugeordnete Rats-/Regierungsmitglieder (KRDB-IDs) für die
    // Personenseiten; krdbTitleIds = davon im Titel genannt.
    "krdbIds",
    "krdbTitleIds",
  ],
  sortableAttributes: ["date", "dateYear", "titleSort", "startPg"],
  displayedAttributes: [
    "id",
    "series",
    "title",
    "body",
    "date",
    "dateYear",
    "startPg",
    "volumeNr",
    "serialNr",
    "resolutionId",
    "stazhIdent",
    "archiveLink",
    "manifestUrl",
    "subset",
    // Querverweise: archiveId als Join-Schlüssel, relations als Anzeige-/Linkfeld
    // (relations bleibt bewusst nicht searchable/filterable/sortable).
    "archiveId",
    "relations",
    // Auch displayed, damit der Suche-Endpoint die Listen zurückliefern kann
    // (z.B. für eine spätere "Erwähnte Entitäten"-Sektion auf der Detailseite).
    "persons",
    "places",
    "organizations",
    // Lesbar für die Detailseite und für --patch-krdb (Soll-Ist-Vergleich).
    "krdbIds",
    "krdbTitleIds",
  ],
  // `sort` an 2. Stelle (statt Meili-Default Position 5): bei Datums-Sort muss
  // das Datum das primäre Kriterium sein – hinter typo/proximity/attribute wäre
  // es nur Tie-Breaker innerhalb der Relevanz-Gruppen. `words` bleibt davor,
  // damit schwach matchende Queries (/api/v1, matchingStrategy "last") weiterhin
  // Volltreffer vor Teiltreffern listen; die interaktive Suche (strict "all")
  // hat ohnehin nur Volltreffer ⇒ Datum faktisch erstes Kriterium. Ohne
  // sort-Parameter ist die Regel ein No-op (Relevanz-Sortierung unverändert).
  //
  // `exactness` vor `proximity` und `attribute` (seit 2026-11-17, vorher am Ende): Bei
  // «alle Wörter» lässt Meili `words` weg, nach Relevanz zählt zuerst `typo` (Tippfehler-
  // Treffer stehen hinter allen anderen), danach kamen Abstand, Feld und Position – ein
  // Wortanfang-Treffer im Titel oder früh im Text («Pausenplatz», «19180») schlug das
  // exakte Wort weiter hinten. Jetzt stehen nach Relevanz zuerst ALLE Treffer, deren
  // Wörter genau so geschrieben sind (dieselbe Menge wie die Anfrage mit zitierten
  // Wörtern, apps/web `exactWrap`), danach Wortanfang-, dann Tippfehler-Treffer; die
  // Suchseite zieht dort die Grenze «ähnliche Schreibungen». Nach Datum ändert sich nichts
  // ausser der Reihenfolge bei gleichem Datum – in Meilis Sortierung und im Jahresfenster
  // gleich (dateWindow.ts). Lokal geprüft mit 1.13.3 und 1.57.0.
  //
  // `attributeRank` vor `proximity` (seit 2026-11-24, braucht Meili ab v1.36): Bei mehreren
  // Wörtern zählt zuerst, ob sie im Titel stehen, dann ihr Abstand, dann die Stelle im Text.
  // Vorher standen Sammeltexte vorn, in denen die Wörter irgendwo nebeneinander vorkommen
  // («Kantonsschule Winterthur Neubau»: 2 von 10 Titeln mit einem der Wörter, jetzt 10;
  // «Strassenbahn Oerlikon Konzession» begann mit «Straßenbahnen.», jetzt mit den Beschlüssen
  // über die Konzession). 30 Suchen durchgesehen: 15 besser, eine schlechter
  // («Bahnhof Enge Umbau»), die übrigen gleich. Ein einzelnes Wort ändert sich nicht. Die
  // Regel `attribute` stünde hier falsch: Sie wertet die Stelle im Text vor dem Abstand.
  rankingRules: ["words", "sort", "typo", "exactness", "attributeRank", "proximity", "wordPosition"],
  // 1000 statt 250: Mit den Ratsmanualen reicht der Korpus von 1484 bis heute
  // (~520 Jahre). dateYear ist alphabetisch sortiert – bei 250 fielen alle
  // Jahre ab ~1800 aus Zeitleiste, Jahresgrenzen, DTS und Agent-`timeline`.
  // Ein PATCH von Hand hält nicht: jeder Indexer-Lauf schreibt diese
  // Settings zurück (Plan Stufe 0.2).
  //
  // sortFacetValuesBy: für Entity-Facetten "count" – sonst sortiert Meili
  // alphabetisch und OCR-Müll mit Sonderzeichen am Anfang ("& Bodmer",
  // "'Heuscher") landet oben. Für resolutionId/serialNr bleibt "alpha":
  // bei strukturierten IDs sind quasi alle counts=1, count-Sort wird zu
  // unstabilem Random – alpha hat den Vorteil, dass bei Prefix-Eingabe
  // "1803/000" die ersten 1000 garantiert "1803/0001..1000" enthalten (Drill-
  // Sideways mit Year-Filter holt sie dann komplett rein). Für series/
  // dateYear bleibt alpha – Timeline + Serien-Reihenfolge sind dort
  // semantisch nicht von Count abhängig. Die Vergleichsschlüssel wie ihre Formen.
  faceting: {
    maxValuesPerFacet: 1000,
    sortFacetValuesBy: {
      "*": "alpha",
      persons: "count",
      places: "count",
      organizations: "count",
      personKeys: "count",
      placeKeys: "count",
      orgKeys: "count",
    },
  },
  // Default ist 1000 – bei lexikalischer Suche mit häufigen Begriffen
  // ("Bern", "Zürich" → 30k+ Matches) würden `estimatedTotalHits` und damit
  // auch die Treffer-Anzeige + Pagination unsinnig gekappt. Korpus hat
  // ~567k Docs, 1M Headroom ist großzügig.
  pagination: { maxTotalHits: 1_000_000 },
  // Meilis Default (1500 ms) bricht langsame Suchen STILL ab: der Rest kommt
  // ungerankt, bei Hybrid-Suchen fällt der semantische Arm ganz weg
  // (semanticHitCount 0 ⇒ reine Stichwort-Reihung). Trifft grosse Fenster –
  // Treffer-Export (Thema-Ranking über bis zu 10'000 IDs, gemessen ~2 s) und
  // tiefe Seiten der Trefferliste. 10 s = ehrlich statt still falsch.
  searchCutoffMs: 10_000,
  // Tippfehler-Toleranz erst ab 7 Zeichen (Meili-Default und bis 2026-11-17: 5).
  // Gemessen an 36 echten Einwort-Anfragen aus dem Nutzungs-Log: bei 5–6 Zeichen fand
  // die Toleranz überwiegend ANDERE Wörter, die einen Edit entfernt liegen – Grippe→Gruppe
  // 97 % der Treffer, Taube→Tabelle 92 %, Seuche→Suche 86 %, Pause→passe 74 %,
  // Hunde→Handen 73 %, Mühle→Mühe 48 %, Stadt→Staat 36 %, Schule→Schlegel 32 % (Meili
  // prefix-expandiert auch die Ein-Edit-Varianten des letzten Query-Worts). Echte alte
  // Schreibungen kosten dagegen nur 1–10 %: Gesetz→Gesez, Spital→Spithal, Steuer→Steuhr,
  // Wasser→Waser, Kirche→Kilche, Brücke→Bruke, Zunft→«Zunf-» am Zeilenumbruch. Preis:
  // in den alten Beständen, vor allem den Ratsmanualen, führt eine moderne Schreibung
  // nicht mehr von selbst zur alten – Ersatz ist das ODER-Feld bzw. `alternatives` im
  // MCP. `twoTypos` bleibt bei 9 (für 9–10 Zeichen gibt es keine Messung). Entscheid
  // Tim 2026-11-17; Einzelheiten im CLAUDE.md-Abschnitt «Meili-Eigenheiten».
  typoTolerance: { minWordSizeForTypos: { oneTypo: 7, twoTypos: 9 } },
  stopWords: [],
  embedders: {
    jina_de: {
      source: "userProvided",
      dimensions: 768,
    },
  },
};

// Settings für den Chunk-Index (RAG-Retrieval): ~1.3-1.7M Chunks à ~500 Token,
// Vektoren aus dem Weaviate-Index des früheren Stacks wiederverwendet bzw. für _late-Docs
// mit identischer Pipeline gerechnet (services/chunker). chunkText ist mit
// generic_text_cleaning normalisiert (Interpunktion raus, &/§/= ersetzt),
// Ziffern bleiben erhalten; das Retrieval läuft primär über die Vektoren.
export const CHUNK_INDEX_SETTINGS: Settings = {
  searchableAttributes: ["chunkText", "title"],
  filterableAttributes: ["docId", "series", "dateYear", "subset", "id"],
  sortableAttributes: ["date"],
  displayedAttributes: [
    "id",
    "docId",
    "series",
    "title",
    "date",
    "dateYear",
    "stazhIdent",
    "subset",
    "chunkText",
  ],
  rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
  pagination: { maxTotalHits: 100_000 },
  // Meili-Vorgabe 1500 ms: Eine Vektorsuche mit Filter liest bei kaltem Cache jeden Kandidaten von
  // der Platte und brach dort still ab (unvollständige Passagen mit normalen Scores; Prod
  // 2026-11-24, 70'674 Kandidaten: rund 8 s in fünf Läufen). Die Web-App erkennt den Abbruch an
  // dieser Frist (apps/web/src/lib/server/vectorCutoff.ts, der Test gleicht ab).
  searchCutoffMs: 10_000,
  stopWords: [],
  embedders: {
    jina_de: {
      source: "userProvided",
      dimensions: 768,
    },
    // Zweiter Embedder für Partner-Systeme (MCP-Tool vector_search):
    // Qwen3-Embedding-0.6B, nur für non-late-Chunks (subset IS NULL) befüllt –
    // Query-Vektoren kommen von aussen, serverseitig wird nie mit qwen3
    // embedded.
    qwen3_06b: {
      source: "userProvided",
      dimensions: 1024,
    },
  },
};

/**
 * Dokument, das die verschachtelten Felder der Docs in Meilis Feld-ID-Tabelle einträgt (Meili #6636,
 * s. `repairNestedFieldIds`). Einziges verschachteltes Feld ist `relations`; `Required<DocRelation>`
 * verlangt jedes seiner Felder, auch ein später dazukommendes.
 */
const FIELD_MAP_REPAIR_DOC = {
  id: "zszh-fieldmap-repair",
  relations: [{ name: "", targetId: 0, url: "" } satisfies Required<DocRelation>],
  _vectors: { jina_de: null },
};

/** String-Literal für Meili-Filter (wie quoteMeili in apps/web). */
function quoteFilterValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export class MeiliBulkImporter {
  private readonly client: MeiliSearch;
  constructor(
    private readonly opts: {
      url: string;
      masterKey: string;
      indexUid: string;
    },
  ) {
    this.client = new MeiliSearch({ host: opts.url, apiKey: opts.masterKey });
  }

  /**
   * Legt den Index an, falls er fehlt, und pusht INDEX_SETTINGS. Beide Tasks
   * müssen `succeeded` sein: ein abgelehnter Settings-Task (etwa ein neuer
   * userProvided-Embedder, solange Bestands-Docs dessen `_vectors`-Key nicht
   * tragen) liesse sonst ALLE Settings still beim alten Stand. `timeoutMs` je
   * Task – die Queue ist geteilt, auch ein No-op-Settings-Task wartet hinter
   * fremden Tasks, und auf dem grossen Index dauert schon ein neues
   * filterableAttribute mehrere Minuten.
   */
  async ensureIndex(timeoutMs: number): Promise<void> {
    if (!(await this.indexExists())) {
      const task = await this.client.createIndex(this.opts.indexUid, { primaryKey: "id" });
      await this.settle(task.taskUid, timeoutMs);
    }
    const first = await this.pushSettings(timeoutMs);
    if (first.status === "succeeded") return;
    if (!isInternalCrash(first)) assertTaskSucceeded(first);
    console.warn(
      `[meili] Settings-Task ${first.uid} abgestürzt (${first.error?.message ?? "ohne Meldung"}) – vermutlich ` +
        "Meili #6636: verschachtelte Felder fehlen in der Feld-ID-Tabelle. Trage sie nach und versuche es noch einmal.",
    );
    await this.repairNestedFieldIds(timeoutMs);
    const second = await this.pushSettings(timeoutMs);
    if (second.status !== "succeeded") {
      throw new Error(
        `Task ${second.uid} (${second.type}) ${second.status} auch nach der Reparatur der verschachtelten Felder: ` +
          `${second.error?.message ?? "ohne Fehlermeldung"} – Ursache im Server-Log (docker logs zszh-meili-1, ` +
          "«panicked at …»); nennt es ein anderes Feld («Expected field `…` in the fields IDs map»), gehört es in " +
          "FIELD_MAP_REPAIR_DOC (meili.ts).",
      );
    }
  }

  /** Schiebt INDEX_SETTINGS und wartet auf den Task (ohne zu werfen, s. ensureIndex). */
  private async pushSettings(timeoutMs: number): Promise<SettledTask> {
    const index = this.client.index(this.opts.indexUid);
    const task = await index.updateSettings(INDEX_SETTINGS);
    return (await this.client.waitForTask(task.taskUid, { timeOutMs: timeoutMs, intervalMs: 1_000 })) as SettledTask;
  }

  /**
   * Meili #6636, behoben in v1.56.1 nur für neue Updates: Hat ein updateDocuments einem bestehenden Doc ein
   * verschachteltes Feld hinzugefügt (bei uns `relations` per --patch-bodies, unter v1.13), fehlt es in der
   * Feld-ID-Tabelle. Ein Settings-Update, das die Docs neu ausliest (hier `titleSearch` in den
   * searchableAttributes), stirbt dann mit «Expected field `relations.name` in the fields IDs map». So auf
   * Prod am 2026-11-18 (Task 3757). Abhilfe nach dem Changelog von #6700: ein neues Doc mit allen
   * verschachtelten Feldern; das Löschen danach nimmt die Einträge nicht wieder heraus. Lokal nachgestellt
   * (v1.13.3 → v1.57.0): ohne das Doc derselbe Absturz, mit ihm succeeded, auch alle späteren Updates.
   */
  private async repairNestedFieldIds(timeoutMs: number): Promise<void> {
    const index = this.client.index(this.opts.indexUid);
    await this.settle((await index.addDocuments([FIELD_MAP_REPAIR_DOC], { primaryKey: "id" })).taskUid, timeoutMs);
    await this.settle((await index.deleteDocument(FIELD_MAP_REPAIR_DOC.id)).taskUid, timeoutMs);
  }

  /**
   * Exakt per GET /indexes/:uid – getIndexes() liefert nur die ersten 20; ein
   * createIndex für einen vorhandenen Index scheitert (`index_already_exists`).
   */
  private async indexExists(): Promise<boolean> {
    try {
      await this.client.getRawIndex(this.opts.indexUid);
      return true;
    } catch (err) {
      if (err instanceof MeiliSearchApiError && err.cause?.code === "index_not_found") return false;
      throw err;
    }
  }

  /** Wartet auf einen Task und wirft mit Meilis Fehlermeldung, wenn er nicht `succeeded` ist. */
  private async settle(taskUid: number, timeoutMs: number): Promise<void> {
    assertTaskSucceeded(
      await this.client.waitForTask(taskUid, { timeOutMs: timeoutMs, intervalMs: 1_000 }),
    );
  }

  async upsertBatch(docs: MeiliDoc[]): Promise<{ taskUid: number }> {
    const index = this.client.index(this.opts.indexUid);
    const task = await index.addDocuments(docs, { primaryKey: "id" });
    return { taskUid: task.taskUid };
  }

  /**
   * Partial-Update: ersetzt nur die in `docs` enthaltenen Felder, lässt
   * Embeddings und andere Felder unangetastet. Ideal für Title/Metadaten-Fix
   * ohne kompletten Re-Index.
   */
  async patchBatch(docs: Array<Partial<MeiliDoc> & { id: string }>): Promise<{ taskUid: number }> {
    const index = this.client.index(this.opts.indexUid);
    const task = await index.updateDocuments(docs as unknown as MeiliDoc[], { primaryKey: "id" });
    return { taskUid: task.taskUid };
  }

  /**
   * Liest `fields` für eine ID-Liste (`id IN […]` über POST /documents/fetch).
   * IDs ohne Meili-Eintrag fehlen im Ergebnis.
   */
  async fetchByIds<D extends { id: string }>(
    ids: string[],
    fields: Array<Extract<keyof D, string>>,
  ): Promise<D[]> {
    if (ids.length === 0) return [];
    const index = this.client.index(this.opts.indexUid);
    const res = await index.getDocuments<D>({
      filter: `id IN [${ids.map(quoteFilterValue).join(", ")}]`,
      fields,
      limit: ids.length,
    });
    return res.results;
  }

  /**
   * Alle Dokumente zu einem Filter, seitenweise (POST /documents/fetch). Die
   * Reihenfolge ist die interne Dokumentreihenfolge von Meili: stabil, solange
   * der Filter dieselben Dokumente trifft (Patches ändern nur Felder).
   */
  async *iterateDocuments<D extends { id: string }>(
    filter: string,
    fields: Array<Extract<keyof D, string>>,
    pageSize: number,
  ): AsyncGenerator<D[]> {
    const index = this.client.index(this.opts.indexUid);
    for (let offset = 0; ; offset += pageSize) {
      const page = await index.getDocuments<D>({ filter, fields, limit: pageSize, offset });
      if (page.results.length === 0) return;
      yield page.results;
      if (page.results.length < pageSize) return;
    }
  }

  /** Eine Seite Dokumente zu einem Filter (POST /documents/fetch), für Seiten wechselnder Grösse. */
  async getDocumentsPage<D extends { id: string }>(
    filter: string,
    fields: Array<Extract<keyof D, string>>,
    offset: number,
    limit: number,
  ): Promise<D[]> {
    const index = this.client.index(this.opts.indexUid);
    return (await index.getDocuments<D>({ filter, fields, limit, offset })).results;
  }

  /**
   * Zahl der Dokumente zu einem Filter, exakt (Suche mit hitsPerPage 0 – die läuft
   * in Meili im Blocking-Pool und belegt, anders als GET/POST /documents, keinen
   * HTTP-Worker). Wirft bei nicht filterbaren Feldern (invalid_search_filter).
   */
  async countMatching(filter: string): Promise<number> {
    const index = this.client.index(this.opts.indexUid);
    const res = await index.search("", { filter, hitsPerPage: 0, page: 1 });
    return res.totalHits;
  }

  /**
   * Wartet auf die Tasks (gemeinsame Frist `timeoutMs`) und meldet das
   * Ergebnis je Task: fehlgeschlagene mit Meilis Fehlermeldung, nach der Frist
   * noch anstehende als `pending` (taskSettle.ts).
   */
  async settleTasks(taskUids: number[], timeoutMs: number): Promise<SettleResult> {
    return settleTaskList(taskUids, timeoutMs, (uid, ms) =>
      this.client.waitForTask(uid, { timeOutMs: ms, intervalMs: 1_000 }),
    );
  }

  /** Das Setting `synonyms` des Index (Wort → zusätzlich gesuchte Formen). */
  async getSynonyms(): Promise<Record<string, string[]>> {
    const index = this.client.index(this.opts.indexUid);
    return ((await index.getSynonyms()) ?? {}) as Record<string, string[]>;
  }

  /**
   * Ersetzt das Setting `synonyms` (PUT /settings/synonyms, ein Settings-Task ohne Neuaufbau)
   * und wartet, bis der Task `succeeded` ist.
   */
  async setSynonyms(synonyms: Record<string, string[]>, timeoutMs: number): Promise<number> {
    const index = this.client.index(this.opts.indexUid);
    const task = await index.updateSynonyms(synonyms);
    await this.settle(task.taskUid, timeoutMs);
    return task.taskUid;
  }

  async getStats(): Promise<{ numberOfDocuments: number; isIndexing: boolean }> {
    const index = this.client.index(this.opts.indexUid);
    const stats = await index.getStats();
    return {
      numberOfDocuments: stats.numberOfDocuments,
      isIndexing: stats.isIndexing,
    };
  }
}
