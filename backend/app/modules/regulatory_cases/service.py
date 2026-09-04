"""Transactional regulatory-case and append-only lifecycle operations."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.errors import ApiError
from backend.app.modules.publications.models import Publication
from backend.app.modules.regulatory_cases.models import (
    LifecycleEvent as LifecycleEventModel,
    RegulatoryCase as RegulatoryCaseModel,
    RegulatoryCasePublication,
)
from backend.app.modules.regulatory_cases.schemas import (
    LifecycleEventCreate,
    LifecycleEventResponse,
    LifecycleStage,
    RegulatoryCaseCreate,
    RegulatoryCaseDetail,
    RegulatoryCaseResponse,
)


ALLOWED_TRANSITIONS: dict[LifecycleStage, frozenset[LifecycleStage]] = {
    LifecycleStage.DRAFT: frozenset({LifecycleStage.INTRODUCED}),
    LifecycleStage.INTRODUCED: frozenset({LifecycleStage.ADOPTED}),
    LifecycleStage.ADOPTED: frozenset({LifecycleStage.PUBLISHED}),
    LifecycleStage.PUBLISHED: frozenset({LifecycleStage.EFFECTIVE}),
    LifecycleStage.EFFECTIVE: frozenset(
        {LifecycleStage.AMENDED, LifecycleStage.REPEALED}
    ),
    LifecycleStage.AMENDED: frozenset(
        {LifecycleStage.EFFECTIVE, LifecycleStage.REPEALED}
    ),
    LifecycleStage.REPEALED: frozenset(),
}


def is_valid_transition(
    current_stage: LifecycleStage,
    next_stage: LifecycleStage,
    *,
    has_events: bool,
) -> bool:
    return (
        not has_events and current_stage == next_stage
    ) or next_stage in ALLOWED_TRANSITIONS[current_stage]


def list_regulatory_cases(session: Session) -> list[RegulatoryCaseResponse]:
    rows = session.scalars(
        select(RegulatoryCaseModel).order_by(RegulatoryCaseModel.id)
    ).all()
    links = _links_by_case(session)
    return [_case_response(row, links.get(row.id, [])) for row in rows]


def get_regulatory_case(
    session: Session,
    case_id: str,
) -> RegulatoryCaseDetail | None:
    row = session.get(RegulatoryCaseModel, case_id)
    if row is None:
        return None
    publication_ids = session.scalars(
        select(RegulatoryCasePublication.publication_id)
        .where(RegulatoryCasePublication.case_id == case_id)
        .order_by(RegulatoryCasePublication.publication_id)
    ).all()
    events = session.scalars(
        select(LifecycleEventModel)
        .where(LifecycleEventModel.regulatory_case_id == case_id)
        .order_by(
            LifecycleEventModel.occurred_at,
            LifecycleEventModel.created_at,
            LifecycleEventModel.id,
        )
    ).all()
    return RegulatoryCaseDetail(
        regulatory_case=_case_response(row, list(publication_ids)),
        timeline=[_event_response(event) for event in events],
    )


def create_regulatory_case(
    session: Session,
    request: RegulatoryCaseCreate,
) -> RegulatoryCaseResponse:
    publication_ids = sorted(dict.fromkeys(request.related_publication_ids))
    now = _utc_iso(datetime.now(UTC))
    case = RegulatoryCaseModel(
        id=f"case-{uuid4()}",
        title=request.title,
        registration_number=request.registration_number,
        current_stage=request.current_stage.value,
        responsible_user_id=request.responsible_user_id,
        created_at=now,
        updated_at=now,
    )

    with session.begin():
        if publication_ids:
            known_ids = set(
                session.scalars(
                    select(Publication.id).where(Publication.id.in_(publication_ids))
                )
            )
            unknown_ids = [
                publication_id
                for publication_id in publication_ids
                if publication_id not in known_ids
            ]
            if unknown_ids:
                raise ApiError(
                    status_code=422,
                    code="validation_error",
                    message="Одна или несколько публикаций не найдены",
                    details={"unknown_publication_ids": unknown_ids},
                )

        session.add(case)
        session.add_all(
            RegulatoryCasePublication(
                id=f"case-publication-{uuid4().hex}",
                case_id=case.id,
                publication_id=publication_id,
                created_at=now,
            )
            for publication_id in publication_ids
        )
        session.flush()

    return _case_response(case, publication_ids)


def create_lifecycle_event(
    session: Session,
    case_id: str,
    request: LifecycleEventCreate,
) -> LifecycleEventResponse:
    with session.begin():
        case = session.get(RegulatoryCaseModel, case_id)
        if case is None:
            raise ApiError(
                status_code=404,
                code="not_found",
                message="Регуляторный кейс не найден",
            )

        has_events = session.scalar(
            select(LifecycleEventModel.id)
            .where(LifecycleEventModel.regulatory_case_id == case_id)
            .limit(1)
        ) is not None
        current_stage = LifecycleStage(case.current_stage)
        if not is_valid_transition(
            current_stage,
            request.stage,
            has_events=has_events,
        ):
            raise ApiError(
                status_code=409,
                code="conflict",
                message="Недопустимый переход стадии regulatory case",
                details={
                    "current_stage": current_stage.value,
                    "requested_stage": request.stage.value,
                },
            )

        now = _utc_iso(datetime.now(UTC))
        event = LifecycleEventModel(
            id=f"event-{uuid4()}",
            regulatory_case_id=case_id,
            stage=request.stage.value,
            occurred_at=_utc_iso(request.occurred_at),
            confirmation_url=str(request.confirmation_url),
            confirmation_source_type=request.confirmation_source_type.value,
            comment=request.comment,
            author_id=request.author_id,
            created_at=now,
        )
        session.add(event)
        case.current_stage = request.stage.value
        case.updated_at = now
        session.flush()

    return _event_response(event)


def link_publication_to_case(
    session: Session,
    case_id: str,
    publication_id: str,
) -> None:
    with session.begin():
        case = session.get(RegulatoryCaseModel, case_id)
        if case is None:
            raise ApiError(
                status_code=404,
                code="not_found",
                message="Регуляторный кейс не найден",
            )
        if session.get(Publication, publication_id) is None:
            raise ApiError(
                status_code=404,
                code="not_found",
                message="Публикация не найдена",
            )

        existing = session.scalar(
            select(RegulatoryCasePublication).where(
                RegulatoryCasePublication.case_id == case_id,
                RegulatoryCasePublication.publication_id == publication_id,
            )
        )
        if existing is not None:
            return

        now = _utc_iso(datetime.now(UTC))
        session.add(
            RegulatoryCasePublication(
                id=f"case-publication-{uuid4().hex}",
                case_id=case_id,
                publication_id=publication_id,
                created_at=now,
            )
        )
        case.updated_at = now
        session.flush()


def _links_by_case(session: Session) -> dict[str, list[str]]:
    rows = session.execute(
        select(
            RegulatoryCasePublication.case_id,
            RegulatoryCasePublication.publication_id,
        ).order_by(
            RegulatoryCasePublication.case_id,
            RegulatoryCasePublication.publication_id,
        )
    ).all()
    links: dict[str, list[str]] = {}
    for case_id, publication_id in rows:
        links.setdefault(case_id, []).append(publication_id)
    return links


def _case_response(
    row: RegulatoryCaseModel,
    publication_ids: list[str],
) -> RegulatoryCaseResponse:
    return RegulatoryCaseResponse(
        id=row.id,
        title=row.title,
        registration_number=row.registration_number,
        current_stage=row.current_stage,
        responsible_user_id=row.responsible_user_id,
        related_publication_ids=publication_ids,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _event_response(row: LifecycleEventModel) -> LifecycleEventResponse:
    return LifecycleEventResponse(
        id=row.id,
        regulatory_case_id=row.regulatory_case_id,
        stage=row.stage,
        occurred_at=row.occurred_at,
        confirmation_url=row.confirmation_url,
        confirmation_source_type=row.confirmation_source_type,
        comment=row.comment,
        author_id=row.author_id,
        created_at=row.created_at,
    )


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
