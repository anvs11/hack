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
from backend.app.modules.decisions.models import SpecialistDecision


@pytest.fixture
def client_with_seed(tmp_path: Path) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'decisions.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        yield client, engine
    engine.dispose()


def _payload(**updates: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "analysis_id": "analysis-001",
        "status": "confirmed",
        "final_summary": None,
        "final_category": "regulation",
        "final_priority": "high",
        "comment": None,
        "author_id": "user-gr-001",
    }
    payload.update(updates)
    return payload


def _decision_count(engine: Engine, publication_id: str = "pub-001") -> int:
    with Session(engine) as session:
        return session.scalar(
            select(func.count())
            .select_from(SpecialistDecision)
            .where(SpecialistDecision.publication_id == publication_id)
        ) or 0


def test_creates_confirmed_specialist_decision_and_updates_detail(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    response = client.post("/api/publications/pub-001/decisions", json=_payload())

    assert response.status_code == 201
    assert response.json() | {"id": "ignored", "created_at": "ignored"} == {
        "id": "ignored",
        "publication_id": "pub-001",
        "analysis_id": "analysis-001",
        "version": 1,
        "status": "confirmed",
        "final_summary": None,
        "final_category": "regulation",
        "final_priority": "high",
        "comment": None,
        "author_id": "user-gr-001",
        "created_at": "ignored",
    }
    assert _decision_count(engine) == 1
    assert client.get("/api/publications/pub-001").json()["latest_decision"][
        "id"
    ] == response.json()["id"]


def test_corrected_decisions_are_append_only_and_increment_version(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    first = client.post("/api/publications/pub-001/decisions", json=_payload())
    first_payload = first.json()
    second = client.post(
        "/api/publications/pub-001/decisions",
        json=_payload(
            status="corrected",
            final_summary="Уточнённое резюме.",
            final_category="trend",
            final_priority="medium",
            comment="Проверено специалистом.",
        ),
    )

    assert second.status_code == 201
    assert second.json()["version"] == 2
    assert second.json()["status"] == "corrected"
    assert second.json()["final_summary"] == "Уточнённое резюме."
    assert _decision_count(engine) == 2
    with Session(engine) as session:
        original = session.get(SpecialistDecision, first_payload["id"])
        assert original is not None
        assert json.loads(original.payload_json) == first_payload


def test_decision_does_not_mutate_analysis_version(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    with Session(engine) as session:
        analysis = session.get(AnalysisVersion, "analysis-001")
        assert analysis is not None
        original_payload = analysis.payload_json

    assert client.post(
        "/api/publications/pub-001/decisions",
        json=_payload(status="corrected", final_priority="critical"),
    ).status_code == 201

    with Session(engine) as session:
        analysis = session.get(AnalysisVersion, "analysis-001")
        assert analysis is not None
        assert analysis.payload_json == original_payload


@pytest.mark.parametrize(
    ("publication_id", "payload", "status", "message"),
    [
        ("missing", _payload(), 404, "Публикация не найдена"),
        (
            "pub-001",
            _payload(analysis_id="analysis-missing"),
            404,
            "Версия анализа не найдена",
        ),
        (
            "pub-001",
            _payload(analysis_id="analysis-002"),
            422,
            "Версия анализа относится к другой публикации",
        ),
    ],
)
def test_decision_relationship_errors_are_controlled_without_partial_write(
    client_with_seed: tuple[TestClient, Engine],
    publication_id: str,
    payload: dict[str, object],
    status: int,
    message: str,
) -> None:
    client, engine = client_with_seed

    response = client.post(
        f"/api/publications/{publication_id}/decisions",
        json=payload,
    )

    assert response.status_code == status
    assert response.json()["code"] in {"not_found", "validation_error"}
    assert response.json()["message"] == message
    assert _decision_count(engine) == 0


def test_invalid_decision_payload_is_controlled_and_does_not_write(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    response = client.post(
        "/api/publications/pub-001/decisions",
        json=_payload(final_priority="urgent"),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert _decision_count(engine) == 0


def test_history_returns_all_versions_in_deterministic_order(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed
    created_analysis = client.post("/api/publications/pub-001/analyses").json()
    first_decision = client.post(
        "/api/publications/pub-001/decisions", json=_payload()
    ).json()
    second_decision = client.post(
        "/api/publications/pub-001/decisions",
        json=_payload(analysis_id=created_analysis["id"], status="corrected"),
    ).json()

    response = client.get("/api/publications/pub-001/history")

    assert response.status_code == 200
    assert response.json()["publication_id"] == "pub-001"
    assert [item["version"] for item in response.json()["analyses"]] == [1, 2]
    assert [item["id"] for item in response.json()["decisions"]] == [
        first_decision["id"],
        second_decision["id"],
    ]


def test_history_can_be_empty_for_existing_publication(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    with Session(engine) as session:
        analysis = session.get(AnalysisVersion, "analysis-001")
        assert analysis is not None
        session.delete(analysis)
        session.commit()

    response = client.get("/api/publications/pub-001/history")

    assert response.status_code == 200
    assert response.json() == {
        "publication_id": "pub-001",
        "analyses": [],
        "decisions": [],
    }


def test_missing_publication_history_returns_controlled_404(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.get("/api/publications/missing/history")

    assert response.status_code == 404
    assert response.json() == {
        "code": "not_found",
        "message": "Публикация не найдена",
    }
