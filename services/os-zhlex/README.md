# os-zhlex – Offizielle Gesetzessammlung ab 1999 (ZH-Lex / zh.ch)

Lädt die **ab 1999** auf [ZH-Lex][quelle] publizierte **Offizielle
Gesetzessammlung** (Serie **OS**) des Kantons Zürich und erzeugt daraus TEI-XML im
OS-Korpusformat – **ein Dokument pro Erlass-Publikation** (Neuerlass bzw.
Änderung, chronologisch). Schliesst die Lücke, die der digitalisierte Altbestand
(Staatsarchiv, eOSZH, **1803–1998**) offen lässt, als Teilbestand **`os-late`**
(analog zu `rrb-late` aus [`services/rrb-zhweb`](../rrb-zhweb) und `krp-late` aus
[`services/krp-gever`](../krp-gever)).

**Keine Bilder:** Die erzeugten TEI enthalten kein `<figure>`/`<graphic>`/
`<facsimile>`. Der Indexer (`services/indexer/src/iiif.ts:resolveIIIF`) liefert
dann `kind:"none"` ⇒ `manifestUrl` bleibt null ⇒ die Detailansicht zeigt nur den
Text, keinen Faksimile-Tab. Statt Faksimile verlinkt `<ref target>` die
zh.ch-Erlass-Seite (von dort das Original-PDF).

## Datenquelle

- ZH-Lex-Suchliste = AEM-Komponente; im Hintergrund liefert sie server-gecachtes
  JSON. Selektor `zhweb-zhlex-os` = chronologische Offizielle Sammlung:
  `…/gesetzessammlung/_jcr_content/main/{COMPONENT_ID}.zhweb-zhlex-os.zhweb-cache.json?page=N`
  (15 Einträge/Seite; Felder `data[]` mit `link`, `referenceNumber`,
  `enactmentTitle`, `enactmentDate`, `entryIntoForceDate`).
- **`COMPONENT_ID`** (`lawcollectionsearch_312548694`) ist der einzige fragile
  Teil – ändert sich nur, wenn der Kanton die Seite neu aufbaut. Neu ermitteln via
  Browser-DevTools → Network → Request auf `…zhweb-zhlex-os.zhweb-cache.json`; die
  ID steht im Pfad davor. Siehe Konstante in [`src/scrape.ts`](src/scrape.ts).
- **Pagination-Falle:** `numberOfResults`/`numberOfResultPages` sind auf **150/10
  gedeckelt** (`moreSearchResultsThanAllowed:true`), der Deckel ist aber
  **kosmetisch** – `page=11,20,50,…` liefern weiter Daten (rückwärts
  chronologisch). Wir paginieren bis eine Seite leer ist bzw. komplett unter
  `--from-year` liegt (Frühabbruch), **nicht** bis `numberOfResultPages`.
- **PDF:** keine ableitbare URL. Pro Erlass wird die Detailseite (`link`) geholt,
  daraus die Lotus-Notes-`docid` + der Dateiname gelesen
  (`OpenAttachment?Open&docid=<UNID>&file=<name>.pdf`) und das PDF über das
  kanonische Notes-Form geladen:
  `https://www.notes.zh.ch/appl/zhlex_r.nsf/0/<docid>/$FILE/<file>`
  (die `OpenAttachment`-URL selbst liefert nur eine HTML-JS-Weiterleitung).
- Text via `pdftotext` (poppler muss installiert sein).
- Umfang: ~4'900 Publikationen, 1999–heute. **Hinweis:** „(Änderung)"-PDFs
  enthalten nur die geänderten Artikel (kein konsolidierter Volltext) – konsistent
  mit dem Altbestand (Publikationen wie gedruckt), für Volltextsuche aber
  fragmentarisch. Der konsolidierte Volltext läge im Selektor `zhweb-zhlex-ls`
  (Loseblattsammlung) – siehe „Spätere Arbeit".

[quelle]: https://www.zh.ch/de/politik-staat/gesetze-beschluesse/gesetzessammlung.html

## Verwendung

```bash
cd services/os-zhlex
npm install

# Sample (jüngste Erlasse) – scrape + PDFs + TEI in einem Lauf
npx tsx src/main.ts --out=/tmp/zszh-oslate --limit=20

# Vollbestand 1999→heute (Index + alle PDFs + TEI; Resume)
npx tsx src/main.ts --out=~/zszh-oslate

# Nur TEI aus bereits geladenen PDFs (kein Netz)
npx tsx src/main.ts --out=~/zszh-oslate --tei-only
```

Flags: `--out=<dir>` (Pflicht; TEI landet unter `<out>/data/OS/OS_late/`),
`--cache=<dir>` (PDF-Root, Default `<out>/pdfs`), `--from-year` (Default **1999**,
da der Altbestand 1998 endet) / `--to-year`, `--limit=<n>`, `--concurrency=<n>`
(Default 4), `--force` (vorhandene TEI überschreiben), `--scrape-only` (nur Index +
PDFs), `--tei-only` (nur TEI, kein Netz), `--delay`/`--index-delay` (Höflichkeit).

Reines Scrapen (Index + PDFs, ohne TEI) geht auch direkt:
`npx tsx src/scrape.ts --out=<dir> [--from-year=…] [--index-only]`.

Resume: vorhandene TEI werden übersprungen, PDFs aus dem Cache wiederverwendet
(Dateiname = unsere Doc-ID, da mehrere Änderungen derselben Ordnungsnummer
denselben `file=NNN.pdf`-Namen tragen).

**Arbeits-/Ausgabedaten** (`<out>/metadata`, `<out>/pdfs`, `<out>/data`) werden
**nicht** committet (siehe `.gitignore`) – das ist Korpus/Cache, kein Code.

## ID-Schema & TEI-Felder

- ID/Dateiname: `OS_<YYYY>_<slugCore>`, z. B. `OS_2025_131_1-81-75`
  (`slugCore` = Site-Slug `Ordnungsnummer_Band_Seq`). Enthält `_YYYY_` für die
  Jahr-Fallback-Regex des Parsers und kollidiert nicht mit dem Altbestand
  (`OS_<Band>_…`, 1–2-stellige Bandzahl vs. 4-stelliges Jahr).
- `<idno>131.1</idno>` ⇒ Indexer-Parser füllt `serialNr` (Ordnungsnummer,
  Facette „Ordnungsnummer").
- `<ident>OS 81</ident>` ⇒ `volumeNr` (OS-Bandnummer aus dem Slug; Facette
  „Bandnummer"). Setzt die durchgehende Bandzählung des Altbestands fort.
- `<title>`/`<date>` aus den Scrape-Metadaten (`enactmentTitle`/`enactmentDate`);
  `<edition>Offizielle Gesetzessammlung (Kanton Zürich, ZH-Lex)`; `<ref target>` =
  zh.ch-Erlass-Seite.

## Danach: indexieren (lokal, Keyword/skip-embed)

```bash
docker compose -f infra/compose.yml up -d meili      # Repo-Root
cd services/indexer
ZSZH_DATA_DIR=/tmp/zszh-oslate \
  RENDER_OUTPUT_DIR=$(pwd)/output \
  PUBLIC_BASE_URL=https://ihre-adresse.example \
  MEILI_URL=http://localhost:7700 \
  MEILI_MASTER_KEY=dev_master_key_change_me \
  MEILI_INDEX=documents \
  npx tsx src/main.ts --all --series=OS --skip-embed
```

`--series=OS` walkt nur `<ZSZH_DATA_DIR>/data/OS/` (inkl. `OS_late/`),
`--skip-embed` setzt `_vectors.jina_de=null` (Keyword-Suche). `addDocuments` rührt
nur die neuen `OS_<YYYY>_…`-IDs an – der kuratierte OS-Altbestand 1803–1998 im
Index bleibt unberührt. Der `os-late`-Marker wird vom Parser **pfadbasiert**
vergeben (Datei liegt unter `OS_late/`).

## Produktion (Hetzner)

Gleicher Ablauf mit Server-Pfaden; dort mit echtem `embed`-Service (ohne
`--skip-embed`), damit die neuen Erlasse auch semantisch durchsuchbar sind.
In Betrieb; neue Dokumente kommen mit der wöchentlichen Aktualisierung dazu.

## Spätere Arbeit

- **LS-Komplement:** der konsolidierte geltende Volltext jedes Erlasses liegt im
  Selektor `zhweb-zhlex-ls` (eine Datei pro Ordnungsnummer, ~3'000 Erlasse). Als
  zweiter Teilbestand („geltendes Recht heute") wäre er der bessere Volltext-Suchwert.
- `missing.csv`-Erlasse (kein PDF auffindbar) optional als Metadaten-TEI schreiben,
  damit sie über Titel/Ordnungsnummer trotzdem auffindbar bleiben.
- Reichere PDF-Struktur (Artikel-/Paragraphen-Gliederung, Tabellen); aktuell wird
  zu Fließtext-Absätzen geglättet.
