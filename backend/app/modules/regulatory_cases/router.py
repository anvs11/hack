"""HTTP routes for the B3 regulatory case slice."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.regulatory_cases.schemas import (
    RegulatoryCaseDetail,
    RegulatoryCaseResponse,
)
from backend.app.modules.regulatory_cases.service import (
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
