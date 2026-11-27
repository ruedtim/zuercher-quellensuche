/**
 * Geprüfte Mehrfacheinträge der Ehedatenbank: Ehen, die in den Kirchenbüchern zweier
 * Kirchgemeinden stehen – meist verkündet bzw. eingetragen in der einen, getraut in der
 * anderen. Die Liste (server/data/ehedaten-mehrfach.json) baut services/catalog
 * (`main.ts ehedaten-mehrfach`) aus der Liste des Staatsarchivs im Repository
 * stazh/sw-ehedaten («Wissensnetz der Zürcher Ehedaten», `EDB_Mehrfacheintraege.csv`):
 * je Ehe die Katalog-IDs ihrer Einträge (= `id` im Index `ehedaten`), dazu, ob die Liste
 * sich sicher ist. Paare, die sie als eine Ehe führt, deren Einträge aber zwei Hochzeiten
 * belegen (Brüder am selben Tag), stehen getrennt als `verschieden`.
 *
 * Die Liste deckt nur einen Teil der Doppeleinträge ab (5'358 Ehen; gleichnamige Paare
 * höchstens ein Jahr auseinander gibt es rund 32'000): Wo sie nichts hat, zeigt die
 * Ehe-Karte die ungeprüfte Namens-Heuristik (sameCoupleEntries). Übernommen sind nur die
 * Katalog-IDs; Daten, Namen und Kirchgemeinden kommen aus dem Index (gleicher Kalender wie
 * die Ehedatenbank, das RDF des Repos rechnet gregorianisch um und wird nicht verwendet).
 * Rein und ohne Server-Abhängigkeit, unit-getestet in ehedatenMehrfach.test.ts.
 */

/** Nennung der Liste (opendata.swiss führt das Repository als Ressource des OGD-Datensatzes
 *  «Zürcher Ehedaten» mit «Freie Nutzung. Quellenangabe ist Pflicht.»; eine eigene
 *  Lizenzdatei hat es nicht). */
export const EHEDATEN_MEHRFACH_ATTRIBUTION = "Staatsarchiv des Kantons Zürich, Wissensnetz der Zürcher Ehedaten, Liste der Mehrfacheinträge";
export const EHEDATEN_MEHRFACH_URL = "https://github.com/stazh/sw-ehedaten/blob/main/sourcedata/csv/EDB_Mehrfacheintraege.csv";

/** Die übrigen Einträge der Ehe eines Eintrags laut Liste. */
export interface SameMarriage {
	/** Ehe-ID der Liste. */
	ehe: string;
	/** Katalog-IDs der übrigen Einträge, aufsteigend. */
	ids: number[];
	/** false = laut Liste nur wahrscheinlich dieselbe Ehe (Sicherheitswert «Probably»). */
	sicher: boolean;
}

/** Form der committeten Liste (ohne `meta`). */
export interface EhedatenMehrfachData {
	ehen: Record<string, number[]>;
	wahrscheinlich: string[];
	verschieden: Record<string, { ids: number[]; grund: "vornamen" | "vermerk" }>;
}

export interface EhedatenMehrfachIndex {
	/** Geprüfte Ehe eines Eintrags; null, wenn die Liste ihn nicht führt. */
	forEntry(id: number): SameMarriage | null;
	/** Einträge, die die Liste mit diesem als eine Ehe führte, die nach ihren Angaben aber eine
	 *  andere sind (gleiche Namen, zwei Hochzeiten am selben Tag): nie als «dasselbe Paar» zeigen. */
	distinctFrom(id: number): number[];
	/** Anzahl Ehen (Bericht, Tests). */
	size: number;
}

const EMPTY: EhedatenMehrfachIndex = { forEntry: () => null, distinctFrom: () => [], size: 0 };

/** Katalog-IDs einer Ehe: positive ganze Zahlen, jede einmal, mindestens zwei. */
function idsOf(v: unknown): number[] | null {
	if (!Array.isArray(v)) return null;
	const ids = [...new Set(v.filter((x): x is number => Number.isInteger(x) && x > 0))];
	return ids.length >= 2 ? ids.sort((a, b) => a - b) : null;
}

/**
 * Liste prüfen und nachschlagbar machen. Ungültige Ehen (weniger als zwei Katalog-IDs) fallen
 * weg, eine Katalog-ID in mehreren Ehen gilt in keiner; eine unlesbare Liste ergibt einen
 * leeren Index – die Ehe-Karte zeigt dann die Heuristik wie bisher.
 */
export function indexEhedatenMehrfach(raw: unknown): EhedatenMehrfachIndex {
	if (!raw || typeof raw !== "object") return EMPTY;
	const data = raw as Partial<EhedatenMehrfachData>;
	if (!data.ehen || typeof data.ehen !== "object" || Array.isArray(data.ehen)) return EMPTY;
	const unsure = new Set(Array.isArray(data.wahrscheinlich) ? data.wahrscheinlich.filter((e) => typeof e === "string") : []);
	const marriages: Array<{ ehe: string; ids: number[] }> = [];
	const uses = new Map<number, number>();
	for (const [ehe, v] of Object.entries(data.ehen)) {
		const ids = idsOf(v);
		if (!ids) continue;
		marriages.push({ ehe, ids });
		for (const id of ids) uses.set(id, (uses.get(id) ?? 0) + 1);
	}
	const byId = new Map<number, { ehe: string; ids: number[] }>();
	let size = 0;
	for (const m of marriages) {
		// Eine Katalog-ID in mehreren Ehen fällt überall weg, mit ihr Ehen unter zwei Einträgen.
		const ids = m.ids.filter((id) => uses.get(id) === 1);
		if (ids.length < 2) continue;
		size++;
		for (const id of ids) byId.set(id, { ehe: m.ehe, ids });
	}
	const distinct = new Map<number, number[]>();
	const verschieden = data.verschieden && typeof data.verschieden === "object" ? data.verschieden : {};
	for (const v of Object.values(verschieden)) {
		const ids = idsOf(v?.ids);
		if (!ids) continue;
		for (const id of ids) distinct.set(id, [...(distinct.get(id) ?? []), ...ids.filter((x) => x !== id)]);
	}
	return {
		forEntry(id) {
			const m = byId.get(id);
			return m ? { ehe: m.ehe, ids: m.ids.filter((x) => x !== id), sicher: !unsure.has(m.ehe) } : null;
		},
		distinctFrom: (id) => distinct.get(id) ?? [],
		size,
	};
}
