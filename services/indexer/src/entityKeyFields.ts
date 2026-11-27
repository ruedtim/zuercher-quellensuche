/**
 * Vergleichsschlüssel der Namen im documents-Index: `personKeys`, `placeKeys`,
 * `orgKeys` zu den erkannten Formen `persons`, `places`, `organizations`. Ein
 * Namensfilter der Web-App trifft damit «diese Form ODER denselben Schlüssel»
 * (apps/web/src/lib/entityFilter.ts) – «Fischental» findet auch «Fischenthal».
 *
 * Gerechnet mit Fassung 2 von entityKey.ts (`entityKeyV2`; Fassung 1 bleibt den
 * Indizes catalog, ehedaten und editions). Die Datei liegt als Kopie in
 * src/vendor/ – der Indexer läuft auf dem Server aus `services/indexer/` allein,
 * ein Import aus apps/web bräche dort. Die Kopie hält `npm run sync-entity-key`
 * aktuell, entityKeyVendor.test.ts schlägt bei Abweichung an. Je Feld ohne
 * Dubletten, sortiert, leer ohne Schlüssel (ein nackter Nachname hat keinen) –
 * genau wie die Web-App die Schlüssel der Filterwerte bildet
 * (entityKeyFields.test.ts gleicht gegen sie ab). Die Felder sind nur filterbar,
 * weder displayed noch searchable (meili.ts).
 *
 * Pur, unit-getestet in entityKeyFields.test.ts.
 */

import { entityKeyV2, type EntityKind } from "./vendor/entityKey.ts";

export interface EntityKeyFields {
  personKeys: string[];
  placeKeys: string[];
  orgKeys: string[];
}

/** Erkannte Namensformen eines Dokuments (fehlend = keine). */
export interface EntityForms {
  persons?: readonly string[] | null;
  places?: readonly string[] | null;
  organizations?: readonly string[] | null;
}

/** Schlüssel der Formen: Formen ohne Schlüssel und Dubletten fallen weg, sortiert. */
function keysOf(forms: readonly string[] | null | undefined, kind: EntityKind): string[] {
  const keys = new Set<string>();
  for (const form of forms ?? []) {
    const key = entityKeyV2(kind, form);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

/** Die drei Schlüsselfelder eines Dokuments (RM: keine erkannten Formen ⇒ leer). */
export function entityKeyFields(doc: EntityForms): EntityKeyFields {
  return {
    personKeys: keysOf(doc.persons, "person"),
    placeKeys: keysOf(doc.places, "place"),
    orgKeys: keysOf(doc.organizations, "org"),
  };
}

/**
 * Gleiche Schlüsselliste? Anders als `sameIds` (krdbFields.ts) gilt ein fehlendes
 * Feld NICHT als leere Liste: Die Web-App prüft per `placeKeys EXISTS`, ob der
 * Index die Schlüssel trägt – auch ein leeres Feld muss geschrieben sein.
 */
export function sameKeys(stored: readonly string[] | null | undefined, next: readonly string[]): boolean {
  return Array.isArray(stored) && stored.length === next.length && stored.every((k, i) => k === next[i]);
}

/** Ein Dokument, wie --patch-entity-keys es aus Meili liest. */
export interface StoredEntityDoc extends EntityForms {
  id: string;
  personKeys?: readonly string[] | null;
  placeKeys?: readonly string[] | null;
  orgKeys?: readonly string[] | null;
}

export type EntityKeyPatch = { id: string } & EntityKeyFields;

export interface EntityKeyDiff {
  /** Zu schreiben (updateDocuments): Docs mit fehlenden oder abweichenden Feldern. */
  patches: EntityKeyPatch[];
  /** Davon fehlt mindestens eines der drei Felder (nie geschrieben). */
  missing: number;
  /** Davon alle Felder vorhanden, mindestens eines weicht ab (z. B. nach einer Änderung an Fassung 2). */
  changed: number;
  unchanged: number;
  /** Docs mit mindestens einem Schlüssel (Plausibilität; RM hat keine). */
  withKeys: number;
}

/** Soll-Ist-Vergleich einer Seite: was --patch-entity-keys schreibt und zählt. */
export function diffEntityKeys(docs: readonly StoredEntityDoc[]): EntityKeyDiff {
  const out: EntityKeyDiff = { patches: [], missing: 0, changed: 0, unchanged: 0, withKeys: 0 };
  for (const d of docs) {
    const next = entityKeyFields(d);
    if (next.personKeys.length + next.placeKeys.length + next.orgKeys.length > 0) out.withKeys++;
    if (sameKeys(d.personKeys, next.personKeys) && sameKeys(d.placeKeys, next.placeKeys) && sameKeys(d.orgKeys, next.orgKeys)) {
      out.unchanged++;
      continue;
    }
    if (d.personKeys === undefined || d.placeKeys === undefined || d.orgKeys === undefined) out.missing++;
    else out.changed++;
    out.patches.push({ id: d.id, ...next });
  }
  return out;
}
