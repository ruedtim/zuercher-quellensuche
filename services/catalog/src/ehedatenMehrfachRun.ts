/**
 * Geprüfte Mehrfacheinträge der Ehedatenbank → Liste für die Web-App
 * (apps/web/src/lib/server/data/ehedaten-mehrfach.json, committet) und Bericht.
 *
 *   npx tsx src/main.ts ehedaten-mehrfach --sw=<Klon stazh/sw-ehedaten> --docs=<ehedaten-docs.jsonl.gz>
 *   npx tsx src/main.ts ehedaten-mehrfach --sw=<Klon stazh/sw-ehedaten> --edb=<Zenodo-CSV>
 *
 * Liest die Liste aus einem Klon von stazh/sw-ehedaten (ehedatenMehrfach.ts) und prüft sie
 * gegen den Stand des Index `ehedaten`: die Index-Datei aus `main.ts ehedaten` (seit 2026-11 aus
 * dem Katalog-Crawl) oder, wie bis dahin, den Zenodo-Datensatz (ehedaten.ts). Geprüft werden
 * Katalog-IDs, Daten, Namen. Schreibt die Liste nur bei geändertem Inhalt (Hash), atomar, und
 * bricht bei unplausiblen Zahlen ab (checkMehrfach). Nur lesend; Prod-Indizes bleiben unberührt.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { edbRows } from "./edb.ts";
import { ehedatenDoc, type EhedatenDoc } from "./ehedaten.ts";
import {
  buildMehrfach,
  checkMehrfach,
  MAX_DATE_DEVIATION,
  MEHRFACH_PATH,
  MEHRFACH_REPO,
  mehrfachData,
  mehrfachRows,
  serializeMehrfach,
  type MehrfachBuild,
  type MehrfachDoc,
  type MehrfachFile,
} from "./ehedatenMehrfach.ts";
import { readJsonl } from "./load.ts";

const run = promisify(execFile);
const fmt = (n: number) => n.toLocaleString("de-CH");

export interface EhedatenMehrfachOptions {
  /** Klon von stazh/sw-ehedaten. */
  sw: string;
  /** Index-Datei `ehedaten-docs.jsonl.gz` (Stand des Index `ehedaten`) … */
  docs?: string;
  /** … oder die Zenodo-CSV der Ehedatenbank (bis 2026-11 die Quelle des Index). */
  edb?: string;
  /** Ziel der Liste (committet). */
  out: string;
  /** Bericht. */
  workDir: string;
}

/** Commit des Klons und letzte Änderung der Liste darin. */
async function gitMeta(dir: string): Promise<{ repo: string; commit: string; date: string }> {
  const git = async (...args: string[]) => (await run("git", ["-C", dir, ...args])).stdout.trim();
  const remote = await git("config", "--get", "remote.origin.url").catch(() => "");
  return {
    repo: /github\.com[:/](.+?)(?:\.git)?$/.exec(remote)?.[1] ?? MEHRFACH_REPO,
    commit: (await git("rev-parse", "HEAD").catch(() => "?")).slice(0, 12),
    date: await git("log", "-1", "--format=%cs", "--", MEHRFACH_PATH).catch(() => "?"),
  };
}

/** Index-Einträge, gegen die geprüft wird: Index-Datei oder Zenodo-CSV. */
async function loadDocs(opts: EhedatenMehrfachOptions): Promise<Map<number, MehrfachDoc>> {
  const docs = new Map<number, MehrfachDoc>();
  if (opts.docs) {
    for await (const d of readJsonl<EhedatenDoc>(opts.docs)) docs.set(d.id, d);
    return docs;
  }
  for (const z of edbRows(await readFile(opts.edb!, "utf8"))) {
    const d = ehedatenDoc(z);
    if (d) docs.set(d.id, d);
  }
  return docs;
}

/** Stand der Ehedatenbank: Index-Datei (mit Datum) bzw. Zenodo-Version aus der daneben
 *  gespeicherten Zenodo-Antwort (wie ehedatenBuild.ts). */
async function edbLabel(opts: EhedatenMehrfachOptions): Promise<string> {
  if (opts.docs) {
    const built = (await stat(opts.docs).catch(() => null))?.mtime.toISOString().slice(0, 10) ?? "?";
    return `Index-Datei ${basename(opts.docs)} (gebaut ${built})`;
  }
  const csvPath = opts.edb!;
  const dir = dirname(csvPath);
  const meta = (await readdir(dir).catch(() => [])).find((f) => /^zenodo-record-\d+\.json$/.test(f));
  if (!meta) return basename(csvPath);
  const d = JSON.parse(await readFile(join(dir, meta), "utf8"));
  return `${basename(csvPath)} (Zenodo ${d.id}, Version ${d.metadata?.version ?? "?"})`;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function runEhedatenMehrfach(opts: EhedatenMehrfachOptions): Promise<void> {
  if (!opts.docs === !opts.edb) throw new Error("genau eine Quelle angeben: --docs=<Index-Datei> oder --edb=<Zenodo-CSV>");
  const rows = mehrfachRows(await readFile(join(opts.sw, MEHRFACH_PATH), "utf8"));
  const docs = await loadDocs(opts);
  const build = buildMehrfach(rows, docs);
  const data = mehrfachData(build);
  const git = await gitMeta(opts.sw);
  const file: MehrfachFile = {
    meta: {
      built: new Date().toISOString().slice(0, 10),
      hash: createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16),
      source: { repo: git.repo, path: MEHRFACH_PATH, commit: git.commit, date: git.date, rows: build.rows, marriages: build.listed },
      edb: await edbLabel(opts),
      counts: {
        marriages: build.ehen.size,
        entries: [...build.ehen.values()].reduce((n, ids) => n + ids.length, 0),
        probable: build.wahrscheinlich.size,
        distinct: build.verschieden.size,
      },
    },
    ...data,
  };

  const reportPath = join(opts.workDir, "ehedaten-mehrfach-report.md");
  await writeFile(reportPath, report(file, build, docs));
  console.log(`[ehedaten-mehrfach] Bericht: ${reportPath}`);

  const errors = checkMehrfach(build);
  if (errors.length > 0) throw new Error(`[ehedaten-mehrfach] Abbruch, Liste nicht geschrieben: ${errors.join("; ")}`);
  const previous = JSON.parse((await readOptional(opts.out)) ?? "null") as MehrfachFile | null;
  if (previous?.meta?.hash === file.meta.hash) {
    console.log(`[ehedaten-mehrfach] Liste unverändert (Hash ${file.meta.hash}) – nichts geschrieben.`);
    return;
  }
  const tmp = `${opts.out}.tmp`;
  await writeFile(tmp, serializeMehrfach(file));
  await rename(tmp, opts.out);
  const c = file.meta.counts;
  console.log(
    `[ehedaten-mehrfach] ${opts.out}: ${fmt(c.marriages)} Ehen (${fmt(c.entries)} Einträge, ${fmt(c.probable)} wahrscheinlich), ${fmt(c.distinct)} Paare verworfen`,
  );
}

const list = (title: string, items: string[], max = 50) =>
  items.length === 0 ? [] : [`### ${title} (${fmt(items.length)})`, "", ...items.slice(0, max).map((s) => `- ${s}`), ...(items.length > max ? [`- … und ${fmt(items.length - max)} weitere`] : []), ""];

function report(file: MehrfachFile, b: MehrfachBuild, docs: ReadonlyMap<number, MehrfachDoc>): string {
  const m = file.meta;
  const pair = (ids: number[]) =>
    ids
      .map((id) => {
        const d = docs.get(id);
        return d ? `${id} ${d.mannName} ⚭ ${d.frauName}, ${d.kirchgemeinde} ${d.isoVon} (${d.signatur})` : String(id);
      })
      .join(" | ");
  const grund = { vornamen: "gleiche Kirchgemeinde, andere Vornamen", vermerk: "Vermerk über eine weitere Hochzeit am selben Tag" } as const;
  const sameParish = [...b.ehen.values()].filter((ids) => new Set(ids.map((id) => docs.get(id)?.kirchgemeinde)).size === 1).length;
  return [
    `# Mehrfacheinträge der Ehedatenbank – Bericht ${m.built}`,
    "",
    `- Quelle: ${m.source.repo} \`${m.source.path}\` (Commit ${m.source.commit}, Datei zuletzt geändert ${m.source.date}): ${fmt(m.source.rows)} Zeilen, ${fmt(m.source.marriages)} Ehen`,
    `- Geprüft gegen ${m.edb}`,
    `- Liste: ${fmt(m.counts.marriages)} Ehen mit ${fmt(m.counts.entries)} Einträgen, davon ${fmt(m.counts.probable)} «wahrscheinlich» (Sicherheitswert «Probably»), ${fmt(sameParish)} mit beiden Einträgen in derselben Kirchgemeinde (Hash ${m.hash})`,
    `- Verworfen: ${fmt(m.counts.distinct)} Paare, die nach den Angaben ihrer Einträge zwei Ehen sind`,
    `- Daten der Liste gegen den Index: ${fmt(b.abweichungen.datum.length)} von ${fmt(b.datiert)} abweichend (Abbruch über ${MAX_DATE_DEVIATION * 100} %: gregorianisch umgerechnet?)`,
    "",
    "## Verworfen (zwei Ehen)",
    "",
    ...Object.entries(file.verschieden).map(([ehe, v]) => `- Ehe ${ehe} (${grund[v.grund]}): ${pair(v.ids)}`),
    "",
    "## «Wahrscheinlich» (Probably)",
    "",
    ...file.wahrscheinlich.map((ehe) => `- Ehe ${ehe}: ${pair(file.ehen[ehe] ?? [])}`),
    "",
    "## Probleme",
    "",
    ...list("Katalog-ID nicht im Index", b.problems.ohneEintrag),
    ...list("Ehe ohne zwei Einträge im Index", b.problems.unvollstaendig),
    ...list("Katalog-ID in mehreren Ehen", b.problems.doppelt),
    ...list("Unbekannter Sicherheitswert", b.problems.sicherheit),
    "## Abweichungen der Liste vom Index (massgebend ist der Index)",
    "",
    ...list("Datum", b.abweichungen.datum),
    ...list("Namen", b.abweichungen.namen),
    ...list("Kirchgemeinde", b.abweichungen.kirchgemeinde),
    ...list("Signatur", b.abweichungen.signatur),
  ].join("\n");
}
