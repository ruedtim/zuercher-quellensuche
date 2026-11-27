// SvelteKit nennt in der Kopfzeile `Link` alle Skripte der Seite zum Vorladen (Suchseite: rund 50).
// nginx nimmt die Kopfzeilen einer Antwort in EINEM Puffer entgegen (Vorgabe 4 KB, sonst 502), und mit
// der Content-Security-Policy war er auf der Suchseite bis auf 109 Byte voll. Einträge über der Grenze
// fallen weg: Es sind Hinweise, der Browser lädt die Skripte auch ohne sie, nur etwas später.

/** So lang darf `Link` werden (mit den übrigen Kopfzeilen bleibt gut 1 KB Luft). */
export const MAX_LINK_LENGTH = 2_900;

/** Die ersten Einträge, die zusammen in die Grenze passen. */
export function trimLinkHeader(value: string, max = MAX_LINK_LENGTH): string {
	if (value.length <= max) return value;
	const cut = value.lastIndexOf(", <", max);
	return cut > 0 ? value.slice(0, cut) : "";
}
