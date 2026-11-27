/**
 * JSONL-Dateien zeilenweise lesen und schreiben, wahlweise gzip (Endung .gz).
 */

import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createGunzip, createGzip } from "node:zlib";

export async function* readJsonl<T>(path: string): AsyncGenerator<T> {
  for await (const line of readLines(path)) yield JSON.parse(line) as T;
}

/** Nicht leere Zeilen als Text (der Import reicht sie ungeparst an Meili weiter). */
export async function* readLines(path: string): AsyncGenerator<string> {
  const raw = createReadStream(path);
  const input = path.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) yield line;
  }
}

export interface JsonlWriter {
  write(value: unknown): Promise<void>;
  close(): Promise<void>;
}

/** Schreibt mit Backpressure; `close()` wartet, bis die Datei vollständig ist. */
export function writeJsonl(path: string): JsonlWriter {
  const file = createWriteStream(path);
  const gzip = path.endsWith(".gz") ? createGzip({ level: 6 }) : null;
  if (gzip) gzip.pipe(file);
  const out = gzip ?? file;
  return {
    async write(value) {
      if (!out.write(JSON.stringify(value) + "\n")) await once(out, "drain");
    },
    async close() {
      const done = once(file, "finish");
      out.end();
      await done;
    },
  };
}
