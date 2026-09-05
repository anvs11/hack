#!/usr/bin/env python3
"""Synchronize the reviewed live-source catalog with an application database."""

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.config import REPOSITORY_ROOT
from backend.app.db import build_engine, create_schema
from backend.app.modules.sources.catalog import sync_source_catalog


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=REPOSITORY_ROOT / ".local/live.sqlite3")
    parser.add_argument(
        "--catalog",
        type=Path,
        default=REPOSITORY_ROOT / "data/live/sources.json",
    )
    args = parser.parse_args()

    engine = build_engine(f"sqlite:///{args.db.resolve()}")
    create_schema(engine)
    with Session(engine) as session:
        created, updated = sync_source_catalog(session, args.catalog.resolve())
    engine.dispose()
    print(json.dumps({"created": created, "updated": updated}, ensure_ascii=False))


if __name__ == "__main__":
    main()
