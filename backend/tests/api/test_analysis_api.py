import json
import sys
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.analysis import service
from backend.app.modules.analysis.analyzers import (
    AnalysisDraft,
    AnalyzerOutputInvalid,
    AnalyzerUnavailable,
    LiveLLMAnalyzer,
)
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.publications.models import Publication
from backend.app.modules.publications.schemas import Analyzer


@pytest.fixture
def client_with_seed(tmp_path: Path) -> Generator[tuple[TestClient, Engine], None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'analysis.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.post("/api/demo/seed").status_code == 200
        yield client, engine
    engine.dispose()


def _version_count(engine: Engine, publication_id: str) -> int:
    with Session(engine) as session:
        return session.scalar(
            select(func.count())
            .select_from(AnalysisVersion)
            .where(AnalysisVersion.publication_id == publication_id)
        ) or 0


def _live_output(quote: str = "тест") -> dict:
    return {
        "summary": "Краткое тестовое резюме.",
        "facts": ["Проверяемый факт"],
        "entities": [{"type": "topic", "value": "тест"}],
        "category": "trend",
        "criteria": {
            "K1": 0,
            "K2": 0,
            "K3": 0,
            "K4": 0,
            "K5": 0,
            "K6": 0,
            "H1": False,
            "H2": False,
            "H3": False,
            "H4": False,
        },
        "evidence": [{"claim": "Есть тест", "quote": quote}],
        "uncertainty": 0.4,
    }


def test_analyze_publication_defaults_to_replay_and_creates_new_version(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    with Session(engine) as session:
        original = session.get(AnalysisVersion, "analysis-001")
        assert original is not None
        original_payload = original.payload_json

    response = client.post("/api/publications/pub-001/analyses")

    assert response.status_code == 201
    analysis = response.json()
    assert analysis["publication_id"] == "pub-001"
    assert analysis["version"] == 2
    assert analysis["analyzer"] == "replay"
    assert analysis["model"] == "demo-replay-v1"
    assert analysis["id"] != "analysis-001"
    assert _version_count(engine, "pub-001") == 2
    with Session(engine) as session:
        original = session.get(AnalysisVersion, "analysis-001")
        assert original is not None
        assert original.payload_json == original_payload


def test_repeated_analysis_increments_version_and_updates_detail(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    second = client.post(
        "/api/publications/pub-002/analyses",
        json={"analyzer": "replay"},
    )
    third = client.post(
        "/api/publications/pub-002/analyses",
        json={"analyzer": "replay"},
    )

    assert second.status_code == 201
    assert third.status_code == 201
    assert second.json()["version"] == 2
    assert third.json()["version"] == 3
    assert second.json()["id"] != third.json()["id"]
    assert _version_count(engine, "pub-002") == 3
    detail = client.get("/api/publications/pub-002").json()
    assert detail["latest_analysis"]["id"] == third.json()["id"]
    assert detail["publication"]["latest_analysis_id"] == third.json()["id"]


def test_analyze_publication_returns_contract_404(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_with_seed

    response = client.post("/api/publications/missing/analyses")

    assert response.status_code == 404
    assert response.json() == {
        "code": "not_found",
        "message": "Публикация не найдена",
    }


def test_analyze_publication_rejects_unknown_analyzer_without_writing(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed

    response = client.post(
        "/api/publications/pub-003/analyses",
        json={"analyzer": "unknown"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert _version_count(engine, "pub-003") == 1


def test_hash_mismatch_is_rejected_without_writing(
    client_with_seed: tuple[TestClient, Engine],
) -> None:
    client, engine = client_with_seed
    with Session(engine) as session:
        publication = session.get(Publication, "pub-004")
        assert publication is not None
        publication.content_hash = "sha256:" + "0" * 64
        session.commit()

    response = client.post("/api/publications/pub-004/analyses")

    assert response.status_code == 422
    assert response.json() == {
        "code": "validation_error",
        "message": "Хеш содержимого публикации не совпадает",
    }
    assert _version_count(engine, "pub-004") == 1


def test_unavailable_live_analyzer_returns_controlled_error_without_writing(
    client_with_seed: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = client_with_seed

    class UnavailableAnalyzer:
        def analyze(self, **_kwargs) -> AnalysisDraft:
            raise AnalyzerUnavailable("Qwen недоступен в тесте")

    monkeypatch.setattr(service, "build_analyzer", lambda _kind: UnavailableAnalyzer())

    response = client.post(
        "/api/publications/pub-005/analyses",
        json={"analyzer": "live_llm"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "code": "analyzer_unavailable",
        "message": "Qwen недоступен в тесте",
    }
    assert _version_count(engine, "pub-005") == 1


def test_valid_live_draft_is_saved_with_deterministic_score(
    client_with_seed: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = client_with_seed

    class FixedAnalyzer:
        def analyze(self, **_kwargs) -> AnalysisDraft:
            return AnalysisDraft(
                model="Qwen/Qwen3.5-0.8B",
                prompt_version="analysis-v1",
                **_live_output(quote="уведомление"),
                proposed_priority="unknown",
                score=0,
                needs_review=True,
            )

    monkeypatch.setattr(service, "build_analyzer", lambda _kind: FixedAnalyzer())

    response = client.post(
        "/api/publications/pub-006/analyses",
        json={"analyzer": "live_llm"},
    )

    assert response.status_code == 201
    assert response.json()["analyzer"] == "live_llm"
    assert response.json()["proposed_priority"] == "low"
    assert response.json()["score"] == 0
    assert response.json()["needs_review"] is True
    assert _version_count(engine, "pub-006") == 2


def test_ungrounded_evidence_is_rejected_without_writing(
    client_with_seed: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = client_with_seed

    class UngroundedAnalyzer:
        def analyze(self, **_kwargs) -> AnalysisDraft:
            return AnalysisDraft(
                model="test-model",
                prompt_version="analysis-v1",
                **_live_output(quote="цитата отсутствует в исходном тексте"),
                proposed_priority="unknown",
                score=0,
                needs_review=True,
            )

    monkeypatch.setattr(service, "build_analyzer", lambda _kind: UngroundedAnalyzer())

    response = client.post(
        "/api/publications/pub-007/analyses",
        json={"analyzer": "live_llm"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "code": "validation_error",
        "message": "Evidence quote не найден в тексте публикации",
    }
    assert _version_count(engine, "pub-007") == 1


def test_live_adapter_parses_json_and_does_not_delegate_scoring() -> None:
    calls = 0

    def generator(**_kwargs) -> list[dict]:
        nonlocal calls
        calls += 1
        return [{"generated_text": f"```json\n{json.dumps(_live_output())}\n```"}]

    analyzer = LiveLLMAnalyzer(
        generator=generator,
        model_id="Qwen/Qwen3.5-0.8B",
    )
    draft = analyzer.analyze(
        publication_id="pub-test",
        title="Тест",
        content="Это тестовый текст.",
    )

    assert calls == 1
    assert draft.summary == "Краткое тестовое резюме."
    assert draft.prompt_version == "analysis-v2"
    assert draft.proposed_priority.value == "unknown"
    assert draft.score == 0
    assert draft.needs_review is True


def test_live_adapter_retries_invalid_json_once() -> None:
    calls = 0

    def generator(**_kwargs) -> list[dict]:
        nonlocal calls
        calls += 1
        return [{"generated_text": "не JSON"}]

    analyzer = LiveLLMAnalyzer(generator=generator)

    with pytest.raises(AnalyzerOutputInvalid):
        analyzer.analyze(
            publication_id="pub-test",
            title="Тест",
            content="Это тестовый текст.",
        )

    assert calls == 2


def test_live_adapter_does_not_import_transformers_on_construction() -> None:
    was_loaded = "transformers" in sys.modules

    LiveLLMAnalyzer()

    assert ("transformers" in sys.modules) is was_loaded
