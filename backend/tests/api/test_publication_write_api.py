from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.publications.models import Publication, PublicationRevision


@pytest.fixture
def client_with_seed(tmp_path: Path) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'publication-write.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        yield client, engine
    engine.dispose()


def _manual_payload(**updates: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "source_id": "source-media-rss-1",
        "title": "Ручная публикация",
        "original_url": "https://example.com/manual-item",
        "published_at": "2026-09-05T08:00:00Z",
        "content": "Материал, которого не было в подключённых источниках.",
        "tags": ["ручной ввод", "GR"],
        "author_id": "user-gr-001",
    }
    payload.update(updates)
    return payload


def test_manual_publication_is_created_with_first_revision(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    response = client.post("/api/publications", json=_manual_payload())

    assert response.status_code == 201
    publication = response.json()["publication"]
    assert publication["title"] == "Ручная публикация"
    assert publication["tags"] == ["ручной ввод", "GR"]
    assert publication["is_manual"] is True
    assert publication["is_hidden"] is False
    assert publication["latest_revision_id"].startswith("revision-")
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Publication)) == 11
        assert session.scalar(select(func.count()).select_from(PublicationRevision)) == 1


def test_manual_publication_rejects_missing_source_and_exact_duplicate(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    missing = client.post(
        "/api/publications",
        json=_manual_payload(source_id="source-missing"),
    )
    created = client.post("/api/publications", json=_manual_payload())
    duplicate = client.post(
        "/api/publications",
        json=_manual_payload(title="Другое название"),
    )

    assert missing.status_code == 404
    assert missing.json()["message"] == "Источник не найден"
    assert created.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "duplicate_publication"


def test_manual_publication_normalizes_tags(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed
    payload = _manual_payload(
        original_url="https://example.com/manual-tags",
        tags=["  ИТ льготы  ", "ит ЛЬГОТЫ", "", " гранты "],
    )

    response = client.post("/api/publications", json=payload)

    assert response.status_code == 201
    assert response.json()["publication"]["tags"] == ["ИТ льготы", "гранты"]


def test_edit_hide_restore_and_history_are_append_only(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    edited = client.patch(
        "/api/publications/pub-001",
        json={
            "title": "Уточнённый заголовок",
            "tags": ["НПА", "налоги"],
            "author_id": "user-gr-001",
        },
    )
    hidden = client.patch(
        "/api/publications/pub-001",
        json={"is_hidden": True, "author_id": "user-gr-001"},
    )

    assert edited.status_code == 200
    assert edited.json()["publication"]["title"] == "Уточнённый заголовок"
    assert hidden.status_code == 200
    assert hidden.json()["publication"]["is_hidden"] is True
    assert client.get("/api/publications").json()["total"] == 9
    hidden_list = client.get(
        "/api/publications", params={"visibility": "hidden"}
    ).json()
    assert [item["publication"]["id"] for item in hidden_list["items"]] == ["pub-001"]

    restored = client.patch(
        "/api/publications/pub-001",
        json={"is_hidden": False, "author_id": "user-admin-001"},
    )
    history = client.get("/api/publications/pub-001/history")

    assert restored.json()["publication"]["is_hidden"] is False
    assert [item["version"] for item in history.json()["revisions"]] == [1, 2, 3]
    assert history.json()["revisions"][0]["title"] == "Уточнённый заголовок"
    with Session(engine) as session:
        original = session.get(Publication, "pub-001")
        assert original is not None
        assert "Уточнённый заголовок" not in original.payload_json


@pytest.mark.parametrize(
    "payload",
    [
        {"author_id": "user-gr-001"},
        {"title": None, "author_id": "user-gr-001"},
        {"tags": None, "author_id": "user-gr-001"},
    ],
)
def test_publication_patch_requires_a_non_null_edit(
    client_with_seed: tuple[TestClient, Engine],
    payload: dict[str, object],
) -> None:
    response = client_with_seed[0].patch(
        "/api/publications/pub-001",
        json=payload,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
