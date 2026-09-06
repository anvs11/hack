import json
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from backend.app.db import build_engine, create_schema
from backend.app.errors import ApiError
from backend.app.modules.analysis import batch_service
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.publications.models import Publication
from backend.app.modules.sources.models import Source
from backend.app.modules.publications.hashing import content_hash


def _publication(
    publication_id: str,
    *,
    published_at: str,
    content: str,
) -> Publication:
    payload = {
        "id": publication_id,
        "source_id": "source-test",
        "external_id": publication_id,
        "title": publication_id,
        "original_url": f"https://example.org/{publication_id}",
        "published_at": published_at,
        "collected_at": published_at,
        "content": content,
        "content_hash": content_hash(content),
        "is_demo": False,
    }
    return Publication(
        id=publication_id,
        source_id="source-test",
        external_id=publication_id,
        canonical_url=payload["original_url"],
        content_hash=payload["content_hash"],
        published_at=published_at,
        payload_json=json.dumps(payload),
    )


@pytest.fixture
def session(tmp_path: Path):
    engine = build_engine(f"sqlite:///{tmp_path / 'analysis-batch.sqlite3'}")
    create_schema(engine)
    with Session(engine, expire_on_commit=False) as database_session:
        database_session.add(
            Source(
                id="source-test",
                name="Test",
                type="rss",
                url="https://example.org/feed",
                enabled=1,
                payload_json="{}",
            )
        )
        database_session.flush()
        database_session.add_all(
            (
                _publication(
                    "publication-old",
                    published_at="2026-09-06T08:00:00Z",
                    content="Содержательный материал " * 20,
                ),
                _publication(
                    "publication-new",
                    published_at="2026-09-06T10:00:00Z",
                    content="Новый содержательный материал " * 20,
                ),
                _publication(
                    "publication-title-only",
                    published_at="2026-09-06T11:00:00Z",
                    content="Только заголовок",
                ),
            )
        )
        database_session.commit()
        yield database_session
    engine.dispose()


def test_batch_skips_short_content_and_analyzes_newest_first(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def create(_session, publication_id, analyzer):
        calls.append(publication_id)
        return object()

    monkeypatch.setattr(batch_service, "create_analysis_version", create)

    report = batch_service.analyze_pending_publications(
        session,
        limit=1,
        min_content_chars=200,
    )

    assert calls == ["publication-new"]
    assert report.pending == 3
    assert report.attempted == 1
    assert report.created == 1
    assert report.skipped_short == 1
    assert report.failed == 0


def test_batch_keeps_processing_errors_visible(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(_session, publication_id, analyzer):
        raise ApiError(
            status_code=422,
            code="analyzer_unavailable",
            message=f"Unavailable for {publication_id}",
        )

    monkeypatch.setattr(batch_service, "create_analysis_version", fail)

    report = batch_service.analyze_pending_publications(
        session,
        limit=2,
        min_content_chars=200,
    )

    assert report.attempted == 2
    assert report.created == 0
    assert report.failed == 2
    assert {failure.code for failure in report.failures} == {"analyzer_unavailable"}


def test_old_unknown_live_analysis_is_retried_with_current_prompt() -> None:
    old_unknown = AnalysisVersion(
        id="analysis-old-unknown",
        publication_id="publication-old",
        version=1,
        analyzer="live_llm",
        input_hash="sha256:" + "0" * 64,
        payload_json=json.dumps(
            {"prompt_version": "analysis-v3", "proposed_priority": "unknown"}
        ),
    )
    current_unknown = AnalysisVersion(
        id="analysis-current-unknown",
        publication_id="publication-current",
        version=1,
        analyzer="live_llm",
        input_hash="sha256:" + "0" * 64,
        payload_json=json.dumps(
            {
                "prompt_version": batch_service.LiveLLMAnalyzer.prompt_version,
                "proposed_priority": "unknown",
            }
        ),
    )

    assert batch_service._needs_analysis(old_unknown) is True
    assert batch_service._needs_analysis(current_unknown) is False


@pytest.mark.parametrize(("limit", "min_content_chars"), [(0, 200), (1, 0)])
def test_batch_rejects_non_positive_limits(
    session: Session,
    limit: int,
    min_content_chars: int,
) -> None:
    with pytest.raises(ValueError):
        batch_service.analyze_pending_publications(
            session,
            limit=limit,
            min_content_chars=min_content_chars,
        )
