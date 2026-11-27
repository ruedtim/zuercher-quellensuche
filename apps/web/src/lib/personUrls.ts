// URLs und Abfrage-Parameter der Personenseiten (/personen, /personen/<ID>).
// Pur und import-frei: wird vom Server-Lader UND von den Svelte-Seiten im Browser
// genutzt (darum nicht unter $lib/server). Unit-getestet (personUrls.test.ts).

export const PERSON_PAGE_SIZE = 20;
export const DIRECTORY_PAGE_SIZE = 48;
const MAX_PAGE = 5000;
export const FIRST_YEAR = 1803;

/** Welche Dokumente: alle zugeordneten, nur mit Nennung im Titel (Vorstösse,
 *  Anträge) oder nur im Text erwähnt. */
export type PersonScope = "all" | "title" | "text";
export type PersonSort = "date_asc" | "date_desc";

export interface PersonQuery {
	scope: PersonScope;
	sort: PersonSort;
	/** Jahresfenster der Zeitleiste (inklusive); null = offen. */
	from: number | null;
	to: number | null;
	page: number;
}

export const DEFAULT_PERSON_QUERY: PersonQuery = { scope: "all", sort: "date_desc", from: null, to: null, page: 1 };

export function intParam(raw: string | null, min: number, max: number): number | null {
	if (raw == null || !/^\d{1,6}$/.test(raw)) return null;
	const n = Number(raw);
	return n >= min && n <= max ? n : null;
}

/** URL-Parameter → Abfrage; Ungültiges fällt still auf den Default (nie ein Fehler). */
export function parsePersonQuery(params: URLSearchParams, nowYear: number): PersonQuery {
	const scope = params.get("umfang");
	const sort = params.get("sort");
	let from = intParam(params.get("von"), FIRST_YEAR, nowYear);
	let to = intParam(params.get("bis"), FIRST_YEAR, nowYear);
	if (from != null && to != null && from > to) [from, to] = [to, from];
	return {
		scope: scope === "titel" ? "title" : scope === "text" ? "text" : "all",
		sort: sort === "date_asc" ? "date_asc" : "date_desc",
		from,
		to,
		page: intParam(params.get("seite"), 1, MAX_PAGE) ?? 1,
	};
}

const SCOPE_PARAM: Record<PersonScope, string | null> = { all: null, title: "titel", text: "text" };

/** Personenseite mit den vom Default abweichenden Parametern. */
export function personUrl(id: number, q: Partial<PersonQuery> = {}): string {
	const params = new URLSearchParams();
	const scope = q.scope ? SCOPE_PARAM[q.scope] : null;
	if (scope) params.set("umfang", scope);
	if (q.sort && q.sort !== DEFAULT_PERSON_QUERY.sort) params.set("sort", q.sort);
	if (q.from != null) params.set("von", String(q.from));
	if (q.to != null) params.set("bis", String(q.to));
	if (q.page && q.page > 1) params.set("seite", String(q.page));
	const qs = params.toString();
	return `/personen/${id}${qs ? `?${qs}` : ""}`;
}

// --- Verzeichnis (/personen) ------------------------------------------------------

export type DirectoryCouncil = "" | "Kantonsrat" | "Regierungsrat" | "Grosser Rat" | "Kleiner Rat";
export const DIRECTORY_COUNCILS: Array<{ value: DirectoryCouncil; label: string }> = [
	{ value: "", label: "Alle Ämter" },
	{ value: "Kantonsrat", label: "Kantonsrat" },
	{ value: "Regierungsrat", label: "Regierungsrat" },
	{ value: "Grosser Rat", label: "Grosser Rat (1803–1830)" },
	{ value: "Kleiner Rat", label: "Kleiner Rat (1803–1830)" },
];

export interface DirectoryQuery {
	q: string;
	council: DirectoryCouncil;
	/** Nur Personen mit zugeordneten Dokumenten (nur wirksam, wenn die Zahlen vorliegen). */
	withDocs: boolean;
	sort: "name" | "docs";
	page: number;
}

export const DEFAULT_DIRECTORY_QUERY: DirectoryQuery = { q: "", council: "", withDocs: true, sort: "name", page: 1 };

export function parseDirectoryQuery(params: URLSearchParams): DirectoryQuery {
	const council = params.get("amt") ?? "";
	return {
		q: (params.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
		council: DIRECTORY_COUNCILS.some((c) => c.value === council) ? (council as DirectoryCouncil) : "",
		withDocs: params.get("alle") !== "1",
		sort: params.get("sort") === "docs" ? "docs" : "name",
		page: intParam(params.get("seite"), 1, MAX_PAGE) ?? 1,
	};
}

export function directoryUrl(q: Partial<DirectoryQuery> = {}): string {
	const params = new URLSearchParams();
	if (q.q) params.set("q", q.q);
	if (q.council) params.set("amt", q.council);
	if (q.withDocs === false) params.set("alle", "1");
	if (q.sort === "docs") params.set("sort", "docs");
	if (q.page && q.page > 1) params.set("seite", String(q.page));
	const qs = params.toString();
	return `/personen${qs ? `?${qs}` : ""}`;
}
