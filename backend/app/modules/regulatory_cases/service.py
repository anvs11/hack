"""Read and idempotent link operations for regulatory cases."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.errors import ApiError
from backend.app.modules.publications.models import Publication
from backend.app.modules.regulatory_cases.models import (
    RegulatoryCase as RegulatoryCaseModel,
    RegulatoryCasePublication,
)
from backend.app.modules.regulatory_cases.schemas import (
    RegulatoryCaseDetail,
    RegulatoryCaseResponse,
)


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
    return RegulatoryCaseDetail(
        regulatory_case=_case_response(row, list(publication_ids)),
        timeline=[],
    )


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

        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
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
