#!/usr/bin/env python3
"""Create reproducible demo data and synchronize the live source catalog."""

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.db import build_engine, create_schema
from backend.app.modules.sources.catalog import sync_source_catalog
from scripts.seed_core import import_seed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=ROOT / "data/live/sources.json",
    )
    args = parser.parse_args()
    database_path = args.db.resolve()

    seed_counts = import_seed(database_path)
    engine = build_engine(f"sqlite:///{database_path}")
    create_schema(engine)
    with Session(engine) as session:
        created, updated = sync_source_catalog(session, args.catalog.resolve())
    engine.dispose()
    print(json.dumps({
        "seed": {
            "sources": seed_counts[0],
            "publications": seed_counts[1],
            "analyses": seed_counts[2],
        },
        "live_sources": {"created": created, "updated": updated},
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
