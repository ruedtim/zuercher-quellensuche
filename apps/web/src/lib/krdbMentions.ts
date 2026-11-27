// Personen-Nennungen im Text mit den Personen der Detailseite verbinden
// (PersonMentions.svelte): Kantonsratsdatenbank über die Form im Text (Span-Text
// wie im Index normalisiert), Kleiner Rat der Ratsmanuale über die GND am Span;
// Karte beim Namen platzieren. Pur und import-frei – unit-getestet (krdbMentions.test.ts).

/** Oberflächenform einer Entity wie im Index: Whitespace zusammengefasst,
 *  Satzzeichen am Ende weg (Indexer `normalizeEntityText`, ohne dessen
 *  Artefakt-Filter). So trifft der Text eines `.tei-person`-Spans exakt den
 *  `persons`-Wert – und damit die `forms` einer Zuordnung. */
export function entitySurface(text: string): string {
	return text
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[.,;:]+$/, "")
		.trim();
}

/** Form → IDs der zugeordneten Personen. Eine Form kann mehrere Personen
 *  tragen («Pfister, Meier & Schaufelberger»); Reihenfolge wie `persons`. */
export function buildMentionIndex(
	persons: ReadonlyArray<{ id: number; forms: readonly string[] }>,
): Map<string, number[]> {
	const index = new Map<string, number[]>();
	for (const p of persons) {
		for (const form of p.forms) {
			const key = entitySurface(form);
			if (!key) continue;
			const ids = index.get(key);
			if (!ids) index.set(key, [p.id]);
			else if (!ids.includes(p.id)) ids.push(p.id);
		}
	}
	return index;
}

/** Normdaten → IDs der Personen. In den Ratsmanualen trägt ein in Transkribus ausgezeichneter Name
 *  `data-gnd` und `data-ssrq` (Indexer, aus `persName/@ref`): Die Zuordnung ist exakt, ohne
 *  Textabgleich. Ein Index für beide – GND-Nummern beginnen mit einer Ziffer, SSRQ-IDs mit «per». */
export function buildRefIndex(
	persons: ReadonlyArray<{ id: number; gnd?: string | null; ssrq?: string | null }>,
): Map<string, number[]> {
	const index = new Map<string, number[]>();
	for (const p of persons) {
		for (const key of [p.gnd, p.ssrq]) {
			if (!key) continue;
			const ids = index.get(key);
			if (!ids) index.set(key, [p.id]);
			else if (!ids.includes(p.id)) ids.push(p.id);
		}
	}
	return index;
}

/** Personen eines Namens im Text: zuerst über GND bzw. SSRQ-ID am Span, sonst über die Form. */
export function mentionIds(
	span: { gnd?: string | null; ssrq?: string | null; text: string },
	byRef: ReadonlyMap<string, number[]>,
	byForm: ReadonlyMap<string, number[]>,
): number[] | undefined {
	return (
		(span.gnd ? byRef.get(span.gnd) : undefined) ??
		(span.ssrq ? byRef.get(span.ssrq) : undefined) ??
		byForm.get(entitySurface(span.text))
	);
}

export interface AnchorRect {
	top: number;
	bottom: number;
	left: number;
}

export interface Viewport {
	width: number;
	height: number;
}

/** Position einer `position: fixed`-Karte. Oberhalb des Namens wird über
 *  `bottom` verankert – so muss die Kartenhöhe nicht bekannt sein. */
export type CardPlacement =
	| { left: number; top: number; maxHeight: number }
	| { left: number; bottom: number; maxHeight: number };

/** Abstand der Karte zum Viewport-Rand bzw. zum Namen. */
export const CARD_MARGIN = 8;
export const CARD_GAP = 6;
/** Unter dem Namen, solange dort so viel Platz ist (oder mehr als darüber). */
const MIN_SPACE_BELOW = 240;

/** Karte unter den Namen, bei zu wenig Platz darüber; horizontal bündig mit
 *  dem Namen, aber innerhalb des Viewports. `cardWidth` = CSS-Breite ohne
 *  Viewport-Deckel (die Karte ist höchstens Viewport − 2 × Rand breit). */
export function placeCard(anchor: AnchorRect, viewport: Viewport, cardWidth: number): CardPlacement {
	const width = Math.min(cardWidth, viewport.width - 2 * CARD_MARGIN);
	const left = Math.round(
		Math.max(CARD_MARGIN, Math.min(anchor.left, viewport.width - width - CARD_MARGIN)),
	);
	const below = viewport.height - anchor.bottom - CARD_GAP - CARD_MARGIN;
	const above = anchor.top - CARD_GAP - CARD_MARGIN;
	if (below >= MIN_SPACE_BELOW || below >= above) {
		return { left, top: Math.round(anchor.bottom + CARD_GAP), maxHeight: Math.max(0, Math.floor(below)) };
	}
	return {
		left,
		bottom: Math.round(viewport.height - anchor.top + CARD_GAP),
		maxHeight: Math.max(0, Math.floor(above)),
	};
}
