"""Small runtime configuration for the backend."""

import os
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = REPOSITORY_ROOT / ".local" / "demo.sqlite3"
DATABASE_URL_ENV = "HACK_DATABASE_URL"
DEFAULT_HF_CACHE_PATH = Path.home() / ".cache" / "hack-ai-product" / "huggingface"
HF_CACHE_DIR_ENV = "HACK_HF_CACHE_DIR"
HF_ALLOW_DOWNLOAD_ENV = "HACK_HF_ALLOW_DOWNLOAD"
HF_MODEL_ID_ENV = "HACK_HF_MODEL_ID"
DEFAULT_HF_MODEL_ID = "Qwen/Qwen3.5-0.8B"
EMBEDDING_ENABLED_ENV = "HACK_EMBEDDING_ENABLED"
EMBEDDING_MODEL_ID_ENV = "HACK_EMBEDDING_MODEL_ID"
DEFAULT_EMBEDDING_MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
COLLECTION_FILE_ROOT_ENV = "HACK_COLLECTION_FILE_ROOT"


def get_database_url() -> str:
    """Return an override URL or the local demo SQLite URL."""

    return os.getenv(DATABASE_URL_ENV, f"sqlite:///{DEFAULT_DATABASE_PATH}")


def get_hf_cache_dir() -> Path:
    """Keep optional model weights outside the repository."""

    return Path(os.getenv(HF_CACHE_DIR_ENV, DEFAULT_HF_CACHE_PATH))


def get_hf_model_id() -> str:
    return os.getenv(HF_MODEL_ID_ENV, DEFAULT_HF_MODEL_ID)


def allow_hf_download() -> bool:
    return os.getenv(HF_ALLOW_DOWNLOAD_ENV, "0").casefold() in {"1", "true", "yes"}


def embedding_enabled() -> bool:
    return os.getenv(EMBEDDING_ENABLED_ENV, "0").casefold() in {"1", "true", "yes"}


def get_embedding_model_id() -> str:
    return os.getenv(EMBEDDING_MODEL_ID_ENV, DEFAULT_EMBEDDING_MODEL_ID)


def get_collection_file_root() -> Path:
    """Restrict local file sources to an explicit directory tree."""

    return Path(os.getenv(COLLECTION_FILE_ROOT_ENV, REPOSITORY_ROOT)).resolve()
