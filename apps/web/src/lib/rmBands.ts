/**
 * Halbjahresräte der Ratsmanuale (RM): Zürich wählte zwei Räte im Jahr – den
 * Natalrat für das erste Halbjahr, den Baptistalrat für das zweite. Jeder Band
 * gehört zu einem von beiden (Transkribus-Titel «1642/2 Ratsmanuale des
 * Baptistalrats des Unterschreibers (StAZH B II 441)»), die Dokument-ID einer
 * Sitzung trägt den Bandschlüssel (`RM_<Jahr>_<Schlüssel>_<Nr>`).
 *
 * Die Zuordnung läuft bewusst über den BAND, nicht über das Sitzungsdatum
 * (docs/zuercher-rat-plan.md §3): Die Sitzung vom 7.1.1550 steht im Band des
 * Baptistalrats 1549 – ihr Protokollkopf nennt Bürgermeister Haab, nicht den
 * Bürgermeister des Natalrats 1550 –, und 29 % der Sitzungen haben gar kein
 * Datum (in den frühen Bänden praktisch alle).
 *
 * Tabelle: lib/server/data/rm-bands.json, gebaut von
 * `python -m rmtk.bandtable` (services/rm-transkribus). Grundlage für die
 * Personen des Kleinen Rats (Register des Staatsarchivs, Stufe 4.1 des
 * RM-Plans); hier erst die Kopfzeile der Detailseite.
 *
 * Bewusst ohne Imports, damit der Unit-Test direkt mit `npx tsx --test` läuft.
 */

export type RmRat = "Natalrat" | "Baptistalrat" | "beide";
export type RmScribe = "Stadtschreiber" | "Unterschreiber" | "beide";

/** Ein Band, wie ihn sein Transkribus-Titel beschreibt. */
export interface RmBand {
	/** Nummer in B II (ohne Suffix; = `volumeNr` im Suchindex). */
	nr: number;
	/** «a» bei «B II 549 a». */
	suffix?: string;
	/** Teil 1/2 eines Bandes (nur B II 732). */
	part?: number;
	/** Bandjahr. */
	year: number;
	/** Zweites Jahr bei mehrjährigen Bänden (3 Bände). */
	yearTo?: number;
	/** 1 = Natalrat (Jan.–Juni), 2 = Baptistalrat (Juli–Dez.); fehlt bei ganz-/mehrjährigen Bänden. */
	half?: 1 | 2;
	rat?: RmRat;
	scribe?: RmScribe;
	/** Beinahe-Dublette der Reihe (Sammelband, Handexemplar). */
	special?: string;
}

export interface RmBandTable {
	meta: {
		built: string;
		hash: string;
		source: string;
		counts: Record<string, number | number[]>;
	};
	bands: Record<string, RmBand>;
}

/** Was die Detailseite zeigt. */
export interface RmBandView {
	key: string;
	band: RmBand;
	/** «Natalrat 1650», «Natal- und Baptistalrat 1550»; null, wenn der Titel keinen Rat nennt. */
	label: string | null;
	hint: string;
}

/** `RM_1642_0441_0007` → `0441`; andere Serien und Fremdformen → null. */
export function rmBandKey(id: string): string | null {
	const m = /^RM_\d{1,4}_(\d{4}[a-z]?(?:t\d)?)_\d+$/.exec(id);
	return m ? m[1] : null;
}

/** Signatur des Bandes: «StAZH B II 549 a», mit Teil «StAZH B II 732, Teil 2». */
export function rmBandSignature(band: RmBand): string {
	const sig = `StAZH B II ${band.nr}${band.suffix ? ` ${band.suffix}` : ""}`;
	return band.part ? `${sig}, Teil ${band.part}` : sig;
}

/** Jahr bzw. Jahresspanne des Bandes («1650», «1669–1681»). */
export function rmBandYears(band: RmBand): string {
	return band.yearTo && band.yearTo !== band.year ? `${band.year}–${band.yearTo}` : String(band.year);
}

/**
 * Rat und Jahr des Bandes. 9 Bände (B II 59–67, 1545–1547: «Denkzedel der
 * Ratstagen», «Erkanntnussen im Jenner») nennen keinen Rat – dann steht nichts,
 * lieber als ein geratener Halbjahresrat.
 */
export function rmBandLabel(band: RmBand): string | null {
	const years = rmBandYears(band);
	if (band.half === 1) return `Natalrat ${years}`;
	if (band.half === 2) return `Baptistalrat ${years}`;
	if (band.rat === "beide") return `Natal- und Baptistalrat ${years}`;
	return band.rat ? `${band.rat} ${years}` : null;
}

/**
 * Erklärung zur Kopfzeile: Amtszeit des Rats und woher die Angabe kommt.
 *
 * Die Halbjahre laufen von Weihnachten bis Johanni (24. Juni) und zurück, nicht
 * von Januar bis Juni – so rechnen auch `band_period` und `WINDOW` in
 * rmtk/bands.py bzw. rmtk/dates.py (seit 17.11.2026). Gemessen an den Bändern
 * des lokalen Index: Natalrat 1552 28.12.1551–22.6.1552, Natalrat 1670
 * 29.12.1669–23.6.1670, Baptistalrat 1642 25.6.–23.12.1642, Baptistalrat 1783
 * 25.6.–27.12.1783.
 */
export function rmBandHint(band: RmBand): string {
	const term =
		band.half === 1
			? `Amtszeit: Weihnachten ${band.year - 1} bis Johanni (24. Juni) ${band.year}.`
			: band.half === 2
				? `Amtszeit: Johanni (24. Juni) bis Weihnachten ${band.year}.`
				: "Zürich wählte zwei Räte im Jahr: den Natalrat von Weihnachten bis Johanni, den Baptistalrat von Johanni bis Weihnachten.";
	return `${term} Der Rat steht im Band, nicht im Sitzungsdatum – die ersten Sitzungen eines Natalrats stehen oft noch im Dezember des Vorjahres.`;
}

function asBand(value: unknown): RmBand | null {
	if (typeof value !== "object" || value === null) return null;
	const b = value as Record<string, unknown>;
	if (typeof b.nr !== "number" || typeof b.year !== "number") return null;
	const out: RmBand = { nr: b.nr, year: b.year };
	if (typeof b.suffix === "string") out.suffix = b.suffix;
	if (typeof b.part === "number") out.part = b.part;
	if (typeof b.yearTo === "number") out.yearTo = b.yearTo;
	if (b.half === 1 || b.half === 2) out.half = b.half;
	if (b.rat === "Natalrat" || b.rat === "Baptistalrat" || b.rat === "beide") out.rat = b.rat;
	if (b.scribe === "Stadtschreiber" || b.scribe === "Unterschreiber" || b.scribe === "beide") {
		out.scribe = b.scribe;
	}
	if (typeof b.special === "string") out.special = b.special;
	return out;
}

/** Tabelle aus dem JSON; alles Unbrauchbare fällt weg (lieber keine Kopfzeile als eine falsche). */
export function parseRmBandTable(data: unknown): Record<string, RmBand> {
	const raw = (data as RmBandTable | null)?.bands;
	if (typeof raw !== "object" || raw === null) return {};
	const out: Record<string, RmBand> = {};
	for (const [key, value] of Object.entries(raw)) {
		const band = asBand(value);
		if (band) out[key] = band;
	}
	return out;
}

/** Sicht auf den Band einer Sitzung; null ohne Band in der Tabelle. */
export function rmBandViewFor(id: string, bands: Record<string, RmBand>): RmBandView | null {
	const key = rmBandKey(id);
	const band = key ? bands[key] : undefined;
	if (!key || !band) return null;
	return { key, band, label: rmBandLabel(band), hint: rmBandHint(band) };
}
