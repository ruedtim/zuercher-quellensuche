/**
 * Register der Editionen (Seiten /editionen/register/<typ>, Namenssuche der Übersicht
 * /register): aus allen Stücken des Index `editions` gebaut (editionRegisterPieces), 1 h
 * gecacht (stale-while-revalidate, ein Aufbau zur Zeit; QZH: 790 Stücke, eine Abfrage). Suche,
 * Sortierung und Anzeige pur in $lib/editionRegister.ts.
 */

import { editionRegisterPieces, editionsReady } from "./editionTexts";
import { buildEditionRegister, filterEditionRegister, type EditionRegister, type EditionRegisterEntry } from "$lib/editionRegister";
import { REGISTER_PAGE_SIZE, type RegisterKindInfo, type RegisterQuery } from "$lib/catalogRegister";
import type { EntityKind } from "$lib/entityKey";

const TTL_MS = 60 * 60_000;
const RETRY_MS = 60_000;
let cached: { value: EditionRegister | null; expires: number } | null = null;
let loading: Promise<EditionRegister | null> | null = null;

async function build(): Promise<EditionRegister | null> {
	try {
		if (!(await editionsReady())) return null;
		const started = Date.now();
		const register = buildEditionRegister(await editionRegisterPieces());
		console.log(
			`[edition-register] ${register.pieces} Stücke: ${register.person.entries.length} Personen, ${register.place.entries.length} Orte, ${register.org.entries.length} Organisationen (${Date.now() - started} ms)`,
		);
		return register;
	} catch (err) {
		console.warn(`[edition-register] nicht lesbar: ${(err as Error).message}`);
		return null;
	}
}

/** Das Register (gecacht); null, wenn der Index nicht lesbar ist. */
export async function editionRegister(): Promise<EditionRegister | null> {
	const now = Date.now();
	if (cached && cached.expires > now) return cached.value;
	if (!loading) {
		loading = build()
			.then((value) => {
				const kept = value ?? cached?.value ?? null;
				cached = { value: kept, expires: Date.now() + (value ? TTL_MS : RETRY_MS) };
				return kept;
			})
			.finally(() => {
				loading = null;
			});
	}
	return cached?.value ? cached.value : loading;
}

/**
 * Eintrag des Personenregisters der Editionen mit dieser GND – Brücke zum Register des Kleinen Rats
 * (Personenseite /rat/<Id>). Null ohne Eintrag, ohne lesbaren Index oder nach `budgetMs`: Das
 * Register entsteht beim ersten Aufruf aus allen Stücken, die Personenseite wartet nicht darauf.
 */
export async function editionPersonByGnd(gnd: string, budgetMs = 2500): Promise<EditionRegisterEntry | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), budgetMs);
	});
	try {
		const register = await Promise.race([editionRegister().catch(() => null), timeout]);
		return register?.person.entries.find((e) => e.gnd === gnd) ?? null;
	} finally {
		clearTimeout(timer);
	}
}

export interface EditionRegisterPage {
	entries: EditionRegisterEntry[];
	total: number;
	page: number;
	pages: number;
	/** Einträge je Typ (Reiter der Seite). */
	sizes: Record<EntityKind, number>;
	/** Stücke, aus denen das Register gebaut ist. */
	pieces: number;
}

/** Eine Seite des Registers; null, wenn der Index nicht lesbar ist. */
export async function editionRegisterPage(info: RegisterKindInfo, query: RegisterQuery): Promise<EditionRegisterPage | null> {
	const register = await editionRegister();
	if (!register) return null;
	const found = filterEditionRegister(info.kind, register[info.kind], query);
	const pages = Math.max(1, Math.ceil(found.length / REGISTER_PAGE_SIZE));
	const page = Math.min(query.page, pages);
	return {
		entries: found.slice((page - 1) * REGISTER_PAGE_SIZE, page * REGISTER_PAGE_SIZE),
		total: found.length,
		page,
		pages,
		sizes: { person: register.person.entries.length, place: register.place.entries.length, org: register.org.entries.length },
		pieces: register.pieces,
	};
}

/** Die ersten `n` Treffer einer Suche je Typ und ihre Zahl (Übersicht /register); null ohne Index. */
export async function editionRegisterPreview(q: string, n: number): Promise<Record<EntityKind, { entries: EditionRegisterEntry[]; total: number }> | null> {
	const register = await editionRegister();
	if (!register) return null;
	const one = (kind: EntityKind) => {
		const found = filterEditionRegister(kind, register[kind], { q, sort: "count" });
		return { entries: found.slice(0, n), total: found.length };
	};
	return { person: one("person"), place: one("place"), org: one("org") };
}
