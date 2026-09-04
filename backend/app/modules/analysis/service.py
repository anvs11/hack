"""Create immutable analysis versions from replaceable analyzers."""

import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.errors import ApiError
from backend.app.modules.analysis.analyzers import (
    AnalyzerOutputInvalid,
    AnalyzerUnavailable,
    build_analyzer,
)
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.prioritization.scorer import score_criteria
from backend.app.modules.publications.models import Publication
from backend.app.modules.publications.schemas import AnalysisVersionResponse, Analyzer
from scripts.seed_core import content_hash


def create_analysis_version(
    session: Session,
    publication_id: str,
    analyzer_kind: Analyzer,
) -> AnalysisVersionResponse | None:
    with session.begin():
        publication = session.get(Publication, publication_id)
        if publication is None:
            return None
        publication_payload = json.loads(publication.payload_json)
        stored_hash = publication.content_hash

    actual_hash = content_hash(publication_payload["content"])
    if actual_hash != stored_hash:
        raise ApiError(
            status_code=422,
            code="validation_error",
            message="Хеш содержимого публикации не совпадает",
        )

    try:
        draft = build_analyzer(analyzer_kind).analyze(
            publication_id=publication_id,
            title=publication_payload["title"],
            content=publication_payload["content"],
        )
    except AnalyzerUnavailable as error:
        raise ApiError(
            status_code=422,
            code="analyzer_unavailable",
            message=str(error),
        ) from error
    except AnalyzerOutputInvalid as error:
        raise ApiError(
            status_code=422,
            code="validation_error",
            message=str(error),
        ) from error

    if analyzer_kind is Analyzer.LIVE_LLM:
        scoring = score_criteria(draft.criteria)
        draft = draft.model_copy(
            update={
                "score": scoring.score,
                "proposed_priority": scoring.proposed_priority,
                "needs_review": draft.needs_review or scoring.has_hard_flag,
            }
        )

    content_for_evidence = _normalize_text(publication_payload["content"])
    for evidence in draft.evidence:
        quote = _normalize_text(evidence.quote)
        if not quote or quote not in content_for_evidence:
            raise ApiError(
                status_code=422,
                code="validation_error",
                message="Evidence quote не найден в тексте публикации",
            )

    with session.begin():
        current_version = session.scalar(
            select(func.max(AnalysisVersion.version)).where(
                AnalysisVersion.publication_id == publication_id
            )
        )
        version = (current_version or 0) + 1
        analysis = AnalysisVersionResponse(
            id=f"analysis-{uuid4().hex}",
            publication_id=publication_id,
            version=version,
            analyzer=analyzer_kind,
            input_hash=actual_hash,
            created_at=datetime.now(UTC),
            **draft.model_dump(),
        )
        row = AnalysisVersion(
            id=analysis.id,
            publication_id=publication_id,
            version=version,
            analyzer=analyzer_kind.value,
            input_hash=actual_hash,
            payload_json=analysis.model_dump_json(),
        )
        session.add(row)
        session.flush()
    return analysis


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).casefold()
