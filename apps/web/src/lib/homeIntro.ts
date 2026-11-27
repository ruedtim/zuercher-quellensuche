// Einleitung der Startseite: was sich finden lässt, mit den Zahlen aus dem Index.
// Pur → homeIntro.test.ts.

export interface HomeCounts {
	documents: number;
	/** Erstes Jahr der Dokumente. */
	since: number;
	/** null oder 0 = Bestand nicht im Index, dann fehlt er im Text. */
	catalog: number | null;
	ehedaten: number | null;
	editions: number | null;
}

const nf = (n: number) => n.toLocaleString("de-CH");

/** Ab einer Million gerundet («1,86 Millionen»), sonst genau. */
export function roughCount(n: number): string {
	return n >= 1_000_000 ? `${(Math.round(n / 10_000) / 100).toFixed(2).replace(".", ",")} Millionen` : nf(n);
}

export function homeIntro(c: HomeCounts, nowYear: number): string {
	const span = Math.floor((nowYear - c.since) / 100) * 100;
	const parts = [
		c.catalog ? `${roughCount(c.catalog)} Einträge des Archivkatalogs` : "",
		`${nf(c.documents)} Protokolle, Beschlüsse, Gesetze und Amtsblatt-Texte seit ${c.since}`,
		c.ehedaten ? `${nf(c.ehedaten)} Eheeinträge` : "",
		c.editions ? `${nf(c.editions)} edierte Quellenstücke` : "",
	].filter(Boolean);
	const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}` : parts[0];
	const lead = c.catalog ? "Finden Sie heraus, was im Staatsarchiv liegt, und lesen" : "Lesen";
	return `${lead} Sie amtliche Quellen aus über ${span} Jahren im Volltext. Eine Suche für ${list}.`;
}
