<script lang="ts">
	import { SITE_NAME } from "$lib/site";
</script>

<svelte:head><title>Eigene KI anbinden | {SITE_NAME}</title></svelte:head>

<a href="/about" class="text-sm text-accent-600">← Zurück zur Übersicht</a>

# Eigene KI anbinden

Eine Frage auf der Startseite sucht nach Bedeutung und zeigt die passendsten Treffer je Quelle.

Wer eine **ausformulierte Antwort mit Quellenangaben** möchte, verbindet einen eigenen KI-Assistenten mit dem Archiv: Claude, ChatGPT, Apertus oder ein anderes Werkzeug, das das [Model Context Protocol](https://modelcontextprotocol.io) (MCP) unterstützt. Der Assistent durchsucht die Bestände dann selbst und belegt seine Antwort mit Links auf die Originaldokumente.

## Frage auf der Website

Das Feld der Startseite nimmt eine ganze Frage oder ein Thema auf. «Suchen» reiht Archivkatalog, Zentrale Serien und Editionen nach Bedeutung; was in Anführungszeichen steht, wird wörtlich gesucht, und «wörtlich» sucht den ganzen Text so. Wie das im Einzelnen wirkt, steht in der [Suchhilfe](/about/suchhilfe#eine-frage-stellen).

## Verbinden

Die Adresse des MCP-Servers:

```
%SITE_URL%/api/mcp
```

Eine Anmeldung ist nicht nötig. Der Server spricht MCP über HTTP («Streamable HTTP»).

- **Claude** (claude.ai, Claude Desktop): In den Einstellungen unter «Connectors» einen eigenen Connector («Custom Connector») mit dieser Adresse hinzufügen und in der Unterhaltung einschalten.
- **ChatGPT**: In den Einstellungen unter «Connectors» bzw. «Apps» einen eigenen MCP-Server mit dieser Adresse anlegen, ohne Authentifizierung. Für Deep Research nutzt ChatGPT die Werkzeuge `search` und `fetch`.
- **Le Chat** (Mistral): Unter «Connectors» einen eigenen MCP-Connector mit dieser Adresse hinzufügen.
- **Claude Code**: `claude mcp add --transport http quellensuche %SITE_URL%/api/mcp`
- **Andere Werkzeuge** (Entwicklungsumgebungen, eigene Agenten): als MCP-Server vom Typ HTTP mit dieser Adresse eintragen.

Ob und in welchem Abo eigene Connectors möglich sind, entscheidet der Anbieter; die Bezeichnungen in den Einstellungen ändern sich gelegentlich.

## Was der Assistent damit kann

Der Server bietet Werkzeuge über alle Quellen der Plattform; die technische Beschreibung steht in der [API-Dokumentation](/about/api#mcp).

| Werkzeug | Wofür |
| --- | --- |
| `search` | der Einstieg: durchsucht ALLE Bestände gleichzeitig – Archivkatalog, Volltexte der Zentralen Serien samt Ratsmanualen, Ehedaten, Editionen – wörtlich und nach Bedeutung, und nennt die Trefferzahl je Bestand |
| `passage_search` | die passendsten Textstellen zu einer Frage, im Originalwortlaut, auch tief in langen Dokumenten (Zentrale Serien ohne Ratsmanuale) |
| `semantic_search` | Dokumente nach Bedeutung |
| `keyword_search`, `list_documents` | Stichwort- und Namenssuche (alle Wörter), Titel-Überblick – mit alten Schreibweisen als Varianten |
| `count_documents`, `timeline`, `overview` | Zahlen und Jahresverteilungen, mit alten Schreibweisen als Varianten und Hinweis auf Digitalisierungslücken |
| `fetch`, `fetch_many`, `similar_documents` | einen oder mehrere Treffer vollständig laden – Dokumente mit Volltext, ebenso Katalogeinheiten, Eheeinträge und Editionsstücke –, dazu ähnliche Dokumente |
| `catalog_search` | Akten, Urkunden, Pläne und Nachlässe im [Archivkatalog](/about/archivkatalog), auch nach Bedeutung |
| `ehedaten_search` | Eheeinträge 1524–1800 ([Ehedaten](/about/ehedaten)), mit Zählungen |
| `edition_search` | edierte Quellenstücke mit Regest und Kommentar: Quellen zur Zürcher Geschichte und Zürcher Rechtsquellen ([Editionen](/about/editionen)) |
| `coverage` | was hier überhaupt liegt: je Bestand Umfang, Zeitspanne, bekannte Lücken, zuständige Werkzeuge und Lizenz |

`search` zeigt je Bestand nur wenige Treffer und filtert nicht; vertieft wird mit dem Werkzeug des Bestands. Der Archivkatalog verzeichnet mit 1,26 Mio. Einheiten das ganze Archiv, die Volltexte der Zentralen Serien umfassen 0,62 Mio. Dokumente ab 1803 und 75'000 Ratsmanual-Sitzungen.

Mit der Verbindung erhält der Assistent eine Beschreibung der Bestände, ihrer Lücken und der Suchstrategien; `coverage` liefert sie auch später. Bleibt eine Suche leer, sagt das Ergebnis, was ohne Serie, Zeitraum oder die exakte Form herauskäme.

**Zu viele Treffer sind der stillere Fehler.** Die Stichwortsuche ist unscharf: Das letzte Suchwort trifft auch längere Wörter, und ab einer Mindestlänge zählt ein Buchstabe Unterschied mit ([Suchhilfe](/about/suchhilfe)). «Pause» ergibt so rund 3'000 Dokumente, genau so geschrieben ist es in rund 870. Der Server nennt darum zusätzlich die Zahl der genau geschriebenen Treffer (`exactTotal`); mit `exact=true` sucht der Assistent nur diese, dann aber ohne gebeugte Formen wie «Pausen». Für Mengenangaben taugt die genaue Suche, fürs Finden die tolerante.

## Gute Fragen

- **Prompt «recherche».** Der Server bietet eine Vorlage für eine gründliche, belegte Recherche mit mehreren Suchen und Quellenangaben. In Claude ist sie über das Menü der Unterhaltung wählbar.
- **Die Verbindung nennen.** Ein Satz wie «Recherchiere mit dem MCP-Server {SITE_NAME} und belege jede Aussage mit Link» hält den Assistenten bei den Quellen.
- **Zeitraum und Quelle angeben**, wo sie zur Frage gehören: «Was beschloss der Regierungsrat zwischen 1850 und 1870 zum Eisenbahnbau?»
- **Massgeblich sind die Originale.** Ein Sprachmodell kann Quellen falsch verknüpfen, Zahlen ungenau wiedergeben oder Lücken übersehen. Folgen Sie den Links zu den Dokumenten.
- **Ratsmanuale (1484–1798)** sind maschinell transkribiert (Lesefehler möglich) und nur per Stichwort durchsuchbar; Daten bis 1700 stehen im alten Stil (siehe [Ratsmanuale](/about/rm)).

## Datenschutz und Grenzen

- Ihre Frage und die Antwort verarbeitet der Anbieter Ihres Assistenten, nach dessen Bedingungen. Bei uns kommen nur die Werkzeug-Aufrufe an, die der Assistent schickt – meist von den Servern des Anbieters aus.
- Im Nutzungs-Log stehen je Aufruf Werkzeug, Dauer, Trefferzahl und ob ein Fehler auftrat, keine Suchwörter (siehe [Datenschutzerklärung](/datenschutz), Abschnitt 9).
- Je Netz gilt ein Kontingent von 300 Aufrufen pro Minute; wird es überschritten oder laufen gerade zu viele Aufrufe gleichzeitig, meldet der Server dem Assistenten, wann er weitermachen kann.
- Die Daten der Ehedaten und der Editionen tragen eigene Lizenzen; die Werkzeuge liefern Nennung und Lizenz mit.

---

Die technische Seite ist unter [Architektur](/about/architektur) skizziert.
