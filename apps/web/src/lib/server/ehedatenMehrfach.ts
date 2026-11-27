// Geprüfte Mehrfacheinträge der Ehedatenbank für Ehe-Karte, API und MCP.
// Die Liste (data/ehedaten-mehrfach.json, gebaut von services/catalog `main.ts
// ehedaten-mehrfach`) wird gebündelt und beim ersten Zugriff indexiert; `?raw` wie bei den
// Editions-Verweisen, damit svelte-check keinen Literaltyp aus dem JSON ableitet. Ist sie
// kaputt, gibt es eben keine geprüften Ehen (die Ehe-Karte zeigt dann die Heuristik).

import listRaw from "./data/ehedaten-mehrfach.json?raw";
import { indexEhedatenMehrfach, type EhedatenMehrfachIndex, type SameMarriage } from "$lib/ehedatenMehrfach";

let index: EhedatenMehrfachIndex | undefined;

function load(): EhedatenMehrfachIndex {
	if (index) return index;
	try {
		index = indexEhedatenMehrfach(JSON.parse(listRaw));
	} catch (err) {
		console.warn("[ehedaten] Liste der Mehrfacheinträge nicht lesbar – keine geprüften Ehen:", err);
		index = indexEhedatenMehrfach(null);
	}
	return index;
}

/** Die übrigen Einträge derselben Ehe laut Liste; null, wenn sie den Eintrag nicht führt. */
export function sameMarriageOf(id: number): SameMarriage | null {
	return load().forEntry(id);
}

/** Einträge, die nach ihren Angaben eine andere Ehe sind, obwohl die Namen gleich sind. */
export function distinctMarriagesOf(id: number): number[] {
	return load().distinctFrom(id);
}
