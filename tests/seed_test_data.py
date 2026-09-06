#!/usr/bin/env python3
"""Create an isolated SQLite database for automated tests."""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.seed_core import DEFAULT_DB, import_seed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    counts = import_seed(args.db.resolve())
    print(
        f"seeded {args.db.resolve()}: "
        f"sources={counts[0]}, publications={counts[1]}, analyses={counts[2]}"
    )


if __name__ == "__main__":
    main()
