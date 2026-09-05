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
LLM_MAX_INPUT_CHARS_ENV = "HACK_LLM_MAX_INPUT_CHARS"
LLM_MAX_NEW_TOKENS_ENV = "HACK_LLM_MAX_NEW_TOKENS"
DEFAULT_LLM_MAX_INPUT_CHARS = 12_000
DEFAULT_LLM_MAX_NEW_TOKENS = 512
LLM_PROVIDER_ENV = "HACK_LLM_PROVIDER"
LLM_API_BASE_URL_ENV = "HACK_LLM_API_BASE_URL"
LLM_API_KEY_ENV = "HACK_LLM_API_KEY"
LLM_API_KEY_FILE_ENV = "HACK_LLM_API_KEY_FILE"
LLM_API_MODEL_ID_ENV = "HACK_LLM_API_MODEL_ID"
LLM_API_TIMEOUT_ENV = "HACK_LLM_API_TIMEOUT_SECONDS"
LLM_REASONING_EFFORT_ENV = "HACK_LLM_REASONING_EFFORT"
DEFAULT_LLM_PROVIDER = "huggingface_local"
DEFAULT_LLM_API_TIMEOUT = 120
EMBEDDING_ENABLED_ENV = "HACK_EMBEDDING_ENABLED"
EMBEDDING_MODEL_ID_ENV = "HACK_EMBEDDING_MODEL_ID"
DEFAULT_EMBEDDING_MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
EMBEDDING_MAX_INPUT_CHARS_ENV = "HACK_EMBEDDING_MAX_INPUT_CHARS"
EMBEDDING_BATCH_SIZE_ENV = "HACK_EMBEDDING_BATCH_SIZE"
DEFAULT_EMBEDDING_MAX_INPUT_CHARS = 600
DEFAULT_EMBEDDING_BATCH_SIZE = 8
COLLECTION_FILE_ROOT_ENV = "HACK_COLLECTION_FILE_ROOT"
TELEGRAM_BOT_TOKEN_ENV = "HACK_TELEGRAM_BOT_TOKEN"
TELEGRAM_BOT_TOKEN_FILE_ENV = "HACK_TELEGRAM_BOT_TOKEN_FILE"
TELEGRAM_AUTH_MAX_AGE_ENV = "HACK_TELEGRAM_AUTH_MAX_AGE_SECONDS"
DEFAULT_TELEGRAM_AUTH_MAX_AGE = 86_400


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


def get_llm_max_input_chars() -> int:
    return _positive_int(LLM_MAX_INPUT_CHARS_ENV, DEFAULT_LLM_MAX_INPUT_CHARS)


def get_llm_max_new_tokens() -> int:
    return _positive_int(LLM_MAX_NEW_TOKENS_ENV, DEFAULT_LLM_MAX_NEW_TOKENS)


def get_llm_provider() -> str:
    value = os.getenv(LLM_PROVIDER_ENV, DEFAULT_LLM_PROVIDER).strip().casefold()
    if value not in {"huggingface_local", "openai_compatible"}:
        raise ValueError(
            "HACK_LLM_PROVIDER must be huggingface_local or openai_compatible"
        )
    return value


def get_llm_api_base_url() -> str | None:
    value = os.getenv(LLM_API_BASE_URL_ENV)
    return value.rstrip("/") if value and value.strip() else None


def get_llm_api_key() -> str | None:
    return _secret_value(LLM_API_KEY_ENV, LLM_API_KEY_FILE_ENV)


def get_llm_api_model_id() -> str:
    return os.getenv(LLM_API_MODEL_ID_ENV, get_hf_model_id())


def get_llm_api_timeout() -> int:
    return _positive_int(LLM_API_TIMEOUT_ENV, DEFAULT_LLM_API_TIMEOUT)


def get_llm_reasoning_effort() -> str | None:
    value = os.getenv(LLM_REASONING_EFFORT_ENV)
    return value.strip().casefold() if value and value.strip() else None


def embedding_enabled() -> bool:
    return os.getenv(EMBEDDING_ENABLED_ENV, "0").casefold() in {"1", "true", "yes"}


def get_embedding_model_id() -> str:
    return os.getenv(EMBEDDING_MODEL_ID_ENV, DEFAULT_EMBEDDING_MODEL_ID)


def get_embedding_max_input_chars() -> int:
    return _positive_int(
        EMBEDDING_MAX_INPUT_CHARS_ENV,
        DEFAULT_EMBEDDING_MAX_INPUT_CHARS,
    )


def get_embedding_batch_size() -> int:
    return _positive_int(EMBEDDING_BATCH_SIZE_ENV, DEFAULT_EMBEDDING_BATCH_SIZE)


def get_collection_file_root() -> Path:
    """Restrict local file sources to an explicit directory tree."""

    return Path(os.getenv(COLLECTION_FILE_ROOT_ENV, REPOSITORY_ROOT)).resolve()


def get_telegram_bot_token() -> str | None:
    return _secret_value(TELEGRAM_BOT_TOKEN_ENV, TELEGRAM_BOT_TOKEN_FILE_ENV)


def get_telegram_auth_max_age() -> int:
    return _positive_int(TELEGRAM_AUTH_MAX_AGE_ENV, DEFAULT_TELEGRAM_AUTH_MAX_AGE)


def _positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, default))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _secret_value(value_env: str, file_env: str) -> str | None:
    """Read a secret from an env value or a Docker-style secret file."""

    value = os.getenv(value_env)
    if value and value.strip():
        return value.strip()

    secret_path = os.getenv(file_env)
    if not secret_path or not secret_path.strip():
        return None

    try:
        value = Path(secret_path).read_text(encoding="utf-8")
    except OSError:
        return None
    return value.strip() or None
