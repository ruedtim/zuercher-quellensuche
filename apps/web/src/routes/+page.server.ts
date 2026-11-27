import { getCorpusYearDistribution } from "$lib/server/meili";
import { collectionCounts } from "$lib/server/collectionCounts";
import { pickHomepageExamples } from "$lib/exampleQuestions";
import { yearBoundsFromDistribution } from "$lib/types";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	// Korpus-weite Jahres-Verteilung (gecached in meili.ts). Daraus speisen sich
	// sowohl der Zeitstrahl als auch seine dynamischen Grenzen. Die Zahlen
	// der übrigen Quellen sind ebenfalls gecacht.
	const [timelineBuckets, collections] = await Promise.all([getCorpusYearDistribution(), collectionCounts()]);
	// Gesamt-Treffer aus den Buckets summieren (statt zusätzlichen Stats-Call)
	const total = Object.values(timelineBuckets).reduce((a, b) => a + b, 0);
	// Äusserste Jahre mit Dokumenten – der Zeitstrahl endet nicht im leeren Raum.
	const dateBounds = yearBoundsFromDistribution(timelineBuckets);
	return {
		timelineBuckets,
		totalDocs: total,
		dateBounds,
		// Weitere Bestände in der Einleitung (null = Index nicht bereit).
		collections,
		// Pro Seitenaufruf neu gepickt: je Quelle eine Frage, garantiert mindestens eine nach 2000
		// und eine englische. Ohne Ratsmanuale im Index beginnen die Dokumente 1803.
		exampleQuestions: pickHomepageExamples({
			catalog: !!collections.catalog,
			editions: !!collections.editions,
			ehedaten: !!collections.ehedaten,
			rm: dateBounds.min < 1803,
		}),
	};
};
