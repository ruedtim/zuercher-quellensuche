/**
 * Übersicht der Register (/register, Menüpunkt «Register»): ein Einstieg für die Register aller
 * Quellen und eine Namenssuche über alle zugleich. Die Register entstehen verschieden – das des
 * Archivkatalogs aus automatisch erkannten Namen, das der Editionen aus den Registern der
 * Edition, die Rats- und Regierungsmitglieder aus der Kantonsratsdatenbank, die Ehedaten
 * nennen Bräutigam und Braut jedes Eintrags. Darum keine gemeinsame Liste, sondern je Quelle
 * ein Block in der Reihenfolge der Reiter der Suchseite (Archivkatalog, Zentrale Serien,
 * Editionen, Ehedaten).
 *
 * Pur (Browser und Server), unit-getestet in registerHub.test.ts.
 */

import { SEARCH_VIEWS, type SearchView } from "./searchViews";

/** Höchstens so viele Zeichen nimmt die Namenssuche. */
export const HUB_QUERY_MAX = 100;
/** Treffer je Typ und Register in der Übersicht. */
export const HUB_PREVIEW = 5;
/** Rats- und Regierungsmitglieder in der Übersicht. */
export const HUB_KRDB_PREVIEW = 6;
/** Mitglieder des Kleinen Rats (1225–1798) in der Übersicht. */
export const HUB_RAT_PREVIEW = 6;

export type RegisterSource = Exclude<SearchView, "all">;

/** Quellen in der Reihenfolge der Reiterleiste, mit deren Namen. */
export const REGISTER_SOURCES: ReadonlyArray<{ id: RegisterSource; label: string }> = SEARCH_VIEWS.flatMap((v) =>
	v.id === "all" ? [] : [{ id: v.id as RegisterSource, label: v.label }],
);

/** Suchwort der Übersicht aus `?q=`: Leerraum zusammengefasst, gekürzt; ohne Buchstabe oder
 *  Ziffer leer (das Verzeichnis der Rats- und Regierungsmitglieder zeigte sonst alle). */
export function parseHubQuery(sp: URLSearchParams): string {
	const q = (sp.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, HUB_QUERY_MAX);
	return /[\p{L}\p{N}]/u.test(q) ? q : "";
}

export function registerHubHref(q = ""): string {
	return q ? `/register?${new URLSearchParams({ q })}` : "/register";
}

/** Suchbegriff der Volltextsuche: mehrere Wörter als Wortfolge («"Heinrich Bullinger"»), eine
 *  getippte Wortfolge oder ein einzelnes Wort unverändert. */
export function fullTextQuery(q: string): string {
	const t = q.trim();
	return /\s/.test(t) && !t.includes('"') ? `"${t}"` : t;
}

/** Volltextsuche im Reiter «Alle Quellen» (Standard der Suchseite). */
export function fullTextHref(q: string): string {
	return `/search?${new URLSearchParams({ q: fullTextQuery(q) })}`;
}

/** Pfade, die zum Menüpunkt «Register» gehören (mit ihren Unterseiten). */
const REGISTER_PATHS = ["/register", "/personen", "/rat", "/archivkatalog/register", "/editionen/register"];

export function isRegisterPath(pathname: string): boolean {
	return REGISTER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
