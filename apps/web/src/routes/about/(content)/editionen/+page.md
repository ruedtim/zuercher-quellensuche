<script lang="ts">
	import { SITE_NAME } from "$lib/site";
</script>

<svelte:head><title>Editionen | {SITE_NAME}</title></svelte:head>

<a href="/about" class="text-sm text-accent-600">← Zurück zur Übersicht</a>

# Editionen

| | |
|---|---|
| **Inhalt** | Edierte Quellenstücke mit Anmerkungen, Kommentar, Registern und Faksimiles: die **Quellen zur Zürcher Geschichte (QZH)** des Staatsarchivs des Kantons Zürich und die **Zürcher Rechtsquellen** (SSRQ ZH) der Sammlung Schweizerischer Rechtsquellen |
| **Umfang** | QZH: 790 Stücke von 1275 bis 1795, davon 705 Täuferquellen, 354 mit Faksimile. Rechtsquellen: 897 Stücke aus fünf Bänden, 1180 bis 1800, 490 mit Faksimile |
| **Hier durchsuchbar** | im Reiter «Editionen» der Suche, über die [API](/about/api#editionen) und den MCP-Server für eigene KI-Assistenten |
| **Eigene Seiten** | jedes Stück unter `/editionen/<Edition>/<Kennung>`, etwa [/editionen/qzh/QZH_401](/editionen/qzh/QZH_401) oder [/editionen/ssrq/SSRQ_ZH_NF_II_3_047](/editionen/ssrq/SSRQ_ZH_NF_II_3_047) |
| **Lizenz** | je Edition; QZH: Editionsdaten [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de), Abbildungen [gemeinfrei](https://creativecommons.org/publicdomain/mark/1.0/deed.de); Rechtsquellen: Editionsdaten [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de) |

Die Editionen sind wissenschaftlich bearbeitete Abschriften: zeichengetreu übertragen, mit aufgelösten Abkürzungen, ausgezeichneten Personen und Orten, Anmerkungen und oft einem Kommentar. Anders als die maschinelle Transkription der Ratsmanuale ist der Text geprüft.

## Quellen zur Zürcher Geschichte (QZH)

Die Plattform [Quellen zur Zürcher Geschichte](https://qzh.sources-online.org) ist der Publikationskanal des Staatsarchivs für Transkriptionen ausgewählter Quellenstücke. Diese Website übernimmt die veröffentlichten TEI-Daten (GitHub [stazh/qzh-data](https://github.com/stazh/qzh-data), Branch `main`). Die Filterspalte gliedert sie unter **«Teil der Edition»**:

- **Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5:** Kanton Zürich 1530–1609, bearbeitet von Christian Scheidegger unter Mitarbeit von Daniela Dettwiler, herausgegeben von Tobias Jammerthal (QGTS, Bd. 5; 702 Stücke, dazu je eines aus Bd. 3 und ohne Bandangabe). Der sechste Band (1608–1638, rund 640 Stücke) ist in Vorbereitung und kommt nach seiner Veröffentlichung dazu.
- **Quellen zur Zürcher Geschichte:** eigene Transkriptionen des Staatsarchivs (47 Stücke).
- **Gelebte Reformation. Zürich 1500–1800:** herausgegeben von Francisca Loetz unter Mitarbeit von Wolfram Schneider-Lastin, Transkriptionen von Andrea Schmid-Kunz (26 Stücke).
- **Territorienbildung der Städte im Spätmittelalter:** Masterseminar am Historischen Seminar der Universität Zürich (12 Stücke).

Fast alle Stücke tragen die Signatur ihrer Vorlage mit Link in den [Archivkatalog](/about/archivkatalog); umgekehrt nennen Katalogseiten und Ratsmanual-Sitzungen die edierten Stücke. 151 QZH-Stücke sind Einträge aus Ratsmanualen: Dort steht die maschinelle Transkription mit Faksimile, hier der edierte Text.

## Zürcher Rechtsquellen (SSRQ ZH)

Die [Zürcher Rechtsquellen](https://rechtsquellen.sources-online.org) sind die Zürcher Bände der Sammlung Schweizerischer Rechtsquellen, herausgegeben von der Rechtsquellenstiftung des Schweizerischen Juristenvereins, digital publiziert mit dem Staatsarchiv. Diese Website übernimmt die TEI-Daten aus der Kopie des Staatsarchivs (GitHub [stazh/erqzh-data](https://github.com/stazh/erqzh-data), Stand 2024). Die fünf Bände bietet die Filterspalte unter **«Teil der Edition, Band»** an:

- **SSRQ ZH NF I/1/3:** Stadt und Territorialstaat Zürich II (1460 bis Reformation), 195 Stücke.
- **SSRQ ZH NF I/1/11:** Gedruckte Mandate für Stadt und/oder Landschaft Zürich, 1525–1798, 104 Stücke.
- **SSRQ ZH NF I/2/1:** Die Rechtsquellen der Stadt Winterthur I, 1180–1550, 300 Stücke.
- **SSRQ ZH NF II/3:** Die Landvogtei Greifensee, 116 Stücke.
- **SSRQ ZH NF II/11:** Die Obervogteien um die Stadt Zürich, 182 Stücke.

Es sind Satzungen und Ordnungen, Offnungen, Urkunden, Verträge, Urteile, Eide und gedruckte Mandate, jedes Stück mit Regest und meist mit Kommentar. Die Nummern zählen je Band: zitiert wird «SSRQ ZH NF II/3 Nr. 47». Ist ein Stück mehrfach überliefert, ediert die Edition den Text aus einer Vorlage und beschreibt die übrigen als **weitere Überlieferungen** ohne eigenen Text (635). Ist die Vorlage eine Abschrift, gilt wie in der Edition das Datum des Rechtsakts. Stammt eine Vorlage aus einem anderen Archiv, nennt das Faksimile dieses Archiv.

Personen, Orte und Organisationen heissen wie im Register der Edition. Bei gleichnamigen Personen steht die Datierung dahinter («Hans Pfister (1508)»), bei Organisationen mit einem Orts- oder Familiennamen die Art («Zürich (Bürgermeister und Rat)»). Die Rechtsquellen verknüpfen ihre Register nicht mit der GND.

## Suchen im Reiter «Editionen»

- **Suchbegriff:** durchsucht Titel, Regest, Schlagwörter, Quellentext, Kommentar und Anmerkungen. Die Zeichen des frühneuhochdeutschen Quellentexts sind angeglichen: «daß» findet auch «dass», «zů» auch «zu», «Gruͤningen» auch «Grüningen». Abkürzungen findet die Suche in der aufgelösten Form, Gestrichenes nicht. Moderne Wörter treffen den Quellentext nur, wo er sie schon so schreibt – Titel, Regest und Kommentar sind modernes Deutsch.
- **Thema:** reiht die Stücke nach Titel, Schlagwörtern, Regest und Kommentar, nicht nach dem Quellentext. Bei Stücken ohne Regest und Kommentar trägt nur der Titel.
- **Edition**, **Teil der Edition, Band**, **Schlagwort** (die Taxonomie der Rechtsquellenstiftung, wie sie beide Editionen vergeben) und **«nur mit Faksimile»** stehen in der Filterspalte; mehrere Werte eines Filters gelten als oder.
- **Personen, Orte und Organisationen** filtern nach den Namen im Register der Edition, über die Schreibung hinweg (Meier und Meyer); auch Einzelnamen ohne Vornamen wirken. Personen mit einem Zusatz in Klammern («Ulrich Zwingli (1556–1601)») gelten nur genau so. In den QZH heissen Personen mit GND-Verknüpfung wie in der Gemeinsamen Normdatei, Orte, wo das Register sie kennt, in heutiger Schreibung («Kyburg» findet auch «Kyburch»).
- **Automatisch erkannte Namen:** In wenigen Stücken, in denen die Edition keine Namen auszeichnet, stehen Namen aus der automatischen Namenserkennung der Ratsmanuale; die Seite des Stücks sagt dann «automatisch erkannt».
- **Zeitraum** und Zeitleiste: Ein Stück zählt in jedem Jahr, das sein Datum berührt.

Ohne Suchbegriff und Thema ist die Liste chronologisch. Was alle Reiter teilen, steht in der [Suchhilfe](/about/suchhilfe#der-reiter-alle-quellen).

## Register

Das [Register der Editionen](/editionen/register) verzeichnet die **Personen, Orte und Organisationen** aller Stücke, je mit der Zahl der Stücke, ihrem Zeitraum und den Schreibungen in den Texten («Ulrich Zwingli», auch «Huldrych Zwingli»); Personen mit Link zur Gemeinsamen Normdatei (GND), Orte mit Karte. Ein Klick auf einen Namen zeigt seine Stücke. Als Schreibung gilt nur eine Form, die dem Namen ähnelt.

## Mit einem KI-Assistenten

Ein eigener KI-Assistent ([Eigene KI anbinden](/about/ai)) durchsucht die Editionen über das MCP-Werkzeug `edition_search`: wörtlich im Quellentext (mit alten Schreibungen wie «töuffer») und in Titel, Regest und Kommentar, bei Sachthemen auch nach Bedeutung; mit `id` liest er ein Stück ganz. Was aus Kommentar und Anmerkungen stammt, ist die Arbeit der Bearbeitung, nicht die Quelle.

## Die Seite eines Stücks

- **Kopf:** Edition, Zitierform, Datum («a. St.», wo die Edition den alten Stil angibt), Teil, Titel, Vorlage mit Signatur, weitere Überlieferungen, Bearbeitung, gedruckte Ausgabe (etwa «QGTS, Bd. 5, Nr. 287»), Links auf die Edition und die TEI-Daten und ein Zitiervorschlag.
- **Regest** und **Text:** zeichengetreu, wie ediert. Abgekürzte Wörter sind gepunktet unterstrichen, die Auflösung steht im Tooltip; Gestrichenes erscheint durchgestrichen, Ergänzungen der Vorlage grün, Ergänzungen der Bearbeitung in eckigen Klammern. Seitenzahlen der Vorlage stehen in eckigen Klammern; ein Klick blättert das Faksimile dorthin. Die Artikelnummern der Rechtsquellen stehen grau in eckigen Klammern, ein Spaltenwechsel als ‖. «Zeilenfall der Vorlage» zeigt die Zeilenwechsel als senkrechte Striche. Münzzeichen erscheinen lesbar («ß» für Schilling, «lb» für Pfund, «fl» für Gulden).
- **Anmerkungen:** textkritische mit Buchstaben, Sachanmerkungen mit Zahlen; die Marke im Text springt zur Anmerkung und zurück.
- **Kommentar** der Bearbeitung, **Personen**, **Orte** und **Organisationen** mit den Namen des Registers, die Schreibung im Text in Klammern; ein Klick auf einen Namen sucht ihn im Reiter «Editionen». Dazu die **Schlagwörter** (bei den Rechtsquellen mit dem Glossar der Edition als Tooltip) und die **Stückbeschreibung** (Überlieferung, Beschreibstoff, Siegel, Sprache).
- **Faksimile:** vom Bildserver der Edition, bei einigen Stücken aus e-manuscripta.ch (Zentralbibliothek Zürich, Nachweis beim Bild); das IIIF-Manifest (Link «IIIF») baut diese Website.

**Datum:** wie in der Edition das Datum der Quelle, nicht umgerechnet. In Zürich galt bis Ende 1700 der alte Stil (julianischer Kalender); Stücke aus Orten, die früher umgestellt haben, datieren nach dem neuen.

**Darstellung:** Inhalt und Auszeichnung sind die der Edition, Gestaltung und Fehler der Darstellung die dieser Website. Massgeblich ist das Stück auf der Plattform der Edition.

Die Seiten der Stücke sind für Suchmaschinen gesperrt.

## Zitieren und Lizenz

Die Editionsdaten der QZH stehen unter der Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de), die Abbildungen sind gemeinfrei (Angabe der Edition). Bei Weitergabe zu nennen: «Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH)», mit der Kennung des Stücks. Die Editionsdaten der Rechtsquellen stehen ebenfalls unter [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de); zu nennen: «Sammlung Schweizerischer Rechtsquellen (Rechtsquellenstiftung des Schweizerischen Juristenvereins), Zürcher Rechtsquellen online, Staatsarchiv des Kantons Zürich», mit der Zitierform des Stücks. Der Zitiervorschlag auf jeder Seite nennt Titel, Datum, Signatur, Edition, Kennung, Bearbeitung, den Link auf das Stück in der Edition und die Seite auf %SITE_HOST%. Anders als die amtlichen Texte der Zentralen Serien (Public Domain Mark) sind die Editionen Werke ihrer Bearbeitenden.

## Schnittstellen

`/api/v1/editions` durchsucht die Stücke mit denselben Filtern wie der Reiter, `/api/v1/editions/{edition}/{id}` liefert ein Stück ganz ([API-Dokumentation](/about/api#editionen)). Der MCP-Server bietet dasselbe als Werkzeug `edition_search`.

## Weitere Editionen

In denselben Reiter sollen, je mit eigener Lizenz: die Stillstandsprotokolle des 17. Jahrhunderts, die Briefedition Alfred Escher und der Bullinger-Briefwechsel. Für die Kirchenbücher, die es nur als Bilder gibt, ist ein Weg vom Eheeintrag zum Digitalisat des Bandes geplant.
