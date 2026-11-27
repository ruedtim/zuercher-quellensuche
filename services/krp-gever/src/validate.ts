/**
 * Validierungs-Harness für die Traktanden-Segmentierung (read-only).
 *
 * Läuft `segmentProtocol` über alle gecachten Protokoll-PDFs und berichtet, wie
 * oft segmentiert vs. Fallback (mit Gründen), Items-Verteilung und Quote pro
 * Jahrzehnt. Kein Netz, keine Schreibvorgänge.
 *
 *   npx tsx src/validate.ts --cache=/tmp/zszh-krp-gever/.cache-pdf \
 *       --tei=/tmp/zszh-krp-gever/data/KRP   # optional, für Jahr-Zuordnung
 *       [--limit=N] [--show=N]
 */

import { readdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { runPdftotext } from "./pdftext.ts";
import { segmentProtocol } from "./segment.ts";

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

async function main() {
  let cacheDir = "/tmp/zszh-krp-gever/.cache-pdf";
  let teiDir = "/tmp/zszh-krp-gever/data/KRP";
  let limit = Infinity;
  let show = 15;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--cache=")) cacheDir = a.slice(8);
    else if (a.startsWith("--tei=")) teiDir = a.slice(6);
    else if (a.startsWith("--limit=")) limit = Number.parseInt(a.slice(8), 10);
    else if (a.startsWith("--show=")) show = Number.parseInt(a.slice(7), 10);
  }
  cacheDir = resolve(expandHome(cacheDir));

  // guid → Jahr aus den Ganz-Sitzungs-TEI-Dateinamen (falls vorhanden).
  const guidYear = new Map<string, number>();
  try {
    for (const f of await readdir(resolve(expandHome(teiDir)))) {
      const m = f.match(/^KRP_(\d{4})_g([0-9a-f]+)(?:_t\d+)?\.xml$/);
      if (m) guidYear.set(m[2], Number.parseInt(m[1], 10));
    }
  } catch {
    /* optional */
  }

  const files = (await readdir(cacheDir)).filter((f) => f.endsWith(".pdf")).slice(0, limit);
  console.log(`[validate] ${files.length} gecachte PDFs, cache=${cacheDir}`);

  let segmented = 0;
  let fallback = 0;
  let totalItems = 0;
  const reasons = new Map<string, number>();
  const itemsHist = new Map<number, number>();
  const byDecade = new Map<string, { seg: number; fb: number }>();
  const fallbackSamples: string[] = [];

  let n = 0;
  for (const f of files) {
    n++;
    const guid = basename(f).split("-")[0];
    const year = guidYear.get(guid);
    const decade = year ? `${Math.floor(year / 10) * 10}er` : "?";
    let res;
    try {
      res = segmentProtocol(await runPdftotext(join(cacheDir, f)));
    } catch (err) {
      reasons.set("exception", (reasons.get("exception") ?? 0) + 1);
      fallback++;
      continue;
    }
    const d = byDecade.get(decade) ?? { seg: 0, fb: 0 };
    if (res.ok) {
      segmented++;
      totalItems += res.items.length;
      itemsHist.set(res.items.length, (itemsHist.get(res.items.length) ?? 0) + 1);
      d.seg++;
    } else {
      fallback++;
      reasons.set(res.reason ?? "?", (reasons.get(res.reason ?? "?") ?? 0) + 1);
      d.fb++;
      if (fallbackSamples.length < show) fallbackSamples.push(`${f} (${year ?? "?"}, ${res.reason}, toc=${res.tocCount})`);
    }
    byDecade.set(decade, d);
    if (n % 200 === 0) console.log(`[validate]   ${n}/${files.length}…`);
  }

  const total = segmented + fallback;
  console.log(`\n==== Segmentierung ====`);
  console.log(`segmentiert: ${segmented}/${total} (${((100 * segmented) / total).toFixed(1)}%)`);
  console.log(`fallback   : ${fallback}/${total} (${((100 * fallback) / total).toFixed(1)}%)`);
  console.log(`Traktanden total (aus segmentierten): ${totalItems}`);
  console.log(`\nFallback-Gründe:`, Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])));
  console.log(`\nQuote pro Jahrzehnt (seg/total):`);
  for (const [dec, c] of [...byDecade].sort()) {
    const t = c.seg + c.fb;
    console.log(`  ${dec}: ${c.seg}/${t} (${((100 * c.seg) / t).toFixed(0)}%)`);
  }
  const hist = [...itemsHist].sort((a, b) => a[0] - b[0]);
  console.log(`\nTraktanden/Sitzung (Anzahl→Häufigkeit):`, Object.fromEntries(hist));
  if (fallbackSamples.length) {
    console.log(`\nFallback-Beispiele:`);
    for (const s of fallbackSamples) console.log(`  - ${s}`);
  }
}

main().catch((err) => {
  console.error("[validate] fatal:", err);
  process.exit(1);
});
