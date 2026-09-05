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
from backend.app.modules.analysis import analyzers, service
from backend.app.modules.analysis.analyzers import (
    AnalysisDraft,
    AnalyzerOutputInvalid,
    AnalyzerUnavailable,
    LiveLLMAnalyzer,
    OpenAICompatibleGenerator,
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
        "summary": "Первый вывод. Второй вывод. Третий вывод.",
        "facts": ["Проверяемый факт"],
        "entities": [{"type": "topic", "value": "тест"}],
        "category": "trend",
        "criteria": {
            "business_relevance": 0,
            "event_maturity": 0,
            "financial_impact": 0,
            "implementation_effort": 0,
            "risk_severity": 0,
            "action_urgency": 0,
            "state_support_or_accreditation_change": False,
            "service_or_legal_blocking_risk": False,
            "strategic_technology_status": False,
            "binding_legal_precedent": False,
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
                importance_score=0,
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
    assert response.json()["importance_score"] == 0
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
                importance_score=0,
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
    assert draft.summary == "Первый вывод. Второй вывод. Третий вывод."
    assert draft.prompt_version == "analysis-v3"
    assert draft.proposed_priority.value == "unknown"
    assert draft.importance_score is None
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


def test_live_adapter_retries_ungrounded_evidence_once() -> None:
    calls = 0

    def generator(**_kwargs) -> list[dict]:
        nonlocal calls
        calls += 1
        output = _live_output(
            quote=(
                "цитата отсутствует"
                if calls == 1
                else "Это тестовый текст"
            )
        )
        return [{"generated_text": json.dumps(output, ensure_ascii=False)}]

    analyzer = LiveLLMAnalyzer(generator=generator)
    draft = analyzer.analyze(
        publication_id="pub-test",
        title="Тест",
        content="Это тестовый текст.",
    )

    assert calls == 2
    assert draft.evidence[0].quote == "Это тестовый текст"


@pytest.mark.parametrize(
    ("content", "summary"),
    [
        ("Короткий текст.", "Только одно предложение."),
        (
            "Длинный исходный текст. " * 40,
            ("Очень " * 180) + "длинно. Второе предложение. Третье предложение.",
        ),
    ],
)
def test_live_adapter_rejects_non_compressed_summary(
    content: str,
    summary: str,
) -> None:
    calls = 0

    def generator(**_kwargs) -> list[dict]:
        nonlocal calls
        calls += 1
        output = _live_output()
        output["summary"] = summary
        return [{"generated_text": json.dumps(output)}]

    analyzer = LiveLLMAnalyzer(generator=generator)

    with pytest.raises(AnalyzerOutputInvalid):
        analyzer.analyze(
            publication_id="pub-test",
            title="Тест",
            content=content,
        )

    assert calls == 2


def test_live_adapter_does_not_import_transformers_on_construction() -> None:
    was_loaded = "transformers" in sys.modules

    LiveLLMAnalyzer()

    assert ("transformers" in sys.modules) is was_loaded


def test_openai_compatible_adapter_flattens_chat_and_parses_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        @staticmethod
        def read() -> bytes:
            return json.dumps(
                {"choices": [{"message": {"content": "{\"ok\": true}"}}]}
            ).encode()

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["authorization"] = request.headers["Authorization"]
        captured["body"] = json.loads(request.data)
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(analyzers, "urlopen", fake_urlopen)
    generator = OpenAICompatibleGenerator(
        base_url="https://llm.example/v1/",
        api_key="secret-for-test",
        model_id="Qwen/Qwen3.5-0.8B",
        timeout=17,
    )

    result = generator(
        text=[
            {
                "role": "user",
                "content": [{"type": "text", "text": "Верни JSON"}],
            }
        ],
        max_new_tokens=123,
        do_sample=False,
        return_full_text=False,
    )

    assert result == [{"generated_text": '{"ok": true}'}]
    assert captured == {
        "url": "https://llm.example/v1/chat/completions",
        "authorization": "Bearer secret-for-test",
        "body": {
            "model": "Qwen/Qwen3.5-0.8B",
            "messages": [{"role": "user", "content": "Верни JSON"}],
            "temperature": 0,
            "max_tokens": 123,
        },
        "timeout": 17,
    }


def test_openai_compatible_provider_requires_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("HACK_LLM_API_BASE_URL", raising=False)
    monkeypatch.delenv("HACK_LLM_API_KEY", raising=False)
    analyzer = LiveLLMAnalyzer(provider="openai_compatible")

    with pytest.raises(AnalyzerUnavailable, match="Сервис AI-анализа не настроен"):
        analyzer._load_generator()


def test_openai_compatible_adapter_can_disable_reasoning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        @staticmethod
        def read() -> bytes:
            return json.dumps(
                {"choices": [{"message": {"content": "{\"ok\": true}"}}]}
            ).encode()

    def fake_urlopen(request, timeout):
        captured.update(json.loads(request.data))
        return Response()

    monkeypatch.setattr(analyzers, "urlopen", fake_urlopen)
    generator = OpenAICompatibleGenerator(
        base_url="https://llm.example/v1",
        api_key="secret-for-test",
        model_id="qwen/qwen3.8-flash",
        timeout=17,
        reasoning_effort="none",
    )

    generator(
        text=[{"role": "user", "content": [{"type": "text", "text": "JSON"}]}],
        max_new_tokens=123,
        do_sample=False,
        return_full_text=False,
    )

    assert captured["reasoning"] == {"effort": "none"}
