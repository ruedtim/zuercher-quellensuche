// Dokumentsuche, wie sie an den Browser geht: Titel und Auszug maskiert, ohne Volltext und interne
// Felder. Die Trefferliste setzt beide per {@html} – bis 2026-11 ungefiltert, Text aus amtlichen
// Quellen («<Volksrecht>», Adressen in spitzen Klammern) wurde so zu Markup. Pur → Test.

import type { DocumentHitView, DocumentMeta, DocumentResultView, SearchHit, SearchParams, SearchResponse } from "../types";
import { sanitizeMarks, trimCropMarks } from "./krdbPeople";
import { LIST_HIT_ATTRIBUTES } from "./apiV1/respond";

function toDocumentHit(hit: SearchHit): DocumentHitView {
	const marked = (html: string) => sanitizeMarks(html, { keepEntities: true });
	return {
		id: hit.id,
		series: hit.series,
		date: hit.date,
		stazhIdent: hit.stazhIdent,
		// Eine Projektion ohne Titel (nur Kennungen) darf die Seite nicht zur 500 machen.
		titleHtml: marked(hit._formatted?.title ?? hit.title ?? ""),
		textHtml: hit._formatted?.body ? trimCropMarks(marked(hit._formatted.body)) : null,
	};
}

export function documentResultView(result: SearchResponse): DocumentResultView {
	return { ...result, hits: result.hits.map(toDocumentHit) };
}

/**
 * Felder, die die Trefferliste aus Meili braucht. Den Volltext nur, wo der Server den Auszug selbst
 * schneidet (Thema allein oder mit ODER-Begriffen, Namensfilter); sonst kommt der Auszug fertig aus
 * Meili, und eine Seite mit langen Protokollen trüge Dutzende MB.
 */
export function listAttributes(
	params: Pick<SearchParams, "q" | "anyTerms" | "theme" | "persons" | "places" | "organizations">,
): string[] | undefined {
	// Ein einzelner ODER-Begriff gilt als Suchbegriff (foldSingleAnyTerm).
	const word = (params.q.trim() !== "" && params.anyTerms.length < 2) || params.anyTerms.length === 1;
	const serverCrop =
		(params.theme.trim() !== "" && !word) || params.persons.length + params.places.length + params.organizations.length > 0;
	return serverCrop ? undefined : LIST_HIT_ATTRIBUTES;
}

/** Angaben eines Dokuments für eine Seite: ohne Volltext, Namenslisten und interne Felder. */
export function documentMeta(doc: SearchHit): DocumentMeta {
	return {
		id: doc.id,
		series: doc.series,
		title: doc.title,
		date: doc.date,
		dateYear: doc.dateYear,
		startPg: doc.startPg,
		volumeNr: doc.volumeNr,
		serialNr: doc.serialNr,
		resolutionId: doc.resolutionId,
		stazhIdent: doc.stazhIdent,
		archiveLink: doc.archiveLink,
		manifestUrl: doc.manifestUrl,
		subset: doc.subset,
	};
}
