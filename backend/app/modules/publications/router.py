"""HTTP routes for reading publication cards."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.publications.schemas import (
    Category,
    Priority,
    PublicationCreate,
    PublicationDetail,
    PublicationList,
    PublicationPatch,
    PublicationVisibility,
)
from backend.app.modules.publications.service import (
    PublicationFilters,
    create_publication as create_publication_service,
    get_publication as read_publication,
    list_publications as read_publications,
    update_publication as update_publication_service,
)
from backend.app.modules.sources.schemas import SourceType


router = APIRouter()


@router.get(
    "/api/publications",
    operation_id="listPublications",
    response_model=PublicationList,
)
def list_publications(
    session: Annotated[Session, Depends(get_session)],
    q: Annotated[str | None, Query(min_length=1)] = None,
    source_id: str | None = None,
    source_type: SourceType | None = None,
    published_from: datetime | None = None,
    published_to: datetime | None = None,
    category: Category | None = None,
    proposed_priority: Priority | None = None,
    needs_review: bool | None = None,
    visibility: PublicationVisibility = PublicationVisibility.ACTIVE,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PublicationList:
    return read_publications(
        session,
        PublicationFilters(
            q=q,
            source_id=source_id,
            source_type=source_type,
            published_from=published_from,
            published_to=published_to,
            category=category,
            proposed_priority=proposed_priority,
            needs_review=needs_review,
            visibility=visibility,
            limit=limit,
            offset=offset,
        ),
    )


@router.get(
    "/api/publications/{publication_id}",
    operation_id="getPublication",
    response_model=PublicationDetail,
)
def get_publication(
    publication_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> PublicationDetail:
    publication = read_publication(session, publication_id)
    if publication is None:
        raise HTTPException(status_code=404, detail="Публикация не найдена")
    return publication


@router.post(
    "/api/publications",
    operation_id="createPublication",
    response_model=PublicationDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_publication(
    request: PublicationCreate,
    session: Annotated[Session, Depends(get_session)],
) -> PublicationDetail:
    return create_publication_service(session, request)


@router.patch(
    "/api/publications/{publication_id}",
    operation_id="updatePublication",
    response_model=PublicationDetail,
)
def update_publication(
    publication_id: str,
    request: PublicationPatch,
    session: Annotated[Session, Depends(get_session)],
) -> PublicationDetail:
    publication = update_publication_service(session, publication_id, request)
    if publication is None:
        raise HTTPException(status_code=404, detail="Публикация не найдена")
    return publication
