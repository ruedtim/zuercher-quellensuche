<script lang="ts">
	import { SITE_NAME } from "$lib/site";
</script>

<svelte:head><title>Ehedaten | {SITE_NAME}</title></svelte:head>

<a href="/about" class="text-sm text-accent-600">← Zurück zur Übersicht</a>

# Zürcher Ehedaten 1524–1800

| | |
|---|---|
| **Quelle** | Ehedatenbank des Staatsarchivs des Kantons Zürich («Zürcher Ehedaten 16.–18. Jahrhundert»), wie sie der [Online-Archivkatalog](https://suche.staatsarchiv.djiktzh.ch) führt, Stand 9. November 2026; als Datensatz veröffentlicht auf [Zenodo](https://doi.org/10.5281/zenodo.11191059) (Version 6.0 vom 14. Mai 2024) |
| **Inhalt** | 296'293 Eheeinträge aus den Kirchenbüchern von 157 Kirchgemeinden, 1524–1800: Trauungen und Verkündungen mit Bräutigam, Braut, Herkunft, Datum, Kirchgemeinde und Signatur |
| **Hier durchsuchbar** | im Reiter «Ehedaten» der Suche, über `/api/v1/ehedaten` und das MCP-Werkzeug `ehedaten_search` für eigene KI-Assistenten |
| **Eigene Seiten** | jeder Eintrag unter `/archivkatalog/<ID>` (ID wie im Online-Archivkatalog), mit Ehe-Karte |
| **Dieselbe Ehe in zwei Kirchenbüchern** | geprüfte Liste der Mehrfacheinträge des Staatsarchivs (Repository [stazh/sw-ehedaten](https://github.com/stazh/sw-ehedaten), Stand 17. Februar 2022): 5'358 Ehen mit je zwei Einträgen |
| **Lizenz** | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de) – bei Weitergabe nennen: «Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert» |

Die Ehedatenbank verzeichnet in standardisierter Kurzform die Eheeinträge aus den überlieferten Kirchenbüchern der Zürcher Kirchgemeinden seit der Reformation. Aufgebaut hat sie der Genealoge Hans Schulthess; 1995 hat das Staatsarchiv sie angekauft, Hans Ulrich Pfister hat die Einträge 2008–2018 geprüft und ergänzt, publiziert wurde sie 2015 und 2019. Der Schwerpunkt liegt im 18. Jahrhundert. Gut zwei Drittel der Einträge stammen aus den Pfarrbüchern im Staatsarchiv (Signatur E III), die übrigen aus Büchern anderer Archive, etwa der Stadtarchive Zürich und Winterthur oder von Kirchgemeinden (Signatur TAI, mit der Signatur des Originals nach dem Semikolon).

Jeder Eintrag ist zugleich eine Verzeichnungseinheit des [Online-Archivkatalogs](/about/archivkatalog) (Signatur «…, EDB n»), und von dort übernimmt die Plattform die Einträge. Gegenüber dem Datensatz auf Zenodo enthält der Katalog neuere Korrekturen und 87 zusätzliche Einträge. Namen, Herkunft und Zusatzinfos liest die Plattform aus Titel und «Inhalt und Form».

## Suchen im Reiter «Ehedaten»

Die Felder folgen der Ehedaten-Suche des Staatsarchivs auf Archives Quickaccess:

- **Name** mit **Rolle**: «Bräutigam oder Braut», «Bräutigam» oder «Braut». Alle Wörter müssen im Namen der Person stehen, die Reihenfolge ist egal: «Heusser» trifft jeden Heusser. Schreibvarianten zählen mit (Meier und Meyer). Mehrere Namen derselben Rolle gelten als oder; Bräutigam und Braut zusammen finden ein Paar.
- **Herkunft** von Bräutigam oder Braut: Gemeinde, Kanton oder Land. Weiler mit ihrer Gemeinde in Klammern zählen zu dieser («Irgenhausen (Pfäffikon)» bei «Pfäffikon»), Weiler ohne Klammer nur unter ihrem eigenen Namen. Eine Herkunft mit Kantonskürzel oder Land («Wald TG») gilt genau so, nicht für den gleichnamigen Zürcher Ort.
- **Kirchgemeinde**: **«Stadt Zürich»** fasst die Stadtkirchen zusammen: Grossmünster, Fraumünster, St. Peter, Predigern, Spitalpfarramt und Einträge, die nur «Zürich» nennen. Die Kirchgemeinden vor den Mauern (Wipkingen, Altstetten, Höngg …) zählen nicht dazu.
- **Jahr** von–bis (1524–1800), auch über die Zeitleiste.
- **Herkunftsraum**: Kanton Zürich, andere Kantone oder Ausland, mindestens eine der beiden Personen. Massgebend sind Kantonskürzel bzw. Land («Büsingen (Deutschland)»); ohne solche Angabe gilt eine Herkunft als Kanton Zürich, ausser bei wenigen eindeutigen Namen wie Bern.
- **Art des Eintrags**: Trauung oder Verkündung (siehe unten).
- **Überlieferung**: Pfarrbücher im Staatsarchiv (E III) oder Bücher anderer Archive (TAI).
- **Band (Signatur)**: ein Kirchenbuch, etwa «E III 117.1».

Der **Suchbegriff** durchsucht Namen, Herkunft, Zusatzinfo, Kirchgemeinde und Signatur; alle Wörter müssen vorkommen, mit Tippfehler-Toleranz und Wortanfang beim letzten Wort. «ß» gilt als «ss» («Wyss» findet auch «Wyß»); die Treffer zeigen die Schreibung der Vorlage. So lassen sich auch Berufe und Bemerkungen finden («Schuhmacher»). «Nur im Titel» beschränkt ihn auf Namen und Herkunft. Ein Thema gibt es hier nicht.

Die Trefferliste ist ohne Suchbegriff chronologisch. Durchblättern lassen sich die ersten 10'000 Einträge; zu den übrigen führen engere Filter.

**Mit den anderen Reitern geteilt** sind Suchbegriff, ODER-Begriffe, Zeitraum, «nur im Titel», Personen und Orte: Ein Name ohne Rolle ist eine Person, die Herkunft ein Ort im Sinn der anderen Reiter (siehe [Suchhilfe](/about/suchhilfe#personen-orte-und-organisationen)).

## Was in einem Eintrag steht

- **Namen** sind von der Ehedatenbank vereinheitlicht («Meier» auch für Meyer); die Schreibung der Vorlage steht in der **Zusatzinfo**, zusammen mit Beruf, Herkunftsangaben und Bemerkungen («verkündet 22. Febr.; getraut zu Zürich»). «N.» steht für einen unbekannten Namen, «?» für eine unsichere Lesung.
- **Datum**: Bis 1700 datierte Zürich nach dem julianischen Kalender (alter Stil), ab 1701 gregorianisch. Die Daten stehen wie in den Kirchenbüchern und werden nicht umgerechnet; bis 1700 tragen sie den Zusatz **«(a. St.)»**. Manche Einträge sind nur auf Monat oder Jahr datiert, ungefähr («ca.») oder auf eine Spanne.
- **Trauung oder Verkündung**: Vermerkt ein Eintrag «Verkünddatum», ist sein Datum das der Verkündung (rund 6 % der Einträge); getraut wurde das Paar dann oft in einer anderen Kirchgemeinde. Sonst gilt das Datum als Datum der Trauung.
- **Kirchgemeinde** ist die des Kirchenbuchs, in dem der Eintrag steht. Wo getraut wurde, sagt oft erst die Zusatzinfo («getraut zu Zürich bei Sankt Peter»).
- **Herkunft** steht, wie die Vorlage sie nennt; für Filter und Herkunftsraum wird sie auf die Gemeinde gebracht (siehe oben). Rund ein Viertel der Einträge nennt keine Herkunft.
- Bei bekannten Personen verweisen Einträge auf das Historische Lexikon der Schweiz (HLS) und die Gemeinsame Normdatei (GND).

## Die Ehe-Karte

Jeder Eintrag führt auf seine Seite (`/archivkatalog/<ID>`) mit der **Ehe-Karte**: Art und Datum, Kirchgemeinde, Bräutigam und Braut mit Herkunft und Zusatzinfo, Signatur, dazu Suchen im Reiter («Alle Einträge dieses Paars», «Familie …»).

Viele Ehen stehen in zwei Kirchenbüchern: verkündet oder eingetragen in der einen Kirchgemeinde, getraut in der anderen. **Weitere Einträge zu dieser Ehe** nennt die Karte, wenn die von Hand korrigierte **Liste der Mehrfacheinträge** des Staatsarchivs (Projekt «Wissensnetz der Zürcher Ehedaten») den Eintrag führt; 14 Ehen führt sie nur als wahrscheinlich, das sagt dann auch die Karte.

Übernommen hat die Plattform aus der Liste nur, welche Einträge zusammengehören, und 45 der 5'403 Paare nicht: Es sind zwei Ehen, meist zwei Brüder, die am selben Tag zwei Schwestern heirateten.

Die Liste erfasst nur einen Teil der Doppeleinträge. **Weitere Einträge zu diesem Paar** bzw. **Weitere Einträge mit denselben Namen** nennt die Karte darum zusätzlich: gleiche Namen, höchstens ein Jahr auseinander. Meist ist auch das dieselbe Ehe, geprüft ist es nicht.

Im Reiter «Archivkatalog» erscheinen die Eheeinträge ebenfalls, gekennzeichnet als «Eheeintrag» und mit einem Link, der dieselbe Suche im Reiter «Ehedaten» öffnet.

## Zahlen richtig lesen

- **Einträge, nicht Ehen:** Dieselbe Ehe steht oft zweimal. Auch wer nur Trauungen zählt, hat Doppelungen, denn oft vermerken beide Kirchenbücher das Datum der Trauung. Die Liste kennt 5'358 Ehen mit zwei Einträgen; Paare mit denselben Namen, höchstens ein Jahr auseinander, gibt es rund 32'000. Auf eine Zahl von Ehen lässt sich das nicht genau umrechnen.
- **Namensvettern:** Gleiche Namen bedeuten nicht dieselbe Person. Einträge, die Jahrzehnte auseinanderliegen, betreffen meist verschiedene Personen, oft Vater, Sohn und Enkel.
- **Überlieferung:** Die Kirchenbücher setzen je nach Kirchgemeinde verschieden früh ein; die Zeitleiste zeigt, was überliefert und erfasst ist, nicht, wie viele Ehen geschlossen wurden.

## Mit einem KI-Assistenten

Ein eigener KI-Assistent ([Eigene KI anbinden](/about/ai)) durchsucht die Ehedaten über das MCP-Werkzeug `ehedaten_search`, auf Wunsch mit Zählungen je Kirchgemeinde, Jahr oder Jahrzehnt. Das Ergebnis weist auf Namensvettern hin und nennt weitere Einträge derselben Ehe (`sameMarriage`).

## Schnittstellen

- **REST:** [`/api/v1/ehedaten`](/about/api#ehedaten) mit denselben Feldern wie der Reiter und `/api/v1/ehedaten/{id}` für einen Eintrag.
- **MCP:** das Werkzeug `ehedaten_search`, siehe [API](/about/api#mcp).

## Zitieren und Lizenz

Die Ehedatenbank steht unter **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de)**, anders als die amtlichen Quellen der Plattform (Public Domain Mark). Bei Weitergabe ist die Quelle zu nennen: «Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert». Die Liste der Mehrfacheinträge hat keine eigene Lizenzdatei; opendata.swiss führt ihr Repository als Teil des offenen Datensatzes «Zürcher Ehedaten des 16. bis 18. Jahrhunderts» mit den Bedingungen «Freie Nutzung. Quellenangabe ist Pflicht.» Quelle: «Staatsarchiv des Kantons Zürich, Wissensnetz der Zürcher Ehedaten, Liste der Mehrfacheinträge». Jede Seite bietet einen Zitiervorschlag mit Signatur, Paar, Datum, Lizenz und Permalink des Online-Katalogs, etwa:

`StAZH E III 44.2, EDB 1895, Hans Jakob Heusser und Barbara Suter, Verkündung 30.11.1686 (a. St.); Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert (CC BY 4.0); https://archivkatalog.ji.zh.ch/detail.aspx?ID=1999619`

Die Einträge betreffen Personen, die vor über 200 Jahren lebten. Wie alle Seiten des Archivkatalogs sind die Seiten der Einträge für Suchmaschinen gesperrt.
