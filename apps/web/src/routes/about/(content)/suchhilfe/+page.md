<script lang="ts">
	import { SITE_NAME } from "$lib/site";
</script>

<svelte:head><title>Suchhilfe | {SITE_NAME}</title></svelte:head>

<a href="/about" class="text-sm text-accent-600">← Zurück zur Übersicht</a>

# Suchhilfe

Die Recherche durchsucht rund 700'000 Dokumente von 1484 bis heute – von maschinell transkribierten Ratsmanualen über OCR-erfasste Drucke bis zu born-digital Beständen. Was für die Ratsmanuale anders ist, steht im Abschnitt [Ratsmanuale](#ratsmanuale).

## Die Werkzeuge im Überblick

| Werkzeug | Funktionsweise | Geeignet für |
|---|---|---|
| **Frage** (Feld der Startseite) | Sucht nach Bedeutung in allen Quellen: die Frage wird zum Thema im Reiter «Alle Quellen», ein Zeitraum in der Frage zum Filter, Wörter in Anführungszeichen zum Suchbegriff | Einstieg mit einer Frage in eigenen Worten |
| **Suchbegriff** (Filterspalte) | Lexikalische Suche: exakte Wortübereinstimmung mit Tippfehler-Toleranz | Namen, Begriffe, Aktenzeichen, Zitate |
| **Thema** (unter «Erweiterte Suchoptionen») | Semantisches Ranking: ordnet die Treffer nach thematischer Ähnlichkeit (Vektor-Ähnlichkeit) – findet auch Synonyme und Verwandtes | Themen, Konzepte, unscharfe Fragestellungen |
| **Alle Quellen** (erster Reiter, öffnet mit der Recherche) | Zeigt je Quelle die Trefferzahl und die ersten Treffer, die Reiter führen in die ganze Liste | Erster Überblick, wo es zu einem Namen oder Begriff etwas gibt |
| **Archivkatalog** (Reiter über der Trefferliste) | Durchsucht die Verzeichnungseinheiten des Staatsarchivs (Akten, Urkunden, Pläne, Nachlässe …) statt der Volltexte | Weiterführende Archivalien zu Personen, Orten, Ereignissen |
| **Ehedaten** (Reiter über der Trefferliste) | Durchsucht die Eheeinträge der Zürcher Kirchenbücher 1524–1800 nach Namen mit Rolle, Herkunft, Kirchgemeinde und Jahr | Wer wann wen wo heiratete, Familien vor 1800 |
| **Editionen** (Reiter über der Trefferliste) | Durchsucht edierte Quellenstücke mit Anmerkungen und Kommentar – die Quellen zur Zürcher Geschichte (QZH, 1275–1795, vor allem Täuferquellen) und die Zürcher Rechtsquellen (SSRQ ZH, 1180–1800: Satzungen, Offnungen, Urkunden, Mandate) | Geprüfte Texte zu Ereignissen und Personen vor 1800, mit Erklärungen der Bearbeitung |
| **Register** (Menüpunkt «Register») | Verzeichnet die Personen, Orte und Organisationen jeder Quelle – Archivkatalog, Rats- und Regierungsmitglieder, Editionen, Ehedaten –, mit einer Namenssuche über alle | Nachschlagen, wo ein Name vorkommt und wie er geschrieben wird |

In der Filterspalte ist zunächst nur das Suchbegriff-Feld zu sehen; alle weiteren Filter liegen unter **«▶ Erweiterte Suchoptionen»**. Der Bereich klappt von selbst auf, sobald dort etwas gesetzt ist. Nur der Zeitraum lässt ihn zu und erscheint darunter als «Zeitraum 1600 – 1700 ×»; ein Klick darauf hebt ihn auf. «Filter zurücksetzen» leert alle Filter.

Suchbegriff und Thema sind **kombinierbar**: Der **Suchbegriff bildet die Treffermenge**, das **Thema reiht sie** nach Ähnlichkeit. Ohne Suchbegriff ordnet das Thema die ganze (gefilterte) Menge. Durchblättern lassen sich dabei die ersten 1'000, zuerst die dem Thema nächsten; die Trefferzahl nennt die volle Menge.

**Thema und Datums-Sortierung:** Wird nach Datum sortiert, wählt das Thema zuerst die ähnlichsten Dokumente aus – mit Suchbegriff innerhalb von dessen Treffern –, und diese erscheinen dann chronologisch. Wie viele es sind, bestimmt der **«Themen-Umfang»** (25 bis 1000; Standard 100).

### Eine Frage stellen

Das Feld der Startseite nimmt eine Frage in eigenen Worten auf («Welche Massnahmen ergriff der Regierungsrat gegen die Tollwut?»). «Suchen» öffnet den Reiter «Alle Quellen» mit der Frage als **Thema**: Archivkatalog, Zentrale Serien und Editionen werden nach Bedeutung gereiht; die Ehedaten kennen kein Thema. Nennt die Frage einen Zeitraum («im 19. Jahrhundert», «seit 2008», «um 1900»), wird er zum Zeitraum-Filter, sichtbar und entfernbar in der Filterspalte; ein blosses Jahr («Grippe 1918») bleibt Teil des Themas. Der Auszug zeigt die Stelle, an der die meisten Wörter der Frage beisammen stehen.

Die Suche nach Bedeutung achtet kaum auf einzelne Wörter: «Pause» findet Urlaub und Ausstand eher als das Wort. Was in **Anführungszeichen** steht, wird darum wörtlich gesucht und wird zum [Suchbegriff](#phrasensuche) – auch “…”, „…“ oder «…», wie das Handy sie setzt. Steht daneben mehr als der Rahmen einer Frage, reiht die ganze Frage die Treffer nach Bedeutung: `Wann wurde "Susanna Ziegler" eingebürgert?` zeigt die Dokumente mit ihrem Namen, zuoberst den Beschluss von 1820, der ihr das «Landrecht» (das Kantonsbürgerrecht) erteilte; `"Pause"` oder `Was steht über "Escher vom Glas"?` ist eine reine Stichwortsuche. Ein Zeitraum zählt nur ausserhalb der Anführungszeichen. Das «?» neben dem Kästchen erklärt das kurz. Das Kästchen **«wörtlich»** sucht den ganzen Text als eine Wortfolge – für Namen und feste Wendungen; eine ganze Frage kommt so kaum je wörtlich vor. Die Beispiele darunter, zu jeder Quelle eines, führen in den Reiter der Quelle; bei Ratsmanualen und Ehedaten, die eine Frage nicht nach Bedeutung erreicht, mit einer Stichwort- bzw. Namenssuche.

Ausformulierte Antworten mit Quellenangaben liefert ein eigener KI-Assistent – Anleitung auf der Seite **[Eigene KI anbinden](/about/ai)**.

### Der Reiter «Alle Quellen»

Mit dem Reiter **«Alle Quellen»** öffnet die Recherche: Er zeigt je Quelle die Trefferzahl und die ersten fünf Treffer; «Alle N im Reiter» führt in die ganze Trefferliste. Suchbegriff, ODER-Begriffe, Thema, Zeitraum, «nur im Titel» sowie Personen, Orte und Organisationen gelten über die Reiter hinweg und bleiben beim Wechsel stehen, ebenso die eigenen Filter eines Reiters; was im aktuellen Reiter nicht wirkt, steht als «Gesetzt, wirkt hier nicht» mit «entfernen». Wirkt ein gemeinsames Feld in einem anderen Reiter nicht – etwa ein Name ohne Vornamen im Archivkatalog, eine Organisation in den Ehedaten –, steht dort «–» statt einer Zahl, der Tooltip nennt den Grund.

### Der Reiter «Archivkatalog»

Der Reiter **«Archivkatalog»** durchsucht die Verzeichnungseinheiten des Online-Archivkatalogs; ohne Suchbegriff und Filter zeigt er den Archivbaum. Alle Wörter müssen vorkommen, das Thema reiht wie bei den Dokumenten. Eigene Filter sind Stufe, «nur mit Digitalisat» und die **Feldsuche** (Signatur, Titel, Inhalt und Form, Provenienz, Bestand). Jeder Treffer führt auf seine eigene Seite mit Archivplan-Pfad, Untereinheiten, Digitalisat-Links und Zitiervorschlag.

→ Ausführlich auf der eigenen Seite **[Archivkatalog](/about/archivkatalog)**.

### Der Reiter «Ehedaten»

Der Reiter **«Ehedaten»** durchsucht rund 296'000 Trauungen und Verkündungen aus den Kirchenbüchern von 157 Kirchgemeinden, 1524–1800, mit eigenen Feldern: **Name** mit **Rolle** (Bräutigam, Braut), **Herkunft**, **Kirchgemeinde**, **Jahr**, **Herkunftsraum**, **Art** (Trauung oder Verkündung), **Überlieferung** und **Band**. Schreibvarianten zählen mit (Meier und Meyer), ein Nachname allein trifft alle Träger; ein Thema gibt es hier nicht. Bis 1700 stehen die Daten im alten Stil (**«(a. St.)»**). Die Ehedaten stehen unter CC BY 4.0.

→ Ausführlich auf der eigenen Seite **[Ehedaten](/about/ehedaten)**.

### Der Reiter «Editionen»

Der Reiter **«Editionen»** durchsucht edierte Quellenstücke: 790 Stücke der **Quellen zur Zürcher Geschichte (QZH)**, 1275 bis 1795, und 897 der **Zürcher Rechtsquellen** (SSRQ ZH), 1180 bis 1800. Der Quellentext ist frühneuhochdeutsch, nur die Zeichen sind angeglichen («zů» auch «zu»); moderne Wörter treffen ihn nur, wo er sie schon so schreibt. Titel, Regest und Kommentar sind modernes Deutsch, und nur nach ihnen und den Schlagwörtern reiht das **Thema**. Eigene Filter: **Edition**, **Teil der Edition, Band**, **Schlagwort** und **«nur mit Faksimile»**. Die Editionsdaten stehen unter CC BY 4.0.

→ Ausführlich auf der eigenen Seite **[Editionen](/about/editionen)**.

### Die Register

Der Menüpunkt **[«Register»](/register)** führt zu den Registern aller Quellen. Sie sind bis auf wenige Personen mit gemeinsamer GND (Kleiner Rat und Editionen) nicht miteinander verknüpft – derselbe Name in zwei Registern muss nicht dieselbe Person meinen:

- **Archivkatalog:** Personen, Orte und Organisationen der Verzeichnungseinheiten, automatisch erkannt; gleich geschriebene Namen bilden einen Eintrag ([Register des Archivkatalogs](/archivkatalog/register), siehe [Archivkatalog](/about/archivkatalog#register)).
- **Zentrale Serien:** die Mitglieder des Kantonsrats und des Regierungsrats seit 1803 aus der Kantonsratsdatenbank, je mit eigener Personenseite ([Rats- und Regierungsmitglieder](/personen), siehe «Im Dokument»), und die Mitglieder des [Kleinen Rats 1225–1798](/rat) mit den Ratsmanualen ihrer Amtszeit (siehe [Ratsmanuale](/about/rm#wer-im-rat-sass)).
- **Ehedaten:** Die Ehedatenbank nennt Bräutigam und Braut jedes Eintrags mit Herkunft; gesucht wird im Reiter «Ehedaten».
- **Editionen:** die Namen aus den Registern der Editionen mit der Zahl der Stücke, ihrem Zeitraum, den Schreibungen in den Texten und der GND ([Register der Editionen](/editionen/register), siehe [Editionen](/about/editionen#register)).

Die **Namenssuche** der Übersicht fragt alle Register zugleich; jeder Eintrag führt in den Reiter seiner Quelle, gefiltert auf den Namen. Namen, die kein Register verzeichnet, findet die Volltextsuche.

Alles Folgende beschreibt die **lexikalische Suche** im Feld «Suchbegriff». Dieselbe Logik gilt für die Tippsuche in den Facetten **Personen, Orte und Organisationen** (siehe unten).

## Einfache und erweiterte Suche

**Einfach** (Standard): Ins Feld «Suchbegriff» getippte Wörter werden mit «OK» oder der Eingabetaste übernommen. Drei Kästchen verändern, wie ein Begriff übernommen wird:

- **«exakt»** sucht die Eingabe als zusammenhängende Wortfolge (siehe Phrasensuche),
- **«ausschliessen»** blendet Dokumente mit dem Begriff aus (siehe Wörter ausschliessen),
- **«nur im Titel»** beschränkt die Suche auf die Dokumenttitel (siehe Nur im Titel suchen).

«exakt» und «ausschliessen» springen nach dem Übernehmen zurück; «nur im Titel» bleibt aktiv, bis es wieder abgewählt wird. Jeder übernommene Begriff erscheint als eigener Chip und lässt sich einzeln entfernen.

**Erweitert:** Unter «▶ Erweiterte Suchoptionen» tritt an die Stelle des einfachen Felds ein Satz aus drei Feldern, jedes mit eigenem Kästchen «exakt»:

| Feld | Wirkung |
|---|---|
| **Alle diese Wörter** (müssen vorkommen) | Pflichtwörter – alle müssen im Dokument stehen (UND) |
| **Irgendeines dieser Wörter** (ODER) | mindestens einer der Begriffe muss vorkommen (Vereinigung) |
| **Ohne diese Wörter** (dürfen nicht vorkommen) | Dokumente mit einem dieser Wörter fallen weg |

Die Felder wirken zusammen: *See* und *Teich* unter «Irgendeines dieser Wörter» und *Fischerei* unter «Alle diese Wörter» findet (See ODER Teich) UND Fischerei. «nur im Titel suchen» gilt für alle drei Felder.

## Ganze Wörter und Wortanfänge – warum «Terrier» den «Foxterrier» nicht findet

Die Suche vergleicht ganze Wörter, nicht beliebige Zeichenfolgen *innerhalb* von Wörtern.

- **Wortanfänge werden ergänzt**, aber nur beim **letzten Wort** der Eingabe: `terrier` findet auch *Terrierrassen*. Ergänzt werden höchstens die ersten 1'000 Wörter mit diesem Anfang in alphabetischer Folge, in den Zentralen Serien dazu gebeugte Formen («Gemeinde» findet auch *Gemeinden*, an jeder Stelle der Eingabe). Spätere Zusammensetzungen können fehlen; sie gehören ins Feld «Irgendeines dieser Wörter» (*Gemeinde OR Gemeindeschreiber*).
- **Wortenden und Wortmitten werden nicht durchsucht**: `terrier` findet *Foxterrier* **nicht**, denn dort steht «terrier» am Wortende.
- **Wildcards gibt es nicht**: `*terrier` liefert dieselben Treffer wie `terrier`.
- **Deutsche Komposita werden nicht zerlegt**: *Hundesteuer* ist ein eigenes, unteilbares Wort.

**Tipp:** Für zusammengesetzte Wörter und ganze Begriffsfelder ist das **Thema** die bessere Wahl – es findet den *Foxterrier* auch bei «Hunderassen».

## Tippfehler-Toleranz

Ab einer Wortlänge von **7 Zeichen** ist **1 Tippfehler** erlaubt, ab **9 Zeichen** sind es **2** (fehlende, überzählige, falsche oder vertauschte Buchstaben; ein falscher erster Buchstabe zählt doppelt). `foxterier` findet deshalb den *Foxterrier*. Bei Wörtern bis **6 Zeichen** muss die Schreibung stimmen. Unabhängig von der Länge erkennt die Suche ein Wort auch **zerlegt** – «Regierungsrat» findet die Trennung «Regierungs- rat» am Zeilenende.

Die Toleranz fängt Erfassungs- und Scanfehler auf, holt aber auch unerwartete Wörter in die Trefferliste. Kurze alte Schreibungen findet die Suche nicht von selbst – *Gesez* für Gesetz, *Kilchen* für Kirchen. Solche Varianten gehören ins Feld «Irgendeines dieser Wörter»; in den [Ratsmanualen](/about/rm) ist das die Regel.

## Mehrere Suchwörter

Bei mehreren Suchwörtern müssen **alle** im Dokument vorkommen (UND). Unvollständige Wörter gehören **ans Ende**, denn nur beim letzten Wort werden Wortanfänge ergänzt: `see fisch` findet auch *Fischer*, `fisch see` nur das ganze Wort «fisch» (dafür den *Seerücken*).

## ODER-Suche (Vereinigung)

Mehrere Begriffe lassen sich mit **`OR`** (in beliebiger Schreibung) oder **`|`** verbinden – nützlich für Synonyme oder alte Schreibweisen: `tolle Hunde OR Wuth` findet Dokumente mit «tolle» und «Hunde» – oder mit «Wuth». In Anführungszeichen bleibt `OR` ein gewöhnliches Wort (`"Art. 41 OR"`). Die Begriffe landen im Feld «Irgendeines dieser Wörter». Mit «ausschliessen» oder im Feld «Ohne diese Wörter» getippt, schliesst `A OR B` beide Begriffe aus. Eine Suche nimmt höchstens zehn ODER-Begriffe auf.

Trefferzahl, Serien-Verteilung und Zeitleiste beziehen sich auf die gesamte Vereinigung. ODER lässt sich kombinieren:

- mit **Pflichtwörtern** («Alle diese Wörter»): (A ODER B) UND Pflichtwörter,
- mit Serie, Zeitraum und den übrigen Filtern,
- mit dem **Thema**: Dann reiht das Thema die Vereinigung – `Kokain OR Koks OR Coca` mit Thema «Drogen» hebt die Drogen-Dokumente nach oben, vor Brennstoff-Koks.

## Phrasensuche

In **Anführungszeichen** gesetzte Wortfolgen werden exakt und zusammenhängend gesucht: `"freiwillige Feuerwehr"`. Tippfehler-Toleranz und Wortanfang-Ergänzung sind dabei **ausgeschaltet**. Dasselbe bewirkt das Kästchen **«exakt»**.

## Wörter ausschliessen

Ein **Minuszeichen** direkt vor einem Wort schliesst Dokumente aus, die dieses Wort enthalten: `feuerwehr -dübendorf`. Dasselbe bewirken das Kästchen **«ausschliessen»** und das Feld **«Ohne diese Wörter»**. Ausgeschlossen wird nur das **ganze Wort** (ohne Wortanfang-Ergänzung und Tippfehler-Toleranz).

## Nur im Titel suchen

Das Kästchen **«nur im Titel»** beschränkt die lexikalische Suche einschliesslich der ODER-Begriffe auf die Dokumenttitel; auf das Thema wirkt es nicht. Titellänge und -konventionen schwanken über Serien und Zeit; ein fehlender Titeltreffer heisst nicht, dass das Thema im Dokument fehlt.

## Gross-/Kleinschreibung und Akzente

Beides wird normalisiert: `müller`, `muller` und `MÜLLER` liefern dieselben Treffer. **«ß» gilt als «ss»**, in allen Beständen. In den Zentralen Serien und den Editionen steht «ss» auch in den Auszügen; die Reiter «Archivkatalog» und «Ehedaten» und jede Detailansicht zeigen den Text wie in der Quelle. Es gibt **keine Stoppwörter** – auch «und», «der» oder «die» werden gesucht.

## Reihenfolge der Treffer

Das Sortier-Menü oberhalb der Trefferliste bietet je nach Suche:

- **«Relevanz»** (mit Suchbegriff): gewichtet in dieser Reihenfolge – wenige Tippfehler vor vielen → **genau so geschrieben** vor ergänztem Wortanfang → **Fundort (Titel vor Volltext)** → Nähe der Suchwörter zueinander (in den Reitern «Archivkatalog», «Ehedaten» und «Editionen» die Nähe vor dem Fundort).
- **«Ähnlichkeit»** (mit Thema): ordnet nach inhaltlicher Nähe zum Thema. Die Ratsmanuale, die sich so nicht ordnen lassen, folgen am Schluss.
- **«Datum aufsteigend»** und **«Datum absteigend»**: chronologisch.

Ohne Suchbegriff, Thema und ODER-Begriffe ist die Liste chronologisch geordnet (älteste zuerst).

**Wie weit sich blättern lässt:** Nach Datum sortiert sind in den Zentralen Serien alle Treffer zu durchblättern (mit einem Thema die des «Themen-Umfangs»). Nach Relevanz und in den Reitern «Archivkatalog» und «Ehedaten» sind es die ersten 10'000, mit einem Thema die ersten 1'000. Zu den übrigen führen engere Filter; die Zentralen Serien lassen sich auch [herunterladen](#treffer-herunterladen).

**Genau so geschrieben zuerst:** In der Liste der Zentralen Serien stehen zuerst die Treffer, in denen alle Suchwörter genau so geschrieben sind; die Trefferzahl nennt, wie viele («davon 190 genau so geschrieben»). Nach einer Trennlinie folgen die **ähnlichen Schreibungen**, ihre Fundstellen gepunktet unterstrichen. Das gilt auch nach Datum, aber nicht bei Thema, ODER-Begriffen und «nur im Titel».

## Personen, Orte und Organisationen

Die Vorschläge in diesen Feldern (`Mul` schlägt *Müller* vor) sind nach **Häufigkeit** sortiert und berücksichtigen die übrigen Filter: Vorgeschlagen werden nur Namen, die in der aktuellen Treffermenge vorkommen.

Ein gewählter Name findet auch seine gleichwertigen **Schreibvarianten**: «Fischental» auch «Fischenthal», «Hans Frey» auch «Frei, Hans». Angeglichen werden Gross- und Kleinschreibung, Umlaute und ß, gängige Varianten (th/t, y/i, c/k, ph/f, doppelte Konsonanten) und die Archivform «Nachname, Vorname»; «Stadt Zürich» gilt als «Zürich», «Kanton Zürich» und «Bezirk Horgen» bleiben eigene Namen. Personen brauchen dafür Vor- und Nachnamen – ein Nachname allein gilt genau so. Varianten, die so nicht zusammenfallen («Wädenschweil», «Frei Hans» ohne Komma), lassen sich zusätzlich auswählen; innerhalb einer Facette gilt ODER.

In den anderen Reitern: Der Archivkatalog vergleicht ebenfalls über die Schreibung hinweg (dort zählen «Kanton Zürich» und «Zürich» vorerst als ein Name). In den Ehedaten trifft eine Person Bräutigam oder Braut (ein Nachname genügt) und ein Ort die Herkunft. Die Editionen kennen auch Einzelnamen; Personen mit Zusatz in Klammern («Ulrich Zwingli (1556–1601)») gelten dort nur genau so.

In den **Ratsmanualen** finden die Namensfilter **vereinheitlichte Namen** (welche, steht unter [Ratsmanuale](/about/rm#text-maschinelle-transkription)). Ergänzend bietet der Reiter «Zentrale Serien» über der Trefferliste den Volltext an, wenn die Auswahl ihre Zeit berührt: «Im Volltext der Ratsmanuale: «Kyburg» (auch «Kiburg», «Kyburch») in 5’881 Sitzungen – anzeigen». Gesucht wird mit den Schreibungen aus dem Register der Editionen, jede als exakte Wortfolge; das sind keine geprüften Nennungen. Personen werden nur mit Vor- und Nachnamen und in der Zeit der Editionsstücke mit ihnen (± 10 Jahre) gesucht; Personen, die keine Edition nennt, nur mit gesetztem Zeitraum.

## Wie sich Filter kombinieren

- **Zwischen** verschiedenen Filtern gilt UND: Serie «RRB» + Ort «Uster» + Zeitraum 1900–1950 müssen alle gleichzeitig zutreffen.
- **Innerhalb** eines Filters gilt ODER: zwei ausgewählte Serien bedeuten «die eine oder die andere».
- Der **Thema-Filter** schränkt die Treffermenge nicht ein, sondern reiht sie; nur bei Datums-Sortierung wählt er die ähnlichsten Dokumente aus («Themen-Umfang»).
- Der **Zeitstrahl** zeigt die Verteilung der Treffer über die Jahre: ein Klick (oder Tipp) filtert ein Jahr, Ziehen einen Bereich; «Reset ×» hebt die Einschränkung auf. Er reicht nur dann vor 1803 zurück, wenn Treffer oder Filter dort liegen. Bei langen Spannen fasst ein Balken mehrere Jahre zusammen. Auf einen gewählten Zeitraum zoomt der Zeitstrahl (mindestens 21 Jahre); der Pfad darunter («Alle Jahre › 1600 – 1700 › 1650 – 1659») führt zu einer früheren Stufe zurück.
- «**Link zur Trefferliste kopieren**» kopiert die Adresse der aktuellen Trefferliste mit allen Filtern.

## Treffer herunterladen

Über **«Alle Treffer herunterladen»** oberhalb der Trefferliste lässt sich jede Suche mit allen Filtern als Datei mitnehmen – in der Reihenfolge der Trefferliste:

| Auswahl | Inhalt | Obergrenze |
|---|---|---|
| **Trefferliste als Tabelle** (CSV oder Excel) | eine Zeile pro Dokument: ID, Signatur, Titel, Datum, Serie, Band/Seite/Beschlussnummer, erkannte Personen/Orte/Organisationen und Links (Detailseite, TEI-Quelle, IIIF-Manifest, Archivkatalog) | 100'000 Dokumente |
| **Tabelle + Volltexte** (ZIP) | zusätzlich eine `.txt`-Datei pro Dokument und ein README mit Such-Link, Umfang und Lizenz | 10'000 Dokumente |
| **Tabelle + Volltexte + IIIF-Sammlung** (ZIP) | zusätzlich eine IIIF-Sammlung, mit der sich alle Faksimiles auf einmal in IIIF-Viewern wie Mirador öffnen lassen | 10'000 Dokumente |

Übersteigt die Suche die Obergrenze, enthält der Download die **ersten** Treffer der Liste; das Fenster nennt die genaue Zahl vorab. Mit Thema sind es höchstens 10'000, zuerst die dem Thema nächsten, bei Datums-Sortierung die Dokumente des «Themen-Umfangs». Die Volltexte stammen aus dem Suchindex (vereinheitlichter Leerraum, sehr lange Dokumente gekürzt); die vollständige TEI-Quelle ist in der Tabelle verlinkt. Pro Netz sind höchstens 10 Downloads in 10 Minuten und 2 gleichzeitig möglich. Ganze Bestände gibt es als [Open-Data-Pakete](/about/api#bulk-daten).

## Im Dokument

Ein Klick auf einen Treffer öffnet die Dokumentansicht:

- **Blättern in den Treffern:** Wer aus einer Trefferliste kommt, springt mit «← Voriges» und «Nächstes →» zum benachbarten Treffer («Treffer X von Y») und mit «← Zurück zur Trefferliste» zur Liste zurück.
- **Text und Faksimile:** Neben dem Lesetext zeigt der Viewer (Mirador) das Faksimile; ein Klick auf eine Seitenmarke «[N]» im Text springt zur betreffenden Seite. Auf schmalen Bildschirmen liegen Text und Faksimile in Reitern. Die born-digital Bestände haben kein Faksimile – dort führt «Original-PDF öffnen» zur Quelle.
- **Randnotizen** des Originals erscheinen neben dem Absatz, zu dem sie gehören.
- **Personen, Orte und Organisationen** sind im Text markiert; ein Klick öffnet in einem neuen Tab die Suche nach allen Dokumenten mit diesem Namen, auch in anderen Schreibungen. In den Ratsmanualen sucht der Klick den Namen als exakte Wortfolge in dieser Serie (siehe [Ratsmanuale](#ratsmanuale)).
- **Personen aus der Kantonsratsdatenbank:** In Kantonsratsprotokollen sind Namen, die einem Rats- oder Regierungsmitglied zugeordnet sind, durchgehend unterstrichen; eine Karte zeigt Amt, Partei und Wahlkreis zum Sitzungsdatum, Links und, wo vorhanden, ein Porträt. Der Reiter «Personen» listet alle zugeordneten Personen. Jede hat eine eigene Seite («Alle Dokumente») mit allen Protokollen, in denen sie vorkommt, wahlweise nur im Titel oder nur im Text. Die Zuordnung erfolgt automatisch (siehe [Kantonsratsprotokolle](/about/krp#personen)); Fehler lassen sich über «Zuordnung melden» mitteilen.
- **Verwandte Dokumente:** Wo die Quelle selbst auf andere Dokumente verweist – etwa Änderungen oder Aufhebungen von Erlassen –, listet «Verwandte Dokumente» diese Bezüge auf; Dokumente ausserhalb des Bestands verlinken in den Online-Archivkatalog.
- **Ähnliche:** Der Reiter «Ähnliche» zeigt die zehn inhaltlich ähnlichsten Dokumente (nicht bei den Ratsmanualen).
- **Archivkatalog:** Der Reiter «Archivkatalog» zeigt die Verzeichnungseinheit des Dokuments im Archivplan, dazu Einheiten, die auf das Dokument verweisen (siehe [Archivkatalog](/about/archivkatalog)).
- **Weiterverwenden:** «Daten herunterladen» stellt Volltext (`.txt`), HTML-Druckansicht und TEI-XML zusammen, auf Wunsch mit den Faksimile-Bildern in Originalauflösung (bei den Ratsmanualen nur verlinkt). «Permalink kopieren» liefert eine stabile Adresse zum Zitieren, «Im Archivkatalog» führt auf die Verzeichnungseinheit, «IIIF» zum Manifest des Faksimiles.

<h2 id="ratsmanuale">Ratsmanuale (1484–1798)</h2>

Die [Ratsmanuale](/about/rm) unterscheiden sich in einigen Punkten von den übrigen Serien; ausführlich auf ihrer eigenen Seite:

- **Maschinelle Transkription**, grösstenteils nicht nachkorrigiert; Lesefehler sind möglich.
- **Gesucht wird in der Lesefassung:** Worttrennungen und Nasalstriche aufgelöst, übrige diakritische Zeichen entfernt, ß im Wortinnern als ss. Die Detailansicht zeigt den Text in der Schreibweise der Handschrift; daraus kopierter Text findet das Dokument trotzdem.
- **Alte Schreibweisen mitsuchen**, am bequemsten im Feld «Irgendeines dieser Wörter» (*Kilchen OR Kirchen*).
- **Keine Thema-Suche:** Das Thema wirkt hier nur als Stichwortsuche nach seinen Inhaltswörtern; der Reiter «Ähnliche» entfällt.
- **Datum** wie in der Quelle, bis 1700 im alten Stil («(a. St.)»).
- **Band:** Mit «Ratsmanuale» als einziger Serie erscheint der Filter «Bandnummer» (die Nummer in StAZH B II).
- **Faksimile:** Die Bilder kommen vom Transkribus-Bildserver; das kann vereinzelt einige Sekunden dauern.

---

Beispiele geprüft im September und November 2026; Trefferzahlen verschieben sich mit dem Bestand. Die technischen Grundlagen sind unter [Architektur](/about/architektur) skizziert.
