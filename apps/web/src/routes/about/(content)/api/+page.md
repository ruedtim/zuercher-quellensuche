<script lang="ts">
	import { SITE_NAME } from "$lib/site";
</script>

<svelte:head><title>API | {SITE_NAME}</title></svelte:head>

<a href="/about" class="text-sm text-accent-600">← Zurück zur Übersicht</a>

# API

Die Plattform bietet **drei** öffentliche, kostenlose Lese-Schnittstellen für den Quellenbestand – rund 700'000 Dokumente aus Offizieller Gesetzessammlung (OS), Amtsblatt (ABl), Kantonsratsprotokollen (KRP) und Regierungsratsbeschlüssen (RRB) sowie aus den Ratsmanualen (RM) 1484–1798, dazu Archivkatalog, Ehedaten und Editionen: zwei REST-/Linked-Data-APIs und einen **MCP-Server** für KI-Assistenten ([Eigene KI anbinden](/about/ai)).

| Schnittstelle | Wofür | Format | Interaktiv | Spec |
|---|---|---|---|---|
| `/api/v1` | Suche, Filter, Facetten, Einzeldokumente, Ähnlichkeit | JSON | [Try it out](/api-doc) | [openapi.json](/api/v1/openapi.json) |
| `/api/dts` | Standardkonform (DTS 1.0): Sammlungen, Navigation, TEI/XML | JSON-LD + TEI/XML | [Try it out](/api-doc?spec=dts) | [openapi.json](/api/dts/openapi.json) |
| `/api/mcp` | Agentische KI: Such-Tools über Model Context Protocol | JSON-RPC (POST) | [Anbindung](#mcp) | – |

Für beide REST-APIs gelten <strong id="grundsaetze">gemeinsame Grundsätze</strong> (der MCP-Server ist ebenfalls offen und nur lesend, nimmt aber JSON-RPC per `POST` entgegen, siehe [Teil 3](#mcp)):

- **Nur lesend**, nur `GET`; **keine Authentifizierung**, kein API-Key
- **CORS offen** – direkt aus Browser-Anwendungen nutzbar
- **Rate-Limit** pro Client, gemeinsam für `/api/v1` und `/api/dts`, eigenes Kontingent für `/api/mcp` (siehe [Rate-Limit](#rate-limit)), gedeckeltes Blätter-Fenster
- **Semantische Suche:** Thema-Filter und Ähnlichkeitssuche von `/api/v1` (Vektor-Ähnlichkeit) – nicht für die Ratsmanuale, die keine Vektoren haben (siehe [Ratsmanuale](#ratsmanuale)).

**Inhalt:**

- [Teil 1 · JSON-API `/api/v1`](#api-v1) – [Schnellstart](#schnellstart) · [Endpunkte](#endpunkte) · [Parameter](#parameter) · [Ratsmanuale](#ratsmanuale) · [Archivkatalog](#archivkatalog) · [Ehedaten](#ehedaten) · [Editionen](#editionen) · [Fehlerformat](#fehler) · [Rate-Limit](#rate-limit)
- [Teil 2 · DTS 1.0](#dts)
- [Teil 3 · MCP-Server für agentische KI](#mcp)
- [Bulk-Daten: Dumps statt Crawling](#bulk-daten)
- [Lizenz und Zitieren](#lizenz)

---

<h2 id="api-v1">Teil 1 · JSON-API <code>/api/v1</code></h2>

Basis-URL `%SITE_URL%/api/v1`, alle Antworten JSON (UTF-8). Jede Antwort ist ein Envelope mit `data` (Inhalt), `meta` (u. a. `total`, Lizenz) und – wo paginiert – `links` (`self`/`next`/`prev`). Die volle Parameter-Referenz steht in der [interaktiven Referenz](/api-doc).

**Versionierung und Stabilität:** Bestehende Felder und Parameter ändern sich innerhalb von v1 nicht; **additive** Erweiterungen können jederzeit dazukommen (Clients sollten unbekannte Felder ignorieren). Die unversionierten `/api/…`-Routen der Website sind intern und können sich ohne Ankündigung ändern. Aktuelle Version: **1.1.0** (`version` im Einstiegspunkt und in der OpenAPI-Spec).

<h3 id="schnellstart">Schnellstart</h3>

```bash
# Regierungsratsbeschlüsse zur Hundesteuer, 1900–1950, nach Datum
curl "%SITE_URL%/api/v1/documents?q=Hundesteuer&series=RRB&dateFrom=1900&dateTo=1950&sort=date_asc"

# Ein einzelnes Dokument mit Volltext
curl "%SITE_URL%/api/v1/documents/MM_2_33_RRB_1837_0001"
```

<h3 id="endpunkte">Endpunkte</h3>

| Endpunkt | Inhalt |
|---|---|
| `GET /api/v1` | Einstiegspunkt: Links auf alles Weitere |
| `GET /api/v1/documents` | Suche mit Filtern, Sortierung, Paginierung |
| `GET /api/v1/documents/{id}` | Einzeldokument mit Volltext und Link-Bündel |
| `GET /api/v1/documents/{id}/similar` | Thematisch ähnliche Dokumente |
| `GET /api/v1/series` | Die Serien mit Umfang und Jahres-Spannen |
| `GET /api/v1/facets/{dim}` | Facetten-Werte mit Treffer-Zahlen |
| `GET /api/v1/stats` | Korpus-Statistik (gesamt, pro Serie, pro Jahr) |
| `GET /api/v1/catalog` | Verzeichnungseinheiten des Online-Archivkatalogs (siehe [Archivkatalog](#archivkatalog)) |
| `GET /api/v1/catalog/{id}` | Einzelne Verzeichnungseinheit (ID wie im Online-Katalog) |
| `GET /api/v1/ehedaten` | Eheeinträge der Ehedatenbank 1524–1800 (siehe [Ehedaten](#ehedaten)) |
| `GET /api/v1/ehedaten/{id}` | Einzelner Eheeintrag (ID wie im Online-Katalog) |
| `GET /api/v1/editions` | Stücke der Editionen des Staatsarchivs (siehe [Editionen](#editionen)) |
| `GET /api/v1/editions/{edition}/{id}` | Einzelnes Stück mit Text, Regest, Kommentar und Anmerkungen (etwa `qzh/QZH_401`, `ssrq/SSRQ_ZH_NF_II_3_047`) |
| `GET /api/v1/openapi.json` | OpenAPI-3.1-Spec |

<h3 id="parameter">Parameter und Antworten</h3>

**Suche `/api/v1/documents`** – die wichtigsten Parameter (vollständig in der [interaktiven Referenz](/api-doc)):

| Parameter | Bedeutung |
|---|---|
| `q` | Suchbegriff (lexikalisch, Volltext über Titel und Text). `"…"` für exakte Phrasen, `-wort` zum Ausschliessen. Anders als die Suche der Website ist `q` hier **tolerant**: Dokumente mit allen Wörtern kommen zuerst, danach solche, in denen einzelne Wörter fehlen. ODER-Verknüpfung und Nur-Titel-Suche gibt es in `/api/v1` nicht |
| `theme` | Thema (semantisch): rankt alle Filter-Treffer nach Ähnlichkeit (kein Schnitt), mit `q` kombiniert die Treffer von `q`. Nur bei Datums-Sortierung ein harter Schnitt auf die `topK` ähnlichsten Dokumente (Default 100, max. 1000), die dann nach Datum geordnet werden |
| `series` | Serien, kommasepariert: `ABl`, `KRP`, `OS`, `RRB`, `RM` |
| `dateFrom` / `dateTo` | Jahres-Spanne (inklusive), 1483–2100 (die Ratsmanuale beginnen 1484; eine Natalrat-Sitzung kann vom Dezember des Vorjahres sein) |
| `persons` / `places` / `organizations` | Namensfilter auf die exakte Namensform (wiederholbar: `?persons=A&persons=B`, mehrere = ODER) |
| `person` / `place` / `organization` | Namensfilter über die Schreibung hinweg (seit 1.1), wie die Suche der Website – `person=Escher, Alfred` trifft auch «Alfred Escher», gleichnamige Personen ebenso; ein Nachname allein wirkt exakt. Wiederholbar (höchstens 20 Werte), nicht mit der Mehrzahl in derselben Anfrage (`400`). Solange der Index die Schlüssel nicht trägt, filtern sie exakt (Hinweis in `meta.warnings`) |
| `volumeNr`, `startPg`, `serialNr`, `resolutionId`, `years` | serien-spezifische Filter (Band, Startseite, Ordnungsnummer, Beschlussnummer, Jahrgang); bei den Ratsmanualen ist `volumeNr` die Nummer in StAZH B II und `startPg` die laufende Sitzung im Band |
| `sort` | `relevance` (Default), `date_asc`, `date_desc` |
| `facets` | Facetten-Verteilungen mitliefern: `series,dateYear` |
| `offset` / `limit` | Paginierung: `limit` 1–100 (Default 20), `offset + limit` ≤ 1000 |

Treffer enthalten Metadaten und einen Text-Auszug (`excerpt`) um die Fundstelle – **nie den Volltext**; den liefert der Einzeldokument-Endpunkt. `meta.total` ist bei Volltext-Suchen eine Schätzung der Suchmaschine.

```bash
# Thema-Filter (semantisch) kombiniert mit Suchbegriff, Facetten mitliefern
curl "%SITE_URL%/api/v1/documents?theme=Hundewesen&q=Steuer&facets=series,dateYear"

# In welchen Dokumenten kommt jemand vor? persons: genau diese Namensform …
curl "%SITE_URL%/api/v1/documents?persons=Escher,%20Alfred&series=KRP"

# … person: auch andere Schreibungen («Alfred Escher», «Dr. Alfred Escher»)
curl "%SITE_URL%/api/v1/documents?person=Escher,%20Alfred&series=KRP"
```

**Einzeldokument `/api/v1/documents/{id}`** liefert alle Metadaten, den Volltext (`body`, normalisierter Lesetext mit «ss» statt «ß», max. 1 MiB), die in der Quelle verzeichneten Bezüge zu anderen Dokumenten (`relations`: Art des Bezugs, Ziel und Link, etwa Änderungen und Aufhebungen von Erlassen) und ein Link-Bündel: Dokument-Ansicht auf der Website (`web`), gerendertes HTML (`html`), TEI-XML-Quelle (`xml`), IIIF-Manifest des Faksimiles (`iiifManifest`, falls vorhanden), ZIP-Export (`zip`) und Ähnlichkeitssuche (`similar`). Bei den Ratsmanualen nennt `editions` die Einträge der Sitzung, die eine Edition des Staatsarchivs ediert ([QZH bzw. Zürcher Rechtsquellen](/about/rm#editionen)): Zitierform (`label`), Link auf das Stück (`url`), Titel, `relation` (`edition` oder `witness` für eine weitere Überlieferung) und Lizenz mit Nennung der Edition (`license`, `licenseUrl`, `attribution`); sonst ist die Liste leer.

**Ähnliche Dokumente `/api/v1/documents/{id}/similar`** – Ähnlichkeitssuche über Vektoren (`limit` 1–50, Default 10). Ist der Embedding-Dienst nicht verfügbar oder gehört das Dokument zu den Ratsmanualen, kommt eine leere Liste mit einem Hinweis in `meta.warnings`.

**Facetten `/api/v1/facets/{dim}`** – Wertelisten mit Treffer-Zahlen für `persons`, `places`, `organizations`, `resolutionId`, `serialNr`, `volumeNr`, `startPg` oder `years`. `fq` schränkt die Werte ein (Präfix bei Nummern/Identifikatoren, unscharfe Suche bei Namen); alle Such-Filter werden berücksichtigt (`theme` ausgenommen). Die angefragte Dimension selbst bleibt beim Zählen ungefiltert (Drill-Sideways). Die Namen in den Wertelisten sind Formen, wie sie in den Dokumenten stehen – auch mit `person`, `place` oder `organization` fasst die API Schreibvarianten nicht zusammen.

```bash
# Häufigste Personen in den Kantonsratsprotokollen, die mit «Müller» beginnen
curl "%SITE_URL%/api/v1/facets/persons?fq=M%C3%BCller&series=KRP"
```

<h3 id="ratsmanuale">Ratsmanuale (RM)</h3>

Die Ratsmanuale (Sitzungsprotokolle des Rats der Stadt und Republik Zürich 1484–1798, ein Dokument je Sitzung) sind eine maschinelle Transkription (HTR) des Staatsarchivs; Lesefehler sind möglich. Für sie gilt:

- **`body` ist die Lesefassung**, auf die auch die Suche zugreift: Worttrennungen am Zeilenende aufgelöst, Nasalstrich über m und n als Doppelbuchstabe, übrige diakritische Zeichen entfernt, ß im Wortinnern als ss. Die **diplomatische** Fassung (Schreibweise der Handschrift, mit Abkürzungen, unsicheren Lesungen und Randtiteln) liefern die TEI-Quelle (`links.xml`, DTS-`document`) und das gerenderte HTML (`links.html`).
- **Datum** wie geschrieben: bis 1700 im alten Stil (julianisch), nicht umgerechnet.
- **Keine Vektoren:** `theme` reiht die Ratsmanuale nicht (sie erscheinen nur über den Stichwort-Anteil), `similar` bleibt leer.
- **Namen:** `persons`, `places` und `organizations` enthalten vereinheitlichte Namen aus der automatischen Erkennung: Personen nur mit Vor- und Nachnamen (ohne Amt, Herkunft und Flexion), Orte aus einem Ortsverzeichnis unter ihrem heutigen Namen, kuratierte Ämter, Gerichte und Zünfte (ohne die Räte). In TEI und HTML bleiben die Namen ausgezeichnet, wie sie in der Quelle stehen.
- **Faksimile:** `links.iiifManifest` verweist auf ein Manifest der Plattform; die Bilder liegen auf dem Transkribus-Bildserver und tragen keine Rechtekennzeichnung (siehe [Lizenz](#lizenz)). Der ZIP-Export legt sie nicht bei, sondern verlinkt sie.

<h3 id="archivkatalog">Archivkatalog</h3>

`/api/v1/catalog` durchsucht die Verzeichnungseinheiten des [Online-Archivkatalogs](/about/archivkatalog) des Staatsarchivs (Akten, Urkunden, Pläne, Nachlässe …), ohne die Einheiten, die die Plattform selbst als Dokumente führt. Die Suche ist rein lexikalisch (Titel, Signatur, Regest bzw. Inhalt, Provenienz; alle Wörter müssen vorkommen, «ß» gilt als «ss»). Parameter: `q`, `dateFrom`/`dateTo` (auch vor 1483), `level` und `bestand` (wiederholbar), `digital=true`, `sort`, `facets=level,bestand,digital`, `offset`/`limit` wie bei `/documents`. `person`, `place` und `organization` (wiederholbar, mehrere = ODER) filtern auf die Namen des [Registers](/about/archivkatalog#register): Einheiten, an denen der Aufbau den Namen erkannt hat, Schreibvarianten eingeschlossen (`person=Meier, Anna` trifft auch «Anna Meyer»), gleichnamige Personen ebenso; eine Person braucht Vor- und Nachnamen. Die erkannten Namen selbst gibt die API nicht aus.

- Treffer tragen Signatur, Titel, Stufe, Entstehungszeitraum (`dateText`, `dateFrom`, `dateTo`), Bestand, Archivplan-Pfad (`path`), Provenienz, einen Auszug (`excerpt`), Digitalisat-Links (`files`) und den Permalink (`url`); `links.web` führt auf die Seite der Einheit auf dieser Plattform (`/archivkatalog/{id}`, mit allen veröffentlichten Abschnitten und Archivbaum). `/catalog/{id}` liefert statt des Auszugs den Text (`text`, Regest bzw. «Inhalt und Form», auf 2'000 Zeichen gekürzt). `document` nennt das Plattform-Dokument, das die Einheit abbildet (`relation: "depicts"`, nur in `/catalog/{id}`), oder auf das sie per Weblink verweist (`relation: "references"`, etwa eine Urkunde auf den Regierungsratsbeschluss dazu). `/catalog/{id}` führt in `editions` die Stücke der QZH und der Zürcher Rechtsquellen, die diese Einheit edieren (siehe [Editionen](/about/archivkatalog#editionen)), mit Lizenz und Nennung der Edition wie bei `/documents/{id}`.
- **Eigene Quelle:** `meta` führt statt `license` die Felder `source`, `sourceUrl` und `note`. Die Beschreibungen stammen vom Staatsarchiv; die Plattform macht zu ihnen keine Lizenzangabe. Zitieren mit Signatur und Permalink.
- Ist der Katalog nicht verfügbar, antworten beide Endpunkte mit `503` (`service_unavailable`).

```bash
curl -s "%SITE_URL%/api/v1/catalog?q=Katzensee&facets=level"
```

<h3 id="ehedaten">Ehedaten</h3>

`/api/v1/ehedaten` durchsucht die [Ehedaten](/about/ehedaten) des Staatsarchivs: rund 296'000 Eheeinträge (Trauungen und Verkündungen) aus den Zürcher Kirchenbüchern 1524–1800. Die Parameter heissen wie die Felder des Reiters «Ehedaten»:

- `q`: Volltext über Namen, Herkunft, Zusatzinfo, Kirchgemeinde und Signatur (alle Wörter müssen vorkommen, «ß» gilt als «ss»).
- `name` (Bräutigam oder Braut), `braeutigam`, `braut`: Alle Wörter müssen im Namen der Person stehen, Schreibvarianten zählen mit (Meier und Meyer); `name=Heusser` trifft jeden Heusser.
- `herkunft`: Gemeinde, Kanton oder Land (`Uster`, `Thurgau`, `Deutschland`; Weiler in Klammern zählen zu ihrer Gemeinde). Ein Wert mit Kantonskürzel oder Land in Klammern (`Wald TG`, `Lindau (Deutschland)`) gilt genau so, nicht für den gleichnamigen Zürcher Ort. `kirchgemeinde`: exakt, `Stadt Zürich` = die Stadtkirchen. `band`: Signatur des Kirchenbuchs ohne «, EDB n».
- `raum` (`zh`, `ch`, `ausland`: Herkunft mindestens einer Person), `quelle` (`E III`, `TAI`), `art` (`trauung`, `verkuendung`).
- `dateFrom`/`dateTo` (1524–1800), `sort` und `offset`/`limit` wie bei `/documents`; `facets=kirchgemeinde,raum,quelle,art,jahr,jahrzehnt` zählt die ganze Treffermenge in `meta.facets`.

Mehrere Werte eines Parameters (Namen, Herkunft, Kirchgemeinde, Band) gelten als ODER, verschiedene Parameter als UND. Ungültige Werte, etwa ein Jahr ausserhalb 1524–1800 oder ein Name ohne Wort, ergeben `400`.

- Treffer tragen `id` (Katalog-ID), `signature`, `volume` (Kirchenbuch), `entry` (Nummer «EDB n»), `page`, `source` (`E III`/`TAI`), `parish` (Kirchgemeinde des Kirchenbuchs), `type` (`trauung`/`verkuendung`, dazu `typeLabel`), `date` (`text` wie im Kirchenbuch, `from`/`to` als ISO-Daten, `yearFrom`/`yearTo`, `calendar`: `julian` bis 1700, sonst `gregorian`; nicht umgerechnet), `groom` und `bride` (`firstName`, `lastName`, `name`, `origin` wie in der Vorlage, `originNormalized`, `note` = Zusatzinfo, `hls`, `gnd`), `title`, `uncertain` und den Permalink des Online-Katalogs (`url`); `links.web` führt auf die Seite des Eintrags mit Ehe-Karte (`/archivkatalog/{id}`).
- **Dieselbe Ehe in zwei Kirchenbüchern:** `sameMarriage` nennt die übrigen Einträge derselben Ehe aus der geprüften Liste der Mehrfacheinträge des Staatsarchivs (Repository [stazh/sw-ehedaten](https://github.com/stazh/sw-ehedaten), 5'358 Ehen): `certainty` (`certain`, oder `probable`, wenn die Liste die Ehe nur als wahrscheinlich führt) und `entries` mit `id`, `signature`, `parish`, `type`, `typeLabel`, `date` und `links` je Eintrag, nach Datum. `null`, wenn die Liste den Eintrag nicht führt; sie erfasst nur einen Teil der Ehen, die in zwei Kirchenbüchern stehen. Nutzungsbedingungen der Liste: siehe [Ehedaten](/about/ehedaten#zitieren-und-lizenz).
- **Eigene Lizenz:** Die Ehedaten stehen unter **CC BY 4.0**. `meta` führt `license` und `licenseUrl`, die verlangte Nennung in `attribution` («Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert»), die Quelle der Einträge (Online-Archivkatalog) in `source` und in `note` den Stand, den veröffentlichten Datensatz auf Zenodo und einen Hinweis zu Namen, Kalender und Art der Einträge.
- `/ehedaten/{id}` liefert einen Eintrag, `404`, wenn es ihn nicht gibt. Ist der Ehedaten-Index nicht verfügbar, antworten beide Endpunkte mit `503`.

```bash
curl -s "%SITE_URL%/api/v1/ehedaten?name=Heusser&kirchgemeinde=Uster&facets=jahrzehnt&limit=2"
```

<h3 id="editionen">Editionen</h3>

`/api/v1/editions` durchsucht die [Editionen](/about/editionen) des Staatsarchivs: geprüfte Abschriften einzelner Quellenstücke, die 790 Stücke der Quellen zur Zürcher Geschichte (QZH, 1275–1795) und die 897 Stücke der Zürcher Rechtsquellen (SSRQ ZH, fünf Bände, 1180–1800). Rein lexikalisch wie der Reiter «Editionen»; nach Bedeutung sucht das MCP-Werkzeug `edition_search`.

- `q`: Volltext über Quellentext, Titel, Regest, Schlagwörter, Kommentar, Anmerkungen, Namen und Signatur (alle Wörter müssen vorkommen). Die Zeichen der Quellen sind angeglichen: `zů` trifft «zu», `daß` trifft «dass».
- `edition` (`qzh`, `ssrq`), `part` (Teil der Edition, bei den Rechtsquellen der Band, etwa «SSRQ ZH NF II/3: Die Landvogtei Greifensee»), `keyword` (Schlagwort), `person`, `place`, `organization` (Namen des Registers, über die Schreibung hinweg), `facsimile=true` (nur Stücke mit Bildern); `dateFrom`/`dateTo` (Stücke, deren Datum den Zeitraum berührt), `sort` und `offset`/`limit` wie bei `/documents`; `facets=edition,part,keyword,facsimile` zählt die ganze Treffermenge in `meta.facets`.
- Treffer tragen `edition`, `id` (Kennung in der Edition, etwa `QZH_401` oder `SSRQ_ZH_NF_II_3_047`), `label` (Zitierform, etwa «SSRQ ZH NF II/3 Nr. 47»; die Rechtsquellen zählen je Band), `title`, `part`, `date` (`text`, `from`/`to` als ISO-Daten, `yearFrom`/`yearTo`; wie in der Quelle, in Zürich bis 1700 alter Stil), `signature` (Vorlage), `keywords`, `hasFacsimile`, einen Auszug (`excerpt`) und den Permalink in der Edition (`url`); `links.web` führt auf die Seite des Stücks, `links.iiifManifest` auf sein IIIF-Manifest.
- `/editions/{edition}/{id}` liefert dazu Bearbeitung, Vorlage (`catalogIds` → `/api/v1/catalog/{id}`), `witnesses` (weitere Überlieferungen desselben Stücks mit Signatur, Datum und Katalog-IDs; die Edition beschreibt sie nur, ediert ist der Text aus der Vorlage), `calendar` (`julian`, wo die Edition den alten Stil angibt), `regest`, `text` (Lesefassung wie in der Suche: Abkürzungen aufgelöst, Zeichen angeglichen), `html` (der Text der Edition mit Originalzeichen, Seiten- und Zeilenwechseln), `notes`, `comment`, `persons` (QZH mit GND), `places` (mit Koordinaten, wo die Edition sie hat), `keywordGlosses` (Erklärung der Schlagwörter, Rechtsquellen), `entitySource` (`ner`, wenn die Namen automatisch erkannt sind, weil die Edition im Stück keine auszeichnet), `pages` und `images` (IIIF Image API 2). Die Kennung eines einzelnen Texts der Rechtsquellen (`…_047_1`, `…_047_2`) liefert sein Stück.
- **Eigene Lizenz je Edition:** Jedes Stück trägt `license`, `licenseUrl` und die verlangte Nennung (`attribution`) seiner Edition, bei den QZH die Rechte an den Abbildungen in `imagesLicense` – QZH und Rechtsquellen **CC BY 4.0** für die Editionsdaten, die Abbildungen der QZH gemeinfrei. `meta.note` erklärt die Felder.
- Ist der Editionen-Index nicht verfügbar, antworten beide Endpunkte mit `503`.

```bash
curl -s "%SITE_URL%/api/v1/editions?q=t%C3%B6uffer&place=Gr%C3%BCningen&facets=part&limit=2"
```

<h3 id="fehler">Fehlerformat</h3>

Fehler kommen als JSON mit stabilem `code`:

```json
{ "error": { "code": "pagination_window_exceeded", "message": "…", "status": 400 } }
```

| Code | Status | Bedeutung |
|---|---|---|
| `invalid_parameter` | 400 | Ungültiger Wert eines bekannten Parameters (unbekannte Parameter-Namen werden ignoriert) |
| `pagination_window_exceeded` | 400 | `offset + limit` > 1000 – für Komplettbezüge die [Dumps](#bulk-daten) nutzen |
| `not_found` | 404 | Unbekannte Dokument-ID oder unbekannter Endpunkt |
| `method_not_allowed` | 405 | Nur `GET` wird unterstützt |
| `rate_limited` | 429 | Rate-Limit überschritten – `Retry-After`-Header beachten |
| `internal_error` | 500 | Serverfehler |
| `service_unavailable` | 503 | Archivkatalog, Ehedaten oder Editionen gerade nicht verfügbar |

<h3 id="rate-limit">Rate-Limit und Fair Use</h3>

Standardmässig sind **60 Anfragen pro Minute** pro Client erlaubt (Antwort-Header `X-RateLimit-Limit` / `X-RateLimit-Remaining`; bei Überschreitung HTTP 429 mit `Retry-After` in Sekunden). Das Limit gilt **gemeinsam für `/api/v1` und `/api/dts`**. Der MCP-Server hat ein eigenes Kontingent von **300 JSON-RPC-Nachrichten pro Minute**; eine Überschreitung meldet er als Werkzeug-Fehler mit der Wartezeit (`rate_limited`, `retryAfterS`), zu viele gleichzeitige Aufrufe ebenso mit `busy`. Eine Anfrage darf dort höchstens 64 KB gross sein, ein Batch höchstens 10 Nachrichten enthalten. Als Client zählt jeweils ein Netzbereich (die gekürzte IP-Adresse) – mehrere Nutzende im selben Netz teilen sich das Kontingent. Bitte Antworten cachen und bei automatisierten Abfragen einen aussagekräftigen `User-Agent` mitschicken. Wer dauerhaft höhere Limits braucht, meldet sich über die [Kontaktangaben](/impressum).

---

<h2 id="dts">Teil 2 · DTS 1.0 (Distributed Text Services)</h2>

Zusätzlich bietet der Bestand eine Schnittstelle nach dem **[Distributed-Text-Services-Standard (DTS) 1.0](https://dtsapi.org/specifications/versions/v1.0/)** – der Linked-Data-API für Textsammlungen (JSON-LD für Metadaten, TEI/XML für die Texte). Es gelten dieselben [gemeinsamen Grundsätze](#grundsaetze) wie für `/api/v1`.

- **Einstiegspunkt:** [/api/dts](/api/dts) (EntryPoint mit den URI-Templates der drei Operationen)
- **Hierarchie:** Korpus → Serie (ABl/KRP/OS/RRB/RM) → Jahrgang → Dokument (Resource)
- **Interaktiv ausprobieren:** [/api-doc?spec=dts](/api-doc?spec=dts) («Try it out») · **Spec:** [/api/dts/openapi.json](/api/dts/openapi.json)

| Endpunkt | Inhalt |
|---|---|
| `GET /api/dts` | EntryPoint: Links auf Collection/Navigation/Document |
| `GET /api/dts/collection{?id,page,nav}` | Sammlungen navigieren (Korpus → Serie → Jahr → Dokument); `nav=parents` für die Elternkette |
| `GET /api/dts/navigation{?resource,…}` | Zitierstruktur einer Resource (Dokument-Ebene: eine CitableUnit) |
| `GET /api/dts/document{?resource,…}` | Volltext als TEI/XML (Default); `mediaType=text/html` (gerendert) oder `text/plain` (Lesetext; bei den Ratsmanualen die Lesefassung) |

```bash
# Einstieg und Navigation durch die Hierarchie
curl "%SITE_URL%/api/dts"
curl "%SITE_URL%/api/dts/collection?id=RRB"        # Jahrgänge der RRB
curl "%SITE_URL%/api/dts/collection?id=RRB/1837"   # Dokumente von 1837

# Zitierstruktur und Volltext eines Dokuments
curl "%SITE_URL%/api/dts/navigation?resource=MM_2_33_RRB_1837_0001"
curl "%SITE_URL%/api/dts/document?resource=MM_2_33_RRB_1837_0001"  # TEI/XML
```

Die Zitiertiefe ist die Dokument-Ebene (ein Dokument = eine zitierbare Einheit). Konformität prüfbar mit dem offiziellen [DTS-Validator](https://github.com/distributed-text-services/validator).

---

<h2 id="mcp">Teil 3 · MCP-Server für agentische KI</h2>

Für KI-Systeme, die **selbständig** recherchieren, gibt es einen **MCP-Server** nach dem [Model Context Protocol](https://modelcontextprotocol.io) (Anleitung für Nutzende: [Eigene KI anbinden](/about/ai)). Er greift auf dieselben Daten wie `/api/v1` zu; die Treffer sind knapper geschnitten (siehe [Form der Ergebnisse](#mcp-form)).

- **Endpunkt:** `%SITE_URL%/api/mcp` – Transport **Streamable HTTP** (JSON-RPC 2.0 über `POST`, kein SSE-Kanal)
- **Zugang:** offen, keine Authentifizierung; eigenes [Kontingent](#rate-limit) von 300 Nachrichten pro Minute je Netz
- **Discovery:** [/llms.txt](/llms.txt) und [/.well-known/mcp.json](/.well-known/mcp.json)
- **Anweisungen:** `initialize` liefert eine Beschreibung der Bestände, ihrer Lücken, der Suchstrategien und der Zitierregeln (`instructions`). Dieselben Grundangaben liefern das Tool `coverage` und die Ressource `zszh://coverage` zur Laufzeit.
- **Prompt:** `recherche` (Argument `frage`) – eine Vorlage für eine gründliche, mehrstufige und belegte Recherche (`prompts/list`, `prompts/get`).

**Tools** (16, alle nur lesend, `readOnlyHint`):

| Tool | Wofür |
|---|---|
| `search` | **Föderierter Einstieg**: fragt alle Bestände parallel ab, Dokumente und Katalog zugleich wörtlich und nach Bedeutung. Je Treffer `collection` (Bestand) und `ranking` («keyword» = wörtlicher Treffer, «semantic» = thematischer Nachbar); `totals` nennt die wörtliche Trefferzahl je Bestand, `unavailable` einen Bestand, der gerade nicht lesbar ist. Filtert nicht und zeigt je Bestand nur wenige Treffer |
| `fetch` | Einen Treffer vollständig laden: eine **nackte id** ist ein Dokument mit Volltext und Signatur `stazhIdent`, mit Präfix eine Katalogeinheit (`catalog:669821`), ein Eheeintrag (`ehe:1999619`) oder ein Editionsstück (`edition:QZH_401`) |
| `fetch_many` | Bis zehn ids in einem Aufruf, auch aus verschiedenen Beständen |
| `catalog_search` | Verzeichnungseinheiten des [Online-Archivkatalogs](/about/archivkatalog), ohne Volltext – wörtlich wie `/api/v1/catalog` oder mit `semantic=true` nach Bedeutung, auch mit `person`, `place` und `organization`; ein Name, der so nicht filtern kann (eine Person ohne Vornamen), ergibt einen Fehler, eine unbekannte Stufe eine Warnung statt eines Filters |
| `passage_search` | Die passendsten **Textstellen** zu einer Frage, je Dokument eine Passage im Originalwortlaut bis rund 2'200 Zeichen; Zentrale Serien ohne die Ratsmanuale |
| `ehedaten_search` | Eheeinträge der [Ehedaten](/about/ehedaten) nach `name`, `braeutigam`, `braut`, `herkunft`, `raum`, `kirchgemeinde`, Jahren, `art` und Volltext `query`; mit `groupBy` Zählungen je Kirchgemeinde, Jahr, Jahrzehnt, Herkunftsraum, Art oder Überlieferung, `topK=0` zählt nur; mit `sameMarriage`, Lizenz und Nennung |
| `edition_search` | Stücke der [Editionen](/about/editionen) wörtlich oder mit `semantic=true` nach Bedeutung, mit `person`, `place`, `keyword` und Jahren; mit `id` ein Stück vollständig; jedes mit Lizenz und Nennung |
| `semantic_search` | Dokumente nach Bedeutung |
| `keyword_search` | Stichwortsuche, mit Filtern für Serie und Zeitraum |
| `list_documents` | Titel-Überblick zu einem Thema oder Namen |
| `count_documents` | Anzahl |
| `timeline` | Jahresverteilung mit den zehn Spitzenjahren `peakYears` |
| `overview` | Anzahl, Serien- und Jahresverteilung und Top-Treffer in einem Aufruf |
| `similar_documents` | Thematisch ähnliche Dokumente |
| `vector_search` | Für Partner-Systeme mit eigenem Query-Embedding: Vektorsuche auf Passagen-Ebene mit einem Qwen3-Embedding-0.6B-Vektor, beschränkt auf den Staatsarchiv-Bestand ohne die Ratsmanuale |
| `coverage` | Ohne Argumente: je Bestand Inhalt, Umfang und Zeitspanne **live** aus dem Index, bekannte Lücken, Werkzeuge je Suchart (`byMode`), Lizenz und Nennung; eine gerade nicht lesbare Quelle ist mit `error` markiert |

Die lexikalischen Tools kennen zusätzlich `exact` (siehe unten), `field='title'` (nur im Titel suchen; Titelkonventionen schwanken über Serien und Zeit) und `offset` (Paginierung; `semantic_search` und `passage_search` ebenfalls, bei den Passagen reicht das Fenster `offset + topK` bis 60).

`keyword_search`, `list_documents`, `count_documents`, `timeline` und `overview` erfassen nur Dokumente, die alle Wörter der Anfrage enthalten (Reihenfolge egal); `semantic_search` und `passage_search` verlangen das nicht. Dieselben fünf nehmen `alternatives` (Synonyme, historische Schreibweisen); jede Variante ist eine eigene Suche. Die Trefferzahl je Variante steht in `totals` (ausser bei `timeline`); `total` ist die grösste davon, also eine untere Grenze der Vereinigung (`totalIsLowerBound`), `count` die Zahl der gelieferten Treffer. `bySeries` und `byYear` sind über die Varianten summiert, also Verteilung, nicht Grösse: Ein Dokument kann mehrere Varianten enthalten.

Beim Blättern (`offset`) sind `keyword_search` und `list_documents` exakt; bei `passage_search` und `semantic_search` kann ein Treffer erneut erscheinen, `note` sagt wann. Tragen `passage_search` oder `vector_search` `partial: true` und eine `warning`, ist die Liste womöglich unvollständig.

**Genau oder tolerant – `exact`, `phrase` und `exactTotal`:** Die Stichwortsuche ist unscharf: Das **letzte** Suchwort wird um Wortanfänge ergänzt («Pause» trifft «Pausen»), und ab einer Mindestlänge zählt ein Buchstabe Unterschied mit (siehe [Suchhilfe](/about/suchhilfe#tippfehler-toleranz)). `exact=true` verlangt **jedes Wort** genau so, Reihenfolge und Abstand frei; `phrase=true` macht die ganze Anfrage zu einer Wortfolge und gewinnt, wenn beide gesetzt sind. Genau gesucht fehlen die Beugungsformen; sie kommen über `alternatives` oder eine zweite Suche dazu. `exact` gilt für `keyword_search`, `list_documents`, `count_documents`, `timeline`, `overview` und `catalog_search` (dort gibt es kein `phrase`).

<h3 id="mcp-form">Form der Ergebnisse</h3>

Die MCP-Treffer sind eine **schlanke Projektion** der `/api/v1`-Objekte, damit mehr davon ins Kontextfenster passen:

- **Leere Felder fehlen** (ein fehlendes Feld heisst leer bzw. nein, nicht «unbekannt»).
- **Was sich aus einem anderen Feld ergibt, fehlt:** `links.self`, `links.catalog` bzw. `links.edition` (= `url`), `links.web` bei Dokumenten (= `url`), `dateYear` neben `date`, `yearFrom`/`yearTo` neben `from`/`to`, Vor- und Nachname neben `name`.
- **Der Archivplan-Pfad** steht bei `catalog_search` als String in `pathText` («Sammlungen › PLAN Karten und Pläne › PLAN H Ausland»); der Filterwert `bestand` bleibt daneben stehen.
- **Lizenz und Nennung** bleiben: Jedes Stück von `edition_search` trägt `license` und `attribution` seiner Edition, die Lizenz-URLs stehen einmal je Edition in `rights`; die Ehedaten tragen Lizenz und Nennung in jeder Antwort.
- **`verbose=true`** liefert bei `catalog_search`, `ehedaten_search` und `edition_search` die vollen `/api/v1`-Strukturen (`path` mit IDs und URLs, alle Link-Bündel, leere Felder als `null`). `vector_search` liefert die Dokument-Metadaten immer in der vollen Form.

**Hinweise im Ergebnis:** Bleibt eine Suche leer, nennt `hint`, was ohne Serie, Zeitraum oder die exakte Form herauskäme bzw. wie oft jedes Wort einzeln vorkommt. Hat sie Treffer und steht mindestens ein Wort ohne Anführungszeichen in der Anfrage, steht die Zahl der genau geschriebenen Treffer in `exactTotal`, bei wesentlicher Abweichung mit `hint`; mit `alternatives` entfällt das. Die übrigen Zahlen (`bySeries`, `byYear`, `years`, `peakYears`) zählen immer die ganze Treffermenge. `timeline` warnt mit `caveat` vor den Digitalisierungslücken von Amtsblatt und Regierungsratsbeschlüssen und sagt mit `note`, dass vor 1803 nur Ratsmanuale zählen. `catalog_search` meldet, wenn das letzte Suchwort nur als Wortanfang trifft («Pest» → «Pestalozzi»), `ehedaten_search` Namensvettern.

Die Regierungsratsbeschlüsse des 19. Jahrhunderts dominieren den Korpus; bei Fragen zu Personen oder aktuellen Themen lohnt sich ein `series`- oder `dateFrom`-Filter (mehrwortige Namen mit `phrase=true`, Zählungen mit `exact=true`). Mit `series=["RM"]` sucht `semantic_search` lexikalisch (mit Hinweis im Ergebnis), `passage_search` verweist auf `keyword_search`, `similar_documents` bleibt leer. Dokumente sind ausserdem als **MCP-Ressourcen** lesbar (URI-Template `zszh://document/{id}`); `resources/list` führt `zszh://coverage` (JSON).

**ChatGPT ohne MCP – Custom-GPT «Actions»:** Ein eigenes GPT importiert direkt die [OpenAPI-Datei](/api/v1/openapi.json) von `/api/v1` als Action.

```bash
# Tool-Liste abrufen (JSON-RPC)
curl -s -X POST %SITE_URL%/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Textstellen zu einer Frage
curl -s -X POST %SITE_URL%/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"passage_search","arguments":{"query":"Massnahmen gegen die Tollwut","dateTo":1900}}}'

# Bestände, Umfang und Lücken (ohne Argumente)
curl -s -X POST %SITE_URL%/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"coverage"}}'
```

---

<h2 id="bulk-daten">Bulk-Daten: Dumps statt Crawling</h2>

Die APIs sind für **gezielte Abfragen** gebaut, nicht für den Komplettbezug. Für **einzelne Recherchen** gibt es in der Suche den Knopf «Alle Treffer herunterladen» (siehe [Suchhilfe](/about/suchhilfe#treffer-herunterladen)). Ganze Serien oder den ganzen Bestand gibt es als Open-Data-Pakete:

- **[opendata.swiss – Datensätze des Staatsarchivs des Kantons Zürich](https://opendata.swiss/de/organization/staatsarchiv-des-kantons-zuerich)** – die digitalisierten Editionsbestände (TEI-XML) als OGD-Datensätze
- Die zugehörigen **Zenodo-Ablagen** der Editionsprojekte (eOSZH, TKR) sind in den jeweiligen opendata.swiss-Einträgen verlinkt

Bitte kein systematisches Crawling der API oder der Website.

---

<h2 id="lizenz">Lizenz und Zitieren</h2>

Die bereitgestellten Quellentexte und Metadaten sind amtliche Erlasse, Entscheidungen und Protokolle von Behörden und damit **urheberrechtlich nicht geschützt** ([Art. 5 URG](https://www.fedlex.admin.ch/eli/cc/1993/1798_1798_1798/de#art_5)). Sie sind als gemeinfrei gekennzeichnet (**[Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/deed.de)**; Quellen: Staatsarchiv des Kantons Zürich für die digitalisierten Altbestände und die Ratsmanuale, Kantonsrat, Regierungsrat bzw. Staatskanzlei des Kantons Zürich für die Spätbestände); jede API-Antwort führt Kennzeichnung und Herkunft in `meta` mit (`license`, `licenseUrl`, `attribution`). Ausgenommen sind die Angaben des [Archivkatalogs](#archivkatalog) (`/api/v1/catalog`, MCP `catalog_search`): Die Beschreibungen verfasst das Staatsarchiv, die Plattform macht zu ihnen keine Lizenzangabe; `meta` nennt dort Quelle und Zitierhinweis. Ebenfalls ausgenommen sind die [Ehedaten](#ehedaten) (`/api/v1/ehedaten`, MCP `ehedaten_search`): Der Datensatz des Staatsarchivs steht unter **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de)**; wer ihn weitergibt, nennt «Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert» (`meta.attribution`). Die Verweise auf Editionen (`editions` in `/documents/{id}` und `/catalog/{id}`) und die Stücke der [Editionen](#editionen) selbst (`/api/v1/editions`, MCP `edition_search`) tragen in jedem Eintrag die Lizenz der Edition und die verlangte Nennung (Quellen zur Zürcher Geschichte und Zürcher Rechtsquellen: **CC BY 4.0**, die Abbildungen der QZH gemeinfrei). Die Faksimiles der Ratsmanuale – Digitalisate des Staatsarchivs auf dem Transkribus-Bildserver – tragen keine Rechtekennzeichnung, nur den Nachweis «Digitalisat: Staatsarchiv des Kantons Zürich, StAZH B II …».

Für die als gemeinfrei gekennzeichneten Texte und Metadaten heisst das: **keine Bedingungen**, auch kommerziell. Eine Quellenangabe ist nicht Pflicht, aber gute Praxis. Unabhängig davon gilt der Datenschutz: Die Bestände nennen auch lebende Personen (siehe [Datenschutzerklärung](/datenschutz), Abschnitt 12). Vorschlag für die Quellenangabe:

> Staatsarchiv des Kantons Zürich (bei den Spätbeständen Kantonsrat, Regierungsrat bzw. Staatskanzlei des Kantons Zürich), Archiv-Signatur (`stazhIdent`) bzw. Dokument-ID, abgerufen über %SITE_HOST%.

Jedes Dokument trägt in `links.web` einen stabilen Link auf seine Ansicht auf dieser Website.
