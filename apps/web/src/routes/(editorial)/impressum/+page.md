<script lang="ts">
	import { SITE_NAME, SITE_SUBTITLE, SOURCE_REPO_URL } from "$lib/site";
	import { CONTACT_EMAIL } from "$lib/contact";
</script>

<svelte:head>
	<title>Impressum | {SITE_NAME}</title>
	<meta name="description" content="Impressum der {SITE_NAME}, eines privaten Projekts von Tim Rüdiger: Betrieb, Datengrundlage, Lizenzen und Haftung." />
</svelte:head>

# Impressum

*Stand: 25. November 2026*

## Betrieb und Verantwortung

- **Betreiber:** Tim Rüdiger
- **E-Mail:** <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>

Die {SITE_NAME} – «{SITE_SUBTITLE}» (%SITE_HOST%) – ist ein inoffizieller Prototyp, um die Grenzen des Möglichen für eine digitale Nutzungsplattform des Staatsarchivs auszuloten. Betrieben wird die Seite privat von Tim Rüdiger; sie ist **kein Angebot** des Staatsarchivs oder des Kantons Zürich. Inhalte und Funktionen können sich ändern. Massgeblich sind die Originale und die Publikationen der unten genannten Stellen.

Ein komplett gevibecodetes Projekt – aber mit sehr, sehr viel Herzblut und Schweiss.

## Datengrundlage

- **Digitalisierte Altbestände** (Offizielle Gesetzessammlung 1803–1998, Kantonsratsprotokolle und Regierungsratsbeschlüsse bis 1995, Amtsblatt): Editionen des Staatsarchivs des Kantons Zürich, publiziert als Open Government Data ([Datensätze auf opendata.swiss](https://opendata.swiss/de/organization/staatsarchiv-des-kantons-zuerich)).
- **Kantonsratsprotokolle ab Mai 1995:** Gever-Web-Service des Kantonsrats.
- **Regierungsratsbeschlüsse ab Oktober 2008:** Open Data von zh.ch (Regierungsrat).
- **Offizielle Gesetzessammlung ab 1999:** ZH-Lex (Staatskanzlei).
- **Archivkatalog:** Verzeichnungseinheiten aus dem [Online-Archivkatalog](https://suche.staatsarchiv.djiktzh.ch) des Staatsarchivs des Kantons Zürich, abgerufen vom 10. Juni bis 9. November 2026 (siehe [Archivkatalog](/about/archivkatalog)).
- **Ehedaten 1524–1800:** «Zürcher Ehedaten 16.–18. Jahrhundert» des Staatsarchivs des Kantons Zürich, Eheeinträge aus dem [Online-Archivkatalog](https://suche.staatsarchiv.djiktzh.ch) (Stand 9. November 2026; als Datensatz auch auf [Zenodo](https://doi.org/10.5281/zenodo.11191059)), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de).
- **Ratsmanuale 1484–1798** (StAZH B II): maschinelle Transkription (HTR) des Staatsarchivs des Kantons Zürich auf der Plattform Transkribus, gegliedert in Sitzungen; Personen, Orte und Organisationen automatisch erkannt. Die Faksimiles sind Digitalisate des Staatsarchivs und werden vom Transkribus-Bildserver der READ-COOP SCE mbH (Innsbruck, Österreich) geladen.
- **Editionen:** [Quellen zur Zürcher Geschichte (QZH)](https://qzh.sources-online.org) des Staatsarchivs des Kantons Zürich: Texte, Anmerkungen, Kommentare, Register und Schlagwörter aus den TEI-Daten der Edition ([stazh/qzh-data](https://github.com/stazh/qzh-data)), Editionsdaten [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de); Abbildungen gemeinfrei, geladen vom Bildserver der Edition (media.sources-online.org), einzelne Seiten von [e-manuscripta.ch](https://www.e-manuscripta.ch) (Zentralbibliothek Zürich). [Zürcher Rechtsquellen](https://rechtsquellen.sources-online.org) der Sammlung Schweizerischer Rechtsquellen (Rechtsquellenstiftung des Schweizerischen Juristenvereins) mit dem Staatsarchiv des Kantons Zürich: Texte, Anmerkungen, Kommentare, Register und Schlagwörter aus den TEI-Daten der Kopie des Staatsarchivs ([stazh/erqzh-data](https://github.com/stazh/erqzh-data), Stand 2024), Editionsdaten [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de); Abbildungen vom Bildserver der Edition (media.sources-online.org), Vorlagen aus dem Staatsarchiv und weiteren Archiven (Nachweis beim Bild).
- **Personen in den Kantonsratsprotokollen:** [Kantonsratsmitglieder ab 1803](https://www.zh.ch/de/politik-staat/wahlen-abstimmungen/kantons-regierungsratswahlen/mitglieder-kantonsrats-ab-1803.html) (Staatsarchiv und Statistisches Amt des Kantons Zürich, Open Government Data), Verknüpfungen aus [Wikidata](https://www.wikidata.org) (CC0), Porträts von [Wikimedia Commons](https://commons.wikimedia.org) – mit eigener Lizenz, die beim jeweiligen Bild angegeben ist – sowie aus der Fotodokumentation des Tages-Anzeigers im Staatsarchiv ([Bestand Z 1114, Tamedia AG](https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=4997968); Fotograf:in und Signatur beim jeweiligen Bild).
- **Schriften:** Titel in Bebas Neue von Ryoichi Tsunekawa (Dharma Type), [SIL Open Font License 1.1](/fonts/BebasNeue-OFL.txt); Editionstexte in Junicode von Peter S. Baker, [SIL Open Font License 1.1](/fonts/Junicode-OFL.txt). Beide werden vom eigenen Server geladen.

## Lizenz

**Quellentexte und Metadaten** der zentralen Serien (Amtsblatt, Kantonsratsprotokolle, Gesetzessammlung, Regierungsratsbeschlüsse) und der Ratsmanuale sind amtliche Erlasse, Entscheidungen und Protokolle von Behörden und damit urheberrechtlich nicht geschützt ([Art. 5 des Bundesgesetzes über das Urheberrecht, URG](https://www.fedlex.admin.ch/eli/cc/1993/1798_1798_1798/de#art_5)). Sie tragen – soweit nicht anders vermerkt – die [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/deed.de) (gemeinfrei) und dürfen ohne Einschränkung genutzt, vervielfältigt, bearbeitet und weiterverbreitet werden. Um eine Quellenangabe wird gebeten, z. B. «Staatsarchiv des Kantons Zürich, Signatur, abgerufen über %SITE_HOST%» (bei den Spätbeständen Kantonsrat, Regierungsrat bzw. Staatskanzlei des Kantons Zürich).

Ausgenommen sind:

- **Faksimiles der Ratsmanuale:** keine Rechtekennzeichnung, Nachweis «Digitalisat: Staatsarchiv des Kantons Zürich, StAZH B II …».
- **[Archivkatalog](/about/archivkatalog):** Die Beschreibungen stammen vom Staatsarchiv; die Plattform macht zu ihnen keine Lizenzangabe. Zitiert wird mit Signatur und Permalink.
- **[Ehedaten](/about/ehedaten):** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de); bei Weitergabe zu nennen als «Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16.–18. Jahrhundert».
- **[Editionen](/about/editionen):** eigene Lizenz je Edition, beide [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de). Zu nennen sind die Quellen zur Zürcher Geschichte als «Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH)» mit der Kennung des Stücks (ihre Abbildungen sind gemeinfrei) und die Zürcher Rechtsquellen als «Sammlung Schweizerischer Rechtsquellen (Rechtsquellenstiftung des Schweizerischen Juristenvereins), Zürcher Rechtsquellen online, Staatsarchiv des Kantons Zürich» mit der Zitierform des Stücks (etwa «SSRQ ZH NF II/3 Nr. 47»). Nennung und Lizenz stehen bei jedem Stück und Verweis.
- **Porträts:** Lizenz bzw. Nachweis beim jeweiligen Bild.

Die Plattform selbst (Gestaltung und eigene Texte, ohne Icon und Vorschaubild) steht unter [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de), der <a href={SOURCE_REPO_URL} rel="external">Quellcode</a> unter der [MIT-Lizenz](https://opensource.org/license/mit).

## Haftung

Die Inhalte werden mit Sorgfalt zusammengestellt, teils aber automatisch erzeugt (Texterkennung, Handschriftenerkennung, Namenserkennung, Zuordnung von Personen) und können Fehler enthalten. Für Richtigkeit, Vollständigkeit, Aktualität und Verfügbarkeit wird keine Gewähr übernommen. Rechtlich massgebend ist bei Erlassen und amtlichen Mitteilungen allein die amtliche Publikation. Für Inhalte verlinkter Seiten sind deren Betreiber verantwortlich. Hinweise auf Fehler bitte über «Feedback» oder die Adresse oben.

## Datenschutz

Umgang mit Personendaten, Berichtigung und Löschung: siehe [Datenschutzerklärung](/datenschutz).
