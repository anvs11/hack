import json
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.publications.models import Publication
from backend.app.modules.sources.collection_service import collect_source
from backend.app.modules.sources.models import DuplicateCandidate, Source


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture
def client_with_seed(
    tmp_path: Path,
) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'collection.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        yield client, engine
    engine.dispose()


def _create_file_source(
    client: TestClient,
    path: Path,
    name: str = "Offline JSON",
) -> dict:
    response = client.post(
        "/api/sources",
        json={"name": name, "type": "file", "url": path.as_uri()},
    )
    assert response.status_code == 201
    return response.json()


def _publication_count(engine: Engine) -> int:
    with Session(engine) as session:
        return session.scalar(select(func.count()).select_from(Publication)) or 0


def test_collect_file_source_deduplicates_at_all_exact_levels(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    source = _create_file_source(client, FIXTURES / "collection-feed.json")

    first = client.post(f"/api/sources/{source['id']}/collections")

    assert first.status_code == 200
    assert first.json()["status"] == "completed"
    assert first.json()["sources"] == [
        {
            "source_id": source["id"],
            "status": "success",
            "collected": 4,
            "created": 1,
            "exact_duplicates": 3,
            "semantic_candidates": 0,
            "error": None,
        }
    ]
    assert _publication_count(engine) == 11
    with Session(engine) as session:
        row = session.get(Source, source["id"])
        assert row is not None
        payload = json.loads(row.payload_json)
        assert payload["last_error"] is None
        assert payload["last_success_at"] is not None
        assert payload["last_collection"] == {
            "collected": 4,
            "created": 1,
            "exact_duplicates": 3,
            "semantic_candidates": 0,
        }

    second = client.post(f"/api/sources/{source['id']}/collections")

    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["exact_duplicates"] == 4
    assert _publication_count(engine) == 11
    with Session(engine) as session:
        row = session.get(Source, source["id"])
        assert row is not None
        payload = json.loads(row.payload_json)
        assert payload["last_collection"]["created"] == 0
        assert payload["last_collection"]["exact_duplicates"] == 4


def test_collect_enabled_sources_reports_partial_failure(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    valid = _create_file_source(client, FIXTURES / "collection-feed.json", "Valid")
    invalid = _create_file_source(
        client,
        FIXTURES / "invalid-collection-feed.json",
        "Invalid",
    )

    response = client.post("/api/collections")

    assert response.status_code == 200
    report = response.json()
    assert report["status"] == "partial_failure"
    assert {item["source_id"]: item["status"] for item in report["sources"]}[
        valid["id"]
    ] == "success"
    assert {item["source_id"]: item["status"] for item in report["sources"]}[
        invalid["id"]
    ] == "failed"
    assert _publication_count(engine) == 11
    sources = {item["id"]: item for item in client.get("/api/sources").json()}
    assert sources[valid["id"]]["last_success_at"] is not None
    assert sources[valid["id"]]["last_error"] is None
    assert sources[invalid["id"]]["last_success_at"] is None
    assert sources[invalid["id"]]["last_error"] is not None


def test_semantic_comparison_saves_candidate_but_does_not_delete(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    source = _create_file_source(client, FIXTURES / "collection-feed.json")

    class FakeEmbedder:
        model_id = "fake-embedding-v1"

        def embed(self, texts: list[str]) -> list[list[float]]:
            assert len(texts) == 11
            return [
                [1.0, 0.0] if "облачн" in text.casefold() else [0.0, 1.0]
                for text in texts
            ]

    with Session(engine, expire_on_commit=False) as session:
        collected = collect_source(
            session,
            source["id"],
            embedder=FakeEmbedder(),
        )

    assert collected is not None
    assert collected.status == "completed"
    assert collected.semantic_candidates == 1
    assert _publication_count(engine) == 11
    with Session(engine) as session:
        candidate = session.scalar(select(DuplicateCandidate))
        assert candidate is not None
        assert candidate.candidate_publication_id == "pub-004"
        assert candidate.similarity == pytest.approx(1.0)
        assert candidate.status == "unreviewed"
