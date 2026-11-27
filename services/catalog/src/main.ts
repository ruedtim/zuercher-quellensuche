/**
 * Archivkatalog des Staatsarchivs → Meili-Index `catalog` (Aufbau auf dem Mac).
 *
 *   npx tsx src/main.ts ner-input --input=<export.jsonl.gz> [--out=output/ner-input.jsonl.gz]
 *   npx tsx src/main.ts embed-input --input=<catalog-docs.jsonl.gz> [--out=output/embed-input.jsonl.gz]
 *   npx tsx src/main.ts build --input=<export.jsonl.gz> [--ner=output/ner-spans.jsonl] [--platform=<platform-docs.jsonl.gz>]
 *   npx tsx src/main.ts abgleich --input=<export.jsonl.gz> --platform=<platform-docs.jsonl.gz> [--out=<dir>]
 *                         (ohne --platform: MEILI_URL=… MEILI_KEY=<Such-Key>, Index documents per Tunnel)
 *   npx tsx src/main.ts edb-abgleich --input=<export.jsonl.gz> --edb=<Zenodo-CSV> [--out=<dir>]
 *   npx tsx src/main.ts ehedaten --input=<export.jsonl.gz> [--out=<dir>]   (Index `ehedaten`, README)
 *   npx tsx src/main.ts ehedaten --edb=<Zenodo-CSV> [--out=<dir>]          (dasselbe aus der Zenodo-CSV)
 *   npx tsx src/main.ts ehedaten-vergleich --docs=<neu.jsonl.gz> --base=<alt.jsonl.gz> [--out=<dir>]
 *                         zwei Index-Dateien `ehedaten` vergleichen (vor einem Import, README)
 *   npx tsx src/main.ts ehedaten-mehrfach --sw=<Klon stazh/sw-ehedaten> --docs=<ehedaten-docs.jsonl.gz> [--list=<json>] [--out=<dir>]
 *                         (statt --docs auch --edb=<Zenodo-CSV>)
 *                         geprüfte Mehrfacheinträge → apps/web/…/ehedaten-mehrfach.json (README)
 *   npx tsx src/main.ts editionen --qzh=<Klon qzh-data> --ssrq=<Klon erqzh-data> [--rm-tei=<dir>]
 *                                 [--api=https://archivquellen.ch] [--list=<json>] [--out=<dir>]
 *                         Querverweise QZH/Rechtsquellen → apps/web/…/edition-links.json (README)
 *   npx tsx src/main.ts editionen-index --qzh=<Klon qzh-data> [--ssrq=<Klon erqzh-data>] [--ner=<Spans>]
 *                                       [--out=<dir>] [--register=<datei>]
 *                         Index `editions` (Reiter «Editionen», README «Editionen-Index»; ein Lauf
 *                         baut alle Editionen; --ner: Ausgabe von rmtk.tag_texts, editionNer.ts;
 *                         --register: KRDB-Register für heutige Ortsnamen, Default wie bei build)
 *
 * Optionen für build:
 *   --out=<dir>           Ausgabe (Default services/catalog/output)
 *   --ner=<datei>         Spans von services/ner-xml/ner_text.py (ohne: nur Titelschema)
 *   --rm-tei=<dir>        RM-TEI (Default ~/zszh-rm/tei) für die Sitzungs-Zuordnung
 *   --krdb-xlsx=<datei>   KRDB-Rohexport (Default: jüngster in services/krdb/output)
 *   --register=<datei>    KRDB-Register (Aliase; Default apps/web/…/krdb-register.json)
 *   --platform=<datei>    Abzug der Plattform-Dokumente (refresh.sh platform): docId = ID der
 *                         Plattform, Weblink ohne Dokument ⇒ eigener Treffer (ohne: ungeprüft)
 *   --limit=<n>           nur die ersten n Einheiten (Test)
 *
 * Danach Import: src/import.ts (README).
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAbgleich } from "./abgleich.ts";
import { resolveKrdbXlsx, runBuild, runNerInput } from "./build.ts";
import { runEdbAbgleich } from "./edbAbgleich.ts";
import { runEditionLinks } from "./editionLinksRun.ts";
import { runEditionsBuild } from "./editionsBuild.ts";
import { runEhedatenBuild } from "./ehedatenBuild.ts";
import { runEhedatenMehrfach } from "./ehedatenMehrfachRun.ts";
import { runEhedatenVergleich } from "./ehedatenVergleich.ts";
import { runEmbedInput } from "./embedInput.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

function args(argv: string[]): { cmd: string; opts: Record<string, string> } {
  const [cmd = "", ...rest] = argv;
  const opts: Record<string, string> = {};
  for (const a of rest) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Unbekanntes Argument: ${a}`);
    opts[m[1]] = m[2] ?? "true";
  }
  return { cmd, opts };
}

const expand = (p: string) => resolve(p.replace(/^~(?=\/)/, homedir()));

async function main() {
  const { cmd, opts } = args(process.argv.slice(2));
  const out = expand(opts.out ?? join(HERE, "../output"));
  if (cmd === "abgleich") {
    if (!opts.input) throw new Error("--input=<export.jsonl.gz> fehlt (Export des stazh-scrapers, nicht die Index-Datei)");
    await mkdir(out, { recursive: true });
    await runAbgleich({ input: expand(opts.input), platform: opts.platform ? expand(opts.platform) : undefined, out });
    return;
  }
  if (cmd === "embed-input") {
    if (!opts.input) throw new Error("--input=<catalog-docs.jsonl.gz> fehlt (Ausgabe von build)");
    await runEmbedInput(expand(opts.input), opts.out ? out : join(out, "embed-input.jsonl.gz"));
    return;
  }
  if (cmd === "ehedaten") {
    if (!opts.input === !opts.edb) throw new Error("--input=<Katalog-Export> oder --edb=<Zenodo-CSV der Ehedatenbank> angeben (eines von beiden)");
    await mkdir(out, { recursive: true });
    await runEhedatenBuild({ input: opts.input ? expand(opts.input) : undefined, edb: opts.edb ? expand(opts.edb) : undefined, out });
    return;
  }
  if (cmd === "ehedaten-vergleich") {
    if (!opts.docs || !opts.base) throw new Error("--docs=<neue Index-Datei> und --base=<bisherige Index-Datei> fehlen");
    await mkdir(out, { recursive: true });
    await runEhedatenVergleich({ docs: expand(opts.docs), base: expand(opts.base), out });
    return;
  }
  if (cmd === "editionen-index") {
    // Ein Lauf baut den ganzen Index: ohne --qzh fehlten die QZH nach dem Import.
    if (!opts.qzh) throw new Error("--qzh=<Klon stazh/qzh-data, Branch main> fehlt");
    await mkdir(out, { recursive: true });
    await runEditionsBuild({
      qzh: expand(opts.qzh),
      ssrq: opts.ssrq ? expand(opts.ssrq) : undefined,
      ner: opts.ner ? expand(opts.ner) : undefined,
      out,
      krdbRegister: expand(opts.register ?? join(REPO, "apps/web/src/lib/server/data/krdb-register.json")),
    });
    return;
  }
  if (cmd === "ehedaten-mehrfach") {
    if (!opts.sw || !opts.docs === !opts.edb) throw new Error("--sw=<Klon stazh/sw-ehedaten> und --docs=<ehedaten-docs.jsonl.gz> (oder --edb=<Zenodo-CSV>) angeben");
    await mkdir(out, { recursive: true });
    await runEhedatenMehrfach({
      sw: expand(opts.sw),
      docs: opts.docs ? expand(opts.docs) : undefined,
      edb: opts.edb ? expand(opts.edb) : undefined,
      out: expand(opts.list ?? join(REPO, "apps/web/src/lib/server/data/ehedaten-mehrfach.json")),
      workDir: out,
    });
    return;
  }
  if (cmd === "editionen") {
    if (!opts.qzh || !opts.ssrq) throw new Error("--qzh=<Klon stazh/qzh-data> und --ssrq=<Klon stazh/erqzh-data> fehlen");
    await mkdir(out, { recursive: true });
    await runEditionLinks({
      qzh: expand(opts.qzh),
      ssrq: expand(opts.ssrq),
      rmTei: opts["rm-tei"] ? expand(opts["rm-tei"]) : undefined,
      api: (opts.api ?? "https://archivquellen.ch").replace(/\/+$/, ""),
      out: expand(opts.list ?? join(REPO, "apps/web/src/lib/server/data/edition-links.json")),
      workDir: out,
    });
    return;
  }
  if (!opts.input) throw new Error("--input=<export.jsonl.gz> fehlt (stazh export --gzip)");
  if (cmd === "edb-abgleich") {
    if (!opts.edb) throw new Error("--edb=<Zenodo-CSV der Ehedatenbank> fehlt");
    await runEdbAbgleich({ input: expand(opts.input), edb: expand(opts.edb), out });
    return;
  }
  const limit = opts.limit ? Number(opts.limit) : undefined;
  if (cmd === "ner-input") {
    await runNerInput(expand(opts.input), opts.out ? out : join(out, "ner-input.jsonl.gz"), limit);
  } else if (cmd === "build") {
    await runBuild({
      input: expand(opts.input),
      out,
      ner: opts.ner ? expand(opts.ner) : undefined,
      rmTei: expand(opts["rm-tei"] ?? join(homedir(), "zszh-rm", "tei")),
      register: expand(opts.register ?? join(REPO, "apps/web/src/lib/server/data/krdb-register.json")),
      krdbXlsx: await resolveKrdbXlsx(expand(opts["krdb-xlsx"] ?? join(REPO, "services/krdb/output"))),
      platform: opts.platform ? expand(opts.platform) : undefined,
      limit,
    });
  } else {
    throw new Error(`Unbekannter Befehl «${cmd}» (build | ner-input | embed-input | abgleich | edb-abgleich | ehedaten | ehedaten-vergleich | ehedaten-mehrfach | editionen | editionen-index)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
