"""HTTP routes for regulatory cases and their lifecycle."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.regulatory_cases.schemas import (
    LifecycleEventCreate,
    LifecycleEventResponse,
    RegulatoryCaseCreate,
    RegulatoryCaseDetail,
    RegulatoryCaseResponse,
)
from backend.app.modules.regulatory_cases.service import (
    create_lifecycle_event as append_lifecycle_event,
    create_regulatory_case as persist_regulatory_case,
    get_regulatory_case as read_regulatory_case,
    link_publication_to_case,
    list_regulatory_cases as read_regulatory_cases,
)


router = APIRouter()


@router.get(
    "/api/regulatory-cases",
    operation_id="listRegulatoryCases",
    response_model=list[RegulatoryCaseResponse],
)
def list_regulatory_cases(
    session: Annotated[Session, Depends(get_session)],
) -> list[RegulatoryCaseResponse]:
    return read_regulatory_cases(session)


@router.post(
    "/api/regulatory-cases",
    operation_id="createRegulatoryCase",
    response_model=RegulatoryCaseResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_regulatory_case(
    request: RegulatoryCaseCreate,
    session: Annotated[Session, Depends(get_session)],
) -> RegulatoryCaseResponse:
    return persist_regulatory_case(session, request)


@router.get(
    "/api/regulatory-cases/{case_id}",
    operation_id="getRegulatoryCase",
    response_model=RegulatoryCaseDetail,
)
def get_regulatory_case(
    case_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> RegulatoryCaseDetail:
    detail = read_regulatory_case(session, case_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Регуляторный кейс не найден")
    return detail


@router.post(
    "/api/regulatory-cases/{case_id}/lifecycle-events",
    operation_id="createLifecycleEvent",
    response_model=LifecycleEventResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_lifecycle_event(
    case_id: str,
    request: LifecycleEventCreate,
    session: Annotated[Session, Depends(get_session)],
) -> LifecycleEventResponse:
    return append_lifecycle_event(session, case_id, request)


@router.put(
    "/api/regulatory-cases/{case_id}/publications/{publication_id}",
    operation_id="linkPublicationToCase",
    status_code=status.HTTP_204_NO_CONTENT,
)
def link_case_publication(
    case_id: str,
    publication_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    link_publication_to_case(session, case_id, publication_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
