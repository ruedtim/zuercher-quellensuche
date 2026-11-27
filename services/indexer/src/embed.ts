import type { MeiliDoc } from "./types.ts";

/**
 * Batch-Encoder gegen den embed-FastAPI-Service.
 * Schreibt das Resultat in `doc._vectors.jina_de`.
 */
export class EmbedClient {
  constructor(
    private readonly opts: {
      url: string;
      batchSize: number;
      concurrency: number;
      timeoutMs?: number;
      /** Wiederholungen pro Batch bei transienten Fehlern (Default 4). */
      retries?: number;
    },
  ) {}

  async encodeBatch(docs: MeiliDoc[]): Promise<void> {
    // Embedding-Eingabe: Titel + erste ~1500 Zeichen Body. Chunking überlassen wir
    // dem Modell (es taillert auf max_seq_length=512). Nur ein Vector pro Doc.
    const texts = docs.map((d) => buildEmbeddingText(d));
    const batches = chunk(texts, this.opts.batchSize);

    // Parallel mit Concurrency-Limit
    const results: number[][] = new Array(texts.length);
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const totalBatches = batches.length;

    for (let w = 0; w < this.opts.concurrency; w++) {
      workers.push(
        (async () => {
          while (true) {
            const i = cursor++;
            if (i >= totalBatches) return;
            const batch = batches[i];
            const vectors = await this.fetchBatch(batch);
            const offset = i * this.opts.batchSize;
            for (let k = 0; k < vectors.length; k++) {
              results[offset + k] = vectors[k];
            }
          }
        })(),
      );
    }
    await Promise.all(workers);

    for (let i = 0; i < docs.length; i++) {
      docs[i]._vectors = { jina_de: results[i] };
    }
  }

  private async fetchBatch(texts: string[]): Promise<number[][]> {
    const retries = this.opts.retries ?? 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120_000);
      try {
        const res = await fetch(`${this.opts.url}/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ texts }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`embed ${res.status}: ${body.slice(0, 500)}`);
        }
        const json = (await res.json()) as { vectors: number[][] };
        return json.vectors;
      } catch (err) {
        lastErr = err;
        // Transiente Fehler (Service-Restart/OOM → "other side closed", Timeout):
        // mit Backoff erneut versuchen, statt das ganze Doc zu verlieren.
        if (attempt < retries) await sleep(1000 * 2 ** attempt);
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr;
  }

  async healthz(): Promise<{ status: string; dim?: number }> {
    const res = await fetch(`${this.opts.url}/healthz`);
    if (!res.ok) throw new Error(`embed healthz ${res.status}`);
    return res.json() as Promise<{ status: string; dim?: number }>;
  }
}

function buildEmbeddingText(doc: MeiliDoc): string {
  // Titel + Body-Anfang. Der Tokenizer kümmert sich um Truncation auf 512 Tokens.
  const head = doc.title.trim();
  const body = doc.body.slice(0, 1500);
  return head ? `${head}\n\n${body}` : body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
