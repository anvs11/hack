"""HTTP API for human review of semantic duplicate candidates."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.sources.dedup_schemas import (
    DuplicateCandidateList,
    DuplicateCandidateResponse,
    DuplicateFilterStatus,
    DuplicateReviewCreate,
)
from backend.app.modules.sources.dedup_service import (
    create_duplicate_review as create_review,
    list_duplicate_candidates as read_candidates,
)


router = APIRouter()


@router.get(
    "/api/duplicate-candidates",
    operation_id="listDuplicateCandidates",
    response_model=DuplicateCandidateList,
)
def list_duplicate_candidates(
    session: Annotated[Session, Depends(get_session)],
    status_filter: Annotated[
        DuplicateFilterStatus,
        Query(alias="status"),
    ] = DuplicateFilterStatus.UNREVIEWED,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DuplicateCandidateList:
    return read_candidates(
        session,
        status=None if status_filter is DuplicateFilterStatus.ALL else status_filter.value,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/api/duplicate-candidates/{candidate_id}/reviews",
    operation_id="createDuplicateReview",
    response_model=DuplicateCandidateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_duplicate_review(
    candidate_id: str,
    request: DuplicateReviewCreate,
    session: Annotated[Session, Depends(get_session)],
) -> DuplicateCandidateResponse:
    candidate = create_review(session, candidate_id, request)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Кандидат на дубликат не найден")
    return candidate
