from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.regulatory_cases.models import (
    LifecycleEvent,
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


def _counts(engine: Engine) -> tuple[int, int, int]:
    with Session(engine) as session:
        return (
            session.scalar(select(func.count()).select_from(RegulatoryCase)) or 0,
            session.scalar(
                select(func.count()).select_from(RegulatoryCasePublication)
            )
            or 0,
            session.scalar(select(func.count()).select_from(LifecycleEvent)) or 0,
        )


def _case_payload(**updates: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "title": "Новый проект регулирования",
        "registration_number": "REG-2026-42",
        "current_stage": "draft",
        "responsible_user_id": "user-gr-042",
    }
    payload.update(updates)
    return payload


def _event_payload(**updates: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "stage": "draft",
        "occurred_at": "2026-09-02T09:30:00+03:00",
        "confirmation_url": "https://regulator.example/documents/42",
        "confirmation_source_type": "regulator",
        "comment": "Официальное подтверждение стадии.",
        "author_id": "user-gr-042",
    }
    payload.update(updates)
    return payload


def _create_case(client: TestClient, **updates: object) -> dict[str, object]:
    response = client.post("/api/regulatory-cases", json=_case_payload(**updates))
    assert response.status_code == 201
    return response.json()


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


def test_creates_regulatory_case_without_related_publications(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.post("/api/regulatory-cases", json=_case_payload())

    assert response.status_code == 201
    created = response.json()
    assert created["id"].startswith("case-")
    UUID(created["id"].removeprefix("case-"))
    assert created["responsible_user_id"] == "user-gr-042"
    assert created["related_publication_ids"] == []
    assert created["created_at"] == created["updated_at"]
    assert datetime.fromisoformat(created["created_at"]).tzinfo == UTC
    listed_ids = {item["id"] for item in client.get("/api/regulatory-cases").json()}
    assert created["id"] in listed_ids
    assert client.get(f"/api/regulatory-cases/{created['id']}").json() == {
        "regulatory_case": created,
        "timeline": [],
    }


def test_creates_case_with_deduplicated_publication_links(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    response = client.post(
        "/api/regulatory-cases",
        json=_case_payload(
            related_publication_ids=["pub-002", "pub-001", "pub-002"]
        ),
    )

    assert response.status_code == 201
    created = response.json()
    assert created["related_publication_ids"] == ["pub-001", "pub-002"]
    assert _link_count(engine) == 2
    detail = client.get(f"/api/regulatory-cases/{created['id']}").json()
    assert detail["regulatory_case"] == created


def test_unknown_related_publication_returns_422_without_partial_case_or_link(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    before = _counts(engine)

    response = client.post(
        "/api/regulatory-cases",
        json=_case_payload(related_publication_ids=["pub-001", "missing"]),
    )

    assert response.status_code == 422
    assert response.json() == {
        "code": "validation_error",
        "message": "Одна или несколько публикаций не найдены",
        "details": {"unknown_publication_ids": ["missing"]},
    }
    assert _counts(engine) == before


@pytest.mark.parametrize(
    "updates",
    [
        {"current_stage": "unknown"},
        {"related_publication_ids": "pub-001"},
        {"unexpected": True},
    ],
)
def test_invalid_case_payload_returns_controlled_422_without_write(
    client_with_seed: tuple[TestClient, Engine],
    updates: dict[str, object],
) -> None:
    client, engine = client_with_seed
    before = _counts(engine)

    response = client.post("/api/regulatory-cases", json=_case_payload(**updates))

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert _counts(engine) == before


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


def test_first_event_confirms_current_stage_and_persists_contract_fields(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    response = client.post(
        "/api/regulatory-cases/case-001/lifecycle-events",
        json=_event_payload(),
    )

    assert response.status_code == 201
    event = response.json()
    assert event["id"].startswith("event-")
    UUID(event["id"].removeprefix("event-"))
    assert event | {"id": "ignored", "created_at": "ignored"} == {
        "id": "ignored",
        "regulatory_case_id": "case-001",
        "stage": "draft",
        "occurred_at": "2026-09-02T06:30:00Z",
        "confirmation_url": "https://regulator.example/documents/42",
        "confirmation_source_type": "regulator",
        "comment": "Официальное подтверждение стадии.",
        "author_id": "user-gr-042",
        "created_at": "ignored",
    }
    assert datetime.fromisoformat(event["created_at"]).tzinfo == UTC
    detail = client.get("/api/regulatory-cases/case-001").json()
    assert detail["timeline"] == [event]
    assert detail["regulatory_case"]["current_stage"] == "draft"
    assert detail["regulatory_case"]["updated_at"] == event["created_at"]
    assert _counts(engine)[2] == 1


@pytest.mark.parametrize(
    ("current_stage", "next_stage"),
    [
        ("draft", "introduced"),
        ("introduced", "adopted"),
        ("adopted", "published"),
        ("published", "effective"),
        ("effective", "amended"),
        ("effective", "repealed"),
        ("amended", "effective"),
        ("amended", "repealed"),
    ],
)
def test_all_allowed_lifecycle_transitions(
    client_with_seed: tuple[TestClient, Engine],
    current_stage: str,
    next_stage: str,
) -> None:
    client, _engine = client_with_seed
    case = _create_case(client, current_stage=current_stage)
    case_id = case["id"]
    first = client.post(
        f"/api/regulatory-cases/{case_id}/lifecycle-events",
        json=_event_payload(stage=current_stage),
    )

    response = client.post(
        f"/api/regulatory-cases/{case_id}/lifecycle-events",
        json=_event_payload(
            stage=next_stage,
            occurred_at="2026-09-03T10:00:00Z",
            confirmation_source_type="official_publication",
        ),
    )

    assert first.status_code == 201
    assert response.status_code == 201
    assert response.json()["stage"] == next_stage
    detail = client.get(f"/api/regulatory-cases/{case_id}").json()
    assert detail["regulatory_case"]["current_stage"] == next_stage
    assert detail["regulatory_case"]["updated_at"] == response.json()["created_at"]
    assert detail["timeline"] == [first.json(), response.json()]


def test_lifecycle_events_are_append_only_and_timeline_is_deterministic(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    case = _create_case(client)
    case_id = str(case["id"])
    with Session(engine) as session:
        session.add_all(
            [
                LifecycleEvent(
                    id="event-z",
                    regulatory_case_id=case_id,
                    stage="draft",
                    occurred_at="2026-09-03T08:00:00Z",
                    confirmation_url="https://example.org/z",
                    confirmation_source_type="regulator",
                    comment="z",
                    author_id="user-z",
                    created_at="2026-09-03T09:00:00Z",
                ),
                LifecycleEvent(
                    id="event-a",
                    regulatory_case_id=case_id,
                    stage="draft",
                    occurred_at="2026-09-03T08:00:00Z",
                    confirmation_url="https://example.org/a",
                    confirmation_source_type="official_publication",
                    comment="a",
                    author_id="user-a",
                    created_at="2026-09-03T09:00:00Z",
                ),
                LifecycleEvent(
                    id="event-first",
                    regulatory_case_id=case_id,
                    stage="draft",
                    occurred_at="2026-09-02T08:00:00Z",
                    confirmation_url="https://example.org/first",
                    confirmation_source_type="regulator",
                    comment="first",
                    author_id="user-first",
                    created_at="2026-09-04T09:00:00Z",
                ),
            ]
        )
        session.commit()

    first_read = client.get(f"/api/regulatory-cases/{case_id}").json()["timeline"]
    second_read = client.get(f"/api/regulatory-cases/{case_id}").json()["timeline"]

    assert [event["id"] for event in first_read] == [
        "event-first",
        "event-a",
        "event-z",
    ]
    assert second_read == first_read
    with Session(engine) as session:
        assert session.get(LifecycleEvent, "event-first").comment == "first"


@pytest.mark.parametrize(
    ("current_stage", "requested_stage"),
    [
        ("draft", "published"),
        ("introduced", "draft"),
        ("draft", "draft"),
        ("repealed", "effective"),
    ],
)
def test_invalid_lifecycle_transition_returns_409_without_partial_update(
    client_with_seed: tuple[TestClient, Engine],
    current_stage: str,
    requested_stage: str,
) -> None:
    client, engine = client_with_seed
    case = _create_case(client, current_stage=current_stage)
    case_id = str(case["id"])
    first = client.post(
        f"/api/regulatory-cases/{case_id}/lifecycle-events",
        json=_event_payload(stage=current_stage),
    )
    assert first.status_code == 201
    before = client.get(f"/api/regulatory-cases/{case_id}").json()
    before_count = _counts(engine)[2]

    response = client.post(
        f"/api/regulatory-cases/{case_id}/lifecycle-events",
        json=_event_payload(stage=requested_stage),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "conflict"
    assert response.json()["details"] == {
        "current_stage": current_stage,
        "requested_stage": requested_stage,
    }
    assert _counts(engine)[2] == before_count
    assert client.get(f"/api/regulatory-cases/{case_id}").json() == before


@pytest.mark.parametrize("source_type", ["media", "telegram", "seed"])
def test_unofficial_confirmation_source_is_rejected_without_partial_write(
    client_with_seed: tuple[TestClient, Engine],
    source_type: str,
) -> None:
    client, engine = client_with_seed
    before = client.get("/api/regulatory-cases/case-001").json()

    response = client.post(
        "/api/regulatory-cases/case-001/lifecycle-events",
        json=_event_payload(confirmation_source_type=source_type),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert _counts(engine)[2] == 0
    assert client.get("/api/regulatory-cases/case-001").json() == before


def test_missing_case_lifecycle_event_returns_controlled_404_without_write(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    response = client.post(
        "/api/regulatory-cases/missing/lifecycle-events",
        json=_event_payload(),
    )

    assert response.status_code == 404
    assert response.json() == {
        "code": "not_found",
        "message": "Регуляторный кейс не найден",
    }
    assert _counts(engine)[2] == 0


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
    first_event = client.post(
        "/api/regulatory-cases/case-001/lifecycle-events",
        json=_event_payload(),
    ).json()
    second_event = client.post(
        "/api/regulatory-cases/case-001/lifecycle-events",
        json=_event_payload(
            stage="introduced",
            occurred_at="2026-09-03T09:30:00Z",
        ),
    ).json()

    assert client.post("/api/demo/seed").status_code == 200
    assert client.post("/api/demo/seed").status_code == 200

    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(RegulatoryCase)) == 1
    assert _link_count(engine) == 1
    detail = client.get("/api/regulatory-cases/case-001").json()
    assert detail["timeline"] == [first_event, second_event]
    assert detail["regulatory_case"]["current_stage"] == "introduced"
    assert detail["regulatory_case"]["updated_at"] == second_event["created_at"]
