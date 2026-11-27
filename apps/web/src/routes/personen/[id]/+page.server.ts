import { error, redirect } from "@sveltejs/kit";
import {
	docCountOf,
	krdbDocCounts,
	krdbStand,
	personDocuments,
	portraitPath,
	resolveKrdbPerson,
} from "$lib/server/krdb";
import { KRDB_PERSON_URL, lifespanOf, portraitOf } from "$lib/server/krdbMatch";
import {
	officeLines,
	partyLines,
	personIds,
	personName,
	residenceNames,
	sanitizeMarks,
	trimCropMarks,
	yearAxis,
} from "$lib/server/krdbPeople";
import { personCatalogUnits } from "$lib/server/catalog";
import { PERSON_CATALOG_MAX } from "$lib/catalog";
import { parsePersonQuery, personUrl } from "$lib/personUrls";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url }) => {
	if (!/^\d{1,9}$/.test(params.id)) throw error(404, "Person nicht gefunden");
	const found = resolveKrdbPerson(Number(params.id));
	if (!found) throw error(404, "Person nicht gefunden");
	const { person } = found;
	const nowYear = new Date().getUTCFullYear();
	const query = parsePersonQuery(url.searchParams, nowYear);
	// Frühere ID (die KRDB vergibt IDs neu): dauerhaft auf die aktuelle umleiten.
	if (!found.canonical) redirect(301, personUrl(person.id, query));

	// Der Index trägt die Zuordnung erst nach `--patch-krdb`: bis dahin nur der Kopf.
	// Archivkatalog: gesicherte Einheiten, von den Vorschlägen gleichen Namens nur die Zahl –
	// die Liste lädt erst ein Klick (/api/catalog/person), Personenseiten werden indexiert.
	const ids = personIds(person);
	const [counts, secured, names] = await Promise.all([
		krdbDocCounts().catch(() => null),
		personCatalogUnits(ids, "secured", PERSON_CATALOG_MAX),
		personCatalogUnits(ids, "names", 0),
	]);
	const docs = counts
		? await personDocuments(person, query).catch((err) => {
				console.warn(`[krdb] Dokumente von ${person.id} nicht lesbar:`, err);
				return null;
			})
		: null;

	return {
		person: {
			id: person.id,
			name: personName(person),
			lifespan: lifespanOf(person, nowYear),
			offices: officeLines(person),
			parties: partyLines(person),
			residences: residenceNames(person),
			krdbUrl: `${KRDB_PERSON_URL}${person.id}`,
			wikidataUrl: person.qid ? `https://www.wikidata.org/wiki/${person.qid}` : null,
			portrait: portraitOf(person, { portraitSrc: portraitPath, nowYear }),
		},
		query,
		axis: yearAxis(docs?.timelineBuckets ?? {}, nowYear),
		// Der Body bleibt auf dem Server (nur der Ausschnitt `_formatted` geht zum Client).
		docs: docs && {
			total: docs.result.estimatedTotalHits,
			page: docs.result.page,
			pageSize: docs.result.pageSize,
			scopeCounts: docs.scopeCounts,
			timelineBuckets: docs.timelineBuckets,
			hits: docs.result.hits.map((h) => ({
				id: h.id,
				series: h.series,
				title: h.title,
				date: h.date,
				stazhIdent: h.stazhIdent,
				subset: h.subset ?? null,
				// Maskiert (nur die Hervorhebungen bleiben Markup) – die Seite setzt es per {@html}.
				formattedTitle: sanitizeMarks(h._formatted?.title ?? h.title),
				snippet: h._formatted?.body ? trimCropMarks(sanitizeMarks(h._formatted.body)) : null,
			})),
		},
		ready: counts !== null,
		totalDocs: docCountOf(counts, person.id),
		stand: krdbStand(),
		// null ohne lesbaren Katalog oder ohne Einheiten: kein Abschnitt, kein Link.
		catalog:
			(secured?.total ?? 0) + (names?.total ?? 0) > 0
				? { secured: secured ?? { total: 0, units: [] }, namesTotal: names?.total ?? 0 }
				: null,
	};
};
