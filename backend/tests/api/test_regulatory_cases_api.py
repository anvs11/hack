from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.regulatory_cases.models import (
    RegulatoryCase,
    RegulatoryCasePublication,
)


@pytest.fixture
def client_with_seed(tmp_path: Path) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'cases.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        yield client, engine
    engine.dispose()


def _link_count(engine: Engine) -> int:
    with Session(engine) as session:
        return session.scalar(
            select(func.count()).select_from(RegulatoryCasePublication)
        ) or 0


def test_lists_and_gets_seeded_regulatory_case(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    cases = client.get("/api/regulatory-cases")
    detail = client.get("/api/regulatory-cases/case-001")

    assert cases.status_code == 200
    assert len(cases.json()) == 1
    assert cases.json()[0]["registration_number"] == "DEMO-2026-001"
    assert cases.json()[0]["related_publication_ids"] == []
    assert detail.status_code == 200
    assert detail.json()["regulatory_case"] == cases.json()[0]
    assert detail.json()["timeline"] == []


def test_links_publication_idempotently_and_reflects_current_relationship(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    first = client.put("/api/regulatory-cases/case-001/publications/pub-001")
    second = client.put("/api/regulatory-cases/case-001/publications/pub-001")

    assert first.status_code == 204
    assert first.content == b""
    assert second.status_code == 204
    assert _link_count(engine) == 1
    assert client.get("/api/regulatory-cases/case-001").json()[
        "regulatory_case"
    ]["related_publication_ids"] == ["pub-001"]


@pytest.mark.parametrize(
    ("case_id", "publication_id", "message"),
    [
        ("missing", "pub-001", "Регуляторный кейс не найден"),
        ("case-001", "missing", "Публикация не найдена"),
    ],
)
def test_link_returns_controlled_404_without_partial_write(
    client_with_seed: tuple[TestClient, Engine],
    case_id: str,
    publication_id: str,
    message: str,
) -> None:
    client, engine = client_with_seed

    response = client.put(
        f"/api/regulatory-cases/{case_id}/publications/{publication_id}"
    )

    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": message}
    assert _link_count(engine) == 0


def test_missing_case_returns_controlled_404(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.get("/api/regulatory-cases/missing")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_repeated_seed_keeps_one_case_and_does_not_remove_existing_link(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    assert client.put(
        "/api/regulatory-cases/case-001/publications/pub-001"
    ).status_code == 204

    assert client.post("/api/demo/seed").status_code == 200
    assert client.post("/api/demo/seed").status_code == 200

    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(RegulatoryCase)) == 1
    assert _link_count(engine) == 1
