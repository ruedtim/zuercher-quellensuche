/**
 * Personenseiten und Verzeichnis des Kleinen Rats (/rat, /rat/<Id>): pure Logik
 * über dem Register (ratCouncil.ts) und der Bandtabelle (rmBands.ts).
 *
 * «Sitzungen der Amtszeit» laufen über die Bände: Ein Einsitz im Natalrat
 * 1644–1655 trifft alle Bände mit Hälfte 1 und Bandjahr 1644–1655 – dieselbe
 * Regel wie der Reiter «Rat» der Sitzungsseiten, nur umgekehrt. Die Suche
 * filtert sie über `volumeNr`; zwei Nummern teilen sich ein Halbjahresband mit
 * einem Handexemplar Beat Holzhalbs (B II 555/555 a für 1671, 595/595 a für
 * 1681), dessen Sitzungen dort mitkommen.
 *
 * Unit-getestet in ratPeople.test.ts.
 */

import { foldName } from "./krdbMatch";
import { PERIOD_LABEL, RM_YEARS, hasRmSeat, officeRank, ratLifeSpan, ratPersonName, type RatPerson, type RatSeat } from "./ratCouncil";
import { gndUrl, hlsUrl, ratPersonUrl, ssrqUrl, type PersonRefs, type RatDirectoryQuery } from "../rat";
import type { RmBand } from "../rmBands";

/** Bandnummern der Sitzungen, die in diesen Einsitz fallen (aufsteigend). Vor 1484 und für die
 *  Quartalsräte: keine. Bände, die beide Räte eines Jahres umfassen, zählen nicht mit – wie
 *  beim Reiter «Rat», der dort ebenfalls keinen Rat nennt. */
export function seatVolumes(seat: RatSeat, bands: Readonly<Record<string, RmBand>>): number[] {
	if (seat.period !== "nat" && seat.period !== "bapt") return [];
	const half = seat.period === "nat" ? 1 : 2;
	const out = new Set<number>();
	for (const band of Object.values(bands)) {
		if (band.half === half && band.year >= seat.from && band.year <= seat.to) out.add(band.nr);
	}
	return [...out].sort((a, b) => a - b);
}

/** Alle Bände der Amtszeit einer Person, ohne Doppelte. */
export function personVolumes(person: RatPerson, bands: Readonly<Record<string, RmBand>>): number[] {
	const out = new Set<number>();
	for (const seat of person.seats) for (const nr of seatVolumes(seat, bands)) out.add(nr);
	return [...out].sort((a, b) => a - b);
}

/** «Natalrat 1644–1655», «Herbstrat 1300». */
export function seatLabel(seat: RatSeat): string {
	const years = seat.from === seat.to ? `${seat.from}` : `${seat.from}–${seat.to}`;
	return `${PERIOD_LABEL[seat.period]} ${years}`;
}

/** Kurzfassung für Karten: das höchste Amt zuerst («Bürgermeister 1591–1608»), dann die übrigen
 *  nach Eintritt. Ein Amt, das in beiden Ratshälften lief, steht einmal (Jahre zusammengefasst). */
export function seatSummary(person: RatPerson, max = 2): string[] {
	const byRole = new Map<string, { from: number; to: number; rank: number }>();
	for (const s of person.seats) {
		const role = [s.office, s.guild && s.guild !== "Constaffel" ? s.guild : ""].filter((x) => x).join(" · ") || "Ratsmitglied";
		const old = byRole.get(role);
		byRole.set(
			role,
			old
				? { from: Math.min(old.from, s.from), to: Math.max(old.to, s.to), rank: old.rank }
				: { from: s.from, to: s.to, rank: officeRank(s.office) },
		);
	}
	return [...byRole]
		.sort((a, b) => a[1].rank - b[1].rank || a[1].from - b[1].from)
		.slice(0, max)
		.map(([role, { from, to }]) => `${role} ${from === to ? from : `${from}–${to}`}`);
}

/** Eine Person im Text einer Sitzung, die in der Transkription mit Normdaten ausgezeichnet ist (GND,
 *  HLS, SSRQ) – Personenkarte beim Namen (RatMentions.svelte). Steht sie im Register des Kleinen
 *  Rats, kommen Name, Lebensdaten, Amt und Personenseite dazu. */
export interface RatMentionView {
	/** Personen-Id des Registers; negativ für Personen, die es nicht kennt. */
	id: number;
	/** Name laut Register; leer ausserhalb des Registers (die Karte zeigt dann die Schreibung im Text). */
	name: string;
	/** Abgleich mit `data-gnd` bzw. `data-ssrq` am Namen im Text. */
	gnd: string | null;
	ssrq: string | null;
	/** Leer: Die Zuordnung läuft über die Normdaten, nicht über die Schreibung im Text. */
	forms: string[];
	lifespan: string | null;
	/** «Bürgermeister im Natalrat 1633» – sonst das höchste Amt («Bürgermeister 1637–1660»). */
	role: string | null;
	gndUrl: string | null;
	hlsUrl: string | null;
	ssrqUrl: string | null;
	/** Personenseite; null ausserhalb des Registers. */
	pageHref: string | null;
}

/**
 * Karten für die ausgezeichneten Personen eines Textes (Reihenfolge der ersten Nennung). Das
 * Register findet sie über die GND, sonst über die SSRQ-ID. Sitzt die Person im Rat dieses
 * Halbjahrs, steht ihr Amt darin; sonst ihr höchstes Amt (der Statthalter ist oft der
 * Bürgermeister der anderen Hälfte). Die Normdaten kommen aus dem Register, was ihm fehlt, aus
 * Transkribus. Personen, die das Register nicht kennt, bekommen eine Karte mit den Normdaten allein.
 */
export function ratMentionViews(
	refs: readonly PersonRefs[],
	lookup: { byGnd: (gnd: string) => RatPerson | null; bySsrq: (ssrq: string) => RatPerson | null },
	council: { label: string; members: ReadonlyArray<{ id: number; office: string | null }> } | null,
): RatMentionView[] {
	const out: RatMentionView[] = [];
	let unknown = 0;
	for (const ref of refs) {
		const person = (ref.gnd && lookup.byGnd(ref.gnd)) || (ref.ssrq && lookup.bySsrq(ref.ssrq)) || null;
		if (person && out.some((m) => m.id === person.id)) continue;
		const gnd = person?.gnd || ref.gnd;
		const hls = person?.hls || ref.hls;
		const ssrq = person?.ssrq || ref.ssrq;
		const office = person ? council?.members.find((m) => m.id === person.id)?.office : undefined;
		out.push({
			id: person ? person.id : -++unknown,
			name: person ? ratPersonName(person) : "",
			gnd: gnd || null,
			ssrq: ssrq || null,
			forms: [],
			lifespan: (person && ratLifeSpan(person)) || null,
			role: !person
				? null
				: council && office
					? `${office} im ${council.label}`
					: (seatSummary(person, 1)[0] ?? null),
			gndUrl: gnd ? gndUrl(gnd) : null,
			hlsUrl: hls ? hlsUrl(hls) : null,
			ssrqUrl: ssrq ? ssrqUrl(ssrq) : null,
			pageHref: person ? ratPersonUrl(person.id) : null,
		});
	}
	return out;
}

/** Erstes Eintrittsjahr – Sortierung «nach Eintritt». */
export function firstEntry(person: RatPerson): number {
	return Math.min(...person.seats.map((s) => s.from));
}

/** Hat einen Einsitz, der dieses Jahrhundert berührt (13 = 1201–1300 …, 18 = 1701–1800). */
function inCentury(person: RatPerson, century: number): boolean {
	const lo = (century - 1) * 100 + 1;
	const hi = century * 100;
	return person.seats.some((s) => s.to >= lo && s.from <= hi);
}

type Folded = { expand: string[]; strip: string[] };

/** Zwei Faltungen, damit «Bräm» auf «Bräm», «Braem» und «Bram» passt: ä → ae und ä → a. */
function fold(text: string): Folded {
	const split = (s: string) => s.split(" ").filter((w) => w.length > 0);
	return { expand: split(foldName(text, "expand")), strip: split(foldName(text, "strip")) };
}

/** Jedes Suchwort ist Anfang eines Namensworts: «hirz» trifft Hirzel, «escher luchs» Escher
 *  vom Luchs, «zel» nichts. */
function nameMatches(person: RatPerson, query: Folded): boolean {
	if (query.expand.length === 0) return true;
	const hay = fold(`${person.first} ${person.last}`);
	return query.expand.every(
		(w, i) => hay.expand.some((h) => h.startsWith(w)) || hay.strip.some((h) => h.startsWith(query.strip[i] ?? w)),
	);
}

export function filterRatDirectory(persons: readonly RatPerson[], q: RatDirectoryQuery): RatPerson[] {
	const words = fold(q.q);
	const out = persons.filter((p) => {
		if (q.rmOnly && !hasRmSeat(p)) return false;
		if (q.century && !inCentury(p, q.century)) return false;
		if (q.guild && !p.seats.some((s) => s.guild === q.guild)) return false;
		if (q.office && !p.seats.some((s) => s.office === q.office)) return false;
		return nameMatches(p, words);
	});
	const byName = (a: RatPerson, b: RatPerson) =>
		a.last.localeCompare(b.last, "de") || a.first.localeCompare(b.first, "de") || a.id - b.id;
	return out.sort(q.sort === "entry" ? (a, b) => firstEntry(a) - firstEntry(b) || byName(a, b) : byName);
}

/** Werte eines Felds mit Zahl der Personen, häufigste zuerst – Auswahl im Verzeichnis. */
export function seatValueOptions(
	persons: readonly RatPerson[],
	field: "guild" | "office",
): Array<{ value: string; count: number }> {
	const counts = new Map<string, number>();
	for (const p of persons) {
		const values = new Set(p.seats.map((s) => s[field]).filter((v): v is string => !!v));
		for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	return [...counts]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de"));
}

/** Liegt der Einsitz in der Zeit der Ratsmanuale (dann gibt es Sitzungen dazu)? */
export function seatInRm(seat: RatSeat): boolean {
	return seat.to >= RM_YEARS[0] && seat.from <= RM_YEARS[1];
}

const PARTICLES = new Set(["von", "vom", "zum", "zur", "zu", "am", "im", "an", "ab", "de", "di", "der", "die", "das"]);

/**
 * Suchwort für den Nachnamen im Protokolltext: das erste Wort ausser Partikeln.
 * «Escher vom Luchs» steht im Protokoll meist nur als «Escher», «von Cham» als
 * «Cham» – eine Wortfolge «Escher vom Luchs» fände die Handschrift kaum.
 */
export function searchSurname(last: string): string {
	const words = last.split(/[\s,]+/).filter((w) => w.length > 0);
	return words.find((w) => !PARTICLES.has(w.toLowerCase())) ?? words[0] ?? "";
}
