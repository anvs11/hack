"""HTTP routes for specialist decisions and publication history."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.decisions.schemas import SpecialistDecisionCreate
from backend.app.modules.decisions.service import (
    create_specialist_decision,
    get_publication_history as read_publication_history,
)
from backend.app.modules.publications.schemas import (
    PublicationHistory,
    SpecialistDecision,
)


router = APIRouter()


@router.post(
    "/api/publications/{publication_id}/decisions",
    operation_id="createSpecialistDecision",
    response_model=SpecialistDecision,
    status_code=status.HTTP_201_CREATED,
)
def create_decision(
    publication_id: str,
    request: SpecialistDecisionCreate,
    session: Annotated[Session, Depends(get_session)],
) -> SpecialistDecision:
    return create_specialist_decision(session, publication_id, request)


@router.get(
    "/api/publications/{publication_id}/history",
    operation_id="getPublicationHistory",
    response_model=PublicationHistory,
)
def get_publication_history(
    publication_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> PublicationHistory:
    history = read_publication_history(session, publication_id)
    if history is None:
        raise HTTPException(status_code=404, detail="Публикация не найдена")
    return history
