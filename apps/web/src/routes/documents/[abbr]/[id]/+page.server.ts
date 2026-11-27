import { error, redirect } from "@sveltejs/kit";
import { platformIdFallbacks } from "$lib/catalog";
import { fetchDocsByIds, findByArchiveIds, getDocument } from "$lib/server/meili";
import { docCountOf, krdbDocCountsNow, krdbPersonsFor, krdbStand } from "$lib/server/krdb";
import type { KrdbPersonView } from "$lib/server/krdbMatch";
import { personUrl } from "$lib/personUrls";
import { documentMeta } from "$lib/server/documentResult";
import { loadRenderedHtml } from "$lib/server/renderHtml";
import { rmBandFor } from "$lib/server/rmBands";
import { ratCouncilFor, ratMentionsFor } from "$lib/server/rat";
import { executeSearch } from "$lib/server/search";
import { parseSearchParams } from "$lib/searchParams";
import { docPayload } from "$lib/server/analytics/extract";
import { normalizeManifestUrlForUser } from "$lib/manifestUrl";
import { relationLabel } from "$lib/relations";
import { apiBaseUrl } from "$lib/server/apiV1/config";
import { documentCatalog } from "$lib/server/catalog";
import { editionLinksForDocument, withOwnPages } from "$lib/server/editionLinks";
import { ALL_SERIES, type DocRelation, type SearchParams, type SeriesAbbr } from "$lib/types";
import type { PageServerLoad } from "./$types";

/** Aufgelöster Querverweis fürs UI: interner Link wenn das Ziel im Korpus liegt,
 *  sonst nur der externe Katalog-Link (`url`). */
interface ResolvedRelation {
	label: string;
	internal: { id: string; series: SeriesAbbr; title: string; date: string | null } | null;
	url: string;
}

/**
 * Löst die Querverweise eines Dokuments auf interne Detailseiten auf: eine
 * Batch-Abfrage über alle `targetId`s gegen `archiveId`. Ziele ohne Korpus-
 * Treffer bleiben extern (Katalog-URL). Selbstverweise (Ziel == aktuelles Doc)
 * werden verworfen. Sortiert nach Label, damit gleiche Relationstypen
 * beieinanderstehen.
 */
async function resolveRelations(
	relations: DocRelation[] | undefined,
	selfId: string,
): Promise<ResolvedRelation[]> {
	if (!relations || relations.length === 0) return [];
	const ids = relations
		.map((r) => r.targetId)
		.filter((n): n is number => typeof n === "number");
	const found = ids.length ? await findByArchiveIds(ids).catch(() => []) : [];
	const byArchiveId = new Map<number, (typeof found)[number]>();
	for (const h of found) {
		if (typeof h.archiveId === "number") byArchiveId.set(h.archiveId, h);
	}
	const out: ResolvedRelation[] = [];
	for (const r of relations) {
		const hit = r.targetId != null ? byArchiveId.get(r.targetId) : undefined;
		if (hit && hit.id === selfId) continue; // Selbstverweis überspringen
		const internal = hit
			? { id: hit.id, series: hit.series, title: hit.title, date: hit.date }
			: null;
		out.push({ label: relationLabel(r.name), internal, url: r.url });
	}
	out.sort((a, b) => a.label.localeCompare(b.label, "de"));
	return out;
}

interface Neighbor {
	id: string;
	series: SeriesAbbr;
	pos: number;
}

// Nachbarn brauchen nur die Reihenfolge: ohne Volltexte (date, startPg und dateYear fürs Ordnen).
const NEIGHBOR_ATTRIBUTES = ["id", "series", "date", "dateYear", "startPg"];

interface Neighbors {
	prev: Neighbor | null;
	next: Neighbor | null;
	total: number;
	pos: number;
}

async function loadNeighbors(fromRaw: string | null, posRaw: string | null): Promise<Neighbors | null> {
	if (!fromRaw || !posRaw) return null;
	const pos = Number.parseInt(posRaw, 10);
	if (!Number.isFinite(pos) || pos < 0) return null;

	let fromUrl: URL;
	try {
		fromUrl = new URL(`http://x/?${fromRaw}`);
	} catch {
		return null;
	}
	const params: SearchParams = parseSearchParams(fromUrl);

	const pageOfPos = Math.floor(pos / params.pageSize) + 1;
	const indexInPage = pos % params.pageSize;

	// executeSearch = dieselbe Such-Logik wie die Trefferliste (inkl. Thema-
	// Filter und Auto-Top-K) – sonst stimmt die Hit-Reihenfolge zwischen
	// Trefferliste und Nachbar-Lookup nicht.
	// Nur die Folge, ohne Auszüge: Die Seite wird schon beim Überfahren eines Treffers vorgeladen.
	const opts = { lexicalStrict: true, attributesToRetrieve: NEIGHBOR_ATTRIBUTES, bare: true };
	const mainPage = await executeSearch({ ...params, page: pageOfPos }, opts);
	const hits = mainPage.hits;
	const total = mainPage.estimatedTotalHits;
	// Manche Pfade deckeln die durchblätterbare Menge (rankedPool, #113; browseLimit) –
	// dahinter gibt es keine Nachbarn, der Fetch der Folgeseite entfällt.
	const browsable = Math.min(
		total,
		mainPage.rankedPool ?? Number.POSITIVE_INFINITY,
		mainPage.browseLimit ?? Number.POSITIVE_INFINITY,
	);

	if (indexInPage >= hits.length) return { prev: null, next: null, total, pos };

	let prev: Neighbor | null = null;
	let next: Neighbor | null = null;

	if (indexInPage > 0) {
		const h = hits[indexInPage - 1];
		prev = { id: h.id, series: h.series, pos: pos - 1 };
	} else if (pageOfPos > 1) {
		const prevPage = await executeSearch({ ...params, page: pageOfPos - 1 }, opts);
		const last = prevPage.hits[prevPage.hits.length - 1];
		if (last) prev = { id: last.id, series: last.series, pos: pos - 1 };
	}

	if (indexInPage < hits.length - 1) {
		const h = hits[indexInPage + 1];
		next = { id: h.id, series: h.series, pos: pos + 1 };
	} else if (pos + 1 < browsable) {
		const nextPage = await executeSearch({ ...params, page: pageOfPos + 1 }, opts);
		const first = nextPage.hits[0];
		if (first) next = { id: first.id, series: first.series, pos: pos + 1 };
	}

	return { prev, next, total, pos };
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const series = params.abbr as SeriesAbbr;
	if (!ALL_SERIES.includes(series)) {
		throw error(404, "Unbekannte Serie");
	}

	const fromSearch = url.searchParams.get("from");
	const posParam = url.searchParams.get("pos");

	const [doc, rawHtml, neighbors] = await Promise.all([
		getDocument(params.id),
		loadRenderedHtml(series, params.id),
		loadNeighbors(fromSearch, posParam).catch(() => null),
	]);
	// Seitenwechsel als solche auszeichnen. Das aria-label aus dem Indexer fällt weg: auf <a> ohne
	// Ziel und auf dieser Rolle ist es unzulässig, vorgelesen wird die sichtbare Marke «[362]».
	const html =
		rawHtml?.replace(/<a class="tei-pb"([^>]*?) aria-label="[^"]*"/g, '<a class="tei-pb" role="doc-pagebreak"$1') ?? null;

	if (!doc) {
		// Katalog-Links vor dem Abgleich mit der Plattform (Index `catalog`, API) nennen die ID des
		// Weblinks: ohne «_t» bzw. Doppelbeschlüsse mit «_-_» ⇒ aufs Plattform-Dokument umleiten.
		const fallbacks = platformIdFallbacks(params.id);
		const found = fallbacks.length > 0 ? await fetchDocsByIds(fallbacks, ["id", "series"]).catch(() => []) : [];
		const alt = fallbacks.map((id) => found.find((h) => h.id === id)).find((h) => h !== undefined);
		if (alt) throw redirect(301, `/documents/${alt.series}/${encodeURIComponent(alt.id)}${url.search}`);
		throw error(404, "Dokument nicht gefunden");
	}

	// Localhost-Manifest-URLs (Indexer-Artefakt aus PUBLIC_BASE_URL=http://localhost:5173)
	// auf den aktuellen Origin umschreiben, damit der IIIF-Button öffentlich funktioniert.
	if (doc.manifestUrl) {
		doc.manifestUrl = normalizeManifestUrlForUser(doc.manifestUrl, url);
	}

	// Querverweise auf verwandte Dokumente auflösen (intern wenn im Korpus, sonst
	// externer Katalog-Link). Degradiert graceful auf [] bei Meili-Fehler.
	// Dazu der Katalogeintrag (Einheit mit Archivplan, verweisende Einheiten): null ohne
	// lesbaren Katalog, ohne Einheit im Index oder nach dem Zeitbudget – dann bleibt der
	// Link in den Online-Katalog.
	const [related, catalog] = await Promise.all([
		resolveRelations(doc.relations, doc.id).catch(() => []),
		documentCatalog(doc),
	]);

	// KRP: erwähnte Rats- und Regierungsmitglieder aus der Kantonsratsdatenbank
	// (Wikidata-Link, Porträt). Synchron und rein im Speicher; Fehler ⇒ keine Sektion.
	// Dazu Link auf die Personenseite und Dokumentzahl, sobald der Suchindex die
	// Zuordnung trägt (gecachter Wert, blockiert die Seite nie).
	let krdbPersons: Array<KrdbPersonView & { pageHref: string | null; docCount: number | null }> = [];
	try {
		const counts = krdbDocCountsNow();
		krdbPersons = krdbPersonsFor(doc).map((v) => {
			const n = docCountOf(counts, v.id);
			return { ...v, docCount: n, pageHref: n ? personUrl(v.id) : null };
		});
	} catch (err) {
		console.warn(`[krdb] Abgleich für ${doc.id} fehlgeschlagen:`, err);
	}

	locals.analytics.doc = docPayload(series, params.id, url);

	// Ratsmanuale: wer in diesem Amtshalbjahr im Rat sass (Register des Staatsarchivs), und die in der
	// Transkription mit GND ausgezeichneten Personen im Text (Karte beim Namen).
	const ratCouncil = ratCouncilFor(doc.id);
	const ratMentions = series === "RM" ? ratMentionsFor(html, ratCouncil) : [];

	return {
		doc: documentMeta(doc),
		// Stabile Adresse fürs Zitieren (PUBLIC_BASE_URL, nicht der Request-Origin).
		permalink: `${apiBaseUrl(url)}/documents/${series}/${encodeURIComponent(doc.id)}`,
		html,
		fromSearch,
		neighbors,
		related,
		catalog,
		// Ratsmanuale: edierte Einträge der Sitzung (QZH, Zürcher Rechtsquellen), sonst [];
		// mit der eigenen Detailseite, wenn das Stück im Index `editions` liegt.
		editions: await withOwnPages(editionLinksForDocument(doc.id)),
		krdbPersons,
		krdbStand: krdbPersons.length > 0 ? krdbStand() : null,
		// Ratsmanuale: Halbjahresrat und Amtszeit des Bandes (rm-bands.json), sonst null.
		rmBand: rmBandFor(doc.id),
		ratCouncil,
		ratMentions,
	};
};
