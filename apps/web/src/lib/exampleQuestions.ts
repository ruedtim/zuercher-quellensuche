// Beispielfragen der Startseite: je Quelle ein Topf, je Seitenaufruf eine Frage pro Topf. Die
// Quellen sind die Reiter der Suchseite und die Ratsmanuale, die als Serie in den Zentralen
// Serien liegen. Ein Klick führt in den Reiter der Quelle.
//
// Meist sucht die Frage selbst nach Bedeutung, wie im Frage-Feld (?ask= → Thema, ein Zeitraum
// als Filter, askRedirect.ts). Ratsmanuale und Ehedaten haben keine Vektoren, eine Frage
// erreicht sie nicht: Dort bringt das Beispiel seine Suche mit (`search`) – in den Ratsmanualen
// die alten Schreibungen als ODER-Wörter, in den Ehedaten Wort, Name, Ort oder Kirchgemeinde.
//
// Jede Frage ist gegen die Prod-Daten geprüft (2026-11-24, die ersten Treffer gelesen). Beim
// Ergänzen:
//  – Nach der Sache fragen, nicht nach der Gattung: «Welche Akten gibt es über Hexenprozesse?»
//    fand Protokollbände, «Wie wurde Hexerei bestraft?» Verhöre und Urteile.
//  – Zeiträume in den Mustern von extractDateRange («um», «vor», «seit», Dekade, Jahrhundert,
//    «zwischen … und …»); ohne die Jahre müssen zwei Inhaltswörter bleiben, sonst bleiben sie im
//    Thema stehen (Test).
//  – Grenzen: RRB-Lücke 1995–2007 (Fragen an den Regierungsrat bis 1994 oder ab 2008),
//    Zentrale Serien ab 1803, Ratsmanuale 1484–1798 (Lücke 1516–1544), Ehedaten 1524–1800.
//
// Picks sind server-seitig (Math.random nur im Load, kein Hydration-Mismatch).

import { searchViewHref, type SearchView } from "./searchViews";

/** Quelle einer Beispielfrage. */
export type ExampleSource = "all" | "catalog" | "documents" | "rm" | "editions" | "ehedaten";

export interface Example {
	text: string;
	/** Englische Frage (Bilingual-Demo). Fehlt = Deutsch. */
	lang?: "en";
	/** Zielt auf die Zeit nach 2000 (moderne Bestände). */
	post2000?: true;
	/** Eigene Suche statt der Frage nach Bedeutung (Parameter der Suchseite). */
	search?: Readonly<Record<string, string | readonly string[]>>;
}

/** Reiter, in den die Beispiele einer Quelle führen. */
export const EXAMPLE_VIEW: Readonly<Record<ExampleSource, SearchView>> = {
	all: "all",
	catalog: "catalog",
	documents: "documents",
	rm: "documents",
	editions: "editions",
	ehedaten: "ehedaten",
};

export const EXAMPLE_SOURCES = Object.keys(EXAMPLE_VIEW) as ExampleSource[];

/** Ratsmanuale: eines dieser Wörter, in alten Schreibungen. */
const rm = (...words: string[]) => ({ series: "RM", qAny: words });

export const EXAMPLE_QUESTIONS: Readonly<Record<ExampleSource, readonly Example[]>> = {
	// Alle Quellen: Fragen, zu denen mehrere Quellen etwas haben, meist auch die Editionen.
	all: [
		{ text: "Wer durfte im Zürichsee fischen?" },
		{ text: "Wie wurde der Wald geschützt?" },
		{ text: "Wie wurden Hebammen ausgebildet und entlöhnt?" },
		{ text: "Was ist die Geschichte des Katzensees?" },
		{ text: "Wie wurde seit 2000 über den Fluglärm gestritten?", post2000: true },
		{ text: "Who was allowed to fish in Lake Zurich?", lang: "en" },
	],
	catalog: [
		{ text: "Welche Karten zeigen den Zürichsee vor 1800?" },
		{ text: "Welche Erfindungen für die Küche wurden patentiert?" },
		{ text: "Wie protestierte die Zürcher Jugend um 1980?" },
		{ text: "Wer wurde im 18. Jahrhundert wegen Diebstahls verhört?" },
		{ text: "Welche Pläne gibt es von Schloss Kyburg?" },
		{ text: "Which photographs show Zurich airport?", lang: "en" },
	],
	// Zentrale Serien ab 1803.
	documents: [
		{ text: "Wie diskutierte der Kantonsrat das Frauenstimmrecht?" },
		{ text: "Wie reagierten die Behörden zwischen 1830 und 1870 auf die Cholera?" },
		{ text: "Wie wurde die Kinderarbeit in den Fabriken geregelt?" },
		{ text: "Welche Probleme hatte der Regierungsrat mit Hunden um 1940?" },
		{ text: "Wie wurde die Drogenpolitik in den 1990er Jahren diskutiert?" },
		{ text: "Welche Massnahmen beschloss der Regierungsrat seit 2020 gegen das Coronavirus?", post2000: true },
		{ text: "Wie plante der Regierungsrat seit 2008 den Klimaschutz?", post2000: true },
		{ text: "Wie diskutiert der Kantonsrat seit 2015 über die Digitalisierung der Schulen?", post2000: true },
	],
	rm: [
		{ text: "Wer suchte nach vergrabenen Schätzen?", search: rm("Schatzgraben", "Schatzgräber") },
		{ text: "Durfte man in Zürich Perücken tragen?", search: rm("Perruquen", "Peruquen", "Paruquen") },
		{ text: "Was tat Zürich für die Glaubensflüchtlinge aus Frankreich?", search: rm("Exulanten", "Refugianten") },
		{ text: "Welche Erdbeben wurden dem Rat gemeldet?", search: rm("Erdbeben", "Erdbidem") },
		{ text: "Durften Komödianten in Zürich auftreten?", search: rm("Comedianten", "Comödianten") },
		{ text: "Was beschloss der Rat gegen das Rauchen?", search: rm("Taback", "Tabak") },
	],
	editions: [
		{ text: "Was sagten die Täufer in ihren Verhören?" },
		{ text: "Welche Rechte hatte die Stadt Winterthur vor 1500?" },
		{ text: "Wie wurden Kranke im Siechenhaus gepflegt?" },
		{ text: "Wie wurde Hexerei bestraft?" },
		{ text: "Wer durfte Bürger von Zürich werden?" },
		{ text: "What did Anabaptists say when they were interrogated?", lang: "en" },
	],
	ehedaten: [
		{ text: "Wen heirateten die Scharfrichter?", search: { qAny: ["Scharfrichter", "Nachrichter"] } },
		{ text: "Wen heirateten die Hebammen?", search: { q: "Hebamme" } },
		{ text: "Wen heiratete Konrad Gessner?", search: { persons: "Konrad Gessner" } },
		{ text: "Wer heiratete 1650 in Winterthur?", search: { eheKirche: "Winterthur", dateFrom: "1650", dateTo: "1650" } },
		{ text: "Welche Brautleute kamen nach 1685 aus Frankreich?", search: { places: "Frankreich", dateFrom: "1685" } },
		{ text: "Who got married in Zurich in 1700?", lang: "en", search: { eheKirche: "Stadt Zürich", dateFrom: "1700", dateTo: "1700" } },
	],
};

/** Ziel einer Beispielfrage: der Reiter ihrer Quelle, mit der Frage oder ihrer eigenen Suche. */
export function exampleHref(source: ExampleSource, example: Example): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(example.search ?? { ask: example.text })) {
		for (const v of typeof value === "string" ? [value] : value) params.append(key, v);
	}
	return searchViewHref(EXAMPLE_VIEW[source], params);
}

/** Fisher-Yates auf einer Kopie (mutiert das Original nicht). */
function shuffle<T>(arr: readonly T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export interface HomepageExample {
	text: string;
	lang?: "en";
	href: string;
}

/**
 * Startseite: je Quelle eine Frage, in zufälliger Folge, mit der Garantie, dass mindestens eine
 * auf die Zeit nach 2000 zielt und mindestens eine englisch ist. Eine Quelle, die fehlt
 * (`available` = false: Index nicht bereit), lässt ihren Topf weg.
 *
 * Die Garantien stören sich nicht: Englisch wird nur in Töpfen erzwungen, die nichts nach 2000
 * führen. Reparaturen bleiben im Topf, also bleibt es bei einer Frage pro Quelle.
 */
export function pickHomepageExamples(available: Partial<Record<ExampleSource, boolean>> = {}): HomepageExample[] {
	const slots = EXAMPLE_SOURCES.filter((source) => available[source] !== false).map((source) => ({
		source,
		pool: EXAMPLE_QUESTIONS[source],
		example: pick(EXAMPLE_QUESTIONS[source]),
	}));
	const repair = (wanted: (e: Example) => boolean, candidates: typeof slots) => {
		if (slots.some((s) => wanted(s.example))) return;
		const fitting = candidates.filter((s) => s.pool.some(wanted));
		if (fitting.length === 0) return;
		const slot = pick(fitting);
		slot.example = pick(slot.pool.filter(wanted));
	};
	repair((e) => e.post2000 === true, slots);
	repair((e) => e.lang === "en", slots.filter((s) => !s.pool.some((e) => e.post2000)));
	return shuffle(slots).map(({ source, example }) => ({ text: example.text, lang: example.lang, href: exampleHref(source, example) }));
}
