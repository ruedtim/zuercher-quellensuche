<script lang="ts">
	import { SITE_NAME, SOURCE_REPO_URL } from "$lib/site";
</script>

<svelte:head><title>Technische Architektur | {SITE_NAME}</title></svelte:head>

<a href="/about" class="text-sm text-accent-600">← Zurück zur Übersicht</a>

# Technische Architektur

Die Plattform läuft auf einem schlanken Open-Source-Stack.
Das massgebliche Format sind die TEI-P5-XML-Dokumente; alle sichtbaren Artefakte –
Suchindex, Detailseiten, Faksimile-Manifeste – werden daraus deterministisch
abgeleitet. Der Quellcode steht auf <a href={SOURCE_REPO_URL} rel="external">GitHub</a>,
ohne Quellentexte und Serverkonfiguration.

## Komponenten

| Schicht | Technologie | Zweck |
|---|---|---|
| Frontend | SvelteKit 2 (Svelte 5), Node.js 22 | UI, serverseitiges Rendern, APIs |
| Suchindex | Meilisearch 1.57 | Wortindex + Vektor-Hybrid, Facetten; Dokument- und Passagen-Index, dazu Archivkatalog, Ehedaten und Editionen |
| Embeddings | FastAPI + Jina v2-base-de | Vektoren für Thema-Filter, Ähnlichkeit und Passagen-Suche |
| MCP-Server | Teil des Frontends (`/api/mcp`) | Such-Werkzeuge für externe KI-Assistenten |
| Indexer | Node.js + TypeScript | TEI → Meilisearch + HTML + IIIF |
| Reverse Proxy | nginx | TLS, HTTP/2, IP-Kürzung, statische Dateien |
| Bildserver | IIIF-Server des Staatsarchivs; für die Ratsmanuale der Transkribus-Bildserver (READ-COOP SCE) – beide extern | IIIF Image API für die Faksimiles |
| Personen-Register | Kantonsratsdatenbank + Wikidata + Wikimedia Commons + Staatsarchiv (Z 1114) | Rats- und Regierungsmitglieder in den Kantonsratsprotokollen mit Wikidata-Link und Porträt (Bilder liefert der Server, nicht Wikimedia oder der Archivkatalog); der Indexer schreibt die zugeordneten Personen an jedes Protokoll (`krdbIds`) – Grundlage der Personenseiten mit allen Dokumenten einer Person |

## Das Primärformat: TEI P5

Jedes Dokument liegt als **TEI-P5-XML** vor. Drei Quellen speisen den Bestand:

- **Digitalisierte Altbestände** (rund 585'000 Dokumente): die Editionen des
  Staatsarchivs, in einem eigenen Git-Repository versioniert (`data/<Serie>/<Dokument>.xml`).
  Mit der Digitalisierung des Amtsblatts wächst dieser Teil weiter.
- **Born-digital Spätbestände** (rund 37'000 Dokumente) aus den offenen Daten des
  Kantons: Kantonsratsprotokolle ab Mai 1995 (Gever-Web-Service), Regierungsratsbeschlüsse
  ab Oktober 2008 (zh.ch) und die Offizielle Sammlung ab 1999 (ZH-Lex). Eigene Konverter
  laden die amtlichen PDFs, ziehen den Text heraus und schreiben daraus TEI – ohne
  Faksimile, mit Link auf das Original. Personen, Orte und Organisationen erkennt ein
  Named-Entity-Modell des Staatsarchivs.
- **Ratsmanuale** (1484–1798): die maschinelle Handschriftenerkennung (HTR) des
  Staatsarchivs in Transkribus. Ein eigener Konverter gliedert die Seiten in Sitzungen
  (ein Dokument je Sitzung), liest das Datum aus dem Sitzungskopf und schreibt TEI mit dem
  diplomatischen Text. Personen, Orte und Organisationen erkennt ein auf die
  Ratsmanuale trainiertes Named-Entity-Modell.

Ab hier durchlaufen alle dieselbe Pipeline. Eine wortgetreue Kopie des Original-XML wird
zusätzlich statisch hinterlegt, sodass zu jedem Dokument die TEI-Quelle herunterladbar ist.

## Datenmodell

Aus dem TEI-Primärformat werden zur Indexier-Zeit drei Ableitungen erzeugt:

1. **Meilisearch-Dokumente** mit Header-Metadaten, Volltext und Named Entities
   (für Suche und Facetten)
2. **HTML-Fragmente** auf der Festplatte (für die Detailansicht)
3. **IIIF-Manifeste** für den Faksimile-Viewer Mirador: Für das Amtsblatt und die
   Ratsmanuale erzeugt der Indexer eigene Manifeste (IIIF Presentation 3; die Bilder der
   Ratsmanuale lädt der Browser direkt vom Transkribus-Bildserver); für
   Gesetzessammlung, Kantonsratsprotokolle und Regierungsratsbeschlüsse verweist er auf
   die bestehenden Manifeste des Staatsarchivs (IIIF Presentation 2), die der Server
   durchreicht. Die born-digital Spätbestände haben kein Faksimile.

Aus dem TEI-Header stammen die strukturierten Felder, aus dem Dokumentkörper der
Volltext und die erwähnten **Personen, Orte und Organisationen**. Zu jedem Namen speichert der
Index einen **Vergleichsschlüssel**, in dem Schreibvarianten zusammenfallen (Fischental und
Fischenthal); ein Namensfilter trifft in den Dokumenten und den Editionen die gewählte Form oder
denselben Schlüssel, im Archivkatalog den Schlüssel. Bei den Ratsmanualen gehen nur vereinheitlichte
Namen in die Facetten, und der Volltext im Index ist eine **Lesefassung** der Transkription (siehe
[Ratsmanuale](/about/rm#text-maschinelle-transkription)).

## Suchindex als Datenbank

Meilisearch ist nicht nur eine Suchschicht, sondern der Speicher des Frontends. Der
**Dokument-Index** hält pro Dokument die strukturierten JSON-Felder, einen invertierten
Volltext-Index über Titel und Körper sowie den **768-dimensionalen Dokument-Vektor**. Dazu
kommt ein zweiter, feinerer **Passagen-Index** (siehe Vektor-Strategie).

Die Vektoren berechnet *Jina v2-base-de* im Embedding-Dienst, ausserhalb des Suchdienstes.
Derselbe Index beantwortet lexikalische Anfragen (Wortindex), rein semantische (Vektor-Nähe)
und hybride Mischformen.

Ein dritter Index, **catalog**, hält die Verzeichnungseinheiten des
[Online-Archivkatalogs](/about/archivkatalog), aufgebaut ausserhalb des Indexers aus einem
Abzug des Katalogs. Er ist lexikalisch durchsuchbar und trägt für Einheiten mit beschreibendem
Text Vektoren desselben Modells; Personendossiers, Ehedaten und Firmen haben keine. Einheiten,
die ein Plattform-Dokument abbilden (Bezug über die Katalog-ID, bei den Ratsmanualen über Band
und Seiten), sind markiert und erscheinen nicht als eigene Treffer. Felder mit «ß» führt der Index
ein zweites Mal mit «ss», weil Meilisearch beide nicht angleicht; gezeigt wird das Original.

Ein vierter Index, **ehedaten**, hält die [Ehedaten](/about/ehedaten), je Eheeintrag ein
Dokument (rund 296'000), aus demselben Katalog-Export. Er ist rein lexikalisch: Der Namensfilter
vergleicht gefaltete Namenswörter (Meier = Meyer) und verlangt alle Wörter eines Namens bei
derselben Person, die Herkunft vergleicht Ortsschlüssel. Felder mit «ß» stehen wie im Katalog
doppelt. Welche Einträge dieselbe Ehe sind, steht in einer Liste, die mit dem Code ausgeliefert wird.

Ein fünfter Index, **editions**, hält die Texte der [Editionen](/about/editionen), je
Quellenstück ein Dokument mit Text, Anmerkungen, Kommentar, Regest, Register und Bildliste, aus
den TEI-Daten der Edition; das Faksimile-Manifest baut die Anwendung je Anfrage. Gesucht wird in
einem Text mit angeglichenen Zeichen (ů → u, uͤ → ü, ß → ss). Die Vektoren entstehen nur aus Titel,
Schlagwörtern, Regest und Kommentar, die modernes Deutsch sind. Das
[Register der Editionen](/editionen/register) entsteht aus demselben Index.

Katalog, Ehedaten und Editionen werden in einem Zug neu übernommen: Der neue Stand entsteht in
einem zweiten Index und ersetzt danach den alten.

Welche Reiter die Suchseite zeigt, regelt ein kleines Register: Der Reiter steht in der
Adresse (`view=documents`, `view=catalog`, `view=ehedaten`, `view=editions`; ohne Angabe «Alle Quellen»), und ein Reiter
erscheint nur, wenn sein Index lesbar ist. Alle Reiter teilen die Filterspalte und die
Adresse; die übrigen Reiter liefern nur ihre Trefferzahl für die Beschriftung.

Dokumente ohne Vektor (Ratsmanuale) bleiben bei der Vektorsuche aussen vor: Trifft ein Filter nur
Ratsmanuale, läuft die Suche als reine Stichwortsuche.

## Vektor-Strategie: zwei Ebenen

Die semantische Suche arbeitet auf **zwei Granularitäten** mit demselben Embedder
(*Jina v2-base-de*, 768 Dimensionen).

**Dokument-Ebene – ein Vektor je Dokument**, berechnet aus Titel und Textanfang (rund 1'500
Zeichen, bis zu 512 Tokens). Er treibt das Thema, die Ähnlichkeitssuche und das semantische
Ranking der Trefferliste; den vollständigen Text trägt der Wortindex.

**Passagen-Ebene – viele Vektoren je Dokument.** Der zweite Index zerlegt jedes Dokument
satzweise in Passagen von höchstens rund 500 Tokens (mit Überlappung) und bettet **jede Passage
einzeln** ein – rund 1,64 Millionen Passagen. Abgefragt wird er über das MCP-Werkzeug
`passage_search`, das die passendsten Textstellen im Originalwortlaut liefert. Für
Partner-Systeme mit eigenem Embedding trägt er zusätzlich einen zweiten Vektorsatz
(*Qwen3-Embedding-0.6B*, 1024 Dimensionen) für die digitalisierten Altbestände,
abfragbar über `vector_search`.

**Ratsmanuale ohne Vektoren.** *Jina v2-base-de* erfasst die frühneuzeitliche, maschinell
transkribierte Sprache schlecht. Die Ratsmanuale sind darum nur über den Wortindex
erschlossen: Das Thema reiht sie nicht, Ähnlichkeitssuche und Passagen-Index lassen sie aus.

## KI-Assistenten über MCP

Eine Frage auf der Startseite wird zum Thema der Suche (siehe
[Suchhilfe](/about/suchhilfe#eine-frage-stellen)). Ausformulierte Antworten erzeugt ein
KI-Assistent der Nutzenden über den **MCP-Server** (Model Context Protocol, `/api/mcp`; Anleitung
unter [Eigene KI anbinden](/about/ai), Werkzeuge in der [API-Dokumentation](/about/api#mcp)). Der
Server bietet 16 Lese-Werkzeuge über dieselben Indizes wie Suche und API; das Modell plant die
Recherche selbst.

**Robust gegen Ausfälle.** Fehlt der Embedding-Dienst, arbeitet die Suche rein lexikalisch;
eine Frage von der Startseite wird dann zur Stichwortsuche über ihre Inhaltswörter. Von teuren
Anfragen läuft nur eine begrenzte Zahl gleichzeitig, weitere warten kurz; Bilder lädt
der Browser nur von den bekannten Bildservern, Skripte nur von dieser Website
(Content Security Policy).

## Der Indexer

Der Indexer ist ein eigenständiger Node-Prozess, der bei Bedarf läuft. Pro Datei durchläuft
er fünf Schritte:

1. **Parsen** – TEI-Header und -Körper werden zu Metadaten, Volltext und
   Entitätslisten aufgelöst.
2. **Faksimile auflösen** – je nach Serie wird ein lokales IIIF-Manifest erzeugt
   oder auf ein externes verwiesen.
3. **Rendern** – der Dokumentkörper wird zu HTML transformiert und auf die
   Festplatte geschrieben.
4. **Einbetten** – Titel und Textaufschlag werden in einen einzelnen Vektor
   überführt (siehe Vektor-Strategie; nicht bei den Ratsmanualen).
5. **Indizieren** – das fertige Dokument wird in Stapeln an Meilisearch übergeben.

Ein vollständiger Lauf baut den Index inklusive aller Vektoren neu auf; für kleinere
Korrekturen genügen Teilaktualisierungen der betroffenen Felder.

## Vom TEI zum HTML

Die Lese-Ansicht entsteht beim Indexieren: Ein Transformer bildet jedes TEI-Element in
Dokumentreihenfolge auf semantisches HTML mit einer beschreibenden Klasse ab, zum Beispiel:

- **Struktur**: `div` → Abschnitt, `head` → Überschrift, `p` → Absatz,
  `list`/`item` → Liste, `table`/`row`/`cell` → Tabelle.
- **Attribute steuern die Variante**: `@type` an `div`, `@level` an `head`,
  `@rend` an Hervorhebungen oder `@role` an Tabellenzellen entscheiden über das
  konkrete Ergebnis.
- **Editorischer Apparat**: Korrekturen, Ergänzungen, Streichungen, aufgelöste
  Abkürzungen und unsichere Lesungen erhalten eigene, typografisch unterscheidbare
  Auszeichnungen; Randnotizen (Marginalien) erscheinen neben dem Absatz.
- **Named Entities**: `persName`, `placeName` und `orgName` werden zu markierten
  Elementen, die das Hervorheben und Verknüpfen mit der Suche ermöglichen.
- **Seitenwechsel**: `pb`-Marken werden zu Ankern, die den Lesetext mit dem
  Faksimile verbinden.

Elemente ohne eigene Regel geben ihren Inhalt unverändert weiter, sodass kein Text
verloren geht.

Die Editionen haben einen eigenen Transformer derselben Art, nicht die Darstellungsregeln
(ODD) der Edition; er macht aus den Anmerkungen Marken mit einer Liste darunter.

## Betrieb

- **Ein Server:** Frontend, Suchindex und Embedding-Dienst laufen als
  Docker-Container auf einem einzelnen Server von Hetzner in Deutschland; davor steht
  nginx.
- **Deployment:** Ein Push auf den Hauptzweig baut über GitHub Actions ein neues
  Frontend-Image, legt es in der GitHub Container Registry ab und tauscht den
  laufenden Container aus. Indexierungsläufe starten gezielt, nicht bei jedem Push.
- **Caching:** Statische Dateien und API-Antworten tragen Cache-Header; die Vektoren
  von Thema-Anfragen hält der Server eine Stunde im Speicher, damit Blättern, Sortieren
  und Filtern nicht erneut einbetten müssen.
- **Monitoring:** Prometheus, Loki und Grafana auf demselben Server beobachten
  Auslastung, Suchdienst und die Aufrufe des MCP-Servers (siehe auch die
  [Datenschutzerklärung](/datenschutz)).
