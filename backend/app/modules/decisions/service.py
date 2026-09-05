"""Append-only specialist decision and publication history operations."""

import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.errors import ApiError
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.decisions.models import SpecialistDecision as DecisionModel
from backend.app.modules.decisions.schemas import SpecialistDecisionCreate
from backend.app.modules.publications.models import Publication, PublicationRevision
from backend.app.modules.publications.schemas import (
    AnalysisVersionResponse,
    PublicationHistory,
    PublicationRevisionResponse,
    SpecialistDecision,
)


def create_specialist_decision(
    session: Session,
    publication_id: str,
    request: SpecialistDecisionCreate,
) -> SpecialistDecision:
    with session.begin():
        publication = session.get(Publication, publication_id)
        if publication is None:
            raise ApiError(
                status_code=404,
                code="not_found",
                message="Публикация не найдена",
            )

        analysis = session.get(AnalysisVersion, request.analysis_id)
        if analysis is None:
            raise ApiError(
                status_code=404,
                code="not_found",
                message="Версия анализа не найдена",
            )
        if analysis.publication_id != publication_id:
            raise ApiError(
                status_code=422,
                code="validation_error",
                message="Версия анализа относится к другой публикации",
            )

        current_version = session.scalar(
            select(func.max(DecisionModel.version)).where(
                DecisionModel.publication_id == publication_id
            )
        )
        decision = SpecialistDecision(
            id=f"decision-{uuid4().hex}",
            publication_id=publication_id,
            version=(current_version or 0) + 1,
            created_at=datetime.now(UTC),
            **request.model_dump(),
        )
        session.add(
            DecisionModel(
                id=decision.id,
                publication_id=publication_id,
                analysis_id=request.analysis_id,
                version=decision.version,
                payload_json=decision.model_dump_json(),
            )
        )
        session.flush()
    return decision


def get_publication_history(
    session: Session,
    publication_id: str,
) -> PublicationHistory | None:
    if session.get(Publication, publication_id) is None:
        return None

    analyses = session.scalars(
        select(AnalysisVersion)
        .where(AnalysisVersion.publication_id == publication_id)
        .order_by(AnalysisVersion.version, AnalysisVersion.id)
    ).all()
    decisions = session.scalars(
        select(DecisionModel)
        .where(DecisionModel.publication_id == publication_id)
        .order_by(DecisionModel.version, DecisionModel.id)
    ).all()
    revisions = session.scalars(
        select(PublicationRevision)
        .where(PublicationRevision.publication_id == publication_id)
        .order_by(PublicationRevision.version, PublicationRevision.id)
    ).all()
    return PublicationHistory(
        publication_id=publication_id,
        revisions=[revision_response(row) for row in revisions],
        analyses=[analysis_response(row) for row in analyses],
        decisions=[decision_response(row) for row in decisions],
    )


def revision_response(row: PublicationRevision) -> PublicationRevisionResponse:
    return PublicationRevisionResponse(
        id=row.id,
        publication_id=row.publication_id,
        version=row.version,
        title=row.title,
        tags=json.loads(row.tags_json),
        is_hidden=bool(row.is_hidden),
        author_id=row.author_id,
        created_at=row.created_at,
    )


def analysis_response(row: AnalysisVersion) -> AnalysisVersionResponse:
    payload = json.loads(row.payload_json)
    return AnalysisVersionResponse.model_validate(
        {
            **payload,
            "id": row.id,
            "publication_id": row.publication_id,
            "version": row.version,
            "analyzer": row.analyzer,
            "input_hash": row.input_hash,
        }
    )


def decision_response(row: DecisionModel) -> SpecialistDecision:
    payload = json.loads(row.payload_json)
    return SpecialistDecision.model_validate(
        {
            **payload,
            "id": row.id,
            "publication_id": row.publication_id,
            "analysis_id": row.analysis_id,
            "version": row.version,
        }
    )
