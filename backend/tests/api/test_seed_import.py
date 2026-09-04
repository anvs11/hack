from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.publications.models import Publication
from backend.app.modules.sources.models import Source


@pytest.fixture
def seeded_client(tmp_path: Path) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'api-seed.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        yield client, engine
    engine.dispose()


def _counts(engine: Engine) -> tuple[int, int, int]:
    with Session(engine) as session:
        return (
            session.scalar(select(func.count()).select_from(Source)) or 0,
            session.scalar(select(func.count()).select_from(Publication)) or 0,
            session.scalar(select(func.count()).select_from(AnalysisVersion)) or 0,
        )


def test_seed_import_is_idempotent(
    seeded_client: tuple[TestClient, Engine],
) -> None:
    client, engine = seeded_client

    first = client.post("/api/demo/seed")
    second = client.post("/api/demo/seed")

    assert first.status_code == 200
    assert first.json() == {
        "sources": 5,
        "publications": 10,
        "analyses": 10,
        "duplicates": 0,
    }
    assert second.status_code == 200
    assert second.json() == {
        "sources": 5,
        "publications": 10,
        "analyses": 10,
        "duplicates": 10,
    }
    assert _counts(engine) == (5, 10, 10)
