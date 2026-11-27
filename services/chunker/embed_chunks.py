"""Embeddet Chunk-Texte mit exakt den Parametern der Staatsarchiv-Pipeline
(06b_embed_colab.ipynb): jinaai/jina-embeddings-v2-base-de, trust_remote_code,
max_seq_length=512, normalize_embeddings=True. Läuft lokal auf Apple-MPS
(Muster: services/indexer/local-embed/embed_local.ipynb).

Input:  JSONL.gz aus run_chunk.py ({docId, seq, chunkText})
Output: gleiche Zeilen + "vector": [768 floats]

Aufruf:
  .venv/bin/python embed_chunks.py --input late-chunks.jsonl.gz \
      --out late-chunks-embedded.jsonl.gz --batch 64

Ohne sentence-transformers (Hetzner): --service-url=http://localhost:8011/embed
schickt die Texte an den laufenden embed-Service (services/embed: dasselbe
Modell, max_seq_length 512, normalize).
"""

import argparse
import gzip
import json
import sys
import urllib.request

from tqdm import tqdm

MODEL = "jinaai/jina-embeddings-v2-base-de"


def local_encoder(device_arg):
    import torch
    from sentence_transformers import SentenceTransformer

    device = device_arg or (
        "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    )
    print(f"[embed] lade Modell (device={device}) …", flush=True)
    model = SentenceTransformer(MODEL, trust_remote_code=True, device=device)
    model.max_seq_length = 512
    return lambda texts, bs: model.encode(
        texts, batch_size=bs, convert_to_tensor=False, normalize_embeddings=True, show_progress_bar=False
    )


def service_encoder(url):
    print(f"[embed] über den embed-Service {url}", flush=True)

    def encode(texts, _bs):
        req = urllib.request.Request(
            url, data=json.dumps({"texts": texts}).encode(), headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=600) as resp:
            vectors = json.load(resp)["vectors"]
        if len(vectors) != len(texts) or len(vectors[0]) != 768:
            raise RuntimeError(f"embed-Service: {len(vectors)} Vektoren für {len(texts)} Texte")
        return vectors

    return encode


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--device", default=None, help="mps|cuda|cpu (Default: auto)")
    ap.add_argument("--service-url", default=None, help="embed-Service statt lokalem Modell")
    ap.add_argument("--limit", type=int, help="nur erste N Chunks (Test)")
    args = ap.parse_args()

    encode = service_encoder(args.service_url) if args.service_url else local_encoder(args.device)

    print(f"[embed] lese {args.input} …", flush=True)
    records: list[dict] = []
    with gzip.open(args.input, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                records.append(json.loads(line))
            if args.limit and len(records) >= args.limit:
                break
    print(f"[embed] {len(records)} Chunks", flush=True)

    with gzip.open(args.out, "wt", encoding="utf-8") as out:
        for start in tqdm(range(0, len(records), args.batch), smoothing=0.05):
            batch = records[start : start + args.batch]
            vectors = encode([r["chunkText"] for r in batch], args.batch)
            for rec, vec in zip(batch, vectors):
                rec["vector"] = [round(float(x), 7) for x in vec]
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"[embed] FERTIG → {args.out}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
