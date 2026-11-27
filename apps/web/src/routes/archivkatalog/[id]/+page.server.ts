// Seite einer Verzeichnungseinheit des Archivkatalogs (/archivkatalog/<Katalog-ID>):
// Kopf mit Archivplan-Kontext (Pfad, Nachbarn derselben Stufe, Position), veröffentlichte
// Abschnitte des Online-Katalogs, Digitalisat-Links, Plattform-Dokument, die Untereinheiten
// als Archivbaum und die erkannten Namen (Personen, Orte, Organisationen, mit der Zahl der
// Einheiten gleichen Namens; Register) und Querverweise auf Editionen (QZH, Zürcher
// Rechtsquellen: Stücke mit dieser Katalog-ID als Vorlage; bei Ratsmanual-Sitzungen die
// edierten Einträge der Sitzung).
// Auch Stufen, die bisher nur aus Pfaden bekannt sind (`stub`), haben eine Seite.
// Eheeinträge der Ehedatenbank (Index `ehedaten`, Katalog-ID = ID) bekommen eine Ehe-Karte –
// auch, solange ihre Einheit im Katalog-Index fehlt (der Crawl holt die Ehedaten zuletzt):
// dann trägt die Ehedatenbank die Seite allein. Darunter die übrigen Einträge derselben Ehe
// (geprüfte Liste der Mehrfacheinträge) und ungeprüft weitere mit denselben Namen.
// Nicht für Suchmaschinen (Entscheid 2026-10-28): die Beschreibungen stehen schon im
// Online-Katalog des Staatsarchivs, Personendossiers sollen kein zweites Abbild
// bekommen.

import { error } from "@sveltejs/kit";
import { CATALOG_TREE_PAGE, catalogAncestors, digitalLinks } from "$lib/catalog";
import { catalogReady, existingCatalogIds, getCatalogChildren, getCatalogDetail, getCatalogNeighbors } from "$lib/server/catalog";
import { unitEntities } from "$lib/server/catalogRegister";
import { ehedatenReady, ehedatenRelated, getEhedatenEntry, type EhedatenRelated } from "$lib/server/ehedaten";
import { editionLinksForCatalog, withOwnPages } from "$lib/server/editionLinks";
import type { UnitEntities } from "$lib/catalogRegister";
import type { PageServerLoad } from "./$types";

const NO_ENTITIES: UnitEntities = { person: [], place: [], org: [] };
const NO_RELATED: EhedatenRelated = { sameMarriage: null, sameCouple: [] };

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	if (!/^\d{1,9}$/.test(params.id)) error(404, "Verzeichnungseinheit nicht gefunden");
	const [catalogOk, ehedatenOk] = await Promise.all([catalogReady(), ehedatenReady()]);
	if (!catalogOk && !ehedatenOk) error(503, "Der Archivkatalog ist zurzeit nicht verfügbar.");
	const id = Number(params.id);
	const [unit, ehe] = await Promise.all([catalogOk ? getCatalogDetail(id) : null, ehedatenOk ? getEhedatenEntry(id) : null]);
	if (!unit && !ehe) error(404, "Verzeichnungseinheit nicht gefunden");
	setHeaders({ "x-robots-tag": "noindex, follow" });
	const fromSearch = url.searchParams.get("from");

	if (!unit) {
		// Nur aus der Ehedatenbank: Kopf aus dem Eintrag, ohne Archivplan und Abschnitte.
		const e = ehe!;
		return {
			unit: {
				id: e.id,
				signature: e.signatur,
				title: e.titel,
				level: "Eheeintrag",
				dateText: e.datum,
				bestand: null,
				provenienz: null,
				text: null,
				sections: null,
				hasDigitization: false,
				files: [],
				fileCount: 0,
				stub: false,
				doc: null,
			},
			path: [],
			known: [],
			children: { total: 0, items: [] },
			neighbors: null,
			entities: NO_ENTITIES,
			fromSearch,
			ehe: e,
			...(await ehedatenRelated(e)),
			editions: await withOwnPages(editionLinksForCatalog(e.id)),
			catalogMissing: true,
		};
	}

	// Pfad von der Wurzel bis zur Elternstufe.
	const path = catalogAncestors(id, unit.path);
	const linkIds = (unit.sections ?? []).flatMap((s) => s.fields.flatMap((f) => (f.links ?? []).flatMap((l) => (l.id != null ? [l.id] : []))));
	// Nachbarn nur mit `sigPos` im Index (ab dem ersten Nachladen mit Position), vorher nur der Pfad.
	const pos = unit.sigPos ?? 0;
	const [known, children, neighbors, entities, related] = await Promise.all([
		existingCatalogIds([...path.map((n) => n.id), ...linkIds]),
		unit.childCount === 0 ? Promise.resolve({ total: 0, items: [] }) : getCatalogChildren(id, 0, CATALOG_TREE_PAGE),
		unit.parentId != null && pos > 0 ? getCatalogNeighbors(unit.parentId, pos) : Promise.resolve(null),
		unitEntities(unit),
		ehe ? ehedatenRelated(ehe) : Promise.resolve(NO_RELATED),
	]);

	return {
		unit: {
			id: unit.id,
			signature: unit.signature ?? "",
			title: unit.title ?? "",
			level: unit.level ?? "",
			dateText: unit.dateText ?? "",
			bestand: unit.bestand ?? null,
			provenienz: unit.provenienz ?? null,
			// Ohne `sections` (Index vor dem Neuaufbau) zeigt die Seite den gekürzten Text.
			text: unit.text ?? null,
			sections: unit.sections ?? null,
			hasDigitization: !!unit.hasDigitization,
			files: digitalLinks(unit.files ?? []),
			fileCount: unit.fileCount ?? unit.files?.length ?? 0,
			stub: unit.stub === true,
			// own: die Einheit bildet das Dokument ab; sonst verweist sie per Weblink darauf.
			doc: unit.docId && unit.docSeries ? { series: unit.docSeries, id: unit.docId, own: unit.onPlatform === true } : null,
		},
		path,
		known: [...known],
		children,
		neighbors,
		entities,
		fromSearch,
		ehe,
		...related,
		editions: await withOwnPages(editionLinksForCatalog(unit.id, unit.onPlatform === true && unit.docSeries === "RM" ? unit.docId : null)),
		catalogMissing: false,
	};
};
