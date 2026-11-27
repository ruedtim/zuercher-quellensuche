// Geteilte, $env-freie Bausteine für Dokument-Querverweise (`<listRelation>`):
// die lesbaren Labels der Relations-Typen und die öffentliche API-Form. Wird
// sowohl vom Web-Loader (Detailseite) als auch von der apiV1-/MCP-Schicht
// genutzt, damit Label-Übersetzung und Shape an einer Stelle leben.

import type { SeriesAbbr } from "./types";

// Relations-Typ → lesbares Label (Richtung aus Sicht des aktuellen Dokuments).
// `active` ist immer das eigene Dokument, `passive`/Ziel das verlinkte. Fallback:
// Unterstriche durch Leerzeichen ersetzen.
export const RELATION_LABELS: Record<string, string> = {
	// OS – Gesetzgebungs-Historie
	"Änderung_von": "Ändert",
	"Änderung_siehe": "Geändert durch",
	"Aufhebung_von": "Hebt auf",
	"Aufhebung_siehe": "Aufgehoben durch",
	"Hebt_auf": "Hebt auf",
	"Aufgehoben_durch": "Aufgehoben durch",
	"Inkraftsetzung_von": "Inkraftsetzung",
	"Inkraftsetzung_siehe": "Inkraftsetzung",
	"Siehe": "Siehe auch",
	// KRP – Geschäftsgang
	"Fortsetzung_von": "Fortsetzung von",
	"Fortsetzung_siehe": "Fortsetzung",
	"Entwurf_von": "Entwurf von",
	"Entwurf_siehe": "Entwurf",
};

export function relationLabel(name: string): string {
	return RELATION_LABELS[name] ?? name.replace(/_/g, " ");
}

/**
 * Aufgelöster Querverweis in öffentlicher API-Form (/api/v1, MCP fetch):
 * Relations-Typ + lesbares Label + Katalog-URL, und – falls das Ziel im Korpus
 * liegt – ein verschachteltes `document` mit `/api/v1`- und Web-Link. `document`
 * ist `null`, wenn das Ziel nicht im Korpus ist (dann nur der externe
 * `catalogUrl`).
 */
export interface ApiRelation {
	type: string;
	label: string;
	archiveId: number | null;
	catalogUrl: string;
	document: {
		id: string;
		series: SeriesAbbr;
		title: string;
		date: string | null;
		links: { self: string; web: string };
	} | null;
}
