#!/usr/bin/env python3
"""Create an idempotent offline SQLite demo database from versioned JSON seed."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SEED_DIR = ROOT / "data" / "seed"
DEFAULT_DB = ROOT / ".local" / "demo.sqlite3"


def load_json(name: str) -> list[dict[str, Any]]:
    with (SEED_DIR / name).open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, list):
        raise ValueError(f"{name}: expected a JSON array")
    return value


def content_hash(content: str) -> str:
    normalized = " ".join(content.split()).casefold()
    return "sha256:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_seed(
    sources: list[dict[str, Any]],
    publications: list[dict[str, Any]],
    analyses: list[dict[str, Any]],
) -> None:
    if len(sources) != 5:
        raise ValueError(f"expected 5 sources, got {len(sources)}")
    if len(publications) != 10:
        raise ValueError(f"expected 10 publications, got {len(publications)}")
    if len(analyses) != 10:
        raise ValueError(f"expected 10 replay analyses, got {len(analyses)}")

    source_ids = {item["id"] for item in sources}
    publication_ids = {item["id"] for item in publications}
    if len(source_ids) != len(sources) or len(publication_ids) != len(publications):
        raise ValueError("source and publication ids must be unique")
    if any(item["source_id"] not in source_ids for item in publications):
        raise ValueError("publication references an unknown source")
    if {item["publication_id"] for item in analyses} != publication_ids:
        raise ValueError("every publication must have exactly one replay analysis")
    if any(item.get("analyzer") != "replay" for item in analyses):
        raise ValueError("all demo analyses must use the replay analyzer")


def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            url TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS publications (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES sources(id),
            external_id TEXT NOT NULL,
            canonical_url TEXT NOT NULL UNIQUE,
            content_hash TEXT NOT NULL,
            published_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            UNIQUE(source_id, external_id),
            UNIQUE(content_hash)
        );

        CREATE TABLE IF NOT EXISTS analysis_versions (
            id TEXT PRIMARY KEY,
            publication_id TEXT NOT NULL REFERENCES publications(id),
            version INTEGER NOT NULL,
            analyzer TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            UNIQUE(publication_id, version)
        );
        """
    )


def import_seed(database: Path) -> tuple[int, int, int]:
    sources = load_json("sources.json")
    publications = load_json("publications.json")
    analyses = load_json("replay-analyses.json")
    validate_seed(sources, publications, analyses)

    database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as connection:
        initialize_schema(connection)

        for source in sources:
            connection.execute(
                """
                INSERT INTO sources (id, name, type, url, enabled, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    type = excluded.type,
                    url = excluded.url,
                    enabled = excluded.enabled,
                    payload_json = excluded.payload_json
                """,
                (
                    source["id"],
                    source["name"],
                    source["type"],
                    source["url"],
                    int(source["enabled"]),
                    json.dumps(source, ensure_ascii=False, sort_keys=True),
                ),
            )

        publication_hashes: dict[str, str] = {}
        for publication in publications:
            digest = content_hash(publication["content"])
            publication_hashes[publication["id"]] = digest
            payload = {
                **publication,
                "canonical_url": publication["original_url"],
                "collected_at": publication["published_at"],
                "content_hash": digest,
            }
            connection.execute(
                """
                INSERT INTO publications (
                    id, source_id, external_id, canonical_url, content_hash,
                    published_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source_id = excluded.source_id,
                    external_id = excluded.external_id,
                    canonical_url = excluded.canonical_url,
                    content_hash = excluded.content_hash,
                    published_at = excluded.published_at,
                    payload_json = excluded.payload_json
                """,
                (
                    publication["id"],
                    publication["source_id"],
                    publication["external_id"],
                    publication["original_url"],
                    digest,
                    publication["published_at"],
                    json.dumps(payload, ensure_ascii=False, sort_keys=True),
                ),
            )

        for analysis in analyses:
            payload = {
                **analysis,
                "input_hash": publication_hashes[analysis["publication_id"]],
                "created_at": "2026-09-01T12:05:00Z",
            }
            connection.execute(
                """
                INSERT INTO analysis_versions (
                    id, publication_id, version, analyzer, input_hash, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    publication_id = excluded.publication_id,
                    version = excluded.version,
                    analyzer = excluded.analyzer,
                    input_hash = excluded.input_hash,
                    payload_json = excluded.payload_json
                """,
                (
                    analysis["id"],
                    analysis["publication_id"],
                    analysis["version"],
                    analysis["analyzer"],
                    payload["input_hash"],
                    json.dumps(payload, ensure_ascii=False, sort_keys=True),
                ),
            )

        counts = tuple(
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("sources", "publications", "analysis_versions")
        )
    return counts  # type: ignore[return-value]


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
