// Orchestriert die DTS-Navigation-Antwort. Zitiertiefe = Dokument-Ebene:
// jede Resource hat genau eine CitableUnit (identifier "1", citeType
// "document"), flache CitationTree (maxCiteDepth 1). ref/start/end dürfen daher
// nur "1" referenzieren – alles andere ist 404. JSON-LD-Form aus objects.ts.

import { getDocument } from "../meili";
import { citableUnit, navResource } from "./objects";
import type { NavigationQuery } from "./params";
import { errResult, ldEnvelope, okResult, type BuildResult } from "./serialize";

export async function buildNavigationResponse(
	base: string,
	selfUrl: string,
	query: NavigationQuery,
): Promise<BuildResult> {
	const doc = await getDocument(query.resource);
	if (!doc) return errResult(404, "not_found", `Resource '${query.resource}' not found.`);

	// Flache Struktur: einzige zitierbare Einheit ist "1".
	const refs = [query.ref, query.start, query.end].filter((r): r is string => r !== null);
	const badRef = refs.find((r) => r !== "1");
	if (badRef !== undefined) {
		return errResult(
			404,
			"not_found",
			`Unknown citable unit '${badRef}' in resource '${query.resource}'.`,
		);
	}

	const body: Record<string, unknown> = {
		...ldEnvelope(),
		"@id": selfUrl,
		"@type": "Navigation",
		resource: navResource(base, doc),
		member: [citableUnit(doc)],
	};
	// `ref`/`start`/`end` zurückspiegeln – die DTS-Spec modelliert sie als
	// CitableUnit-OBJEKTE (nicht als rohe Strings). Bei der flachen Dokument-
	// Ebene ist die referenzierte Einheit immer die einzige ("1").
	if (query.ref) body.ref = citableUnit(doc);
	if (query.start) body.start = citableUnit(doc);
	if (query.end) body.end = citableUnit(doc);
	return okResult(body);
}
