// Schlanke Trefferform des MCP-Servers: eine PROJEKTION über die Mapper von
// `/api/v1` (toListHit, toCatalogItem, toEhedatenItem, toEditionListItem), KEINE
// zweite Allowlist. Jede Funktion hier nimmt das fertige, allowlist-gemappte
// Objekt und lässt weg, rundet oder fasst zusammen – was die Allowlist nicht
// hergibt, kann hier nicht entstehen (die Sicherheits-Invariante von respond.ts
// gilt unverändert weiter, es bleibt eine Allowlist zu auditieren). `/api/v1`
// ruft dieses Modul nie auf und antwortet darum byte-identisch wie vorher.
//
// Warum: Das Kontextfenster des Assistenten ist die knappe Ressource – was an
// Ballast mitreist, verdrängt Treffer. Gemessen 2026-11-17 trug EIN
// Katalogtreffer 1'799 Zeichen, davon bis zu 1'500 allein der Archivplan-Pfad
// als Array mit Label und voller URL je Stufe (bis 12 Stufen).
//
// Drei Regeln, überall gleich:
//  1. Leere Werte (null, "", [], {}, false) fallen weg statt mitzureisen. Dass
//     ein fehlendes Feld «leer» und nicht «unbekannt» heisst, sagt die
//     Beschreibung von `verbose` im Tool-Schema – einmal je Sitzung statt in
//     jeder Antwort.
//  2. Was sich aus einem anderen Feld ergibt, fällt weg: `links.self` (die
//     `/api/v1`-Route – MCP-Klienten haben dafür die Werkzeuge), `links.catalog`
//     bzw. `links.edition` (= `url`), `links.web` (= `url` bei Dokumenten; bei
//     Katalog und Ehedaten die Plattformseite, die bis zum Launch hinter dem
//     Basic-Auth-Gate liegt), `dateYear` neben `date`, `yearFrom`/`yearTo`
//     neben `from`/`to`, Vor- und Nachname neben `name`.
//  3. Der Archivplan-Pfad wird ein lesbarer String (`pathText`), die Stufen
//     ohne IDs und URLs: «Sammlungen › PLAN Karten und Pläne › PLAN H Ausland».
//
// Nicht gespart wird an `url`, Signatur (`stazhIdent`/`signature`), Titel,
// Datum, Bestand, Digitalisat-Hinweis sowie Lizenz und Nennung, wo sie
// vorgeschrieben sind (Ehedaten CC BY 4.0, Editionen je Edition).
//
// `verbose=true` liefert bei catalog_search, ehedaten_search und edition_search
// weiter die vollen Strukturen. Bewusst ein Schalter und kein `fields`-Parameter:
// die schlanke Form ist eine kuratierte Auswahl mit eigenen Feldern (`pathText`
// statt `path`), die sich nicht aus Feldnamen zusammensetzen lässt; ein
// `fields`-Parameter bräuchte zudem je Werkzeug eine Werte-Liste im Schema –
// Token, die jede Sitzung einmal bezahlt, plus Fehlerpfade für ungültige Namen.
// So bleiben genau zwei Formen zu testen und zu dokumentieren.
//
// Pur ($env-frei, nur relative Importe) ⇒ unit-getestet in ../mcp.test.ts.

import { splitCatalogLabel, CATALOG_IN_PROGRESS, CATALOG_COMPLETE_BY } from "../../catalog";
import { EDITIONS, type EditionKey } from "../../editions";

type Obj = Record<string, unknown>;

/** Schema-Baustein `verbose` für die Werkzeuge mit reicher Struktur (catalog_search,
 *  ehedaten_search, edition_search). */
export const verboseParam = {
	type: "boolean",
	description:
		"Trefferform. Default false (schlank, spart im Kontext rund zwei Drittel je Treffer): LEERE FELDER FEHLEN " +
		"(ein fehlendes Feld heisst leer bzw. nein, nicht «unbekannt»), der Archivplan-Pfad steht als lesbarer " +
		"String in pathText («Sammlungen › PLAN Karten und Pläne › PLAN H Ausland»), Links, die sich aus url " +
		"ergeben, fehlen. true = volle Struktur wie in /api/v1 (path mit IDs und URLs, alle Link-Bündel, leere " +
		"Felder als null) – nötig, wenn du die Archivplan-IDs oder die Plattform-Links selbst brauchst.",
};

/** Leer heisst: null/undefined, leerer String, leeres Array, leeres Objekt, false. */
function isEmpty(value: unknown): boolean {
	if (value === null || value === undefined || value === "" || value === false) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object") return Object.keys(value as Obj).length === 0;
	return false;
}

/** Leere Felder weglassen (Reihenfolge der übrigen bleibt). */
function compact(obj: Obj): Obj {
	const out: Obj = {};
	for (const [key, value] of Object.entries(obj)) if (!isEmpty(value)) out[key] = value;
	return out;
}

/** Score auf 4 Stellen: Meili liefert 16 Nachkommastellen, die kein Modell braucht. */
function roundScore(obj: Obj): void {
	if (typeof obj.score === "number") obj.score = Math.round(obj.score * 10000) / 10000;
}

/** `{text, from, to, yearFrom, yearTo, calendar?}` → ohne die Jahre (stehen in from/to)
 *  und ohne `to`, wenn es `from` wiederholt (ein-Tag-Daten). */
function leanDate(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const date = { ...(value as Obj) };
	delete date.yearFrom;
	delete date.yearTo;
	if (date.to != null && date.to === date.from) delete date.to;
	return compact(date);
}

// --- Dokumente (search, semantic_search, keyword_search, similar_documents, overview) ---

/**
 * Treffer aus `toListHit` + `url` schlank: ohne `links` (self = `/api/v1`-Route,
 * web = `url`), ohne `dateYear` neben `date`, mit gerundetem Score, ohne leere
 * Nummern-Felder (volumeNr, serialNr, resolutionId, startPg, subset) – was gesetzt
 * ist, bleibt: `stazhIdent` und `resolutionId` sind Zitat-Angaben.
 */
export function leanListHit(full: Obj): Obj {
	const out = { ...full };
	delete out.links;
	if (out.date != null) delete out.dateYear;
	roundScore(out);
	return compact(out);
}

// --- Archivkatalog (catalog_search) ------------------------------------------

/** Archivplan-Pfad als Pfeil-Kette ohne IDs, URLs, Stufen und Zeiträume der Stufen
 *  (`splitCatalogLabel`, dieselbe Zerlegung wie der Archivplan-Kontext der Website). */
export function catalogPathText(path: unknown): string {
	if (!Array.isArray(path)) return "";
	return path
		.map((node) => (node && typeof node === "object" ? String((node as Obj).label ?? "") : ""))
		.map((label) => (label ? splitCatalogLabel(label).name : ""))
		.filter(Boolean)
		.join(" › ");
}

/**
 * Verzeichnungseinheit aus `toCatalogItem(…, {full: false})` schlank: `path` wird
 * `pathText`, das Plattform-Dokument behält id/series/relation (damit ein Modell es
 * mit `fetch` holen kann), `links` fällt weg (self = `/api/v1`, catalog = `url`,
 * web = Plattformseite hinter dem Gate), `fileCount` nur, wenn es nicht einfach die
 * Länge von `files` ist, und `dateFrom`/`dateTo` nur, wenn sie mehr sagen als
 * `dateText`. Signatur, Titel, Stufe, Datum, Bestand, Digitalisat und Permalink bleiben.
 */
export function leanCatalogItem(full: Obj): Obj {
	const out: Obj = {};
	for (const [key, value] of Object.entries(full)) {
		if (key === "path") {
			out.pathText = catalogPathText(value);
			continue;
		}
		if (key === "links") continue;
		if (key === "document" && value && typeof value === "object") {
			const doc = value as Obj;
			out.document = compact({ id: doc.id, series: doc.series, relation: doc.relation });
			continue;
		}
		out[key] = value;
	}
	// Einzelnes Jahr, das schon als dateText dasteht («1938»): die beiden Zahlen weglassen.
	if (out.dateFrom != null && out.dateFrom === out.dateTo && String(out.dateFrom) === out.dateText) {
		delete out.dateFrom;
		delete out.dateTo;
	}
	if (Array.isArray(out.files) && out.fileCount === out.files.length) delete out.fileCount;
	return compact(out);
}

// --- Ehedaten (ehedaten_search) ----------------------------------------------

/** Person des Eintrags ohne `firstName`/`lastName` (stehen in `name`), ohne leere Felder. */
function leanPerson(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const person = { ...(value as Obj) };
	delete person.firstName;
	delete person.lastName;
	return compact(person);
}

/** Übrige Einträge derselben Ehe: ohne `typeLabel`, `links.catalog` wird `url`. */
function leanSameMarriage(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const same = { ...(value as Obj) };
	if (Array.isArray(same.entries)) {
		same.entries = same.entries.map((entry) => {
			if (!entry || typeof entry !== "object") return entry;
			const e = { ...(entry as Obj) };
			const links = e.links as Obj | undefined;
			delete e.typeLabel;
			delete e.links;
			e.date = leanDate(e.date);
			if (links?.catalog) e.url = links.catalog;
			return compact(e);
		});
	}
	return same;
}

/**
 * Eheeintrag aus `toEhedatenItem` schlank: ohne `typeLabel` (die Werte `trauung`/
 * `verkuendung` sprechen für sich), ohne die Jahre im Datum, ohne Vor-/Nachnamen
 * neben `name`, ohne `links` (self = `/api/v1`, catalog = `url`, web = Plattformseite
 * hinter dem Gate). Signatur, Kirchenbuch (`volume`), Überlieferung (`source`) und
 * Kirchgemeinde bleiben – es sind auch die Filterwerte. Lizenz und Nennung stehen
 * wie bisher in der Antwort.
 */
export function leanEhedatenItem(full: Obj): Obj {
	const out = { ...full };
	delete out.typeLabel;
	delete out.links;
	out.date = leanDate(out.date);
	out.groom = leanPerson(out.groom);
	out.bride = leanPerson(out.bride);
	out.sameMarriage = leanSameMarriage(out.sameMarriage);
	return compact(out);
}

// --- Editionen (edition_search) ----------------------------------------------

/**
 * Stück aus `toEditionListItem` schlank: ohne `editionName` und die Lizenz-URLs
 * (stehen einmal je Edition in `rights` der Antwort), ohne die Jahre im Datum, ohne
 * `links` (self = `/api/v1`, edition = `url`, web = Plattformseite, iiifManifest
 * sagt `hasFacsimile` schon an). `license` und `attribution` bleiben an jedem Stück:
 * jede Edition hat ihre eigene, und ein zitiertes Stück muss sie tragen.
 */
export function leanEditionItem(full: Obj): Obj {
	const out = { ...full };
	delete out.editionName;
	delete out.licenseUrl;
	delete out.imagesLicenseUrl;
	delete out.links;
	out.date = leanDate(out.date);
	return compact(out);
}

/** Lizenz und Nennung je vorkommender Edition – einmal in der Antwort statt an jedem Stück. */
export function editionRights(keys: readonly string[]): Obj {
	const rights: Obj = {};
	for (const key of keys) {
		if (rights[key] || !(key in EDITIONS)) continue;
		const info = EDITIONS[key as EditionKey];
		rights[key] = compact({
			name: info.name,
			license: info.license,
			licenseUrl: info.licenseUrl,
			attribution: info.attribution,
			imagesLicense: info.images?.label,
			imagesLicenseUrl: info.images?.url,
		});
	}
	return rights;
}

// --- Knappe Hinweise für die MCP-Antworten -----------------------------------
//
// Eigene Texte, weil CATALOG_NOTE/EHEDATEN_NOTE/EDITIONS_NOTE in apiV1/constants.ts
// zur öffentlichen API gehören und dort unverändert bleiben. Jeder Vorbehalt der
// langen Fassung ist hier erhalten; weg sind Wiederholungen und Fundstellen, die ein
// Modell nicht braucht – dazu kommt die Regel, dass leere Felder fehlen.

export const MCP_CATALOG_NOTE =
	"Verzeichnungseinheiten des Online-Archivkatalogs des Staatsarchivs, ohne die, die die Plattform selbst " +
	"als Dokumente führt; zitieren mit Signatur und Permalink (url), die Plattform macht zu diesen Metadaten " +
	"keine Lizenzangabe." +
	(CATALOG_IN_PROGRESS
		? ` Der Katalog wird noch übernommen (bis ${CATALOG_COMPLETE_BY}); bis dahin fehlen Einheiten.`
		: "");

export const MCP_EHEDATEN_NOTE =
	"Eheeinträge der Zürcher Kirchenbücher 1524–1800 (Ehedatenbank des Staatsarchivs, übernommen aus dem " +
	"Online-Archivkatalog). Namen sind vereinheitlicht (Originalschreibung in note), Daten bis 1700 stehen im " +
	"alten Stil (julianisch, nicht umgerechnet). Ein Eintrag ist eine Trauung oder eine Verkündung (type); " +
	"Zählungen zählen Einträge, nicht Ehen. sameMarriage nennt die übrigen Einträge derselben Ehe aus der " +
	"geprüften Liste des Staatsarchivs – sie erfasst nur einen Teil der doppelt überlieferten Ehen. Bei " +
	"Weitergabe die Nennung (attribution) und die Lizenz angeben.";

export const MCP_EDITIONS_NOTE =
	"Stücke der Editionen des Staatsarchivs: Abschriften mit Regest, Kommentar und Anmerkungen der Bearbeitung. " +
	"license und attribution stehen an jedem Stück und gelten für die Editionsdaten, die Abbildungen haben " +
	"eigene Rechte (rights). text ist die Lesefassung wie in der Suche (Abkürzungen aufgelöst, ů → u, ß → ss). " +
	"Daten stehen wie in der Quelle (in Zürich bis 1700 alter Stil, nicht umgerechnet; calendar=julian, wo die " +
	"Edition es angibt). Rechtsquellen: ein Stück je Nummer eines Bandes (label «SSRQ ZH NF II/3 Nr. 47»), " +
	"weitere Überlieferungen nur beschrieben (witnesses).";
