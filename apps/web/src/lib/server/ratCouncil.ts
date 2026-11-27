/**
 * Der Kleine Rat des Stadtstaats Zürich 1225–1798: Register und Zusammensetzung.
 *
 * Quelle ist das Register des Staatsarchivs («Der Kleine Rat des Stadtstaats
 * Zürich 1225 bis 1798», nach Werner Schnyder, Die Zürcher Ratslisten 1225–1798).
 * Eine
 * Zeile der Quelle ist ein ununterbrochener Einsitz in derselben Ratsperiode und
 * Funktion, also lässt sich für jedes Halbjahr sagen, wer im Rat saß: 1484–1798
 * sind das im Median 26 Personen (docs/zuercher-rat-plan.md §1).
 *
 * Gebaut wird das Register von services/rat aus der Excel-Datei des
 * Staatsarchivs; dieses Modul hält die Typen (Single Source of Truth, wie
 * krdbMatch.ts für die KRDB) und die Auswahl nach Halbjahr.
 *
 * Nennung und Herkunft
 * in $lib/rat.ts.
 *
 * Bewusst ohne Imports, damit der Unit-Test direkt mit `npx tsx --test` läuft und
 * services/rat die Typen ohne SvelteKit-Alias importieren kann.
 */

/** Ratsperiode der Quelle: Halbjahresräte ab 1336, davor Quartalsräte, 1489 zusätzlich der Hörnerne Rat. */
export type RatPeriod = "nat" | "bapt" | "fasten" | "sommer" | "herbst" | "hoerner";

/** Ein ununterbrochener Einsitz (eine Zeile der Quelle). */
export interface RatSeat {
	period: RatPeriod;
	/** Jahr des Eintritts und des Austritts, beide eingeschlossen. */
	from: number;
	to: number;
	/** Funktion, wie die Quelle sie schreibt («Zunftmeister», «Bürgermeister»); fehlt bei 421 Einsitzen. */
	office?: string;
	/** Zunft bzw. Constaffel; fehlt bei 511 Einsitzen. */
	guild?: string;
	/** Belegstelle bei Schnyder («558 Bapt. Anm. 1-559»). */
	pages?: string;
}

export interface RatPerson {
	/** Personen-Id der Quelle. */
	id: number;
	last: string;
	first: string;
	born?: number;
	died?: number;
	/** Beruf laut Quelle («Kaufmann», «Goldschmied»). */
	job?: string;
	/** GND-Nummer (ohne URL). */
	gnd?: string;
	/** Artikel-ID im Historischen Lexikon der Schweiz («018087»). */
	hls?: string;
	/** Personen-ID der Zürcher Rechtsquellen («per012682»), Brücke zu den Editionen. */
	ssrq?: string;
	seats: RatSeat[];
}

export interface RatRegisterMeta {
	built: string;
	hash: string;
	source: string;
	counts: {
		persons: number;
		seats: number;
		/** Personen mit mindestens einem Einsitz in der Zeit der Ratsmanuale. */
		personsRm: number;
		years: [number, number];
	};
}

export interface RatRegister {
	meta: RatRegisterMeta;
	persons: RatPerson[];
}

/** Eine Person mit dem Einsitz, der sie in diesen Rat bringt. */
export interface RatMember {
	person: RatPerson;
	seat: RatSeat;
}

/** Zeit der Ratsmanuale auf der Plattform (Serie RM). */
export const RM_YEARS: [number, number] = [1484, 1798];

/** Halbjahresrat → Ratsperiode der Quelle: 1 = Natalrat, 2 = Baptistalrat. */
export function periodOfHalf(half: 1 | 2): RatPeriod {
	return half === 1 ? "nat" : "bapt";
}

export const PERIOD_LABEL: Record<RatPeriod, string> = {
	nat: "Natalrat",
	bapt: "Baptistalrat",
	fasten: "Fastenrat",
	sommer: "Sommerrat",
	herbst: "Herbstrat",
	hoerner: "Hörnerner Rat",
};

/**
 * Reihenfolge der Anzeige, nicht die Rangordnung des Rats (die Quelle sagt
 * dazu nichts): Bürgermeister zuerst, dann die Häupter der Constaffel und der
 * Zünfte, dann die Ratsherren.
 */
const OFFICE_ORDER = [
	"Bürgermeister",
	"Bürgermeister, angeblicher",
	"Constaffelherr",
	"Zunftmeister",
	"Ratsherr von freier Wahl",
	"Ratsherr",
	"Vertreter",
	"Zugesetzter",
];

/** Rang in der Anzeigereihenfolge (kleiner = weiter oben); unbekannte Funktionen zuletzt. */
export function officeRank(office: string | undefined): number {
	const i = office ? OFFICE_ORDER.indexOf(office) : -1;
	return i === -1 ? OFFICE_ORDER.length : i;
}

/** «Hans Conrad Nüscheler»; ein fehlender Vorname lässt nur den Nachnamen stehen. */
export function ratPersonName(person: RatPerson): string {
	return [person.first, person.last].filter((s) => s).join(" ").trim();
}

/** «1759–1856», «* 1759», «† 1856»; leer, wenn die Quelle beides nicht kennt. */
export function ratLifeSpan(person: RatPerson): string {
	if (person.born && person.died) return `${person.born}–${person.died}`;
	if (person.born) return `* ${person.born}`;
	if (person.died) return `† ${person.died}`;
	return "";
}

/** Gilt der Einsitz in diesem Jahr? Ein- und Austrittsjahr zählen mit. */
export function seatCovers(seat: RatSeat, period: RatPeriod, year: number): boolean {
	return seat.period === period && seat.from <= year && year <= seat.to;
}

/**
 * Wer saß in diesem Halbjahresrat? Eine Person kann in einem Halbjahr zwei
 * Einsitze haben (Wechsel der Funktion im selben Jahr); dann zählt der höhere
 * – sonst stünde sie zweimal in der Liste.
 */
export function councilAt(persons: readonly RatPerson[], year: number, half: 1 | 2): RatMember[] {
	const period = periodOfHalf(half);
	const out: RatMember[] = [];
	for (const person of persons) {
		let best: RatSeat | null = null;
		for (const seat of person.seats) {
			if (!seatCovers(seat, period, year)) continue;
			if (!best || officeRank(seat.office) < officeRank(best.office)) best = seat;
		}
		if (best) out.push({ person, seat: best });
	}
	return sortCouncil(out);
}

/** Anzeigereihenfolge: Funktion, dann Zunft, dann Name. */
export function sortCouncil(members: RatMember[]): RatMember[] {
	return members.sort((a, b) => {
		const r = officeRank(a.seat.office) - officeRank(b.seat.office);
		if (r !== 0) return r;
		const g = (a.seat.guild ?? "").localeCompare(b.seat.guild ?? "", "de");
		if (g !== 0) return g;
		const l = a.person.last.localeCompare(b.person.last, "de");
		return l !== 0 ? l : a.person.first.localeCompare(b.person.first, "de");
	});
}

/** Der Bürgermeister des Halbjahrs – die Probe aufs Exempel im Protokollkopf («Prnt. Herr Rahn»). */
export function mayorOf(members: readonly RatMember[]): RatMember | null {
	return members.find((m) => m.seat.office === "Bürgermeister") ?? null;
}

/** Hat die Person einen Einsitz in der Zeit der Ratsmanuale? */
export function hasRmSeat(person: RatPerson): boolean {
	return person.seats.some((s) => s.to >= RM_YEARS[0] && s.from <= RM_YEARS[1]);
}
