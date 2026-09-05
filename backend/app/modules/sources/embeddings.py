"""Optional local embeddings used only to save review candidates."""

import math
from pathlib import Path
from typing import Any, Protocol

from backend.app.config import (
    allow_hf_download,
    embedding_enabled,
    get_embedding_batch_size,
    get_embedding_max_input_chars,
    get_embedding_model_id,
    get_hf_cache_dir,
)


class EmbedderUnavailable(RuntimeError):
    pass


class Embedder(Protocol):
    model_id: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HuggingFaceEmbedder:
    """Lazy Sentence Transformers adapter for Qwen3 embeddings."""

    def __init__(
        self,
        *,
        model_id: str | None = None,
        cache_dir: Path | None = None,
        download_allowed: bool | None = None,
        model: Any | None = None,
        max_input_chars: int | None = None,
        batch_size: int | None = None,
    ) -> None:
        self.model_id = model_id or get_embedding_model_id()
        self.cache_dir = cache_dir or get_hf_cache_dir()
        self.download_allowed = (
            allow_hf_download() if download_allowed is None else download_allowed
        )
        self._model = model
        self.max_input_chars = max_input_chars or get_embedding_max_input_chars()
        self.batch_size = batch_size or get_embedding_batch_size()

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self._model or self._load_model()
        try:
            vectors = model.encode(
                [text[: self.max_input_chars] for text in texts],
                normalize_embeddings=True,
                convert_to_numpy=True,
                batch_size=self.batch_size,
                show_progress_bar=False,
            )
            return vectors.tolist()
        except Exception as error:
            raise EmbedderUnavailable(
                "Embedding model failed to encode text"
            ) from error

    def _load_model(self) -> Any:
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(
                self.model_id,
                cache_folder=str(self.cache_dir),
                local_files_only=not self.download_allowed,
                trust_remote_code=False,
            )
            return self._model
        except Exception as error:
            raise EmbedderUnavailable(
                "Qwen embedding model is not available locally"
            ) from error


def build_optional_embedder() -> Embedder | None:
    if not embedding_enabled():
        return None
    return HuggingFaceEmbedder()


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        raise ValueError("embedding vectors must be non-empty and equal-sized")
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        raise ValueError("embedding vectors must be non-zero")
    return sum(a * b for a, b in zip(left, right, strict=True)) / (
        left_norm * right_norm
    )
