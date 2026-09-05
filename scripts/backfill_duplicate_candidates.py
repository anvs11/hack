#!/usr/bin/env python3
"""Create one nearest-neighbour review candidate per existing publication."""

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session  # noqa: E402

from backend.app.db import build_engine, create_schema  # noqa: E402
from backend.app.modules.sources.dedup_service import (  # noqa: E402
    backfill_duplicate_candidates,
)
from backend.app.modules.sources.embeddings import HuggingFaceEmbedder  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=ROOT / ".local" / "live.sqlite3")
    parser.add_argument("--model-id", default="Qwen/Qwen3-Embedding-0.6B")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".local" / "huggingface")
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument(
        "--limit",
        type=int,
        default=40,
        help="Corpus prefix to process; use 0 for the full database.",
    )
    args = parser.parse_args()

    engine = build_engine(f"sqlite:///{args.db.resolve()}")
    create_schema(engine)
    embedder = HuggingFaceEmbedder(
        model_id=args.model_id,
        cache_dir=args.cache_dir,
        download_allowed=args.allow_download,
    )
    try:
        with Session(engine, expire_on_commit=False) as session:
            report = backfill_duplicate_candidates(
                session,
                embedder,
                limit=args.limit or None,
            )
        print(report.model_dump_json())
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
