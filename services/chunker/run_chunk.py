"""Chunkt TEI-Dokumente mit der exakten Staatsarchiv-Pipeline.

Reihenfolge pro Dokument – wie der frühere Passagen-Index dieser Plattform gebaut wurde (empirisch
verifiziert am Weaviate-Export: generic-Marker alle 0, aber 95 % der Chunks
enthalten Ziffern und 30 % Einzelzeichen ⇒ semantic_text_cleaning des
06a-Notebooks war NICHT aktiv):
  1. generic_text_cleaning auf title UND text separat
  2. text = title + " " + text   (Titel als Semantik-Signal)
  3. chunk_text(max_token_count=500, overlap_tokens=100)

Output: JSONL.gz mit {docId, seq, chunkText} – seq ist hier die ECHTE
Chunk-Reihenfolge (anders als beim Weaviate-Export, wo sie verloren ist).

Aufruf:
  .venv/bin/python run_chunk.py --out late-chunks.jsonl.gz \
      ~/zszh-chunking-input/KRP_late ~/zszh-chunking-input/RRB_late \
      ~/zszh-chunking-input/OS_late
  # ABl-Lücke (Jahr aus dem Dateinamen ABl_<YYYY>__…):
  .venv/bin/python run_chunk.py --out abl-chunks.jsonl.gz \
      --abl-years 1930-1979 ~/zszh-chunking-input/ABl
"""

import argparse
import gzip
import json
import multiprocessing as mp
import re
import sys
from pathlib import Path

from tqdm import tqdm

import staatsarchiv_compat as sc
from tei_extract import extract

ABL_YEAR_RE = re.compile(r"^ABl_(\d{4})")


def list_files(dirs: list[str], abl_years: tuple[int, int] | None) -> list[Path]:
    files: list[Path] = []
    for d in dirs:
        for p in sorted(Path(d).expanduser().rglob("*.xml")):
            m = ABL_YEAR_RE.match(p.name)
            if abl_years and m:
                year = int(m.group(1))
                if not (abl_years[0] <= year <= abl_years[1]):
                    continue
            elif abl_years and not m:
                # --abl-years gesetzt, aber Datei ist kein ABl → unverändert rein.
                pass
            files.append(p)
    return files


def process_file(path: Path) -> list[dict]:
    rec = extract(path)
    title = sc.generic_text_cleaning(rec["title"])
    text = sc.generic_text_cleaning(rec["text"])
    # KEIN semantic_text_cleaning – der frühere Index wurde ohne gebaut
    # (Ziffern bleiben erhalten), siehe Modul-Docstring.
    text = (title + " " + text).strip()
    if not text:
        return []
    chunks = sc.chunk_text(rec["docId"], text, max_token_count=500, overlap_tokens=100)
    return [
        {"docId": doc_id, "seq": i, "chunkText": chunk}
        for i, (doc_id, chunk) in enumerate(chunks)
        if chunk.strip()
    ]


def worker(path_str: str) -> list[dict]:
    try:
        return process_file(Path(path_str))
    except Exception as err:  # einzelne kaputte Files nicht den Lauf killen lassen
        print(f"[chunk] FEHLER {path_str}: {err}", file=sys.stderr, flush=True)
        return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+", help="TEI-Verzeichnisse (rekursiv)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--abl-years", help="z. B. 1930-1979 – filtert ABl_<YYYY>-Dateien")
    ap.add_argument("--processes", type=int, default=max(2, mp.cpu_count() - 2))
    ap.add_argument("--limit", type=int, help="nur erste N Dateien (Test)")
    args = ap.parse_args()

    abl_years = None
    if args.abl_years:
        lo, hi = args.abl_years.split("-")
        abl_years = (int(lo), int(hi))

    files = list_files(args.dirs, abl_years)
    if args.limit:
        files = files[: args.limit]
    print(f"[chunk] {len(files)} Dateien, {args.processes} Prozesse", flush=True)

    total_chunks = 0
    docs_done = 0
    with gzip.open(args.out, "wt", encoding="utf-8") as out:
        with mp.Pool(processes=args.processes) as pool:
            for recs in tqdm(
                pool.imap_unordered(worker, [str(f) for f in files], chunksize=8),
                total=len(files),
                smoothing=0.05,
            ):
                for rec in recs:
                    out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                total_chunks += len(recs)
                docs_done += 1

    print(f"[chunk] FERTIG: {docs_done} Docs → {total_chunks} Chunks → {args.out}", flush=True)


if __name__ == "__main__":
    main()
