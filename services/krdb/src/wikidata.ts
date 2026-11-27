/**
 * Wikidata-Verknüpfung der KRDB-Personen.
 *
 * Primär über P13468 («Zurich Kantonsrat and Regierungsrat member ID» =
 * ID_PERSON_NEW der Live-KRDB). Diese Links sind kuratiert: die linking-app
 * schreibt bestätigte Zuordnungen als P13468 nach Wikidata zurück. Zusätzlich
 * exakte Treffer über die Normdaten-IDs der KRDB (GND P227, HLS P902, VIAF
 * P214). Priorität P13468 > GND > HLS > VIAF; widersprechen sich Routen,
 * gewinnt die höhere, der Konflikt landet im Report.
 */

import { USER_AGENT, type KrdbRawPerson } from "./krdb.ts";
import { resolveStale, type StaleItem, type StaleResolution, type StaleUnresolved } from "./stale.ts";

const SPARQL_URL = "https://query.wikidata.org/sparql";
const BATCH = 200;

/** p13468alt: Item mit veralteter P13468, über Name + Geburtsdatum zugeordnet (stale.ts). */
export type QidVia = "p13468" | "gnd" | "hls" | "viaf" | "p13468alt";

interface Binding {
  [k: string]: { value: string } | undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function sparql(query: string): Promise<Binding[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(SPARQL_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { results: { bindings: Binding[] } };
      return json.results.bindings;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retry = Number(res.headers.get("retry-after")) || 5 * (attempt + 1);
      await sleep(retry * 1000);
      continue;
    }
    throw new Error(`SPARQL: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

const qidOf = (uri: string): string => uri.slice(uri.lastIndexOf("/") + 1);

/** HLS-Kennung der KRDB «D31283» → Wikidata-P902-Format «031283». */
export function hlsToP902(hls: string): string | null {
  const m = /^D?(\d{1,6})$/i.exec(hls.trim());
  return m ? m[1].padStart(6, "0") : null;
}

/** Wikidata-Werte eines Identifier-Properties → QID (Batches via VALUES). */
async function lookupIds(prop: string, values: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < values.length; i += BATCH) {
    const vs = values
      .slice(i, i + BATCH)
      .map((v) => JSON.stringify(v))
      .join(" ");
    // Nur Menschen (P31=Q5): Normdaten-IDs hängen gelegentlich an Werken/Familien-Items.
    const rows = await sparql(`SELECT ?item ?v WHERE { VALUES ?v { ${vs} } ?item wdt:${prop} ?v ; wdt:P31 wd:Q5 . }`);
    for (const b of rows) {
      const v = b["v"]?.value;
      const item = b["item"]?.value;
      if (!v || !item) continue;
      const list = out.get(v) ?? [];
      if (!list.includes(qidOf(item))) list.push(qidOf(item));
      out.set(v, list);
    }
    await sleep(500);
  }
  return out;
}

export interface WikidataLinks {
  qid: Map<number, { qid: string; via: QidVia }>;
  /** P13468-Werte auf Wikidata ohne Person in der Live-KRDB (veraltete IDs). */
  staleP13468: Array<{ krdbId: string; qid: string }>;
  /** Davon über Name + Geburtsdatum der neuen ID zugeordnet (Korrekturvorschläge);
   *  hasNew: das Item trägt die neue ID schon, nur der alte Wert muss weg. */
  staleResolved: Array<StaleResolution & { hasNew: boolean }>;
  staleUnresolved: StaleUnresolved[];
  /** Personen, deren Routen auf verschiedene Items zeigen. */
  conflicts: Array<{ id: number; name: string; routes: Partial<Record<QidVia, string[]>> }>;
  /** Items, die von mehreren KRDB-Personen beansprucht werden. */
  sharedQids: Array<{ qid: string; ids: number[] }>;
}

export async function linkWikidata(persons: KrdbRawPerson[]): Promise<WikidataLinks> {
  const liveIds = new Set(persons.map((p) => String(p.id)));

  const byP13468 = new Map<string, string[]>();
  for (const b of await sparql("SELECT ?item ?id WHERE { ?item wdt:P13468 ?id . }")) {
    const id = b["id"]?.value;
    const item = b["item"]?.value;
    if (!id || !item) continue;
    const list = byP13468.get(id) ?? [];
    if (!list.includes(qidOf(item))) list.push(qidOf(item));
    byP13468.set(id, list);
  }
  const staleP13468 = [...byP13468]
    .filter(([id]) => !liveIds.has(id))
    .flatMap(([krdbId, qids]) => qids.map((qid) => ({ krdbId, qid })))
    .sort((a, b) => Number(a.krdbId) - Number(b.krdbId));

  const uniq = (xs: Array<string | undefined>) => [...new Set(xs.filter((x): x is string => !!x))];
  const byGnd = await lookupIds("P227", uniq(persons.map((p) => p.gnd)));
  const byHls = await lookupIds("P902", uniq(persons.map((p) => (p.hls ? hlsToP902(p.hls) ?? undefined : undefined))));
  const byViaf = await lookupIds("P214", uniq(persons.map((p) => p.viaf)));

  const qid = new Map<number, { qid: string; via: QidVia }>();
  const conflicts: WikidataLinks["conflicts"] = [];
  for (const p of persons) {
    const routes: Partial<Record<QidVia, string[]>> = {};
    const p13468 = byP13468.get(String(p.id));
    if (p13468?.length) routes.p13468 = p13468;
    const gnd = p.gnd ? byGnd.get(p.gnd) : undefined;
    if (gnd?.length) routes.gnd = gnd;
    const hlsKey = p.hls ? hlsToP902(p.hls) : null;
    const hls = hlsKey ? byHls.get(hlsKey) : undefined;
    if (hls?.length) routes.hls = hls;
    const viaf = p.viaf ? byViaf.get(p.viaf) : undefined;
    if (viaf?.length) routes.viaf = viaf;

    const all = new Set(Object.values(routes).flat());
    if (all.size === 0) continue;
    if (all.size > 1) conflicts.push({ id: p.id, name: `${p.first} ${p.last}`, routes });

    // Normdaten-Routen zählen nur, wenn sie sich auf genau ein Item einigen.
    const idRoutes = (["gnd", "hls", "viaf"] as const).filter((v) => routes[v]);
    const idQids = new Set(idRoutes.flatMap((v) => routes[v] ?? []));
    const idPick = idQids.size === 1 ? { qid: [...idQids][0], via: idRoutes[0] } : null;
    if (routes.p13468?.length === 1) {
      qid.set(p.id, { qid: routes.p13468[0], via: "p13468" });
    } else if (routes.p13468 && idPick && routes.p13468.includes(idPick.qid)) {
      // Zwei Items tragen dieselbe Kantonsrats-ID (Dublette auf Wikidata):
      // die Normdaten entscheiden.
      qid.set(p.id, { qid: idPick.qid, via: "p13468" });
    } else if (!routes.p13468 && idPick) {
      qid.set(p.id, idPick);
    }
  }

  // Veraltete P13468: Items über Name + Geburtsdatum der Person mit der neuen ID
  // zuordnen – nur für Personen ohne andere Verknüpfung (stale.ts).
  const staleQids = [...new Set(staleP13468.map((s) => s.qid))];
  const details = await fetchStaleDetails(staleQids);
  const staleItems: StaleItem[] = staleQids.map((q) => ({
    qid: q,
    oldIds: staleP13468.filter((s) => s.qid === q).map((s) => s.krdbId),
    names: details.get(q)?.names ?? [],
    births: details.get(q)?.births ?? [],
  }));
  const linkedBefore = new Map([...qid].map(([id, l]) => [id, l.qid]));
  const stale = resolveStale(staleItems, persons, linkedBefore);
  for (const r of stale.resolved) {
    if (!qid.has(r.newId)) qid.set(r.newId, { qid: r.qid, via: "p13468alt" });
  }
  const staleResolved = stale.resolved.map((r) => ({
    ...r,
    hasNew: (byP13468.get(String(r.newId)) ?? []).includes(r.qid),
  }));

  const byQid = new Map<string, number[]>();
  for (const [id, { qid: q }] of qid) byQid.set(q, [...(byQid.get(q) ?? []), id]);
  const sharedQids = [...byQid]
    .filter(([, ids]) => ids.length > 1)
    .map(([q, ids]) => ({ qid: q, ids }))
    .sort((a, b) => a.qid.localeCompare(b.qid));

  return { qid, staleP13468, staleResolved, staleUnresolved: stale.unresolved, conflicts, sharedQids };
}

const LANG_ORDER = ["de", "mul", "en", "fr", "it"];

/** Labels/Aliasse und Geburtsdaten (mit Genauigkeit) der Items mit veralteter P13468. */
async function fetchStaleDetails(
  qids: string[],
): Promise<Map<string, { names: string[]; births: StaleItem["births"] }>> {
  const rows = new Map<string, { names: Array<{ name: string; rank: number }>; births: StaleItem["births"] }>();
  for (let i = 0; i < qids.length; i += BATCH) {
    const vs = qids
      .slice(i, i + BATCH)
      .map((q) => `wd:${q}`)
      .join(" ");
    const bindings = await sparql(`SELECT ?item ?name ?lang ?isLabel ?birth ?prec WHERE {
      VALUES ?item { ${vs} }
      { ?item rdfs:label ?name . BIND(1 AS ?isLabel) } UNION { ?item skos:altLabel ?name . BIND(0 AS ?isLabel) }
      BIND(LANG(?name) AS ?lang)
      FILTER(?lang IN ("de", "mul", "en", "fr", "it"))
      OPTIONAL { ?item p:P569/psv:P569 ?bv . ?bv wikibase:timeValue ?birth ; wikibase:timePrecision ?prec . }
    }`);
    for (const b of bindings) {
      const item = b["item"]?.value;
      const name = b["name"]?.value;
      if (!item || !name) continue;
      const q = qidOf(item);
      const row = rows.get(q) ?? { names: [], births: [] };
      // Labels vor Aliassen, Deutsch zuerst – der erste Name steht im Report.
      const rank = (b["isLabel"]?.value === "1" ? 0 : 10) + Math.max(0, LANG_ORDER.indexOf(b["lang"]?.value ?? ""));
      if (!row.names.some((n) => n.name === name)) row.names.push({ name, rank });
      const birth = b["birth"]?.value;
      const prec = Number(b["prec"]?.value);
      if (birth && prec && !row.births.some((x) => x.date === birth.slice(0, 10) && x.precision === prec)) {
        row.births.push({ date: birth.slice(0, 10), precision: prec });
      }
      rows.set(q, row);
    }
    await sleep(500);
  }
  return new Map(
    [...rows].map(([q, r]) => [q, { names: r.names.sort((a, b) => a.rank - b.rank).map((n) => n.name), births: r.births }]),
  );
}

/** P18 (Bild) der Items; bei mehreren Werten der alphabetisch erste Dateiname
 *  (deterministisch). Liefert QID → Commons-Dateiname (ohne «File:»). */
export async function fetchImages(qids: string[]): Promise<Map<string, string>> {
  const all = new Map<string, string[]>();
  for (let i = 0; i < qids.length; i += BATCH) {
    const vs = qids
      .slice(i, i + BATCH)
      .map((q) => `wd:${q}`)
      .join(" ");
    for (const b of await sparql(`SELECT ?item ?img WHERE { VALUES ?item { ${vs} } ?item wdt:P18 ?img . }`)) {
      const item = b["item"]?.value;
      const img = b["img"]?.value;
      if (!item || !img) continue;
      const file = decodeURIComponent(img.slice(img.lastIndexOf("/") + 1)).replace(/_/g, " ");
      const q = qidOf(item);
      all.set(q, [...(all.get(q) ?? []), file]);
    }
    await sleep(500);
  }
  return new Map([...all].map(([q, files]) => [q, files.sort()[0]]));
}
