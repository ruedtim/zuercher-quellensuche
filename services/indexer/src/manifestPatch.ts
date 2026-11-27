import { isLocalUrl } from "./publicBaseUrl.ts";

/** Soll-Stand eines Docs für --patch-manifests (null = kein Faksimile). */
export interface ManifestPatch {
  id: string;
  manifestUrl: string | null;
}

export interface ManifestDiff {
  /** Abweichende Docs – nur diese gehen als updateDocuments raus. */
  changes: ManifestPatch[];
  unchanged: number;
  /** IDs ohne Meili-Eintrag: übersprungen, ein Patch legte Rumpf-Docs an. */
  missing: string[];
  /** Änderungen, deren alter Wert auf localhost zeigte (der erwartete Fall). */
  fromLocalhost: number;
  /** Übrige Änderungen – unerwartet, darum im Log sichtbar machen. */
  other: Array<{ id: string; old: string | null; next: string | null }>;
}

/**
 * Vergleicht den Soll-Stand eines Batches mit dem Ist-Stand aus Meili
 * (`current` = nur die gefundenen Docs; fehlendes Feld zählt als null).
 */
export function diffManifestUrls(
  batch: ManifestPatch[],
  current: Array<{ id: string; manifestUrl?: string | null }>,
): ManifestDiff {
  const before = new Map(current.map((d) => [d.id, d.manifestUrl ?? null]));
  const out: ManifestDiff = { changes: [], unchanged: 0, missing: [], fromLocalhost: 0, other: [] };
  for (const d of batch) {
    if (!before.has(d.id)) {
      out.missing.push(d.id);
      continue;
    }
    const old = before.get(d.id) ?? null;
    if (old === d.manifestUrl) {
      out.unchanged++;
      continue;
    }
    out.changes.push(d);
    if (old !== null && isLocalUrl(old)) out.fromLocalhost++;
    else out.other.push({ id: d.id, old, next: d.manifestUrl });
  }
  return out;
}
