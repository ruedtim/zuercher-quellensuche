#!/usr/bin/env python3
"""
NER im Textmodus: dasselbe SpanMarker-Modell und dieselbe spaCy-Pipeline wie
ner_xml.py, aber auf kurze Texte aus einer JSONL-Datei statt auf TEI-Absätze.

Für den Archivkatalog (services/catalog): Eingabe ist `ner-input` mit je einer
Zeile {"id", "hash", "text"} (Titel, Regest, «Inhalt und Form»), Ausgabe je
Text {"id", "hash", "ents": [[Label, Text], …]} mit Label PER/LOC/ORG
(Ableitungen wie «zürcherisch» fallen weg). Bei einem Fehler ist "ents" null.

Resumierbar: Die Ausgabe wird fortgeschrieben; Zeilen, deren (id, hash) schon
darin steht, werden übersprungen – nach Abbruch denselben Befehl erneut
starten, nach einer Katalog-Aktualisierung laufen nur neue oder geänderte
Texte. Viele kurze Texte gehen gemeinsam durch `nlp.pipe` (Stapel über Texte
hinweg); scheitert ein Stapel, wird er Text für Text wiederholt.

Der Engpass ist der Aufwand pro Text (Batchgrösse 32 oder 128 gleich schnell,
~10 Texte/s auf Apple Silicon); mehrere Prozesse mit `--shard i/n` teilen die
Eingabe (Zeile k gehört zu Shard k mod n) und schreiben je eine eigene Datei.

    .venv/bin/python ner_text.py --input ner-input.jsonl.gz --output ner-spans.jsonl
    for i in 0 1 2; do .venv/bin/python ner_text.py --input ner-input.jsonl.gz \
        --output ner-spans.$i.jsonl --shard $i/3 & done; wait
"""

import argparse
import gc
import gzip
import json
import sys
import time
from pathlib import Path

import ner_xml as nx

LABELS = {"PER": "PER", "LOC": "LOC", "ORG": "ORG"}


def open_text(path: Path):
    return gzip.open(path, "rt", encoding="utf-8") if path.suffix == ".gz" else open(path, encoding="utf-8")


def done_keys(out: Path) -> set:
    keys = set()
    if not out.exists():
        return keys
    with open(out, encoding="utf-8") as fh:
        for line in fh:
            try:
                r = json.loads(line)
                keys.add((r["id"], r["hash"]))
            except (ValueError, KeyError):
                pass  # angeschnittene letzte Zeile nach Abbruch
    return keys


def ents_of(doc) -> list:
    return [[LABELS[e.label_], e.text] for e in doc.ents if e.label_ in LABELS]


def run_batch(nlp, batch: list, pipe_batch: int) -> list:
    texts = [nx.normalize_offsets(r["text"])[0] for r in batch]
    try:
        return [ents_of(doc) for doc in nlp.pipe(texts, batch_size=pipe_batch)]
    except Exception:  # noqa: BLE001 – SpanMarker scheitert an einzelnen Texten
        out = []
        for t in texts:
            try:
                out.append(ents_of(nlp(t)) if t else [])
            except Exception:  # noqa: BLE001
                out.append(None)
        return out


def main():
    ap = argparse.ArgumentParser(description="SpanMarker-NER auf JSONL-Texte (Archivkatalog).")
    ap.add_argument("--input", required=True, help="JSONL(.gz) mit id, hash, text")
    ap.add_argument("--output", required=True, help="JSONL mit id, hash, ents (wird fortgeschrieben)")
    ap.add_argument("--limit", type=int, default=None, help="Höchstens N neue Texte (Test)")
    ap.add_argument("--device", default=None, help="Gerät überschreiben: cpu | mps | cuda")
    ap.add_argument("--batch-size", type=int, default=None, help="SpanMarker-Batchgrösse (Sätze)")
    ap.add_argument("--texts-per-batch", type=int, default=256, help="Texte je nlp.pipe-Aufruf")
    ap.add_argument("--empty-cache-every", type=int, default=20, help="MPS-Cache alle N Stapel leeren (0 = nie)")
    ap.add_argument("--shard", default="0/1", help="i/n: nur Zeilen k mit k mod n = i (parallele Prozesse)")
    args = ap.parse_args()
    shard_i, shard_n = (int(x) for x in args.shard.split("/"))
    if not 0 <= shard_i < shard_n:
        print(f"--shard {args.shard}: i muss zwischen 0 und n-1 liegen.", file=sys.stderr)
        sys.exit(1)

    settings = nx.Settings()
    if not settings.sm_model:
        print("SM_MODEL ist nicht im .env gesetzt (siehe .env.example).", file=sys.stderr)
        sys.exit(1)
    if args.device:
        settings.device = args.device
    if args.batch_size:
        settings.batch_size = args.batch_size
    settings.device = nx.resolve_device(settings.device)

    out_path = Path(args.output).expanduser()
    skip = done_keys(out_path)
    print(f"[ner-text] {len(skip)} Texte schon erledigt; lade Pipeline "
          f"(Modell={settings.sm_model}, device={settings.device}, batch_size={settings.batch_size}) …", flush=True)
    nlp = nx.build_pipeline(settings)

    t0 = time.time()
    new = ents_total = failed = batches = 0
    batch: list = []

    def flush(fout):
        nonlocal ents_total, failed, batches
        for r, ents in zip(batch, run_batch(nlp, batch, settings.batch_size)):
            fout.write(json.dumps({"id": r["id"], "hash": r["hash"], "ents": ents}, ensure_ascii=False) + "\n")
            if ents is None:
                failed += 1
            else:
                ents_total += len(ents)
        fout.flush()
        batch.clear()
        batches += 1
        if args.empty_cache_every and batches % args.empty_cache_every == 0:
            gc.collect()
            nx._empty_mps_cache()
            rate = new / (time.time() - t0)
            print(f"[ner-text] {new} Texte | {rate:.1f} Texte/s | {ents_total} Entitäten | "
                  f"{failed} Fehler | Peak-RSS {nx.rss_mb():.0f} MB", flush=True)

    with open_text(Path(args.input).expanduser()) as fin, open(out_path, "a", encoding="utf-8") as fout:
        for k, line in enumerate(fin):
            if args.limit is not None and new >= args.limit:
                break
            if k % shard_n != shard_i:
                continue
            r = json.loads(line)
            if (r["id"], r["hash"]) in skip:
                continue
            batch.append(r)
            new += 1
            if len(batch) >= args.texts_per_batch:
                flush(fout)
        if batch:
            flush(fout)

    elapsed = time.time() - t0
    print(f"[ner-text] Fertig: {new} neue Texte in {nx.human_eta(elapsed)} "
          f"({new / elapsed if elapsed else 0:.1f}/s), {ents_total} Entitäten, {failed} Fehler.", flush=True)


if __name__ == "__main__":
    main()
