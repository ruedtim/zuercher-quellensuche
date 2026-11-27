# krp-gever – Kantonsratsprotokolle ab Mai 1995

Holt die Kantonsratsprotokolle (Serie **KRP**) **ab Mai 1995** aus dem offenen
**Gever-Web-Service** des Kantonsrats Zürich (CMI CDWS) und erzeugt daraus
TEI-XML im KRP-Korpusformat. Damit wird die Lücke geschlossen, die der
digitalisierte Altbestand hinterlässt (dieser endet mit der Legislatur
1991–1995, letztes Protokoll 10.04.1995).

**Granularität:** ein Dokument **pro Traktandum** (Agenda-Punkt) – wie der
digitalisierte Altbestand. Das Sitzungs-PDF wird per [segment.ts](src/segment.ts)
zerlegt (siehe unten). Schlägt die Segmentierung fehl (~6 %), Fallback auf **ein
Dokument pro Sitzung** (kein Datenverlust). `--no-segment` erzwingt Sitzungs-Granularität.

**Keine Bilder:** Die erzeugten TEI enthalten kein `<figure>`/`<graphic>`/
`<facsimile>`. Der Indexer (`services/indexer/src/iiif.ts:resolveIIIF`) liefert
dann `kind:"none"` ⇒ `manifestUrl` bleibt null ⇒ die Detailansicht zeigt nur den
Text, keinen Faksimile-Tab.

## Datenquelle

- Sitzungen (Index `SITZUNGENDETAIL`, Gremium `KR` = Plenum), paginiert:
  `https://parlzhcdws.cmicloud.ch/parlzh3/cdws/Index/SITZUNGENDETAIL/searchdetails?q=gremium all KR and datum_start >= "1995-05-01 00:00:00" sortBy datum_start/sort.ascending&l=de-CH&m=200&s=1`
- Pro Sitzung das `<Dokument>` mit `<Kategorie>Protokoll</Kategorie>`; dessen
  `<eDokument>` hat mehrere `<Version Nr>` – die höchste mit PDF-Rendition ist
  die Download-Version.
- PDF: `…/cdws/Files/<eDokumentId>/<versionNr>/pdf` (Host-Fallback
  parlzh3/parlzh2/parlzh5).
- Text via `pdftotext` (poppler muss installiert sein).

Datensatz/Doku: opendata.swiss „Organisation und Geschäfte des Zürcher
Kantonsrats"; <https://github.com/openZH/KRZH_gever>.

## Verwendung

```bash
cd services/krp-gever
npm install

# Sample (ein Jahr, wenige Sitzungen)
npx tsx src/main.ts --out=/tmp/zszh-krp-gever --year=1995 --limit=5

# Voller Lückenschluss (alle Sitzungen ab Mai 1995; Cache + Resume)
npx tsx src/main.ts --out=/tmp/zszh-krp-gever
```

Flags: `--out=<dir>` (Pflicht, TEI landet unter `<out>/data/KRP/`),
`--since=YYYY-MM-DD` (Default 1995-05-01), `--until=YYYY-MM-DD`, `--year=YYYY`,
`--limit=<n>`, `--cache=<dir>` (Default `<out>/.cache-pdf`),
`--concurrency=<n>` (Default 4), `--force` (vorhandene TEI überschreiben).

Resume: vorhandene TEI werden übersprungen, PDFs aus dem Cache wiederverwendet.
Der Web-Service liefert teils dieselbe Sitzung mehrfach – Duplikate werden über
die (eindeutige) Dokument-ID automatisch entdedupt.

## Segmentierung pro Traktandum ([segment.ts](src/segment.ts))

Body-verankert (nicht TOC-Seitenzahlen-getrieben, da das TOC-Layout über die
Jahre stark variiert):

1. **Seitenanker:** gedruckte Seitenzahl = erste Zeile jeder `\f`-Seite
   (Offset→Seite-Map, Carry-forward).
2. **TOC** liefert nur die Item-Liste (Top-Level `N. Titel` + KR-Nr): erst
   streng-konsekutiv, sonst lenient für nicht-konsekutive Alt-Nummerierung
   (1, 9, 67, 10 …); Datumszeilen ausgefiltert.
3. **Body-Anker:** jede Überschrift `N. Titel` im Body suchen (multiline,
   tolerant gegenüber `2 .` und `14.\n\nVerschiedenes`), dazwischen schneiden.
4. **Confidence-Gating:** nur wenn alle Items (Toleranz ≤1) in aufsteigender
   Reihenfolge + monotone Seiten gematcht werden; sonst Ganz-Sitzungs-Fallback.

Pro Traktandum ein TEI: `<title>`=Punkt-Titel, `<idno>`=Seitenbereich,
`<ident>`=„<Sitzung> · Traktandum N · <KR-Nr>". Validierung über alle
gecachten PDFs: `npx tsx src/validate.ts --cache=<dir> --tei=<dir>/data/KRP`
(Stand: **93.9 %** segmentiert, 1995–2026).

## Danach: indexieren (lokal, Keyword/skip-embed)

```bash
docker compose -f infra/compose.yml up -d meili      # Repo-Root
cd services/indexer
ZSZH_DATA_DIR=/tmp/zszh-krp-gever \
  RENDER_OUTPUT_DIR=$(pwd)/output \
  PUBLIC_BASE_URL=https://ihre-adresse.example \
  MEILI_URL=http://localhost:7700 \
  MEILI_MASTER_KEY=dev_master_key_change_me \
  MEILI_INDEX=documents \
  npx tsx src/main.ts --all --series=KRP --skip-embed
```

`--series=KRP` walkt nur `<ZSZH_DATA_DIR>/data/KRP/`, `--skip-embed` setzt
`_vectors.jina_de=null` (Keyword-Suche). `addDocuments` rührt nur die neuen IDs
an – ein bestehender Index/Mirror bleibt unberührt.

ID-Schema: `KRP_<YYYY>_g<eDokumentGuid>_t<NN>` pro Traktandum (bzw.
`KRP_<YYYY>_g<eDokumentGuid>` bei Ganz-Sitzungs-Fallback) – kollidiert nicht mit
dem Altbestand `MM_24_…`.

## Produktion (Hetzner)

Gleicher Ablauf mit Server-Pfaden; dort mit echtem `embed`-Service (ohne
`--skip-embed`), damit die neuen Protokolle auch semantisch durchsuchbar sind.

## Spätere Arbeit

- Restliche ~6 % Fallback-Sitzungen (meist Einzel-Traktandum-Nachmittagssitzungen)
  feiner auflösen; `<pb>`-Seiten-Anker im Body.
- KR-Nr → `resolutionId` (UI zeigt „Nr."), Quelle-Link „Kantonsrat Zürich".
