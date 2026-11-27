<script lang="ts">
	import { SITE_NAME } from "$lib/site";
</script>

<svelte:head><title>Archivkatalog | {SITE_NAME}</title></svelte:head>

<a href="/about" class="text-sm text-accent-600">← Zurück zur Übersicht</a>

# Archivkatalog des Staatsarchivs

| | |
|---|---|
| **Quelle** | [Online-Archivkatalog](https://suche.staatsarchiv.djiktzh.ch) des Staatsarchivs des Kantons Zürich |
| **Inhalt** | Verzeichnungseinheiten: Akten, Urkunden, Pläne, Nachlässe, Personendossiers, Fotos, Patentschriften, die Ehedatenbank u. a. |
| **Hier durchsuchbar** | im Reiter «Archivkatalog» der Suche, über `/api/v1/catalog` und das MCP-Werkzeug `catalog_search` für eigene KI-Assistenten (beide auch nach den Namen des Registers filterbar, das Werkzeug auch nach Bedeutung) |
| **Eigene Seiten** | jede Einheit unter `/archivkatalog/<ID>` (ID wie im Online-Katalog), mit Archivbaum; Einstieg in den Archivplan: [/archivkatalog](/archivkatalog); [Register](/archivkatalog/register) der Personen, Orte und Organisationen |
| **Keine eigenen Treffer** | die Einheiten der Zentralen Serien (samt Ratsmanualen), soweit sie als Dokumente auf der Plattform stehen (Reiter «Zentrale Serien»). Die Suche im Feld «Signatur» findet sie trotzdem; sie haben eine Katalogseite und stehen im Archivbaum, die Startseite zählt sie mit |
| **Text** | Beschreibungen des Staatsarchivs (Titel, Regest bzw. «Inhalt und Form», Provenienz), kein Volltext der Akten |
| **Stand** | vollständig übernommen, abgerufen vom 10. Juni bis 9. November 2026; was das Staatsarchiv seither neu verzeichnet, kommt mit der nächsten Aktualisierung dazu |

Der Online-Archivkatalog des Staatsarchivs verzeichnet weit mehr als die Zentralen Serien. Die Plattform macht diese Verzeichnungen zusammen mit den Volltexten durchsuchbar.

## Was übernommen wird

Die Plattform übernimmt die öffentlich zugänglichen Angaben des Online-Katalogs: Signatur, Titel, Stufe (Bestand, Dossier, Dokument …), Entstehungszeitraum, Regest bzw. «Inhalt und Form», Provenienz, Archivplan-Pfad, Links auf Digitalisate und die übrigen veröffentlichten Felder der Katalogseite. Einheiten, deren Angaben das Staatsarchiv wegen einer Schutzfrist nicht zeigt, fehlen auch hier. Die Angaben werden weder geprüft noch ergänzt; massgeblich ist der Online-Katalog, auf den jede Seite verlinkt. Er wird in grösseren Abständen neu übernommen.

## Suchen im Archivkatalog

Der Reiter **«Archivkatalog»** zeigt ohne Suchbegriff und Filter den **Archivbaum** ab der Wurzel; ein Suchbegriff, ein Filter, ein Klick in die Zeitleiste oder «Alle Einheiten als Liste nach Datum» führen zur Trefferliste. Suchbegriff, ODER-Begriffe, Thema, Zeitraum, Namen und «nur im Titel» teilt er mit den anderen Reitern. Zu sehen ist zunächst nur der Suchbegriff, alles Weitere liegt unter «Erweiterte Suchoptionen». Im Katalog gilt:

- Gesucht wird in Titel, Signatur, Regest bzw. Inhalt und Provenienz. **Alle Wörter müssen vorkommen**; das letzte Wort trifft auch Wortanfänge («Pest» auch «Pestalozzi»). «ß» gilt als «ss», auch in der Feldsuche; die Treffer zeigen die Schreibung des Katalogs. `"…"` sucht eine Wortfolge bzw. nur das ganze Wort, `-wort` schliesst ein Wort aus, ODER-Begriffe wirken wie in den Dokumenten (siehe [Suchhilfe](/about/suchhilfe#oder-suche-vereinigung)). Archivtitel nennen Personen meist in der Form «Nachname, Vorname».
- Das **Thema** reiht die Einheiten nach inhaltlicher Ähnlichkeit, wie bei den Dokumenten (siehe [Suchhilfe](/about/suchhilfe#die-werkzeuge-im-überblick)). Personendossiers, Ehedaten und Firmen haben keine Vektoren, weil ihre Titel nur aus Namen bestehen; mit einem Thema stehen sie am Ende der Liste.
- Die **Feldsuche** sucht nur in einem Feld: **Signatur**, **Titel**, **Inhalt und Form** (bei Urkunden das Regest) oder **Provenienz**. Alle Einträge müssen zutreffen, zusammen mit Suchbegriff und Filtern; «exakt» verlangt die Wortfolge, «ausschliessen» schliesst Einheiten aus. Bei der Signatur ist «exakt» voreingestellt: `C II 12` findet C II 12, Nr. 1 ff., aber nicht C II 1, Nr. 12. Nur diese Suche findet auch die Einheiten der Zentralen Serien, mit Link auf das Dokument (`MM 3.56 RRB 1938/1585`, auch mit «StAZH» davor). Mit dem Feld **Bestand** wählt man einen Bestand aus den aktuellen Treffern. Geschichte des Aktenbildners, Bestandsgeschichte, Autorschaft und Frühere Signaturen sind auf der Seite der Einheit zu lesen, aber nicht durchsuchbar. Trifft jeder Eintrag (und der Suchbegriff) für sich mehr als 10'000 Einheiten, bittet die Suche darum, einen Eintrag enger zu fassen.
- Filter: **Zeitraum** (der Katalog reicht bis ins Mittelalter zurück), **Personen, Orte und Organisationen**, **Stufe** und **nur mit Digitalisat**. Serienfilter wirken nur auf die Dokumente.
- **Personen, Orte und Organisationen** gelten über die Schreibung hinweg (Meier und Meyer; siehe [Suchhilfe](/about/suchhilfe#personen-orte-und-organisationen)). Der Katalog fasst dabei vorerst noch etwas mehr zusammen als die Dokumente («Kanton Zürich» wie «Zürich», «Pfäffikon SZ» wie «Pfäffikon»). Ein Nachname ohne Vornamen filtert nur die Dokumente.
- Ohne Suchbegriff, ODER-Begriffe, Feldsuche und Thema erscheinen die Einheiten chronologisch. Durchblättern lassen sich in jeder Reihenfolge die ersten 10'000, mit einem Thema die ersten 1'000; zu den übrigen führen engere Filter.
- Die **Zeitleiste** zeigt die Treffer über den Entstehungszeitraum; eine Einheit zählt in jedem Jahr, das er berührt. Ohne Stufenwahl zählt sie nur Dossiers, Subdossiers und Dokumente, und ein Klick setzt diese drei Stufen mit; «Alle Jahre» bzw. «Reset» nimmt beides zurück. Einheiten ohne Datum fehlen; ihre Zahl steht darunter.
- Jeder Treffer führt auf seine eigene Seite; der Link «Im Archivkatalog des Staatsarchivs ↗» darunter öffnet die Einheit im Online-Katalog, mit Bestellangaben.

## Register

Das [Register](/archivkatalog/register) verzeichnet die **Personen, Orte und Organisationen**, die in den Verzeichnungen vorkommen, je mit der Zahl der Einheiten. Ein Klick auf einen Namen öffnet den Reiter «Archivkatalog» mit diesen Einheiten.

- **Wie die Namen entstehen:** Sie werden automatisch erkannt, aus dem Titelschema (Personendossiers, Ehedatenbank, Patentschriften), nach den Erschliessungsregeln des Staatsarchivs und mit einer automatischen Namenserkennung. Fehler sind möglich; ein Name, der im Register fehlt, ist über die Suche im Reiter trotzdem zu finden.
- **Ein Eintrag ist ein Name, keine geprüfte Person:** Schreibvarianten (Meier und Meyer, «Meier, Anna» und «Anna Meier») und gleichnamige Personen bilden einen Eintrag. Personen brauchen Vor- und Nachnamen.
- **Ordnung und Suche:** Die Liste umfasst die 2'000 häufigsten Namen je Register, nach Häufigkeit oder Name. Die Suche darüber findet auch seltenere: Jedes Wort trifft den Anfang eines Namensteils, die Reihenfolge ist egal («Anna Mei», «Meier, Anna»).
- **Zu jedem Eintrag:** «meist in …» nennt den Bestand mit den meisten seiner Einheiten. «Personenseite» führt zu einem Rats- oder Regierungsmitglied, wenn Einheiten ihm sicher zugeordnet sind; die Klammer nennt, wie viele, wenn die übrigen Namensvettern sein können. «Dokumente» führt in die Dokumentsuche mit demselben Namen.
- **Prägen ganze Bestände:** Urheber, Provenienzen und Namensgeber, die an fast jeder Einheit ihres Bestands stehen (etwa ein Fotograf an jedem seiner Fotos), stehen getrennt über der Liste.
- Die **[Übersicht der Register](/register)** (Menüpunkt «Register») sucht einen Namen zugleich in diesem Register, bei den Rats- und Regierungsmitgliedern, in den Ehedaten und im Register der Editionen.

Die automatische Namenserkennung ist für Urkunden, Akten, Fotos und Pläne gelaufen, nicht für kurze Titel und Protokolleinträge ohne Volltext; dort fehlen Namen, die nur sie erkennen würde.

## Mit einem KI-Assistenten

Ein eigener KI-Assistent ([Eigene KI anbinden](/about/ai)) durchsucht den Katalog über das MCP-Werkzeug `catalog_search`: wörtlich wie der Reiter (Pläne über die Signatur «PLAN …», Urkunden über die Abteilung C) oder mit `semantic=true` nach Bedeutung («Grippe Epidemie» findet «Grippe und deren Bekämpfung 1918/19»). Personendossiers, Ehedaten und Firmen erreicht nur die Suche nach Wörtern.

## Seiten der Verzeichnungseinheiten

Jede Einheit hat eine eigene Seite mit Stufe, Entstehungszeitraum, Signatur, Titel, Archivplan-Kontext, Untereinheiten, erkannten Namen (siehe [Register](#register)), den veröffentlichten Abschnitten des Online-Katalogs, Digitalisat-Links und Zitiervorschlag. Steht die Einheit als Dokument auf der Plattform, führt «Dokument auf der Plattform öffnen» zum Volltext; verweist sie nur per Weblink auf ein Dokument, führt «Dokument öffnen, auf das die Einheit verweist» dorthin.

Der **Archivplan-Kontext** zeigt, wo die Einheit im Archivplan steht, samt voriger und nächster Einheit derselben Stufe. Unter **Untereinheiten** steht der Archivbaum in der Reihenfolge des Archivplans; [/archivkatalog](/archivkatalog) beginnt bei der Wurzel. Einzelne Stufen, die nur aus dem Archivplan ihrer Untereinheiten bekannt sind, haben eine Seite mit Titel und Datum, aber ohne Beschreibung.

Alle Katalogseiten, auch das Register, sind für Suchmaschinen gesperrt («noindex»).

## Editionen

Edieren die [Quellen zur Zürcher Geschichte](https://qzh.sources-online.org) (QZH) oder die [Zürcher Rechtsquellen](https://rechtsquellen.sources-online.org) (SSRQ ZH) eine Einheit, nennt der Kopf ihrer Seite das Stück («Ediert in QZH: QZH_401») mit Link auf seine Seite im Reiter [Editionen](/about/editionen) und auf die Edition. Grundlage ist die Katalog-ID, die die Edition bei ihrer Vorlage angibt (1'682 Einheiten); Vorlagen in anderen Archiven ergeben keinen Verweis. «(weitere Überlieferung)» heisst: Die Rechtsquellen edieren das Stück aus einer anderen Vorlage. Die Seiten der Ratssitzungen nennen zusätzlich die edierten Einträge der Sitzung (siehe [Ratsmanuale](/about/rm#editionen)).

Die Editionen tragen eigene Lizenzen, die Editionsdaten der QZH und der Rechtsquellen [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de). Nennung und Lizenz stehen beim Verweis, ebenso in der API (`/api/v1/catalog/{id}`, Feld `editions`).

## An den Dokumenten und auf den Personenseiten

Die Dokumente der Zentralen Serien, auch die Sitzungen der Ratsmanuale, haben einen Reiter **«Archivkatalog»** mit ihrer Verzeichnungseinheit im Archivplan-Kontext; auch der Link im Kopf des Dokuments führt dorthin. Verweisen andere Einheiten per Weblink auf das Dokument, stehen sie im selben Reiter unter «Verweise im Archivkatalog». Fehlt die Einheit eines Dokuments im Katalog, führt der Link im Kopf in den Online-Katalog.

Die [Personenseiten](/personen) der Rats- und Regierungsmitglieder zeigen unter **«Im Archivkatalog»** die Einheiten, die der Person sicher zugeordnet sind: über einen Verweis des Katalogs auf die Kantonsratsdatenbank oder über Name, Geburtsjahr und Amtszeit im Titel, meist Pressefotos und Personendossiers. Getrennt davon, auf Klick, stehen die Einheiten mit gleichem Namen und passender Lebenszeit; ob es dieselbe Person ist, ist nicht geprüft. Fehler lassen sich über «Zuordnung melden» mitteilen.

## Digitalisate

Hat das Staatsarchiv eine Einheit digitalisiert, stehen unter dem Treffer und auf der Seite der Einheit Links auf die Dateien (meist PDF) oder auf die Bildansicht des Online-Katalogs. Die Dateien liegen beim Staatsarchiv; die Plattform zeigt keine Vorschaubilder.

## Zitieren

Verzeichnungseinheiten zitiert man mit Signatur und Permalink des Online-Katalogs; jede Seite bietet dafür einen Zitiervorschlag, etwa «StAZH Z 403.1504, Katzenseegut, 1918 – 1959; <https://archivkatalog.ji.zh.ch/detail.aspx?ID=588692>». Die Beschreibungen stammen vom Staatsarchiv; die Plattform macht zu ihnen keine Lizenzangabe, anders als zu den Quellentexten (siehe [API](/about/api#lizenz)).

## Grenzen

- Die Katalogangaben sind Verzeichnungen, keine Transkriptionen. Wer den Inhalt braucht, öffnet ein vorhandenes Digitalisat oder bestellt die Akten im Lesesaal des Staatsarchivs.
- Die Beschreibungen sind unterschiedlich ausführlich: manche Einheiten tragen nur einen kurzen Titel, andere ein ausführliches Regest.
- Der Entstehungszeitraum ist teils nur ungefähr angegeben («ca. 18. Jh.»); Zeitraumfilter und Zeitleiste rechnen mit der ganzen Spanne. Der Zeitraumfilter trifft jede Einheit, deren Entstehungszeitraum ihn berührt, also auch Bestände und Bände, die weit darüber hinausreichen.
- Einzelne Einheiten der Zentralen Serien stehen nicht als Dokument auf der Plattform, etwa Beilagen, Mitgliederlisten (Regierungsrat 1887–1940) und einzelne Traktanden des Kantonsrats 1942–1944; sie erscheinen im Reiter «Archivkatalog» als eigene Treffer.

## Personendaten

Die Verzeichnungen nennen Personen, teils mit Geburtsjahr, Herkunft und dem Anlass des Dossiers, etwa in Gerichts-, Polizei- oder Patientenakten. Die Plattform zeigt nur, was das Staatsarchiv im Online-Katalog veröffentlicht, und übernimmt Änderungen und Löschungen erst bei der nächsten Aktualisierung. Wer eine Angabe schon vorher berichtigt oder entfernt haben möchte, schreibt an den Betreiber. Was ein eigener KI-Assistent über den MCP-Server erhält, verarbeitet sein Anbieter ([Datenschutzerklärung](/datenschutz), Abschnitte 9, 12 und 13).
