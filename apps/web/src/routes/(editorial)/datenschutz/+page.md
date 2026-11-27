<script lang="ts">
	import { SITE_NAME } from "$lib/site";
	import { CONTACT_EMAIL } from "$lib/contact";
</script>

<svelte:head>
	<title>Datenschutzerklärung | {SITE_NAME}</title>
	<meta name="description" content="Datenschutzerklärung der {SITE_NAME}: Server-Protokolle, Nutzungsstatistik, externe Inhalte, Personendaten in den Quellen und Ihre Rechte." />
</svelte:head>

# Datenschutzerklärung

*Stand: 24. November 2026*

## 1. Verantwortlicher

- **Verantwortlich:** Tim Rüdiger
- **E-Mail:** <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>

Die {SITE_NAME} (%SITE_HOST%) ist ein inoffizieller Prototyp, privat betrieben von Tim Rüdiger – kein Angebot des Staatsarchivs oder des Kantons Zürich. Für die Bearbeitung von Personendaten auf dieser Website ist der Betreiber verantwortlich, nicht das Staatsarchiv.

Aufsichtsbehörde: Eidgenössischer Datenschutz- und Öffentlichkeitsbeauftragter (EDÖB) – [www.edoeb.admin.ch](https://www.edoeb.admin.ch).

## 2. Geltungsbereich

Diese Erklärung gilt für **%SITE_HOST%** (auch unter den früheren Adressen zentraleserien.ch, zh-protoplattform.ruediger.broker, zh-quellenplattform.ruediger.broker und zh-quellensuche.ruediger.broker) mit allen Quellen: den Zentralen Serien des Kantons Zürich (Offizielle Gesetzessammlung, Amtsblatt, Kantonsratsprotokolle, Regierungsratsbeschlüsse), den Ratsmanualen der Stadt und Republik Zürich (1484–1798), dem Archivkatalog, den Ehedaten, den Editionen und den Registern sowie für die öffentlichen Schnittstellen (REST, DTS, MCP). Abschnitte 4–11 beschreiben, was beim Besuch bearbeitet wird, Abschnitt 12 die Personendaten in den Quellen.

## 3. Rechtsgrundlagen

Die Bearbeitung von Personendaten richtet sich nach dem Bundesgesetz über den Datenschutz (DSG). Für Zugriffe aus dem EU-Raum gilt, soweit anwendbar, zusätzlich die Datenschutz-Grundverordnung (DSGVO). Die Veröffentlichung der Quellen stützt sich auf das überwiegende Interesse an der Zugänglichkeit bereits publizierter amtlicher Quellen und archivischer Verzeichnisse für Forschung und Öffentlichkeit (Art. 31 Abs. 1 DSG, Art. 6 Abs. 1 lit. f DSGVO).

## 4. Hosting, Empfänger und Länder

Die Anwendung läuft auf einem Server der Hetzner Online GmbH, Gunzenhausen (Deutschland), im Rechenzentrum Nürnberg; Hetzner bearbeitet Daten als Auftragsbearbeiterin. Suche, Anzeige der Dokumente, Nutzungsstatistik und Monitoring erfolgen auf diesem Server. Die Website erzeugt keine Antworten mit Sprachmodellen und übermittelt keine Fragen an KI-Anbieter; wer einen eigenen KI-Assistenten anbindet, tut das über dessen Anbieter (Abschnitt 9).

Zu weiteren Empfängern gelangen Daten nur in folgenden Fällen:

- **Faksimiles der Zentralen Serien und der Editionen:** Bildserver media.sources-online.org (Schweiz), siehe Abschnitt 11.
- **Einzelne Faksimiles der Editionen:** e-manuscripta.ch (Zentralbibliothek Zürich, Schweiz), siehe Abschnitt 11.
- **Faksimiles der Ratsmanuale:** Transkribus, READ-COOP SCE mbH (Österreich), siehe Abschnitt 11.
- **Feedback-Formular:** GitHub, Inc. (USA) bzw. GitHub B.V. (Niederlande), siehe Abschnitt 10.
- **Wartung und Auswertung mit KI-gestützten Werkzeugen:** Anthropic (USA), siehe Abschnitte 7 und 10.

Deutschland, Österreich und die Niederlande haben nach dem Bundesrat einen angemessenen Datenschutz (Art. 16 Abs. 1 DSG). GitHub ist nach eigenen Angaben nach dem Swiss-U.S. Data Privacy Framework zertifiziert.

## 5. Server-Logdateien

Beim Aufruf der Seiten speichert der Webserver technische Daten in Zugriffsprotokollen: gekürzte IP-Adresse, Datum und Uhrzeit, die vollständige Anfrage (aufgerufene Adresse einschliesslich ihrer Parameter – damit auch Suchbegriffe, Themen, Namen und Fragen aus dem Frage-Feld, soweit sie in der Adresse stehen), Statuscode, übertragene Datenmenge, Referrer und Browser-Kennung (User-Agent). Die IP-Adresse wird gekürzt, bevor sie in die Zugriffsprotokolle geschrieben oder an die Anwendung weitergegeben wird: bei IPv4 um das letzte Oktett, bei IPv6 bleiben nur die ersten 32 Bit erhalten.

Zwei Protokolle können vollständige IP-Adressen enthalten: die Fehlerprotokolle des Webservers und das Zugriffsprotokoll der nur für den Betreiber bestimmten Monitoring-Adresse grafana.archivquellen.ch. Fehlermeldungen der Anwendung können einzelne Suchwörter enthalten, keine IP-Adressen; sie werden laufend überschrieben. Zur Abwehr von Missbrauch zählt der Server Anfragen zudem kurzzeitig im Arbeitsspeicher je gekürzter IP-Adresse (Rate-Limit), ohne sie zu speichern.

Die Protokolle dienen ausschliesslich dem sicheren und störungsfreien Betrieb sowie der Abwehr von Missbrauch. Zugriffsprotokolle werden täglich gewechselt und nach **rund 7 Tagen** automatisch gelöscht, Fehlerprotokolle nach sieben Wechseln (sie werden nur gewechselt, wenn sie Einträge enthalten; das kann einige Monate dauern). Eine Kopie der Zugriffsprotokolle mit gekürzter IP-Adresse wird im Betriebs-Monitoring (Abschnitt 7) **90 Tage** aufbewahrt. Rechtsgrundlage: überwiegendes Interesse am sicheren Betrieb (Art. 31 Abs. 1 DSG, Art. 6 Abs. 1 lit. f DSGVO).

## 6. Cookies und Browserspeicher

Die Anwendung setzt keine Cookies und kein Tracking ein. Damit die Rückwärts-Navigation an die richtige Stelle führt, legt sie die Scrollposition im Sitzungsspeicher Ihres Browsers ab (sessionStorage); er wird nicht an den Server übermittelt und endet mit dem Schliessen des Tabs.

## 7. Nutzungsstatistik

Zur Beurteilung der inhaltlichen Nutzung (welche Suchanfragen werden gestellt, welche Dokumente aufgerufen, welche Suchen liefern keine Treffer) wird ein eigenes Nutzungs-Log ohne vollständige IP-Adressen geführt. Erfasst werden pro Seitenaufruf:

- Zeitpunkt, aufgerufene Route (Seitentyp), Methode, HTTP-Statuscode, Antwortzeit
- bei Suchen: Suchbegriff und Thema (jeweils kleingeschrieben), Anzahl Treffer, Reiter, Sortierung, Seite der Trefferliste und aktive Filter (Serie, Personen, Orte, Organisationen, Zeitraum); Suchen, die während der Eingabe ausgelöst werden, sind als solche markiert
- eine Frage aus dem Frage-Feld der Startseite wird zum Thema der Suche und als solches erfasst; da sie Freitext ist, kann sie Angaben mit Personenbezug enthalten
- aufgerufene Dokumente der Zentralen Serien samt Ratsmanualen (Serie, Dokumentkennung, ob der Aufruf aus einer Trefferliste kam und an welcher Position)
- Downloads von Trefferlisten (Inhalt, Format und Anzahl der Dokumente sowie Suchbegriff, Thema und Serien der zugrunde liegenden Suche)
- bei Aufrufen des MCP-Servers (Abschnitt 9) Methode, Werkzeug bzw. Vorlage, Dauer, Zahl der Treffer, ein allfälliger Fehler und ob das Kontingent überschritten war – **nicht** die Suchwörter oder die übrigen Angaben des Aufrufs
- Browser-Familie (Chrome, Firefox, Safari …) und ob es ein Mobilgerät ist
- Herkunft des Aufrufs nur als «intern», «extern» oder «keine»
- Land (ISO-Code, z. B. CH, DE) – abgeleitet aus der bereits gekürzten IP-Adresse über eine lokale Datenbank (Abschnitt 8)
- ein **pseudonymer Sitzungs-Identifikator**: ein 8-stelliger Hash aus gekürzter IP-Adresse, Browser-Kennung und einem geheimen Schlüssel, der täglich wechselt, nur im Arbeitsspeicher liegt und nie gespeichert wird. Die IP-Adresse lässt sich daraus nicht zurückrechnen, Sitzungen lassen sich nicht über Tagesgrenzen hinweg verknüpfen.

Nicht erfasst werden vollständige IP-Adressen, vollständige Browser-Kennungen, Cookies, Header und Referrer-Adressen. Die Daten dienen ausschliesslich der Verbesserung von Suche und Erschliessung, der Beurteilung der Nutzung durch KI-Assistenten und der Beobachtung der Antwortzeiten. Es findet **keine** Profilbildung und kein Tracking statt.

Ausgewertet werden die Einträge vom Betreiber, auf dem Server oder auf seinen eigenen Geräten. Für Wartung und Auswertung kann er KI-gestützte Werkzeuge einsetzen (Claude von Anthropic, USA); dabei können Auszüge der Protokolle, etwa Suchbegriffe, dort bearbeitet werden, jedoch keine vollständigen IP-Adressen aus dem Nutzungs-Log, weil es keine enthält. Eine weitere Weitergabe an Dritte findet nicht statt.

Die Einträge werden nach **12 Monaten** automatisch gelöscht; für Auswertungskopien gilt dieselbe Frist. Das gilt auch für Einträge aus der Zeit bis November 2026, als die Website eine eigene KI-Antwort bot: Sie enthalten die damals gestellten Fragen (im limitierten KI-Modus nicht) und den verwendeten Modus. Rechtsgrundlage: überwiegendes Interesse an der Qualitätssicherung und Weiterentwicklung des Dienstes (Art. 31 Abs. 1 DSG, Art. 6 Abs. 1 lit. f DSGVO).

**Betriebs-Monitoring:** Die Zugriffsprotokolle (Abschnitt 5) und das Nutzungs-Log werden zusätzlich in ein Monitoring-System (Grafana, Loki, Prometheus) übernommen, das auf demselben Server läuft und nur dem Betreiber passwortgeschützt zugänglich ist. Es zeigt Auslastung, Fehler und zusammengefasste Nutzungszahlen, etwa häufige Suchbegriffe und Themen und die Nutzung der MCP-Werkzeuge. Die Kopien im Monitoring werden nach **90 Tagen** automatisch gelöscht.

## 8. Geolokalisierung auf Länderebene

Das Herkunftsland nach Abschnitt 7 bestimmt der Server mit der Datenbank «IP to Country Lite» von DB-IP ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de)). Sie liegt als Datei auf dem Server und wird monatlich aktualisiert; nachgeschlagen wird ausschliesslich lokal und mit der gekürzten IP-Adresse. An DB-IP wird nichts übermittelt. Nachweis: [IP Geolocation by DB-IP](https://db-ip.com).

## 9. Eigene KI-Assistenten (MCP-Server)

Die Website stellt einen MCP-Server bereit (Adresse /api/mcp, siehe [Eigene KI anbinden](/about/ai)), über den ein KI-Assistent, den Sie selbst verbinden (z. B. Claude, ChatGPT oder Apertus), in den Beständen sucht. Der Assistent ruft dazu Suchwerkzeuge auf und erhält deren Ergebnisse: Titel, Auszüge und Volltexte der Bestände, Verzeichnungseinheiten des Archivkatalogs, Eheeinträge und edierte Stücke – dieselben Angaben, die auch die Website und die übrigen Schnittstellen zeigen, also auch Personendaten nach Abschnitt 12.

Ihre Frage an den Assistenten und seine Antwort bearbeitet dessen Anbieter nach seinen eigenen Bedingungen und in eigener Verantwortung; viele Anbieter befinden sich ausserhalb der Schweiz und der EU. Die Plattform erhält nur die Aufrufe, die der Assistent schickt: das Werkzeug und die Suchangaben (Suchwörter, Filter, Dokumentkennungen), meist von den Servern des Anbieters aus und nicht von Ihrem Gerät. Die Suchwörter bildet der Assistent selbst; sie können Teile Ihrer Frage enthalten.

Die Aufrufe werden auf dem Server nur zur Beantwortung bearbeitet. Das Nutzungs-Log (Abschnitt 7) vermerkt je Aufruf Werkzeug, Dauer, Trefferzahl und einen allfälligen Fehler, nicht die Suchwörter; die Zugriffsprotokolle (Abschnitt 5) enthalten nur die Adresse /api/mcp, nicht den Inhalt des Aufrufs. Für das Kontingent (300 Aufrufe pro Minute je Netz) zählt der Server die Aufrufe kurzzeitig im Arbeitsspeicher.

Bis November 2026 bot die Website eine eigene KI-Antwort: Fragen und passende Quellen-Passagen gingen dabei an externe Sprachmodelle (vermittelt über OpenRouter, Public AI bzw. Hugging Face), ausser im limitierten KI-Modus, der ein Sprachmodell auf dem eigenen Server nutzte. Diese Funktion ist entfallen.

Rechtsgrundlage: überwiegendes Interesse an der Bereitstellung einer Recherche-Schnittstelle zu öffentlichen Beständen (Art. 31 Abs. 1 DSG, Art. 6 Abs. 1 lit. f DSGVO).

## 10. Rückmeldungen

Über das Feedback-Formular (Schaltfläche «Feedback» bzw. «Zuordnung melden») können Sie eine Rückmeldung senden. Übermittelt werden Ihre Nachricht, die freiwillige Kontaktangabe (z. B. eine E-Mail-Adresse für Rückfragen) und die Adresse der aufgerufenen Seite, einschliesslich der Suche, wenn sie darin steht. Ihre IP-Adresse wird dabei nicht gespeichert. Bis November 2026 konnte eine Rückmeldung zu einer KI-Antwort auch deren Verlauf enthalten (Frage, Antwort, verwendetes Modell, Fundstellen und Rechercheschritte).

Die Rückmeldung wird als Eintrag in einem nicht öffentlichen Repository des Betreibers bei GitHub gespeichert (GitHub, Inc., USA, bzw. GitHub B.V., Niederlande). Sie dient ausschliesslich der Bearbeitung Ihres Anliegens und der Verbesserung des Dienstes und kann dabei mit KI-gestützten Werkzeugen (Claude von Anthropic, USA) bearbeitet werden. Geben Sie im Formular nur Angaben an, die Sie übermitteln möchten; für vertrauliche Anliegen, etwa zu Personendaten, schreiben Sie bitte eine E-Mail. Schreiben Sie per E-Mail, werden Ihre Nachricht und Adresse zur Beantwortung bearbeitet. Auf Wunsch werden Rückmeldungen und Nachrichten gelöscht.

Rechtsgrundlage: Ihre Einwilligung durch das Absenden sowie das überwiegende Interesse an der Bearbeitung von Rückmeldungen (Art. 31 Abs. 1 DSG, Art. 6 Abs. 1 lit. a und f DSGVO).

## 11. Externe Inhalte

**Faksimiles** lädt Ihr Browser direkt von externen Bildservern. Dabei werden Ihre IP-Adresse, Angaben zum Browser, der Zeitpunkt und das angeforderte Bild an deren Betreiber übermittelt, als Herkunft der Anfrage nur die Adresse der Website, nicht die aufgerufene Seite. Auf breiten Bildschirmen steht das Faksimile neben dem Text, die Bilder werden dann schon beim Aufruf der Seite geladen; auf schmalen Bildschirmen erst, wenn Sie den Reiter «Faksimile» öffnen.

- **Zentrale Serien und Editionen:** Bildserver **media.sources-online.org**, über den das Staatsarchiv bzw. die Editionen ihre Digitalisate bereitstellen.
- **Einzelne Stücke der Quellen zur Zürcher Geschichte:** **e-manuscripta.ch**, Plattform für Handschriften aus Schweizer Bibliotheken und Archiven (Digitalisate der Zentralbibliothek Zürich).
- **Ratsmanuale:** Bildserver **files.transkribus.eu** der READ-COOP SCE mbH, Völser Strasse 11, 6020 Innsbruck (Österreich); wie READ-COOP Daten bearbeitet, beschreibt deren [Datenschutzerklärung](https://legal.transkribus.org/privacy) (englisch).

Die Bildbeschreibungen (Manifeste) liefert der Server der Plattform. Für Gesetzessammlung, Kantonsratsprotokolle und Regierungsratsbeschlüsse holt er sie bei zszh.sources-online.org (Schweiz); Ihre IP-Adresse, Angaben zu Ihrem Browser und die Adresse der aufgerufenen Seite gibt er dabei nicht weiter.

**Porträts** von Rats- und Regierungsmitgliedern stammen von Wikimedia Commons oder aus dem Bestand Z 1114 des Staatsarchivs, werden aber vom Server der Plattform ausgeliefert; Ihr Browser nimmt dafür keine Verbindung zu Wikimedia oder zum Archivkatalog auf. **Digitalisat-Links** im Archivkatalog führen zu Dateien auf dem Server des Staatsarchivs; Ihr Browser verbindet sich erst beim Anklicken dorthin, Vorschaubilder lädt die Plattform nicht. Schriften und Programmteile kommen vom eigenen Server. **Externe Links** (z. B. Online-Archivkatalog, zh.ch, Wikidata, GND, Historisches Lexikon der Schweiz, OpenStreetMap) führen zu Seiten Dritter, für deren Datenschutz die jeweiligen Betreiber verantwortlich sind.

## 12. Personendaten in den Quellen

Die Quellen nennen Personen. Diese Angaben hat die Plattform nicht bei den Betroffenen erhoben, sondern aus Publikationen des Staatsarchivs und weiterer Stellen des Kantons Zürich sowie aus Wikidata und Wikimedia Commons übernommen. Es sind vor allem Namen, Lebensdaten, Wohn- und Herkunftsorte, Berufe, Ämter und Parteien; je nach Quelle auch Angaben über Gesundheit, Fürsorge oder Verfahren, also besonders schützenswerte Personendaten. Die meisten Genannten sind verstorben, jüngere Dokumente und Verzeichnungen betreffen auch lebende Personen. Die Website und ihre Schnittstellen machen die Angaben weltweit zugänglich.

### Zentrale Serien

Die Zentralen Serien reichen von 1484 bis heute: die Ratsmanuale bis 1798, Amtsblatt, Kantonsratsprotokolle, Gesetzessammlung und Regierungsratsbeschlüsse ab 1803. Sie nennen Amtsträgerinnen und Amtsträger, aber auch Privatpersonen, etwa in Beschlüssen über Gesuche und Rechtsmittel oder in amtlichen Bekanntmachungen. Die Plattform zeigt nur Dokumente, die das Staatsarchiv bzw. der Kanton Zürich publiziert hat; Dokumente unter einer noch laufenden Schutzfrist von 30 oder 80 Jahren hat das Staatsarchiv von der Publikation ausgeschlossen. Die Namen von Personen, Orten und Organisationen sind überwiegend automatisch erkannt, dienen als Filter und können falsch oder falsch zugeordnet sein.

Die Texte der Ratsmanuale (1484–1798) sind maschinell transkribiert und können Lesefehler enthalten, auch in Namen. Übernommen wird die Transkription des Staatsarchivs auf Transkribus, ohne Angaben zu den Personen, die daran gearbeitet haben.

### Rats- und Regierungsmitglieder

Auf den Seiten der Kantonsratsprotokolle werden erwähnte Rats- und Regierungsmitglieder automatisch über Name und Amtszeit mit der öffentlichen Kantonsratsdatenbank (Staatsarchiv und Statistisches Amt) abgeglichen und – soweit vorhanden – mit Wikidata und einem Porträt verknüpft: frei lizenziert von Wikimedia Commons oder, wo Commons keines hat, ein Pressefoto aus der Amtszeit in kleiner Auflösung (Fotodokumentation des Tages-Anzeigers 1971–1999, Staatsarchiv, Bestand Z 1114). Angezeigt werden nur Angaben zur öffentlichen Amtstätigkeit (Amt, Partei, Wahlkreis, Wohnort während der Amtszeit) sowie Lebensdaten verstorbener Personen; Geburtsjahre lebender Personen werden nicht angezeigt.

Die Personenseiten nennen ausserdem Verzeichnungseinheiten des Archivkatalogs, die der Person über einen Verweis des Katalogs auf die Kantonsratsdatenbank oder über Name, Geburtsjahr und Amtszeit im Titel automatisch zugeordnet sind. Einheiten, die nur im Namen und in der Lebenszeit übereinstimmen, sind als nicht geprüft gekennzeichnet und erscheinen erst auf Klick, nicht im für Suchmaschinen sichtbaren Teil der Seite. Fehler lassen sich über «Zuordnung melden» mitteilen.

### Archivkatalog

Die Plattform macht die im Online-Archivkatalog des Staatsarchivs veröffentlichten Verzeichnungseinheiten durchsuchbar und zeigt sie auf eigenen Seiten. Sie können Namen, Geburtsjahre, Herkunft und den Anlass eines Dossiers nennen, etwa in Personen-, Gerichts-, Polizei-, Fürsorge- oder Patientendossiers. Übernommen wurde nur, was das Staatsarchiv im Online-Katalog öffentlich zeigt (Stand 9. November 2026), unverändert; Einheiten, deren Angaben es wegen einer Schutzfrist nicht zeigt, fehlen auch hier. Änderungen und Löschungen im Online-Katalog übernimmt die Plattform erst bei der nächsten Aktualisierung.

Ein Register stellt die Namen von Personen, Orten und Organisationen zusammen, die automatisch aus diesen Angaben erkannt werden, je mit der Zahl der Einheiten; gleich geschriebene Namen bilden einen Eintrag, ohne Prüfung, ob dieselbe Person gemeint ist. Die Schnittstellen lassen sich nach diesen Namen filtern, geben sie aber nicht aus. Die Seiten der Einheiten und das Register sind für Suchmaschinen gesperrt (Kennzeichnung «noindex»).

### Ehedaten, Kleiner Rat und Editionen

Die **Ehedaten** (Eheeinträge aus Zürcher Kirchenbüchern 1524–1800), das Register des **Kleinen Rats** (1225–1798) und die **Editionen** (Quellen zur Zürcher Geschichte 1275–1795, Zürcher Rechtsquellen 1180–1800) betreffen Personen, die vor über 200 Jahren gelebt haben, teils mit Verweisen auf die Gemeinsame Normdatei (GND), das Historische Lexikon der Schweiz und die Personendatenbank der Rechtsquellen. Die Seiten der Eheeinträge und der edierten Stücke sind für Suchmaschinen gesperrt.

## 13. Ihre Rechte

Sie können Auskunft über die Sie betreffenden Personendaten verlangen (Art. 25 DSG) sowie die Berichtigung unrichtiger Daten, und der Bearbeitung oder Bekanntgabe widersprechen bzw. ihre Löschung verlangen (Art. 30 und 32 DSG); soweit die DSGVO anwendbar ist, gelten deren Betroffenenrechte. Sie können sich ausserdem an den EDÖB wenden.

**So gehen Sie vor:** Schreiben Sie an die Adresse in Abschnitt 14 und nennen Sie die Seite (Permalink, Signatur oder Suche) und Ihr Anliegen. Es ist kostenlos; eine Antwort erhalten Sie in der Regel innert 30 Tagen. Für eine Auskunft kann ein Nachweis Ihrer Identität nötig sein. Ist ein Anliegen begründet, werden die Angaben auf der Plattform berichtigt oder entfernt, auch aus Suche und Schnittstellen; auf bereits bezogene Kopien und auf die Speicher von Suchmaschinen und KI-Anbietern hat der Betreiber keinen unmittelbaren Einfluss.

Angehörige können sich ebenso melden, wenn Angaben über Verstorbene sie verletzen. Anliegen, die die Originale und deren Publikation betreffen, richten Sie zusätzlich an das [Staatsarchiv des Kantons Zürich](https://www.zh.ch/staatsarchiv) bzw. bei den Spätbeständen an die publizierende Behörde: Was dort bestehen bleibt, ist dort weiterhin einsehbar.

## 14. Kontakt

Fragen zum Datenschutz und zu Ihren Rechten an Tim Rüdiger: <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>.

## 15. Änderungen

Diese Erklärung kann bei Änderungen des Dienstes oder der Rechtslage angepasst werden; es gilt die hier publizierte Fassung.
