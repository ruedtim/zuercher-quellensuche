// Bandtabelle der Ratsmanuale (data/rm-bands.json, gebaut von
// `python -m rmtk.bandtable`, services/rm-transkribus): Jahr, Halbjahresrat und
// Schreiber je Band. Gebündelt als `?raw` wie das KRDB-Register, damit
// svelte-check aus dem JSON keinen Literaltyp ableitet; geparst beim ersten
// Zugriff. Ist die Datei kaputt, bleibt die Kopfzeile eben ohne Rat.
//
// Logik und Beschriftung liegen pur in $lib/rmBands.

import tableRaw from "./data/rm-bands.json?raw";
import { parseRmBandTable, rmBandViewFor, type RmBand, type RmBandView } from "$lib/rmBands";

let bands: Record<string, RmBand> | undefined;

function load(): Record<string, RmBand> {
	if (bands) return bands;
	try {
		bands = parseRmBandTable(JSON.parse(tableRaw));
	} catch (err) {
		console.warn("[rm] Bandtabelle nicht lesbar – Sitzungen ohne Rat:", err);
		bands = {};
	}
	return bands;
}

/** Band einer Ratsmanual-Sitzung (Schlüssel aus der Dokument-ID); null für andere Serien.
 *  Andere Serien kosten nicht einmal das Parsen der Tabelle. */
export function rmBandFor(id: string): RmBandView | null {
	return id.startsWith("RM_") ? rmBandViewFor(id, load()) : null;
}

/** Band nach Schlüssel («0441»); null, wenn die Tabelle ihn nicht kennt. */
export function rmBand(key: string): RmBand | null {
	return load()[key] ?? null;
}

/** Die ganze Tabelle (Schlüssel → Band) – für die Sitzungen einer Amtszeit (ratPeople.ts). */
export function rmBandTable(): Readonly<Record<string, RmBand>> {
	return load();
}
