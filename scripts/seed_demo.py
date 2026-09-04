#!/usr/bin/env python3
"""CLI for creating the idempotent offline SQLite demo database."""

import argparse
from pathlib import Path

if __package__:
    from scripts.seed_core import DEFAULT_DB, import_seed
else:
    from seed_core import DEFAULT_DB, import_seed


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
