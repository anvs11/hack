#!/usr/bin/env python3
"""Run live collection once or periodically in a separate process."""

import argparse
import sys
import time
from pathlib import Path

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.config import REPOSITORY_ROOT
from backend.app.db import build_engine, create_schema
from backend.app.modules.sources.collection_service import collect_enabled_sources


DEFAULT_COLLECTION_INTERVAL_SECONDS = 30 * 60


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=REPOSITORY_ROOT / ".local/live.sqlite3")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_COLLECTION_INTERVAL_SECONDS,
        help="Seconds between collection runs (default: 1800 / 30 minutes)",
    )
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.interval < 60:
        parser.error("--interval must be at least 60 seconds")

    engine = build_engine(f"sqlite:///{args.db.resolve()}")
    create_schema(engine)
    try:
        while True:
            with Session(engine, expire_on_commit=False) as session:
                report = collect_enabled_sources(session)
            print(report.model_dump_json(), flush=True)
            if args.once:
                return
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
