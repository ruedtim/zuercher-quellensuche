import { docCountOf, krdbDocCounts, krdbRegisterPersons, portraitPath } from "$lib/server/krdb";
import { lifespanOf, portraitOf } from "$lib/server/krdbMatch";
import { filterDirectory, officeLines, partyLines, personName } from "$lib/server/krdbPeople";
import { DIRECTORY_PAGE_SIZE, parseDirectoryQuery } from "$lib/personUrls";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
	const query = parseDirectoryQuery(url.searchParams);
	const nowYear = new Date().getUTCFullYear();
	// Dokumentzahlen (null, solange der Index die Zuordnung noch nicht trägt).
	const counts = await krdbDocCounts().catch(() => null);
	const filtered = filterDirectory(krdbRegisterPersons(), query, counts?.all ?? null);
	const pages = Math.max(1, Math.ceil(filtered.length / DIRECTORY_PAGE_SIZE));
	const page = Math.min(query.page, pages);
	return {
		query,
		page,
		pages,
		total: filtered.length,
		ready: counts !== null,
		items: filtered.slice((page - 1) * DIRECTORY_PAGE_SIZE, page * DIRECTORY_PAGE_SIZE).map((p) => ({
			id: p.id,
			name: personName(p),
			lifespan: lifespanOf(p, nowYear),
			offices: officeLines(p).map((o) => `${o.label} ${o.years}`),
			party: partyLines(p).at(-1)?.party ?? null,
			portrait: portraitOf(p, { portraitSrc: portraitPath, nowYear }),
			docs: docCountOf(counts, p.id),
		})),
	};
};
