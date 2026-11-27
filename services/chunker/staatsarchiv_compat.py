"""Verbatim-Kopien der Cleaning- und Chunking-Funktionen aus der
Referenz-Pipeline (machinelearningZH/ai-search_staatsarchiv), mit der der frühere Passagen-Index
dieser Plattform gebaut wurde.

Quelle: https://github.com/machinelearningZH/ai-search_staatsarchiv
  - generic_text_cleaning:  staatsarchiv_utils.py (Z. ~292-341)
  - chunk_text:             staatsarchiv_utils.py (Z. ~344-412)
  - semantic_text_cleaning: 06a_chunk.ipynb (Cell 7)

NICHT umformulieren oder "verbessern" – neue Chunks müssen mit den ~1.3M
existierenden Chunks konsistent sein (gleiche Boundaries, gleiches Cleaning),
inklusive Eigenheiten (z. B. die Doppel-Subtraktion in der Overlap-Schleife).
Aufruf in der Produktion: max_token_count=500, overlap_tokens=100.

WICHTIG: semantic_text_cleaning ist hier nur dokumentiert – der frühere
Index wurde OHNE diesen Schritt gebaut (empirisch am Weaviate-Export
verifiziert: 95 % der Chunks enthalten Ziffern, generic-Marker fehlen
komplett). run_chunk.py wendet entsprechend nur generic_text_cleaning an.
"""

import re

# --- generic_text_cleaning (staatsarchiv_utils.py) -------------------------

pattern = r"(\x04|\x1a|\xa0|\x00|\ue83a|\x19|\uf06c|\x10|\x17|\x13|\x11|<space>|\x16|\x18|\x1b|\x15|\t\b|\f)"
ESCAPE_SEQS = re.compile(pattern)

pattern = (
    r"(?<=\s)(I.|II.|III.|IV.|V.|VI.|VII.|VIII.|IX.|X.|XI.|XII.|XIII.|XIV.|XV.)(?=\s)"
)
ROMAN_NUMERALS = re.compile(pattern)


def generic_text_cleaning(d):
    d = d.strip()

    # Remove non breaking spaces and escape sequences.
    d = re.sub(ESCAPE_SEQS, " ", d)

    # Remove punctuations.
    d = re.sub(r"[;«»„“:()\[\]]", " ", d)

    # Remove multiple dots.
    d = re.sub(r"\.{2,}", " ", d)

    # Remove roman numerals.
    d = re.sub(ROMAN_NUMERALS, " ", d)

    # Replace several symbolic chars with actual word.
    d = re.sub(r"&", " und ", d)
    d = re.sub(r"§", " Paragraph ", d)
    d = re.sub(r"=", " gleich ", d)

    # Replace multiple spaces with single space.
    d = re.sub(r"\s+", " ", d)

    # Again strip whitespace after all cleaning operations.
    d = d.strip()

    return d


# --- semantic_text_cleaning (06a_chunk.ipynb, Cell 7) -----------------------

DIGITS = re.compile(r"\d+")
MULTIPLE_SPACES = re.compile(r"[\s]+")
SINGLE_CHARACTERS = re.compile(r"\s.\s")


def semantic_text_cleaning(d):
    d = re.sub(DIGITS, " ", d)
    d = re.sub(MULTIPLE_SPACES, " ", d)
    d = re.sub(r"([!?.,;:•-]+){2,}", r"\1", d)
    d = re.sub(SINGLE_CHARACTERS, " ", d)
    d = d.strip()
    return d


# --- chunk_text (staatsarchiv_utils.py) -------------------------------------
# Original nimmt eine pandas-Row mit .identifier/.text; hier (identifier, text)
# als Argumente. nlp/tokenizer lazy, damit embed_chunks.py ohne spaCy läuft.

_nlp = None
_tokenizer = None


def _models():
    global _nlp, _tokenizer
    if _nlp is None:
        import spacy
        from transformers import AutoTokenizer

        _nlp = spacy.load("de_core_news_lg")
        model_path = "jinaai/jina-embeddings-v2-base-de"
        _tokenizer = AutoTokenizer.from_pretrained(model_path, use_fast=True)
    return _nlp, _tokenizer


def chunk_text(identifier, text, max_token_count=512, overlap_tokens=50):
    nlp, tokenizer = _models()

    # Sentencize text.
    doc = nlp(text)
    sents = [sent.text for sent in doc.sents]

    # Count tokens in each sentence.
    # TODO (Original): Sentences can potentially be longer than max_token_count.
    tokens = [len(tokenizer.tokenize(sent)) for sent in sents]

    # Create chunks by adding full sentences until max_token_count is reached.
    chunks = []
    current_chunk_start = 0
    current_sent = 0
    current_chunk = []
    current_tokens = 0

    while True:
        if current_sent >= len(sents):
            chunks.append(" ".join(current_chunk))
            break

        current_tokens += tokens[current_sent]
        if current_tokens < max_token_count:
            current_chunk.append(sents[current_sent])
            current_sent += 1
        else:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            current_tokens = 0

            # Go back n sents until we create an overlap of overlap_tokens or more.
            count_back_tokens = 0
            count_back_sents = 0
            while True:
                count_back_tokens += tokens[current_sent]
                count_back_sents += 1
                if count_back_tokens > overlap_tokens:
                    break
                current_sent -= 1
            current_sent -= count_back_sents

            # Avoid endless loop if overlap_sents is too high.
            if current_sent <= current_chunk_start:
                current_sent = current_chunk_start + 1
            current_chunk_start = current_sent

    return [(identifier, chunk) for chunk in chunks]
