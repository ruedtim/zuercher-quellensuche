/**
 * Querverweise auf Editionen (QZH, Zürcher Rechtsquellen) → Liste für die Web-App
 * (apps/web/src/lib/server/data/edition-links.json, committet) und Bericht.
 *
 * Liest Klone von stazh/qzh-data (Branch main = veröffentlicht) und stazh/erqzh-data.
 * Die Ratsmanual-Sitzungen kommen aus der öffentlichen API der Plattform (Sitzungen je
 * Band über /api/v1/documents, gedrosselt unter dem Rate-Limit) und deren TEI unter
 * /xml/RM/ – oder aus einer lokalen RM-TEI (--rm-tei). Abrufe landen im Cache-Ordner;
 * zum Auffrischen den Ordner löschen. Nur lesend; Prod-Indizes bleiben unberührt.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
  buildEditionLinks,
  compareSequence,
  coversRef,
  compareWords,
  decideRmMatch,
  editionBodyText,
  matchRmEntry,
  otherArchivesLine,
  parseQzhText,
  parseRmIdent,
  parseRmSignature,
  parseSsrqText,
  rmBodyText,
  serializeEditionLinks,
  textPool,
  textScore,
  type EditionKey,
  type EditionLinksFile,
  type EditionSourceMeta,
  type EditionText,
  type RmDecision,
  type RmEntryMatch,
  type RmRef,
  TEXT_MIN_WORDS,
  type RmSessionSpan,
  type TextScore,
} from "./editionLinks.ts";

const run = promisify(execFile);

export interface EditionLinksOptions {
  /** Klon von stazh/qzh-data (Branch main). */
  qzh: string;
  /** Klon von stazh/erqzh-data. */
  ssrq: string;
  /** Lokale RM-TEI (<dir>/data/RM/<Band>/*.xml) statt der API. */
  rmTei?: string;
  /** Basis der Plattform für API und TEI (Default https://archivquellen.ch). */
  api: string;
  /** Ziel der Liste (committet). */
  out: string;
  /** Bericht und Cache. */
  workDir: string;
}

interface RmSource {
  sessions(band: string): Promise<RmSessionSpan[]>;
  xml(id: string): Promise<string | null>;
  unparsed: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "zszh-catalog/editionen (Querverweise QZH/Rechtsquellen; https://archivquellen.ch/impressum)";

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) || 30;
      console.warn(`[editionen] 429 – warte ${wait} s`);
      await sleep(wait * 1000);
      continue;
    }
    return { status: res.status, text: await res.text() };
  }
}

async function readCached(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Sitzungen je Band über /api/v1/documents (100 je Abruf, Fenster 1'000), TEI unter /xml/RM/. */
function apiSource(api: string, cacheDir: string): RmSource {
  const unparsed: string[] = [];
  let last = 0;
  const throttle = async (ms: number) => {
    const wait = last + ms - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
  return {
    unparsed,
    async sessions(band) {
      const path = join(cacheDir, `rm-sessions-${band}.json`);
      let rows = JSON.parse((await readCached(path)) ?? "null") as { id: string; stazhIdent: string | null; date: string | null }[] | null;
      if (!rows) {
        rows = [];
        const volume = parseInt(band, 10);
        for (let offset = 0; offset < 1000; offset += 100) {
          await throttle(2000); // gemeinsamer Bucket der öffentlichen APIs (60 je Minute): höchstens die Hälfte
          const url = `${api}/api/v1/documents?series=RM&volumeNr=${volume}&limit=100&offset=${offset}&sort=date_asc`;
          const { status, text } = await fetchText(url);
          if (status !== 200) throw new Error(`HTTP ${status} für ${url}`);
          const body = JSON.parse(text) as { meta: { total: number }; data: { id: string; stazhIdent: string | null; date: string | null }[] };
          rows.push(...body.data.map((d) => ({ id: d.id, stazhIdent: d.stazhIdent, date: d.date })));
          if (offset + 100 >= body.meta.total) break;
          if (offset + 100 >= 1000) console.warn(`[editionen] B II ${volume}: mehr als 1'000 Sitzungen, Rest fehlt`);
        }
        await writeFile(path, JSON.stringify(rows));
      }
      const out: RmSessionSpan[] = [];
      for (const r of rows) {
        const s = r.stazhIdent ? parseRmIdent(r.id, r.stazhIdent, r.date) : null;
        if (!s) unparsed.push(`${r.id}: ${r.stazhIdent ?? "–"}`);
        else if (s.band === band) out.push(s);
      }
      return out;
    },
    async xml(id) {
      const path = join(cacheDir, "rm-xml", `${id}.xml`);
      const cached = await readCached(path);
      if (cached != null) return cached;
      await throttle(250);
      const { status, text } = await fetchText(`${api}/xml/RM/${encodeURIComponent(id)}.xml`);
      if (status !== 200) return null;
      await mkdir(join(cacheDir, "rm-xml"), { recursive: true });
      await writeFile(path, text);
      return text;
    },
  };
}

/** Lokale RM-TEI (services/rm-transkribus, ~/zszh-rm/tei): Kopf jeder Datei einmal lesen. */
async function teiSource(teiDir: string): Promise<RmSource> {
  const root = join(teiDir, "data", "RM");
  const unparsed: string[] = [];
  const byBand = new Map<string, RmSessionSpan[]>();
  const files = new Map<string, string>();
  const buf = Buffer.alloc(4096);
  for (const dir of (await readdir(root)).sort()) {
    let names: string[];
    try {
      names = (await readdir(join(root, dir))).filter((f) => f.endsWith(".xml"));
    } catch {
      continue;
    }
    for (const name of names) {
      const id = name.slice(0, -4);
      const path = join(root, dir, name);
      const fh = await open(path, "r");
      try {
        const head = buf.toString("utf8", 0, (await fh.read(buf, 0, buf.length, 0)).bytesRead);
        const ident = /<ident>([^<]*)<\/ident>/.exec(head)?.[1];
        const date = /<date when="(\d{4}-\d{2}-\d{2})"/.exec(head)?.[1] ?? null;
        const s = ident ? parseRmIdent(id, ident, date) : null;
        if (!s) {
          unparsed.push(`${id}: ${ident ?? "–"}`);
          continue;
        }
        files.set(id, path);
        byBand.set(s.band, [...(byBand.get(s.band) ?? []), s]);
      } finally {
        await fh.close();
      }
    }
  }
  return {
    unparsed,
    async sessions(band) {
      return byBand.get(band) ?? [];
    },
    async xml(id) {
      const path = files.get(id);
      return path ? readFile(path, "utf8") : null;
    },
  };
}

async function gitMeta(dir: string, texts: number): Promise<EditionSourceMeta> {
  const git = async (...args: string[]) => (await run("git", ["-C", dir, ...args])).stdout.trim();
  const remote = await git("config", "--get", "remote.origin.url").catch(() => "");
  return {
    repo: /github\.com[:/](.+?)(?:\.git)?$/.exec(remote)?.[1] ?? basename(dir),
    branch: await git("rev-parse", "--abbrev-ref", "HEAD").catch(() => "?"),
    commit: (await git("rev-parse", "HEAD").catch(() => "?")).slice(0, 12),
    texts,
  };
}

async function readTexts(
  dirs: string[],
  parse: (id: string, xml: string) => EditionText | null,
): Promise<{ texts: EditionText[]; xml: Map<string, string> }> {
  const texts: EditionText[] = [];
  const xml = new Map<string, string>();
  for (const dir of dirs) {
    for (const name of (await readdir(dir)).filter((f) => f.endsWith(".xml")).sort()) {
      const raw = await readFile(join(dir, name), "utf8");
      const t = parse(name.slice(0, -4), raw);
      if (!t) continue;
      texts.push(t);
      xml.set(t.id, raw);
    }
  }
  return { texts, xml };
}

interface RmRow {
  text: EditionText;
  ref: RmRef;
  match: RmEntryMatch;
  decision: RmDecision;
  words: number;
  /** Sitzungen im Band (0 = Band nicht auf der Plattform). */
  bandSessions: number;
}

export async function runEditionLinks(opts: EditionLinksOptions): Promise<void> {
  const cacheDir = join(opts.workDir, "edition-links-cache");
  await mkdir(cacheDir, { recursive: true });

  const qzh = await readTexts([join(opts.qzh, "quellenstuecke")], parseQzhText);
  const ssrqDirs = (await readdir(opts.ssrq)).filter((d) => /^ZH_/.test(d)).sort().map((d) => join(opts.ssrq, d));
  const ssrq = await readTexts(ssrqDirs, parseSsrqText);
  const texts = [...qzh.texts, ...ssrq.texts];
  const editionXml = new Map([...qzh.xml, ...ssrq.xml]);
  console.log(`[editionen] QZH ${qzh.texts.length} Stücke, Rechtsquellen ${ssrq.texts.length} Texte, ${otherArchivesLine(texts)}`);

  const source = opts.rmTei ? await teiSource(opts.rmTei) : apiSource(opts.api, cacheDir);
  const candidates = texts.flatMap((t) => {
    const ref = parseRmSignature(t.signature);
    return ref ? [{ text: t, ref }] : [];
  });
  const bands = [...new Set(candidates.map((c) => c.ref.band))];
  console.log(`[editionen] ${candidates.length} Ratsmanual-Einträge in ${bands.length} Bänden`);
  const sessions = new Map<string, RmSessionSpan[]>();
  for (const band of bands) sessions.set(band, await source.sessions(band));

  const rmWords = new Map<string, Set<string>>();
  const wordsOf = async (id: string) => {
    if (!rmWords.has(id)) {
      const xml = await source.xml(id);
      rmWords.set(id, xml ? compareWords(rmBodyText(xml)) : new Set());
    }
    return rmWords.get(id)!;
  };

  const rows: RmRow[] = [];
  for (const { text, ref } of candidates) {
    const inBand = sessions.get(ref.band) ?? [];
    const match = matchRmEntry(ref, text.date, inBand);
    const edition = compareSequence(editionBodyText(editionXml.get(text.id) ?? ""));
    const words = new Set(edition).size;
    // Prüfkreis für den Text: Kandidaten nach Stelle und Datum, Nachbarn, derselbe Tag.
    const pool = new Map(textPool(ref, text.date, inBand).map((s) => [s.id, s]));
    if (match) for (const id of "ambiguous" in match ? match.ambiguous : [match.id]) pool.set(id, inBand.find((s) => s.id === id)!);
    const scores: TextScore[] = [];
    if (words >= TEXT_MIN_WORDS) {
      for (const [id, s] of pool) scores.push({ id, score: textScore(edition, await wordsOf(id)), atPlace: coversRef(s, ref) });
    }
    rows.push({ text, ref, match, decision: decideRmMatch(match, words, scores), words, bandSessions: inBand.length });
  }

  const rmByText = new Map<string, string>();
  for (const r of rows) if ("id" in r.decision) rmByText.set(r.text.id, r.decision.id);
  const links = buildEditionLinks(texts, rmByText);
  const hash = createHash("sha256").update(JSON.stringify(links)).digest("hex").slice(0, 16);
  const editions: Record<EditionKey, EditionSourceMeta> = {
    qzh: await gitMeta(opts.qzh, qzh.texts.length),
    ssrq: await gitMeta(opts.ssrq, ssrq.texts.length),
  };
  const file: EditionLinksFile = {
    meta: {
      built: new Date().toISOString().slice(0, 10),
      hash,
      editions,
      counts: { texts: Object.keys(links.texts).length, catalogIds: Object.keys(links.catalog).length, rmDocs: Object.keys(links.rm).length },
    },
    ...links,
  };

  const reportPath = join(opts.workDir, "edition-links-report.md");
  await writeFile(reportPath, report(file, texts, rows, sessions, source.unparsed));
  console.log(`[editionen] Bericht: ${reportPath}`);

  const previous = JSON.parse((await readCached(opts.out)) ?? "null") as EditionLinksFile | null;
  if (previous?.meta?.hash === hash) {
    console.log(`[editionen] Liste unverändert (Hash ${hash}) – nichts geschrieben.`);
    return;
  }
  const tmp = `${opts.out}.tmp`;
  await writeFile(tmp, serializeEditionLinks(file));
  await rename(tmp, opts.out);
  console.log(
    `[editionen] ${opts.out}: ${file.meta.counts.texts} Texte, ${file.meta.counts.catalogIds} Katalog-IDs, ${file.meta.counts.rmDocs} RM-Sitzungen`,
  );
}

const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n * 100)} %`);
const span = (d: { from: string; to: string } | null) => (d ? (d.from === d.to ? d.from : `${d.from}…${d.to}`) : "–");

/** Stelle einer Sitzung wie im Ident («S. 24–25», «fol. 16r–17r», «Aufn. 3»). */
function place(s: RmSessionSpan): string {
  const f = (n: number) => `${Math.ceil(n / 2)}${n % 2 ? "r" : "v"}`;
  if (s.unit === "folio") return `fol. ${f(s.from)}${s.to > s.from ? `–${f(s.to)}` : ""}`;
  return `${s.unit === "page" ? "S." : "Aufn."} ${s.from}${s.to > s.from ? `–${s.to}` : ""}`;
}

function report(
  file: EditionLinksFile,
  texts: readonly EditionText[],
  rows: RmRow[],
  sessions: Map<string, RmSessionSpan[]>,
  unparsed: string[],
): string {
  const byId = new Map([...sessions.values()].flat().map((s) => [s.id, s]));
  const at = (id: string) => {
    const s = byId.get(id);
    return s ? `${id} (${place(s)}, ${s.date ?? "ohne Datum"})` : id;
  };
  const onPlatform = rows.filter((r) => r.bandSessions > 0);
  const taken = rows.filter((r) => "id" in r.decision);
  const byEdition = (e: EditionKey) =>
    `${taken.filter((r) => r.text.edition === e).length} von ${onPlatform.filter((r) => r.text.edition === e).length}`;
  const via = new Map<string, number>();
  for (const r of taken) {
    const v = (r.decision as { via: string }).via;
    via.set(v, (via.get(v) ?? 0) + 1);
  }
  const sig = (r: RmRow) => r.text.signature.replace(/\|/g, "/");
  const lines = [
    `# Querverweise auf Editionen – Bericht ${file.meta.built}`,
    "",
    `- QZH: ${file.meta.editions.qzh.repo}@${file.meta.editions.qzh.branch} ${file.meta.editions.qzh.commit}, ${file.meta.editions.qzh.texts} Stücke`,
    `- Rechtsquellen: ${file.meta.editions.ssrq.repo}@${file.meta.editions.ssrq.branch} ${file.meta.editions.ssrq.commit}, ${file.meta.editions.ssrq.texts} Texte`,
    `- Liste: ${file.meta.counts.texts} Texte, ${file.meta.counts.catalogIds} Katalog-IDs, ${file.meta.counts.rmDocs} RM-Sitzungen (Hash ${file.meta.hash})`,
    `- ${otherArchivesLine(texts)}`,
    "",
    "## Ratsmanuale",
    "",
    `Einträge mit Signatur «B II …»: ${rows.length}, davon in Bänden der Plattform: ${onPlatform.length} (nicht auf der Plattform: B II 1–5 und ab 1061).`,
    `Übernommen: QZH ${byEdition("qzh")}, Rechtsquellen ${byEdition("ssrq")} – ${[...via].map(([k, n]) => `${k} ${n}`).join(", ")}.`,
    "«seite+datum»/«seite»/«datum»: Sitzung nach Stelle und Datum, vom Text bestätigt (ohne Text: weitere Überlieferung, nur Stelle);",
    "«text»: Sitzung aus dem Prüfkreis (Stelle ± 2 Seiten, derselbe Tag), die klar am meisten Text teilt (an der Stelle ab 40 %, sonst ab 50 %, je 20 Punkte Abstand).",
    "",
    "| Text | Signatur der Edition | Datum der Edition | Sitzung (Stelle, Datum der Plattform) | über | Text geteilt | Wörter |",
    "|---|---|---|---|---|---|---|",
    ...taken.map((r) => {
      const d = r.decision as { id: string; via: string; score: number | null };
      return `| ${r.text.id}${r.text.witness ? " (Überl.)" : ""} | ${sig(r)} | ${span(r.text.date)} | ${at(d.id)} | ${d.via} | ${pct(d.score)} | ${r.words} |`;
    }),
    "",
    "### Nicht übernommen",
    "",
    "| Text | Signatur der Edition | Datum der Edition | Grund | Kandidaten nach Stelle/Datum | bester Text im Prüfkreis |",
    "|---|---|---|---|---|---|",
    ...onPlatform
      .filter((r) => !("id" in r.decision))
      .map((r) => {
        const d = r.decision as Extract<RmDecision, { rejected: string }>;
        const best = [...d.scores].sort((a, b) => b.score - a.score).slice(0, 2);
        return `| ${r.text.id} | ${sig(r)} | ${span(r.text.date)} | ${d.rejected} | ${d.candidates.map(at).join(", ") || "–"} | ${best.map((b) => `${at(b.id)} ${pct(b.score)}`).join("; ") || "–"} |`;
      }),
    "",
  ];
  if (unparsed.length) {
    lines.push(`### Sitzungen ohne lesbare Stelle (${unparsed.length})`, "", ...unparsed.slice(0, 50).map((u) => `- ${u}`), "");
  }
  const foreign = texts.filter((t) => t.otherArchives.length > 0);
  if (foreign.length) {
    lines.push(
      "## Vorlagen in anderen Archiven",
      "",
      `${otherArchivesLine(texts)}: Die Edition verweist auf den Online-Katalog des Archivs (detail.aspx?ID=…), die IDs dort sind keine Katalog-IDs des Staatsarchivs.`,
      "",
      "| Text | Signatur der Edition | Archiv | Link der Edition |",
      "|---|---|---|---|",
      ...foreign.map(
        (t) => `| ${t.id}${t.witness ? " (Überl.)" : ""} | ${t.signature.replace(/\|/g, "/")} | ${t.otherArchives.map((o) => o.archive).join(", ")} | ${t.otherArchives.map((o) => o.href).join(" ")} |`,
      ),
      "",
    );
  }
  return lines.join("\n");
}
