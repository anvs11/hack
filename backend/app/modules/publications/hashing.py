"""Stable hashes for publication deduplication."""

from hashlib import sha256


def content_hash(content: str) -> str:
    normalized = " ".join(content.split()).casefold()
    return f"sha256:{sha256(normalized.encode('utf-8')).hexdigest()}"
