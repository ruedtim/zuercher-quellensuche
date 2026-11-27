"""Direkte NER auf flachen TEI-XML-Dateien – ohne Umweg über TEI Publisher.

Wendet das SpanMarker-Modell (team-data-ktzh/span-marker-ktzh-stazh)
direkt auf TEI-XML an und schreibt annotierte Kopien: erkannte Eigennamen werden
als Inline-Tags <persName>/<placeName>/<orgName n="uuid"> (Ableitungen mit
type="deriv") in die <p>-Elemente eingefügt. Format identisch zu den Golddaten,
kompatibel mit den bestehenden postprocessing/extract_*.py-Skripten.

Geeignet für *flache* TEI-Dokumente, bei denen <p> reinen Text ohne Inline-
Markup enthalten (KRP_late, OS_late, RRB_late sind zu 100 % flach). Absätze mit
Kindelementen werden zur Sicherheit unangetastet durchgereicht, nicht annotiert.

Die eigentliche Modell-/Offset-Logik stammt 1:1 aus der NER-API des Repos
machinelearningZH/named-entity-recognition_staatsarchiv (ner_api/app). Hier
laufen davon nur die Pipeline (spacy_integration.py) und der Satz-Splitter
(sentence_splitter.py) sowie die Offset-Funktionen normalize_offsets /
adjust_offset (aus app/main.py kopiert). TEI Publisher, eXist-DB und Docker
entfallen vollständig.

Aufruf (lokal, eigenes .venv – siehe README):
  .venv/bin/python ner_xml.py --input <dir> --output <dir> [--limit N]

Der Lauf ist resumierbar: bereits geschriebene Dateien werden übersprungen.
Nach einem Abbruch denselben Befehl erneut starten.
"""

import argparse
import os
import re
import sys
import time
import uuid
import gc
import resource
from pathlib import Path
from typing import List, Optional, Tuple

# Tokenizer-Fork-Warnungen unterdrücken (eine Pipeline, kein Bedarf an Parallelität)
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from lxml import etree
from pydantic_settings import BaseSettings, SettingsConfigDict
from spacy.lang.de import German

# Registriert die spaCy-Factories "span_marker_tunable" und "max_sen_len_splitter"
import spacy_integration  # noqa: F401
import sentence_splitter  # noqa: F401

TEI_NS = "http://www.tei-c.org/ns/1.0"
XML_PROLOG = b'<?xml version="1.0" encoding="UTF-8"?>'

# Mapping der SpanMarker-Labels auf TEI-Elementnamen (+ Ableitungs-Flag).
# Entspricht den Kern-NEs aus ner_api/resources/tagset_mapping.json.
LABEL_MAP = {
    "PER": ("persName", False),
    "LOC": ("placeName", False),
    "ORG": ("orgName", False),
    "PERderiv": ("persName", True),
    "LOCderiv": ("placeName", True),
    "ORGderiv": ("orgName", True),
}


class Settings(BaseSettings):
    """Liest die NER-Parameter aus dem service-lokalen .env (siehe .env.example)."""

    sm_model: Optional[str] = None
    device: str = "cpu"
    batch_size: int = 4
    ne_thresholds: Optional[dict] = None
    additional_punctuation: list = []
    split_overlong_sentences: bool = False

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), ".env"),
        extra="allow",
    )


# ---------------------------------------------------------------------------
# Offset-Logik – wörtlich aus ner_api/app/main.py (normalize_offsets /
# adjust_offset), damit die Resultate mit der Produktiv-API übereinstimmen.
# ---------------------------------------------------------------------------
def normalize_offsets(text: str) -> Tuple:
    offsets = []
    offset = 0

    text = re.sub(r"\xa0", " ", text)
    text = re.sub(r"\s", " ", text)
    text = text.rstrip()

    leading_spaces = re.match(r"^\s+", text, flags=re.UNICODE)
    leading_spaces_offset = leading_spaces.span()[1] if leading_spaces else 0
    offset += leading_spaces_offset

    text = text.strip()

    for match in re.finditer(r"\s{2,}", text, flags=re.UNICODE):
        span = match.span()
        start = span[0] - offset
        offset += span[1] - span[0] - 1
        offsets.append((start, offset))

    return (
        re.sub(r"\s{2,}", " ", text, flags=re.UNICODE),
        offsets,
        leading_spaces_offset,
    )


def adjust_offset(
    offsets: List, start: int, end: int, leading_spaces_offset: int
) -> Tuple:
    i = 0
    while i < len(offsets) and offsets[i][0] < start:
        i += 1
    adjStart = start + leading_spaces_offset if i == 0 else offsets[i - 1][1] + start

    while i < len(offsets) and offsets[i][0] < end:
        i += 1
    adjEnd = end + leading_spaces_offset if i == 0 else offsets[i - 1][1] + end
    return (adjStart, adjEnd)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
def build_pipeline(settings: Settings):
    """Baut die spaCy-Pipeline identisch zu ner_api/app/cache.py::get_pipeline."""
    nlp = German()
    sentencizer = nlp.add_pipe("sentencizer")
    sentencizer.punct_chars = sentencizer.punct_chars | set(
        settings.additional_punctuation or []
    )
    nlp.add_pipe(
        "span_marker_tunable",
        config={
            "model": settings.sm_model,
            "device": settings.device,
            "batch_size": settings.batch_size,
            "ne_thresholds": settings.ne_thresholds,
        },
    )
    if settings.split_overlong_sentences:
        nlp.add_pipe("max_sen_len_splitter", before="span_marker_tunable")
    return nlp


def extract_entities(nlp, text: str) -> List[Tuple[int, int, str, bool]]:
    """Liefert (start, end, tei_element, is_deriv) bezogen auf den Originaltext."""
    norm_text, norm_offsets, leading = normalize_offsets(text)
    if not norm_text:
        return []
    doc = nlp(norm_text)
    ents = []
    for ent in doc.ents:
        if ent.label_ in LABEL_MAP:
            start, end = adjust_offset(
                norm_offsets, ent.start_char, ent.end_char, leading
            )
            elem_name, is_deriv = LABEL_MAP[ent.label_]
            ents.append((start, end, elem_name, is_deriv))
    return ents


def annotate_paragraph(p, nlp) -> int:
    """Fügt Entitäts-Tags in ein flaches <p> ein. Gibt die Zahl der Tags zurück.

    Nur reine Text-Absätze (ohne Kindelemente) werden angefasst. Schlägt die
    Integritätsprüfung fehl, wird der Absatz auf den Originaltext zurückgesetzt
    (keine Annotation), statt das ganze Dokument zu verwerfen.
    """
    if len(p) > 0:  # bereits Kindelemente -> nicht flach, unangetastet lassen
        return 0
    text = p.text
    if not text or not text.strip():
        return 0

    try:
        ents = extract_entities(nlp, text)
    except Exception:
        # SpanMarker kann an einzelnen Absätzen scheitern (z. B. "detected an
        # empty sentence"). Solchen Absatz unannotiert lassen, statt das ganze
        # Dokument zu verwerfen.
        return -1
    if not ents:
        return 0

    # Nach Start sortieren und Überlappungen verwerfen.
    ents.sort(key=lambda x: x[0])
    filtered: List[Tuple[int, int, str, bool]] = []
    prev_end = -1
    for start, end, name, deriv in ents:
        if start >= prev_end and end <= len(text) and start < end:
            filtered.append((start, end, name, deriv))
            prev_end = end
    if not filtered:
        return 0

    p.text = text[: filtered[0][0]]
    for i, (start, end, name, deriv) in enumerate(filtered):
        el = etree.SubElement(p, f"{{{TEI_NS}}}{name}")
        el.text = text[start:end]
        el.set("n", str(uuid.uuid4()))
        if deriv:
            el.set("type", "deriv")
        nxt = filtered[i + 1][0] if i + 1 < len(filtered) else len(text)
        el.tail = text[end:nxt]

    # Integritätsprüfung: reiner Text nach Entfernen der Tags == Originaltext.
    rebuilt = p.text or ""
    for child in p:
        rebuilt += (child.text or "") + (child.tail or "")
    if rebuilt != text:
        # Zurücksetzen: Kindelemente entfernen, Originaltext wiederherstellen.
        for child in list(p):
            p.remove(child)
        p.text = text
        return -1  # Signal: Absatz wegen Integritätsproblem übersprungen

    return len(filtered)


def process_file(in_path: Path, out_path: Path, nlp) -> Tuple[int, int]:
    """Annotiert eine Datei. Gibt (entitaeten, uebersprungene_absaetze) zurück."""
    tree = etree.parse(str(in_path))
    root = tree.getroot()

    n_ents = 0
    n_skipped = 0
    for p in root.iter(f"{{{TEI_NS}}}p"):
        r = annotate_paragraph(p, nlp)
        if r < 0:
            n_skipped += 1
        else:
            n_ents += r

    out_path.parent.mkdir(parents=True, exist_ok=True)
    body = etree.tostring(root, encoding="UTF-8", xml_declaration=False)
    # Atomar schreiben: erst .tmp, dann umbenennen (keine halben Dateien bei Abbruch).
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    tmp.write_bytes(XML_PROLOG + body)
    os.replace(tmp, out_path)
    return n_ents, n_skipped


def rss_mb() -> float:
    """Peak-RSS des Prozesses in MB (macOS: Bytes, Linux: KB)."""
    maxrss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return maxrss / (1024 * 1024) if sys.platform == "darwin" else maxrss / 1024


def human_eta(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def resolve_device(device: str) -> str:
    """Fällt auf cpu zurück, wenn das gewünschte Gerät nicht verfügbar ist."""
    if device == "mps":
        try:
            import torch

            if not torch.backends.mps.is_available():
                print("[ner-xml] WARNUNG: MPS nicht verfügbar – nutze cpu.", flush=True)
                return "cpu"
        except Exception:
            return "cpu"
    if device == "cuda":
        try:
            import torch

            if not torch.cuda.is_available():
                print("[ner-xml] WARNUNG: CUDA nicht verfügbar – nutze cpu.", flush=True)
                return "cpu"
        except Exception:
            return "cpu"
    return device


def main():
    ap = argparse.ArgumentParser(
        description="Direkte NER auf flachen TEI-XML-Dateien (ohne TEI Publisher)."
    )
    ap.add_argument("--input", required=True, help="Quellverzeichnis mit *.xml")
    ap.add_argument("--output", required=True, help="Zielverzeichnis für annotiertes XML")
    ap.add_argument("--limit", type=int, default=None, help="Nur die ersten N Dateien (Test)")
    ap.add_argument("--recursive", action="store_true", help="Unterverzeichnisse einschliessen")
    ap.add_argument("--overwrite", action="store_true", help="Bestehende Ausgaben überschreiben (Standard: überspringen)")
    ap.add_argument("--device", default=None, help="Gerät überschreiben: cpu | mps | cuda")
    ap.add_argument("--batch-size", type=int, default=None, help="SpanMarker-Batchgröße (Standard 4; höher = schneller, mehr Speicher)")
    ap.add_argument("--empty-cache-every", type=int, default=200, help="MPS-Cache alle N Dateien leeren (0 = nie)")
    ap.add_argument("--reload-every", type=int, default=0, help="Pipeline alle N Dateien neu laden (0 = nie; kappt Vokabular-Wachstum bei sehr grossen Läufen)")
    args = ap.parse_args()

    in_dir = Path(args.input).expanduser()
    out_dir = Path(args.output).expanduser()
    pattern = "**/*.xml" if args.recursive else "*.xml"
    files = sorted(in_dir.glob(pattern))
    if args.limit is not None:
        files = files[: args.limit]
    if not files:
        print(f"Keine XML-Dateien in {in_dir} gefunden.", file=sys.stderr)
        sys.exit(1)

    settings = Settings()
    if not settings.sm_model:
        print("SM_MODEL ist nicht im .env gesetzt (siehe .env.example).", file=sys.stderr)
        sys.exit(1)
    if args.device:
        settings.device = args.device
    if args.batch_size:
        settings.batch_size = args.batch_size
    settings.device = resolve_device(settings.device)

    print(
        f"[ner-xml] Lade Pipeline (Modell={settings.sm_model}, device={settings.device}, "
        f"batch_size={settings.batch_size}) ...",
        flush=True,
    )
    nlp = build_pipeline(settings)

    total_ents = 0
    total_skipped = 0
    errors = 0
    done = 0
    t0 = time.time()
    for i, fp in enumerate(files, 1):
        out_path = out_dir / (fp.relative_to(in_dir) if args.recursive else fp.name)

        # Resumierbarkeit: vollständig geschriebene Ausgaben überspringen.
        if not args.overwrite and out_path.exists() and out_path.stat().st_size > 0:
            continue

        try:
            n, skipped = process_file(fp, out_path, nlp)
            total_ents += n
            total_skipped += skipped
            done += 1
            note = f" ({skipped} Absätze übersprungen)" if skipped else ""
            print(f"[{i}/{len(files)}] {fp.name}: {n} Entitäten{note}", flush=True)
        except MemoryError:
            # Speichernot: aufräumen und abbrechen – Lauf ist via skip-existing
            # resumierbar, blindes Weiterlaufen unter Druck wäre riskant.
            gc.collect()
            _empty_mps_cache()
            print(f"[ner-xml] MemoryError bei {fp.name} – Abbruch. "
                  f"Befehl erneut starten, um fortzusetzen.", file=sys.stderr, flush=True)
            raise
        except Exception as e:  # noqa: BLE001
            errors += 1
            print(f"[{i}/{len(files)}] FEHLER {fp.name}: {e}", file=sys.stderr, flush=True)

        # Periodisches Aufräumen (kappt MPS-Allocator-Hochwasserstand).
        if args.empty_cache_every and i % args.empty_cache_every == 0:
            gc.collect()
            _empty_mps_cache()
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed else 0
            eta = (len(files) - i) / rate if rate else 0
            print(f"[ner-xml] {i}/{len(files)} | {rate:.1f} Dok/s | "
                  f"ETA {human_eta(eta)} | Peak-RSS {rss_mb():.0f} MB", flush=True)

        # Optionaler Pipeline-Reload (setzt spaCy-Vokabular zurück).
        if args.reload_every and i % args.reload_every == 0:
            del nlp
            gc.collect()
            _empty_mps_cache()
            nlp = build_pipeline(settings)

    elapsed = time.time() - t0
    print(
        f"\n[ner-xml] Fertig: {done} verarbeitet, "
        f"{len(files) - done - errors} übersprungen (vorhanden), {errors} Fehler | "
        f"{total_ents} Entitäten, {total_skipped} Absätze unannotiert übersprungen | "
        f"{human_eta(elapsed)} | Peak-RSS {rss_mb():.0f} MB | Output: {out_dir}"
    )


def _empty_mps_cache():
    try:
        from torch import mps

        mps.empty_cache()
    except Exception:
        pass


if __name__ == "__main__":
    main()
