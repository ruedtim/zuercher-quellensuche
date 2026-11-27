# rrb-zhweb – Regierungsratsbeschlüsse ab Okt. 2008 (zh.ch)

Lädt die **ab 1. Okt. 2008** auf [zh.ch][quelle] publizierten ("freigegebenen")
**Regierungsratsbeschlüsse** (Serie **RRB**) und erzeugt daraus TEI-XML im
RRB-Korpusformat – **ein Dokument pro Beschluss**. Schliesst die Lücke, die der
digitalisierte Altbestand (Staatsarchiv, bis ~1995/2008) offen lässt, als
Teilbestand **`rrb-late`** (analog zu `krp-late` aus [`services/krp-gever`](../krp-gever)).

Dieses Modul **ersetzt das frühere Repo `RRB_scrape`** (Python): die Scrape-Logik
ist hier nach tsx portiert ([`src/scrape.ts`](src/scrape.ts)).

**Keine Bilder:** Die erzeugten TEI enthalten kein `<figure>`/`<graphic>`/
`<facsimile>`. Der Indexer (`services/indexer/src/iiif.ts:resolveIIIF`) liefert
dann `kind:"none"` ⇒ `manifestUrl` bleibt null ⇒ die Detailansicht zeigt nur den
Text, keinen Faksimile-Tab. Statt Faksimile verlinkt `<ref target>` das
Original-PDF auf zh.ch.

## Datenquelle

- Suchliste = AEM-Komponente; im Hintergrund liefert sie server-gecachtes JSON:
  `…/beschluesse-des-regierungsrates/jcr:content/main/{COMPONENT_ID}.zhweb-dgc.zhweb-cache.json?page=N&order=descending&orderBy=session_date`
  (`PAGE_SIZE=10`, Felder `numberOfResults`/`numberOfResultPages`/`data[]`).
- **`COMPONENT_ID`** (`governmentdecisionss_381608543`) ist der einzige fragile
  Teil – ändert sich nur, wenn der Kanton die Seite neu aufbaut. Neu ermitteln via
  Browser-DevTools → Network → Request auf `…zhweb-dgc.zhweb-cache.json`; die ID
  steht im Pfad vor `.zhweb-dgc`. Siehe Konstante in [`src/scrape.ts`](src/scrape.ts).
- PDF-Schema (Beispiel RRB 534/2026):
  `…/regierungsratsbeschluss-unterlagen./2026/534/RRB-2026-0534.pdf`
  (Ordner-Nr. ungepaddet, Dateiname 4-stellig genullt). Fallback: ungepaddeter
  Dateiname (Jahrgang 2017), dann HTML-Seite des Beschlusses nach `.pdf`-Link parsen.
- Text via `pdftotext` (poppler muss installiert sein).
- Umfang: ~18'500 Beschlüsse, 2008–heute (~1 GB PDFs).

[quelle]: https://www.zh.ch/de/politik-staat/gesetze-beschluesse/beschluesse-des-regierungsrates.html

## Verwendung

```bash
cd services/rrb-zhweb
npm install

# Sample (ein Jahr, wenige Beschlüsse) – scrape + PDFs + TEI in einem Lauf
npx tsx src/main.ts --out=/tmp/zszh-rrb --from-year=2026 --limit=20

# Vollbestand (Index + alle PDFs + TEI; mehrere GB / Stunden; Resume)
npx tsx src/main.ts --out=~/zszh-rrb

# Nur TEI aus bereits geladenen PDFs (z. B. dem alten RRB_scrape-Cache, kein Netz)
npx tsx src/main.ts --out=~/zszh-rrb --tei-only \
  --cache=~/rrb-pdfs
```

Flags: `--out=<dir>` (Pflicht; TEI landet unter `<out>/data/RRB/RRB_late/`),
`--cache=<dir>` (PDF-Root, Default `<out>/pdfs` – auf bestehende PDFs zeigbar),
`--from-year`/`--to-year`, `--limit=<n>`, `--concurrency=<n>` (Default 4),
`--force` (vorhandene TEI überschreiben), `--scrape-only` (nur Index + PDFs),
`--tei-only` (nur TEI, kein Netz), `--delay`/`--index-delay` (Höflichkeit).

Reines Scrapen (Index + PDFs, ohne TEI) geht auch direkt:
`npx tsx src/scrape.ts --out=<dir> [--from-year=…] [--index-only]`.

Resume: vorhandene TEI werden übersprungen, PDFs aus dem Cache wiederverwendet
(gepaddeter **und** ungepaddeter Dateiname werden geprüft – Jahrgang 2017 nutzt
teils `RRB-2017-248.pdf`).

**Arbeits-/Ausgabedaten** (`<out>/metadata`, `<out>/pdfs`, `<out>/data`) werden
**nicht** committet (siehe `.gitignore`) – das ist Korpus/Cache, kein Code.

## ID-Schema & TEI-Felder

- ID/Dateiname: `RRB_<YYYY>_<NNNN>` (4-stellig genullt), z. B. `RRB_2026_0534`.
  Kollidiert nicht mit dem Altbestand `MM_x_y_RRB_<Jahr>_<NNNN>`.
- `<ident>RRB <YYYY>/<NNNN>` ⇒ Indexer-Parser leitet
  `resolutionId="<YYYY>/<NNNN>"` ab (jahr-zuerst, konsistent mit dem Altbestand;
  die UI zeigt „Nr. 2026/0534" und füllt die Facette „Beschlussnummer").
- `<title>`/`<date>` aus den Scrape-Metadaten; `<edition>Regierungsratsbeschlüsse
  (Kanton Zürich, zh.ch)`; `<ref target>` = zh.ch-Seite des Beschlusses.

## Danach: indexieren (lokal, Keyword/skip-embed)

```bash
docker compose -f infra/compose.yml up -d meili      # Repo-Root
cd services/indexer
ZSZH_DATA_DIR=/tmp/zszh-rrb \
  RENDER_OUTPUT_DIR=$(pwd)/output \
  PUBLIC_BASE_URL=https://ihre-adresse.example \
  MEILI_URL=http://localhost:7700 \
  MEILI_MASTER_KEY=dev_master_key_change_me \
  MEILI_INDEX=documents \
  npx tsx src/main.ts --all --series=RRB --skip-embed
```

`--series=RRB` walkt nur `<ZSZH_DATA_DIR>/data/RRB/` (inkl. `RRB_late/`),
`--skip-embed` setzt `_vectors.jina_de=null` (Keyword-Suche). `addDocuments` rührt
nur die neuen IDs an – der kuratierte RRB-Altbestand im Index bleibt unberührt.
Der `rrb-late`-Marker wird vom Parser **pfadbasiert** vergeben (Datei liegt unter
`RRB_late/`).

## Produktion (Hetzner)

Gleicher Ablauf mit Server-Pfaden; dort mit echtem `embed`-Service (ohne
`--skip-embed`), damit die neuen Beschlüsse auch semantisch durchsuchbar sind.
In Betrieb; neue Dokumente kommen mit der wöchentlichen Aktualisierung dazu.

## Spätere Arbeit

- `missing.csv`-Beschlüsse (kein PDF auffindbar) optional als Metadaten-TEI aus dem
  `text`-Auszug schreiben, damit sie trotzdem auffindbar bleiben.
- Reichere PDF-Struktur (Tabellen, Überschriften) à la `PDF_parser_RRB`; aktuell
  werden Tabellen zu Fließtext-Absätzen geglättet.
- KR-Nr (`<idno type="KR">`) aus dem PDF-Text extrahieren.
