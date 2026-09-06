"""Analyze newly collected publications in bounded background batches."""

import json
from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.errors import ApiError
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.analysis.analyzers import LiveLLMAnalyzer
from backend.app.modules.analysis.service import create_analysis_version
from backend.app.modules.publications.models import Publication
from backend.app.modules.publications.schemas import Analyzer


@dataclass(frozen=True)
class AnalysisFailure:
    publication_id: str
    code: str


@dataclass(frozen=True)
class AnalysisBatchReport:
    pending: int
    attempted: int
    created: int
    skipped_short: int
    failed: int
    failures: tuple[AnalysisFailure, ...]

    def as_dict(self) -> dict:
        return asdict(self)


def analyze_pending_publications(
    session: Session,
    *,
    limit: int = 100,
    min_content_chars: int = 40,
) -> AnalysisBatchReport:
    """Create first live analysis versions without blocking collection forever."""

    if limit <= 0:
        raise ValueError("limit must be positive")
    if min_content_chars <= 0:
        raise ValueError("min_content_chars must be positive")

    with session.begin():
        publications = list(
            session.scalars(
                select(Publication).order_by(
                    Publication.published_at.desc(),
                    Publication.id,
                )
            )
        )
        analysis_rows = list(
            session.scalars(
                select(AnalysisVersion).order_by(
                    AnalysisVersion.publication_id,
                    AnalysisVersion.version.desc(),
                )
            )
        )
    latest: dict[str, AnalysisVersion] = {}
    for analysis in analysis_rows:
        latest.setdefault(analysis.publication_id, analysis)
    rows = [
        publication
        for publication in publications
        if _needs_analysis(latest.get(publication.id))
    ]

    attempted = 0
    created = 0
    skipped_short = 0
    failures: list[AnalysisFailure] = []
    for publication in rows:
        payload = json.loads(publication.payload_json)
        content = " ".join(str(payload.get("content", "")).split())
        if len(content) < min_content_chars:
            skipped_short += 1
            continue
        if attempted >= limit:
            break

        attempted += 1
        try:
            analysis = create_analysis_version(
                session,
                publication.id,
                Analyzer.LIVE_LLM,
            )
        except ApiError as error:
            failures.append(
                AnalysisFailure(publication_id=publication.id, code=error.code)
            )
            continue
        if analysis is not None:
            created += 1

    return AnalysisBatchReport(
        pending=len(rows),
        attempted=attempted,
        created=created,
        skipped_short=skipped_short,
        failed=len(failures),
        failures=tuple(failures),
    )


def _needs_analysis(analysis: AnalysisVersion | None) -> bool:
    if analysis is None:
        return True
    if analysis.analyzer != Analyzer.LIVE_LLM.value:
        return False
    payload = json.loads(analysis.payload_json)
    return (
        payload.get("proposed_priority") == "unknown"
        and payload.get("prompt_version") != LiveLLMAnalyzer.prompt_version
    )
