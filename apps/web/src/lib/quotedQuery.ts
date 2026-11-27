// Anführungszeichen im Feld der Startseite (pur, unit-getestet in quotedQuery.test.ts; Startseite und
// server/askRedirect.ts): Was in Anführungszeichen steht, muss genau so vorkommen und wird zum
// Suchbegriff, der übrige Text bleibt Frage. Die Suche nach Bedeutung achtet sonst kaum auf einzelne
// Wörter: «"Pause"» als Thema lieferte Urlaub, Ausstand und «[Leer]», als Suchbegriff 872 Dokumente mit
// dem Wort (Prod 2026-11-26). Typografische Anführungszeichen (“…”, „…“, «…», »…«; das iPhone setzt
// sie beim Tippen) nimmt Meili schon wie gerade, die Erkennung hier muss sie ebenso kennen.

/** Doppelte Anführungszeichen jeder Schreibung; je ein Zeichen, Positionen bleiben beim Ersetzen gleich. */
const QUOTES = /["“”„‟«»]/g;

export interface QuotedText {
	/** Wortfolgen in Anführungszeichen, ohne die Zeichen. */
	phrases: string[];
	/** Der Text ohne die Wortfolgen (sie durch Leerzeichen ersetzt, gleich lang wie die Eingabe). */
	outside: string;
	/** Der Text ohne die Anführungszeichen (sie durch Leerzeichen ersetzt, gleich lang wie die Eingabe). */
	plain: string;
}

/**
 * Wortfolgen in Anführungszeichen; null ohne sie, bei ungerader Zahl von Anführungszeichen (Tippfehler:
 * dann gilt die Frage wie ohne) und wenn nur leere Paare dastehen.
 */
export function splitQuoted(text: string): QuotedText | null {
	const straight = text.replace(QUOTES, '"');
	const count = straight.split('"').length - 1;
	if (count < 2 || count % 2 === 1) return null;
	const phrases: string[] = [];
	const outside = straight.replace(/"([^"]*)"/g, (whole, inner: string) => {
		const phrase = inner.replace(/\s+/g, " ").trim();
		if (phrase) phrases.push(phrase);
		return " ".repeat(whole.length);
	});
	if (phrases.length === 0) return null;
	return { phrases, outside, plain: straight.replace(/"/g, " ") };
}

/** Suchbegriff aus Wortfolgen: jede in Anführungszeichen, alle müssen vorkommen. */
export function phraseQuery(phrases: readonly string[]): string {
	return phrases.map((p) => `"${p}"`).join(" ");
}

/** Der ganze Text als eine Wortfolge (Kästchen «wörtlich» der Startseite); "" ohne Wörter. */
export function literalPhrase(text: string): string {
	const inner = text.replace(QUOTES, " ").replace(/\s+/g, " ").trim();
	return inner ? `"${inner}"` : "";
}
