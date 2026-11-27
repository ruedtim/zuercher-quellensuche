import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { ALL_SERIES, type SeriesAbbr } from "./types.ts";

/**
 * Liefert async-iterable Liste aller TEI-XML-Dateien im Daten-Repo.
 * Pfad-Konvention: data/<SeriesAbbr>/<flat>.xml oder data/RRB/<MM_x_y>/<file>.xml
 */
export async function* walkData(opts: {
  dataDir: string;
  series?: SeriesAbbr[];
  limit?: number;
}): AsyncIterable<{ absPath: string; relPath: string; series: SeriesAbbr }> {
  const series = opts.series ?? ALL_SERIES;
  const dataRoot = join(opts.dataDir, "data");
  let yielded = 0;
  for (const ser of series) {
    const seriesRoot = join(dataRoot, ser);
    for await (const file of walkXml(seriesRoot)) {
      yield {
        absPath: file,
        relPath: relative(opts.dataDir, file),
        series: ser,
      };
      yielded++;
      if (opts.limit !== undefined && yielded >= opts.limit) return;
    }
  }
}

async function* walkXml(dir: string): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkXml(full);
    } else if (entry.isFile() && entry.name.endsWith(".xml")) {
      yield full;
    }
  }
}

/**
 * Pfade aus `git diff --name-only <since>..HEAD`, gefiltert auf TEI-XML im
 * data/-Unterordner. Nur Dateien die existieren (Renames/Deletions werden
 * separat behandelt).
 */
export async function gitChangedFiles(opts: {
  dataDir: string;
  sinceRef: string;
}): Promise<string[]> {
  const result = spawnSync(
    "git",
    ["-C", opts.dataDir, "diff", "--name-only", opts.sinceRef, "HEAD"],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`git diff failed (status=${result.status}): ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("data/") && line.endsWith(".xml"));
}
