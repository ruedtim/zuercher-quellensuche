/**
 * Namensfilter (Personen, Orte, Organisationen) als Meili-Klausel: genau diese
 * Form ODER derselbe Vergleichsschlüssel (entityKey.ts). So bedeutet ein Name in
 * jedem Reiter dasselbe – «Fischental» findet auch «Fischenthal». Formen ohne
 * Schlüssel (ein nackter Nachname) wirken nur exakt.
 *
 * Der documents-Index speichert die Schlüssel in Fassung 2 (personKeys,
 * placeKeys, orgKeys; services/indexer), die Editionen in Fassung 1. Pur und
 * browserfähig; unit-getestet in entityFilter.test.ts.
 */

import { entityKey, entityKeyV2, type EntityKind } from "./entityKey";

export type EntityDim = "persons" | "places" | "organizations";
export const ENTITY_DIMS: readonly EntityDim[] = ["persons", "places", "organizations"];
export const ENTITY_KIND: Record<EntityDim, EntityKind> = { persons: "person", places: "place", organizations: "org" };

/** Schlüsselfelder des documents-Index (Fassung 2). */
export const DOCUMENT_KEY_FIELD: Record<EntityDim, string> = {
	persons: "personKeys",
	places: "placeKeys",
	organizations: "orgKeys",
};

/** Schlüssel der Werte (ohne Werte ohne Schlüssel, ohne Dubletten). */
export function keysOf(values: readonly string[], keyOf: (v: string) => string | null): string[] {
	return [...new Set(values.map(keyOf).filter((k): k is string => !!k))];
}

/**
 * «field IN [Formen]», mit Schlüsselfeld als «(field IN [Formen] OR keyField IN [Schlüssel])».
 * `keyField: null` = nur exakt (Index ohne Schlüssel).
 */
export function entityClause(
	values: readonly string[],
	field: string,
	keyField: string | null,
	keyOf: (v: string) => string | null,
	quote: (v: string) => string,
): string | null {
	if (values.length === 0) return null;
	const forms = `${field} IN [${values.map(quote).join(", ")}]`;
	const keys = keyField ? keysOf(values, keyOf) : [];
	return keys.length > 0 ? `(${forms} OR ${keyField} IN [${keys.map(quote).join(", ")}])` : forms;
}

/** Schlüssel eines Werts im documents-Index (Fassung 2). */
export function documentEntityKey(dim: EntityDim, value: string): string | null {
	return entityKeyV2(ENTITY_KIND[dim], value);
}

/** Hat einer der Werte einen Schlüssel (findet der Filter also auch andere Schreibungen)? */
export function hasDocumentKey(dim: EntityDim, values: readonly string[]): boolean {
	return values.some((v) => documentEntityKey(dim, v) !== null);
}

/** Klausel einer Dimension im documents-Index; `keyed` = der Index trägt die Schlüssel. */
export function documentEntityClause(
	dim: EntityDim,
	values: readonly string[],
	keyed: boolean,
	quote: (v: string) => string,
): string | null {
	return entityClause(values, dim, keyed ? DOCUMENT_KEY_FIELD[dim] : null, (v) => documentEntityKey(dim, v), quote);
}

/** Klausel einer Dimension in den Editionen (Fassung 1; Organisationen heissen dort `orgs`). */
/** Name mit Zusatz in Klammern, wie der Aufbau der Editionen Namensvettern trennt
 *  («Ulrich Zwingli (1556–1601)», «Nikolaus von Flüe (Heiliger)»). personKey streicht die
 *  Klammer und vereinte sie wieder mit dem Namensvetter – solche Namen gelten nur exakt. */
export function isQualifiedPersonName(value: string): boolean {
	return /\([^)]*\)/.test(value);
}

export function editionEntityClause(
	dim: EntityDim,
	values: readonly string[],
	quote: (v: string) => string,
): string | null {
	const field = dim === "organizations" ? "orgs" : dim;
	const keyOf = (v: string) => (dim === "persons" && isQualifiedPersonName(v) ? null : entityKey(ENTITY_KIND[dim], v));
	return entityClause(values, field, DOCUMENT_KEY_FIELD[dim], keyOf, quote);
}

type EntityLists = Partial<Record<EntityDim, readonly string[] | undefined>>;

/**
 * Die Formen eines Treffers, die über den Schlüssel auf einen gewählten Namen
 * passen (für die Hervorhebung: gewählt «Fischental», im Text «Fischenthal»).
 * Ohne die gewählten Formen selbst.
 */
export function variantFormsInHit(hit: EntityLists, selected: EntityLists): string[] {
	const out = new Set<string>();
	for (const dim of ENTITY_DIMS) {
		const chosen = selected[dim] ?? [];
		const forms = hit[dim] ?? [];
		if (chosen.length === 0 || forms.length === 0) continue;
		const keys = new Set(keysOf(chosen, (v) => documentEntityKey(dim, v)));
		if (keys.size === 0) continue;
		const exact = new Set(chosen);
		for (const f of forms) {
			if (exact.has(f)) continue;
			const k = documentEntityKey(dim, f);
			if (k && keys.has(k)) out.add(f);
		}
	}
	return [...out];
}
