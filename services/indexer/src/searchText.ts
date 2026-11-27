/**
 * Suchtext im Index `documents`: «ß» als «ss» (Entscheid Tim 2026-11-17).
 *
 * Meili gleicht ß nicht an (charabia 0.9/0.10 normalisiert ä→a, aber nicht ß→ss): «Strasse»
 * fand «Straße» nicht, «dass» nicht «daß». Prod 2026-11-17, genau so geschrieben: «Straße» in
 * 19'179 Dokumenten (davon 2'322 im Titel), «Strasse» in 18'859, «daß» in 191'816 – vor allem
 * die RRB des 19. Jahrhunderts. Wie bei den Ratsmanualen (rmSearchForm) wird darum der
 * indexierte Text mit «ss» geschrieben; die Anfrage faltet die Web-App ebenso
 * (apps/web lib/searchParams.ts `foldSharpS`).
 *
 * - `body` ist Such- UND Anzeigetext (Auszug, /api/v1, MCP `fetch`): er steht mit «ss» im
 *   Index. Detailseite (gerendertes HTML), TEI, DTS und Faksimile bleiben im Original.
 * - `title` bleibt im Original (Anzeige überall, Zitate). Die gefaltete Form steht in
 *   `titleSearch` – nur durchsuchbar, nicht angezeigt, und nur gesetzt, wenn sie sich
 *   unterscheidet (sonst null).
 */

/** ß → ss, ẞ → SS. */
export function foldSharpS(text: string): string {
  return text.replace(/ß/g, "ss").replace(/ẞ/g, "SS");
}

/** Gefalteter Titel fürs Suchfeld `titleSearch`, null wenn er sich nicht unterscheidet. */
export function titleSearchFor(title: string): string | null {
  const folded = foldSharpS(title);
  return folded === title ? null : folded;
}
