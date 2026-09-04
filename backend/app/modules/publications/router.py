"""HTTP routes for reading publication cards."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.publications.schemas import (
    Category,
    Priority,
    PublicationDetail,
    PublicationList,
)
from backend.app.modules.publications.service import (
    PublicationFilters,
    get_publication as read_publication,
    list_publications as read_publications,
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
