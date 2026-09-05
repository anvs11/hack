from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.sources.models import (
    DuplicateCandidate,
    DuplicateReview,
    PublicationEmbedding,
)
from backend.app.modules.sources.dedup_service import backfill_duplicate_candidates


@pytest.fixture
def client_with_candidate(
    tmp_path: Path,
) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'duplicates.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        with Session(engine) as session:
            session.add(
                DuplicateCandidate(
                    id="duplicate-test-001",
                    publication_id="pub-002",
                    candidate_publication_id="pub-001",
                    model="fake-embedding-v1",
                    similarity=0.91,
                    status="unreviewed",
                    created_at=datetime.now(UTC).isoformat(),
                )
            )
            session.commit()
        yield client, engine
    engine.dispose()


def test_list_duplicate_candidates_returns_comparable_publications(
    client_with_candidate: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_candidate

    response = client.get("/api/duplicate-candidates")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["similarity"] == 0.91
    assert body["items"][0]["publication"]["publication"]["id"] == "pub-002"
    assert body["items"][0]["candidate_publication"]["publication"]["id"] == "pub-001"
    assert body["items"][0]["reviews"] == []


def test_duplicate_reviews_are_append_only_and_update_projection(
    client_with_candidate: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_candidate

    first = client.post(
        "/api/duplicate-candidates/duplicate-test-001/reviews",
        json={
            "verdict": "related",
            "reviewer_id": "user-gr-001",
            "comment": "Одна тема, разные события",
        },
    )
    second = client.post(
        "/api/duplicate-candidates/duplicate-test-001/reviews",
        json={
            "verdict": "duplicate",
            "reviewer_id": "user-lead-001",
            "comment": "Повторная проверка",
        },
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["status"] == "duplicate"
    assert [item["version"] for item in second.json()["reviews"]] == [1, 2]
    assert client.get("/api/duplicate-candidates").json()["total"] == 0
    assert client.get(
        "/api/duplicate-candidates", params={"status": "duplicate"}
    ).json()["total"] == 1
    all_candidates = client.get(
        "/api/duplicate-candidates", params={"status": "all"}
    )
    assert all_candidates.status_code == 200
    assert all_candidates.json()["total"] == 1
    with Session(engine) as session:
        rows = list(
            session.scalars(
                select(DuplicateReview).order_by(DuplicateReview.version)
            )
        )
        assert [row.verdict for row in rows] == ["related", "duplicate"]
        assert rows[-1].comment == "Повторная проверка"


def test_duplicate_review_returns_contract_errors(
    client_with_candidate: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_candidate

    missing = client.post(
        "/api/duplicate-candidates/missing/reviews",
        json={"verdict": "different", "reviewer_id": "user-gr-001"},
    )
    invalid = client.post(
        "/api/duplicate-candidates/duplicate-test-001/reviews",
        json={"verdict": "unreviewed", "reviewer_id": "user-gr-001"},
    )

    assert missing.status_code == 404
    assert invalid.status_code == 422


def test_semantic_backfill_is_idempotent(
    tmp_path: Path,
) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'backfill.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200

    class FakeEmbedder:
        model_id = "fake-backfill-v1"

        def __init__(self) -> None:
            self.calls = 0

        def embed(self, texts: list[str]) -> list[list[float]]:
            self.calls += 1
            return [[float(index + 1), 1.0] for index, _text in enumerate(texts)]

    embedder = FakeEmbedder()
    with Session(engine, expire_on_commit=False) as session:
        first = backfill_duplicate_candidates(session, embedder)
        second = backfill_duplicate_candidates(session, embedder)
        cached_vectors = session.scalar(
            select(func.count()).select_from(PublicationEmbedding)
        )

    assert first.publications == 10
    assert first.candidates_created == 9
    assert second.candidates_created == 0
    assert second.candidates_already_present == 9
    assert cached_vectors == 10
    assert embedder.calls == 1
    engine.dispose()
