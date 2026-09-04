import json
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.analysis.models import AnalysisVersion


@pytest.fixture
def client_with_seed(tmp_path: Path) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'read-api.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        yield client, engine
    engine.dispose()


def _ids(response) -> list[str]:
    assert response.status_code == 200
    return [item["publication"]["id"] for item in response.json()["items"]]


def test_list_sources_matches_seed_contract(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.get("/api/sources")

    assert response.status_code == 200
    assert len(response.json()) == 5
    assert [source["id"] for source in response.json()] == [
        "source-duma",
        "source-media-rss-1",
        "source-media-rss-2",
        "source-regulation",
        "source-telegram-archive",
    ]
    assert response.json()[0] == {
        "id": "source-duma",
        "name": (
            "Система обеспечения законодательной деятельности (demo)"
        ),
        "type": "regulator",
        "url": "https://sozd.duma.gov.ru/",
        "enabled": True,
        "last_checked_at": None,
        "last_success_at": None,
        "last_error": None,
        "is_demo": True,
    }


def test_list_publications_has_contract_shape_and_sorting(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.get("/api/publications")

    assert response.status_code == 200
    assert response.json()["total"] == 10
    assert response.json()["limit"] == 20
    assert response.json()["offset"] == 0
    assert _ids(response) == [
        "pub-007",
        "pub-002",
        "pub-001",
        "pub-009",
        "pub-008",
        "pub-006",
        "pub-005",
        "pub-004",
        "pub-010",
        "pub-003",
    ]
    first = response.json()["items"][0]
    assert first["publication"]["latest_analysis_id"] == "analysis-007"
    assert first["latest_analysis"]["version"] == 1
    assert first["latest_decision"] is None


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        (
            {"q": "критическая информационная инфраструктура"},
            ["pub-006"],
        ),
        ({"source_id": "source-media-rss-1"}, ["pub-008", "pub-003"]),
        ({"source_type": "telegram_archive"}, ["pub-005", "pub-010"]),
        (
            {"published_from": "2026-09-01T11:00:00Z"},
            ["pub-009", "pub-008", "pub-010"],
        ),
        (
            {"published_to": "2026-09-01T08:00:00Z"},
            ["pub-002", "pub-001"],
        ),
        ({"category": "trend"}, ["pub-004", "pub-010", "pub-003"]),
        ({"proposed_priority": "high"}, ["pub-007", "pub-002", "pub-001"]),
        ({"needs_review": "false"}, ["pub-009", "pub-004", "pub-003"]),
        (
            {
                "source_id": "source-media-rss-2",
                "source_type": "rss",
                "category": "trend",
                "proposed_priority": "medium",
                "needs_review": "false",
            },
            ["pub-004"],
        ),
    ],
)
def test_list_publications_filters(
    client_with_seed: tuple[TestClient, Engine],
    params: dict[str, str],
    expected: list[str],
) -> None:
    client, _engine = client_with_seed

    assert _ids(client.get("/api/publications", params=params)) == expected


def test_list_publications_paginates_after_sorting(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    first = client.get("/api/publications", params={"limit": 2, "offset": 0})
    second = client.get("/api/publications", params={"limit": 2, "offset": 2})

    assert first.json()["total"] == 10
    assert _ids(first) == ["pub-007", "pub-002"]
    assert _ids(second) == ["pub-001", "pub-009"]


@pytest.mark.parametrize(
    "params",
    [
        {"q": ""},
        {"source_type": "website"},
        {"category": "other"},
        {"proposed_priority": "urgent"},
        {"needs_review": "maybe"},
        {"published_from": "not-a-date"},
        {"published_to": "not-a-date"},
        {"limit": 0},
        {"limit": 101},
        {"offset": -1},
    ],
)
def test_list_publications_rejects_invalid_query(
    client_with_seed: tuple[TestClient, Engine],
    params: dict[str, str | int],
) -> None:
    client, _engine = client_with_seed

    response = client.get("/api/publications", params=params)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_get_publication_returns_latest_analysis_without_overwriting_history(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    with Session(engine) as session:
        first = session.get(AnalysisVersion, "analysis-001")
        assert first is not None
        second_payload = json.loads(first.payload_json)
        second_payload.update(
            id="analysis-001-v2",
            version=2,
            summary=(
                "Вторая версия анализа для проверки истории."
            ),
            created_at="2026-09-01T13:00:00Z",
        )
        session.add(
            AnalysisVersion(
                id="analysis-001-v2",
                publication_id="pub-001",
                version=2,
                analyzer="replay",
                input_hash=first.input_hash,
                payload_json=json.dumps(second_payload, ensure_ascii=False),
            )
        )
        session.commit()

    response = client.get("/api/publications/pub-001")

    assert response.status_code == 200
    assert response.json()["publication"]["id"] == "pub-001"
    assert response.json()["publication"]["latest_analysis_id"] == "analysis-001-v2"
    assert response.json()["latest_analysis"]["version"] == 2
    assert response.json()["latest_analysis"]["summary"] == (
        "Вторая версия анализа для проверки истории."
    )
    assert response.json()["latest_decision"] is None
    with Session(engine) as session:
        versions = session.scalar(
            select(func.count())
            .select_from(AnalysisVersion)
            .where(AnalysisVersion.publication_id == "pub-001")
        )
        assert versions == 2
        original = session.get(AnalysisVersion, "analysis-001")
        assert original is not None
        assert json.loads(original.payload_json)["version"] == 1


def test_get_publication_returns_contract_404(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.get("/api/publications/missing")

    assert response.status_code == 404
    assert response.json() == {
        "code": "not_found",
        "message": "Публикация не найдена",
    }
