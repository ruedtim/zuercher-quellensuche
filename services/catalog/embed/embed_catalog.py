#!/usr/bin/env python3
"""jina-Embeddings für den Katalog-Index (Mac, Apple-MPS oder CPU).

1. Rechnet für jeden Text aus `main.ts embed-input` einen Vektor mit
   jinaai/jina-embeddings-v2-base-de (768-dim, Mean-Pooling, normiert – wie die
   Dokument-Vektoren der Plattform). Der Cache (SQLite, Schlüssel = Hash aus
   Modell und Text) macht den Lauf resumierbar; ein späterer Aufbau rechnet nur
   neue oder geänderte Texte.
2. Schreibt die Katalog-Dokumente mit `_vectors.jina_de` (Vektor oder null) und
   `embedded` (filterbar) neu. Meili verlangt den `_vectors`-Schlüssel an jedem
   Dokument, sobald der Index einen userProvided-Embedder hat.

    python -I embed/embed_catalog.py --input <embed-input.jsonl.gz> \\
        --docs <catalog-docs.jsonl.gz> --cache <embed-cache.sqlite> --out <docs-mit-vektoren.jsonl.gz>

Läuft mit dem Python des ner-xml-venv (torch, transformers). Das Modell muss im
Hugging-Face-Cache liegen oder wird beim ersten Lauf geladen.
"""

import argparse
import gzip
import hashlib
import json
import os
import sqlite3
import sys
import time

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MODEL = "jinaai/jina-embeddings-v2-base-de"
DIMS = 768


def read_jsonl(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def text_key(text):
    return hashlib.sha1(f"{MODEL}\0{text}".encode("utf-8")).hexdigest()


def embed_missing(db, items, batch_size, device):
    known = {row[0] for row in db.execute("SELECT key FROM vec")}
    unique = {}
    for _, text in items:
        unique.setdefault(text_key(text), text)
    todo = {k: t for k, t in unique.items() if k not in known}
    print(f"[embed] {len(items)} Einheiten, {len(unique)} verschiedene Texte, "
          f"{len(unique) - len(todo)} im Cache, {len(todo)} zu rechnen", flush=True)
    if not todo:
        return
    tok = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModel.from_pretrained(MODEL, trust_remote_code=True).to(device).eval()
    # Nach Länge sortiert: kaum Padding, ähnlich lange Batches.
    order = sorted(todo, key=lambda k: len(todo[k]))
    t0 = time.time()
    done = 0
    with torch.no_grad():
        for start in range(0, len(order), batch_size):
            keys = order[start:start + batch_size]
            enc = tok([todo[k] for k in keys], padding=True, truncation=True, max_length=512, return_tensors="pt").to(device)
            hidden = model(**enc)[0]
            mask = enc["attention_mask"].unsqueeze(-1).to(hidden.dtype)
            vecs = torch.nn.functional.normalize((hidden * mask).sum(1) / mask.sum(1), dim=-1).float().cpu().numpy()
            db.executemany("INSERT OR REPLACE INTO vec (key, v) VALUES (?, ?)",
                           [(k, v.astype(np.float32).tobytes()) for k, v in zip(keys, vecs)])
            done += len(keys)
            if (start // batch_size) % 50 == 0 or done == len(order):
                db.commit()
                rate = done / max(time.time() - t0, 1e-6)
                print(f"[embed] {done}/{len(order)} ({rate:.0f}/s, noch ~{(len(order) - done) / rate / 60:.0f} min)", flush=True)
    db.commit()


def attach(db, items, docs_path, out_path):
    id_key = {doc_id: text_key(text) for doc_id, text in items}
    tmp = out_path + ".tmp"
    n = embedded = 0
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=4) as out:
        for doc in read_jsonl(docs_path):
            n += 1
            vec = None
            k = id_key.get(doc["id"])
            if k is not None:
                row = db.execute("SELECT v FROM vec WHERE key = ?", (k,)).fetchone()
                if row is None:
                    raise SystemExit(f"Vektor fehlt im Cache für Einheit {doc['id']}")
                vec = np.round(np.frombuffer(row[0], dtype=np.float32).astype(np.float64), 6).tolist()
                if len(vec) != DIMS:
                    raise SystemExit(f"Vektor mit {len(vec)} statt {DIMS} Dimensionen für Einheit {doc['id']}")
                embedded += 1
            doc["_vectors"] = {"jina_de": vec}
            doc["embedded"] = vec is not None
            out.write(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.replace(tmp, out_path)
    print(f"[embed] {n} Dokumente, davon {embedded} mit Vektor → {out_path}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--input", required=True, help="embed-input.jsonl.gz ({id, text})")
    ap.add_argument("--docs", required=True, help="catalog-docs.jsonl.gz (Ausgabe von build)")
    ap.add_argument("--cache", required=True, help="SQLite-Cache der Vektoren")
    ap.add_argument("--out", required=True, help="Dokumente mit _vectors (darf --docs sein)")
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    args = ap.parse_args()

    items = [(o["id"], o["text"]) for o in read_jsonl(args.input)]
    db = sqlite3.connect(args.cache)
    db.execute("CREATE TABLE IF NOT EXISTS vec (key TEXT PRIMARY KEY, v BLOB NOT NULL)")
    embed_missing(db, items, args.batch_size, args.device)
    attach(db, items, args.docs, args.out)
    db.close()


if __name__ == "__main__":
    sys.exit(main())
