// Reine (env-freie) Bausteine des föderierten Einstiegs `search` und der ID-Auflösung
// von `fetch`/`fetch_many`: Bestands-Reihenfolge, ID-Präfixe, Zusammenbau der Antwort
// und die Lesefassungen, mit denen `fetch` eine Katalogeinheit, einen Eheeintrag oder
// ein Editionsstück als Text liefert (ChatGPT-Konvention `{id,title,text,url}`).
// Bewusst ohne Meili-/Embed-Import (kein `$env`), damit per `npx tsx --test` prüfbar
// (mcp.test.ts); die Abfragen selbst macht mcp/tools.ts.
//
// Hintergrund (Prüfung 2026-11-17): `search` hiess «Durchsucht das Archiv», suchte aber
// nur in den vier Serien der Volltexte – `search("Pause")` lieferte zehn semantische
// Nachbarn über Urlaub und Ausstand, während der Archivkatalog 83 Einheiten führt, die
// wörtlich «Pause» heissen (Lichtpausen, «Pause der Karte des deutschen Südwestens»).
// Seither fragt `search` alle Bestände parallel ab, wie der Reiter «Alle Quellen» der
// Website.

import { leanCatalogItem } from "./lean";

/** Die Bestände, die `search` abfragt – in der Reihenfolge der Reiter der Website
 *  («Alle Quellen»: Archivkatalog, Zentrale Serien, Ehedaten, Editionen; Entscheid
 *  Tim 2026-11-02). Sie ist auch die Reihenfolge der flachen Trefferliste. */
export const FEDERATED_COLLECTIONS = ["catalog", "documents", "ehedaten", "editions"] as const;

export type FederatedCollection = (typeof FEDERATED_COLLECTIONS)[number];

// ID-Präfixe der Zusatzbestände. Ein Dokument behält seine nackte id
// («MM_3_1_RRB_1887_2264») – alte Clients, Resource-URIs (zszh://document/<id>) und
// die Links der /api/v1 bleiben damit gültig. Dokument-ids enthalten keinen
// Doppelpunkt, die Präfixe können also nicht mit ihnen kollidieren.
const COLLECTION_PREFIX: Record<Exclude<FederatedCollection, "documents">, string> = {
	catalog: "catalog:",
	ehedaten: "ehe:",
	editions: "edition:",
};

/** Die Präfix-Formen für Beschreibungen und Hinweise («catalog:669821, ehe:4505350, edition:QZH_401»). */
export const ID_PREFIX_HELP = "catalog:<Katalog-ID>, ehe:<Katalog-ID>, edition:<Kennung>";

/** `<id>` eines Bestands in die Form, die `fetch` wieder auflöst. */
export function federatedId(collection: FederatedCollection, id: string | number): string {
	return collection === "documents" ? String(id) : `${COLLECTION_PREFIX[collection]}${id}`;
}

/** Umkehrung von federatedId: Präfix → Bestand, alles andere ist eine Dokument-id.
 *  Leere Eingabe ⇒ null. Pure → testbar. */
export function parseFederatedId(raw: unknown): { collection: FederatedCollection; id: string } | null {
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return null;
	for (const [collection, prefix] of Object.entries(COLLECTION_PREFIX)) {
		if (s.toLowerCase().startsWith(prefix)) {
			const id = s.slice(prefix.length).trim();
			return id ? { collection: collection as FederatedCollection, id } : null;
		}
	}
	return { collection: "documents", id: s };
}

// --- Antwort von `search` ------------------------------------------------------

/** Ergebnis eines Bestands für federatedSearchOutput. */
export interface FederatedBlock {
	collection: FederatedCollection;
	/** Trefferzahl der WÖRTLICHEN Suche; null = nicht zählbar (nur nach Bedeutung gereiht). */
	total: number | null;
	/** Treffer, wörtlicher Arm zuerst; jeder trägt `collection` und `ranking`. */
	results: Array<Record<string, unknown>>;
	/** Gesetzt, wenn der Bestand nicht abgefragt wurde: Index/Suchschlüssel fehlt
	 *  ("not_available") oder die Abfrage ist gescheitert ("failed"). */
	unavailable?: "not_available" | "failed";
	/** Hinweis dieses Bestands (Wortanfänge im Katalog, Gegenproben der Dokumente). */
	hint?: string;
}

/** Konstanter Hinweis in jeder Antwort von `search`: was abgedeckt ist und wie es weitergeht.
 *  Kurz gehalten – manche Clients lesen nur Werkzeug-Ergebnisse, nie die Server-Anweisungen. */
export const FEDERATED_SEARCH_NOTE =
	"search fragt alle Bestände parallel ab; `collection` nennt den Bestand, `ranking` unterscheidet " +
	"wörtliche Treffer von thematischen Nachbarn, `totals` die wörtliche Trefferzahl je Bestand " +
	"(eine 0 heisst: dort wurde gesucht und nichts gefunden; fehlt ein Bestand ganz, steht er in `unavailable`). " +
	`Volltext bzw. alle Angaben eines Treffers mit fetch und seiner id (${ID_PREFIX_HELP}, Dokumente ohne Präfix). ` +
	"Für Textstellen im Originalwortlaut passage_search, für Filter, Zählungen und Verläufe die Werkzeuge des Bestands.";

/** Hinweis, wenn kein Bestand einen Treffer hat. */
export const FEDERATED_ZERO_HINT =
	"Kein Bestand hat einen Treffer. Mit weniger oder anderen Wörtern suchen, alte Schreibweisen " +
	"ergänzen (keyword_search mit alternatives), eine ganze Frage an passage_search stellen oder " +
	"catalog_search mit semantic=true versuchen.";

/**
 * Baut die Antwort von `search` aus den Bestands-Blöcken: eine FLACHE `results`-Liste
 * (ChatGPT-Konvention `{id,title,url}`, dazu `collection` und `ranking` je Treffer) und
 * ein `totals`-Objekt je Bestand, damit das Modell die Grössenordnungen sieht. Blöcke in
 * der Reihenfolge von FEDERATED_COLLECTIONS; nicht abgefragte Bestände stehen in
 * `unavailable` und fehlen in `totals` (eine 0 dort würde heissen «nichts vorhanden»).
 * Pure → testbar.
 */
export function federatedSearchOutput(query: string, blocks: readonly FederatedBlock[]): Record<string, unknown> {
	const order = new Map(FEDERATED_COLLECTIONS.map((c, i) => [c, i]));
	const sorted = [...blocks].sort((a, b) => (order.get(a.collection) ?? 99) - (order.get(b.collection) ?? 99));
	const results: Array<Record<string, unknown>> = [];
	const totals: Record<string, number> = {};
	const unavailable: Array<{ collection: string; reason: string }> = [];
	const hints: string[] = [];
	for (const b of sorted) {
		if (b.unavailable) {
			unavailable.push({ collection: b.collection, reason: b.unavailable });
			continue;
		}
		results.push(...b.results);
		if (b.total != null) totals[b.collection] = b.total;
		if (b.hint) hints.push(b.hint);
	}
	const searched = sorted.filter((b) => !b.unavailable);
	// Alles abgesucht und nichts gefunden: Gegenproben statt eines vorschnellen «gibt es nicht».
	if (searched.length > 0 && results.length === 0) hints.push(FEDERATED_ZERO_HINT);
	return {
		query,
		results,
		count: results.length,
		totals,
		...(unavailable.length > 0 ? { unavailable } : {}),
		...(hints.length > 0 ? { hint: hints.join(" ") } : {}),
		note: FEDERATED_SEARCH_NOTE,
	};
}

/** Katalogtreffer für die Trefferliste von `search`: ohne den Archivplan-Pfad und die
 *  Digitalisat-Links. Der Pfad allein macht zwei Drittel der Grösse eines Treffers aus
 *  (gemessen 1'276 von 1'962 Zeichen, weil jede Stufe id, Etikett und URL trägt); zum
 *  Einordnen genügen Signatur, Stufe, Bestand und `fileCount`, den ganzen Kontext liefern
 *  catalog_search und fetch. Pure → testbar. */
/** Katalogtreffer im föderierten Einstieg: dieselbe schlanke Form wie `catalog_search`
 *  (`leanCatalogItem`: `pathText` statt `path`, ohne `links`, leere Felder weg), nur ohne
 *  die Liste der Digitalisat-Dateien – die Vorschau nennt `fileCount` und
 *  `hasDigitization`, `fetch` liefert die Dateien. Bis 2026-11-17 warf diese Funktion den
 *  Archivplan-Pfad ganz weg und behielt die Links: dasselbe Objekt kam so in zwei Formen
 *  beim Modell an, je nachdem, ob es über `search` oder `catalog_search` gefunden wurde. */
export function leanCatalogResult(item: Record<string, unknown>): Record<string, unknown> {
	const { files: _files, ...rest } = item;
	return leanCatalogItem(rest);
}

// --- Lesefassungen für `fetch` -------------------------------------------------

/** Hüllt einen Treffer in die Form, die `fetch` liefert (ChatGPT-Konvention): die
 *  auflösbare id, Titel, Text, URL und alle übrigen Angaben in `metadata` (dort steht
 *  unter `id` die nackte Kennung des Bestands). Pure → testbar. */
export function federatedFetchDoc(
	collection: FederatedCollection,
	id: string | number,
	parts: { title: string; text: string; url: string | null },
	item: Record<string, unknown>,
): Record<string, unknown> {
	return {
		id: federatedId(collection, id),
		title: parts.title,
		text: parts.text,
		url: parts.url,
		metadata: { collection, ...item },
	};
}

function lines(parts: Array<string | null | undefined>, sep = " · "): string {
	return parts.filter((p) => p && p.trim()).join(sep);
}

/** Lesefassung einer Verzeichnungseinheit: Kopfangaben, Archivplan-Pfad und «Inhalt und
 *  Form» bzw. Regest. Der Katalog verzeichnet die Einheit, einen Volltext gibt es nicht –
 *  das sagt der Text ausdrücklich, damit ein Modell ihn nicht als Quellentext zitiert. */
export function catalogFetchText(u: {
	signature?: string | null;
	level?: string | null;
	dateText?: string | null;
	bestand?: string | null;
	provenienz?: string | null;
	path?: readonly string[];
	text?: string | null;
	fileCount?: number;
}): string {
	const head = lines([
		u.signature ? `Signatur: ${u.signature}` : null,
		u.level ? `Stufe: ${u.level}` : null,
		u.dateText ? `Entstehungszeitraum: ${u.dateText}` : null,
		u.bestand ? `Bestand: ${u.bestand}` : null,
		u.provenienz ? `Provenienz: ${u.provenienz}` : null,
		u.fileCount && u.fileCount > 0 ? `Digitalisat: ${u.fileCount} Datei(en)` : null,
	]);
	const path = u.path && u.path.length > 0 ? `Archivplan: ${u.path.join(" › ")}` : "";
	const body = (u.text ?? "").trim();
	return lines(
		[
			head,
			path,
			body,
			"Verzeichnungsangaben des Archivkatalogs; der Katalog enthält keinen Volltext der Akten.",
		],
		"\n\n",
	);
}

/** Lesefassung eines Eheeintrags: der Titel des Katalogs («Nachname, Vorname …, getraut
 *  mit …»), Art, Datum, Kirchgemeinde und Signatur, dazu die Zusatzinformationen. */
export function ehedatenFetchText(e: {
	title?: string | null;
	typeLabel?: string | null;
	date?: string | null;
	parish?: string | null;
	signature?: string | null;
	notes?: readonly (string | null | undefined)[];
}): string {
	const head = lines([
		e.typeLabel,
		e.date,
		e.parish ? `Kirchgemeinde ${e.parish}` : null,
		e.signature ? `Signatur ${e.signature}` : null,
	]);
	const notes = (e.notes ?? []).filter((n): n is string => !!n && n.trim() !== "");
	return lines([(e.title ?? "").trim(), head, ...notes.map((n) => `Zusatzinformation: ${n}`)], "\n\n");
}

/** Lesefassung eines Editionsstücks: Regest und der Text in der Lesefassung der Suche
 *  (der Text der Edition mit Auszeichnung steht als `html` in `metadata`). */
export function editionFetchText(p: { regest?: string | null; text?: string | null }): string {
	return lines([p.regest ? `Regest: ${p.regest.trim()}` : null, (p.text ?? "").trim()], "\n\n");
}
