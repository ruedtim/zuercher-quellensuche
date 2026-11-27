/**
 * Nennung und Links zum Register des Kleinen Rats (Staatsarchiv des Kantons
 * Zürich). Single Source of Truth für alles, was nach aussen sichtbar ist –
 * Reiter «Rat» der Ratsmanual-Seiten, später Personenseiten, API und Doku.
 *
 * zh.ch nennt keine Lizenz, darum keine Lizenzangabe, sondern die Herkunft: Das Register
 * geht auf Werner Schnyders «Zürcher Ratslisten» zurück.
 *
 * Browserfähig (keine Imports), weil Links und Nennung auch im UI gebraucht werden.
 */

/** Was an der Zusammenstellung genannt werden muss. */
export const RAT_ATTRIBUTION = "Staatsarchiv des Kantons Zürich, Der Kleine Rat des Stadtstaats Zürich 1225–1798";

/** Woher die Daten stammen – gehört zur Nennung dazu. */
export const RAT_PROVENANCE =
	"nach Werner Schnyder, Die Zürcher Ratslisten 1225–1798 (Zürich 1962)";

/** Seite des Staatsarchivs, auf der das Register steht. */
export const RAT_SOURCE_URL = "https://www.zh.ch/de/politik-staat/recherche-im-staatsarchiv/zuercher-geschichte.html";

/** Stand des Abzugs, aus dem das Register gebaut ist. */
export const RAT_AS_OF = "2026-11-17";

export function gndUrl(gnd: string): string {
	return `https://d-nb.info/gnd/${encodeURIComponent(gnd)}`;
}

/** Ohne Versionsdatum, damit der Link auf die aktuelle Fassung des Artikels zeigt. */
export function hlsUrl(article: string): string {
	return `https://hls-dhs-dss.ch/de/articles/${encodeURIComponent(article)}/`;
}

/** Personendatenbank der Sammlung Schweizerischer Rechtsquellen («per002157»): dorthin leitet die
 *  SSRQ ihre ältere Adresse `www.ssrq-sds-fds.ch/persons-db-edit/?query=…` weiter. */
export function ssrqUrl(id: string): string {
	return `https://personae.ssrq-sds-fds.ch/?query=${encodeURIComponent(id)}`;
}

/** Normdaten eines in Transkribus ausgezeichneten Namens: Der Indexer setzt `data-gnd`, `data-hls`
 *  und `data-ssrq` aus `persName/@ref` (meist der Vorsitz im Sitzungskopf). */
export interface PersonRefs {
	gnd: string | null;
	/** HLS-Artikel («018060»). */
	hls: string | null;
	/** Personen-ID der Rechtsquellen («per002157», selten mit Buchstaben «per026517a»). */
	ssrq: string | null;
}

const REF_KEYS = ["gnd", "hls", "ssrq"] as const;
const REF_VALUE: Record<(typeof REF_KEYS)[number], RegExp> = {
	gnd: /^[0-9][0-9X-]{5,11}$/,
	hls: /^[0-9]{6}$/,
	ssrq: /^per[0-9]{6}[a-z]?$/,
};

/** Die ausgezeichneten Personen im gerenderten Text einer Sitzung, je Person einmal (über die GND,
 *  sonst die SSRQ-ID), in der Reihenfolge der ersten Nennung; was eine spätere Nennung mehr weiss,
 *  kommt dazu. Namen ohne GND und SSRQ-ID fehlen. */
export function personRefsInHtml(html: string | null | undefined): PersonRefs[] {
	const out: PersonRefs[] = [];
	for (const [tag] of (html ?? "").matchAll(/<span class="tei-person"[^>]*>/g)) {
		const refs: PersonRefs = { gnd: null, hls: null, ssrq: null };
		for (const k of REF_KEYS) {
			const v = new RegExp(`\\sdata-${k}="([^"]*)"`).exec(tag)?.[1] ?? "";
			if (REF_VALUE[k].test(v)) refs[k] = v;
		}
		if (!refs.gnd && !refs.ssrq) continue;
		const same = out.find((r) => (refs.gnd !== null && r.gnd === refs.gnd) || (refs.ssrq !== null && r.ssrq === refs.ssrq));
		if (!same) out.push(refs);
		else for (const k of REF_KEYS) same[k] ??= refs[k];
	}
	return out;
}

// --- Personenseiten und Verzeichnis (/rat, /rat/<Id>) -----------------------

export const RAT_DIRECTORY_PAGE_SIZE = 48;
const MAX_PAGE = 1000;

/** Jahrhunderte des Registers (1225–1798) für den Filter. */
export const RAT_CENTURIES = [13, 14, 15, 16, 17, 18] as const;
export type RatCentury = (typeof RAT_CENTURIES)[number];

export interface RatDirectoryQuery {
	/** Namenssuche (Vor- und Nachname, Wortanfänge, ohne Akzente). */
	q: string;
	/** Zunft, wie das Register sie schreibt; leer = alle. */
	guild: string;
	/** Funktion; leer = alle. */
	office: string;
	/** Nur Personen mit Einsitz in diesem Jahrhundert. */
	century: RatCentury | null;
	/** Nur Personen mit Einsitz in der Zeit der Ratsmanuale (1484–1798). */
	rmOnly: boolean;
	sort: "name" | "entry";
	page: number;
}

export const DEFAULT_RAT_DIRECTORY_QUERY: RatDirectoryQuery = {
	q: "",
	guild: "",
	office: "",
	century: null,
	rmOnly: false,
	sort: "name",
	page: 1,
};

const clip = (raw: string | null, max: number): string => (raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** URL-Parameter → Abfrage; Ungültiges fällt still auf den Default. Zunft und Funktion prüft
 *  der Server gegen die Werte des Registers (unbekannt = kein Treffer, kein Fehler). */
export function parseRatDirectoryQuery(params: URLSearchParams): RatDirectoryQuery {
	const century = Number(params.get("jh"));
	const page = Number(params.get("seite"));
	return {
		q: clip(params.get("q"), 80),
		guild: clip(params.get("zunft"), 60),
		office: clip(params.get("funktion"), 60),
		century: (RAT_CENTURIES as readonly number[]).includes(century) ? (century as RatCentury) : null,
		rmOnly: params.get("rm") === "1",
		sort: params.get("sort") === "eintritt" ? "entry" : "name",
		page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
	};
}

export function ratDirectoryUrl(q: Partial<RatDirectoryQuery> = {}): string {
	const params = new URLSearchParams();
	if (q.q) params.set("q", q.q);
	if (q.guild) params.set("zunft", q.guild);
	if (q.office) params.set("funktion", q.office);
	if (q.century) params.set("jh", String(q.century));
	if (q.rmOnly) params.set("rm", "1");
	if (q.sort === "entry") params.set("sort", "eintritt");
	if (q.page && q.page > 1) params.set("seite", String(q.page));
	const qs = params.toString();
	return `/rat${qs ? `?${qs}` : ""}`;
}

export function ratPersonUrl(id: number): string {
	return `/rat/${id}`;
}

/**
 * Die Ratsmanual-Sitzungen bestimmter Bände in der Suche, nach Datum. Die Bände
 * tragen die Ratshälfte, darum filtert die Liste über `volumeNr` – nicht über ein
 * Datum, das die Bandgrenze (Weihnachten, Johanni) nicht trifft.
 */
export function rmSessionsHref(volumes: readonly number[], q = ""): string {
	const params = new URLSearchParams({ series: "RM", volumeNr: volumes.join(","), sort: "date_asc", view: "documents" });
	if (q) params.set("q", q);
	return `/search?${params}`;
}
