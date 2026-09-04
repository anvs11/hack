from collections.abc import Generator
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.sources import service
from backend.app.modules.sources.models import Source
from backend.app.modules.sources.schemas import SourceCreate


@pytest.fixture
def client_with_seed(tmp_path: Path) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'source-write.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        yield client, engine
    engine.dispose()


def _create_source(client: TestClient) -> dict:
    response = client.post(
        "/api/sources",
        json={
            "name": "Новый отраслевой RSS",
            "type": "rss",
            "url": "https://example.org/new-feed.xml",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_create_source_persists_contract_response(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    created = _create_source(client)

    assert created["id"].startswith("source-")
    assert created == {
        "id": created["id"],
        "name": "Новый отраслевой RSS",
        "type": "rss",
        "url": "https://example.org/new-feed.xml",
        "enabled": True,
        "last_checked_at": None,
        "last_success_at": None,
        "last_error": None,
        "is_demo": False,
    }
    sources = client.get("/api/sources").json()
    assert len(sources) == 6
    assert created in sources


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "type": "rss", "url": "https://example.org/feed.xml"},
        {"name": "Источник", "type": "website", "url": "https://example.org"},
        {"name": "Источник", "type": "rss", "url": "not-a-url"},
        {
            "name": "Источник",
            "type": "rss",
            "url": "https://example.org/feed.xml",
            "unexpected": True,
        },
    ],
)
def test_create_source_rejects_invalid_payload(
    client_with_seed: tuple[TestClient, Engine],
    body: dict,
) -> None:
    client, _engine = client_with_seed

    response = client.post("/api/sources", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_update_source_changes_only_contract_fields(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed
    created = _create_source(client)

    response = client.patch(
        f"/api/sources/{created['id']}",
        json={
            "name": "Обновлённый RSS",
            "url": "https://example.org/updated.xml",
            "enabled": False,
        },
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "Обновлённый RSS"
    assert updated["url"] == "https://example.org/updated.xml"
    assert updated["enabled"] is False
    assert updated["type"] == "rss"
    assert updated["is_demo"] is False


@pytest.mark.parametrize("body", [{}, {"name": None}, {"type": "telegram"}])
def test_update_source_rejects_empty_null_and_unknown_fields(
    client_with_seed: tuple[TestClient, Engine],
    body: dict,
) -> None:
    client, _engine = client_with_seed

    response = client.patch("/api/sources/source-regulation", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_update_source_returns_contract_404(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.patch("/api/sources/missing", json={"enabled": False})

    assert response.status_code == 404
    assert response.json() == {
        "code": "not_found",
        "message": "Источник не найден",
    }


def test_collect_unsupported_source_returns_failed_report_and_records_error(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.post("/api/sources/source-regulation/collections")

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["sources"][0]["status"] == "failed"
    assert response.json()["sources"][0]["source_id"] == "source-regulation"
    source = next(
        item
        for item in client.get("/api/sources").json()
        if item["id"] == "source-regulation"
    )
    assert source["last_checked_at"] is not None
    assert source["last_success_at"] is None
    assert source["last_error"] == (
        "Collector for source type 'regulator' is not implemented"
    )


def test_collect_source_returns_contract_404(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.post("/api/sources/missing/collections")

    assert response.status_code == 404
    assert response.json() == {
        "code": "not_found",
        "message": "Источник не найден",
    }


def test_create_source_rolls_back_failed_transaction(
    client_with_seed: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _client, engine = client_with_seed
    fixed_id = UUID("00000000-0000-0000-0000-000000000001")
    monkeypatch.setattr(service, "uuid4", lambda: fixed_id)
    source = SourceCreate(
        name="Транзакционный тест",
        type="rss",
        url="https://example.org/transaction.xml",
    )

    with Session(engine) as first_session:
        service.create_source(first_session, source)

    with Session(engine) as failed_session:
        with pytest.raises(IntegrityError):
            service.create_source(failed_session, source)

    with Session(engine) as check_session:
        count = check_session.scalar(select(func.count()).select_from(Source))

    assert count == 6
