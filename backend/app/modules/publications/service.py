"""Read and filtering operations for publication cards."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.app.errors import ApiError
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.decisions.models import SpecialistDecision as DecisionModel
from backend.app.modules.decisions.service import decision_response
from backend.app.modules.publications.models import Publication, PublicationRevision
from backend.app.modules.publications.schemas import (
    AnalysisVersionResponse,
    Category,
    Priority,
    PublicationCreate,
    PublicationDetail,
    PublicationList,
    PublicationPatch,
    PublicationResponse,
    PublicationRevisionResponse,
    PublicationVisibility,
)
from backend.app.modules.sources.models import Source
from backend.app.modules.sources.schemas import SourceType


PRIORITY_ORDER = {
    Priority.CRITICAL: 0,
    Priority.HIGH: 1,
    Priority.MEDIUM: 2,
    Priority.LOW: 3,
    Priority.UNKNOWN: 4,
}


@dataclass(frozen=True)
class PublicationFilters:
    q: str | None = None
    source_id: str | None = None
    source_type: SourceType | None = None
    published_from: datetime | None = None
    published_to: datetime | None = None
    category: Category | None = None
    proposed_priority: Priority | None = None
    needs_review: bool | None = None
    visibility: PublicationVisibility = PublicationVisibility.ACTIVE
    limit: int = 20
    offset: int = 0


def list_publications(
    session: Session,
    filters: PublicationFilters,
) -> PublicationList:
    publications = session.scalars(select(Publication)).all()
    analyses = _latest_analyses(session)
    decisions = _latest_decisions(session)
    revisions = _latest_revisions(session)
    source_types = dict(session.execute(select(Source.id, Source.type)).all())

    matched: list[PublicationDetail] = []
    for publication in publications:
        analysis = analyses.get(publication.id)
        payload = json.loads(publication.payload_json)
        detail = _publication_detail(
            publication,
            analysis,
            decisions.get(publication.id),
            revisions.get(publication.id),
            payload,
        )
        if _matches(detail, payload, source_types, filters):
            matched.append(detail)

    matched.sort(key=_sort_key)
    return PublicationList(
        items=matched[filters.offset : filters.offset + filters.limit],
        total=len(matched),
        limit=filters.limit,
        offset=filters.offset,
    )


def get_publication(session: Session, publication_id: str) -> PublicationDetail | None:
    publication = session.get(Publication, publication_id)
    if publication is None:
        return None

    analysis = session.scalars(
        select(AnalysisVersion)
        .where(AnalysisVersion.publication_id == publication_id)
        .order_by(AnalysisVersion.version.desc())
        .limit(1)
    ).first()
    decision = session.scalars(
        select(DecisionModel)
        .where(DecisionModel.publication_id == publication_id)
        .order_by(DecisionModel.version.desc())
        .limit(1)
    ).first()
    revision = session.scalars(
        select(PublicationRevision)
        .where(PublicationRevision.publication_id == publication_id)
        .order_by(PublicationRevision.version.desc())
        .limit(1)
    ).first()
    return _publication_detail(
        publication,
        analysis,
        decision,
        revision,
        json.loads(publication.payload_json),
    )


def create_publication(
    session: Session,
    request: PublicationCreate,
) -> PublicationDetail:
    now = datetime.now(UTC)
    canonical_url = _canonical_url(str(request.original_url))
    digest = f"sha256:{sha256(request.content.encode('utf-8')).hexdigest()}"
    publication_id = f"publication-{uuid4().hex}"
    published_at = _iso_datetime(request.published_at)
    created_at = _iso_datetime(now)

    with session.begin():
        if session.get(Source, request.source_id) is None:
            raise ApiError(
                status_code=404,
                code="not_found",
                message="Источник не найден",
            )
        duplicate = session.scalar(
            select(Publication.id).where(
                or_(
                    Publication.canonical_url == canonical_url,
                    Publication.content_hash == digest,
                )
            )
        )
        if duplicate is not None:
            raise ApiError(
                status_code=409,
                code="duplicate_publication",
                message="Публикация с таким URL или содержанием уже существует",
                details={"publication_id": duplicate},
            )

        payload = {
            "id": publication_id,
            "source_id": request.source_id,
            "external_id": publication_id,
            "title": request.title,
            "original_url": canonical_url,
            "published_at": published_at,
            "collected_at": created_at,
            "content": request.content,
            "content_hash": digest,
            "is_demo": False,
            "is_manual": True,
            "tags": request.tags,
        }
        publication = Publication(
            id=publication_id,
            source_id=request.source_id,
            external_id=publication_id,
            canonical_url=canonical_url,
            content_hash=digest,
            published_at=published_at,
            payload_json=json.dumps(payload, ensure_ascii=False, sort_keys=True),
        )
        revision = PublicationRevision(
            id=f"revision-{uuid4().hex}",
            publication_id=publication_id,
            version=1,
            title=request.title,
            tags_json=json.dumps(request.tags, ensure_ascii=False),
            is_hidden=0,
            author_id=request.author_id,
            created_at=created_at,
        )
        session.add_all((publication, revision))
        session.flush()
    return _publication_detail(publication, None, None, revision, payload)


def update_publication(
    session: Session,
    publication_id: str,
    patch: PublicationPatch,
) -> PublicationDetail | None:
    with session.begin():
        publication = session.get(Publication, publication_id)
        if publication is None:
            return None
        payload = json.loads(publication.payload_json)
        previous = session.scalars(
            select(PublicationRevision)
            .where(PublicationRevision.publication_id == publication_id)
            .order_by(PublicationRevision.version.desc())
            .limit(1)
        ).first()
        values = patch.model_dump(exclude_unset=True)
        title = values.get("title", previous.title if previous else payload["title"])
        tags = values.get(
            "tags",
            json.loads(previous.tags_json) if previous else payload.get("tags", []),
        )
        is_hidden = values.get(
            "is_hidden",
            bool(previous.is_hidden) if previous else False,
        )
        revision = PublicationRevision(
            id=f"revision-{uuid4().hex}",
            publication_id=publication_id,
            version=(previous.version if previous else 0) + 1,
            title=title,
            tags_json=json.dumps(tags, ensure_ascii=False),
            is_hidden=int(is_hidden),
            author_id=patch.author_id,
            created_at=_iso_datetime(datetime.now(UTC)),
        )
        session.add(revision)
        session.flush()
    return get_publication(session, publication_id)


def _latest_analyses(session: Session) -> dict[str, AnalysisVersion]:
    rows = session.scalars(
        select(AnalysisVersion).order_by(
            AnalysisVersion.publication_id,
            AnalysisVersion.version.desc(),
        )
    ).all()
    latest: dict[str, AnalysisVersion] = {}
    for row in rows:
        latest.setdefault(row.publication_id, row)
    return latest


def _latest_decisions(session: Session) -> dict[str, DecisionModel]:
    rows = session.scalars(
        select(DecisionModel).order_by(
            DecisionModel.publication_id,
            DecisionModel.version.desc(),
        )
    ).all()
    latest: dict[str, DecisionModel] = {}
    for row in rows:
        latest.setdefault(row.publication_id, row)
    return latest


def _latest_revisions(session: Session) -> dict[str, PublicationRevision]:
    rows = session.scalars(
        select(PublicationRevision).order_by(
            PublicationRevision.publication_id,
            PublicationRevision.version.desc(),
        )
    ).all()
    latest: dict[str, PublicationRevision] = {}
    for row in rows:
        latest.setdefault(row.publication_id, row)
    return latest


def _analysis_response(row: AnalysisVersion | None) -> AnalysisVersionResponse | None:
    if row is None:
        return None
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


def _publication_detail(
    row: Publication,
    analysis_row: AnalysisVersion | None,
    decision_row: DecisionModel | None,
    revision_row: PublicationRevision | None,
    payload: dict[str, Any],
) -> PublicationDetail:
    analysis = _analysis_response(analysis_row)
    publication = PublicationResponse(
        id=row.id,
        source_id=row.source_id,
        external_id=row.external_id,
        title=revision_row.title if revision_row else payload["title"],
        original_url=row.canonical_url,
        published_at=row.published_at,
        collected_at=payload.get("collected_at", row.published_at),
        content=payload["content"],
        content_hash=row.content_hash,
        is_demo=bool(payload.get("is_demo", False)),
        latest_analysis_id=analysis.id if analysis else None,
        latest_revision_id=revision_row.id if revision_row else None,
        tags=json.loads(revision_row.tags_json) if revision_row else payload.get("tags", []),
        is_hidden=bool(revision_row.is_hidden) if revision_row else False,
        is_manual=bool(payload.get("is_manual", False)),
        updated_at=(
            revision_row.created_at
            if revision_row
            else payload.get("collected_at", row.published_at)
        ),
    )
    return PublicationDetail(
        publication=publication,
        latest_analysis=analysis,
        latest_decision=decision_response(decision_row) if decision_row else None,
    )


def _matches(
    detail: PublicationDetail,
    payload: dict[str, Any],
    source_types: dict[str, str],
    filters: PublicationFilters,
) -> bool:
    publication = detail.publication
    analysis = detail.latest_analysis

    if filters.visibility is PublicationVisibility.ACTIVE and publication.is_hidden:
        return False
    if filters.visibility is PublicationVisibility.HIDDEN and not publication.is_hidden:
        return False

    if filters.source_id and publication.source_id != filters.source_id:
        return False
    if filters.source_type and source_types.get(publication.source_id) != filters.source_type:
        return False
    if filters.published_from and _utc(publication.published_at) < _utc(filters.published_from):
        return False
    if filters.published_to and _utc(publication.published_at) > _utc(filters.published_to):
        return False
    if filters.category and (analysis is None or analysis.category != filters.category):
        return False
    if filters.proposed_priority and (
        analysis is None or analysis.proposed_priority != filters.proposed_priority
    ):
        return False
    if filters.needs_review is not None and (
        analysis is None or analysis.needs_review != filters.needs_review
    ):
        return False
    if filters.q and filters.q.strip().casefold() not in _searchable_text(detail, payload):
        return False
    return True


def _searchable_text(detail: PublicationDetail, payload: dict[str, Any]) -> str:
    analysis = detail.latest_analysis
    values = [detail.publication.title, detail.publication.content]
    values.extend(detail.publication.tags)
    if analysis:
        values.extend((analysis.summary, analysis.category.value))
        values.extend(entity.value for entity in analysis.entities)
    return " ".join(values).casefold()


def _sort_key(detail: PublicationDetail) -> tuple[int, float, str]:
    priority = (
        detail.latest_analysis.proposed_priority
        if detail.latest_analysis
        else Priority.UNKNOWN
    )
    return (
        PRIORITY_ORDER[priority],
        -_utc(detail.publication.published_at).timestamp(),
        detail.publication.id,
    )


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


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


def _canonical_url(value: str) -> str:
    parsed = urlsplit(value)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit(
        (parsed.scheme.casefold(), parsed.netloc.casefold(), path, parsed.query, "")
    )


def _iso_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
