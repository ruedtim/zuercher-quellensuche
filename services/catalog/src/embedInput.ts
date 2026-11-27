/**
 * Welche Katalogeinheiten ein jina-Embedding bekommen und mit welchem Text
 * (Eingabe für embed/embed_catalog.py).
 *
 * Eingebettet werden eigene Treffer (nicht `onPlatform`, kein `stub`) ohne
 * Titelschema und die Patente: bei ihnen steht nach dem Doppelpunkt die
 * Erfindung («Anmelder, Ort: Verfahren zur Herstellung von …»), eingebettet wird
 * nur dieser Teil. Personendossiers, Ehedaten und Firmen nicht: ihre Titel sind
 * Namen, die ein Embedding nicht versteht. Kurze Texte («Akten», «Vorstand»)
 * bekommen die zwei nächsten Archivplan-Stufen als Kontext, sonst wären sie über
 * die Bedeutung nicht zu finden; längere nicht, weil der Pfad ihre Bedeutung
 * verwässert (Stichprobe 2026-10-30).
 */

import { parseTitleEntities } from "./titleSchema.ts";
import { readJsonl, writeJsonl } from "./load.ts";

export interface EmbedSource {
  id: number;
  title?: string | null;
  signature?: string | null;
  text?: string | null;
  path?: Array<{ id: number; label: string }> | null;
  onPlatform?: boolean;
  stub?: boolean;
}

/** Unterhalb dieser Länge (Titel + Beschreibung) kommt der Archivplan-Kontext dazu. */
export const SHORT_TEXT = 60;
/** jina liest bis 512 Token; mehr Zeichen braucht keine Einheit. */
export const MAX_CHARS = 2000;

/** Etikett einer Archivplan-Stufe ohne Laufzeit und Stufe: «Grippe, 1918-1922 (Dossier)» ⇒ «Grippe». */
export function pathLabel(label: string): string {
  return label
    .replace(/\s*\((?:Archiv|Hauptabteilung|Abteilung|Bestand|Teilbestand|Serie|Klasse|Dossier|Subdossier|Dokument)\)\s*$/, "")
    .replace(/,\s*(?:\d|ca\.|\[)[^,]*$/, "")
    .trim();
}

/** Text fürs Embedding, `null` = Einheit bekommt keinen Vektor. */
export function embedText(doc: EmbedSource): string | null {
  if (doc.stub || doc.onPlatform) return null;
  const title = (doc.title ?? "").trim();
  const signature = doc.signature ?? "";
  const schema = parseTitleEntities(title, signature).schema;
  if (schema === "person" || schema === "ehe" || schema === "firm") return null;
  let head = title;
  if (schema === "patent") {
    const [first, ...rest] = title.split("\n");
    head = [first.slice(first.indexOf(": ") + 2), ...rest].join("\n").trim();
  }
  const body = [head, (doc.text ?? "").trim()].filter(Boolean).join("\n");
  if (!body) return null;
  if (body.length >= SHORT_TEXT) return body.slice(0, MAX_CHARS);
  const context = (doc.path ?? [])
    .slice(-2)
    .map((n) => pathLabel(n.label ?? ""))
    .filter(Boolean);
  return (context.length ? `${body}\n${context.join(" › ")}` : body).slice(0, MAX_CHARS);
}

/** Schreibt {id, text} für alle Einheiten mit Embedding-Text. */
export async function runEmbedInput(input: string, out: string): Promise<void> {
  const writer = writeJsonl(out);
  const c = { docs: 0, embed: 0, patents: 0 };
  for await (const doc of readJsonl<EmbedSource>(input)) {
    c.docs++;
    const text = embedText(doc);
    if (text === null) continue;
    c.embed++;
    if (/^PAT\b/.test(doc.signature ?? "")) c.patents++;
    await writer.write({ id: doc.id, text });
  }
  await writer.close();
  console.log(`[embed-input] ${c.embed} von ${c.docs} Einheiten (davon ${c.patents} Patente) → ${out}`);
}
