// Querverweise auf Editionen (QZH, Zürcher Rechtsquellen) für Katalog- und
// Ratsmanual-Seiten und die API. Die Liste (data/edition-links.json, gebaut von
// services/catalog `main.ts editionen`) wird gebündelt und beim ersten Zugriff
// indexiert; `?raw` wie beim KRDB-Register, damit svelte-check keinen Literaltyp
// aus dem JSON ableitet. Ist sie kaputt, gibt es eben keine Verweise. Liegt ein
// Stück im Index `editions` (Reiter «Editionen»), zeigt der Verweis auf die eigene
// Detailseite (withOwnPages), der Permalink der Edition bleibt daneben.

import linksRaw from "./data/edition-links.json?raw";
import { indexEditionLinks, mergeEditionLinks, pieceIdOf, type EditionLink, type EditionLinksIndex } from "$lib/editions";
import { editionDocId, editionUnitPath, isIndexedEdition } from "$lib/editionTexts";
import { existingEditionIds } from "./editionTexts";

let index: EditionLinksIndex | undefined;

function load(): EditionLinksIndex {
	if (index) return index;
	try {
		index = indexEditionLinks(JSON.parse(linksRaw));
	} catch (err) {
		console.warn("[editionen] Liste nicht lesbar – keine Verweise:", err);
		index = indexEditionLinks(null);
	}
	return index;
}

/** Stücke zu einer Verzeichnungseinheit: über ihre Katalog-ID (ein Stück ohne Titel – die
 *  Seite trägt den eigenen; mehrere mit Titel, um sie zu unterscheiden) und, wenn sie eine
 *  Ratsmanual-Sitzung der Plattform abbildet, über deren Einträge (mit Titel: welcher
 *  Eintrag der Sitzung ediert ist). */
export function editionLinksForCatalog(id: number, rmDocId?: string | null): EditionLink[] {
	const s = load();
	// Zwei Überlieferungen desselben Stücks sind ein Verweis.
	const found = mergeEditionLinks(s.forCatalog(id));
	const own = found.length === 1 ? [{ ...found[0], title: null }] : found;
	return mergeEditionLinks(own, rmDocId?.startsWith("RM_") ? s.forDocument(rmDocId) : []);
}

/** Stücke, deren Eintrag in dieser Ratsmanual-Sitzung steht (andere Serien: keine). */
export function editionLinksForDocument(id: string): EditionLink[] {
	return id.startsWith("RM_") ? load().forDocument(id) : [];
}

/** Ratsmanual-Sitzungen der Plattform, in denen der Eintrag dieses Stücks steht (Detailseite). */
export function rmDocumentsForEditionText(textId: string): string[] {
	return load().documentsFor(textId);
}

/** So lange darf der Abgleich mit dem Index `editions` eine Seite aufhalten. */
const OWN_PAGES_BUDGET_MS = 1_000;

/**
 * Verweise mit der eigenen Detailseite (`own`), wenn das Stück im Index `editions` liegt.
 * Ohne lesbaren Index (Web vor dem Import deployt) oder nach Ablauf der Frist bleiben die
 * Verweise, wie sie sind – auf die Edition. Die Liste führt Texte, der Index Stücke: Bei den
 * Rechtsquellen zeigt auch eine weitere Überlieferung (`…_047_2`) auf die Seite ihres Stücks,
 * die alle Überlieferungen nennt; bei den QZH gibt es keine.
 */
export async function withOwnPages(links: EditionLink[]): Promise<EditionLink[]> {
	const pieceOf = (l: EditionLink) => pieceIdOf(l.edition, l.id);
	const candidates = links.filter((l) => isIndexedEdition(l.edition) && (!l.witness || l.edition === "ssrq"));
	if (candidates.length === 0) return links;
	const ids = [...new Set(candidates.map((l) => editionDocId(l.edition, pieceOf(l))))];
	const timeout = new Promise<Set<string>>((resolve) => setTimeout(() => resolve(new Set()), OWN_PAGES_BUDGET_MS));
	const found = await Promise.race([existingEditionIds(ids), timeout]);
	if (found.size === 0) return links;
	return links.map((l) => (candidates.includes(l) && found.has(editionDocId(l.edition, pieceOf(l))) ? { ...l, own: editionUnitPath(l.edition, pieceOf(l)) } : l));
}
