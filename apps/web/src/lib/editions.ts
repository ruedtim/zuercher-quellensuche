/**
 * Editionen des Staatsarchivs: Nennung und Lizenz je Edition (EDITIONS, Single Source für
 * Reiter «Editionen», Detailseiten, API und Querverweise) und die Querverweise auf QZH
 * (Quellen zur Zürcher Geschichte) und Zürcher Rechtsquellen (SSRQ ZH). Die Liste
 * (server/data/edition-links.json) baut services/catalog (`main.ts editionen`): Katalog-ID
 * der Vorlage → Stück, Ratsmanual-Sitzung der Plattform → Stück, dessen Eintrag in ihr steht.
 * Die Texte der QZH liegen im Index `editions` (editionTexts.ts); ein Querverweis zeigt dann
 * auf die eigene Detailseite, der Permalink der Edition steht daneben.
 *
 * Lizenz je Edition (nicht die Public Domain Mark der Plattform): Die Liste übernimmt
 * nur Zitierform, Permalink und bei Ratsmanual-Verweisen den Titel des Stücks; beim
 * Link stehen Nennung und Lizenz der Edition. Rein und ohne Server-Abhängigkeit
 * (auch im Browser), unit-getestet in editions.test.ts.
 *
 * Seit 2026-11 liegen auch die Texte der Rechtsquellen im Index `editions`: ein Dokument je
 * Stück, die Liste führt aber jeden Text (Grundtext `…_047_1`, weitere Überlieferung `…_047_2`)
 * – pieceIdOf bildet den Text auf sein Stück ab.
 */

export type EditionKey = "qzh" | "ssrq";

export interface EditionInfo {
	/** Name der Edition. */
	name: string;
	/** Kurzname in Facette, Liste und Zitat. */
	short: string;
	/** Vorspann des Verweises: «Ediert in QZH: QZH_401», «Rechtsquellen: SSRQ ZH NF II/3 Nr. 40». */
	heading: string;
	/** Nennung, wie die Lizenz sie verlangt. */
	attribution: string;
	license: string;
	licenseUrl: string;
	/** Startseite der Edition. */
	home: string;
	/** Rechte an den Abbildungen, wenn sie andere sind als die der Editionsdaten. */
	images?: { label: string; url: string };
	/** Rohdaten (TEI) der Edition. */
	repo?: string;
	/** Laufnummern zählen je Edition («QZH_401») oder je Teil (Rechtsquellen: je Band). */
	numbering: "edition" | "part";
	/** Bezeichnung eines Teils in Facette und Kopf («Teil», «Band»). */
	partLabel: string;
	/** Ein Satz zum Inhalt für Werkzeug-Beschreibungen und Hinweise (MCP, API). */
	about: string;
}

export const EDITIONS: Readonly<Record<EditionKey, EditionInfo>> = {
	qzh: {
		name: "Quellen zur Zürcher Geschichte",
		short: "QZH",
		heading: "Ediert in QZH",
		attribution: "Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH)",
		license: "CC BY 4.0",
		licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
		home: "https://qzh.sources-online.org",
		// «Alle Abbildungen der Dokumente und Akten sind gemeinfrei» (qzh.sources-online.org, Über QZH).
		images: { label: "gemeinfrei", url: "https://creativecommons.org/publicdomain/mark/1.0/deed.de" },
		repo: "https://github.com/stazh/qzh-data",
		numbering: "edition",
		partLabel: "Teil",
		about:
			"Quellen zur Zürcher Geschichte (qzh): 790 Stücke 1275–1795, davon 705 Täuferquellen 1530–1609 (Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5), dazu «Gelebte Reformation. Zürich 1500–1800», Territorienbildung im Spätmittelalter und Transkriptionen des Staatsarchivs",
	},
	ssrq: {
		name: "Zürcher Rechtsquellen",
		short: "SSRQ ZH",
		heading: "Rechtsquellen",
		attribution:
			"Sammlung Schweizerischer Rechtsquellen (Rechtsquellenstiftung des Schweizerischen Juristenvereins), Zürcher Rechtsquellen online, Staatsarchiv des Kantons Zürich",
		// CC BY 4.0: wie der SSRQ-Schnappschuss auf Zenodo
		// (10878757, docs/editionen-ausbau-plan.md §2.1). Die Seite «Über die Edition» im Repo
		// (about/about-the-edition-de.xml, Stand 2024) nennt noch CC BY-NC-SA.
		license: "CC BY 4.0",
		licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
		home: "https://rechtsquellen.sources-online.org",
		repo: "https://github.com/stazh/erqzh-data",
		numbering: "part",
		partLabel: "Band",
		about:
			"Zürcher Rechtsquellen (ssrq, Sammlung Schweizerischer Rechtsquellen): 897 Stücke 1180–1800 aus fünf Bänden – Stadt und Territorialstaat Zürich 1460 bis Reformation, Gedruckte Mandate 1525–1798, Stadt Winterthur bis 1550, Landvogtei Greifensee, Obervogteien um Zürich: Satzungen, Offnungen, Urkunden, Mandate, Gerichtsfälle",
	},
};

/** Ein Verweis, wie Seiten und API ihn zeigen. */
export interface EditionLink {
	edition: EditionKey;
	/** Text der Edition (Dateiname): «QZH_401», «SSRQ_ZH_NF_II_3_047_2». */
	id: string;
	/** Zitierform des Stücks. */
	label: string;
	/** Seite des Stücks in der Edition. */
	url: string;
	/** Weitere Überlieferung: das Stück ist aus einer anderen Vorlage ediert. */
	witness: boolean;
	/** Titel des Stücks (bei Ratsmanual-Verweisen und Einheiten mit mehreren Stücken). */
	title: string | null;
	/** Detailseite auf der Plattform (Reiter «Editionen»), wenn das Stück im Index liegt. */
	own?: string;
}

/** Form der committeten Liste (ohne `meta`). */
export interface EditionLinksData {
	texts: Record<string, { edition: EditionKey; label: string; url: string; witness?: boolean; title?: string }>;
	catalog: Record<string, string[]>;
	rm: Record<string, string[]>;
}

export interface EditionLinksIndex {
	/** Stücke, die diese Verzeichnungseinheit edieren (Katalog-ID der Vorlage). */
	forCatalog(id: number): EditionLink[];
	/** Stücke, deren Eintrag in dieser Ratsmanual-Sitzung steht. */
	forDocument(id: string): EditionLink[];
	/** Ratsmanual-Sitzungen der Plattform, in denen der Eintrag dieses Stücks steht. */
	documentsFor(textId: string): string[];
}

const EMPTY: EditionLinksIndex = { forCatalog: () => [], forDocument: () => [], documentsFor: () => [] };

const isKey = (v: unknown): v is EditionKey => v === "qzh" || v === "ssrq";
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https:\/\/[^\s"<>]+$/.test(v);

/**
 * Liste prüfen und nachschlagbar machen. Ungültige Texte (unbekannte Edition, Link
 * nicht https) fallen weg, eine unlesbare Liste ergibt einen leeren Index – Verweise
 * sind Beigabe, die Seiten laufen ohne sie.
 */
export function indexEditionLinks(raw: unknown): EditionLinksIndex {
	if (!raw || typeof raw !== "object") return EMPTY;
	const data = raw as Partial<EditionLinksData>;
	if (!data.texts || typeof data.texts !== "object") return EMPTY;
	const texts = new Map<string, EditionLink>();
	for (const [id, t] of Object.entries(data.texts)) {
		if (!t || !isKey(t.edition) || typeof t.label !== "string" || !t.label || !isUrl(t.url)) continue;
		texts.set(id, {
			edition: t.edition,
			id,
			label: t.label,
			url: t.url,
			witness: t.witness === true,
			title: typeof t.title === "string" && t.title ? t.title : null,
		});
	}
	const resolve = (ids: unknown): EditionLink[] => {
		if (!Array.isArray(ids)) return [];
		const out: EditionLink[] = [];
		for (const id of ids) {
			const link = typeof id === "string" ? texts.get(id) : undefined;
			if (link && !out.some((l) => l.id === link.id)) out.push(link);
		}
		return out;
	};
	const catalog = data.catalog && typeof data.catalog === "object" ? data.catalog : {};
	const rm = data.rm && typeof data.rm === "object" ? data.rm : {};
	const docsByText = new Map<string, string[]>();
	for (const [doc, ids] of Object.entries(rm)) {
		if (!Array.isArray(ids)) continue;
		for (const id of ids) if (typeof id === "string" && texts.has(id)) docsByText.set(id, [...(docsByText.get(id) ?? []), doc]);
	}
	return {
		forCatalog: (id) => (Number.isInteger(id) && Object.hasOwn(catalog, String(id)) ? resolve(catalog[String(id)]) : []),
		forDocument: (id) => (Object.hasOwn(rm, id) ? resolve(rm[id]) : []),
		documentsFor: (textId) => [...(docsByText.get(textId) ?? [])].sort(),
	};
}

/** Verweise zusammenführen: Reihenfolge der Quellen, jedes Stück einmal (Grundtext vor
 *  weiterer Überlieferung desselben Stücks). */
export function mergeEditionLinks(...lists: EditionLink[][]): EditionLink[] {
	const out: EditionLink[] = [];
	for (const link of lists.flat()) {
		const same = out.findIndex((l) => l.url === link.url);
		if (same < 0) out.push(link);
		else if (out[same].witness && !link.witness) out[same] = link;
	}
	return out;
}

/** Stück eines Textes der Liste: Rechtsquellen ohne Textnummer («SSRQ_ZH_NF_II_3_047_2» ⇒
 *  «SSRQ_ZH_NF_II_3_047»), QZH unverändert. */
export function pieceIdOf(edition: EditionKey, textId: string): string {
	if (edition !== "ssrq") return textId;
	return /^(SSRQ_ZH_(?:NF|AF)_[IVX]+(?:_\d{1,2}){0,2}_\d{3})(?:_\d{1,2})?$/.exec(textId)?.[1] ?? textId;
}

/** Editionen in der Reihenfolge der Verweise, je einmal – für die Lizenzzeile. */
export function editionsOf(links: readonly EditionLink[]): EditionKey[] {
	return [...new Set(links.map((l) => l.edition))];
}
