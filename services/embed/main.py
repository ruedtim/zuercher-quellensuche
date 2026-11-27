"""ZSZH embed-service. POST /embed → 768-d Vector pro Text.

Schlanker Microservice: nur ein Modell, ein Endpoint. Wird vom Indexer beim
Bulk-Import und vom SvelteKit-API-Proxy bei jeder Hybrid-Suche aufgerufen.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

log = logging.getLogger("zszh-embed")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MODEL_NAME = os.environ.get("ZSZH_MODEL", "jinaai/jina-embeddings-v2-base-de")
MAX_SEQ_LENGTH = int(os.environ.get("ZSZH_MAX_SEQ_LENGTH", "512"))

_state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("loading model %s", MODEL_NAME)
    model = SentenceTransformer(MODEL_NAME, trust_remote_code=True)
    model.max_seq_length = MAX_SEQ_LENGTH
    model.eval()
    # JIT-Warmup: erste echte Inferenz ist sonst um Faktor 3–5× langsamer
    model.encode(["warmup"], normalize_embeddings=True, show_progress_bar=False)
    _state["model"] = model
    log.info("ready (max_seq_length=%d, dim=%d)", MAX_SEQ_LENGTH, model.get_sentence_embedding_dimension())
    yield


app = FastAPI(title="zszh-embed", lifespan=lifespan)


class EmbedReq(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=512)


@app.post("/embed")
def embed(req: EmbedReq):
    vectors = _state["model"].encode(
        req.texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_tensor=False,
    )
    return {"vectors": [v.tolist() for v in vectors]}


@app.get("/healthz")
def healthz():
    if "model" not in _state:
        return {"status": "loading", "model": MODEL_NAME}
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "dim": _state["model"].get_sentence_embedding_dimension(),
    }
