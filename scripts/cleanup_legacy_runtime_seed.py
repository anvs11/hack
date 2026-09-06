#!/usr/bin/env python3
"""Remove the exact legacy test seed from an old runtime SQLite database.

Current runtime never imports these IDs.  The command is intentionally narrow
and defaults to a read-only preview so user-created records cannot be matched by
name, URL or a broad ``demo`` pattern.
"""

import argparse
import json
import sqlite3
from pathlib import Path


SOURCE_IDS = (
    "source-regulation",
    "source-duma",
    "source-media-rss-1",
    "source-media-rss-2",
    "source-telegram-archive",
)
PUBLICATION_IDS = tuple(f"pub-{index:03d}" for index in range(1, 11))
CASE_IDS = ("case-001",)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with sqlite3.connect(args.db.resolve()) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        before = _counts(connection)
        if args.apply:
            _delete_exact_seed(connection)
        after = _counts(connection)
    print(json.dumps({
        "mode": "apply" if args.apply else "dry_run",
        "before": before,
        "after": after,
    }, ensure_ascii=False))


def _counts(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        "sources": _count_ids(connection, "sources", "id", SOURCE_IDS),
        "publications": _count_ids(connection, "publications", "id", PUBLICATION_IDS),
        "regulatory_cases": _count_ids(connection, "regulatory_cases", "id", CASE_IDS),
    }


def _count_ids(
    connection: sqlite3.Connection,
    table: str,
    column: str,
    values: tuple[str, ...],
) -> int:
    placeholders = ",".join("?" for _ in values)
    return int(connection.execute(
        f"SELECT COUNT(*) FROM {table} WHERE {column} IN ({placeholders})",
        values,
    ).fetchone()[0])


def _delete_exact_seed(connection: sqlite3.Connection) -> None:
    publications = ",".join("?" for _ in PUBLICATION_IDS)
    sources = ",".join("?" for _ in SOURCE_IDS)
    cases = ",".join("?" for _ in CASE_IDS)

    candidate_where = (
        f"publication_id IN ({publications}) OR "
        f"candidate_publication_id IN ({publications})"
    )
    candidate_args = PUBLICATION_IDS + PUBLICATION_IDS
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    if {"duplicate_reviews", "duplicate_candidates"} <= tables:
        connection.execute(
            f"DELETE FROM duplicate_reviews WHERE candidate_id IN "
            f"(SELECT id FROM duplicate_candidates WHERE {candidate_where})",
            candidate_args,
        )
    if "duplicate_candidates" in tables:
        connection.execute(
            f"DELETE FROM duplicate_candidates WHERE {candidate_where}",
            candidate_args,
        )
    if "telegram_digest_deliveries" in tables:
        connection.execute(
            f"DELETE FROM telegram_digest_deliveries WHERE analysis_id IN "
            f"(SELECT id FROM analysis_versions WHERE publication_id IN ({publications}))",
            PUBLICATION_IDS,
        )
    for table in (
        "specialist_decisions",
        "analysis_versions",
        "publication_embeddings",
        "publication_revisions",
    ):
        if table in tables:
            connection.execute(
                f"DELETE FROM {table} WHERE publication_id IN ({publications})",
                PUBLICATION_IDS,
            )
    if "publication_source_references" in tables:
        connection.execute(
            f"DELETE FROM publication_source_references WHERE "
            f"publication_id IN ({publications}) OR source_id IN ({sources})",
            PUBLICATION_IDS + SOURCE_IDS,
        )
    connection.execute(
        f"DELETE FROM regulatory_case_publications WHERE "
        f"case_id IN ({cases}) OR publication_id IN ({publications})",
        CASE_IDS + PUBLICATION_IDS,
    )
    connection.execute(
        f"DELETE FROM lifecycle_events WHERE regulatory_case_id IN ({cases})",
        CASE_IDS,
    )
    connection.execute(
        f"DELETE FROM regulatory_cases WHERE id IN ({cases})",
        CASE_IDS,
    )
    connection.execute(
        f"DELETE FROM publications WHERE id IN ({publications})",
        PUBLICATION_IDS,
    )
    connection.execute(
        f"DELETE FROM sources WHERE id IN ({sources})",
        SOURCE_IDS,
    )


if __name__ == "__main__":
    main()
