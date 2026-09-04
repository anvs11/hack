"""Reusable standard-library implementation of the offline demo seed import."""

from __future__ import annotations

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
    regulatory_cases: list[dict[str, Any]] | None = None,
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
    if regulatory_cases is not None:
        case_ids = {item["id"] for item in regulatory_cases}
        if len(regulatory_cases) != 1 or len(case_ids) != 1:
            raise ValueError("expected exactly one unique demo regulatory case")
        if any(
            publication_id not in publication_ids
            for item in regulatory_cases
            for publication_id in item.get("related_publication_ids", [])
        ):
            raise ValueError("regulatory case references an unknown publication")


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

        CREATE TABLE IF NOT EXISTS specialist_decisions (
            id TEXT PRIMARY KEY,
            publication_id TEXT NOT NULL REFERENCES publications(id),
            analysis_id TEXT NOT NULL REFERENCES analysis_versions(id),
            version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            UNIQUE(publication_id, version)
        );

        CREATE TABLE IF NOT EXISTS regulatory_cases (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            registration_number TEXT NOT NULL,
            current_stage TEXT NOT NULL,
            responsible_user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS regulatory_case_publications (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES regulatory_cases(id),
            publication_id TEXT NOT NULL REFERENCES publications(id),
            created_at TEXT NOT NULL,
            UNIQUE(case_id, publication_id)
        );

        CREATE TABLE IF NOT EXISTS lifecycle_events (
            id TEXT PRIMARY KEY,
            regulatory_case_id TEXT NOT NULL REFERENCES regulatory_cases(id),
            stage TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            confirmation_url TEXT NOT NULL,
            confirmation_source_type TEXT NOT NULL,
            comment TEXT,
            author_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )


def import_seed(database: Path) -> tuple[int, int, int]:
    sources = load_json("sources.json")
    publications = load_json("publications.json")
    analyses = load_json("replay-analyses.json")
    regulatory_cases = load_json("regulatory-cases.json")
    validate_seed(sources, publications, analyses, regulatory_cases)

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

        for regulatory_case in regulatory_cases:
            connection.execute(
                """
                INSERT INTO regulatory_cases (
                    id, title, registration_number, current_stage,
                    responsible_user_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    registration_number = excluded.registration_number,
                    responsible_user_id = excluded.responsible_user_id
                """,
                (
                    regulatory_case["id"],
                    regulatory_case["title"],
                    regulatory_case["registration_number"],
                    regulatory_case["current_stage"],
                    regulatory_case["responsible_user_id"],
                    regulatory_case["created_at"],
                    regulatory_case["updated_at"],
                ),
            )
            for publication_id in regulatory_case.get("related_publication_ids", []):
                connection.execute(
                    """
                    INSERT OR IGNORE INTO regulatory_case_publications (
                        id, case_id, publication_id, created_at
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        f"seed-{regulatory_case['id']}-{publication_id}",
                        regulatory_case["id"],
                        publication_id,
                        regulatory_case["created_at"],
                    ),
                )

        counts = tuple(
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("sources", "publications", "analysis_versions")
        )
    return counts  # type: ignore[return-value]
