# Zürcher Quellensuche

**Digitale Zugänge zum Staatsarchiv Kanton Zürich** – Quellcode von [archivquellen.ch](https://archivquellen.ch)

> **Inoffizieller Prototyp.** Privat betrieben von Tim Rüdiger, kein Angebot des Staatsarchivs oder des Kantons Zürich.

Such- und Leseplattform für rund 620'000 Dokumente der Zentralen Serien des Kantons Zürich seit 1803 (Gesetzessammlung,
Amtsblatt, Kantonsratsprotokolle, Regierungsratsbeschlüsse), 75'000 Sitzungen der Ratsmanuale 1484–1798, den
Online-Archivkatalog, die Zürcher Ehedaten und zwei Editionen: Volltext- und Themensuche, Faksimiles über IIIF,
offene Schnittstellen (REST, DTS, MCP). Die Website erzeugt keine Antworten; wer das möchte, verbindet den eigenen
KI-Assistenten über den [MCP-Server](https://archivquellen.ch/about/ai).

Wie alles zusammenhängt, steht auf den About-Seiten:
[Architektur](https://archivquellen.ch/about/architektur),
[API](https://archivquellen.ch/about/api),
[Suchhilfe](https://archivquellen.ch/about/suchhilfe).

## Was dieses Repo ist

Eine **Kopie des Quellcodes** aus einem privaten Repo, ohne dessen Geschichte. Jeder Commit ist ein Stand; Änderungen
direkt hier überschreibt der nächste. Fragen und Hinweise gern als Issue oder an <info@archivquellen.ch>, Pull Requests
kann ich nicht übernehmen.

**Nicht enthalten:** die Quellentexte und Indizes, die Betriebskonfiguration des Servers, interne Arbeitsnotizen (Kommentare
verweisen manchmal darauf, ebenso auf Nummern von Pull Requests im privaten Repo), der Weg von Transkribus zu den
Ratsmanualen, der Abzug des Online-Archivkatalogs (Eingabe von `services/catalog`), Prüfwerkzeuge, Porträts, Icon,
Vorschaubild und das Scherzbild der Seite.
Das Register des Kleinen Rats (`rat-register.json`) ist ein leerer Platzhalter.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `apps/web` | Website und APIs: SvelteKit 2, Svelte 5, TypeScript, Tailwind 4 |
| `services/indexer` | TEI-XML → Suchindex (Meilisearch), HTML, IIIF-Manifeste |
| `services/embed` | Vektoren für die Themensuche (FastAPI, Jina v2-base-de) |
| `services/chunker` | Textstellen für das MCP-Werkzeug `passage_search` |
| `services/krp-gever`, `rrb-zhweb`, `os-zhlex` | Protokolle ab 1995, Beschlüsse ab 2008 und Gesetze ab 1999 aus offenen Daten → TEI |
| `services/ner-xml` | Namenserkennung für diese drei (Modell des Kantons Zürich) |
| `services/catalog` | Archivkatalog, Ehedaten, Editionen und Querverweise → Suchindizes |
| `services/krdb` | Register der Rats- und Regierungsmitglieder aus KRDB, Wikidata, Commons |
| `infra` | Docker Compose für die lokale Entwicklung |

## Lokal starten

Voraussetzung: Docker, Node ab Version 22 und ein Ordner mit TEI-Dateien (`data/<Serie>/<id>.xml`; die Editionen des
Staatsarchivs gibt es als [offene Daten](https://opendata.swiss/de/organization/staatsarchiv-des-kantons-zuerich)).

```bash
cp infra/.env.example infra/.env
docker compose -f infra/compose.yml up -d meili embed

# Stichprobe von 50 Dokumenten je Serie indexieren
cd services/indexer
npm ci
ZSZH_DATA_DIR=/pfad/zum/tei-korpus npm run index -- --limit=50 --allow-local-base-url

# Website auf http://localhost:5173
cd ../../apps/web
npm ci
cp .env.example .env
npm run dev
```

Reiter, deren Index fehlt (Archivkatalog, Ehedaten, Editionen), blendet die Website aus. Den MCP-Server schaltet
`MCP_ENABLE=1` in `apps/web/.env` ein.

Prüfen: in `apps/web` `npm run check` und `npx tsx --test src/lib/*.test.ts src/lib/server/*.test.ts src/lib/server/apiV1/*.test.ts src/lib/server/dts/*.test.ts`,
in den Diensten `npm run typecheck` und `npx tsx --test src/*.test.ts`.

Wer eine eigene Fassung betreibt, ersetzt Name, Adresse und Kontakt (`apps/web/src/lib/site.ts`, `siteAddress.js`,
`contact.ts`) sowie Impressum und Datenschutzerklärung.

## Lizenz

Der Code steht unter der [MIT-Lizenz](LICENSE). Ausgenommen sind:

- die eigenen Texte und die Gestaltung der Website (About-Seiten, Impressum, Datenschutzerklärung unter
  `apps/web/src/routes`): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de), wie auf der Website angegeben;
- fremder Code und Schriften mit eigener Lizenz: [THIRD-PARTY.md](THIRD-PARTY.md);
- die Daten (unten).

### Daten

Die Daten haben eigene Bedingungen, der Code ändert daran nichts. Was davon als Datei in diesem Repo liegt:

| Datei | Herkunft | Bedingungen |
|---|---|---|
| `apps/web/src/lib/server/data/edition-links.json` | [stazh/qzh-data](https://github.com/stazh/qzh-data), [stazh/erqzh-data](https://github.com/stazh/erqzh-data) | CC BY 4.0: Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH); Sammlung Schweizerischer Rechtsquellen, Zürcher Rechtsquellen online |
| `apps/web/src/lib/server/data/ehedaten-mehrfach.json` | [stazh/sw-ehedaten](https://github.com/stazh/sw-ehedaten) | freie Nutzung mit Quellenangabe: Staatsarchiv des Kantons Zürich |
| `apps/web/src/lib/server/data/rm-bands.json` | Bandtitel der Ratsmanuale (StAZH B II) | Angaben zu Band, Jahr und Schreiber; Staatsarchiv des Kantons Zürich |
| `services/indexer/src/rmNames.data.json` | Namensformen aus den Ratsmanualen 1484–1798 | Vergleichstabelle, aus den Texten abgeleitet |
| `apps/web/src/lib/server/data/krdb-register.json` (Kopie in `services/indexer`) | [Kantonsratsmitglieder ab 1803](https://www.zh.ch/de/politik-staat/wahlen-abstimmungen/kantons-regierungsratswahlen/mitglieder-kantonsrats-ab-1803.html) (Open Government Data des Kantons Zürich), [Wikidata](https://www.wikidata.org), Angaben zu Porträts auf Wikimedia Commons und im Staatsarchiv | Quellenangabe: Staatsarchiv und Statistisches Amt des Kantons Zürich; Wikidata CC0; Bilder nicht enthalten, Lizenz je Bild |
| `services/krdb/data/portrait-overrides.json` | Dateinamen auf Wikimedia Commons | Bilder nicht enthalten, Lizenz je Bild auf Commons |

Bedingungen der übrigen Bestände: [Impressum](https://archivquellen.ch/impressum).
