# services/ner-xml

**Named Entity Recognition direkt auf flachem TEI-XML – ohne TEI Publisher.**
Wendet das SpanMarker-Modell der StAZH-NER
([team-data-ktzh/span-marker-ktzh-stazh](https://huggingface.co/team-data-ktzh/span-marker-ktzh-stazh))
direkt auf die TEI-Dokumente an und schreibt annotierte Kopien: erkannte
Eigennamen werden als Inline-Tags `<persName>` / `<placeName>` / `<orgName>`
(jeweils mit UUID im `n`-Attribut, Ableitungen zusätzlich `type="deriv"`) in die
`<p>`-Elemente eingefügt – Format identisch zu den Golddaten der
[NER-Pipeline](https://github.com/machinelearningZH/named-entity-recognition_staatsarchiv).

Ersetzt für flache Korpora den bisherigen Weg über TEI Publisher + eXist-DB +
`ner_api`/`ner_cli`. Die Modell- und Offset-Logik ist 1:1 aus jener NER-API
übernommen (`spacy_integration.py`, `sentence_splitter.py` sowie
`normalize_offsets`/`adjust_offset` in `ner_xml.py`); die Resultate sind damit
identisch zur Produktiv-API, nur ohne deren Server-Stack.

## Voraussetzung: flache Dokumente

Annotiert werden nur `<p>`-Elemente, die **reinen Text ohne Inline-Markup**
enthalten. Absätze mit Kindelementen (z. B. `<pb/>`-Seitenumbrüche aus OCR)
werden zur Sicherheit unangetastet durchgereicht. Die Spätbestände sind dafür zu
100 % geeignet (vollständig geprüft, je 0 nicht-flache Dateien):

| Korpus   | Dateien | flach |
|----------|--------:|:-----:|
| KRP_late | 12 870  | ja    |
| OS_late  |  5 056  | ja    |
| RRB_late | 18 484  | ja    |

Jede geschriebene Datei wird verifiziert: der reine Textinhalt nach Entfernen
der eingefügten Tags muss **zeichengleich** zum Original sein. Schlägt das für
einen Absatz fehl, bleibt dieser unannotiert (der Rest des Dokuments wird normal
geschrieben).

## Setup (lokal, Python 3.12 – spaCy kann noch kein 3.14)

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # bei Bedarf DEVICE anpassen (mps auf Apple, cuda am Server)
```

Das Modell (~1.5 GB) wird beim ersten Lauf vom HF-Hub geladen und gecacht.

## Verwendung

```bash
# Testlauf auf wenigen Dateien
.venv/bin/python ner_xml.py \
    --input  ~/zszh-corpus/KRP_late \
    --output ~/zszh-ner-out/KRP_late \
    --limit 30

# Vollständiger Lauf (resumierbar – bei Abbruch denselben Befehl erneut starten)
.venv/bin/python ner_xml.py \
    --input  ~/zszh-corpus/RRB_late \
    --output ~/zszh-ner-out/RRB_late
```

Wichtige Optionen:

- `--limit N` – nur die ersten N Dateien (Test).
- `--recursive` – Unterverzeichnisse einschliessen (Ausgabe spiegelt die Struktur).
- `--overwrite` – bestehende Ausgaben neu erzeugen (Standard: überspringen).
- `--device cpu|mps|cuda` – überschreibt `DEVICE` aus `.env` (fällt auf `cpu`
  zurück, wenn nicht verfügbar).
- `--batch-size N` – SpanMarker-Batchgröße (Standard 4; höher = schneller, mehr
  Speicher; ändert die Resultate nicht). Auch via `BATCH_SIZE` in `.env`.
- `--empty-cache-every N` – MPS-Cache alle N Dateien leeren (Standard 200).
- `--reload-every N` – Pipeline alle N Dateien neu laden; nur für sehr grosse
  Läufe nötig, kappt das spaCy-Vokabular-Wachstum hart (Standard 0 = aus).

### Resumierbarkeit

Bereits vollständig geschriebene Ausgaben werden übersprungen, Ausgaben werden
atomar geschrieben (erst `*.tmp`, dann umbenennen). Ein abgebrochener Lauf wird
durch erneuten Aufruf desselben Befehls dort fortgesetzt, wo er aufgehört hat.

### Speicher

Der Spitzenverbrauch ist im Wesentlichen konstant (~3 GB, dominiert von den
Modellgewichten) und wächst **nicht** mit der Dokumentzahl – pro Datei wird genau
ein Dokument im Speicher gehalten und danach freigegeben. Anders als der alte
TEI-Publisher/eXist-Lauf (unbegrenzter JVM-/DB-Heap) ist ein Komplettlauf über
alle ~36 000 Spätbestands-Dokumente damit unproblematisch. Empirisch bleibt der
Peak-RSS über hunderte Dateien flach; periodisches `mps.empty_cache()` kappt den
MPS-Allocator zusätzlich.

## Pipeline-Einordnung

Erzeugt annotiertes TEI im Format des Spätbestands, das anschliessend von
[`services/indexer`](../indexer) aufgenommen wird (Entity-Facetten/Highlighting
via `npx tsx src/main.ts --patch-entities`).

**Arbeits-/Ausgabedaten werden nicht committet** (siehe `.gitignore`): annotiertes
XML in ein Verzeichnis ausserhalb des Repos schreiben (z. B. `~/zszh-ner-out/`).
